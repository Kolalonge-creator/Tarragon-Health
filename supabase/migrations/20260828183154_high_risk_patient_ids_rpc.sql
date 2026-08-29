-- Tarragon Health — high-risk patient roster filter (Care Team / Provider Workspace §5.4)
--
-- The clinician patient list needs a "High-risk" filter. prevention_risk_scores
-- (20260706084905_prevention_risk_assessment.sql) is one row per (profile_id,
-- condition) snapshot, not one row per patient — the same "latest per group"
-- shape patient_monitoring_latest_readings already solved for vitals, so this
-- follows that established RPC pattern rather than trying to express
-- latest-per-condition in a plain PostgREST query (Supabase JS has no
-- DISTINCT ON). Read-only, additive, no schema change.
--
-- Scoping: no org parameter — private.is_org_staff(organisation_id) is
-- evaluated per candidate row inside the function, same shape as
-- analytics_doctor_performance's per-row gating, so a caller only ever sees
-- patients in an org they actually have staff access to (naturally correct
-- even for a caller with staff rows in more than one org).

-- Tarragon Health — high-risk patient roster filter (Care Team / Provider
-- Workspace §5.4). Committed to git but never actually applied to
-- production. Content byte-identical to the committed
-- 20260827203219_high_risk_patient_ids_rpc.sql.

create or replace function public.high_risk_patient_ids()
returns table (patient_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct latest.profile_id
  from (
    select distinct on (profile_id, condition) profile_id, condition, tier
    from public.prevention_risk_scores
    where private.is_org_staff(organisation_id)
    order by profile_id, condition, computed_at desc
  ) latest
  where tier in ('high', 'very_high');
$$;

comment on function public.high_risk_patient_ids() is
  'Patients whose latest risk tier, for any prevention condition, is high or very_high. '
  'Backs the clinician patient list''s "High-risk" filter (Care Team / Provider Workspace §5.4).';

revoke all on function public.high_risk_patient_ids() from public;
grant execute on function public.high_risk_patient_ids() to authenticated;
revoke execute on function public.high_risk_patient_ids() from anon;

do $$
begin
  if has_function_privilege('anon', 'public.high_risk_patient_ids()', 'EXECUTE') then
    raise exception 'high_risk_patient_ids is EXECUTE-able by anon — ACL did not land as intended';
  end if;
  if not has_function_privilege('authenticated', 'public.high_risk_patient_ids()', 'EXECUTE') then
    raise exception 'high_risk_patient_ids is NOT EXECUTE-able by authenticated — grant failed';
  end if;
end $$;
