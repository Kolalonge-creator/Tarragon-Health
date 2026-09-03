-- Blood group / genotype may never enter the record unsourced.
--
-- Every negative is paired with a positive control: "a patient cannot claim a
-- lab-backed value" only means something once "a patient CAN record an attested
-- one" also passes, otherwise a blocked-everything table would score full marks.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/blood_profile_provenance.sql
-- (from the MAIN checkout — see reference_supabase_cli_sql_access)

begin;

do $$
declare
  v_patient uuid := '8487376b-7844-428a-bcb8-8795e89eb0f5'; -- Test Essential Patient
  v_other   uuid := 'ef684028-c40f-4f64-bde9-f84150fb19fd'; -- a different patient
  v_org     uuid := '00000000-0000-0000-0000-000000000001';
  v_staff   uuid;
  v_doc_mine  uuid;
  v_doc_other uuid;
  v_failed  boolean;
  v_row     public.patient_blood_profile%rowtype;
begin
  -- A real org-staff account to act as for the lab-backed cases.
  select id into v_staff from public.profiles
  where organisation_id = v_org and role = 'clinician' limit 1;
  if v_staff is null then
    raise exception 'SETUP: no clinician account in org 0001 to test as';
  end if;

  -- Two real report documents: one on our patient, one on someone else.
  insert into public.lab_result_documents
    (organisation_id, patient_id, file_path, original_filename, mime_type, source)
  values (v_org, v_patient, 'test/mine.pdf', 'mine.pdf', 'application/pdf', 'patient')
  returning id into v_doc_mine;

  insert into public.lab_result_documents
    (organisation_id, patient_id, file_path, original_filename, mime_type, source)
  values (v_org, v_other, 'test/theirs.pdf', 'theirs.pdf', 'application/pdf', 'patient')
  returning id into v_doc_other;

  -- =============================================== STAFF, lab-backed provenance
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. NEGATIVE: lab-backed with no document at all.
  v_failed := false;
  begin
    insert into public.patient_blood_profile
      (patient_id, organisation_id, genotype, provenance)
    values (v_patient, v_org, 'AA', 'lab_document');
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 1: an unsourced lab_document row was accepted';
  end if;
  raise notice 'PASS 1: a lab-backed value with no report is refused';

  -- 2. NEGATIVE: a document belonging to somebody else.
  v_failed := false;
  begin
    insert into public.patient_blood_profile
      (patient_id, organisation_id, genotype, provenance, document_id)
    values (v_patient, v_org, 'AA', 'lab_document', v_doc_other);
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 2: a report belonging to another patient was accepted as evidence';
  end if;
  raise notice 'PASS 2: a report belonging to someone else is refused';

  -- 3. POSITIVE CONTROL: the patient's own report works.
  insert into public.patient_blood_profile
    (patient_id, organisation_id, blood_group, genotype, provenance, document_id, recorded_by)
  values (v_patient, v_org, 'O+', 'AS', 'lab_document', v_doc_mine, v_staff);

  select * into v_row from public.patient_blood_profile where patient_id = v_patient;
  if v_row.provenance <> 'lab_document' or v_row.document_id <> v_doc_mine then
    raise exception 'FAIL 3: the lab-backed row did not store its evidence';
  end if;
  if v_row.attested_at is not null then
    raise exception 'FAIL 3b: a lab-backed row carries an attestation stamp';
  end if;
  raise notice 'PASS 3: a lab-backed value linked to the patient own report is stored';

  -- 4. genotype_note is cleared unless the genotype is actually 'other'.
  update public.patient_blood_profile
  set genotype = 'AA', genotype_note = 'should not survive'
  where patient_id = v_patient;
  select * into v_row from public.patient_blood_profile where patient_id = v_patient;
  if v_row.genotype_note is not null then
    raise exception 'FAIL 4: a stale variant note outlived the genotype it described';
  end if;
  raise notice 'PASS 4: a variant note cannot outlive a non-other genotype';

  delete from public.patient_blood_profile where patient_id = v_patient;

  -- ============================================= PATIENT, attested provenance
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 5. NEGATIVE: a patient cannot dress their own claim up as lab-backed.
  insert into public.patient_blood_profile
    (patient_id, organisation_id, genotype, provenance, document_id, attestation_version)
  values (v_patient, v_org, 'SS', 'lab_document', v_doc_mine, 'blood-attestation-2026-08-03');

  select * into v_row from public.patient_blood_profile where patient_id = v_patient;
  if v_row.provenance <> 'patient_attested' then
    raise exception 'FAIL 5: a patient claimed lab-backed provenance and it stuck';
  end if;
  if v_row.document_id is not null then
    raise exception 'FAIL 5b: a patient attached a report to their own claim';
  end if;
  raise notice 'PASS 5: a patient claim is forced to patient_attested, evidence stripped';

  -- 6. The attestation stamp is server-derived, not client-supplied.
  if v_row.attested_at is null or v_row.attestation_version is null then
    raise exception 'FAIL 6: the attestation was not stamped';
  end if;
  if v_row.recorded_by <> v_patient then
    raise exception 'FAIL 6b: recorded_by was not forced to the acting patient';
  end if;
  raise notice 'PASS 6: attestation stamped server-side, attributed to the real caller';

  -- Clear down AS STAFF. A patient deliberately has no delete policy — they may
  -- record and correct their own value but not erase it — so a delete issued
  -- under the patient's session silently affects zero rows. An earlier draft of
  -- this test assumed otherwise and failed here on a duplicate key, which is
  -- how that policy gap surfaced.
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.patient_blood_profile where patient_id = v_patient;

  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 7. NEGATIVE: no attestation version means no record.
  v_failed := false;
  begin
    insert into public.patient_blood_profile
      (patient_id, organisation_id, genotype, provenance)
    values (v_patient, v_org, 'AA', 'patient_attested');
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 7: an attestation with no recorded wording was accepted';
  end if;
  raise notice 'PASS 7: an attestation must name the wording the patient agreed to';

  -- 8. POSITIVE CONTROL: a proper attestation works.
  insert into public.patient_blood_profile
    (patient_id, organisation_id, blood_group, genotype, provenance, attestation_version)
  values (v_patient, v_org, 'A+', 'AA', 'patient_attested', 'blood-attestation-2026-08-03');
  select * into v_row from public.patient_blood_profile where patient_id = v_patient;
  if v_row.blood_group::text <> 'A+' then
    raise exception 'FAIL 8: a valid attestation did not store';
  end if;
  raise notice 'PASS 8: a patient can record their own value when they attest to it';

  -- 9. NEGATIVE: a patient cannot write somebody else's row.
  v_failed := false;
  begin
    insert into public.patient_blood_profile
      (patient_id, organisation_id, genotype, provenance, attestation_version)
    values (v_other, v_org, 'SS', 'patient_attested', 'blood-attestation-2026-08-03');
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 9: a patient recorded a genotype on someone else record';
  end if;
  raise notice 'PASS 9: a patient cannot write another persons blood profile';

  reset role;
  raise notice 'ALL BLOOD PROFILE PROVENANCE CHECKS PASSED';
end $$;

rollback;
