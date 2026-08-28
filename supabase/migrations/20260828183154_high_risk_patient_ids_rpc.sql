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
