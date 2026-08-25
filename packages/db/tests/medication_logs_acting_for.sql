-- Proves 20260809232718_medication_logs_acting_for.sql.
--
-- medication_logs differs from vitals_readings/symptoms in one deliberate
-- way: a supporter IS allowed to update a row, but only one they themselves
-- logged (same-day dose-toggle correction), never the patient's own entry
-- or another supporter's. Both the allowed and the forbidden update are
-- checked here, not just the allowed one — a policy that looks right but
-- passes vacuously is the failure mode this whole style of test exists to
-- catch (see the "sabotage the test once" habit in CLAUDE.md).
--
-- The medication_id is captured into `ids` as a plain scalar BEFORE any
-- role switch and referenced by that captured value everywhere after —
-- never re-looked-up via a join/subquery against public.medications inside
-- an RLS-sensitive statement. A first draft of this test did exactly that
-- and produced two false "FAIL"s that looked like real RLS holes: the
-- INSERT/DELETE ... USING public.medications subquery silently returned
-- zero rows once medications_select's RLS filtered it out for that role,
-- so the statement "succeeded" against zero rows — a WITH CHECK/USING
-- clause that is never evaluated because there was nothing to evaluate it
-- against is not the same as one that evaluated true. Worth leaving this
-- note here since it is exactly the kind of vacuous pass this style of
-- test exists to catch, and it nearly went unnoticed in the RLS test too.
--
-- Same account fixtures and set_config/set local role pattern as
-- acting_for_someone.sql — see that file's note on why the role switch has
-- to happen at statement level, not inside a DO block.
--
--   npx supabase db query --linked -f packages/db/tests/medication_logs_acting_for.sql

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

-- Idempotent: a browser fixture may already have left a real grant here.
-- clinical_access starts false regardless of on-conflict, matching a fresh
-- grant's real default — the read-visibility half of this test needs that.
insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
select (select v from ids where k='mum'), (select v from ids where k='supporter'), 'manage',
       (select v from ids where k='mum')
on conflict (profile_id, grantee_user_id)
do update set permission_level = 'manage', clinical_access = false;
insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
select (select v from ids where k='mum'), (select v from ids where k='viewer'), 'view',
       (select v from ids where k='mum')
on conflict (profile_id, grantee_user_id)
do update set permission_level = 'view', clinical_access = false;

-- One medication row for mum to hang dose logs off (medications write is
-- staff-only, so insert directly rather than through any patient-facing
-- path), captured into ids so no later statement needs to look it up
-- through medications_select's RLS.
with inserted as (
  insert into public.medications
    (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, is_active)
  values
    ('00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
     'Test Amlodipine', '5mg', 'once daily', '["08:00","20:00"]'::jsonb, true)
  returning id
)
insert into ids select 'med', id from inserted;

------------------------------------------------------------------
-- As the patient herself: logs her own morning dose
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='mum'), 'role','authenticated')::text, true);
set local role authenticated;

insert into public.medication_logs
  (organisation_id, patient_id, medication_id, scheduled_time, scheduled_for_date, status, logged_at)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
   (select v from ids where k='med'), '08:00', current_date, 'taken', now());

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'a dose the patient logs herself stays unattributed', 'true',
       (logged_by_profile_id is null)::text
  from public.medication_logs
 where medication_id = (select v from ids where k='med') and scheduled_time = '08:00';

------------------------------------------------------------------
-- As the supporter ('manage', no clinical_access yet)
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='supporter'), 'role','authenticated')::text, true);
set local role authenticated;

-- Without clinical_access, the supporter cannot even see the dose the
-- patient just logged for the same medication/time — read-back is scoped
-- to logged_by_profile_id, not a blanket manage-grant read.
insert into results
select 'no clinical_access: supporter cannot read the patient''s own log entry', 'false',
       exists(
         select 1 from public.medication_logs
          where medication_id = (select v from ids where k='med') and scheduled_time = '08:00'
       )::text;

-- Logs the evening dose for her, and deliberately claims SHE entered it.
insert into public.medication_logs
  (organisation_id, patient_id, medication_id, scheduled_time, scheduled_for_date, status, logged_at,
   logged_by_profile_id)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
   (select v from ids where k='med'), '20:00', current_date, 'taken', now(),
   (select v from ids where k='mum'));

insert into results
select 'the spoofed author is overwritten with the real one',
       (select v from ids where k='supporter')::text,
       logged_by_profile_id::text
  from public.medication_logs
 where medication_id = (select v from ids where k='med') and scheduled_time = '20:00';

-- Allowed: the supporter corrects their OWN entry (unlike vitals_readings,
-- this is the whole point of the update policy existing at all).
update public.medication_logs
   set status = 'missed'
 where medication_id = (select v from ids where k='med') and scheduled_time = '20:00';

insert into results
select 'a supporter can correct a dose log they themselves wrote', 'missed', status::text
  from public.medication_logs
 where medication_id = (select v from ids where k='med') and scheduled_time = '20:00';

-- Forbidden: the supporter tries to revise the row the PATIENT logged
-- herself for the morning dose. This is the sabotage check — if the update
-- policy is broader than intended, this silently succeeds instead of doing
-- nothing, and the row's status catches that.
update public.medication_logs
   set status = 'missed'
 where medication_id = (select v from ids where k='med') and scheduled_time = '08:00';

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'a supporter cannot revise the dose the patient logged herself', 'taken', status::text
  from public.medication_logs
 where medication_id = (select v from ids where k='med') and scheduled_time = '08:00';

------------------------------------------------------------------
-- Patient consents to clinical_access — now the whole checklist opens up
------------------------------------------------------------------
-- Only the record owner may flip her own clinical_access switch
-- (private.enforce_clinical_access_consent_owner), so this has to run as
-- mum, not as the caller that will benefit from it.
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='mum'), 'role','authenticated')::text, true);
set local role authenticated;

update public.profile_access set clinical_access = true
 where profile_id = (select v from ids where k='mum')
   and grantee_user_id = (select v from ids where k='supporter');

reset role;
select set_config('request.jwt.claims', null, true);

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='supporter'), 'role','authenticated')::text, true);
set local role authenticated;

insert into results
select 'with clinical_access: supporter can read the patient''s own log entry too', 'true',
       exists(
         select 1 from public.medication_logs
          where medication_id = (select v from ids where k='med') and scheduled_time = '08:00'
       )::text;

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- As a 'view' grantee: following is not acting
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='viewer'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  insert into public.medication_logs
    (organisation_id, patient_id, medication_id, scheduled_time, scheduled_for_date, status, logged_at)
  values
    ('00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
     (select v from ids where k='med'), '14:00', current_date, 'taken', now());
  insert into results values ('a view grantee cannot log a dose', 'blocked', 'allowed');
exception when others then
  insert into results values ('a view grantee cannot log a dose', 'blocked', 'blocked');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'a view grantee''s insert attempt left no row behind', 'true',
       (not exists(
         select 1 from public.medication_logs
          where medication_id = (select v from ids where k='med') and scheduled_time = '14:00'
       ))::text;

------------------------------------------------------------------
-- Delete stays staff-only for everyone, supporter included
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='supporter'), 'role','authenticated')::text, true);
set local role authenticated;

delete from public.medication_logs
 where medication_id = (select v from ids where k='med') and scheduled_time = '20:00';

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'a supporter cannot delete a dose log, even their own', 'true',
       exists(
         select 1 from public.medication_logs
          where medication_id = (select v from ids where k='med') and scheduled_time = '20:00'
       )::text;

select check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results;

rollback;
