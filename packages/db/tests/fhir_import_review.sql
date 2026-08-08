-- Tarragon Health
-- Live proof for 20260807013608_fhir_import_provenance_enums.sql and
-- 20260807013610_fhir_interop_import_review.sql -- imported FHIR resources
-- stay clinically inert until a named, tier-eligible clinician confirms
-- them, attribution is derived server-side (never client-supplied), a
-- Care Coordinator cannot confirm, and a decided row is immutable.
--
-- Seven cases in one rolled-back transaction, negatives paired with
-- positive controls where one exists (same discipline as
-- emergency_escalation_tier_gate.sql):
--   1. Tier 1 confirms an Observation proposal      -> ALLOWED, and actually
--      lands a vitals_readings row with source='fhir_import'
--   2. Care Coordinator confirms a different one    -> BLOCKED
--   3. A patient (non-staff) confirms one           -> BLOCKED by RLS itself
--      (0 rows affected, no exception -- the row is invisible to them, not
--      merely refused)
--   4. Re-confirming case 1's now-confirmed row     -> BLOCKED ("already
--      confirmed")
--   5. Dismiss with no reason                       -> BLOCKED
--   6. CONTROL: dismiss WITH a reason                -> ALLOWED
--   7. Attribution is trigger-derived: an UPDATE that tries to also set
--      confirmed_by to someone else's id is confirmed under THAT someone
--      else's id anyway, never the injected value
--
-- Run: npx supabase db query --linked -f packages/db/tests/fhir_import_review.sql

begin;

