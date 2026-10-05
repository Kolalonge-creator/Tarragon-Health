-- S07 (OQ-80, option a): a read-only function that returns the home blood
-- pressure target the SERVER uses for the signed-in patient, so the app can show
-- the same number the "above target" alerts are decided against.
--
-- Why: private.handle_bp_reading_red_flag() decides "above target" against
-- private.patient_home_bp_target(): the care team's explicit row in
-- patient_bp_targets if there is one, otherwise a derived default (135/85, or
-- 130/80 when the patient has an active diabetes, ckd, cardiovascular or
-- heart_failure care plan). A patient cannot call anything in the private schema
-- and, with no explicit row (live has none today), cannot see the derived number.
-- Showing her a different target than the alert uses could say "not above" about a
-- reading a clinician was just alerted to.
--
-- What it returns, for the CALLER only (auth.uid(); there is no argument, so it
-- cannot be pointed at another patient):
--   systolic, diastolic  the target the server uses
--   source               'explicit'              a care team row with a clinician recorded
--                        'explicit_unattributed' a row whose set_by was cleared (the clinician's
--                                                record was deleted); still the target the server
--                                                uses, but not presented as set by the care team
--                        'derived_standard'      the standard starting target (135/85)
--                        'derived_high_risk'     the higher-risk starting target (130/80)
--   set_at               when the care team's row was last updated, or null
--
-- Read-only, SECURITY DEFINER with an empty search_path, EXECUTE for authenticated
-- only (revoked from PUBLIC and anon). No table, policy, trigger or existing
-- function changes. Live checked 2026-10-05: no object named my_home_bp_target,
-- private.patient_home_bp_target matches 20260720020150, patient_bp_targets has 0
-- rows, and the two newest live migrations (20261004194229, 20261004210421) are on
-- main-dev.

create or replace function public.my_home_bp_target()
returns table (systolic smallint, diastolic smallint, source text, set_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.systolic,
    t.diastolic,
    case
      when t.source = 'explicit' and b.id is null then 'explicit_unattributed'
      else t.source
    end as source,
    b.updated_at as set_at
  from private.patient_home_bp_target((select auth.uid())) t
  left join public.patient_bp_targets b
    on b.patient_id = (select auth.uid())
   and b.set_by is not null
  where (select auth.uid()) is not null;
$$;

comment on function public.my_home_bp_target() is
  'The home blood pressure target the server uses for the signed-in patient (explicit, or the derived starting target), with where it came from. Read-only; caller only.';

revoke all on function public.my_home_bp_target() from public;
revoke all on function public.my_home_bp_target() from anon;
grant execute on function public.my_home_bp_target() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.my_home_bp_target()', 'EXECUTE') then
    raise exception 'anon can execute my_home_bp_target';
  end if;
  if not has_function_privilege('authenticated', 'public.my_home_bp_target()', 'EXECUTE') then
    raise exception 'authenticated cannot execute my_home_bp_target';
  end if;
  if exists (select 1 from pg_proc p where p.oid = 'public.my_home_bp_target()'::regprocedure and not p.prosecdef) then
    raise exception 'my_home_bp_target must be security definer';
  end if;
end $$;
