-- Tarragon Health
-- Live proof for 20260829121133_menstrual_cycle_tracking_and_symptom_alerts.sql.
--
-- Two things worth breaking on purpose to confirm this test discriminates:
--   1. Comment out the `heavy_count >= 2` branch in
--      handle_menstrual_cycle_log_alert -- case 3 below must FAIL.
--   2. Drop the `patient_id = (select auth.uid())` clause from
--      menstrual_cycle_logs_select -- case 2 (cross-patient read denial)
--      must FAIL instead of correctly finding zero rows.
--
-- Run: npx supabase db query --linked -f packages/db/tests/menstrual_cycle_logs_and_pattern_alerts.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on results to authenticated;
grant all on ids to authenticated;

insert into ids
select 'patient_a', id from public.profiles
 where id in (select id from auth.users where email = 'patient.complete.test@tarragon.test');
insert into ids
select 'patient_b', id from public.profiles
 where id in (select id from auth.users where email = 'patient.diaspora.test@tarragon.test');

------------------------------------------------------------------
-- Case 1: patient A logs her own periods
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient_a'), 'role','authenticated')::text, true);
set local role authenticated;

insert into public.menstrual_cycle_logs
  (organisation_id, patient_id, period_start_date, flow_level, pain_level)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='patient_a'),
   current_date - 60, 'heavy', 9);

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'patient A can log her own period', 'true',
       exists(
         select 1 from public.menstrual_cycle_logs
          where patient_id = (select v from ids where k='patient_a') and period_start_date = current_date - 60
       )::text;

------------------------------------------------------------------
-- Case 2: patient B cannot read patient A's logs (cross-patient isolation)
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient_b'), 'role','authenticated')::text, true);
set local role authenticated;

insert into results
select 'patient B cannot read patient A''s cycle logs', 'true',
       (not exists(
         select 1 from public.menstrual_cycle_logs where patient_id = (select v from ids where k='patient_a')
       ))::text;

-- Sabotage check: patient B cannot insert a log attributed to patient A either.
do $$
begin
  insert into public.menstrual_cycle_logs
    (organisation_id, patient_id, period_start_date)
  values
    ('00000000-0000-0000-0000-000000000001', (select v from ids where k='patient_a'), current_date);
  insert into results values ('patient B cannot log a period for patient A', 'blocked', 'allowed');
exception when others then
  insert into results values ('patient B cannot log a period for patient A', 'blocked', 'blocked');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Case 3: heavy-flow pattern alert fires on the 2nd of 2 heavy periods
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient_a'), 'role','authenticated')::text, true);
set local role authenticated;

insert into public.menstrual_cycle_logs
  (organisation_id, patient_id, period_start_date, flow_level)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='patient_a'),
   current_date - 30, 'heavy');

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'a 2nd heavy-flow log raises a clinician_review alert', 'true',
       exists(
         select 1 from public.clinician_alerts
          where patient_id = (select v from ids where k='patient_a')
            and type_code = 'symptom_escalation'
            and title = 'Possible heavy menstrual bleeding pattern'
       )::text;

------------------------------------------------------------------
-- Case 4: anon has no access at all
------------------------------------------------------------------
insert into results
select 'anon has no table privilege on menstrual_cycle_logs', 'false',
       has_table_privilege('anon', 'public.menstrual_cycle_logs', 'SELECT')::text;

select check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results;

rollback;
