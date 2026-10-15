-- ===========================================================================
-- Proof: *_folio_not_exposed_via_staff_directory.sql (CMO decision Q17, OQ-358).
--
-- A clinician's MDCN folio is never shown publicly. Proves, with simulated sessions:
--   1. public.clinical_staff_directory has no credential_number column: a patient and a clinician colleague
--      both fail with undefined_column when they ask for it, and still read the name.
--   2. A patient cannot read clinical_staff (the base table) at all; the clinician can read their own row.
--   3. authenticated holds no INSERT/UPDATE/DELETE on the directory view (it was auto-updatable and owner-run).
--   4. anon can neither read the view nor execute public.clinician_folio_for_document.
--   5. clinician_folio_for_document returns the folio only for an entitled document flow: the patient who owns
--      a referral / prescription / lab request / lab interpretation gets it; another patient gets zero rows;
--      a colleague gets it for the staff-readable kinds (prescription, lab_request) but not for a referral
--      (patient-only policy); an unknown kind is refused; no ids returns nothing.
-- SABOTAGE (last block): the view is redefined to expose credential_number again and assertion 1 is run
-- again; it MUST fail, proving the check can fail.
-- Not asserted (documented open follow-up, docs/design/folio-exposure-fix.md): a clinician colleague can
-- still read the folio from the base table clinical_staff, because org staff are admitted by its policy.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_pat2 uuid := gen_random_uuid();
  v_docA uuid := gen_random_uuid();
  v_docB uuid := gen_random_uuid();
  v_staffA uuid;
  v_ref uuid := gen_random_uuid();
  v_med uuid := gen_random_uuid();
  v_lab uuid := gen_random_uuid();
  v_lrd uuid := gen_random_uuid();
  v_vd uuid := gen_random_uuid();
  v_vr uuid := gen_random_uuid();
  v_expect boolean;
  v_n integer;
  v_failed boolean;
  v_f text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'folio-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}'
    from unnest(array[v_pat, v_pat2, v_docA, v_docB]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,  v_org, 'patient',   'Folio Patient',   '+2348058880501'),
    (v_pat2, v_org, 'patient',   'Folio Patient 2', '+2348058880502'),
    (v_docA, v_org, 'clinician', 'Folio Doctor A',  '+2348058880503'),
    (v_docB, v_org, 'clinician', 'Folio Doctor B',  '+2348058880504')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, doctor_tier, credential_type, credential_number,
                                     license_verified_at, license_expires_at, indemnity_insurer, indemnity_policy_number, indemnity_expires_at) values
    (v_org, v_docA, 'Folio Doctor A', true, 'senior_medical_officer', 'MDCN', 'FOLIO-A', now(), now() + interval '1 year', 'Probe', 'F-A', now() + interval '1 year'),
    (v_org, v_docB, 'Folio Doctor B', true, 'senior_medical_officer', 'MDCN', 'FOLIO-B', now(), now() + interval '1 year', 'Probe', 'F-B', now() + interval '1 year');
  select id into v_staffA from public.clinical_staff where profile_id = v_docA;

  -- the document triggers read the acting clinician from the session
  perform set_config('request.jwt.claims', json_build_object('sub', v_docA, 'role', 'authenticated')::text, true);
  insert into public.specialist_referrals (id, organisation_id, patient_id, specialist_type, set_by)
  values (v_ref, v_org, v_pat, (enum_range(null::public.specialist_type))[1], v_docA);
  insert into public.medications (id, organisation_id, patient_id, drug_name, added_by)
  values (v_med, v_org, v_pat, 'FolioDrug', v_docA);
  -- a clinician-originated order: origin is the first enum label other than patient_initiated
  execute format('insert into public.lab_orders (id, organisation_id, patient_id, ordered_by, origin, clinical_indication) values (%L, %L, %L, %L, %L, ''folio proof'')',
    v_lab, v_org, v_pat, v_staffA,
    (select e.enumlabel from pg_attribute a join pg_enum e on e.enumtypid = a.atttypid
      where a.attrelid = 'public.lab_orders'::regclass and a.attname = 'origin' and e.enumlabel <> 'patient_initiated'
      order by e.enumsortorder limit 1));
  insert into public.lab_result_documents (id, organisation_id, patient_id, file_path, source, reviewed_by, reviewed_at,
                                           patient_interpretation, interpretation_sent_at)
  values (v_lrd, v_org, v_pat, 'folio/x.pdf', (enum_range(null::public.lab_result_document_source))[1], v_docA, now(), 'ok', now());
  -- an insert trigger clears the review columns; the reviewing clinician sets them in a separate update
  update public.lab_result_documents set reviewed_by = v_docA, reviewed_at = now() where id = v_lrd;

  -- the purchase-credit trigger is unrelated to this proof; switch the table's user triggers off inside this rolled-back transaction
  alter table public.verified_documents disable trigger user;
  insert into public.verified_documents (id, organisation_id, patient_id, document_type, status, issued_by, attestation_text, valid_from, issued_at)
  values (v_vd, v_org, v_pat, (enum_range(null::public.verified_document_type))[1], 'issued', v_staffA, 'folio proof', now(), now());
  alter table public.verified_documents enable trigger user;
  insert into public.vaccination_records (id, organisation_id, profile_id, vaccination_catalog_id, date_administered, verification_status, verified_by, verified_at,
                                          tarragon_certificate_serial, tarragon_certificate_issued_at)
  values (v_vr, v_org, v_pat, (select id from public.vaccination_catalog limit 1), current_date, 'verified', v_docA, now(), 'FOLIO-SERIAL', now());

  -- 1. no folio column in the directory view, for a patient and for a colleague
  foreach v_f in array array[v_pat::text, v_docB::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_f, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_failed := false;
    begin execute 'select credential_number from public.clinical_staff_directory limit 1';
    exception when undefined_column then v_failed := true; end;
    select count(*) into v_n from public.clinical_staff_directory where full_name = 'Folio Doctor A';
    execute 'reset role';
    if not v_failed then raise exception 'FAIL: session % could select credential_number from the directory view', v_f; end if;
    if v_n <> 1 then raise exception 'FAIL: session % could no longer read the staff name from the directory (%)', v_f, v_n; end if;
  end loop;

  -- 2. a patient cannot read the base table; the clinician reads their own row
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.clinical_staff where profile_id = v_docA;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL: a patient read % clinical_staff rows', v_n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_docA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select credential_number into v_f from public.clinical_staff where profile_id = v_docA;
  execute 'reset role';
  if v_f is distinct from 'FOLIO-A' then raise exception 'FAIL: the clinician could not read their own folio (%)', v_f; end if;

  -- 3. no write grants on the view
  if has_table_privilege('authenticated', 'public.clinical_staff_directory', 'UPDATE')
     or has_table_privilege('authenticated', 'public.clinical_staff_directory', 'INSERT')
     or has_table_privilege('authenticated', 'public.clinical_staff_directory', 'DELETE') then
    raise exception 'FAIL: authenticated has write privileges on the directory view';
  end if;

  -- 4. anon
  execute 'set local role anon';
  v_failed := false;
  begin perform 1 from public.clinical_staff_directory limit 1;
  exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then execute 'reset role'; raise exception 'FAIL: anon read the directory view'; end if;
  v_failed := false;
  begin perform 1 from public.clinician_folio_for_document('prescription', array[v_med]);
  exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL: anon executed clinician_folio_for_document'; end if;

  -- 5. the narrow function
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select string_agg(credential_number, ',') into v_f from public.clinician_folio_for_document('referral_letter', array[v_ref]);
  if v_f is distinct from 'FOLIO-A' then raise exception 'FAIL: patient did not get the referral folio (%)', v_f; end if;
  select string_agg(credential_number, ',') into v_f from public.clinician_folio_for_document('prescription', array[v_med]);
  if v_f is distinct from 'FOLIO-A' then raise exception 'FAIL: patient did not get the prescription folio (%)', v_f; end if;
  select string_agg(credential_number, ',') into v_f from public.clinician_folio_for_document('lab_request', array[v_lab]);
  if v_f is distinct from 'FOLIO-A' then raise exception 'FAIL: patient did not get the lab request folio (%)', v_f; end if;
  select string_agg(credential_number, ',') into v_f from public.clinician_folio_for_document('lab_result_interpretation', array[v_lrd]);
  if v_f is distinct from 'FOLIO-A' then raise exception 'FAIL: patient did not get the lab interpretation folio (%)', v_f; end if;
  select string_agg(credential_number, ',') into v_f from public.clinician_folio_for_document('verified_document', array[v_vd]);
  if v_f is distinct from 'FOLIO-A' then raise exception 'FAIL: patient did not get the verified document folio (%)', v_f; end if;
  select string_agg(credential_number, ',') into v_f from public.clinician_folio_for_document('vaccination_certificate', array[v_vr]);
  if v_f is distinct from 'FOLIO-A' then raise exception 'FAIL: patient did not get the vaccination certificate folio (%)', v_f; end if;
  select count(*) into v_n from public.clinician_folio_for_document('prescription', array[]::uuid[]);
  if v_n <> 0 then raise exception 'FAIL: empty id list returned rows'; end if;
  v_failed := false;
  begin perform 1 from public.clinician_folio_for_document('nonsense', array[v_med]);
  exception when invalid_parameter_value then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: unknown document kind was not refused'; end if;
  execute 'reset role';

  -- another patient: zero rows for every kind
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from (
    select 1 from public.clinician_folio_for_document('referral_letter', array[v_ref])
    union all select 1 from public.clinician_folio_for_document('prescription', array[v_med])
    union all select 1 from public.clinician_folio_for_document('lab_request', array[v_lab])
    union all select 1 from public.clinician_folio_for_document('lab_result_interpretation', array[v_lrd])
    union all select 1 from public.clinician_folio_for_document('verified_document', array[v_vd])
    union all select 1 from public.clinician_folio_for_document('vaccination_certificate', array[v_vr])) s;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL: a stranger patient got % folio rows', v_n; end if;

  -- colleague: never a referral (patient-only policy); for prescriptions the function must agree exactly with the
  -- tied-read rule (private.staff_may_read), whatever the tied-reads switch says, so it is never looser than the table
  perform set_config('request.jwt.claims', json_build_object('sub', v_docB, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.clinician_folio_for_document('referral_letter', array[v_ref]);
  if v_n <> 0 then execute 'reset role'; raise exception 'FAIL: colleague got a referral folio (%)', v_n; end if;
  v_expect := private.staff_may_read(v_pat, v_org, 'medications'::public.care_access_category);
  select count(*) into v_n from public.clinician_folio_for_document('prescription', array[v_med]);
  if (v_n > 0) is distinct from v_expect then execute 'reset role'; raise exception 'FAIL: prescription folio for a colleague (%) disagrees with staff_may_read (%)', v_n, v_expect; end if;
  v_expect := private.staff_may_read(v_pat, v_org, 'vaccinations'::public.care_access_category);
  select count(*) into v_n from public.clinician_folio_for_document('vaccination_certificate', array[v_vr]);
  execute 'reset role';
  if (v_n > 0) is distinct from v_expect then raise exception 'FAIL: vaccination folio for a colleague (%) disagrees with staff_may_read (%)', v_n, v_expect; end if;

  -- service role (the internal notification PDF route) still gets the lab request folio
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  select string_agg(credential_number, ',') into v_f from public.clinician_folio_for_document('lab_request', array[v_lab]);
  execute 'reset role';
  if v_f is distinct from 'FOLIO-A' then raise exception 'FAIL: service role did not get the lab request folio (%)', v_f; end if;

  -- SABOTAGE: re-expose the folio in the view; assertion 1 must now fail
  drop view public.clinical_staff_directory;
  create view public.clinical_staff_directory with (security_invoker = false) as
    select id, organisation_id, profile_id, full_name, credential_number from public.clinical_staff;
  grant select on public.clinical_staff_directory to authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin execute 'select credential_number from public.clinical_staff_directory limit 1';
  exception when undefined_column then v_failed := true; end;
  execute 'reset role';
  if v_failed then raise exception 'SABOTAGE FAIL: the check did not detect a re-exposed folio'; end if;
  raise notice 'folio_not_exposed: all assertions passed; sabotage detected';
end $$;

rollback;
