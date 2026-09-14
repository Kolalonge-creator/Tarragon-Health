-- Tarragon Health
-- Proves private.auto_assign_escalation() (BEFORE INSERT trigger on
-- public.escalations) and the reassignment-authority pair --
-- private.enforce_escalation_reassignment_authority() /
-- private.enforce_clinician_alert_reassignment_authority() -- introduced by
-- the escalation-and-specialist-auto-assignment migration (committed as
-- 20260906141500_escalation_and_specialist_auto_assignment.sql; its live
-- schema_migrations row was recorded as version 20260908131029 -- confirmed
-- via list_migrations before writing this test, per CLAUDE.md's
-- hand-typed-timestamp/filename-drift warning -- this comment references the
-- migration by its committed name, not a version number, so that drift
-- can't make it stale).
--
-- CLAUDE_AUDIT (Gap B, 2026-09-14): these three functions had zero test
-- coverage in this directory. The migration's own closing `do $$ ... $$`
-- block only proves the trigger objects EXIST and that the gate functions it
-- calls execute without raising on a dummy uuid -- it never proves actual
-- least-loaded routing, tier-qualification routing, or that a non-CMO
-- reassignment attempt is genuinely rejected. This file proves all three,
-- plus a deliberate sabotage step for the reassignment check (this
-- project's standing discipline for an authority gate -- see CLAUDE.md's
-- "reusable pattern for removing a shipped feature" bullet, applied here to
-- an authority check rather than a removal).
--
-- Run: npx supabase db query --linked -f packages/db/tests/escalation_auto_assignment_and_reassignment_authority.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temp table test_result (case_num int, label text, outcome text, detail text) on commit drop;
create temp table ids (k text primary key, v uuid) on commit drop;

-- ---------------------------------------------------------------------------
-- Fixtures. Every party is MINTED (never borrowed from the @tarragon.test QA
-- roster or an existing patient) -- see acting_for_someone.sql's fixture
-- comment for why: a populated project makes a "load = 0" assumption false
-- for a borrowed doctor, and a bare `db reset` has no QA roster at all.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid := gen_random_uuid();
  v_id  uuid;
  r     record;
begin
  -- A FRESH org, not the shared seeded org other tests reuse: this test's
  -- least-loaded-routing assertions depend on knowing EVERY active
  -- clinical_staff row in scope, and the shared seeded org carries real
  -- (or other tests') clinical staff that would silently outrank the
  -- fixture doctors below and falsify the routing assertions.
  insert into public.organisations (id, name, type)
  values (v_org, 'Escalation Auto-Assignment Test Org', 'clinic');
  insert into ids(k, v) values ('org', v_org);

  -- Patients (escalations.patient_id / clinician_alerts.patient_id targets).
  for r in select * from (values ('patient_a'), ('patient_b'), ('patient_c')) as t(key_name)
  loop
    v_id := gen_random_uuid();
    insert into ids(k, v) values (r.key_name, v_id);
    insert into auth.users (id, email) values (v_id, format('escassign-%s@example.invalid', r.key_name));
    insert into public.profiles (id, organisation_id, role, full_name)
    values (v_id, v_org, 'patient'::public.user_role, format('Escalation Assign %s', r.key_name))
    on conflict (id) do update
      set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  end loop;

  -- Doctors. doctor_a/doctor_b: medical_officer, employed (no indemnity
  -- required). doctor_c: senior_medical_officer, employed (qualifies for
  -- emergency-authority routing). doctor_cmo: chief_medical_officer (always
  -- needs current indemnity to activate). doctor_rogue: medical_officer,
  -- employed -- the non-CMO who must be refused when reassigning someone
  -- ELSE's case.
  for r in select * from (values
      ('doctor_a', 'medical_officer'),
      ('doctor_b', 'medical_officer'),
      ('doctor_c', 'senior_medical_officer'),
      ('doctor_cmo', 'chief_medical_officer'),
      ('doctor_rogue', 'medical_officer')
    ) as t(key_name, tier)
  loop
    v_id := gen_random_uuid();
    insert into ids(k, v) values (r.key_name, v_id);
    insert into auth.users (id, email) values (v_id, format('escassign-%s@example.invalid', r.key_name));
    insert into public.profiles (id, organisation_id, role, full_name)
    values (v_id, v_org, 'clinician'::public.user_role, format('Dr Escalation Assign %s', r.key_name))
    on conflict (id) do update
      set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

    insert into public.clinical_staff (
      organisation_id, profile_id, full_name, active, license_verified_at,
      doctor_tier, employment_type,
      indemnity_insurer, indemnity_policy_number, indemnity_expires_at
    )
    values (
      v_org, v_id, format('Dr Escalation Assign %s', r.key_name), true, now(),
      r.tier::public.doctor_tier, 'employed',
      'Probe Indemnity Ltd', format('PROBE-ESCASSIGN-%s', r.key_name), now() + interval '1 year'
    )
    returning id into v_id;
    -- v_id is now clinical_staff.id (distinct from the profile_id key above)
    -- -- clinician_alerts.responsible_clinician_id/backup_clinician_id point
    -- at clinical_staff.id, not profile_id, so case 9-11 below need this too.
    insert into ids(k, v) values (r.key_name || '_staff', v_id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Case 1: least-loaded routing among tier-qualifying doctors, non-emergency.
-- doctor_a is given one pre-existing open escalation (load=1); doctor_b has
-- none (load=0). A brand-new, non-emergency escalation (no clinician_alert
-- linked) must land on doctor_b.
-- ---------------------------------------------------------------------------
insert into public.escalations (organisation_id, patient_id, reason, assigned_doctor_id, status)
select (select v from ids where k = 'org'), (select v from ids where k = 'patient_a'),
       'Pre-existing load for doctor_a', (select v from ids where k = 'doctor_a'), 'open';

insert into public.escalations (organisation_id, patient_id, reason)
select (select v from ids where k = 'org'), (select v from ids where k = 'patient_b'),
       'Fresh non-emergency case, should route to the least-loaded qualifying doctor';

insert into test_result
select 1, 'least-loaded routing picks doctor_b (load 0) over doctor_a (load 1)',
  case when e.assigned_doctor_id = (select v from ids where k = 'doctor_b') then 'PASS' else 'FAIL' end,
  'assigned_doctor_id=' || coalesce(e.assigned_doctor_id::text, 'null')
from public.escalations e
where e.patient_id = (select v from ids where k = 'patient_b')
  and e.reason = 'Fresh non-emergency case, should route to the least-loaded qualifying doctor';

-- ---------------------------------------------------------------------------
-- Case 2: tier-qualification gate. An escalation linked to an EMERGENCY-level
-- clinician_alert must route to doctor_c (senior_medical_officer, load 0),
-- never to doctor_a/doctor_b, who are only medical_officer and cannot clear
-- the emergency bar no matter how idle they are.
-- ---------------------------------------------------------------------------
do $$
declare
  v_alert_id uuid;
  v_case_id  uuid;
begin
  insert into public.clinician_alerts (organisation_id, patient_id, level, category, type_code, title)
  values (
    (select v from ids where k = 'org'), (select v from ids where k = 'patient_c'),
    'emergency', 'clinical', 'deterioration', 'Escalation auto-assignment test: emergency alert'
  )
  returning id into v_alert_id;

  insert into ids(k, v) values ('alert', v_alert_id);

  insert into public.escalations (organisation_id, patient_id, reason, clinician_alert_id)
  values (
    (select v from ids where k = 'org'), (select v from ids where k = 'patient_c'),
    'Emergency-linked case, must route to a Senior Medical Officer or above', v_alert_id
  )
  returning id into v_case_id;

  insert into ids(k, v) values ('emergency_case', v_case_id);
end $$;

insert into test_result
select 2, 'emergency-linked case routes only to a tier-qualifying (SMO+) doctor',
  case when e.assigned_doctor_id = (select v from ids where k = 'doctor_c') then 'PASS' else 'FAIL' end,
  'assigned_doctor_id=' || coalesce(e.assigned_doctor_id::text, 'null')
from public.escalations e
where e.id = (select v from ids where k = 'emergency_case');

-- ---------------------------------------------------------------------------
-- Case 3: reassignment authority, on the emergency case from case 2.
-- Self-assignment (claiming for yourself) stays exempt from the CMO-only
-- gate; reassigning someone ELSE requires the CMO.
-- ---------------------------------------------------------------------------

-- 3: self-assignment by doctor_a (an uninvolved, non-CMO, qualifying
-- clinical-tier doctor claiming the case for himself) must succeed -- the
-- exemption the migration's header describes. Included as a control so
-- case 4 below isn't read as "every UPDATE on this row fails".
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k = 'doctor_a'), 'role', 'authenticated')::text, true);

  update public.escalations
    set assigned_doctor_id = (select v from ids where k = 'doctor_a')
    where id = (select v from ids where k = 'emergency_case');

  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (3, 'self-assignment by a non-CMO qualifying doctor is exempt from the CMO-only gate', 'PASS', 'no exception raised');
