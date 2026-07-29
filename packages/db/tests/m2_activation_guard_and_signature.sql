-- Tarragon Health v3, M2 exit test: clinician activation guard + note signature stamping.
--
-- Run via `psql $DATABASE_URL -f this_file.sql` or the execute_sql MCP tool, same convention as
-- m1_invariant_and_rls_suite.sql. Wrapped in BEGIN/ROLLBACK -- verification only, never seed data.
--
-- Exit test per build spec v3 §20: "Expired-MDCN clinician auto-suspends overnight; note
-- signature block renders correctly under both models." The rendering half is a pure TypeScript
-- function (packages/protocol/src/accountability.ts, unit-tested in accountability.test.ts) --
-- this file proves the DB-side half: a clinician cannot even reach `active = true` without
-- meeting the current model's requirements, a nightly sweep catches credentials that lapse with
-- no write ever happening, a suspended clinician cannot reactivate themselves, and every
-- clinical_notes row gets the correct model + MDCN number stamped regardless of what the caller
-- sent.
--
-- CI wiring: same not-yet-done note as the M1 suite -- re-run manually via the Supabase MCP
-- execute_sql tool whenever this trigger/function changes.

begin;

-- ============================= fixture =============================
do $$
declare
  v_tech_layer_clinician_profile uuid := gen_random_uuid();
  v_patient_profile uuid := gen_random_uuid();
  v_patient_id uuid;
  v_tech_layer_clinician_id uuid;
begin
  insert into auth.users (id, email) values
    (v_tech_layer_clinician_profile, 'm2test.clinician.techlayer@example.com'),
    (v_patient_profile, 'm2test.patient@example.com');

  update profiles set role = 'clinician', full_name = 'M2 Test Clinician Tech-Layer' where id = v_tech_layer_clinician_profile;
  update profiles set role = 'patient', full_name = 'M2 Test Patient' where id = v_patient_profile;

  insert into patients (profile_id, date_of_birth, sex_at_birth) values (v_patient_profile, '1980-01-01', 'male')
    returning id into v_patient_id;

  insert into clinicians (profile_id, mdcn_number, mdcn_expiry, indemnity_provider, indemnity_policy_no, indemnity_expiry, active)
    values (v_tech_layer_clinician_profile, 'MDCN-M2TEST-0001', current_date + interval '1 year',
            'M2 Test Indemnity Co', 'POL-0001', current_date + interval '1 year', true)
    returning id into v_tech_layer_clinician_id;

  create temp table m2_fixture_ids (k text primary key, v uuid) on commit drop;
  insert into m2_fixture_ids values
    ('tech_layer_clinician_profile', v_tech_layer_clinician_profile),
    ('patient_profile', v_patient_profile),
    ('patient_id', v_patient_id),
    ('tech_layer_clinician_id', v_tech_layer_clinician_id);
end $$;

-- ============================= activation gate: tech_layer model (the default) =============================
do $$
declare v_profile uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'm2test.gate.techlayer@example.com')
    returning id into v_profile;
  update profiles set role = 'clinician', full_name = 'M2 Test Gate Tech-Layer' where id = v_profile;

  -- expired MDCN alone must block activation regardless of model
  begin
    insert into clinicians (profile_id, mdcn_number, mdcn_expiry, active)
      values (v_profile, 'MDCN-M2TEST-0002', current_date - interval '1 day', true);
    raise exception 'ACTIVATION gate FAILED: expired mdcn_expiry was accepted with active = true';
  exception when others then
    if sqlerrm like 'ACTIVATION:%' then raise notice 'ACTIVATION gate (expired MDCN blocks) PASSED: %', sqlerrm; else raise; end if;
  end;

  -- tech_layer model: valid MDCN but no indemnity at all must still block activation
  begin
    insert into clinicians (profile_id, mdcn_number, mdcn_expiry, active)
      values (v_profile, 'MDCN-M2TEST-0002', current_date + interval '1 year', true);
    raise exception 'ACTIVATION gate FAILED: tech_layer clinician activated with no indemnity fields at all';
  exception when others then
    if sqlerrm like 'ACTIVATION:%' then raise notice 'ACTIVATION gate (tech_layer requires indemnity) PASSED: %', sqlerrm; else raise; end if;
  end;

  -- tech_layer model: complete, current credentials -> succeeds
  insert into clinicians (profile_id, mdcn_number, mdcn_expiry, indemnity_provider, indemnity_policy_no, indemnity_expiry, active)
    values (v_profile, 'MDCN-M2TEST-0002', current_date + interval '1 year',
            'M2 Test Indemnity Co', 'POL-0003', current_date + interval '1 year', true);
  raise notice 'ACTIVATION gate (tech_layer, complete credentials) PASSED';
