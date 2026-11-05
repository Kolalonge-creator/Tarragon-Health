-- Audit rows can no longer name someone else as the actor (Tarragon 2.0 master architecture assessment, finding S2).
--
-- The problem. The only INSERT policy on public.audit_log was
--   audit_log_insert: actor_id = auth.uid() OR (organisation_id IS NOT NULL AND private.is_org_staff(organisation_id))
-- so any care-team staff member could write a row naming ANY actor_id (or none) in their organisation, through PostgREST, and a
-- patient could write rows of any action attributed to themselves. The table is append-only, so a forged row could never be
-- removed either. The audit log is only as good as the guarantee that its actor column is true.
--
-- Who writes audit_log today (checked 2026-11-05):
--   * 376 database functions, all SECURITY DEFINER (no SECURITY INVOKER function inserts into it), so no policy applies to them.
--   * 13 app call sites using the service-role client, so no policy applies to them.
--   * 3 app call sites using the caller's own session:
--       ai_coach.clinician_review_flagged (lib/ai-coach/graph.ts), patient.doctor_summary_requested
--       (lib/doctor-summary-pdf/load.ts), prescription.pdf_downloaded (lib/prescriptions/load-prescription-pdf-data.ts; the
--       patient, a caregiver with medication access, or a clinician through the audited read).
--
-- This migration, step 1 of 2:
--   1. private.write_client_audit_event(): the one validated writer for a signed-in caller. The actor is always auth.uid(). The
--      action must be one of the three, and each action fixes what the row may name:
--        patient.doctor_summary_requested  entity = the caller's own profile, subject = the caller.
--        ai_coach.clinician_review_flagged entity = an ai_conversations row of the caller's, no other subject.
--        prescription.pdf_downloaded       entity = a medications row of the subject; the subject is the caller, a patient the
--                                          caller may read medications for (can_read_clinical, both models), or a patient in
--                                          the organisation of a care-team caller (is_org_staff).
--      The organisation is the subject's when there is one (the patient whose record was read), else the caller's.
--   2. public.record_audit_event() writes one row; public.record_audit_events() writes several for one action in one transaction,
--      so a prescription bundle is audited all-or-nothing.
--   3. The direct INSERT policy is narrowed to actor_id = auth.uid(): forging another person's actor is closed now, and a deployed
--      build that still inserts directly (all three call sites wrote self-attributed rows) keeps working during the deploy.
-- Step 2 (a follow-up once this build is live) drops the direct INSERT policy and grant, so these functions are the only route.

