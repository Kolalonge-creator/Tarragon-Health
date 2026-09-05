-- Proves 20260809232718_medication_logs_acting_for.sql, as amended by
-- 20260830224528_medication_logs_append_only.sql.
--
-- medication_logs is now append-only (spec §1.4): there is no UPDATE policy
-- left for anyone, patient or supporter — a correction is a new INSERT, and
-- the latest row per slot (medication_logs_latest_per_slot) is authoritative
-- for "today's status." This deliberately widens what a supporter may do
-- versus the old narrow UPDATE-only-your-own-entry scope: a supporter may
-- now insert a newer entry for ANY slot on a patient they act for, including
-- one the patient logged herself, since nothing is ever overwritten — both
-- entries stay in the record. The UPDATE-is-blocked-for-everyone assertion
-- below is the sabotage check this style of test exists for: a leftover or
-- accidentally-reintroduced UPDATE policy would let this silently pass.
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


-- --------------------------------------------------------------------------
-- Fixtures. Every party below is MINTED here rather than selected out of the
-- @tarragon.test QA accounts this file used to borrow. Those accounts exist
-- only on the populated project: on a fresh `supabase db reset` the lookups
-- returned nothing, `ids` came back empty, and every check below ran against
-- NULL and reported a confident pass. On the populated project they carry
-- months of accumulated rows of their own, which is the other half of the
-- problem -- an assertion phrased as "no row like this exists" can be failed
-- by somebody else's data rather than by the code under test.
--
-- Each key gets its own distinct account: sharing one profile between two
-- roles in a script like this makes a later count fold in an earlier,
-- legitimate action and reads exactly like the behaviour under test breaking.
-- --------------------------------------------------------------------------
do $$
declare
  r     record;
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_id  uuid;
begin
  -- The direct-consumer org is seeded by migration 20260706084837, and is the
  -- same org id this file's own INSERTs name further down.
  if not exists (select 1 from public.organisations where id = v_org) then
    insert into public.organisations (id, name, type)
    values (v_org, 'Med-Log Acting-For Test Org', 'direct_consumer');
  end if;
  insert into ids(k, v) values ('org', v_org);

  for r in select * from (values
      ('mum', 'patient'),
      ('supporter', 'patient'),
      ('viewer', 'patient')
    ) as t(key_name, role_name)
  loop
    v_id := gen_random_uuid();
    insert into ids(k, v) values (r.key_name, v_id);

    insert into auth.users (id, email)
    values (v_id, format('medlogacting-%s@example.invalid', r.key_name));

    insert into public.profiles (id, organisation_id, role, full_name)
    values (v_id, v_org, r.role_name::public.user_role,
            format('Med-Log Acting-For %s', r.key_name))
    on conflict (id) do update
      set organisation_id = excluded.organisation_id,
          role            = excluded.role,
          full_name       = excluded.full_name;
  end loop;
end $$;

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

-- Allowed: the supporter corrects their OWN entry — append-only means this
-- is a new INSERT, not an UPDATE. The raw table keeps both rows; the latest
-- one (this one) is what medication_logs_latest_per_slot surfaces.
insert into public.medication_logs
  (organisation_id, patient_id, medication_id, scheduled_time, scheduled_for_date, status, logged_at)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
   (select v from ids where k='med'), '20:00', current_date, 'missed', now());

insert into results
select 'a supporter can correct a dose log they themselves wrote (append-only: latest wins)',
       'missed',
       (select status::text from public.medication_logs_latest_per_slot
          where medication_id = (select v from ids where k='med') and scheduled_time = '20:00');

insert into results
select 'the correction did not erase the original entry', '2',
       (select count(*)::text from public.medication_logs
          where medication_id = (select v from ids where k='med') and scheduled_time = '20:00');

-- Allowed, and deliberately wider than the old UPDATE scope: the supporter
-- inserts a newer entry for the slot the PATIENT logged herself. Append-only
-- means this is not "revising someone else's row" — it's a new row, and
-- both stay visible in the record. This is the assertion that would fail if
-- the insert policy were narrowed back to a can_act_for-and-own-only check.
insert into public.medication_logs
  (organisation_id, patient_id, medication_id, scheduled_time, scheduled_for_date, status, logged_at)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
   (select v from ids where k='med'), '08:00', current_date, 'missed', now());

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'a supporter can append a newer entry for a slot the patient logged herself',
       'missed',
       (select status::text from public.medication_logs_latest_per_slot
          where medication_id = (select v from ids where k='med') and scheduled_time = '08:00');

insert into results
select 'append-only: the patient''s original 08:00 entry is still on file, not overwritten', 'true',
       (exists(
         select 1 from public.medication_logs
          where medication_id = (select v from ids where k='med') and scheduled_time = '08:00'
            and status = 'taken' and logged_by_profile_id is null
       ))::text;

-- Sabotage check: no UPDATE policy should exist for medication_logs at all
-- any more, for any role — a leftover or reintroduced one would let a
-- correction silently overwrite history instead of appending to it.
insert into results
select 'medication_logs has no UPDATE policy for anyone (append-only)', '0',
       (select count(*)::text from pg_policies
          where schemaname = 'public' and tablename = 'medication_logs' and cmd = 'UPDATE');

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
