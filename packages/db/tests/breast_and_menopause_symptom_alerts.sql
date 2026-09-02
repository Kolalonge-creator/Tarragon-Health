-- Tarragon Health
-- Live proof for 20260829121138_breast_symptom_reports.sql and
-- 20260829121140_menopause_symptom_logs.sql.
--
-- Break on purpose to confirm this test discriminates:
--   1. Remove `new.clinician_alert_id := v_alert_id;` from
--      handle_breast_symptom_report -- case 1 must FAIL (alert_id stays null).
--   2. Change menopause's `if new.postmenopausal_bleeding then` to only ever
--      fire on symptom_types instead -- case 3 must FAIL.
--
-- Run: npx supabase db query --linked -f packages/db/tests/breast_and_menopause_symptom_alerts.sql
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
-- Case 1: reporting a breast symptom always raises a clinical alert
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient_a'), 'role','authenticated')::text, true);
set local role authenticated;

insert into public.breast_symptom_reports
  (organisation_id, patient_id, symptom_types, laterality)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='patient_a'), array['lump']::public.breast_symptom_type[], 'left');

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'a breast symptom report has a clinician_alert_id attached', 'true',
       (clinician_alert_id is not null)::text
  from public.breast_symptom_reports
 where patient_id = (select v from ids where k='patient_a')
 order by created_at desc limit 1;

insert into results
select 'the linked alert is category clinical / symptom_escalation', 'true',
       exists(
         select 1 from public.clinician_alerts ca
         join public.breast_symptom_reports bsr on bsr.clinician_alert_id = ca.id
         where bsr.patient_id = (select v from ids where k='patient_a')
           and ca.category = 'clinical' and ca.type_code = 'symptom_escalation'
       )::text;

------------------------------------------------------------------
-- Case 2: patient B cannot read patient A's breast symptom report
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient_b'), 'role','authenticated')::text, true);
set local role authenticated;

insert into results
select 'patient B cannot read patient A''s breast symptom reports', 'true',
       (not exists(
         select 1 from public.breast_symptom_reports where patient_id = (select v from ids where k='patient_a')
       ))::text;

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Case 3: postmenopausal bleeding always raises an alert, even with no
-- other symptom_types selected
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient_a'), 'role','authenticated')::text, true);
set local role authenticated;

insert into public.menopause_symptom_logs
  (organisation_id, patient_id, symptom_types, postmenopausal_bleeding)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='patient_a'), '{}', true);

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'postmenopausal bleeding always raises a clinician_review alert', 'true',
       exists(
         select 1 from public.clinician_alerts
          where patient_id = (select v from ids where k='patient_a')
            and title = 'Postmenopausal bleeding reported'
       )::text;

------------------------------------------------------------------
-- Case 4: an ordinary menopause symptom log with no bleeding does NOT
-- raise an alert (the trigger must not over-fire)
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient_a'), 'role','authenticated')::text, true);
set local role authenticated;

insert into public.menopause_symptom_logs
  (organisation_id, patient_id, symptom_types, postmenopausal_bleeding)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='patient_a'), array['hot_flashes']::public.menopause_symptom_type[], false);

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'an ordinary symptom log with no bleeding has no clinician_alert_id', 'true',
       (clinician_alert_id is null)::text
  from public.menopause_symptom_logs
 where patient_id = (select v from ids where k='patient_a') and not postmenopausal_bleeding
 order by created_at desc limit 1;

------------------------------------------------------------------
-- Case 5: anon has no access
------------------------------------------------------------------
insert into results
select 'anon has no table privilege on breast_symptom_reports', 'false',
       has_table_privilege('anon', 'public.breast_symptom_reports', 'SELECT')::text;
insert into results
select 'anon has no table privilege on menopause_symptom_logs', 'false',
       has_table_privilege('anon', 'public.menopause_symptom_logs', 'SELECT')::text;

select check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results;

rollback;
