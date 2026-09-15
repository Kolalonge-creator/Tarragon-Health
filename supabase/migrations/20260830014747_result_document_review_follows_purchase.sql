-- Episodic-fee rebuild, step 6/6 (part a).
--
-- private.handle_lab_result_document (20260804232022) gated routine doctor
-- review of an uploaded result document on subscription-plan feature
-- 'result_document_review'. That primitive is retired; its replacement is
-- context-specific rather than a single boolean, so it is inlined here rather
-- than folded into patient_has_feature_access's generic allow-list:
--
--   - A document linked to a lab order that was actually paid for (partner-
--     billed, not still pending_payment or cancelled) gets review
--     unconditionally — the purchase itself is the interpretation fee, this
--     is what "doctor-reviewed" as part of a Health Check purchase means.
--   - A document with no linked paid order (a genuinely self-arranged
--     upload) falls back to "does this patient have an active programme
--     purchase" — bundled review, same as lifestyle_coaching/quarterly_report.
--
-- Everything else in this trigger — uploader derivation, notification/audit
-- shape, the untouched abnormal-screening-result pipeline — is unchanged.

create or replace function private.handle_lab_result_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
  v_has_review_access boolean;
  v_order_status public.lab_order_status;
begin
  if (select auth.uid()) is not null then
    new.uploaded_by := (select auth.uid());
  end if;

  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_note := null;

  if new.lab_order_id is not null then
    select status into v_order_status from public.lab_orders where id = new.lab_order_id;
    v_has_review_access := v_order_status is not null and v_order_status not in ('pending_payment', 'cancelled');
  else
    v_has_review_access := exists (
      select 1 from public.programme_purchases pp
      where pp.patient_id = new.patient_id
        and pp.status = 'active'
        and pp.ends_at >= current_date
    );
  end if;

  if v_has_review_access then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, escalation_level)
    values (
      new.organisation_id,
      new.patient_id,
      'clinician_review',
      'open',
      'Lab result document uploaded — review needed',
      format(
        'A lab result document was uploaded (%s)%s. Review and record any clinical finding. (Uploading a file does not itself create a screening result.)',
        new.source,
        case when new.note is not null and length(btrim(new.note)) > 0
          then format(' — %s', new.note) else '' end
      ),
      2
    )
    returning id into v_alert_id;

    new.clinician_alert_id := v_alert_id;
  else
    new.clinician_alert_id := null;
  end if;

  if new.source <> 'patient' then
    insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
    values
      (new.organisation_id, new.patient_id, 'whatsapp', 'result_document_available',
        jsonb_build_object('source', new.source::text)),
      (new.organisation_id, new.patient_id, 'email', 'result_document_available',
        jsonb_build_object('source', new.source::text));
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    new.uploaded_by,
    'lab_result_document.uploaded',
    'lab_result_documents',
    new.id,
    jsonb_build_object(
      'source', new.source::text,
      'clinician_alert_id', v_alert_id,
      'review_gated_by_purchase', not v_has_review_access
    )
  );

  return new;
end;
$$;

do $$
begin
  if pg_get_functiondef('private.handle_lab_result_document()'::regprocedure) ~ 'result_document_review' then
    raise exception 'FAIL: handle_lab_result_document still references the retired result_document_review feature flag';
  end if;
end $$;
