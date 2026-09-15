-- Tarragon Health
-- Live proof for 20260829121135_pregnancy_antenatal_extension.sql and
-- 20260829121137_postnatal_programme.sql.
--
-- Break on purpose to confirm this test discriminates: drop the
-- `patient_id = (select auth.uid())` clause from any of the three
-- *_select policies exercised here -- the matching cross-patient-read case
-- must FAIL instead of correctly finding zero rows.
--
-- Run: npx supabase db query --linked -f packages/db/tests/pregnancy_antenatal_postnatal_rls.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

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
    values (v_org, 'Antenatal RLS Test Org', 'direct_consumer');
  end if;
  insert into ids(k, v) values ('org', v_org);

  for r in select * from (values
      ('patient_a', 'patient'),
      ('patient_b', 'patient')
    ) as t(key_name, role_name)
  loop
    v_id := gen_random_uuid();
    insert into ids(k, v) values (r.key_name, v_id);

    insert into auth.users (id, email)
    values (v_id, format('antenatalrls-%s@example.invalid', r.key_name));

    insert into public.profiles (id, organisation_id, role, full_name)
    values (v_id, v_org, r.role_name::public.user_role,
            format('Antenatal RLS %s', r.key_name))
    on conflict (id) do update
      set organisation_id = excluded.organisation_id,
          role            = excluded.role,
          full_name       = excluded.full_name;
  end loop;
end $$;

------------------------------------------------------------------
-- antenatal_visits: patient A logs her own visit; patient B cannot see it
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient_a'), 'role','authenticated')::text, true);
set local role authenticated;

insert into public.antenatal_visits
  (organisation_id, patient_id, visit_number, gestational_week_at_visit, status)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='patient_a'), 1, 12, 'completed');

reset role;
select set_config('request.jwt.claims', null, true);

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient_b'), 'role','authenticated')::text, true);
set local role authenticated;

insert into results
select 'patient B cannot read patient A''s antenatal visits', 'true',
       (not exists(
         select 1 from public.antenatal_visits where patient_id = (select v from ids where k='patient_a')
       ))::text;

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'patient A can read her own antenatal visit', 'true',
       exists(
         select 1 from public.antenatal_visits
          where patient_id = (select v from ids where k='patient_a') and status = 'completed'
       )::text;

------------------------------------------------------------------
-- postnatal_profiles + postnatal_checkins: same isolation shape
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient_a'), 'role','authenticated')::text, true);
set local role authenticated;

insert into public.postnatal_profiles
  (organisation_id, patient_id, delivery_date, delivery_mode)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='patient_a'), current_date - 10, 'vaginal');

reset role;
select set_config('request.jwt.claims', null, true);

insert into ids
select 'postnatal_profile', id from public.postnatal_profiles
 where patient_id = (select v from ids where k='patient_a') order by created_at desc limit 1;

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient_a'), 'role','authenticated')::text, true);
set local role authenticated;

insert into public.postnatal_checkins
  (organisation_id, patient_id, postnatal_profile_id, checkin_window, breastfeeding_status, contraception_discussed)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='patient_a'),
   (select v from ids where k='postnatal_profile'), 'week_6', 'exclusive', true);

reset role;
select set_config('request.jwt.claims', null, true);

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient_b'), 'role','authenticated')::text, true);
set local role authenticated;

insert into results
select 'patient B cannot read patient A''s postnatal profile', 'true',
       (not exists(
         select 1 from public.postnatal_profiles where patient_id = (select v from ids where k='patient_a')
       ))::text;

insert into results
select 'patient B cannot read patient A''s postnatal check-ins', 'true',
       (not exists(
         select 1 from public.postnatal_checkins where patient_id = (select v from ids where k='patient_a')
       ))::text;

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'patient A can read her own postnatal check-in', 'true',
       exists(
         select 1 from public.postnatal_checkins
          where postnatal_profile_id = (select v from ids where k='postnatal_profile')
            and checkin_window = 'week_6' and contraception_discussed
       )::text;

------------------------------------------------------------------
-- anon has no access to any of the three
------------------------------------------------------------------
insert into results
select 'anon has no table privilege on antenatal_visits', 'false',
       has_table_privilege('anon', 'public.antenatal_visits', 'SELECT')::text;
insert into results
select 'anon has no table privilege on postnatal_profiles', 'false',
       has_table_privilege('anon', 'public.postnatal_profiles', 'SELECT')::text;
insert into results
select 'anon has no table privilege on postnatal_checkins', 'false',
       has_table_privilege('anon', 'public.postnatal_checkins', 'SELECT')::text;

select check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results;

rollback;
