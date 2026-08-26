-- ===========================================================================
-- Verification: ECG parameter extraction RLS (ecg_report_documents,
-- ecg_report_extractions, ecg_parameter_readings, confirm_ecg_report_extraction).
--
-- Run via `supabase db query --linked -f <this file>`, `psql $DATABASE_URL -f
-- <this file>`, or the Supabase SQL editor. NOT YET EXECUTED against a live
-- database as of writing (no local Postgres/Docker and no migrations applied
-- to a remote project in this session) — run this before treating the ECG
-- feature's RLS as proven, not just written to the same pattern as a proven
-- test.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data;
-- it always leaves the database exactly as it found it.
--
-- Pattern (same as packages/db/tests/lab_partner_rls.sql and
-- scoped_access_roles_rls.sql): set_config('request.jwt.claims', ...) +
-- set_config('role', 'authenticated', true) simulates a real client session.
-- Running as the connecting superuser would silently bypass RLS via table
-- ownership — the role switch is what makes this a real test.
--
-- WHY EVERY NEGATIVE IS PAIRED WITH A POSITIVE. A patient reading 0
-- ecg_report_extractions rows proves nothing on its own unless a clinician
-- session, in the SAME transaction, against the SAME fixture row, reads 1 —
-- otherwise an always-empty table or an over-broad "nobody can read anything"
-- policy would score identically. Checks 5/9 are those controls.
-- ===========================================================================

begin;

create temporary table ecg_rls_result(
  ord        int primary key,
  check_name text,
  expected   text,
  observed   text,
  verdict    text
) on commit drop;

do $$
declare
  v_org         uuid := '00000000-0000-0000-0000-000000000001';
  v_pat_a       uuid;
  v_pat_b       uuid;
  v_clin        uuid;
  v_staff       uuid;
  v_doc_a       uuid;
  v_extraction  uuid;
  n_docs        int;
  n_docs_b      int;
  n_extractions int;
  n_extractions_clin int;
  n_docs_clin   int;
  n_filed       int;
  n_readings    int;
  n_readings_patient int;
  v_confirmed_by uuid;
  v_extraction_status text;
  v_rpc_blocked boolean := false;