exception when others then
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (3, 'self-assignment by a non-CMO qualifying doctor is exempt from the CMO-only gate', 'FAIL', sqlerrm);
end $$;

-- 4: doctor_rogue (a non-CMO clinical-tier doctor, NOT the current assignee)
-- tries to reassign the case to doctor_b. Must be refused (errcode 42501).
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k = 'doctor_rogue'), 'role', 'authenticated')::text, true);

  update public.escalations
    set assigned_doctor_id = (select v from ids where k = 'doctor_b')
    where id = (select v from ids where k = 'emergency_case');

  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (4, 'non-CMO reassignment to someone else is REJECTED', 'FAIL', 'no exception raised -- reassignment silently succeeded');
exception when others then
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (
    4, 'non-CMO reassignment to someone else is REJECTED', case when sqlstate = '42501' then 'PASS' else 'FAIL' end,
    'sqlstate=' || sqlstate || ' message=' || sqlerrm
  );
end $$;

-- 5: confirm the rejected reassignment from case 4 genuinely did not go
-- through -- still doctor_a from case 3.
insert into test_result
select 5, 'rejected reassignment left assigned_doctor_id unchanged (still doctor_a)',
  case when e.assigned_doctor_id = (select v from ids where k = 'doctor_a') then 'PASS' else 'FAIL' end,
  'assigned_doctor_id=' || coalesce(e.assigned_doctor_id::text, 'null')
