-- ===========================================================================
-- Live proof for the 2026-08-29 Patient Safety gap-closure pass (§89.4 wrong-
-- patient prevention, §89.12 safeguarding):
--   20260829212900_wrong_patient_identity_confirmation.sql
--   20260829213000_alert_type_code_safeguarding_concern.sql
--   20260829213100_safeguarding_concerns.sql
--
-- Run: npx supabase db query --linked -f packages/db/tests/wrong_patient_confirm_and_safeguarding_rls.sql
-- Wrapped in BEGIN/ROLLBACK -- a verification script, not seed data; it
-- always leaves the database exactly as it found it. Session-simulation
-- pattern (set_config('request.jwt.claims', ...) + `set local role
-- authenticated`) matches packages/db/tests/medication_issues_rls.sql.
--
-- Checks:
--   1. Finalizing a clinical_encounter_notes draft WITHOUT identity_confirmed
--      is rejected (insufficient_privilege from the attribution trigger).
--   2. Finalizing WITH identity_confirmed=true succeeds, and
--      identity_confirmed_by/at are server-stamped from the caller's own
--      clinical_staff.id -- a spoofed identity_confirmed_by is silently
--      overwritten, not trusted.
--   3. Resolving an escalation WITHOUT identity_confirmed is rejected;
--      REFERRING one is unaffected (the gate is resolve-only by design).
--   4. Resolving WITH identity_confirmed=true succeeds and stamps
--      identity_confirmed_by/at from auth.uid(), spoof-resisted.
--   5. Any org staff (including care_coordinator) can file a
--      safeguarding_concerns row; filing one auto-opens an
--      urgent_escalation clinician_alerts row with
--      type_code='safeguarding_concern'.
--   6. A Tier 1 clinician who did NOT file a concern reads ZERO rows from
--      safeguarding_concerns (narrower visibility than clinical_incident_
--      reports is the whole point of this table) -- but the reporter
--      themselves CAN still read their own filed row.
--   7. A Tier 3 clinician reads every concern in the org.
--   8. A Tier 1 clinician attempting to move a concern to 'under_review' is
--      rejected; a Tier 3 clinician succeeds and is stamped as reviewer.
--      NOTE on rejection shape: a Tier 1 who isn't the reporter can't even
--      SELECT the row (check 6), so their UPDATE's WHERE clause silently
--      matches 0 rows -- Postgres never gets far enough to run the
--      attribution trigger's explicit insufficient_privilege raise. This
--      check therefore confirms the row's status is untouched afterward
--      (read back as an elevated role), not that an exception was thrown --
--      a silent no-op is an equally valid (arguably stronger, since it
--      leaks nothing) rejection outcome.
--
-- TO CONFIRM THIS TEST DISCRIMINATES, break it on purpose: comment out the
-- `if not new.identity_confirmed then raise exception ...` block in
-- private.enforce_escalation_identity_confirm() and re-run -- check 3 must
-- FAIL, showing an escalation resolved with identity_confirmed still false.
-- ===========================================================================

begin;

create temporary table wpc_fixture(k text primary key, v uuid) on commit drop;
create temporary table wpc_result(
  check_name text, role text, observed text, expected text, verdict text
) on commit drop;

-- --------------------------------------------------------------------------
-- Fixtures: reuse an existing patient-bearing org; fresh probe profiles for
-- a patient, a Tier 1 clinician, and a Tier 3 clinician + Care Coordinator.
-- --------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  r     record;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;

  if v_org is null then
    raise exception 'no organisation has patient profiles -- cannot run this test';
  end if;

  insert into wpc_fixture(k, v) values ('org', v_org);

  for r in select * from (values
      ('patient', 'patient'), ('tier1', 'clinician'), ('tier3', 'clinician'), ('coordinator', 'care_coordinator')
    ) as t(key_name, role_name)
  loop
    insert into wpc_fixture(k, v) values (r.key_name, gen_random_uuid());

    insert into auth.users (id, email)
    values ((select v from wpc_fixture where k = r.key_name),
            format('wpctest.%s@example.com', r.key_name));

    insert into public.profiles (id, organisation_id, role, full_name, date_of_birth)
    values ((select v from wpc_fixture where k = r.key_name),
            v_org, r.role_name::public.user_role, format('WPC Test %s', r.key_name),
            case when r.key_name = 'patient' then date '1990-01-01' else null end)
    on conflict (id) do update
      set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  end loop;

  insert into public.clinical_staff
    (organisation_id, profile_id, full_name, doctor_tier, active, license_verified_at)
  values
    (v_org, (select v from wpc_fixture where k = 'tier1'), 'WPC Test Tier1', 'tier_1'::public.doctor_tier, true, now()),
    (v_org, (select v from wpc_fixture where k = 'tier3'), 'WPC Test Tier3', 'tier_3'::public.doctor_tier, true, now())
  on conflict do nothing;
