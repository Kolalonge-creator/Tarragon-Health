-- Tarragon Health v3, M1 exit test: invariant + RLS suite.
--
-- Run via `psql $DATABASE_URL -f this_file.sql` or the Supabase SQL editor / execute_sql MCP
-- tool against the project database. Wrapped in BEGIN/ROLLBACK -- this is a verification
-- script, not seed data; it always leaves the database exactly as it found it.
--
-- Pattern: set_config('request.jwt.claims', ...) + `set local role authenticated` simulates
-- each of the six user_role values, exactly as Supabase RLS behaves for real client sessions.
-- Running as the connecting superuser/service role would silently bypass RLS via table
-- ownership -- `set local role authenticated` is what makes this a real test.
--
-- Verified passing live against the project (koiplnmbgnqnbywhpjlf) on 2026-07-29 after fixing
-- three real bugs this suite caught (see git history around this file's introduction):
--   1. `authenticated` had no base table-level GRANT after the schema reset (RLS restricts
--      rows, but the role still needs the underlying SQL grant to query at all).
--   2. funder_reads_summary / consent_records_select allowed an institution_admin-role grantee
--      through via a valid consent_records row, which violates I9's absolute "zero rows on
--      every patient-scoped table, no exceptions" -- fixed by excluding institution_admin from
--      those policies regardless of any consent grant naming that profile.
--   3. lab_orders' base-table policy reused can_see_patient() (which includes patient
--      self-access), accidentally letting a patient query commission_minor directly instead
--      of being forced through the column-safe lab_orders_patient() function.
--
-- CI wiring (not yet done): this needs a `DATABASE_URL` pointed at a disposable/branch
-- database and a `pnpm --filter db test:rls` script that shells out to psql. Tracked as a
-- follow-up -- for now, re-run this manually via the Supabase MCP execute_sql tool whenever
-- RLS policies change.

begin;

-- ============================= fixture =============================
do $$
declare
  v_org_a uuid := gen_random_uuid();
  v_patient_a_profile uuid := gen_random_uuid();
  v_patient_b_profile uuid := gen_random_uuid();
  v_clinician_profile uuid := gen_random_uuid();
  v_coordinator_profile uuid := gen_random_uuid();
  v_institution_admin_profile uuid := gen_random_uuid();
  v_ops_admin_profile uuid := gen_random_uuid();
  v_superadmin_profile uuid := gen_random_uuid();
  v_funder_profile uuid := gen_random_uuid();
  v_patient_a_id uuid;
  v_patient_b_id uuid;
  v_dependant_id uuid;
  v_clinician_id uuid;
  v_protocol_id uuid;
  v_reading_id uuid;
  v_classification_id uuid;
  v_urgent_classification_id uuid;
  v_contact_id uuid;
