-- ===========================================================================
-- S09 verification: record_shares RLS + RPCs, vitals/prescription timeline
-- event triggers.
--
-- What is checked:
--   1. create_record_share creates a share with a valid token, sections, expiry.
--   2. The patient who created the share can read it.
--   3. revoke_record_share marks is_active=false and sets revoked_at.
--   4. record_share_by_token returns data for a valid, active share.
--   5. record_share_by_token returns null for a revoked share.
--   6. anon CANNOT call create_record_share or revoke_record_share.
--   7. Inserting a vitals_reading fires a timeline event (vitals_recorded).
--   8. Signing a prescription fires a timeline event (prescription_signed).
--
-- Wrapped in BEGIN/ROLLBACK — leaves the database exactly as it found it.
-- ===========================================================================
BEGIN;

DO $$
DECLARE
  v_org_id      uuid;
  v_patient     uuid;
  v_doctor      uuid;
  v_share       jsonb;
  v_share_id    uuid;
  v_share2      jsonb;
  v_share2_id   uuid;
  v_token       text;
  v_token2      text;
  v_data        jsonb;
  v_tl_before   bigint;
  v_tl_after    bigint;
  v_presc_id    uuid;
BEGIN
  -- ─── Fixtures ─────────────────────────────────────────────────────────
  INSERT INTO organisations (name, type) VALUES ('S09 Test Org', 'clinic')
    RETURNING id INTO v_org_id;

  v_patient := gen_random_uuid();
  INSERT INTO auth.users (id, email, role, aud, instance_id)
    VALUES (v_patient, 's09-patient@tarragon.test', 'authenticated', 'authenticated',
            '00000000-0000-0000-0000-000000000000');
  INSERT INTO profiles (id, full_name, role, organisation_id)
    VALUES (v_patient, 'S09 Patient', 'patient', v_org_id)
    ON CONFLICT (id) DO UPDATE SET full_name = excluded.full_name, role = excluded.role, organisation_id = excluded.organisation_id;

  v_doctor := gen_random_uuid();
  INSERT INTO auth.users (id, email, role, aud, instance_id)
    VALUES (v_doctor, 's09-doctor@tarragon.test', 'authenticated', 'authenticated',
            '00000000-0000-0000-0000-000000000000');
  INSERT INTO profiles (id, full_name, role, organisation_id)
    VALUES (v_doctor, 'Dr S09 Test', 'clinician', v_org_id)
    ON CONFLICT (id) DO UPDATE SET full_name = excluded.full_name, role = excluded.role, organisation_id = excluded.organisation_id;

  -- ════════════════════════════════════════════════════════════════════════
  -- Test 1: create_record_share as the patient
  -- ════════════════════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claim.sub', v_patient::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT to_jsonb(public.create_record_share(
    ARRAY['vitals', 'medications', 'allergies']::text[],
    24
  )) INTO v_share;

  IF v_share IS NULL OR v_share->>'token' IS NULL THEN
    RAISE EXCEPTION 'TEST 1 FAILED: create_record_share returned null';
  END IF;

  v_share_id := (v_share->>'id')::uuid;
  v_token    := v_share->>'token';

  IF length(v_token) < 64 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: token too short (%), expected 64 hex chars', length(v_token);
  END IF;

  RAISE NOTICE 'TEST 1 PASSED: create_record_share works';

  -- ════════════════════════════════════════════════════════════════════════
  -- Test 2: patient can read their own share
  -- ════════════════════════════════════════════════════════════════════════
  PERFORM 1 FROM record_shares WHERE id = v_share_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST 2 FAILED: patient cannot read own share';
  END IF;
  RAISE NOTICE 'TEST 2 PASSED: patient can read own share';

  -- ════════════════════════════════════════════════════════════════════════
  -- Test 3: revoke_record_share
  -- ════════════════════════════════════════════════════════════════════════
  PERFORM public.revoke_record_share(v_share_id);

  PERFORM 1 FROM record_shares
    WHERE id = v_share_id AND is_active = false AND revoked_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST 3 FAILED: revoke did not set is_active=false / revoked_at';
  END IF;
  RAISE NOTICE 'TEST 3 PASSED: revoke_record_share works';

  -- ════════════════════════════════════════════════════════════════════════
  -- Test 4: record_share_by_token on an active share
  -- ════════════════════════════════════════════════════════════════════════
  SELECT to_jsonb(public.create_record_share(
    ARRAY['conditions', 'emergency_info']::text[],
    1
  )) INTO v_share2;
  v_share2_id := (v_share2->>'id')::uuid;
  v_token2    := v_share2->>'token';

  -- Switch to anon
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);

  SELECT to_jsonb(public.record_share_by_token(v_token2)) INTO v_data;
  IF v_data IS NULL OR v_data->>'full_name' IS NULL THEN
    RAISE EXCEPTION 'TEST 4 FAILED: record_share_by_token returned null for active share';
  END IF;
  RAISE NOTICE 'TEST 4 PASSED: record_share_by_token returns data for active share';

  -- ════════════════════════════════════════════════════════════════════════
  -- Test 5: record_share_by_token on a revoked share
  -- ════════════════════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claim.sub', v_patient::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM public.revoke_record_share(v_share2_id);

  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  SELECT to_jsonb(public.record_share_by_token(v_token2)) INTO v_data;
  IF v_data IS NOT NULL AND v_data->>'full_name' IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 5 FAILED: record_share_by_token returned data for a revoked share';
  END IF;
  RAISE NOTICE 'TEST 5 PASSED: record_share_by_token returns null for revoked share';

  -- ════════════════════════════════════════════════════════════════════════
  -- Test 6: anon cannot call create/revoke RPCs
  -- ════════════════════════════════════════════════════════════════════════
  BEGIN
    PERFORM public.create_record_share(ARRAY['vitals']::text[], 24);
    RAISE EXCEPTION 'TEST 6a FAILED: anon was able to call create_record_share';
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN
    RAISE NOTICE 'TEST 6a PASSED: anon cannot call create_record_share';
  END;

  BEGIN
    PERFORM public.revoke_record_share(gen_random_uuid());
    RAISE EXCEPTION 'TEST 6b FAILED: anon was able to call revoke_record_share';
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN
    RAISE NOTICE 'TEST 6b PASSED: anon cannot call revoke_record_share';
  END;

  -- ════════════════════════════════════════════════════════════════════════
  -- Test 7: vitals_recorded timeline event trigger
  -- ════════════════════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claim.sub', v_patient::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_tl_before
    FROM patient_timeline WHERE patient_id = v_patient AND event_type = 'vitals_recorded';

  INSERT INTO vitals_readings (patient_id, organisation_id, vital_type, systolic, diastolic, source)
    VALUES (v_patient, v_org_id, 'blood_pressure', 130, 85, 'manual');

  SELECT count(*) INTO v_tl_after
    FROM patient_timeline WHERE patient_id = v_patient AND event_type = 'vitals_recorded';

  IF v_tl_after <= v_tl_before THEN
    RAISE EXCEPTION 'TEST 7 FAILED: no vitals_recorded timeline event (before=%, after=%)', v_tl_before, v_tl_after;
  END IF;
  RAISE NOTICE 'TEST 7 PASSED: vitals_recorded timeline event created';

  -- ════════════════════════════════════════════════════════════════════════
  -- Test 8: prescription_signed timeline event trigger
  -- ════════════════════════════════════════════════════════════════════════
  SELECT count(*) INTO v_tl_before
    FROM patient_timeline WHERE patient_id = v_patient AND event_type = 'prescription_signed';

  -- Insert as postgres (bypasses RLS for fixture setup)
  PERFORM set_config('role', 'postgres', true);

  INSERT INTO prescriptions (patient_id, organisation_id, state, items)
    VALUES (v_patient, v_org_id, 'draft', '[{"drug_name": "Amlodipine 5mg"}]'::jsonb)
    RETURNING id INTO v_presc_id;

  UPDATE prescriptions
    SET signed_at = now(), signed_by = v_doctor, state = 'signed'
    WHERE id = v_presc_id;

  SELECT count(*) INTO v_tl_after
    FROM patient_timeline WHERE patient_id = v_patient AND event_type = 'prescription_signed';

  IF v_tl_after <= v_tl_before THEN
    RAISE EXCEPTION 'TEST 8 FAILED: no prescription_signed timeline event (before=%, after=%)', v_tl_before, v_tl_after;
  END IF;
  RAISE NOTICE 'TEST 8 PASSED: prescription_signed timeline event created';

  RAISE NOTICE '──────────────────────────────────────────────────';
  RAISE NOTICE 'ALL S09 TESTS PASSED';
  RAISE NOTICE '──────────────────────────────────────────────────';
END;
$$;

ROLLBACK;
