-- Tarragon Health
-- Live proof for 20260922230142_curbside_consults.sql (doctor-to-doctor
-- "curbside consult" messaging), 20260922230221_curbside_consult_notification_template.sql,
-- and 20260922232521_fix_curbside_consult_review_findings.sql (the /code-review
-- high fast-follow: closed the anon-EXECUTE gap on the count RPC, and made
-- last_message_at/last_message_sender_id trigger-only so a participant can no
-- longer spoof "awaiting reply" state via a raw PATCH).
--
-- Every negative is paired with a positive control per CLAUDE.md's own rule:
--   1.  Doctor A starts a consult with Doctor B                          -> ALLOWED
--   2.  Doctor B is notified (in_app, curbside_consult_new_message)      -> control: notifications fire
--   3.  Doctor B (participant) can read the thread                       -> control: participants CAN read
--   4.  Doctor C (different org, not a participant) cannot read it       -> BLOCKED (real RLS SELECT check,
--                                                                            not just a trigger -- run as
--                                                                            `authenticated`, not `postgres`,
--                                                                            which would bypass RLS entirely)
--   5.  Doctor B replies, bumping last_message_sender_id                 -> control: reply flips the "awaiting" side
--   6.  Doctor A is notified of the reply                                -> control: notification is bidirectional
--   7.  Doctor C (non-participant) cannot post into the thread           -> BLOCKED
--   8.  A Care Coordinator cannot start a curbside consult               -> BLOCKED (doctor-to-doctor only)
--   9.  A doctor cannot target a Care Coordinator as the recipient       -> BLOCKED
--   10. A doctor cannot start a consult with a different-org colleague   -> BLOCKED
--   11. Doctor A closes the consult, self-attributed                    -> ALLOWED, closed_by = Doctor A
--   12. Nobody can post into a closed consult                            -> BLOCKED
--   13. A closed consult cannot be reopened via direct UPDATE            -> BLOCKED
--   14. A participant cannot spoof last_message_sender_id via a raw
--       UPDATE (only the message-insert trigger may move it)             -> BLOCKED
--   15. anon cannot execute count_curbside_consults_awaiting_reply()      -> BLOCKED (privilege check, not RLS)
--
-- Sabotage check (do this once, not as a permanent code path): temporarily
-- change case 4's expectation to 'true' (i.e. assume the SELECT policy is a
-- no-op) and confirm the row DOES read as visible without the RLS policy --
-- this confirms the test is actually exercising a live filter, not passing
-- vacuously because the fixture never created a readable row.
--
-- Run: npx supabase db query --linked -f packages/db/tests/curbside_consults.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on results to authenticated;
grant all on ids to authenticated;