begin
  -- Fake auth.users rows (skip the real signup trigger path -- direct insert for test speed).
  insert into auth.users (id, email) values
    (v_patient_a_profile, 'm1test.patient.a@example.com'),
    (v_patient_b_profile, 'm1test.patient.b@example.com'),
    (v_clinician_profile, 'm1test.clinician@example.com'),
    (v_coordinator_profile, 'm1test.coordinator@example.com'),
    (v_institution_admin_profile, 'm1test.institution@example.com'),
    (v_ops_admin_profile, 'm1test.ops@example.com'),
    (v_superadmin_profile, 'm1test.superadmin@example.com'),
    (v_funder_profile, 'm1test.funder@example.com');
  -- on_auth_user_created already created default 'patient' profiles rows for all eight --
  -- update roles/names instead of re-inserting.
  update profiles set role = 'patient', full_name = 'M1 Test Patient A' where id = v_patient_a_profile;
  update profiles set role = 'patient', full_name = 'M1 Test Patient B' where id = v_patient_b_profile;
  update profiles set role = 'clinician', full_name = 'M1 Test Clinician' where id = v_clinician_profile;
  update profiles set role = 'coordinator', full_name = 'M1 Test Coordinator' where id = v_coordinator_profile;
  update profiles set role = 'institution_admin', full_name = 'M1 Test Institution Admin' where id = v_institution_admin_profile;
  update profiles set role = 'ops_admin', full_name = 'M1 Test Ops Admin' where id = v_ops_admin_profile;
  update profiles set role = 'superadmin', full_name = 'M1 Test Superadmin' where id = v_superadmin_profile;
  -- a funder is modelled as an ordinary patient-role account (e.g. a paying family member),
  -- NEVER institution_admin -- see I9 fix note above.
  update profiles set role = 'patient', full_name = 'M1 Test Funder (family member)' where id = v_funder_profile;

  insert into organisations (id, name, contact_email) values (v_org_a, 'M1 Test Employer', 'hr@m1test.example.com');

  insert into patients (profile_id, date_of_birth, sex_at_birth) values (v_patient_a_profile, '1985-01-01', 'female')
    returning id into v_patient_a_id;
  insert into patients (profile_id, date_of_birth, sex_at_birth) values (v_patient_b_profile, '1990-01-01', 'male')
    returning id into v_patient_b_id;
  insert into patients (guardian_patient_id, date_of_birth, sex_at_birth) values (v_patient_a_id, current_date - interval '10 years', 'male')
    returning id into v_dependant_id;

  insert into clinicians (profile_id, mdcn_number, mdcn_expiry, indemnity_provider, indemnity_policy_no, indemnity_expiry, active)
    values (v_clinician_profile, 'MDCN-M1TEST-0001', current_date + interval '1 year',
            'M1 Test Indemnity Co', 'POL-0001', current_date + interval '1 year', true)
    returning id into v_clinician_id;

  insert into protocol_configs (code, version, ruleset, effective_from, approved_by, approved_at)
    values ('who_hearts', 'v0-provisional', '{"note":"conservative fallback"}'::jsonb, now() - interval '1 day', v_clinician_id, now())
    returning id into v_protocol_id;

  -- M4's enforce_device_capture_before_active_enrolment_trigger (added after this suite was
  -- first written) now blocks an active enrolment with zero captured devices -- this row keeps
  -- the fixture valid under that later invariant rather than leaving a stale, now-failing
  -- historical snapshot. Not itself under test here; M4's own exit-test suite covers the gate.
  insert into devices (patient_id, device_kind, make, model, arm_circumference_cm)
    values (v_patient_a_id, 'bp', 'M1 Test Devices Co', 'Fixture BP Cuff', 28.0);

  insert into enrolments (patient_id, programme_code, organisation_id, status, started_at, assigned_coordinator_id)
    values (v_patient_a_id, 'control', v_org_a, 'active', now(), v_coordinator_profile);

  -- I2: this insert should auto-fire the classify_reading_conservatively trigger.
  insert into readings (patient_id, type, systolic, diastolic, unit, taken_at, source, source_detail)
    values (v_patient_a_id, 'bp', 150, 95, 'mmHg', now(), 'patient_manual', 'm1-fixture')
    returning id into v_reading_id;
  select id into v_classification_id from triage_classifications where reading_id = v_reading_id;

  -- Manually promote a second classification to urgent (not reachable via the v0-provisional
  -- trigger, which only ever produces needs_review) to exercise I5's closure guard.
  insert into readings (patient_id, type, systolic, diastolic, unit, taken_at, source, source_detail)
    values (v_patient_a_id, 'bp', 195, 118, 'mmHg', now(), 'clinician_entered', v_clinician_id::text)
    returning id into v_reading_id;
  update triage_classifications set classification = 'urgent' where reading_id = v_reading_id
    returning id into v_urgent_classification_id;

  insert into clinical_contacts (patient_id, clinician_id, contact_type, started_at, ended_at, duration_seconds)
    values (v_patient_a_id, v_clinician_id, 'voice', now(), now() + interval '5 minutes', 300)
    returning id into v_contact_id;

  insert into consent_records (patient_id, scope, granted_to_profile_id, capture_method, captured_by)
    values (v_patient_a_id, 'funder_summary', v_funder_profile, 'in_app', v_patient_a_profile);

  create temp table m1_fixture_ids (k text primary key, v uuid) on commit drop;
  insert into m1_fixture_ids values
    ('org_a', v_org_a), ('patient_a_profile', v_patient_a_profile), ('patient_b_profile', v_patient_b_profile),
    ('patient_a_id', v_patient_a_id), ('patient_b_id', v_patient_b_id), ('dependant_id', v_dependant_id),
    ('clinician_profile', v_clinician_profile), ('clinician_id', v_clinician_id),
    ('coordinator_profile', v_coordinator_profile), ('institution_admin_profile', v_institution_admin_profile),
    ('ops_admin_profile', v_ops_admin_profile), ('superadmin_profile', v_superadmin_profile),
    ('funder_profile', v_funder_profile),
    ('protocol_id', v_protocol_id), ('classification_id', v_classification_id),
    ('urgent_classification_id', v_urgent_classification_id), ('contact_id', v_contact_id);
