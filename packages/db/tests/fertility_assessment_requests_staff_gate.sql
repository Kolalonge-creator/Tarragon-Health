-- Tarragon Health
-- Live proof for 20260829121141_fertility_assessment_requests.sql.
--
-- The whole point of this table's insert policy is that a patient can only
-- ever create the initial request at status 'requested' with no
-- appointment_id/specialist_referral_id -- progressing it is staff-only, so
-- a patient can never fabricate "I've already been referred". Both the
-- allowed insert AND the two forbidden variants are checked here (the
-- "sabotage the test once" habit) -- a policy that looks right but passes
-- vacuously is exactly what this style of test exists to catch.
--
-- Break on purpose to confirm this test discriminates: drop the
-- `and status = 'requested'` clause from fertility_assessment_requests_insert
-- -- case 2 must FAIL (a patient-spoofed 'referred' row would be accepted).
--
-- Run: npx supabase db query --linked -f packages/db/tests/fertility_assessment_requests_staff_gate.sql
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
    values (v_org, 'Fertility Gate Test Org', 'direct_consumer');
  end if;
  insert into ids(k, v) values ('org', v_org);

  for r in select * from (values
      ('patient_a', 'patient'),
      ('patient_b', 'patient'),
      ('clinician', 'clinician')
    ) as t(key_name, role_name)
  loop
    v_id := gen_random_uuid();
    insert into ids(k, v) values (r.key_name, v_id);

    insert into auth.users (id, email)
    values (v_id, format('fertilitygate-%s@example.invalid', r.key_name));

    insert into public.profiles (id, organisation_id, role, full_name)
    values (v_id, v_org, r.role_name::public.user_role,
            format('Fertility Gate %s', r.key_name))
    on conflict (id) do update
      set organisation_id = excluded.organisation_id,
          role            = excluded.role,
          full_name       = excluded.full_name;
  end loop;
end $$;

------------------------------------------------------------------
-- Case 1: a patient can create an ordinary 'requested' row for herself
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient_a'), 'role','authenticated')::text, true);
set local role authenticated;

insert into public.fertility_assessment_requests
  (organisation_id, patient_id, trying_duration_months)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='patient_a'), 14);

reset role;
select set_config('request.jwt.claims', null, true);

insert into ids
select 'request', id from public.fertility_assessment_requests
 where patient_id = (select v from ids where k='patient_a') order by created_at desc limit 1;

insert into results
select 'a patient can create her own request at status requested', 'true',
       exists(select 1 from public.fertility_assessment_requests where id = (select v from ids where k='request'))::text;

------------------------------------------------------------------
-- Case 2 (sabotage check): a patient cannot insert a row already claiming
-- 'referred' status
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient_a'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  insert into public.fertility_assessment_requests
    (organisation_id, patient_id, status)
  values
    ('00000000-0000-0000-0000-000000000001', (select v from ids where k='patient_a'), 'referred');
  insert into results values ('a patient cannot spoof status=referred on insert', 'blocked', 'allowed');
exception when others then
  insert into results values ('a patient cannot spoof status=referred on insert', 'blocked', 'blocked');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Case 3 (sabotage check): a patient cannot update her own request's status
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient_a'), 'role','authenticated')::text, true);
set local role authenticated;

update public.fertility_assessment_requests
   set status = 'referred'
 where id = (select v from ids where k='request');

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'a patient cannot progress her own request''s status', 'requested', status
  from public.fertility_assessment_requests where id = (select v from ids where k='request');

------------------------------------------------------------------
-- Case 4: org staff CAN progress the request's status
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='clinician'), 'role','authenticated')::text, true);
set local role authenticated;

update public.fertility_assessment_requests
   set status = 'education_provided'
 where id = (select v from ids where k='request');

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'org staff can progress a fertility request''s status', 'education_provided', status
  from public.fertility_assessment_requests where id = (select v from ids where k='request');

------------------------------------------------------------------
-- Case 5: patient B cannot read or write patient A's request
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient_b'), 'role','authenticated')::text, true);
set local role authenticated;

insert into results
select 'patient B cannot read patient A''s fertility request', 'true',
       (not exists(
         select 1 from public.fertility_assessment_requests where id = (select v from ids where k='request')
       ))::text;

reset role;
select set_config('request.jwt.claims', null, true);

select check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results;

rollback;
