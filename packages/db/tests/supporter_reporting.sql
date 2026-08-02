-- Proves 20260801120000_supporter_can_report_and_assess.sql.
--
-- The founder confirmed a family member should be able to raise a
-- danger-symptom alert for someone. That makes attribution clinical, not
-- cosmetic: a doctor answering a Priority-1 alert needs to know whether the
-- patient described their own chest pain or a relative described it for them,
-- because those are different pictures and lead to different first questions.
--
-- So the checks that matter here are not "can they write" but "does the alert
-- say who spoke", and "is the audit log pointing at the person who acted".
--
-- Role is switched with top-level `set local role` for the reason noted in
-- acting_for_someone.sql: inside plpgsql the first statement after the switch
-- is planned before the new role applies and fails spuriously.
--
--   npx supabase db query --linked -f packages/db/tests/supporter_reporting.sql

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on results to authenticated;
grant all on ids to authenticated;

insert into ids select 'mum', id from public.profiles
 where id in (select id from auth.users where email = 'patient.complete.test@tarragon.test');
insert into ids select 'supporter', id from public.profiles
 where id in (select id from auth.users where email = 'patient.diaspora.test@tarragon.test');

update public.profiles set full_name = 'Tunde Adeyemi' where id = (select v from ids where k='supporter');

-- Idempotent: a browser fixture may already have left a real grant here.
insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
select (select v from ids where k='mum'), (select v from ids where k='supporter'), 'manage',
       (select v from ids where k='mum')
on conflict (profile_id, grantee_user_id)
do update set permission_level = 'manage';

------------------------------------------------------------------
-- As the supporter, with her account open
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='supporter'), 'role','authenticated')::text, true);
set local role authenticated;

-- 1. Raise a danger-symptom emergency FOR her.
--    RETURNING deliberately, because that is what supabase-js
--    `.insert(...).select("id")` compiles to, and `insert ... returning` is
--    checked against the SELECT policy as well as the INSERT one. A plain
--    insert here would pass while the real button failed with an error that
--    names the wrong policy — which is exactly what happened once.
with raised as (
  insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail)
  select '00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
         'danger_symptom_checklist', 'Central chest pain for 20 minutes.'
  returning id
)
insert into results select 'the supporter can read back what they just reported', 'true',
                           (count(*) = 1)::text from raised;

-- 2. Log a hospital admission FOR her.
insert into public.patient_hospital_admissions
  (organisation_id, patient_id, admitted_on, facility_name, self_reported_diagnosis)
select '00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
       current_date - 2, 'Lagos General', 'chest pain';

-- 3. Answer a health question FOR her.
insert into public.risk_assessment_responses
  (organisation_id, profile_id, category, question_key, response)
select '00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
       'lifestyle', 'smokes', to_jsonb(false);

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- What the record now says
------------------------------------------------------------------
insert into results
select 'a supporter can raise a danger-symptom emergency', 'true',
       exists(select 1 from public.emergency_events
               where patient_id = (select v from ids where k='mum'))::text;

insert into results
select 'the emergency is attributed to the supporter', (select v from ids where k='supporter')::text,
       logged_by_profile_id::text from public.emergency_events
 where patient_id = (select v from ids where k='mum');

-- THE ONE THAT MATTERS: the doctor is told the patient did not describe it.
insert into results
select 'the Priority-1 alert names who actually reported it', 'true',
       (detail like '%Reported by Tunde Adeyemi on the patient''s behalf%')::text
  from public.clinician_alerts
 where patient_id = (select v from ids where k='mum') and level = 'emergency';

insert into results
select 'the admission alert no longer claims the patient said it', 'false',
       (detail like '%Self-reported by the patient%')::text
  from public.clinician_alerts
 where patient_id = (select v from ids where k='mum') and level = 'clinician_review';

insert into results
select 'the admission alert names the reporter instead', 'true',
       (detail like '%Tunde Adeyemi logged a hospital admission%')::text
  from public.clinician_alerts
 where patient_id = (select v from ids where k='mum') and level = 'clinician_review';

insert into results
select 'the audit log records who acted, not the patient',
       (select v from ids where k='supporter')::text,
       actor_id::text from public.audit_log
 where action = 'emergency_event.created'
   and (event->>'patient_id') = (select v from ids where k='mum')::text;

insert into results
select 'the health answer is attributed to the supporter', (select v from ids where k='supporter')::text,
       logged_by_profile_id::text from public.risk_assessment_responses
 where profile_id = (select v from ids where k='mum') and question_key = 'smokes';

------------------------------------------------------------------
-- Control: the patient doing it herself is NOT falsely attributed,
-- and the alert reads exactly as it always did.
------------------------------------------------------------------
delete from public.clinician_alerts where patient_id = (select v from ids where k='mum');
delete from public.emergency_events where patient_id = (select v from ids where k='mum');

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='mum'), 'role','authenticated')::text, true);
set local role authenticated;
insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail)
select '00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
       'danger_symptom_checklist', 'Central chest pain for 20 minutes.';
reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'her own report stays unattributed', 'true',
       (logged_by_profile_id is null)::text from public.emergency_events
 where patient_id = (select v from ids where k='mum');

insert into results
select 'her own alert does not name a third party', 'false',
       (detail like '%on the patient''s behalf%')::text
  from public.clinician_alerts
 where patient_id = (select v from ids where k='mum') and level = 'emergency';

------------------------------------------------------------------
-- Control: a 'view' grantee can do none of it
------------------------------------------------------------------
update public.profile_access set permission_level = 'view'
 where profile_id = (select v from ids where k='mum')
   and grantee_user_id = (select v from ids where k='supporter');

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='supporter'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail)
  values ('00000000-0000-0000-0000-000000000001',
          (select v from ids where k='mum'), 'danger_symptom_checklist', 'should never land');
  insert into results values ('a view grantee cannot raise an emergency', 'blocked', 'allowed');
exception when others then
  insert into results values ('a view grantee cannot raise an emergency', 'blocked', 'blocked');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

select check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results;

rollback;