end $$;

-- ============================= I2: every reading -> exactly one classification =============================
do $$
declare v_readings int; v_classifications int;
begin
  select count(*) into v_readings from readings where patient_id = (select v from m1_fixture_ids where k = 'patient_a_id');
  select count(*) into v_classifications from triage_classifications where patient_id = (select v from m1_fixture_ids where k = 'patient_a_id');
  if v_readings <> v_classifications then
    raise exception 'I2 FAILED: % readings but % classifications', v_readings, v_classifications;
  end if;
  raise notice 'I2 PASSED: % readings, % classifications', v_readings, v_classifications;
end $$;

-- reading insert with no covering protocol should be blocked (I2's bootstrap guard: you cannot
-- log a reading before a real clinician has approved at least a v0-provisional ruleset).
do $$
declare v_other_patient uuid;
begin
  insert into patients (date_of_birth, sex_at_birth) values ('2000-01-01','female') returning id into v_other_patient;
  begin
    insert into readings (patient_id, type, value_numeric, unit, taken_at, source, source_detail)
      values (v_other_patient, 'weight', 70, 'kg', '2000-01-01', 'patient_manual', 'm1-fixture-no-protocol');
    raise exception 'I2 bootstrap-guard FAILED: reading was accepted with no covering protocol_configs row';
  exception when others then
    if sqlerrm like 'I2:%' then
      raise notice 'I2 bootstrap guard PASSED: %', sqlerrm;
    else
      raise;
    end if;
  end;
end $$;

-- ============================= Phase 2 L3: no clinical_notes signed until accountability_model
-- is deliberately confirmed on legal advice =============================
-- Added after this suite was first written (enforce_l3_accountability_model_confirmed_trigger).
-- Real production state has app_config.l3_set_by = null (nobody has made this decision yet) --
-- proves the guard actually blocks signing in that state, then confirms it so every later
-- clinical_notes insert in this suite (I5, I10) can proceed, matching a real post-go-live state.
do $$
declare
  v_patient_a_id uuid := (select v from m1_fixture_ids where k = 'patient_a_id');
  v_clinician_id uuid := (select v from m1_fixture_ids where k = 'clinician_id');
  v_superadmin_profile uuid := (select v from m1_fixture_ids where k = 'superadmin_profile');
begin
  if (select l3_set_by from app_config where id = true) is not null then
    raise exception 'L3 test setup FAILED: app_config.l3_set_by was already non-null before this test ran';
  end if;

  begin
    insert into clinical_notes (patient_id, clinician_id, note_type, body,
      accountability_model_at_signing, mdcn_number_at_signing)
      values (v_patient_a_id, v_clinician_id, 'review', 'Attempted note before L3 confirmation', 'tech_layer', 'MDCN-M1TEST-0001');
    raise exception 'L3 FAILED: clinical_notes row signed with l3_set_by still null';
  exception when others then
    if sqlerrm like 'L3:%' then raise notice 'L3 (blocks signing until confirmed) PASSED: %', sqlerrm; else raise; end if;
  end;

  update app_config set l3_accountability_model_legal_advice = true,
    l3_set_by = v_superadmin_profile, l3_set_at = now() where id = true;
  raise notice 'L3 (accountability_model confirmed for the rest of this suite) done';