begin
  -- ------------------------------------------------------------------------
  -- Fixtures (as the connecting superuser, RLS bypassed)
  -- ------------------------------------------------------------------------
  select id into v_pat_a from public.profiles
    where role = 'patient' and organisation_id = v_org order by id limit 1;
  select id into v_pat_b from public.profiles
    where role = 'patient' and organisation_id = v_org and id <> v_pat_a order by id limit 1;
  select id into v_clin from public.profiles
    where role = 'clinician' and organisation_id = v_org order by id limit 1;

  if v_pat_a is null or v_pat_b is null or v_clin is null then
    raise exception 'fixtures unavailable: need 2 patients and 1 clinician in org 0001';
  end if;

  -- An active clinical_staff row for the control/confirm sessions. Reuses an
  -- existing row for this profile if one is already there (clinical_staff has
  -- a unique constraint on profile_id — a seeded clinician account very often
  -- already has one) rather than assuming a fresh insert always succeeds.
  -- Tier 2 and not a clinical director, so the indemnity activation trigger
  -- doesn't apply either way.
  select id into v_staff from public.clinical_staff where profile_id = v_clin;
  if v_staff is null then
    insert into public.clinical_staff
      (organisation_id, profile_id, full_name, doctor_tier, active,
       license_verified_at, verified_by)
    values
      (v_org, v_clin, 'VERIFY ECG Reviewing Clinician', 'tier_2', true, now(), v_pat_a)
    returning id into v_staff;
  else
    update public.clinical_staff
       set active = true, organisation_id = v_org
     where id = v_staff;
  end if;

  -- ------------------------------------------------------------------------
  -- Check 1-2: patient A uploads their own ECG document via their own session
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pat_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.ecg_report_documents
    (organisation_id, patient_id, file_path, mime_type, source)
  values (v_org, v_pat_a, v_pat_a::text || '/verify-ecg.jpg', 'image/jpeg', 'patient')
  returning id into v_doc_a;

  select count(*) into n_docs from public.ecg_report_documents where id = v_doc_a;

  perform set_config('role', 'postgres', true);

  -- ------------------------------------------------------------------------
  -- Check 3: patient B cannot read patient A's document (cross-tenant/cross-
  -- patient isolation — same org, different patient)
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pat_b, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n_docs_b from public.ecg_report_documents where id = v_doc_a;

  perform set_config('role', 'postgres', true);

  -- ------------------------------------------------------------------------
  -- Fixture: a drafted extraction on patient A's document (as superuser —
  -- ecg_report_extractions has no insert policy at all, service-role/RPC only,
  -- matching the real extraction pipeline's own write path).
  -- ------------------------------------------------------------------------
  insert into public.ecg_report_extractions
    (organisation_id, patient_id, document_id, status, model_id, report_date,
     looks_twelve_lead, parameters)
  values (
    v_org, v_pat_a, v_doc_a, 'extracted', 'verify-fixture',
    current_date, true,
    '[{"reportedLabel":"HR","code":"heart_rate","value":72,"unit":"bpm","confidence":"high"}]'::jsonb
  )
  returning id into v_extraction;

  -- ------------------------------------------------------------------------
  -- Check 4: patient A cannot read the unconfirmed extraction of their OWN ECG
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pat_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n_extractions from public.ecg_report_extractions where id = v_extraction;

  -- ------------------------------------------------------------------------
  -- Check 8 (negative, run inside patient A's session): a patient is not
  -- active clinical_staff, so the confirm RPC must refuse them (42501),
  -- not silently do nothing. Caught in a sub-block so an expected error
  -- doesn't abort the whole verification transaction.
  -- ------------------------------------------------------------------------
  begin
    perform public.confirm_ecg_report_extraction(
      v_extraction,
      '[{"code":"heart_rate","value":72,"unit":"bpm"}]'::jsonb,
      current_date
    );
    v_rpc_blocked := false; -- reached only if the RPC wrongly allowed it
  exception when others then
    v_rpc_blocked := true;
  end;

  perform set_config('role', 'postgres', true);

  -- ------------------------------------------------------------------------
  -- Check 5/9 CONTROLS: a real clinician in the same org CAN read both, and
  -- CAN file the extraction via the RPC.
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n_docs_clin from public.ecg_report_documents where id = v_doc_a;
  select count(*) into n_extractions_clin from public.ecg_report_extractions where id = v_extraction;

  select public.confirm_ecg_report_extraction(
    v_extraction,
    '[{"code":"heart_rate","value":72,"unit":"bpm"}]'::jsonb,
    current_date
  ) into n_filed;

  select status, confirmed_by into v_extraction_status, v_confirmed_by
  from public.ecg_report_extractions where id = v_extraction;

  select count(*) into n_readings
  from public.ecg_parameter_readings
  where ecg_report_document_id = v_doc_a and code = 'heart_rate';

  perform set_config('role', 'postgres', true);

  -- ------------------------------------------------------------------------
  -- Check 10: patient A CAN read their own now-CONFIRMED reading (the final
  -- table is patient-readable, unlike the draft extraction above).
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pat_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n_readings_patient
  from public.ecg_parameter_readings
  where ecg_report_document_id = v_doc_a and code = 'heart_rate';

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  -- ------------------------------------------------------------------------
  -- Results
  -- ------------------------------------------------------------------------
  insert into ecg_rls_result values
    (1, 'patient A: own patient-sourced INSERT into ecg_report_documents succeeds',
        '1', n_docs::text,
        case when n_docs = 1 then 'PASS' else 'FAIL' end),
    (2, 'patient A: can read the document they just uploaded',
        '1', n_docs::text,
        case when n_docs = 1 then 'PASS' else 'FAIL' end),
    (3, 'patient B: cannot read patient A''s ecg_report_documents row',
        '0', n_docs_b::text,
        case when n_docs_b = 0 then 'PASS' else 'FAIL' end),
    (4, 'patient A: cannot read the unconfirmed ecg_report_extractions row for their own ECG',
        '0', n_extractions::text,
        case when n_extractions = 0 then 'PASS' else 'FAIL' end),
    (5, 'CONTROL — clinician CAN read the same ecg_report_documents row',
        '1', n_docs_clin::text,
        case when n_docs_clin = 1 then 'PASS' else 'FAIL' end),
    (6, 'CONTROL — clinician CAN read the ecg_report_extractions draft',
        '1', n_extractions_clin::text,
        case when n_extractions_clin = 1 then 'PASS' else 'FAIL' end),
    (7, 'patient session: confirm_ecg_report_extraction RPC refuses a non-clinical-staff caller',
        'true', v_rpc_blocked::text,
        case when v_rpc_blocked then 'PASS' else 'FAIL' end),
    (8, 'CONTROL — clinician session: confirm_ecg_report_extraction files 1 parameter',
        '1', n_filed::text,
        case when n_filed = 1 then 'PASS' else 'FAIL' end),
    (9, 'confirm stamps status=confirmed and confirmed_by=the acting clinician (never client-trusted)',
        'confirmed/' || v_clin::text, v_extraction_status || '/' || coalesce(v_confirmed_by::text, 'null'),
        case when v_extraction_status = 'confirmed' and v_confirmed_by = v_clin then 'PASS' else 'FAIL' end),
    (10, 'ecg_parameter_readings row landed with the filed heart_rate value',
        '1', n_readings::text,
        case when n_readings = 1 then 'PASS' else 'FAIL' end),
    (11, 'patient A CAN read their own now-confirmed reading (final table is patient-visible)',
        '1', n_readings_patient::text,
        case when n_readings_patient = 1 then 'PASS' else 'FAIL' end);
end $$;

select ord, verdict, check_name, expected, observed
from ecg_rls_result order by ord;

do $$
declare
  v_failed text;
begin
  select string_agg(ord::text || ' (' || check_name || ')', '; ' order by ord)
    into v_failed
  from ecg_rls_result where verdict = 'FAIL';

  if v_failed is not null then
    raise exception 'ecg_report RLS verification FAILED on check(s): %', v_failed;
  end if;
end $$;

rollback;
