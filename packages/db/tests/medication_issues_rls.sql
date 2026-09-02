-- ===========================================================================
-- Live proof for the Pharmacy Engine §12.13/§12.16 additions
-- (20260828225453_medication_affordability_reports.sql,
-- 20260828225521_medication_dispense_flags.sql,
-- 20260828225826_medication_flags_stamp_resolver_attribution.sql,
-- 20260828230103_fix_medication_flags_stamp_also_on_insert.sql).
--
-- Run: npx supabase db query --linked -f packages/db/tests/medication_issues_rls.sql
-- Wrapped in BEGIN/ROLLBACK -- a verification script, not seed data; it
-- always leaves the database exactly as it found it.
--
-- Pattern (same as packages/db/tests/scoped_access_roles_rls.sql):
-- set_config('request.jwt.claims', ...) + `set local role authenticated`
-- simulates a real client session; `set local role` (not the connecting
-- superuser) is what makes this a real RLS test.
--
-- Checks:
--   1. Patient A can insert + read their own affordability report / concern
--      flag; cannot read Patient B's.
--   2. A bare `pharmacist`-role account reads ZERO rows from either table
--      directly (private.is_org_staff excludes it -- see
--      20260729234618_harden_is_org_staff_exclude_lab_partner.sql; pharmacist
--      access to this domain is only ever through pharmacist_flag_dispense()).
--   3. Org staff (clinician, care_coordinator) can read every row in the org,
--      including both patients' rows.
--   4. raised_by/raised_by_role on medication_dispense_flags is server-
--      stamped from the caller's own session -- a client-supplied value
--      (patient trying to claim raised_by_role = 'pharmacist') is silently
--      overwritten with the truth.
--   5. resolved_by/resolved_at on medication_affordability_reports and
--      reviewed_by/reviewed_at on medication_dispense_flags are server-
--      stamped, not client-settable, on BOTH insert and update (the class
--      of gap 20260828230103 closed -- an insert pre-set to
--      status='resolved' with a spoofed resolved_by must still get the
--      real caller's id, not the spoofed one).
--   6. A Care Coordinator (non-clinical-tier) is rejected by the DB when
--      attempting to move a dispense flag to 'reviewed'/'resolved' --
--      medication_dispense_flags_stamp_reviewed_by requires an ACTIVE
--      clinical_staff row, which a care_coordinator-role profile does not
--      have to gain by virtue of the role alone in this fixture.
--
-- TO CONFIRM THIS TEST DISCRIMINATES, break it on purpose: comment out the
-- `new.raised_by_role := ...` line in
-- private.stamp_medication_dispense_flag_raised_by() and re-run -- check 4
-- must FAIL, showing the patient's spoofed 'pharmacist' label surviving.
-- ===========================================================================

begin;

create temporary table mi_fixture(k text primary key, v uuid) on commit drop;
create temporary table mi_result(
  check_name text,
  role       text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

-- --------------------------------------------------------------------------
-- Fixtures: two patients + clinician + care_coordinator + pharmacist, all in
-- one organisation (reusing an existing patient-bearing org so RLS org-scope
-- checks are meaningful, same approach as scoped_access_roles_rls.sql).
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

  insert into mi_fixture(k, v) values ('org', v_org);

  for r in select * from (values
      ('patient_a', 'patient'), ('patient_b', 'patient'),
      ('clinician', 'clinician'), ('care_coordinator', 'care_coordinator'),
      ('pharmacist', 'pharmacist')
    ) as t(key_name, role_name)
  loop
    insert into mi_fixture(k, v) values (r.key_name, gen_random_uuid());

    insert into auth.users (id, email)
    values ((select v from mi_fixture where k = r.key_name),
            format('mitest.%s@example.com', r.key_name));

    insert into public.profiles (id, organisation_id, role, full_name)
    values ((select v from mi_fixture where k = r.key_name),
            v_org, r.role_name::public.user_role, format('MI Test %s', r.key_name))
    on conflict (id) do update
      set organisation_id = excluded.organisation_id,
          role            = excluded.role,
          full_name       = excluded.full_name;
  end loop;

  -- The clinician needs an ACTIVE clinical_staff row for the reviewer-stamp
  -- trigger to accept them (check 6's control case).
  insert into public.clinical_staff
    (organisation_id, profile_id, full_name, doctor_tier, active, license_verified_at)
  values (v_org, (select v from mi_fixture where k = 'clinician'), 'MI Test clinician',
          'tier_1'::public.doctor_tier, true, now())
  on conflict do nothing;
end $$;

-- ==========================================================================
-- 1/4. Patient A inserts their own rows; raised_by/raised_by_role on the
-- flag is server-truth, not the spoofed value the insert attempts.
-- ==========================================================================
do $$
declare
  v_patient_a uuid := (select v from mi_fixture where k = 'patient_a');
  v_org       uuid := (select v from mi_fixture where k = 'org');
  v_report_id uuid;
  v_flag_id   uuid;
  v_raised_by_role text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient_a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.medication_affordability_reports
    (organisation_id, patient_id, note)
  values (v_org, v_patient_a, 'Could not afford this at any pharmacy nearby')
  returning id into v_report_id;

  -- Spoof attempt: claim to be a pharmacist. raised_by_role must come back
  -- as the real caller's own role ('patient'), never the claimed one.
  insert into public.medication_dispense_flags
    (organisation_id, patient_id, flag_type, note, raised_by_role)
  values (v_org, v_patient_a, 'patient_query', 'Is this the right dose?', 'pharmacist')
  returning id, raised_by_role into v_flag_id, v_raised_by_role;

  reset role;

  insert into mi_fixture(k, v) values ('report_id', v_report_id), ('flag_id', v_flag_id);

  insert into mi_result values
    ('patient inserts own report', 'patient_a', case when v_report_id is not null then 'inserted' else 'null' end,
     'inserted', case when v_report_id is not null then 'PASS' else 'FAIL' end);
  if v_report_id is null then
    raise exception 'patient_a could not insert their own affordability report';
  end if;

  insert into mi_result values
    ('raised_by_role spoof resisted', 'patient_a', v_raised_by_role, 'patient',
     case when v_raised_by_role = 'patient' then 'PASS' else 'FAIL' end);
  if v_raised_by_role is distinct from 'patient' then
    raise exception 'SPOOFABLE: patient insert claimed raised_by_role=%, expected server-stamped ''patient''', v_raised_by_role;
  end if;
end $$;

-- ==========================================================================
-- 2. Patient A reads their own rows; cannot read Patient B's (0 rows on a
-- Patient-B-only filter, proven via a control insert for Patient B first).
-- ==========================================================================
do $$
declare
  v_patient_a uuid := (select v from mi_fixture where k = 'patient_a');
  v_patient_b uuid := (select v from mi_fixture where k = 'patient_b');
  v_org       uuid := (select v from mi_fixture where k = 'org');
  v_own_count bigint;
  v_cross_count bigint;
begin
  -- Patient B's own row, inserted as Patient B (control: proves the row
  -- really exists before checking Patient A cannot see it).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient_b::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.medication_dispense_flags (organisation_id, patient_id, flag_type, note)
  values (v_org, v_patient_b, 'patient_query', 'Patient B''s own concern');
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient_a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_own_count from public.medication_dispense_flags where patient_id = v_patient_a;
  select count(*) into v_cross_count from public.medication_dispense_flags where patient_id = v_patient_b;
  reset role;

  insert into mi_result values
    ('patient reads own flags', 'patient_a', v_own_count::text, '>= 1',
     case when v_own_count >= 1 then 'PASS' else 'FAIL' end);
  if v_own_count < 1 then
    raise exception 'patient_a cannot read their own flag row';
  end if;

  insert into mi_result values
    ('patient reads other patient flags', 'patient_a', v_cross_count::text, '0',
     case when v_cross_count = 0 then 'PASS' else 'FAIL' end);
  if v_cross_count <> 0 then
    raise exception 'LEAK: patient_a reads % of patient_b''s medication_dispense_flags rows', v_cross_count;
  end if;
end $$;

-- ==========================================================================
-- 3. pharmacist reads ZERO rows directly from either table (is_org_staff
-- exclusion) -- the only pharmacist path into this domain is
-- pharmacist_flag_dispense(), not raw table access.
-- ==========================================================================
do $$
declare
  v_id uuid := (select v from mi_fixture where k = 'pharmacist');
  v_reports bigint; v_flags bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_reports from public.medication_affordability_reports;
  select count(*) into v_flags from public.medication_dispense_flags;
  reset role;

  insert into mi_result values
    ('pharmacist reads affordability_reports', 'pharmacist', v_reports::text, '0',
     case when v_reports = 0 then 'PASS' else 'FAIL' end);
  insert into mi_result values
    ('pharmacist reads dispense_flags', 'pharmacist', v_flags::text, '0',
     case when v_flags = 0 then 'PASS' else 'FAIL' end);
  if v_reports <> 0 or v_flags <> 0 then
    raise exception 'LEAK: bare pharmacist role reads % reports / % flags directly (expected 0/0)',
      v_reports, v_flags;
  end if;
end $$;

-- ==========================================================================
-- 4. Org staff (clinician, care_coordinator) see every row in the org,
-- including both patients'.
-- ==========================================================================
do $$
declare
  v_role text; v_id uuid; v_count bigint;
  v_patient_a uuid := (select v from mi_fixture where k = 'patient_a');
  v_patient_b uuid := (select v from mi_fixture where k = 'patient_b');
begin
  foreach v_role in array array['clinician', 'care_coordinator'] loop
    v_id := (select v from mi_fixture where k = v_role);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_id::text, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_count from public.medication_dispense_flags
    where patient_id in (v_patient_a, v_patient_b);
    reset role;

    insert into mi_result values
      ('org staff reads both patients'' flags', v_role, v_count::text, '>= 2',
       case when v_count >= 2 then 'PASS' else 'FAIL' end);
    if v_count < 2 then
      raise exception '% cannot see both patients'' flags (sees %)', v_role, v_count;
    end if;
  end loop;
end $$;

-- ==========================================================================
-- 5. resolved_by/reviewed_by are server-stamped, never the spoofed value,
-- on BOTH insert-already-resolved and update-to-resolved.
-- ==========================================================================
do $$
declare
  v_clinician uuid := (select v from mi_fixture where k = 'clinician');
  v_coordinator uuid := (select v from mi_fixture where k = 'care_coordinator');
  v_org       uuid := (select v from mi_fixture where k = 'org');
  v_patient_a uuid := (select v from mi_fixture where k = 'patient_a');
  v_report_id uuid := (select v from mi_fixture where k = 'report_id');
  v_flag_id   uuid := (select v from mi_fixture where k = 'flag_id');
  v_spoofed_id uuid := gen_random_uuid();
  v_resolved_by uuid;
  v_reviewed_by uuid;
  v_expected_staff_id uuid;
  v_insert_report_id uuid;
  v_insert_resolved_by uuid;
begin
  -- UPDATE path: care_coordinator resolves the affordability report,
  -- attempting to spoof resolved_by -- must come back as their own id.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coordinator::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.medication_affordability_reports
  set status = 'resolved', resolution_action = 'care_coordinator_intervention',
      resolution_note = 'Helped find a lower-cost pharmacy', resolved_by = v_spoofed_id
  where id = v_report_id
  returning resolved_by into v_resolved_by;
  reset role;

  insert into mi_result values
    ('resolved_by spoof resisted (update)', 'care_coordinator', v_resolved_by::text, v_coordinator::text,
     case when v_resolved_by = v_coordinator then 'PASS' else 'FAIL' end);
  if v_resolved_by is distinct from v_coordinator then
    raise exception 'SPOOFABLE: resolved_by = % (expected coordinator''s own id %)', v_resolved_by, v_coordinator;
  end if;

  -- INSERT path (the class of gap 20260828230103 closed): insert a report
  -- already status='resolved' with a spoofed resolved_by.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coordinator::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.medication_affordability_reports
    (organisation_id, patient_id, status, resolution_action, resolution_note, resolved_by)
  values (v_org, v_patient_a, 'resolved', 'other', 'pre-resolved insert attempt', v_spoofed_id)
  returning id, resolved_by into v_insert_report_id, v_insert_resolved_by;
  reset role;

  insert into mi_result values
    ('resolved_by spoof resisted (insert)', 'care_coordinator', v_insert_resolved_by::text, v_coordinator::text,
     case when v_insert_resolved_by = v_coordinator then 'PASS' else 'FAIL' end);
  if v_insert_resolved_by is distinct from v_coordinator then
    raise exception 'SPOOFABLE ON INSERT: resolved_by = % (expected %)', v_insert_resolved_by, v_coordinator;
  end if;

  -- Dispense flag: clinician resolves, spoofing reviewed_by -- must come
  -- back as the clinician's own clinical_staff.id, not the spoofed value.
  select id into v_expected_staff_id from public.clinical_staff
  where profile_id = v_clinician and organisation_id = v_org and active;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.medication_dispense_flags
  set status = 'resolved', resolution_note = 'Confirmed dose is correct', reviewed_by = v_spoofed_id
  where id = v_flag_id
  returning reviewed_by into v_reviewed_by;
  reset role;

  insert into mi_result values
    ('reviewed_by spoof resisted', 'clinician', v_reviewed_by::text, v_expected_staff_id::text,
     case when v_reviewed_by = v_expected_staff_id then 'PASS' else 'FAIL' end);
  if v_reviewed_by is distinct from v_expected_staff_id then
    raise exception 'SPOOFABLE: reviewed_by = % (expected clinician''s own clinical_staff.id %)',
      v_reviewed_by, v_expected_staff_id;
  end if;
end $$;

-- ==========================================================================
-- 6. A Care Coordinator cannot move a dispense flag to reviewed/resolved --
-- the DB rejects it outright (no active clinical_staff row), independent of
-- the page-level isClinicalTier gate.
-- ==========================================================================
do $$
declare
  v_coordinator uuid := (select v from mi_fixture where k = 'care_coordinator');
  v_org         uuid := (select v from mi_fixture where k = 'org');
  v_patient_a   uuid := (select v from mi_fixture where k = 'patient_a');
  v_flag_id     uuid;
  v_rejected    boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coordinator::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.medication_dispense_flags (organisation_id, patient_id, flag_type, note)
  values (v_org, v_patient_a, 'other', 'Coordinator-raised, coordinator should not be able to resolve')
  returning id into v_flag_id;

  begin
    update public.medication_dispense_flags
    set status = 'resolved', resolution_note = 'Attempted coordinator resolution'
    where id = v_flag_id;
  exception when insufficient_privilege then
    v_rejected := true;
  end;

  reset role;

  insert into mi_result values
    ('care_coordinator resolve rejected', 'care_coordinator',
     case when v_rejected then 'rejected' else 'allowed' end, 'rejected',
     case when v_rejected then 'PASS' else 'FAIL' end);
  if not v_rejected then
    raise exception 'GAP: care_coordinator was able to resolve a medication_dispense_flags row without an active clinical_staff row';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from mi_result
order by verdict desc, check_name, role;

rollback;