end $$;

-- ============================= I5: urgent/emergency closure requires voice/sync contact =============================
do $$
declare
  v_patient_a_id uuid := (select v from m1_fixture_ids where k = 'patient_a_id');
  v_clinician_id uuid := (select v from m1_fixture_ids where k = 'clinician_id');
  v_urgent_classification_id uuid := (select v from m1_fixture_ids where k = 'urgent_classification_id');
  v_contact_id uuid := (select v from m1_fixture_ids where k = 'contact_id');
  v_async_contact_id uuid;
begin
  begin
    insert into clinical_notes (patient_id, clinician_id, note_type, body, linked_classification_id,
      accountability_model_at_signing, mdcn_number_at_signing)
      values (v_patient_a_id, v_clinician_id, 'escalation', 'Closing urgent case with no contact', v_urgent_classification_id,
      'tech_layer', 'MDCN-M1TEST-0001');
    raise exception 'I5 FAILED: urgent classification closed with no linked_contact_id at all';
  exception when others then
    if sqlerrm like 'I5:%' then raise notice 'I5 (no contact) PASSED: %', sqlerrm; else raise; end if;
  end;

  insert into clinical_contacts (patient_id, clinician_id, contact_type, started_at)
    values (v_patient_a_id, v_clinician_id, 'async_in_app', now()) returning id into v_async_contact_id;
  begin
    insert into clinical_notes (patient_id, clinician_id, note_type, body, linked_classification_id, linked_contact_id,
      accountability_model_at_signing, mdcn_number_at_signing)
      values (v_patient_a_id, v_clinician_id, 'escalation', 'Closing urgent case with async-only contact', v_urgent_classification_id,
      v_async_contact_id, 'tech_layer', 'MDCN-M1TEST-0001');
    raise exception 'I5 FAILED: urgent classification closed with an async_in_app contact (must be voice/synchronous_in_app)';
  exception when others then
    if sqlerrm like 'I5:%' then raise notice 'I5 (async contact rejected) PASSED: %', sqlerrm; else raise; end if;
  end;

  -- correct case: voice contact -> should succeed and fire I10's proof_log trigger
  insert into clinical_notes (patient_id, clinician_id, note_type, body, linked_classification_id, linked_contact_id,
    accountability_model_at_signing, mdcn_number_at_signing)
    values (v_patient_a_id, v_clinician_id, 'escalation', 'Closing urgent case with a real voice contact', v_urgent_classification_id,
    v_contact_id, 'tech_layer', 'MDCN-M1TEST-0001');
  raise notice 'I5 (voice contact accepted) PASSED';
end $$;

-- ============================= I10: proof_log written for clinical_notes/triage_classifications/escalations =============================
do $$
declare
  v_patient_a_id uuid := (select v from m1_fixture_ids where k = 'patient_a_id');
  v_esc_id uuid;
  v_count int;
begin
  select count(*) into v_count from proof_log where patient_id = v_patient_a_id and source_table = 'clinical_notes';
  if v_count = 0 then raise exception 'I10 FAILED: no proof_log row for clinical_notes insert'; end if;
  select count(*) into v_count from proof_log where patient_id = v_patient_a_id and source_table = 'triage_classifications';
  if v_count = 0 then raise exception 'I10 FAILED: no proof_log row for triage_classifications insert'; end if;

  insert into escalations (patient_id, criticality, due_by) values (v_patient_a_id, 'urgent', now() + interval '2 hours')
    returning id into v_esc_id;
  select count(*) into v_count from proof_log where source_table = 'escalations' and source_id = v_esc_id;
  if v_count = 0 then raise exception 'I10 FAILED: no proof_log row for escalations insert'; end if;
  raise notice 'I10 PASSED: proof_log written for clinical_notes, triage_classifications, escalations';
end $$;