-- --------------------------------------------------------------------------
-- Fixtures. Every party is minted here (never borrowed from the @tarragon.test
-- QA roster, which doesn't exist on a fresh `supabase db reset`) -- see
-- fertility_assessment_requests_staff_gate.sql's header for why.
-- --------------------------------------------------------------------------
do $$
declare
  r     record;
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_org2 uuid := gen_random_uuid();
  v_id  uuid;
begin
  -- The direct-consumer org is seeded by migration 20260706084837.
  if not exists (select 1 from public.organisations where id = v_org) then
    insert into public.organisations (id, name, type) values (v_org, 'Curbside Test Org', 'direct_consumer');
  end if;
  insert into ids(k, v) values ('org', v_org);

  insert into public.organisations (id, name, type, is_active)
  values (v_org2, 'Curbside Test Org (other org)', 'direct_consumer', true);
  insert into ids(k, v) values ('org2', v_org2);

  for r in select * from (values
      ('doctor_a', 'clinician', 'org', 'senior_medical_officer'),
      ('doctor_b', 'clinician', 'org', 'medical_officer'),
      ('doctor_c', 'clinician', 'org2', 'senior_medical_officer'),
      ('coordinator', 'clinician', 'org', 'care_coordinator')
    ) as t(key_name, role_name, org_key, tier_name)
  loop
    v_id := gen_random_uuid();
    insert into ids(k, v) values (r.key_name, v_id);

    insert into auth.users (id, email) values (v_id, format('curbsidegate-%s@example.invalid', r.key_name));

    insert into public.profiles (id, organisation_id, role, full_name)
    values (v_id, (select v from ids where k = r.org_key), r.role_name::public.user_role,
            format('Curbside Gate %s', r.key_name))
    on conflict (id) do update
      set organisation_id = excluded.organisation_id,
          role            = excluded.role,
          full_name       = excluded.full_name;

    insert into public.clinical_staff
      (organisation_id, profile_id, full_name, active, doctor_tier, license_verified_at)
    values (
      (select v from ids where k = r.org_key), v_id, format('Dr Curbside %s', r.key_name),
      true, r.tier_name::public.doctor_tier, now()
    )
    returning id into v_id;
    insert into ids(k, v) values (r.key_name || '_staff', v_id);
  end loop;
end $$;

------------------------------------------------------------------
-- Case 1: Doctor A starts a consult with Doctor B.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='doctor_a'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare v_thread uuid;
begin
  select public.start_curbside_consult(
    (select v from ids where k='doctor_b_staff'),
    'Quick BP question',
    'What would you do for resistant HTN in a 40yo?'
  ) into v_thread;
  insert into ids(k, v) values ('thread', v_thread);
  insert into results values ('Doctor A starts a consult with Doctor B', 'allowed', 'allowed');
exception when others then
  insert into results values ('Doctor A starts a consult with Doctor B', 'allowed', 'blocked: ' || sqlerrm);
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'new thread status is open', 'open', status
from public.curbside_consult_threads where id = (select v from ids where k='thread');

insert into results
select 'notifications: Doctor B notified of new consult', 'true',
       exists(
         select 1 from public.notifications
         where recipient_id = (select v from ids where k='doctor_b')
           and template = 'curbside_consult_new_message'
       )::text;

------------------------------------------------------------------
-- Case 2 (control): Doctor B, a real participant, CAN read the thread.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='doctor_b'), 'role','authenticated')::text, true);
set local role authenticated;

insert into results
select 'Doctor B (participant) can read the thread', 'true',
       exists(select 1 from public.curbside_consult_threads where id = (select v from ids where k='thread'))::text;

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Case 3 (RLS SELECT proof -- run as `authenticated`, not `postgres`, so the
-- policy is genuinely exercised rather than bypassed by a superuser role):
-- Doctor C, a different-org non-participant, cannot read the thread.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='doctor_c'), 'role','authenticated')::text, true);
set local role authenticated;

insert into results
select 'Doctor C (non-participant, other org) cannot read the thread', 'true',
       (not exists(select 1 from public.curbside_consult_threads where id = (select v from ids where k='thread')))::text;

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Case 4: Doctor B replies -- last_message_sender_id flips to B, and
-- Doctor A gets notified.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='doctor_b'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  perform public.post_curbside_consult_message(
    (select v from ids where k='thread'), 'I would add a 4th agent, spironolactone.'
  );
  insert into results values ('Doctor B replies', 'allowed', 'allowed');
exception when others then
  insert into results values ('Doctor B replies', 'allowed', 'blocked: ' || sqlerrm);
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'last_message_sender_id flips to Doctor B after her reply', (select v from ids where k='doctor_b_staff')::text, last_message_sender_id::text
from public.curbside_consult_threads where id = (select v from ids where k='thread');

insert into results
select 'notifications: Doctor A notified of the reply', 'true',
       exists(
         select 1 from public.notifications
         where recipient_id = (select v from ids where k='doctor_a')
           and template = 'curbside_consult_new_message'
       )::text;

------------------------------------------------------------------
-- Case 4b: Doctor A (a genuine participant) cannot spoof
-- last_message_sender_id via a raw UPDATE -- only the message-insert
-- trigger may move it. Sabotage-relevant: before the fix migration, this
-- column had no immutability guard at all and this case failed.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='doctor_a'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  update public.curbside_consult_threads
    set last_message_sender_id = (select v from ids where k='doctor_a_staff')
    where id = (select v from ids where k='thread');
  insert into results values ('participant spoofs last_message_sender_id via raw UPDATE', 'blocked', 'allowed: SECURITY HOLE');
exception when others then
  insert into results values ('participant spoofs last_message_sender_id via raw UPDATE', 'blocked', 'blocked');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'last_message_sender_id unchanged after the spoof attempt', (select v from ids where k='doctor_b_staff')::text, last_message_sender_id::text