end $$;

-- ============================= activation gate: provider model does not require indemnity =============================
do $$
declare v_profile uuid;
begin
  update app_config set accountability_model = 'provider' where id = true;

  insert into auth.users (id, email) values (gen_random_uuid(), 'm2test.gate.provider@example.com')
    returning id into v_profile;
  update profiles set role = 'clinician', full_name = 'M2 Test Gate Provider' where id = v_profile;

  -- under provider model, valid MDCN with NULL indemnity fields must be enough to activate
  insert into clinicians (profile_id, mdcn_number, mdcn_expiry, active)
    values (v_profile, 'MDCN-M2TEST-0003', current_date + interval '1 year', true);
  raise notice 'ACTIVATION gate (provider model ignores indemnity) PASSED';

  update app_config set accountability_model = 'tech_layer' where id = true;
end $$;

-- ============================= nightly guard: expired MDCN, lapsed with no write =============================
do $$
declare
  v_profile uuid;
  v_clinician_id uuid;
  v_active boolean;
  v_reason text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'm2test.stale.mdcn@example.com')
    returning id into v_profile;
  update profiles set role = 'clinician', full_name = 'M2 Test Stale MDCN Clinician' where id = v_profile;

  -- Simulate a clinician legitimately activated when their MDCN was current, with time having
  -- since passed and nobody touching the row -- disable the write-time gate just for this one
  -- fixture insert; the whole point of the nightly sweep is to catch what a write-time trigger
  -- structurally cannot (a date crossing today with no write ever happening).
  alter table clinicians disable trigger enforce_clinician_activation_requirements_trigger;
  insert into clinicians (profile_id, mdcn_number, mdcn_expiry, indemnity_provider, indemnity_policy_no, indemnity_expiry, active)
    values (v_profile, 'MDCN-M2TEST-0004', current_date - interval '1 day',
            'M2 Test Indemnity Co', 'POL-0004', current_date + interval '1 year', true)
    returning id into v_clinician_id;
  alter table clinicians enable trigger enforce_clinician_activation_requirements_trigger;

  perform private.run_clinician_activation_guard();

  select active, suspended_reason into v_active, v_reason from clinicians where id = v_clinician_id;
  if v_active then raise exception 'NIGHTLY GUARD FAILED: clinician with expired mdcn_expiry was not suspended'; end if;
  if v_reason <> 'mdcn_expired' then raise exception 'NIGHTLY GUARD FAILED: expected suspended_reason mdcn_expired, got %', v_reason; end if;
  raise notice 'NIGHTLY GUARD (expired MDCN auto-suspends overnight) PASSED: suspended_reason=%', v_reason;
end $$;

-- ============================= nightly guard: tech_layer indemnity lapse =============================
do $$
declare
  v_profile uuid;
  v_clinician_id uuid;
  v_active boolean;
  v_reason text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'm2test.stale.indemnity@example.com')
    returning id into v_profile;
  update profiles set role = 'clinician', full_name = 'M2 Test Stale Indemnity Clinician' where id = v_profile;

  alter table clinicians disable trigger enforce_clinician_activation_requirements_trigger;
  insert into clinicians (profile_id, mdcn_number, mdcn_expiry, indemnity_provider, indemnity_policy_no, indemnity_expiry, active)
    values (v_profile, 'MDCN-M2TEST-0005', current_date + interval '1 year',
            'M2 Test Indemnity Co', 'POL-0005', current_date - interval '1 day', true)
    returning id into v_clinician_id;
  alter table clinicians enable trigger enforce_clinician_activation_requirements_trigger;

  perform private.run_clinician_activation_guard();

  select active, suspended_reason into v_active, v_reason from clinicians where id = v_clinician_id;
  if v_active then raise exception 'NIGHTLY GUARD FAILED: tech_layer clinician with expired indemnity was not suspended'; end if;
  if v_reason <> 'indemnity_expired' then raise exception 'NIGHTLY GUARD FAILED: expected suspended_reason indemnity_expired, got %', v_reason; end if;
  raise notice 'NIGHTLY GUARD (expired indemnity auto-suspends overnight, tech_layer) PASSED: suspended_reason=%', v_reason;