-- ============================= I1: no clinical content on whatsapp/sms/email =============================
do $$
begin
  begin
    insert into notification_templates (key, channel, content_class, criticality, body_template)
      values ('m1_test_clinical_whatsapp', 'whatsapp', 'clinical', 'routine', 'Your BP is 150/95');
    raise exception 'I1 FAILED: clinical content_class accepted on whatsapp channel';
  exception when others then
    if sqlstate = '23514' then raise notice 'I1 (whatsapp) PASSED: rejected by CHECK constraint'; else raise; end if;
  end;
  begin
    insert into notification_templates (key, channel, content_class, criticality, body_template)
      values ('m1_test_clinical_sms', 'sms', 'clinical', 'urgent', 'Your BP is 195/118, call now');
    raise exception 'I1 FAILED: clinical content_class accepted on sms channel';
  exception when others then
    if sqlstate = '23514' then raise notice 'I1 (sms) PASSED: rejected by CHECK constraint'; else raise; end if;
  end;
  begin
    insert into notification_templates (key, channel, content_class, criticality, body_template)
      values ('m1_test_clinical_email', 'email', 'clinical', 'routine', 'Lab result: HbA1c 8.2%');
    raise exception 'I1 FAILED: clinical content_class accepted on email channel';
  exception when others then
    if sqlstate = '23514' then raise notice 'I1 (email) PASSED: rejected by CHECK constraint'; else raise; end if;
  end;
  -- non-clinical on whatsapp must still work
  insert into notification_templates (key, channel, content_class, criticality, body_template)
    values ('m1_test_nonclinical_whatsapp', 'whatsapp', 'non_clinical', 'routine', 'Your result is ready -- open the app.');
  raise notice 'I1 (non-clinical whatsapp allowed) PASSED';
end $$;

-- ============================= I8: no capitation value on invoice_line_type =============================
do $$
declare v_has_capitation boolean;
begin
  select exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'invoice_line_type' and e.enumlabel = 'capitation'
  ) into v_has_capitation;
  if v_has_capitation then raise exception 'I8 FAILED: capitation value exists on invoice_line_type'; end if;
  raise notice 'I8 PASSED: invoice_line_type has no capitation value';
end $$;

-- ============================= I4: consent-at-query-time, revoke takes effect same session =============================
-- Funder is a plain patient-role profile (e.g. a paying family member), never institution_admin
-- -- see I9 below, which is absolute and must never be defeated by a consent grant.
do $$
declare
  v_patient_a_id uuid := (select v from m1_fixture_ids where k = 'patient_a_id');
  v_funder_profile uuid := (select v from m1_fixture_ids where k = 'funder_profile');
  v_count int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_funder_profile::text, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from proof_log where patient_id = v_patient_a_id;
  reset role;
  if v_count = 0 then raise exception 'I4 FAILED: funder could not read proof_log with an active funder_summary grant'; end if;
  raise notice 'I4 (grant readable) PASSED: % rows visible with active grant', v_count;

  update consent_records set revoked_at = now()
    where patient_id = v_patient_a_id and scope = 'funder_summary' and granted_to_profile_id = v_funder_profile;

  perform set_config('request.jwt.claims', json_build_object('sub', v_funder_profile::text, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from proof_log where patient_id = v_patient_a_id;
  reset role;
  if v_count <> 0 then raise exception 'I4 FAILED: revoked grant still returned % proof_log rows in the same session', v_count; end if;
  raise notice 'I4 (revocation takes effect immediately, no cache) PASSED';
end $$;

-- ============================= M1 exit test: RLS suite across all six roles =============================
-- institution_admin must get ZERO rows on every patient-scoped table, no exceptions -- even
-- though this same fixture granted a funder_summary consent to *someone* (the funder profile
-- above), never to this institution_admin.
do $$
declare
  v_institution_admin_profile uuid := (select v from m1_fixture_ids where k = 'institution_admin_profile');
  v_table text;
  v_count int;
  v_patient_scoped_tables text[] := array[
    'patients','devices','readings','triage_classifications','clinical_contacts','clinical_notes',
    'escalations','referrals','consent_records','proof_log','notification_sends','medications',
    'medication_dispenses','lab_orders','screening_participants','wallet_transactions','enrolments'
  ];
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_institution_admin_profile::text, 'role','authenticated')::text, true);
  set local role authenticated;
  foreach v_table in array v_patient_scoped_tables loop
    execute format('select count(*) from %I', v_table) into v_count;
    if v_count <> 0 then
      reset role;
      raise exception 'I9 FAILED: institution_admin sees % rows on table %', v_count, v_table;
    end if;
  end loop;
  reset role;
  raise notice 'I9 PASSED: institution_admin returns zero rows on all % patient-scoped tables', array_length(v_patient_scoped_tables, 1);