end $$;

-- ==========================================================================
-- 1/2. Encounter note: finalize rejected without identity confirmation,
-- succeeds and stamps correctly with it.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from wpc_fixture where k = 'org');
  v_patient uuid := (select v from wpc_fixture where k = 'patient');
  v_tier1 uuid := (select v from wpc_fixture where k = 'tier1');
  v_note_id uuid;
  v_rejected boolean := false;
  v_stamped_by uuid;
  v_expected_staff uuid;
  v_spoofed uuid := gen_random_uuid();
begin
  select id into v_expected_staff from public.clinical_staff
  where profile_id = v_tier1 and organisation_id = v_org and active;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tier1::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.clinical_encounter_notes
    (organisation_id, patient_id, encounter_type, reason_for_encounter)
  values (v_org, v_patient, 'other', 'WPC test encounter')
  returning id into v_note_id;

  begin
    update public.clinical_encounter_notes
    set status = 'finalized', outcome = 'reassurance'
    where id = v_note_id;
  exception when insufficient_privilege then
    v_rejected := true;
  end;

  reset role;

  insert into wpc_result values
    ('finalize rejected without identity_confirmed', 'tier1',
     case when v_rejected then 'rejected' else 'allowed' end, 'rejected',
     case when v_rejected then 'PASS' else 'FAIL' end);
  if not v_rejected then
    raise exception 'GAP: encounter note finalized to status=finalized with identity_confirmed still false';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tier1::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Spoof attempt: claim identity_confirmed_by is someone else. Must come
  -- back as the caller's own clinical_staff.id.
  update public.clinical_encounter_notes
  set status = 'finalized', outcome = 'reassurance',
      identity_confirmed = true, identity_confirmed_by = v_spoofed
  where id = v_note_id
  returning identity_confirmed_by into v_stamped_by;

  reset role;

  insert into wpc_result values
    ('finalize succeeds with identity_confirmed, stamp spoof resisted', 'tier1',
     v_stamped_by::text, v_expected_staff::text,
     case when v_stamped_by = v_expected_staff then 'PASS' else 'FAIL' end);
  if v_stamped_by is distinct from v_expected_staff then
    raise exception 'SPOOFABLE: identity_confirmed_by = % (expected tier1''s own clinical_staff.id %)',
      v_stamped_by, v_expected_staff;
  end if;
end $$;

-- ==========================================================================
-- 3/4. Escalation: resolve rejected without identity confirmation; referring
-- is unaffected; resolve succeeds and stamps correctly with confirmation.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from wpc_fixture where k = 'org');
  v_patient uuid := (select v from wpc_fixture where k = 'patient');
  v_tier1 uuid := (select v from wpc_fixture where k = 'tier1');
  v_esc_id uuid;
  v_esc_id2 uuid;
  v_rejected boolean := false;
  v_referred_ok boolean := false;
  v_stamped_by uuid;
  v_spoofed uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tier1::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.escalations (organisation_id, patient_id, reason)
  values (v_org, v_patient, 'WPC test escalation A')
  returning id into v_esc_id;

  insert into public.escalations (organisation_id, patient_id, reason)
  values (v_org, v_patient, 'WPC test escalation B')
  returning id into v_esc_id2;

  begin
    update public.escalations
    set status = 'resolved', resolution_note = 'attempted without confirming identity'
    where id = v_esc_id;
  exception when insufficient_privilege then
    v_rejected := true;
  end;

  -- Control: referring (not resolving) is untouched by the gate.
  begin
    update public.escalations
    set status = 'referred', resolution_note = 'referred on, not resolved'
    where id = v_esc_id2;
    v_referred_ok := true;
  exception when insufficient_privilege then
    v_referred_ok := false;
  end;

  reset role;

  insert into wpc_result values
    ('resolve rejected without identity_confirmed', 'tier1',
     case when v_rejected then 'rejected' else 'allowed' end, 'rejected',
     case when v_rejected then 'PASS' else 'FAIL' end);
  if not v_rejected then
    raise exception 'GAP: escalation resolved with identity_confirmed still false';
  end if;

  insert into wpc_result values
    ('refer unaffected by identity-confirm gate', 'tier1',
     case when v_referred_ok then 'allowed' else 'rejected' end, 'allowed',
     case when v_referred_ok then 'PASS' else 'FAIL' end);
  if not v_referred_ok then
    raise exception 'REGRESSION: referring an escalation now requires identity_confirmed -- the gate should be resolve-only';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tier1::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  update public.escalations
  set status = 'resolved', resolution_note = 'confirmed and resolved',
      identity_confirmed = true, identity_confirmed_by = v_spoofed
  where id = v_esc_id
  returning identity_confirmed_by into v_stamped_by;

  reset role;

  insert into wpc_result values
    ('resolve succeeds with identity_confirmed, stamp spoof resisted', 'tier1',
     v_stamped_by::text, v_tier1::text,
     case when v_stamped_by = v_tier1 then 'PASS' else 'FAIL' end);
  if v_stamped_by is distinct from v_tier1 then
    raise exception 'SPOOFABLE: escalations.identity_confirmed_by = % (expected caller''s own auth.uid() %)',
      v_stamped_by, v_tier1;
  end if;