end $$;

-- ============================= self-update lockdown: a suspended clinician cannot reactivate themselves =============================
do $$
declare
  v_profile uuid := (select v from m2_fixture_ids where k = 'tech_layer_clinician_profile');
  v_clinician_id uuid := (select v from m2_fixture_ids where k = 'tech_layer_clinician_id');
  v_active boolean;
begin
  update clinicians set active = false, suspended_reason = 'mdcn_expired' where id = v_clinician_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_profile::text, 'role','authenticated')::text, true);
  set local role authenticated;
  -- RLS silently filters the target row (no matching USING clause) -- this affects 0 rows, it
  -- does not raise, so the correct assertion is on resulting state, not on an exception.
  update clinicians set active = true, suspended_reason = null where id = v_clinician_id;
  reset role;

  select active into v_active from clinicians where id = v_clinician_id;
  if v_active then raise exception 'SELF-UPDATE LOCKDOWN FAILED: clinician reactivated their own suspended row'; end if;
  raise notice 'SELF-UPDATE LOCKDOWN (clinician cannot reactivate self, RLS admits zero matching rows) PASSED';

  -- restore for the next block
  update clinicians set active = true, suspended_reason = null where id = v_clinician_id;
end $$;

-- ============================= clinical_notes accountability stamping =============================
do $$
declare
  v_patient_id uuid := (select v from m2_fixture_ids where k = 'patient_id');
  v_clinician_id uuid := (select v from m2_fixture_ids where k = 'tech_layer_clinician_id');
  v_note_id uuid;
  v_model accountability_model;
  v_mdcn text;
begin
  -- Phase 2's L3 guard (added after this suite was first written) blocks clinical_notes signing
  -- until app_config.accountability_model has been deliberately confirmed -- irrelevant to what
  -- THIS block tests (stamping correctness), so satisfy it first rather than let it mask the
  -- actual assertion below.
  update app_config set l3_accountability_model_legal_advice = true,
    l3_set_by = (select v from m2_fixture_ids where k = 'tech_layer_clinician_profile'), l3_set_at = now() where id = true;

  -- deliberately pass WRONG values for both stamped columns -- the trigger must overwrite them,
  -- proving the fields are server-derived and cannot be spoofed by whatever the caller sends.
  insert into clinical_notes (patient_id, clinician_id, note_type, body,
    accountability_model_at_signing, mdcn_number_at_signing)
    values (v_patient_id, v_clinician_id, 'review', 'Routine review, stable.',
    'provider', 'SPOOFED-MDCN-NUMBER')
    returning id into v_note_id;

  select accountability_model_at_signing, mdcn_number_at_signing into v_model, v_mdcn
    from clinical_notes where id = v_note_id;

  if v_model <> 'tech_layer' then
    raise exception 'STAMP FAILED: expected server-derived tech_layer (app_config default), got %', v_model;
  end if;
  if v_mdcn <> 'MDCN-M2TEST-0001' then
    raise exception 'STAMP FAILED: expected server-derived MDCN-M2TEST-0001, got % (spoofed value was not overwritten)', v_mdcn;
  end if;
  raise notice 'STAMP (accountability_model_at_signing + mdcn_number_at_signing are server-derived, spoofed input overwritten) PASSED: model=%, mdcn=%', v_model, v_mdcn;
end $$;

do $$ begin raise notice '=== M2 SUITE COMPLETE: all assertions passed ==='; end $$;

rollback;
