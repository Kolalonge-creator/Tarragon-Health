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
--   * 3 app call sites using the caller's own session, each writing a row about the caller themself:
--       ai_coach.clinician_review_flagged (lib/ai-coach/graph.ts), patient.doctor_summary_requested
--       (lib/doctor-summary-pdf/load.ts), prescription.pdf_downloaded (lib/prescriptions/load-prescription-pdf-data.ts).
--
-- This migration, step 1 of 2:
--   1. public.record_audit_event(): the one way a signed-in caller writes an audit row. The actor is always auth.uid(), the
--      organisation is always the caller's own, the action must be on a short allowlist, and a subject patient other than the
--      caller must be someone the caller's care-team role covers. The three session call sites move to it in the same PR.
--   2. The direct INSERT policy is narrowed to actor_id = auth.uid(): the forgery of another person's actor is closed now, and a
--      deployed build that still inserts directly (the three call sites, all self-attributed) keeps working during the deploy.
-- Step 2 (a follow-up migration once this build is live) drops the direct INSERT policy and the INSERT grant entirely, so the
-- function is the only route.

-- 1. The writer -----------------------------------------------------------------------------------------------------------------
create or replace function public.record_audit_event(
  p_action text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_subject_patient_id uuid default null,
  p_event jsonb default '{}'::jsonb,
  p_result text default 'success'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_org uuid;
  v_subject_org uuid;
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'record_audit_event needs a signed-in caller' using errcode = '42501';
  end if;

  -- Only actions a signed-in caller legitimately records about their own activity. Everything else is written by the
  -- definer function or service-role code that performs the action, never asserted by the client.
  if p_action is null or p_action not in (
    'ai_coach.clinician_review_flagged',
    'patient.doctor_summary_requested',
    'prescription.pdf_downloaded'
  ) then
    raise exception 'record_audit_event: action % may not be recorded by a client', coalesce(p_action, '(null)')
      using errcode = '42501';
  end if;

  if p_result is null or p_result not in ('success', 'denied', 'failed') then
    raise exception 'record_audit_event: result must be success, denied or failed' using errcode = '22023';
  end if;

  select p.organisation_id into v_org from public.profiles p where p.id = v_actor and p.is_active;
  if not found then
    raise exception 'record_audit_event: no active profile for the caller' using errcode = '42501';
  end if;

  if p_subject_patient_id is not null and p_subject_patient_id <> v_actor then
    select p.organisation_id into v_subject_org from public.profiles p where p.id = p_subject_patient_id;
    if v_subject_org is null or not private.is_org_staff(v_subject_org) then
      raise exception 'record_audit_event: the caller may not record an event about this patient' using errcode = '42501';
    end if;
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, event, result)
  values (v_org, v_actor, p_action, p_entity_type, p_entity_id, p_subject_patient_id, coalesce(p_event, '{}'::jsonb), p_result)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.record_audit_event(text, text, uuid, uuid, jsonb, text) is
  'The one way a signed-in caller writes an audit_log row: actor = auth.uid(), organisation = the caller''s own, allowlisted '
  'actions only, and a subject patient other than the caller must be covered by the caller''s care-team role.';

revoke all on function public.record_audit_event(text, text, uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.record_audit_event(text, text, uuid, uuid, jsonb, text) to authenticated, service_role;

-- 2. Narrow the direct insert ---------------------------------------------------------------------------------------------------
drop policy if exists audit_log_insert on public.audit_log;

create policy audit_log_insert_self_only on public.audit_log
  for insert to authenticated
  with check (actor_id = (select auth.uid()));

comment on policy audit_log_insert_self_only on public.audit_log is
  'Transitional (2026-11-05): a direct insert may only name the caller as actor. Dropped in step 2 once every session '
  'call site uses public.record_audit_event().';

-- 3. Self-check -----------------------------------------------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'audit_log' and cmd in ('INSERT', 'ALL')
      and policyname <> 'audit_log_insert_self_only'
  ) then
    raise exception 'audit_log still has another INSERT policy';
  end if;
  if has_function_privilege('anon', 'public.record_audit_event(text, text, uuid, uuid, jsonb, text)', 'EXECUTE') then
    raise exception 'anon can execute record_audit_event';
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
