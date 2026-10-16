-- S46c part 1: the yearly Health Report sign-off is an S16 clinical task (founder instruction, 2026-10-07). Not applied to production by the author.
--
-- Before: a draft was assigned to the patient's care-team doctor (health_reports.assigned_clinician_id) and listed on a page; a doctor with no
-- care-team link could not see it and a patient with nobody assigned left the draft waiting unseen (OQ-S46-7).
-- Now: a draft creates one clinical_tasks row of type health_report_signoff. The queue does the routing (offered to the named clinician or an
-- employed doctor, then the pool, an atomic claim through queue_next, a hand-back through queue_handback, a claim timeout, an audit line and the
-- versioned task type). Signing needs the signing doctor to hold the live claim, and closes the task as completed. A correction opens a new task.
-- Sign-off authority is unchanged: only a doctor (never a care coordinator, never the AI) signs, INV-11.
--
-- The task type is NEW and UNCONFIRMED. Priority class 8, due in 7 days, lead window 1 day, claim timeout 60 minutes, minimum tier medical officer
-- are PROPOSED values held in this versioned row for the CMO to confirm (OQ-S46-11). Like pharmacy_flag_review it is deliberately NOT
-- needs_confirmation: a row waiting for confirmation blocks approve_triage_rule_set, and no triage rule creates this task.
--
-- A task row holds ids and neutral facts only (INV-07): the type code is neutral and the outcome says only that a report was signed.

insert into public.task_types
  (code, version, priority_class, default_due_minutes, min_doctor_tier, required_competencies,
   lead_window_minutes, claim_timeout_minutes, pushable, creatable, source_task_keys, note) values
  ('health_report_signoff', 1, 8, 10080, 'senior_medical_officer', '{}', 1440, 60, true, true, '{}',
   'S46c UNCONFIRMED: a yearly Health Report draft waits for a doctor to read and sign it. PROPOSED class, due time, tier and windows for the CMO to confirm (OQ-S46-11). Never created by a triage rule.');

alter table public.health_reports add column signoff_task_id uuid references public.clinical_tasks (id) on delete set null;
create index health_reports_signoff_task_idx on public.health_reports (signoff_task_id) where signoff_task_id is not null;
comment on column public.health_reports.signoff_task_id is 'S46c: the clinical_tasks row that routes this draft to a doctor. assigned_clinician_id is no longer used for routing and stays null on new rows.';