from public.escalations e where e.id = (select v from ids where k = 'emergency_case');

-- 6: the CMO reassigns the same case to doctor_b. Must succeed.
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k = 'doctor_cmo'), 'role', 'authenticated')::text, true);

  update public.escalations
    set assigned_doctor_id = (select v from ids where k = 'doctor_b')
    where id = (select v from ids where k = 'emergency_case');

  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (6, 'CMO reassignment to someone else SUCCEEDS', 'PASS', 'no exception raised');
exception when others then
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (6, 'CMO reassignment to someone else SUCCEEDS', 'FAIL', sqlerrm);
end $$;

-- 7: confirm the CMO's reassignment actually took effect.
insert into test_result
select 7, 'CMO reassignment actually took effect (assigned_doctor_id = doctor_b)',
  case when e.assigned_doctor_id = (select v from ids where k = 'doctor_b') then 'PASS' else 'FAIL' end,
  'assigned_doctor_id=' || coalesce(e.assigned_doctor_id::text, 'null')
from public.escalations e where e.id = (select v from ids where k = 'emergency_case');

-- ---------------------------------------------------------------------------
-- Case 8: SABOTAGE -- prove case 4 actually discriminates rather than
-- passing vacuously (e.g. every UPDATE happening to fail for an unrelated
-- reason, such as a typo in the fixture). Temporarily replace
-- private.enforce_escalation_reassignment_authority() with a no-op, repeat
-- doctor_rogue's exact reassignment attempt, and require it to now SUCCEED
-- (proving the real function is what was blocking it) -- then restore the
-- exact original function body immediately below. Nothing here uses
-- SAVEPOINT/ROLLBACK TO for the restore: a ROLLBACK TO would undo this
-- case's own `insert into test_result` along with the sabotage, which is
-- how an earlier draft of this file silently lost case 8's result. The
-- whole file's closing `rollback;` is what makes none of this persist.
-- ---------------------------------------------------------------------------

create or replace function private.enforce_escalation_reassignment_authority()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $sabotage$
begin
  return new; -- deliberately no-op: the authority check is disabled
end;
$sabotage$;

do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k = 'doctor_rogue'), 'role', 'authenticated')::text, true);

  update public.escalations
    set assigned_doctor_id = (select v from ids where k = 'doctor_a')
    where id = (select v from ids where k = 'emergency_case');

  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (
    8, 'SABOTAGE CONTROL: with the gate disabled, the same rogue reassignment now succeeds',
    'PASS', 'no exception raised with the gate disabled -- confirms case 4 was testing the real gate'
  );
exception when others then
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (
    8, 'SABOTAGE CONTROL: with the gate disabled, the same rogue reassignment now succeeds',
    'FAIL (test does not discriminate)', sqlerrm
  );
end $$;

-- Restore the exact original body (verified live via pg_get_functiondef
-- before writing this file) so nothing downstream in this same transaction
-- ever runs against the sabotaged version.
create or replace function private.enforce_escalation_reassignment_authority()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $restore$
begin
  if new.assigned_doctor_id is distinct from old.assigned_doctor_id
     and new.assigned_doctor_id is not null
     and new.assigned_doctor_id is distinct from (select auth.uid())
     and not exists (
       select 1 from public.clinical_staff
       where profile_id = (select auth.uid())
         and organisation_id = new.organisation_id
         and active
         and doctor_tier = 'chief_medical_officer'
     )
  then
    raise exception 'Only the Chief Medical Officer / Clinical Director can assign a case to someone else. Claim it for yourself instead.'
      using errcode = '42501';
  end if;
  return new;
end;
$restore$;

