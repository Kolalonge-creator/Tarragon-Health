-- Tarragon Health
-- Read-access logging, first cut: a clinician opening a patient's full chart
--
-- 20260812030853_row_change_audit_triggers.sql closed the "who changed this row" gap but
-- said explicitly a trigger can't answer "who read this row." Checked live before building
-- this: pgaudit is a dead end on this Supabase tier — `create extension pgaudit` succeeds,
-- but `alter database postgres set pgaudit.log = 'read'` and even a bare
-- `select set_config('pgaudit.log', 'read', false)` both fail with
-- "permission denied to set parameter" under the `postgres` role (rolsuper = false here).
-- Making it work would need a Supabase support ticket for an instance-level config change,
-- not something achievable from this session — extension was created to test, then dropped.
--
-- The working alternative already exists in this codebase: analytics_log_patient_access
-- (20260718210323_analytics_patient_activity_rpcs.sql) logs an analyst's view of a patient's
-- activity via a SECURITY DEFINER RPC the app calls after the read. This migration applies
-- the same pattern to the single highest-value PHI read on the platform: a clinician/doctor
-- opening a patient's chart at /clinician/patients/[patientId].
--
-- Deliberately narrow scope: this covers ONE read path, not "all patient data reads" — that
-- would mean auditing dozens of call sites across apps/web, a materially larger and riskier
-- change than a single afternoon session should take on unreviewed. Extending this pattern to
-- other high-sensitivity read surfaces (the analyst console already has its own equivalent) is
-- a follow-up, tracked, not assumed done.

create or replace function public.log_patient_record_view(p_patient_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.profiles where id = p_patient_id;

  if v_org is null or not private.is_org_staff(v_org) then
    raise exception 'not authorised';
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, auth.uid(), 'clinician.patient_record_viewed', 'patient', p_patient_id, '{}'::jsonb);
end;
$$;

comment on function public.log_patient_record_view(uuid) is
  'Logs a clinician/doctor opening a patient''s full chart. Called from '
  'apps/web/src/app/(dashboard)/clinician/patients/[patientId]/page.tsx after confirming the '
  'patient exists and is in the caller''s org. See '
  '20260812034612_clinician_patient_record_view_audit.sql for why this exists instead of '
  'pgaudit-based read logging.';

revoke all on function public.log_patient_record_view(uuid) from public;
grant execute on function public.log_patient_record_view(uuid) to authenticated;
revoke execute on function public.log_patient_record_view(uuid) from anon;

-- Prove the ACL landed the way the grants above claim, not just that the grant statements ran —
-- this codebase has a real history of a function carrying a PUBLIC=X entry plus what looked like
-- a correct direct grant in the migration's own text, while still being executable by a role it
-- shouldn't have been (anon inherits EXECUTE through the PUBLIC pseudo-role, not a direct grant,
-- so `revoke ... from anon` alone does not close it — see the anon-EXECUTE note in CLAUDE.md).
do $$
begin
  if has_function_privilege('anon', 'public.log_patient_record_view(uuid)', 'EXECUTE') then
    raise exception 'log_patient_record_view is EXECUTE-able by anon — ACL did not land as intended';
  end if;
  if not has_function_privilege('authenticated', 'public.log_patient_record_view(uuid)', 'EXECUTE') then
    raise exception 'log_patient_record_view is NOT EXECUTE-able by authenticated — grant failed';
  end if;
end $$;
