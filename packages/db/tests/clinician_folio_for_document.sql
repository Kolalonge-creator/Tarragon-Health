-- ===========================================================================
-- Proof: *_clinician_folio_for_document.sql (CMO decision Q17, OQ-358, step 1 of 2).
--
-- public.clinician_folio_for_document returns a clinician's MDCN folio only for an entitled document flow.
-- Contract: entitled = row (null folio if no staff row); exists but not entitled = 42501; missing = zero rows.
-- Also proves a forged service_role JWT claim from an authenticated session gets nothing.
-- Proves, with simulated sessions: the owning patient gets the folio for a referral, prescription, lab request,
-- lab interpretation, verified document and vaccination certificate; another patient gets zero rows for every
-- kind; a colleague never gets a referral folio and for prescriptions/vaccinations agrees exactly with
-- private.staff_may_read; service role gets the lab request folio; an unknown kind is refused; an empty id list
-- returns nothing; anon cannot execute it; a patient cannot read clinical_staff. Does NOT assert anything about
-- the directory view (step 2 hides the column). SABOTAGE (last block): the function is redefined to ignore
-- entitlement; the stranger-patient assertion MUST then fail.
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
  v_med_nostaff uuid := gen_random_uuid();
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
  -- a prescription whose prescriber has no clinical_staff row
  insert into public.medications (id, organisation_id, patient_id, drug_name, added_by)
  values (v_med_nostaff, v_org, v_pat, 'NoStaffDrug', v_pat);
  alter table public.medications disable trigger user;
  update public.medications set added_by = null where id = v_med_nostaff;
  alter table public.medications enable trigger user;
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

  -- 4. anon
  execute 'set local role anon';
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

  -- another patient: 42501 for every kind (a refusal must never look like "no folio")
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  foreach v_f in array array['referral_letter:' || v_ref, 'prescription:' || v_med, 'lab_request:' || v_lab,
                             'lab_result_interpretation:' || v_lrd, 'verified_document:' || v_vd, 'vaccination_certificate:' || v_vr] loop
    v_failed := false;
    begin perform 1 from public.clinician_folio_for_document(split_part(v_f, ':', 1), array[split_part(v_f, ':', 2)::uuid]);
    exception when insufficient_privilege then v_failed := true; end;
    if not v_failed then execute 'reset role'; raise exception 'FAIL: a stranger patient was not refused for %', v_f; end if;
  end loop;
  -- a document id that does not exist yields no row, not a refusal
  select count(*) into v_n from public.clinician_folio_for_document('prescription', array[gen_random_uuid()]);
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL: a nonexistent document returned % rows', v_n; end if;

  -- an entitled document whose clinician has no staff row still returns a row, with a null folio
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.clinician_folio_for_document('prescription', array[v_med_nostaff]) where credential_number is null;
  execute 'reset role';
  if v_n <> 1 then raise exception 'FAIL: entitled document with no staff row did not return a null-folio row (%)', v_n; end if;

  -- colleague: never a referral (patient-only policy); for prescriptions/vaccinations the function must agree exactly with
  -- the tied-read rule (private.staff_may_read): entitled returns the folio, otherwise it is refused
  perform set_config('request.jwt.claims', json_build_object('sub', v_docB, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin perform 1 from public.clinician_folio_for_document('referral_letter', array[v_ref]);
  exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then execute 'reset role'; raise exception 'FAIL: colleague was not refused a referral folio'; end if;
  v_expect := private.staff_may_read(v_pat, v_org, 'medications'::public.care_access_category);
  v_failed := false;
  begin perform 1 from public.clinician_folio_for_document('prescription', array[v_med]);
  exception when insufficient_privilege then v_failed := true; end;
  if v_failed is distinct from (not v_expect) then execute 'reset role'; raise exception 'FAIL: prescription entitlement for a colleague disagrees with staff_may_read (%)', v_expect; end if;
  v_expect := private.staff_may_read(v_pat, v_org, 'vaccinations'::public.care_access_category);
  v_failed := false;
  begin perform 1 from public.clinician_folio_for_document('vaccination_certificate', array[v_vr]);
  exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if v_failed is distinct from (not v_expect) then raise exception 'FAIL: vaccination entitlement for a colleague disagrees with staff_may_read (%)', v_expect; end if;

  -- a FORGED service-role claim from an authenticated session obtains nothing
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'service_role')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin perform 1 from public.clinician_folio_for_document('lab_request', array[v_lab]);
  exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then execute 'reset role'; raise exception 'FAIL: a forged service_role JWT claim obtained another patient''s folio'; end if;
  -- (set_config('role', ...) is not asserted: SET ROLE is checked against the session user, so a session that could
  -- switch to service_role would already BE the service role. The function trusts only the real role, never a claim.)
  execute 'reset role';

  -- the REAL service role (the internal notification PDF route) still gets the lab request folio
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  select string_agg(credential_number, ',') into v_f from public.clinician_folio_for_document('lab_request', array[v_lab]);
  execute 'reset role';
  if v_f is distinct from 'FOLIO-A' then raise exception 'FAIL: service role did not get the lab request folio (%)', v_f; end if;

  -- SABOTAGE: a function that ignores entitlement; the stranger assertion must now see rows
  create or replace function public.clinician_folio_for_document(p_document_kind text, p_document_ids uuid[])
  returns table (document_id uuid, clinician_staff_id uuid, clinician_profile_id uuid, full_name text, credential_type text, credential_number text)
  language sql security definer set search_path = '' as $f$
    select m.id, cs.id, cs.profile_id, cs.full_name, cs.credential_type, cs.credential_number
    from public.medications m join public.clinical_staff cs on cs.profile_id = m.added_by where m.id = any (p_document_ids)
  $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin perform 1 from public.clinician_folio_for_document('prescription', array[v_med]);
  exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if v_failed then raise exception 'SABOTAGE FAIL: the check did not detect a function that ignores entitlement'; end if;
  raise notice 'clinician_folio_for_document: all assertions passed; sabotage detected';
end $$;

rollback;
