-- ===========================================================================
-- Verification: vaccination card/record OCR import RLS
-- (vaccination_card_extractions, confirm_vaccination_card_extraction).
--
-- Run via `supabase db query --linked -f <this file>`, `psql $DATABASE_URL -f
-- <this file>`, or the Supabase SQL editor. NOT YET EXECUTED against a live
-- database as of writing (this session did not apply its own migrations to
-- the shared project — see the migration files' own commit message) — run
-- this, and the migrations it depends on, before treating this RLS/RPC
-- surface as proven rather than just written to a proven pattern.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data;
-- it always leaves the database exactly as it found it.
--
-- Pattern: same session-switching style as ecg_report_rls.sql. The
-- authorization shape under test is deliberately DIFFERENT from the lab/ECG
-- drafts, though: vaccination self-log has never required a clinical-staff
-- gate, so this draft is patient-readable and patient-confirmable by design
-- (checks 4/6 below prove the OPPOSITE of ecg_report_rls.sql's checks 4/7 —
-- that is the point, not an oversight). What IS proven negative here is the
-- structural guard that only confirm_vaccination_card_extraction() may
-- complete the 'confirmed' transition (check 5), and that authorization for
-- BOTH the caregiver path (profile_access 'manage') and the plain
-- cross-patient case are real boundaries (checks 8/12).
-- ===========================================================================

begin;

create temporary table vce_rls_result(
  ord        int primary key,
  check_name text,
  expected   text,
  observed   text,
  verdict    text
) on commit drop;

do $$
declare
  v_org          uuid := '00000000-0000-0000-0000-000000000001';
  v_pat_a        uuid;
  v_pat_b        uuid;
  v_coordinator  uuid;
  v_catalog_id   uuid;
  v_extraction   uuid;
  v_extraction2  uuid;
  v_dependent    uuid := gen_random_uuid();
  n_ins          int;
  n_own_read     int;
  n_crosspat     int;
  n_staff_read   int;
  v_raw_confirm_blocked boolean := false;
  n_filed        int;
  v_status       text;
  v_confirmed_by uuid;
  n_vax_records  int;
  v_cert_path    text;
  v_verif_status text;
  v_crosspat_confirm_blocked boolean := false;
  n_filed_caregiver int;
begin
  select id into v_pat_a from public.profiles
    where role = 'patient' and organisation_id = v_org order by id limit 1;
  select id into v_pat_b from public.profiles
    where role = 'patient' and organisation_id = v_org and id <> v_pat_a order by id limit 1;
  select id into v_coordinator from public.profiles
    where role = 'clinician' and organisation_id = v_org order by id limit 1;
  select id into v_catalog_id from public.vaccination_catalog limit 1;

  if v_pat_a is null or v_pat_b is null or v_coordinator is null then
    raise exception 'fixtures unavailable: need 2 patients and 1 clinician-role profile in org 0001';
  end if;

  -- A dependent profile, real login, managed by patient A via a 'manage'
  -- profile_access grant — the family-vaccination-card path (spec §43.13).
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_dependent, 'vce-test-dependent@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'VCE Test Dependent'
    where id = v_dependent;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
    values (v_dependent, v_pat_a, 'manage', v_pat_a);

  -- ---------------------------------------------------------------------
  -- Checks 1-2: patient A uploads their own card via their own session,
  -- and can read the draft back (unlike lab/ECG, self-service by design).
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.vaccination_card_extractions (organisation_id, patient_id, source_path)
  values (v_org, v_pat_a, v_pat_a::text || '/verify-card.jpg')
  returning id into v_extraction;

  select count(*) into n_ins from public.vaccination_card_extractions where id = v_extraction;
  select count(*) into n_own_read from public.vaccination_card_extractions where id = v_extraction;

  perform set_config('role', 'postgres', true);

  -- ---------------------------------------------------------------------
  -- Check 3: patient B cannot read patient A's draft (cross-patient isolation).
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat_b, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n_crosspat from public.vaccination_card_extractions where id = v_extraction;
  perform set_config('role', 'postgres', true);

  -- ---------------------------------------------------------------------
  -- Check 4 CONTROL: org staff (coordinator) CAN read patient A's draft.
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_coordinator, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n_staff_read from public.vaccination_card_extractions where id = v_extraction;
  perform set_config('role', 'postgres', true);

  -- Seed the draft as if extraction had run (as superuser, mirroring the
  -- real pipeline's service-role write).
  update public.vaccination_card_extractions
    set status = 'extracted',
        rows = jsonb_build_array(jsonb_build_object(
          'reportedLabel', 'Test Vaccine', 'vaccinationCatalogId', v_catalog_id,
          'vaccineName', 'Test Vaccine', 'dateAdministered', (current_date - 30)::text,
          'confidence', 'high', 'status', 'ready'
        ))
    where id = v_extraction;

  -- ---------------------------------------------------------------------
  -- Check 5: patient A's OWN session cannot set status='confirmed' via a
  -- raw UPDATE — only the RPC may complete that transition.
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.vaccination_card_extractions set status = 'confirmed' where id = v_extraction;
    v_raw_confirm_blocked := false; -- reached only if the guard wrongly allowed it
  exception when others then
    v_raw_confirm_blocked := true;
  end;
  perform set_config('role', 'postgres', true);

  -- ---------------------------------------------------------------------
  -- Check 6: patient A CAN confirm via the RPC (self-service, no clinical
  -- gate — the deliberate difference from lab/ECG).
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select public.confirm_vaccination_card_extraction(
    v_extraction,
    jsonb_build_array(jsonb_build_object(
      'vaccination_catalog_id', v_catalog_id, 'dose_number', 1,
      'date_administered', (current_date - 30)::text
    ))
  ) into n_filed;

  select status, confirmed_by into v_status, v_confirmed_by
  from public.vaccination_card_extractions where id = v_extraction;

  select count(*) into n_vax_records
  from public.vaccination_records
  where profile_id = v_pat_a and vaccination_catalog_id = v_catalog_id and dose_number = 1
    and date_administered = current_date - 30;

  select physical_certificate_path, verification_status into v_cert_path, v_verif_status
  from public.vaccination_records
  where profile_id = v_pat_a and vaccination_catalog_id = v_catalog_id and dose_number = 1
    and date_administered = current_date - 30;

  perform set_config('role', 'postgres', true);

  -- ---------------------------------------------------------------------
  -- Check 12 (negative): patient B cannot confirm patient A's extraction
  -- via the RPC (a second extraction, since the first is already confirmed).
  -- ---------------------------------------------------------------------
  insert into public.vaccination_card_extractions (organisation_id, patient_id, source_path, status, rows)
  values (
    v_org, v_pat_a, v_pat_a::text || '/verify-card-2.jpg', 'extracted',
    jsonb_build_array(jsonb_build_object(
      'reportedLabel', 'Test Vaccine', 'vaccinationCatalogId', v_catalog_id,
      'vaccineName', 'Test Vaccine', 'dateAdministered', (current_date - 60)::text,
      'confidence', 'high', 'status', 'ready'
    ))
  )
  returning id into v_extraction2;

  perform set_config('request.jwt.claims', json_build_object('sub', v_pat_b, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.confirm_vaccination_card_extraction(
      v_extraction2,
      jsonb_build_array(jsonb_build_object(
        'vaccination_catalog_id', v_catalog_id, 'dose_number', 2,
        'date_administered', (current_date - 60)::text
      ))
    );
    v_crosspat_confirm_blocked := false;
  exception when others then
    v_crosspat_confirm_blocked := true;
  end;
  perform set_config('role', 'postgres', true);

  -- ---------------------------------------------------------------------
  -- Check 13 CONTROL: a 'manage'-level caregiver (patient A, for the
  -- dependent) CAN confirm the dependent's own extraction (spec §43.13).
  -- ---------------------------------------------------------------------
  insert into public.vaccination_card_extractions (organisation_id, patient_id, source_path, status, rows)
  values (
    v_org, v_dependent, v_pat_a::text || '/verify-card-dependent.jpg', 'extracted',
    jsonb_build_array(jsonb_build_object(
      'reportedLabel', 'Test Vaccine', 'vaccinationCatalogId', v_catalog_id,
      'vaccineName', 'Test Vaccine', 'dateAdministered', (current_date - 10)::text,
      'confidence', 'high', 'status', 'ready'
    ))
  )
  returning id into v_extraction2;

  perform set_config('request.jwt.claims', json_build_object('sub', v_pat_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.confirm_vaccination_card_extraction(
    v_extraction2,
    jsonb_build_array(jsonb_build_object(
      'vaccination_catalog_id', v_catalog_id, 'dose_number', 1,
      'date_administered', (current_date - 10)::text
    ))
  ) into n_filed_caregiver;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  -- ---------------------------------------------------------------------
  -- Results
  -- ---------------------------------------------------------------------
  insert into vce_rls_result values
    (1, 'patient A: own patient-sourced INSERT into vaccination_card_extractions succeeds',
        '1', n_ins::text, case when n_ins = 1 then 'PASS' else 'FAIL' end),
    (2, 'patient A: CAN read their own draft (self-service, unlike lab/ECG)',
        '1', n_own_read::text, case when n_own_read = 1 then 'PASS' else 'FAIL' end),
    (3, 'patient B: cannot read patient A''s draft',
        '0', n_crosspat::text, case when n_crosspat = 0 then 'PASS' else 'FAIL' end),
    (4, 'CONTROL — org staff CAN read patient A''s draft',
        '1', n_staff_read::text, case when n_staff_read = 1 then 'PASS' else 'FAIL' end),
    (5, 'patient A''s own session cannot set status=confirmed via a raw UPDATE',
        'true', v_raw_confirm_blocked::text, case when v_raw_confirm_blocked then 'PASS' else 'FAIL' end),
    (6, 'patient A CAN confirm their own draft via the RPC (no clinical gate)',
        '1', n_filed::text, case when n_filed = 1 then 'PASS' else 'FAIL' end),
    (7, 'confirm stamps status=confirmed and confirmed_by=the acting patient (never client-trusted)',
        'confirmed/' || v_pat_a::text, v_status || '/' || coalesce(v_confirmed_by::text, 'null'),
        case when v_status = 'confirmed' and v_confirmed_by = v_pat_a then 'PASS' else 'FAIL' end),
    (8, 'the filed vaccination_records row landed with dose_number=1',
        '1', n_vax_records::text, case when n_vax_records = 1 then 'PASS' else 'FAIL' end),
    (9, 'the filed row carries the card image as physical_certificate_path',
        v_pat_a::text || '/verify-card.jpg', coalesce(v_cert_path, 'null'),
        case when v_cert_path = v_pat_a::text || '/verify-card.jpg' then 'PASS' else 'FAIL' end),
    (10, 'the filed row lands at pending_verification (reuses the existing verified pathway)',
        'pending_verification', coalesce(v_verif_status, 'null'),
        case when v_verif_status = 'pending_verification' then 'PASS' else 'FAIL' end),
    (11, 'patient B cannot confirm patient A''s (dependent-unrelated) extraction via the RPC',
        'true', v_crosspat_confirm_blocked::text,
        case when v_crosspat_confirm_blocked then 'PASS' else 'FAIL' end),
    (12, 'CONTROL — a ''manage''-level caregiver CAN confirm their dependent''s own extraction',
        '1', n_filed_caregiver::text, case when n_filed_caregiver = 1 then 'PASS' else 'FAIL' end);
end $$;

select ord, verdict, check_name, expected, observed
from vce_rls_result order by ord;

do $$
declare
  v_failed text;
begin
  select string_agg(ord::text || ' (' || check_name || ')', '; ' order by ord)
    into v_failed
  from vce_rls_result where verdict = 'FAIL';

  if v_failed is not null then
    raise exception 'vaccination_card_extractions RLS verification FAILED on check(s): %', v_failed;
  end if;
end $$;

rollback;