-- Confirm the restore actually took (case 4's exact rogue reassignment,
-- repeated once more, must be refused again).
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k = 'doctor_rogue'), 'role', 'authenticated')::text, true);

  update public.escalations
    set assigned_doctor_id = (select v from ids where k = 'doctor_b')
    where id = (select v from ids where k = 'emergency_case');

  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (
    13, 'gate restored after sabotage: the same rogue reassignment is REJECTED again', 'FAIL', 'no exception raised -- restore did not take'
  );
exception when others then
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (
    13, 'gate restored after sabotage: the same rogue reassignment is REJECTED again',
    case when sqlstate = '42501' then 'PASS' else 'FAIL' end, 'sqlstate=' || sqlstate
  );
end $$;

-- ---------------------------------------------------------------------------
-- Cases 9-12: the same reassignment-authority pattern, on the OTHER trigger
-- -- private.enforce_clinician_alert_reassignment_authority(), which gates
-- clinician_alerts.responsible_clinician_id/backup_clinician_id rather than
-- escalations.assigned_doctor_id. Reuses the emergency alert from case 2.
--
-- NOTE: private.classify_and_assign_clinician_alert() (the pre-existing
-- BEFORE INSERT trigger, 20260828014055) already auto-assigned
-- responsible_clinician_id at creation -- 'deterioration' carries a rule
-- with owner_tier='medical_officer', so it landed on the least-loaded active
-- medical_officer at insert time (doctor_a, first-created of the two tied
-- medical_officers). The exemption/authority checks below all reassign
-- FROM that starting value TO a genuinely different clinical_staff id, never
-- a same-value no-op -- a same-value "reassignment" wouldn't trip
-- new.responsible_clinician_id is distinct from old... at all, and would
-- pass every case here without exercising the trigger.
-- ---------------------------------------------------------------------------

-- 9: self-assignment (doctor_b claims the alert for himself, moving it off
-- doctor_a) is exempt from the CMO-only gate.
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k = 'doctor_b'), 'role', 'authenticated')::text, true);

  update public.clinician_alerts
    set responsible_clinician_id = (select v from ids where k = 'doctor_b_staff')
    where id = (select v from ids where k = 'alert');

  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (9, 'clinician_alerts: self-assignment by a non-CMO is exempt from the CMO-only gate', 'PASS', 'no exception raised');
exception when others then
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (9, 'clinician_alerts: self-assignment by a non-CMO is exempt from the CMO-only gate', 'FAIL', sqlerrm);
end $$;

-- 10: doctor_rogue (non-CMO, not the current responsible clinician) tries to
-- hand the alert to doctor_c. Must be refused.
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k = 'doctor_rogue'), 'role', 'authenticated')::text, true);

  update public.clinician_alerts
    set responsible_clinician_id = (select v from ids where k = 'doctor_c_staff')
    where id = (select v from ids where k = 'alert');

  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (10, 'clinician_alerts: non-CMO reassignment to someone else is REJECTED', 'FAIL', 'no exception raised -- reassignment silently succeeded');
exception when others then
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (
    10, 'clinician_alerts: non-CMO reassignment to someone else is REJECTED', case when sqlstate = '42501' then 'PASS' else 'FAIL' end,
    'sqlstate=' || sqlstate || ' message=' || sqlerrm
  );
end $$;

-- 11: the CMO reassigns the alert to doctor_c. Must succeed.
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from ids where k = 'doctor_cmo'), 'role', 'authenticated')::text, true);

  update public.clinician_alerts
    set responsible_clinician_id = (select v from ids where k = 'doctor_c_staff')
    where id = (select v from ids where k = 'alert');

  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (11, 'clinician_alerts: CMO reassignment to someone else SUCCEEDS', 'PASS', 'no exception raised');
exception when others then
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (11, 'clinician_alerts: CMO reassignment to someone else SUCCEEDS', 'FAIL', sqlerrm);
end $$;

insert into test_result
select 12, 'clinician_alerts: CMO reassignment actually took effect (responsible = doctor_c)',
  case when a.responsible_clinician_id = (select v from ids where k = 'doctor_c_staff') then 'PASS' else 'FAIL' end,
  'responsible_clinician_id=' || coalesce(a.responsible_clinician_id::text, 'null')
from public.clinician_alerts a where a.id = (select v from ids where k = 'alert');

-- ---------------------------------------------------------------------------
-- Verdict. Raise if anything failed -- the CI runner's trailing-FAIL scan
-- cannot see a result printed only in a `line`/`detail` column.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg('case ' || case_num || ' (' || label || '): ' || detail, '; ' order by case_num)
    into v_bad
  from test_result
  where outcome not like 'PASS%';

  if v_bad is not null then
    raise exception 'ESCALATION AUTO-ASSIGNMENT / REASSIGNMENT AUTHORITY BROKEN: %', v_bad;
  end if;
end $$;

select case_num, label, outcome, detail from test_result order by case_num;

rollback;
