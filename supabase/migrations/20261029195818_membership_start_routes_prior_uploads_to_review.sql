-- When a Free patient becomes a Member, what they uploaded while Free reaches a doctor. Founder/CMO instruction 2026-10-29: the
-- doctor must be able to see everything the person uploaded before.
--
-- THE GAP. Free uses no doctor time, so a result a Free patient uploads is stored and shown to them but raises no review alert
-- (private.handle_lab_result_document: "review_gated_by_purchase"). Records are not time-gated, so a doctor who opens the chart
-- can read those uploads after the person upgrades, but nothing ever asks a doctor to LOOK: the uploads sit unreviewed forever.
--
-- THE FIX. When a membership becomes active, the person's earlier patient-uploaded documents that were never reviewed and never
-- raised an alert are gathered under ONE clinician review alert (the same level the upload alert uses), and each document is
-- linked to it. The existing alert routing then assigns it to a doctor. Nothing is read or interpreted here.
--
-- ONE alert per membership start, however many documents, so a person with a long history does not flood the queue. A document
-- that already has an alert or a review is left alone, so this never duplicates work.

create or replace function private.route_prior_uploads_to_review_on_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_docs uuid[];
  v_n integer;
  v_alert uuid;
begin
  if new.state <> 'active' then return new; end if;
  if tg_op = 'UPDATE' and old.state = 'active' then return new; end if;

  select array_agg(d.id) into v_docs
    from public.lab_result_documents d
   where d.patient_id = new.patient_id
     and d.source = 'patient'
     and d.clinician_alert_id is null
     and d.reviewed_at is null
     and d.superseded_by_document_id is null;
  v_n := coalesce(cardinality(v_docs), 0);
  if v_n = 0 then return new; end if;

  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, detail, escalation_level)
  values (new.organisation_id, new.patient_id, 'clinician_review', 'open',
          'Results uploaded before membership: review needed',
          format('This patient uploaded %s result document(s) while on the free plan; none has been reviewed. Review and record any clinical finding. (Uploading a file does not itself create a screening result.)', v_n),
          2)
  returning id into v_alert;

  -- enforce_lab_result_document_update keeps clinician_alert_id fixed after insert; this is the one sanctioned way to set it, and only
  -- while it is still empty (see the guard patch below).
  perform set_config('app.route_prior_uploads', 'on', true);
  update public.lab_result_documents set clinician_alert_id = v_alert where id = any (v_docs);
  perform set_config('app.route_prior_uploads', 'off', true);

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (new.organisation_id, null, 'membership.prior_uploads_routed_to_review', 'patient_memberships', new.id,
          jsonb_build_object('documents', v_n, 'clinician_alert_id', v_alert));
  return new;
end $$;


-- The guard that makes upload-time facts immutable also froze clinician_alert_id. Allow it to be set exactly once (while empty) and only
-- while private.route_prior_uploads_to_review_on_membership has flagged it, the same pattern the guard already uses for
-- app.result_document_replace. Spliced into the LIVE body so nothing else in the guard can drift.
do $$
declare
  v_def text := pg_get_functiondef('private.enforce_lab_result_document_update()'::regprocedure);
  v_old constant text := 'new.clinician_alert_id := old.clinician_alert_id;';
  v_new constant text := $n$if old.clinician_alert_id is not null or coalesce(current_setting('app.route_prior_uploads', true), '') <> 'on' then new.clinician_alert_id := old.clinician_alert_id; end if;$n$;
begin
  if position('app.route_prior_uploads' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'enforce_lab_result_document_update no longer freezes clinician_alert_id in the expected way; re-read it before editing';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end $$;

create trigger patient_memberships_route_prior_uploads
  after insert or update of state on public.patient_memberships
  for each row execute function private.route_prior_uploads_to_review_on_membership();

revoke all on function private.route_prior_uploads_to_review_on_membership() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'patient_memberships_route_prior_uploads' and tgenabled = 'O') then
    raise exception 'the membership continuity trigger was not created';
  end if;
  if position('app.route_prior_uploads' in pg_get_functiondef('private.enforce_lab_result_document_update()'::regprocedure)) = 0 then
    raise exception 'the document update guard was not patched';
  end if;
end $$;