-- ---------------------------------------------------------------------------
-- Creating and closing the task
-- ---------------------------------------------------------------------------
create function private.open_report_signoff_task(p_report uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare r public.health_reports%rowtype; v_task uuid;
begin
  select * into r from public.health_reports where id = p_report;
  if not found or r.status <> 'pending_signature' then return null; end if;
  -- one live task per draft: a repeat merges into it (create_clinical_task counts the merge)
  v_task := private.create_clinical_task(r.patient_id, 'health_report_signoff', null, 'health_report:' || r.id, null, null, null, '{}');
  update public.health_reports set signoff_task_id = v_task where id = r.id and status = 'pending_signature';
  return v_task;
end $$;
revoke all on function private.open_report_signoff_task(uuid) from public, anon, authenticated;

-- Finishes the claim the signing doctor holds. Mirrors public.queue_complete (S17) without the console flow around it.
create function private.close_report_signoff_task(p_task uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare t public.clinical_tasks%rowtype; c public.task_claims%rowtype;
begin
  select * into t from public.clinical_tasks where id = p_task;
  if not found or t.state <> 'claimed' or t.claimed_by is distinct from p_actor then return; end if;
  select * into c from public.task_claims where task_id = p_task and clinician_id = p_actor and ended_at is null for update;
  if found then update public.task_claims set ended_at = now(), end_reason = 'completed' where id = c.id; end if;
  perform private.apply_task_transition(t.id, 'completed', 'clinician', p_actor, 'report signed', null, null, jsonb_build_object('health_report', 'signed'));
  perform private.reliability_event(p_actor, t.id, case when now() <= t.due_at then 'completed_on_time' else 'completed_late' end);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (t.organisation_id, p_actor, 'queue.complete', 'clinical_task', t.id, jsonb_build_object('type', t.type), t.patient_id);
  perform private.emit_domain_event('clinical_task.completed', t.organisation_id,
    jsonb_build_object('task_id', t.id, 'type', t.type), 'clinical_task.completed:' || t.id, t.patient_id, 'clinical_task', t.id);
end $$;
revoke all on function private.close_report_signoff_task(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The draft writer now opens the task (still service role only, still behind the guard)
-- ---------------------------------------------------------------------------
create or replace function public.record_health_report_draft(p_patient uuid, p_year integer, p_inputs jsonb, p_composed jsonb, p_priorities jsonb, p_ai_draft text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_prof public.profiles%rowtype; v_cfg uuid; v_id uuid; v_ver integer; v_risk uuid;
begin
  select * into v_prof from public.profiles where id = p_patient;
  if not found or v_prof.organisation_id is null or v_prof.role <> 'patient' then raise exception 'patient_not_found' using errcode = '22023'; end if;
  if not private.go_live_open_patient('health_report_generation_enabled', p_patient) then
    raise exception 'not_live: yearly report generation is not switched on' using errcode = 'P0001';
  end if;
  select id into v_cfg from public.health_report_config_versions where is_active and approved_by is not null limit 1;
  if v_cfg is null and coalesce(v_prof.is_test, false) then select id into v_cfg from public.health_report_config_versions order by version desc limit 1; end if;
  if v_cfg is null then raise exception 'not_live: the report settings are not signed' using errcode = 'P0001'; end if;
  if exists (select 1 from public.health_reports where patient_id = p_patient and year = p_year and status = 'pending_signature') then
    raise exception 'draft_already_waiting_for_signature' using errcode = '23505';
  end if;
  select coalesce(max(version), 0) + 1 into v_ver from public.health_reports where patient_id = p_patient and year = p_year;
  v_risk := nullif(p_inputs -> 'risk' ->> 'instrumentVersionId', '')::uuid;
  insert into public.health_reports (organisation_id, patient_id, year, version, config_version_id, risk_instrument_version_id, inputs, composed, priorities,
                                     ai_draft, source, is_test)
    values (v_prof.organisation_id, p_patient, p_year, v_ver, v_cfg, v_risk, p_inputs, p_composed, coalesce(p_priorities, '[]'::jsonb),
            p_ai_draft, 'system', coalesce(v_prof.is_test, false))
    returning id into v_id;
  perform private.open_report_signoff_task(v_id);
  perform private.emit_domain_event('health_report.generated', v_prof.organisation_id, jsonb_build_object('health_report_id', v_id),
      'health_report.generated:' || v_id, p_patient, 'health_report', v_id);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- The doctor's side: the queue lists the reports whose task is mine; reading a draft needs the task; signing needs the claim
-- ---------------------------------------------------------------------------
drop function public.clinician_health_report_queue();
create function public.clinician_health_report_queue()
returns table (id uuid, patient_id uuid, year integer, version integer, created_at timestamptz, is_correction boolean, task_id uuid, task_state text, due_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_signing_clinician() then raise exception 'not_authorised' using errcode = '42501'; end if;
  perform private.log_audit('health_report.queue_read', 'health_reports', null, '{}'::jsonb);
  return query select r.id, r.patient_id, r.year, r.version, r.created_at, r.supersedes_id is not null, t.id, t.state::text, t.due_at
    from public.health_reports r
    join public.clinical_tasks t on t.id = r.signoff_task_id
   where r.status = 'pending_signature'
     and private.task_is_mine(t.pushed_to, t.claimed_by, t.lead_clinician_id, t.state)
   order by t.priority_class, t.due_at, r.created_at;
end $$;
revoke all on function public.clinician_health_report_queue() from public, anon;
grant execute on function public.clinician_health_report_queue() to authenticated;

create or replace function public.clinician_get_health_report(p_id uuid) returns public.health_reports
language plpgsql security definer set search_path = ''
as $$
declare r public.health_reports%rowtype; v_ok boolean;
begin
  select * into r from public.health_reports where id = p_id;
  if not found or not private.is_signing_clinician() then
    raise exception 'not_authorised: no active task or lead assignment for this patient' using errcode = '42501';
  end if;
  if r.status = 'pending_signature' then
    -- a draft is read only through its own sign-off task (offered to me, or claimed by me)
    select exists (select 1 from public.clinical_tasks t where t.id = r.signoff_task_id
                    and private.task_is_mine(t.pushed_to, t.claimed_by, t.lead_clinician_id, t.state)) into v_ok;
  else
    v_ok := private.clinician_has_patient_access(r.patient_id);
  end if;
  if not v_ok then raise exception 'not_authorised: no active task or lead assignment for this patient' using errcode = '42501'; end if;
  perform private.log_audit('health_report.read', 'profiles', r.patient_id, jsonb_build_object('health_report_id', p_id));
  return r;
end $$;

create or replace function public.sign_health_report(p_id uuid, p_summary text, p_summary_source text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare r public.health_reports%rowtype; v_staff public.clinical_staff%rowtype; t public.clinical_tasks%rowtype;
begin
  select * into r from public.health_reports where id = p_id;
  if not found then raise exception 'report_not_found' using errcode = '22023'; end if;
  select * into v_staff from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier <> 'care_coordinator' limit 1;
  if v_staff.id is null or not private.clinician_has_patient_access(r.patient_id) then
    raise exception 'not_authorised: only the doctor holding this sign-off task can sign' using errcode = '42501';
  end if;
  if r.status <> 'pending_signature' then raise exception 'not_waiting_for_signature' using errcode = '22023'; end if;
  select * into t from public.clinical_tasks where id = r.signoff_task_id;
  if t.id is null or t.state <> 'claimed' or t.claimed_by is distinct from (select auth.uid()) or t.claim_expires_at is null or t.claim_expires_at <= now() then
    raise exception 'not_authorised: take this task from the queue before signing' using errcode = '42501';
  end if;
  if btrim(coalesce(p_summary, '')) = '' or length(p_summary) > 2000 then raise exception 'summary_required' using errcode = '22023'; end if;
  if p_summary_source not in ('template', 'clinician', 'clinician_edited_ai_draft') then raise exception 'unknown_summary_source' using errcode = '22023'; end if;
  if btrim(coalesce(v_staff.credential_number, '')) = '' then raise exception 'registration_number_required' using errcode = '22023'; end if;
  perform private.health_report_assert_honest('{}'::jsonb, jsonb_build_object('items', '[]'::jsonb, 'summary', p_summary), '[]'::jsonb);
  update public.health_reports set status = 'superseded'
   where patient_id = r.patient_id and year = r.year and status = 'signed' and id <> p_id;
  update public.health_reports set status = 'signed', signed_by = v_staff.id, signed_at = now(), signer_name = v_staff.full_name,
         signer_registration = v_staff.credential_number, summary_text = btrim(p_summary), summary_source = p_summary_source, ai_draft = null,
         recorded_by = (select auth.uid())
   where id = p_id;
  perform private.close_report_signoff_task(t.id, (select auth.uid()));
  perform private.log_audit('health_report.signed', 'profiles', r.patient_id, jsonb_build_object('health_report_id', p_id, 'version', r.version));
  perform private.emit_domain_event('health_report.signed', r.organisation_id, jsonb_build_object('health_report_id', p_id),
      'health_report.signed:' || p_id, r.patient_id, 'health_report', p_id);
  return p_id;
end $$;

-- A correction is a new version with a visible note and its own sign-off task. The old signed version stays visible until the new one is signed.
create or replace function public.correct_health_report(p_id uuid, p_note text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare r public.health_reports%rowtype; v_new uuid; v_ver integer;
begin
  select * into r from public.health_reports where id = p_id;
  if not found then raise exception 'report_not_found' using errcode = '22023'; end if;
  if not private.is_signing_clinician() or not private.clinician_has_patient_access(r.patient_id) then
    raise exception 'not_authorised: only a doctor with this patient on their list can correct a report' using errcode = '42501';
  end if;
  if r.status <> 'signed' then raise exception 'only_a_signed_report_is_corrected' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'correction_note_required' using errcode = '22023'; end if;
  if exists (select 1 from public.health_reports where patient_id = r.patient_id and year = r.year and status = 'pending_signature') then
    raise exception 'draft_already_waiting_for_signature' using errcode = '23505';
  end if;
  select max(version) + 1 into v_ver from public.health_reports where patient_id = r.patient_id and year = r.year;
  insert into public.health_reports (organisation_id, patient_id, year, version, config_version_id, risk_instrument_version_id, inputs, composed, priorities,
                                     supersedes_id, correction_note, source, recorded_by, is_test)
    values (r.organisation_id, r.patient_id, r.year, v_ver, r.config_version_id, r.risk_instrument_version_id, r.inputs, r.composed, r.priorities,
            r.id, btrim(p_note), 'clinician', (select auth.uid()), r.is_test)
    returning id into v_new;
  perform private.open_report_signoff_task(v_new);
  perform private.log_audit('health_report.correction_opened', 'profiles', r.patient_id, jsonb_build_object('health_report_id', v_new, 'supersedes', r.id));
  perform private.emit_domain_event('health_report.generated', r.organisation_id, jsonb_build_object('health_report_id', v_new),
      'health_report.generated:' || v_new, r.patient_id, 'health_report', v_new);
  return v_new;
end $$;

-- Drafts that already wait with no task (none exist where the guard has never been on) get one now.
do $$
declare x record;
begin
  for x in select id from public.health_reports where status = 'pending_signature' and signoff_task_id is null loop
    perform private.open_report_signoff_task(x.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.task_types where code = 'health_report_signoff' and is_active and creatable and not needs_confirmation) then
    raise exception 'S46c: the sign-off task type is missing';
  end if;
  if exists (select 1 from public.health_reports where status = 'pending_signature' and signoff_task_id is null) then
    raise exception 'S46c: a waiting draft has no sign-off task';
  end if;
  if has_function_privilege('anon', 'public.clinician_health_report_queue()', 'EXECUTE') or has_function_privilege('anon', 'public.sign_health_report(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.correct_health_report(uuid,text)', 'EXECUTE') or has_function_privilege('anon', 'public.clinician_get_health_report(uuid)', 'EXECUTE') then
    raise exception 'S46c: a report function is open to anon';
  end if;
  if has_function_privilege('authenticated', 'private.open_report_signoff_task(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'private.close_report_signoff_task(uuid,uuid)', 'EXECUTE') then
    raise exception 'S46c: a sign-off task helper is callable by a session';
  end if;
end $$;
