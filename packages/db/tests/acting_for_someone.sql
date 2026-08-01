-- Proves 20260801110000_acting_for_someone_you_support.sql.
--
-- Letting one person act inside another's record is only safe if two things
-- hold, and both are checked here:
--
--   1. Every entry says who actually made it, taken from auth.uid() and never
--      from the client. A record that cannot tell "my mother logged this" from
--      "my son logged this for her" is read by the red-flag engines and the
--      care team as the patient's own account of themselves.
--   2. A supporter may ADD to the record and never revise or remove it,
--      including their own earlier entries.
--
-- Note on shape: the role is switched with top-level `set local role`
-- statements rather than inside a DO block. Inside plpgsql the first statement
-- after the switch is planned before the new role is in effect and fails
-- spuriously, which cost real time to spot — every other RLS test in this
-- directory switches at statement level for the same reason.
--
--   npx supabase db query --linked -f packages/db/tests/acting_for_someone.sql

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on results to authenticated;
grant all on ids to authenticated;

insert into ids
select 'mum', id from public.profiles
 where id in (select id from auth.users where email = 'patient.complete.test@tarragon.test');
insert into ids
select 'supporter', id from public.profiles
 where id in (select id from auth.users where email = 'patient.diaspora.test@tarragon.test');
insert into ids
select 'viewer', id from public.profiles
 where id in (select id from auth.users where email = 'patient.free.test@tarragon.test');

insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
select (select v from ids where k='mum'), (select v from ids where k='supporter'), 'manage',
       (select v from ids where k='mum');
insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
select (select v from ids where k='mum'), (select v from ids where k='viewer'), 'view',
       (select v from ids where k='mum');

------------------------------------------------------------------
-- As the supporter ('manage')
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='supporter'), 'role','authenticated')::text, true);
set local role authenticated;

insert into results select 'can_act_for is true while the grant stands', 'true',
                           public.can_act_for((select v from ids where k='mum'))::text;

-- Logs a reading for her, and deliberately claims SHE entered it.
insert into public.vitals_readings
  (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at,
   logged_by_profile_id)
select '00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
       'blood_pressure', 150, 92, 'manual', now(), (select v from ids where k='mum');

-- Cannot revise or remove what is now in the record, including their own entry.
update public.vitals_readings set systolic = 120
 where patient_id = (select v from ids where k='mum') and systolic = 150;
delete from public.vitals_readings
 where patient_id = (select v from ids where k='mum') and systolic = 150;

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'a manage supporter can log a reading for them', 'true',
       exists(select 1 from public.vitals_readings
               where patient_id = (select v from ids where k='mum') and systolic = 150)::text;

insert into results
select 'the spoofed author is overwritten with the real one',
       (select v from ids where k='supporter')::text,
       logged_by_profile_id::text
  from public.vitals_readings
 where patient_id = (select v from ids where k='mum') and systolic = 150;

insert into results
select 'a supporter cannot revise their own entry', 'true',
       exists(select 1 from public.vitals_readings
               where patient_id = (select v from ids where k='mum') and systolic = 150)::text;

insert into results
select 'a supporter cannot delete their own entry', 'false',
       exists(select 1 from public.vitals_readings
               where patient_id = (select v from ids where k='mum') and systolic = 120)::text;

------------------------------------------------------------------
-- As the patient herself: her own entry is not falsely attributed
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='mum'), 'role','authenticated')::text, true);
set local role authenticated;

insert into public.vitals_readings
  (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
select '00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
       'blood_pressure', 128, 80, 'manual', now();

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'a reading the patient logged herself stays unattributed', 'true',
       (logged_by_profile_id is null)::text
  from public.vitals_readings
 where patient_id = (select v from ids where k='mum') and systolic = 128;

------------------------------------------------------------------
-- As a 'view' grantee: following is not acting
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='viewer'), 'role','authenticated')::text, true);
set local role authenticated;

insert into results select 'can_act_for is false for a view grantee', 'false',
                           public.can_act_for((select v from ids where k='mum'))::text;

do $$
begin
  insert into public.vitals_readings
    (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
  values ('00000000-0000-0000-0000-000000000001',
          (select v from ids where k='mum'), 'blood_pressure', 999, 999, 'manual', now());
  insert into results values ('a view grantee cannot log anything', 'blocked', 'allowed');
exception when others then
  insert into results values ('a view grantee cannot log anything', 'blocked', 'blocked');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Revoking ends it immediately, with no session to expire
------------------------------------------------------------------
update public.profile_access set permission_level = 'view'
 where profile_id = (select v from ids where k='mum')
   and grantee_user_id = (select v from ids where k='supporter');

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='supporter'), 'role','authenticated')::text, true);
set local role authenticated;
insert into results select 'downgrading the grant ends acting immediately', 'false',
                           public.can_act_for((select v from ids where k='mum'))::text;
reset role;
select set_config('request.jwt.claims', null, true);

select check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results;

rollback;
