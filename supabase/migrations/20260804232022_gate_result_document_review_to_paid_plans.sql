-- Tarragon Health — gate routine doctor review of an uploaded result document
-- to a paid plan (Prevent and above). Founder decision 2026-08-05: a doctor
-- reading a raw file a patient uploaded, unprompted, for a patient who isn't
-- paying for review at all, spends real clinician time for no platform
-- benefit. Previously private.handle_lab_result_document() (20260720120100)
-- flagged EVERY upload for clinician_review regardless of plan.
--
-- Explicitly NOT touched by this migration: the abnormal-result escalation
-- pipeline (private.handle_abnormal_screening_result, driven by
-- screening_results.result_status in ('abnormal','critical')). That trigger
-- still fires on every plan, unconditionally — it is the platform's
-- structured-data safety net (Category 2→1 upgrade), and this file's own
-- "What Claude Must Never Do" list forbids ever deprioritising or gating it.
-- What changes here is a different thing: whether a doctor is asked to sit
-- down and read a raw, unstructured file a patient uploaded, which is a
-- convenience service, not the automated abnormal-value alarm.
--
-- private.patient_has_feature_access() is a new helper, not a reuse of
-- public.has_feature_access(), because that function always resolves for
-- auth.uid() (the caller) — fine for a patient checking their own
-- entitlement, wrong here because staff (a lab_liaison or clinician) can
-- upload a document on a patient's behalf, and it is the PATIENT's plan that
-- must gate this, never the uploader's. Lives in `private`, not `public`:
-- unlike has_feature_access it needs no PostgREST exposure (only ever called
-- from this SECURITY DEFINER trigger), so it carries no anon/authenticated
-- grant surface at all.

create or replace function private.patient_has_feature_access(p_patient_id uuid, p_feature text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.profiles where id = p_patient_id;

  if v_role = 'admin' then
    return true;
  end if;

  return exists (
    select 1
    from public.subscriptions s
    join public.subscription_plans p on p.id = s.plan_id
    where s.subscriber_id = p_patient_id
      and s.status in ('active', 'trialing')
      and p_feature = any(p.features)
  ) or exists (
    select 1
    from public.subscription_add_ons sao
    join public.subscriptions s on s.id = sao.subscription_id
    join public.add_ons a on a.id = sao.add_on_id
    where s.subscriber_id = p_patient_id
      and sao.status in ('active', 'trialing')
      and p_feature = any(a.features)
  );
end;
$$;

-- Grant to every paid tier (Prevent and above), every currency/interval
-- variant. Tarragon Free is deliberately excluded — that's the whole point
-- of this migration. Features-only update, so the price-lock trigger allows
-- it (same idiom as 20260723010040_async_consults.sql granting
-- 'async_doctor_visit').
update public.subscription_plans
  set features = (select array(select distinct unnest(coalesce(features, '{}') || array['result_document_review'])))
  where (code like 'prevent%' or code like 'essential%' or code like 'complete%')
    and not ('result_document_review' = any(coalesce(features, '{}')));

-- Behaviour-preserving except for the one new gate: identical uploader
-- derivation, identical notification/audit shape. The only change is that
-- the clinician_alerts insert (and clinician_alert_id stamp) now only
-- happens when the PATIENT has paid-plan review access; otherwise the
-- document still saves, uploader/notifications still fire exactly as
-- before, and the audit_log event records that review was gated by plan —
-- nothing is silently dropped, it is just not queued for a doctor to read.
create or replace function private.handle_lab_result_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
  v_has_review_access boolean;
begin
  -- Server-derive the uploader from the session when there is one. A
  -- service-role staff upload (auth.uid() null) keeps the id passed by the
  -- server action; a patient/staff own-session insert can never spoof it.
  if (select auth.uid()) is not null then
    new.uploaded_by := (select auth.uid());
  end if;

  -- A freshly uploaded document is never pre-reviewed.
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_note := null;

  v_has_review_access := private.patient_has_feature_access(new.patient_id, 'result_document_review');

  if v_has_review_access then
    -- Flag for a clinician to interpret. escalation_level 2 = routine
    -- review, NOT an emergency Priority-1 (that stays reserved for the
    -- abnormal-result pipeline, which a clinician drives after reading
    -- this file).
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

  -- Tell the patient their result is available — but only when someone ELSE
  -- uploaded it (a patient who just uploaded their own doesn't need telling).
  -- Notification/confirmation layer only; never gates anything.
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
      'review_gated_by_plan', not v_has_review_access
    )
  );

  return new;
end;
$$;

do $$
declare
  v_missing_plans text;
  v_free_has_feature boolean;
begin
  select string_agg(code, ', ') into v_missing_plans
  from public.subscription_plans
  where (code like 'prevent%' or code like 'essential%' or code like 'complete%')
    and not ('result_document_review' = any(coalesce(features, '{}')));
  if v_missing_plans is not null then
    raise exception 'FAIL: paid plans missing result_document_review: %', v_missing_plans;
  end if;

  select ('result_document_review' = any(coalesce(features, '{}'))) into v_free_has_feature
  from public.subscription_plans where code = 'free';
  if coalesce(v_free_has_feature, false) then
    raise exception 'FAIL: free plan unexpectedly granted result_document_review';
  end if;

  if not exists (
    select 1 from pg_proc
    where proname = 'patient_has_feature_access' and pronamespace = 'private'::regnamespace
  ) then
    raise exception 'FAIL: private.patient_has_feature_access was not created';
  end if;
end $$;