end $$;

-- Per-role positive checks: patient sees own + dependant only, not the other patient.
do $$
declare
  v_patient_a_profile uuid := (select v from m1_fixture_ids where k = 'patient_a_profile');
  v_patient_a_id uuid := (select v from m1_fixture_ids where k = 'patient_a_id');
  v_dependant_id uuid := (select v from m1_fixture_ids where k = 'dependant_id');
  v_patient_b_id uuid := (select v from m1_fixture_ids where k = 'patient_b_id');
  v_count int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_a_profile::text, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from patients where id in (v_patient_a_id, v_dependant_id);
  if v_count <> 2 then reset role; raise exception 'RLS FAILED: patient_a should see self+dependant (2), saw %', v_count; end if;
  select count(*) into v_count from patients where id = v_patient_b_id;
  if v_count <> 0 then reset role; raise exception 'RLS FAILED: patient_a should NOT see patient_b, saw %', v_count; end if;
  reset role;
  raise notice 'RLS (patient own+dependant, not-other-patient) PASSED';
end $$;

-- Clinician sees patient_a via the open exception queue (I2's needs_review classification is
-- still open/uncleared), coordinator sees the same patient via assigned_coordinator_id.
do $$
declare
  v_clinician_profile uuid := (select v from m1_fixture_ids where k = 'clinician_profile');
  v_coordinator_profile uuid := (select v from m1_fixture_ids where k = 'coordinator_profile');
  v_patient_a_id uuid := (select v from m1_fixture_ids where k = 'patient_a_id');
  v_count int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_clinician_profile::text, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from patients where id = v_patient_a_id;
  reset role;
  if v_count <> 1 then raise exception 'RLS FAILED: clinician should see patient_a via open exception queue, saw %', v_count; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_coordinator_profile::text, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from patients where id = v_patient_a_id;
  reset role;
  if v_count <> 1 then raise exception 'RLS FAILED: coordinator should see patient_a via assigned_coordinator_id, saw %', v_count; end if;
  raise notice 'RLS (clinician exception-queue + coordinator assignment access) PASSED';
end $$;

-- lab_orders column-level protection: patient function never exposes commission_minor, and a
-- patient role gets zero rows querying the base table directly.
do $$
declare
  v_patient_a_profile uuid := (select v from m1_fixture_ids where k = 'patient_a_profile');
  v_patient_a_id uuid := (select v from m1_fixture_ids where k = 'patient_a_id');
  v_partner_id uuid;
  v_count int;
begin
  insert into partners (kind, name) values ('lab', 'M1 Test Lab') returning id into v_partner_id;
  insert into lab_orders (patient_id, partner_id, panel_code, patient_price_minor, commission_minor)
    values (v_patient_a_id, v_partner_id, 'lipid_panel', 500000, 50000);

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_a_profile::text, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from lab_orders where patient_id = v_patient_a_id;
  if v_count <> 0 then reset role; raise exception 'lab_orders base table FAILED: patient sees % rows directly (should be 0)', v_count; end if;
  select count(*) into v_count from lab_orders_patient() where patient_id = v_patient_a_id;
  reset role;
  if v_count <> 1 then raise exception 'lab_orders_patient() FAILED: patient should see 1 row via the safe function, saw %', v_count; end if;
  raise notice 'lab_orders column-level protection PASSED (base table hidden, safe function works, commission_minor never exposed to patient)';
end $$;

do $$ begin raise notice '=== M1 SUITE COMPLETE: all assertions passed ==='; end $$;

rollback;