create temporary table test_result (
  case_num int, label text, expected text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org        uuid := '00000000-0000-0000-0000-000000000001';
  v_pat        uuid;
  v_t1         uuid;  -- profile that will hold a Tier 1 clinical_staff row
  v_coord      uuid;  -- profile that will hold a Care Coordinator clinical_staff row
  v_api_key    uuid;
  v_batch      uuid;
  v_res_confirm    uuid;  -- case 1 / 4
  v_res_coord      uuid;  -- case 2
  v_res_patient    uuid;  -- case 3
  v_res_dismiss_no uuid;  -- case 5
  v_res_dismiss_ok uuid;  -- case 6
  v_res_attrib     uuid;  -- case 7
  v_blocked    boolean;
  v_err        text;
  v_state      text;
  v_status     text;
  v_reading_id uuid;
  v_reading_source text;
  v_confirmed_by uuid;
begin
  select id into v_pat from public.profiles where role = 'patient' and organisation_id = v_org limit 1;
  if v_pat is null then
    raise exception 'no patient profile in org 0001 to build a fixture against';
  end if;

  select id into v_t1 from public.profiles
    where role::text in ('clinician','admin','doctor') and organisation_id = v_org
    order by created_at limit 1;
  select id into v_coord from public.profiles
    where role::text in ('clinician','admin','doctor') and organisation_id = v_org and id <> v_t1
    order by created_at limit 1;
  if v_coord is null then
    raise exception 'need at least 2 org-staff profiles (clinician/admin/doctor) in org 0001 to build this fixture';
  end if;

  -- UPSERT rather than delete+insert: a real deployment's clinical_staff
  -- rows are commonly referenced by patient_timeline (FK restrict), so a
  -- delete fails there even though this whole test rolls back. Temporarily
  -- overwriting an existing row's tier is safe inside a rolled-back
  -- transaction.
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier, is_clinical_director)
  values (v_org, v_t1, 'FHIR Import Tier One Fixture', true, now(), 'tier_1', false)
  on conflict (profile_id) do update set
    organisation_id = excluded.organisation_id, active = true, license_verified_at = now(),
    doctor_tier = 'tier_1', is_clinical_director = false;

  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier, is_clinical_director)
  values (v_org, v_coord, 'FHIR Import Care Coordinator Fixture', true, now(), 'care_coordinator', false)
  on conflict (profile_id) do update set
    organisation_id = excluded.organisation_id, active = true, license_verified_at = now(),
    doctor_tier = 'care_coordinator', is_clinical_director = false;

  -- A minimal api_keys row -- fhir_import_batches.api_key_id is not null.
  insert into public.api_keys (organisation_id, name, key_hash, key_prefix, scopes)
  values (v_org, 'fhir_import_review test fixture', md5(random()::text), 'th_live_test', array['fhir:import'])
  returning id into v_api_key;

  insert into public.fhir_import_batches (organisation_id, api_key_id, patient_id, raw_bundle)
  values (v_org, v_api_key, v_pat, '{}'::jsonb)
  returning id into v_batch;

  insert into public.fhir_import_proposed_resources
    (batch_id, organisation_id, patient_id, resource_type, raw_resource, normalized_payload, parser_version)
  values
    (v_batch, v_org, v_pat, 'Observation', '{}'::jsonb,
      jsonb_build_object('vital_type', 'weight', 'taken_at', '2026-08-01T09:00:00Z', 'weight_kg', 70), 1)
  returning id into v_res_confirm;

  insert into public.fhir_import_proposed_resources
    (batch_id, organisation_id, patient_id, resource_type, raw_resource, normalized_payload, parser_version)
  values
    (v_batch, v_org, v_pat, 'Observation', '{}'::jsonb,
      jsonb_build_object('vital_type', 'weight', 'taken_at', '2026-08-01T09:05:00Z', 'weight_kg', 71), 1)
  returning id into v_res_coord;

  insert into public.fhir_import_proposed_resources
    (batch_id, organisation_id, patient_id, resource_type, raw_resource, normalized_payload, parser_version)
  values
    (v_batch, v_org, v_pat, 'Observation', '{}'::jsonb,
      jsonb_build_object('vital_type', 'weight', 'taken_at', '2026-08-01T09:10:00Z', 'weight_kg', 72), 1)
  returning id into v_res_patient;

  insert into public.fhir_import_proposed_resources
    (batch_id, organisation_id, patient_id, resource_type, raw_resource, normalized_payload, parser_version)
  values
    (v_batch, v_org, v_pat, 'AllergyIntolerance', '{}'::jsonb,
      jsonb_build_object('allergen', 'Penicillin', 'reaction', null, 'severity', 'mild', 'noted_at', null), 1)
  returning id into v_res_dismiss_no;

  insert into public.fhir_import_proposed_resources
    (batch_id, organisation_id, patient_id, resource_type, raw_resource, normalized_payload, parser_version)
  values
    (v_batch, v_org, v_pat, 'AllergyIntolerance', '{}'::jsonb,
      jsonb_build_object('allergen', 'Latex', 'reaction', null, 'severity', 'mild', 'noted_at', null), 1)
  returning id into v_res_dismiss_ok;

  insert into public.fhir_import_proposed_resources
    (batch_id, organisation_id, patient_id, resource_type, raw_resource, normalized_payload, parser_version)
  values
    (v_batch, v_org, v_pat, 'Observation', '{}'::jsonb,
      jsonb_build_object('vital_type', 'weight', 'taken_at', '2026-08-01T09:15:00Z', 'weight_kg', 73), 1)
  returning id into v_res_attrib;

  ---------------------------------------------------------------------------
  -- 1. Tier 1 confirms an Observation proposal -> ALLOWED, and it actually
  --    writes a vitals_readings row with source='fhir_import'.
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.fhir_import_proposed_resources set status = 'confirmed' where id = v_res_confirm;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select result_id into v_reading_id from public.fhir_import_proposed_resources where id = v_res_confirm;
  select source::text into v_reading_source from public.vitals_readings where id = v_reading_id;
  insert into test_result values (1, 'Tier 1 confirms an Observation', 'ALLOWED, writes vitals_readings',
    case when not v_blocked and v_reading_id is not null and v_reading_source = 'fhir_import'
         then 'ALLOWED and wrote source=fhir_import (correct)'
         else 'FAILED' end,
    coalesce(v_err, 'result_id=' || coalesce(v_reading_id::text, 'null') || ' source=' || coalesce(v_reading_source, 'null')));

  ---------------------------------------------------------------------------
  -- 2. Care Coordinator confirms a different proposal -> BLOCKED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null; v_state := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.fhir_import_proposed_resources set status = 'confirmed' where id = v_res_coord;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select status into v_status from public.fhir_import_proposed_resources where id = v_res_coord;
  insert into test_result values (2, 'Care Coordinator confirms', 'BLOCKED',
    case when v_blocked and v_status = 'proposed' and v_err ilike '%Care Coordinator%' then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end,
    coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 3. A patient confirms one -> BLOCKED by RLS itself (0 rows affected,
  --    no exception -- the row is invisible to them, not merely refused).
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.fhir_import_proposed_resources set status = 'confirmed' where id = v_res_patient;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select status into v_status from public.fhir_import_proposed_resources where id = v_res_patient;
  insert into test_result values (3, 'Patient confirms (non-staff)', 'BLOCKED by RLS, still proposed',
    case when v_status = 'proposed' then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end,
    coalesce(v_err, 'no exception -- row simply invisible under RLS'));

  ---------------------------------------------------------------------------
  -- 4. Re-confirming case 1's already-confirmed row -> BLOCKED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.fhir_import_proposed_resources set status = 'confirmed' where id = v_res_confirm;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (4, 'Re-confirm an already-confirmed row', 'BLOCKED',
    case when v_blocked and v_err ilike '%already%' then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end,
    coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 5. Dismiss with no reason -> BLOCKED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.fhir_import_proposed_resources set status = 'dismissed' where id = v_res_dismiss_no;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (5, 'Dismiss with no reason', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 6. CONTROL: dismiss WITH a reason -> ALLOWED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.fhir_import_proposed_resources
      set status = 'dismissed', dismissal_reason = 'Duplicate of an existing allergy already on file'
      where id = v_res_dismiss_ok;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select status into v_status from public.fhir_import_proposed_resources where id = v_res_dismiss_ok;
  insert into test_result values (6, 'CONTROL dismiss with a reason', 'ALLOWED',
    case when not v_blocked and v_status = 'dismissed' then 'ALLOWED (correct)' else 'BLOCKED (BUG)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 7. Attribution is trigger-derived: confirming while also trying to set
  --    confirmed_by to someone else's id still records the ACTUAL caller.
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.fhir_import_proposed_resources set status = 'confirmed', confirmed_by = v_coord where id = v_res_attrib;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select confirmed_by into v_confirmed_by from public.fhir_import_proposed_resources where id = v_res_attrib;
  insert into test_result values (7, 'Confirm while spoofing confirmed_by', 'confirmed_by = actual caller (v_t1), never the spoofed value',
    case when not v_blocked and v_confirmed_by = v_t1 then 'CORRECT (attribution overwritten)' else 'BUG (attribution trusted client input)' end,
    coalesce(v_err, 'confirmed_by=' || coalesce(v_confirmed_by::text, 'null')));

end $$;

select case_num, label, expected, outcome, left(detail, 140) as detail
from test_result order by case_num;

rollback;