end $$;

-- ==========================================================================
-- 5. Any org staff (care_coordinator included) can file a safeguarding
-- concern; filing one auto-opens a matching clinician_alerts row.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from wpc_fixture where k = 'org');
  v_patient uuid := (select v from wpc_fixture where k = 'patient');
  v_coordinator uuid := (select v from wpc_fixture where k = 'coordinator');
  v_concern_id uuid;
  v_alert_id uuid;
  v_alert_level text;
  v_alert_type text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coordinator::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.safeguarding_concerns
    (organisation_id, patient_id, concern_category, description)
  values (v_org, v_patient, 'child_safety', 'WPC test concern filed by care coordinator')
  returning id, clinician_alert_id into v_concern_id, v_alert_id;

  reset role;

  insert into wpc_fixture(k, v) values ('concern_id', v_concern_id);

  insert into wpc_result values
    ('care_coordinator can file a safeguarding concern', 'coordinator',
     case when v_concern_id is not null then 'inserted' else 'null' end, 'inserted',
     case when v_concern_id is not null then 'PASS' else 'FAIL' end);
  if v_concern_id is null then
    raise exception 'care_coordinator could not file a safeguarding concern';
  end if;

  select level::text, type_code::text into v_alert_level, v_alert_type
  from public.clinician_alerts where id = v_alert_id;

  insert into wpc_result values
    ('filing auto-opens urgent_escalation/safeguarding_concern alert', 'coordinator',
     format('%s/%s', v_alert_level, v_alert_type), 'urgent_escalation/safeguarding_concern',
     case when v_alert_level = 'urgent_escalation' and v_alert_type = 'safeguarding_concern' then 'PASS' else 'FAIL' end);
  if v_alert_level is distinct from 'urgent_escalation' or v_alert_type is distinct from 'safeguarding_concern' then
    raise exception 'GAP: safeguarding concern did not open the expected clinician_alerts row (got level=%, type=%)',
      v_alert_level, v_alert_type;
  end if;
end $$;

-- ==========================================================================
-- 6. A Tier 1 clinician who did NOT file the concern reads ZERO rows; the
-- reporter (care_coordinator) can still read their own.
-- ==========================================================================
do $$
declare
  v_tier1 uuid := (select v from wpc_fixture where k = 'tier1');
  v_coordinator uuid := (select v from wpc_fixture where k = 'coordinator');
  v_concern_id uuid := (select v from wpc_fixture where k = 'concern_id');
  v_tier1_count bigint;
  v_reporter_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tier1::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_tier1_count from public.safeguarding_concerns;
  reset role;

  insert into wpc_result values
    ('Tier 1 (not reporter, not reviewer) reads 0 concerns', 'tier1', v_tier1_count::text, '0',
     case when v_tier1_count = 0 then 'PASS' else 'FAIL' end);
  if v_tier1_count <> 0 then
    raise exception 'LEAK: bare Tier 1 clinician reads % safeguarding_concerns row(s) they did not file and cannot review', v_tier1_count;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coordinator::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_reporter_count from public.safeguarding_concerns
  where id = v_concern_id;
  reset role;

  insert into wpc_result values
    ('reporter can still read their own filed concern', 'coordinator', v_reporter_count::text, '1',
     case when v_reporter_count = 1 then 'PASS' else 'FAIL' end);
  if v_reporter_count <> 1 then
    raise exception 'GAP: care_coordinator cannot read the safeguarding concern they themselves filed';
  end if;
end $$;