-- 1. The validated writer -------------------------------------------------------------------------------------------------------
create or replace function private.write_client_audit_event(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_subject_patient_id uuid,
  p_event jsonb,
  p_result text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_org uuid;
  v_subject uuid := p_subject_patient_id;
  v_subject_org uuid;
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'record_audit_event needs a signed-in caller' using errcode = '42501';
  end if;

  select p.organisation_id into v_actor_org from public.profiles p where p.id = v_actor and p.is_active;
  if not found then
    raise exception 'record_audit_event: no active profile for the caller' using errcode = '42501';
  end if;

  if p_result is null or p_result not in ('success', 'denied', 'failed') then
    raise exception 'record_audit_event: result must be success, denied or failed' using errcode = '22023';
  end if;

  if p_action = 'patient.doctor_summary_requested' then
    v_subject := coalesce(v_subject, v_actor);
    if v_subject <> v_actor or p_entity_type is distinct from 'profiles' or p_entity_id is distinct from v_actor then
      raise exception 'record_audit_event: a doctor summary is recorded only on the caller''s own profile' using errcode = '42501';
    end if;

  elsif p_action = 'ai_coach.clinician_review_flagged' then
    if v_subject is not null and v_subject <> v_actor then
      raise exception 'record_audit_event: an assistant flag is recorded only about the caller' using errcode = '42501';
    end if;
    if p_entity_type is distinct from 'ai_conversations' or not exists (
      select 1 from public.ai_conversations c where c.id = p_entity_id and c.profile_id = v_actor
    ) then
      raise exception 'record_audit_event: not one of the caller''s assistant conversations' using errcode = '42501';
    end if;

  elsif p_action = 'prescription.pdf_downloaded' then
    v_subject := coalesce(v_subject, v_actor);
    if p_entity_type is distinct from 'medications' or not exists (
      select 1 from public.medications m where m.id = p_entity_id and m.patient_id = v_subject
    ) then
      raise exception 'record_audit_event: not a prescription of this patient' using errcode = '42501';
    end if;

  else
    raise exception 'record_audit_event: action % may not be recorded by a client', coalesce(p_action, '(null)')
      using errcode = '42501';
  end if;

  if v_subject is not null and v_subject <> v_actor then
    select p.organisation_id into v_subject_org from public.profiles p where p.id = v_subject;
    if v_subject_org is null or not (
      private.is_org_staff(v_subject_org)
      or private.can_read_clinical(v_subject, 'medications'::public.care_access_category)
      or private.can_read_clinical(v_subject, 'view_medication'::public.caregiver_permission)
    ) then
      raise exception 'record_audit_event: the caller may not record an event about this patient' using errcode = '42501';
    end if;
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, event, result)
  values (
    coalesce(v_subject_org, v_actor_org), v_actor, p_action, p_entity_type, p_entity_id, v_subject,
    coalesce(p_event, '{}'::jsonb), p_result
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function private.write_client_audit_event(text, text, uuid, uuid, jsonb, text) from public, anon, authenticated;

-- 2. The callable functions -----------------------------------------------------------------------------------------------------
create or replace function public.record_audit_event(
  p_action text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_subject_patient_id uuid default null,
  p_event jsonb default '{}'::jsonb,
  p_result text default 'success'
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.write_client_audit_event(p_action, p_entity_type, p_entity_id, p_subject_patient_id, p_event, p_result);
$$;

comment on function public.record_audit_event(text, text, uuid, uuid, jsonb, text) is
  'The one way a signed-in caller writes an audit_log row: actor = auth.uid(); allowlisted actions, each fixing which entity '
  'and subject the row may name; organisation = the subject''s (else the caller''s). See private.write_client_audit_event.';

create or replace function public.record_audit_events(p_action text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_count integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'record_audit_events: p_rows must be a non-empty array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 200 then
    raise exception 'record_audit_events: at most 200 rows at once' using errcode = '22023';
  end if;
  -- One function call is one transaction: any refused row raises and none of the rows is written.
  for v_row in select value from jsonb_array_elements(p_rows) loop
    perform private.write_client_audit_event(
      p_action,
      v_row ->> 'entity_type',
      (v_row ->> 'entity_id')::uuid,
      (v_row ->> 'subject_patient_id')::uuid,
      coalesce(v_row -> 'event', '{}'::jsonb),
      coalesce(v_row ->> 'result', 'success')
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function public.record_audit_events(text, jsonb) is
  'Writes several audit_log rows for one action, all or none, each through private.write_client_audit_event.';

revoke all on function public.record_audit_event(text, text, uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.record_audit_event(text, text, uuid, uuid, jsonb, text) to authenticated, service_role;
revoke all on function public.record_audit_events(text, jsonb) from public, anon;
grant execute on function public.record_audit_events(text, jsonb) to authenticated, service_role;

-- 3. Narrow the direct insert ---------------------------------------------------------------------------------------------------
drop policy if exists audit_log_insert on public.audit_log;

create policy audit_log_insert_self_only on public.audit_log
  for insert to authenticated
  with check (actor_id = (select auth.uid()));

comment on policy audit_log_insert_self_only on public.audit_log is
  'Transitional (2026-11-05): a direct insert may only name the caller as actor. Dropped in step 2 once every session '
  'call site uses public.record_audit_event() / record_audit_events().';

-- 4. Self-check -----------------------------------------------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'audit_log' and cmd in ('INSERT', 'ALL')
      and policyname <> 'audit_log_insert_self_only'
  ) then
    raise exception 'audit_log still has another INSERT policy';
  end if;
  if has_function_privilege('anon', 'public.record_audit_event(text, text, uuid, uuid, jsonb, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_audit_events(text, jsonb)', 'EXECUTE') then
    raise exception 'anon can execute an audit writer';
  end if;
  if has_function_privilege('authenticated', 'private.write_client_audit_event(text, text, uuid, uuid, jsonb, text)', 'EXECUTE') then
    raise exception 'authenticated can call the private writer directly';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and not p.prosecdef
      and p.prosrc ~* 'insert\s+into\s+(public\.)?audit_log'
  ) then
    raise exception 'a SECURITY INVOKER function inserts into audit_log; it would now be bound by the self-only policy';
  end if;
end;
$$;