from public.curbside_consult_threads where id = (select v from ids where k='thread');

------------------------------------------------------------------
-- Case 5: Doctor C (non-participant) cannot post into the thread.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='doctor_c'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  perform public.post_curbside_consult_message((select v from ids where k='thread'), 'butting in');
  insert into results values ('Doctor C (non-participant) posts into the thread', 'blocked', 'allowed: SECURITY HOLE');
exception when others then
  insert into results values ('Doctor C (non-participant) posts into the thread', 'blocked', 'blocked');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Case 6: a Care Coordinator cannot start a curbside consult at all.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='coordinator'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  perform public.start_curbside_consult((select v from ids where k='doctor_a_staff'), 'Question', 'body');
  insert into results values ('Care Coordinator starts a curbside consult', 'blocked', 'allowed: SECURITY HOLE');
exception when others then
  insert into results values ('Care Coordinator starts a curbside consult', 'blocked', 'blocked');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Case 7: a doctor cannot target a Care Coordinator as the recipient.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='doctor_a'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  perform public.start_curbside_consult((select v from ids where k='coordinator_staff'), 'Question', 'body');
  insert into results values ('Doctor targets a Care Coordinator as recipient', 'blocked', 'allowed: SECURITY HOLE');
exception when others then
  insert into results values ('Doctor targets a Care Coordinator as recipient', 'blocked', 'blocked');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Case 8: a doctor cannot start a consult with a different-org colleague.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='doctor_a'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  perform public.start_curbside_consult((select v from ids where k='doctor_c_staff'), 'Question', 'body');
  insert into results values ('Doctor targets a different-org colleague', 'blocked', 'allowed: SECURITY HOLE');
exception when others then
  insert into results values ('Doctor targets a different-org colleague', 'blocked', 'blocked');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Case 9: Doctor A closes the consult -- self-attributed.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='doctor_a'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  perform public.close_curbside_consult((select v from ids where k='thread'));
  insert into results values ('Doctor A closes the consult', 'allowed', 'allowed');
exception when others then
  insert into results values ('Doctor A closes the consult', 'allowed', 'blocked: ' || sqlerrm);
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'closed thread is self-attributed to Doctor A', 'closed/' || (select v from ids where k='doctor_a_staff')::text,
       status || '/' || closed_by::text
from public.curbside_consult_threads where id = (select v from ids where k='thread');

------------------------------------------------------------------
-- Case 10: nobody can post into a closed consult.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='doctor_b'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  perform public.post_curbside_consult_message((select v from ids where k='thread'), 'one more thing');
  insert into results values ('post into a closed consult', 'blocked', 'allowed: SECURITY HOLE');
exception when others then
  insert into results values ('post into a closed consult', 'blocked', 'blocked');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Case 11: a closed consult cannot be reopened via a direct UPDATE.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='doctor_a'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  update public.curbside_consult_threads set status = 'open' where id = (select v from ids where k='thread');
  insert into results values ('reopen a closed consult via direct UPDATE', 'blocked', 'allowed: SECURITY HOLE');
exception when others then
  insert into results values ('reopen a closed consult via direct UPDATE', 'blocked', 'blocked');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Case 12: anon cannot execute count_curbside_consults_awaiting_reply() --
-- a privilege check (EXECUTE grant), not an RLS/trigger check, so it must be
-- run as the `anon` role itself, unauthenticated. `results`/`ids` are only
-- granted to `authenticated` (not `anon`), so the outcome is captured in a
-- session-local GUC and recorded AFTER switching back -- inserting into
-- `results` while still `anon` would itself raise insufficient_privilege and
-- get misread as the RPC call being the thing that failed.
------------------------------------------------------------------
set local role anon;

do $$
begin
  perform public.count_curbside_consults_awaiting_reply();
  perform set_config('curbside_consult_test.case12', 'allowed: SECURITY HOLE', true);
exception when insufficient_privilege then
  perform set_config('curbside_consult_test.case12', 'blocked', true);
end $$;

reset role;

insert into results values (
  'anon executes count_curbside_consults_awaiting_reply', 'blocked',
  current_setting('curbside_consult_test.case12', true)
);

select check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results
order by check_name;

rollback;