-- ==========================================================================
-- 7/8. Tier 3 reads every concern in the org and can move one into review;
-- Tier 1 is rejected attempting the same review transition.
-- ==========================================================================
do $$
declare
  v_tier1 uuid := (select v from wpc_fixture where k = 'tier1');
  v_tier3 uuid := (select v from wpc_fixture where k = 'tier3');
  v_coordinator uuid := (select v from wpc_fixture where k = 'coordinator');
  v_org uuid := (select v from wpc_fixture where k = 'org');
  v_concern_id uuid := (select v from wpc_fixture where k = 'concern_id');
  v_tier3_count bigint;
  v_tier1_rejected boolean := false;
  v_tier1_status_after text;
  v_reporter_rejected boolean := false;
  v_reporter_status_after text;
  v_tier3_reviewer uuid;
  v_expected_staff uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tier3::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_tier3_count from public.safeguarding_concerns where organisation_id = v_org;
  reset role;

  insert into wpc_result values
    ('Tier 3 reads every concern in the org', 'tier3', v_tier3_count::text, '>= 1',
     case when v_tier3_count >= 1 then 'PASS' else 'FAIL' end);
  if v_tier3_count < 1 then
    raise exception 'Tier 3 clinician cannot read safeguarding_concerns at all -- can_review_safeguarding_concern is broken';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tier1::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.safeguarding_concerns set status = 'under_review' where id = v_concern_id;
  exception when insufficient_privilege then
    v_tier1_rejected := true;
  end;
  reset role;

  -- Either the trigger raised (reporter case: row is visible, tier check
  -- explicitly fires) or RLS never let the row become visible to UPDATE at
  -- all (non-reporter case: silent 0-row match) -- both are a real denial.
  -- Read the status back as an elevated role to prove which, and either way
  -- confirm it is still 'open'.
  select status into v_tier1_status_after from public.safeguarding_concerns where id = v_concern_id;

  insert into wpc_result values
    ('Tier 1 cannot move a concern into review', 'tier1',
     case when v_tier1_rejected then 'rejected (exception)' when v_tier1_status_after = 'open' then 'rejected (0 rows matched)' else 'allowed' end,
     'rejected',
     case when v_tier1_rejected or v_tier1_status_after = 'open' then 'PASS' else 'FAIL' end);
  if not v_tier1_rejected and v_tier1_status_after <> 'open' then
    raise exception 'GAP: Tier 1 clinician moved a safeguarding concern into review -- should require Tier 3+/Director';
  end if;

  -- Stronger form of the same check: the REPORTER (care_coordinator, who
  -- filed this concern in check 5) CAN see the row via the reported_by=self
  -- carve-out, so this attempt reaches the trigger for real -- must be an
  -- actual insufficient_privilege raise, not a silent no-op, proving the
  -- attribution trigger's own tier check (not just RLS invisibility) is
  -- what's doing the work.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coordinator::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.safeguarding_concerns set status = 'under_review' where id = v_concern_id;
  exception when insufficient_privilege then
    v_reporter_rejected := true;
  end;
  reset role;

  select status into v_reporter_status_after from public.safeguarding_concerns where id = v_concern_id;

  insert into wpc_result values
    ('reporter (care_coordinator, visible to self) rejected by the TRIGGER itself', 'coordinator',
     case when v_reporter_rejected then 'exception raised' else 'no exception' end, 'exception raised',
     case when v_reporter_rejected and v_reporter_status_after = 'open' then 'PASS' else 'FAIL' end);
  if not v_reporter_rejected then
    raise exception 'GAP: the attribution trigger''s Tier 3+ check did not fire for a visible row -- care_coordinator (the reporter) moved their own concern into review with no exception';
  end if;
  if v_reporter_status_after <> 'open' then
    raise exception 'GAP: care_coordinator''s own concern changed status despite an exception being raised';
  end if;

  select id into v_expected_staff from public.clinical_staff
  where profile_id = v_tier3 and organisation_id = v_org and active;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tier3::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.safeguarding_concerns set status = 'under_review' where id = v_concern_id
  returning reviewed_by_staff into v_tier3_reviewer;
  reset role;

  insert into wpc_result values
    ('Tier 3 moves concern into review, stamped as reviewer', 'tier3',
     v_tier3_reviewer::text, v_expected_staff::text,
     case when v_tier3_reviewer = v_expected_staff then 'PASS' else 'FAIL' end);
  if v_tier3_reviewer is distinct from v_expected_staff then
    raise exception 'GAP: Tier 3 review did not stamp reviewed_by_staff as their own clinical_staff.id (got %, expected %)',
      v_tier3_reviewer, v_expected_staff;
  end if;
end $$;

select check_name, role, observed, expected, verdict
from wpc_result
order by verdict desc, check_name, role;

rollback;
