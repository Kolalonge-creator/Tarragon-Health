-- ===========================================================================
-- Live proof for 20260830224511_patient_reminder_groups.sql (chronic disease
-- monitoring spec §1.3 — doctor-configurable reading-entry reminder
-- frequency and patient grouping).
--
-- Run: npx supabase db query --linked -f packages/db/tests/patient_reminder_groups_rls.sql
-- Wrapped in BEGIN/ROLLBACK -- a verification script, not seed data.
--
-- Pattern (same as medication_issues_rls.sql): two fresh organisations, a
-- clinician + care_coordinator + patient in each, all built inline via
-- gen_random_uuid() rather than relying on any pre-existing QA account --
-- this test does not touch profile_access or any other table with known
-- live drift.
--
-- Checks:
--   1. A clinician can set a patient-scope reminder rule for a patient in
--      their own org.
--   2. A clinician can create a group, add a patient, and set the group's
--      frequency -- and private.queue_vitals_reminders()'s precedence picks
--      the group rule over the org's condition/global rules.
--   3. A clinician CANNOT set a patient-scope rule for a patient in a
--      DIFFERENT org (organisation_id spoofed to their own org, patient_id
--      pointing at the other org's patient) -- the org-membership guard on
--      the referenced patient, not just the caller's own org, is what this
--      catches.
--   4. A clinician CANNOT add a foreign-org patient into their own org's
--      group -- same class of cross-tenant leak, on group membership.
--   5. A care_coordinator is rejected outright when attempting to set a
--      patient-scope rule -- role = 'clinician' only, is_org_staff() is
--      deliberately NOT used for this write (it would wrongly admit the
--      coordinator).
--   6. A clinician CANNOT set a condition- or global-scope rule -- those
--      tiers stay admin-only.
--
-- TO CONFIRM THIS TEST DISCRIMINATES, break it on purpose: comment out the
-- patient-organisation exists() clause in
-- vitals_reminder_rules_clinician_insert and re-run -- check 3 must FAIL,
-- showing the cross-org rule silently accepted.
-- ===========================================================================

begin;

create temporary table prg_fixture(k text primary key, v uuid) on commit drop;
create temporary table prg_result(
  check_name text,
  role       text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

-- --------------------------------------------------------------------------
-- Fixtures: two organisations, each with a clinician, a care_coordinator,
-- and a patient with an active hypertension care plan (so the condition-tier
-- fallback is real and distinguishable from the group-tier override).
-- --------------------------------------------------------------------------
do $$
declare
  r record;
begin
  insert into prg_fixture(k, v) values ('org_a', gen_random_uuid()), ('org_b', gen_random_uuid());

  insert into public.organisations (id, name, type)
  values
    ((select v from prg_fixture where k = 'org_a'), 'PRG Test Org A', 'clinic'),
    ((select v from prg_fixture where k = 'org_b'), 'PRG Test Org B', 'clinic');

  for r in select * from (values
      ('clinician_a', 'clinician', 'org_a'),
      ('coordinator_a', 'care_coordinator', 'org_a'),
      ('patient_a', 'patient', 'org_a'),
      ('clinician_b', 'clinician', 'org_b'),
      ('patient_b', 'patient', 'org_b')
    ) as t(key_name, role_name, org_key)
  loop
    insert into prg_fixture(k, v) values (r.key_name, gen_random_uuid());

    insert into auth.users (id, email)
    values ((select v from prg_fixture where k = r.key_name),
            format('prgtest.%s@example.com', r.key_name));

    insert into public.profiles (id, organisation_id, role, full_name)
    values ((select v from prg_fixture where k = r.key_name),
            (select v from prg_fixture where k = r.org_key),
            r.role_name::public.user_role, format('PRG Test %s', r.key_name))
    on conflict (id) do update
      set organisation_id = excluded.organisation_id,
          role            = excluded.role,
          full_name       = excluded.full_name;
  end loop;

  insert into public.care_plans (organisation_id, patient_id, condition, status)
  values
    ((select v from prg_fixture where k = 'org_a'), (select v from prg_fixture where k = 'patient_a'),
     'hypertension', 'active');
end $$;

-- ==========================================================================
-- 1. Clinician sets a patient-scope rule for a patient in their own org.
-- ==========================================================================
do $$
declare
  v_clinician uuid := (select v from prg_fixture where k = 'clinician_a');
  v_org       uuid := (select v from prg_fixture where k = 'org_a');
  v_patient   uuid := (select v from prg_fixture where k = 'patient_a');
  v_rule_id   uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.vitals_reminder_rules (organisation_id, patient_id, frequency_days)
  values (v_org, v_patient, 3)
  returning id into v_rule_id;

  reset role;

  insert into prg_result values
    ('clinician sets a patient-scope rule in their own org', 'clinician',
     case when v_rule_id is not null then 'inserted' else 'null' end, 'inserted',
     case when v_rule_id is not null then 'PASS' else 'FAIL' end);
  if v_rule_id is null then
    raise exception 'clinician could not set a patient-scope reminder rule for their own patient';
  end if;
end $$;

-- ==========================================================================
-- 2. Clinician creates a group, adds the patient, sets the group's
-- frequency -- and private.queue_vitals_reminders() itself (not a
-- re-implementation of its precedence logic) picks the group rule over the
-- condition-tier rule also on file for this patient.
-- ==========================================================================
do $$
declare
  v_clinician uuid := (select v from prg_fixture where k = 'clinician_a');
  v_org       uuid := (select v from prg_fixture where k = 'org_a');
  v_patient   uuid := (select v from prg_fixture where k = 'patient_a');
  v_group_id  uuid;
  v_queued_days integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.patient_reminder_groups (organisation_id, name)
  values (v_org, 'PRG Test high-risk')
  returning id into v_group_id;

  insert into public.patient_reminder_group_members (group_id, patient_id)
  values (v_group_id, v_patient);

  insert into public.vitals_reminder_rules (organisation_id, group_id, frequency_days)
  values (v_org, v_group_id, 5);

  reset role;

  insert into prg_fixture(k, v) values ('group_a', v_group_id);

  -- Also set a condition-tier rule (hypertension, 14 days) to prove the
  -- group tier -- not just "some" tier -- is what precedence actually picks.
  -- Condition/global tiers are admin-only, so this runs as the unrestricted
  -- connecting role, not the clinician (checks 5/6 below cover that a
  -- clinician themselves cannot write this tier). The patient-scope rule
  -- from check 1 is removed first so the group tier is the one actually
  -- under test, not masked by the higher patient tier.
  delete from public.vitals_reminder_rules where patient_id = v_patient;
  insert into public.vitals_reminder_rules (organisation_id, condition, frequency_days)
  values (v_org, 'hypertension', 14);

  -- Backdate the patient so they are "due" today under any of the candidate
  -- frequencies, then run the real cron function (not a hand-copy of its
  -- logic) and read back the frequency_days it actually queued.
  update public.profiles set created_at = now() - interval '90 days' where id = v_patient;
  perform private.queue_vitals_reminders();

  select (payload->>'frequency_days')::integer into v_queued_days
  from public.notifications
  where recipient_id = v_patient and template = 'vitals_reminder'
  order by created_at desc
  limit 1;

  insert into prg_result values
    ('queue_vitals_reminders() picks the group tier over condition tier', 'clinician',
     coalesce(v_queued_days::text, 'null'), '5',
     case when v_queued_days = 5 then 'PASS' else 'FAIL' end);
  if v_queued_days is distinct from 5 then
    raise exception 'group tier did not win precedence: queue_vitals_reminders() used frequency_days = %, expected 5', v_queued_days;
  end if;
end $$;

-- ==========================================================================
-- 3. Clinician cannot set a patient-scope rule for a patient in a DIFFERENT
-- org, even with organisation_id set to their own org.
-- ==========================================================================
do $$
declare
  v_clinician uuid := (select v from prg_fixture where k = 'clinician_a');
  v_org_a     uuid := (select v from prg_fixture where k = 'org_a');
  v_patient_b uuid := (select v from prg_fixture where k = 'patient_b');
  v_rejected  boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    insert into public.vitals_reminder_rules (organisation_id, patient_id, frequency_days)
    values (v_org_a, v_patient_b, 3);
  exception when insufficient_privilege then
    v_rejected := true;
  end;

  reset role;

  insert into prg_result values
    ('clinician cannot set a cross-org patient rule', 'clinician',
     case when v_rejected then 'rejected' else 'allowed' end, 'rejected',
     case when v_rejected then 'PASS' else 'FAIL' end);
  if not v_rejected then
    raise exception 'LEAK: clinician_a set a reminder rule for org_b''s patient';
  end if;
end $$;

-- ==========================================================================
-- 4. Clinician cannot add a foreign-org patient into their own org's group.
-- ==========================================================================
do $$
declare
  v_clinician uuid := (select v from prg_fixture where k = 'clinician_a');
  v_group_id  uuid := (select v from prg_fixture where k = 'group_a');
  v_patient_b uuid := (select v from prg_fixture where k = 'patient_b');
  v_rejected  boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    insert into public.patient_reminder_group_members (group_id, patient_id)
    values (v_group_id, v_patient_b);
  exception when insufficient_privilege then
    v_rejected := true;
  end;

  reset role;

  insert into prg_result values
    ('clinician cannot add a cross-org patient to their group', 'clinician',
     case when v_rejected then 'rejected' else 'allowed' end, 'rejected',
     case when v_rejected then 'PASS' else 'FAIL' end);
  if not v_rejected then
    raise exception 'LEAK: clinician_a added org_b''s patient into an org_a group';
  end if;
end $$;

-- ==========================================================================
-- 5. A care_coordinator is rejected outright -- role = 'clinician' only.
-- ==========================================================================
do $$
declare
  v_coordinator uuid := (select v from prg_fixture where k = 'coordinator_a');
  v_org         uuid := (select v from prg_fixture where k = 'org_a');
  v_patient     uuid := (select v from prg_fixture where k = 'patient_a');
  v_rejected    boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coordinator::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    insert into public.vitals_reminder_rules (organisation_id, patient_id, frequency_days)
    values (v_org, v_patient, 7);
  exception when insufficient_privilege then
    v_rejected := true;
  end;

  reset role;

  insert into prg_result values
    ('care_coordinator cannot set a reminder frequency', 'care_coordinator',
     case when v_rejected then 'rejected' else 'allowed' end, 'rejected',
     case when v_rejected then 'PASS' else 'FAIL' end);
  if not v_rejected then
    raise exception 'GAP: care_coordinator was able to set a reading-entry reminder frequency';
  end if;
end $$;

-- ==========================================================================
-- 6. Clinician cannot set a condition- or global-scope rule -- admin-only.
-- ==========================================================================
do $$
declare
  v_clinician uuid := (select v from prg_fixture where k = 'clinician_a');
  v_org       uuid := (select v from prg_fixture where k = 'org_a');
  v_rejected_condition boolean := false;
  v_rejected_global    boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    insert into public.vitals_reminder_rules (organisation_id, condition, frequency_days)
    values (v_org, 'diabetes', 10);
  exception when insufficient_privilege then
    v_rejected_condition := true;
  end;

  begin
    insert into public.vitals_reminder_rules (organisation_id, frequency_days)
    values (v_org, 20);
  exception when insufficient_privilege then
    v_rejected_global := true;
  end;

  reset role;

  insert into prg_result values
    ('clinician cannot set a condition-scope rule', 'clinician',
     case when v_rejected_condition then 'rejected' else 'allowed' end, 'rejected',
     case when v_rejected_condition then 'PASS' else 'FAIL' end);
  insert into prg_result values
    ('clinician cannot set a global-scope rule', 'clinician',
     case when v_rejected_global then 'rejected' else 'allowed' end, 'rejected',
     case when v_rejected_global then 'PASS' else 'FAIL' end);
  if not v_rejected_condition or not v_rejected_global then
    raise exception 'GAP: clinician set a condition- and/or global-scope reminder rule (admin-only tiers)';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from prg_result
order by verdict desc, check_name;

rollback;
