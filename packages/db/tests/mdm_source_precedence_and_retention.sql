-- Tarragon Health — MDM source precedence + data retention governance
-- verification (spec §34.9/§34.16).
--
-- Covers: mdm_source_precedence.sql, mdm_data_retention_policies.sql.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/mdm_source_precedence_and_retention.sql
--
-- Run inside a transaction that is always rolled back — nothing here
-- should ever be committed.

begin;

do $$
declare
  v_patient uuid := '8487376b-7844-428a-bcb8-8795e89eb0f5'; -- Test Essential Patient
  v_org     uuid := '00000000-0000-0000-0000-000000000001';
  v_staff   uuid;
  v_doc     uuid;
  v_superseded_before int;
  v_superseded_after  int;
begin
  -- ---------------------------------------------------------------------
  -- 1. resolve_source_precedence: seeded ranking, self-agreement, and an
  -- unranked domain refusing to silently pick a winner.
  -- ---------------------------------------------------------------------
  if public.resolve_source_precedence('blood_profile', 'lab_document', 'patient_attested') <> 'lab_document' then
    raise exception 'FAIL 1: lab_document should outrank patient_attested for blood_profile';
  end if;
  if public.resolve_source_precedence('blood_profile', 'lab_document', 'lab_document') <> 'lab_document' then
    raise exception 'FAIL 1: identical sources should resolve to themselves';
  end if;
  if public.resolve_source_precedence('an_unranked_domain', 'a', 'b') is not null then
    raise exception 'FAIL 1: an unranked domain must resolve to null, not silently pick a winner';
  end if;
  raise notice 'PASS 1: resolve_source_precedence ranking/self-agreement/unranked-domain behaviour';

  -- ---------------------------------------------------------------------
  -- 2. End-to-end trigger test against this project's own fixture
  -- patient/org (same convention as packages/db/tests/
  -- blood_profile_provenance.sql): a staff-recorded lab_document genotype
  -- must survive a subsequent patient self-attestation attempt at a
  -- DIFFERENT genotype, and the rejected attempt must be preserved in
  -- superseded_source_values rather than disappearing.
  -- ---------------------------------------------------------------------
  select id into v_staff from public.profiles where organisation_id = v_org and role = 'clinician' limit 1;
  if v_staff is null then
    raise notice 'SKIP 2: no clinician in fixture org %', v_org;
  else
    insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, source)
    values (v_org, v_patient, 'test/mdm-source-precedence-check.pdf', 'mdm-source-precedence-check.pdf', 'application/pdf', 'patient')
    returning id into v_doc;

    perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.patient_blood_profile (patient_id, organisation_id, genotype, provenance, document_id)
    values (v_patient, v_org, 'AA', 'lab_document', v_doc)
    on conflict (patient_id) do update set genotype = 'AA', provenance = 'lab_document', document_id = v_doc, attested_at = null, attestation_version = null;
    reset role;

    select count(*) into v_superseded_before from public.superseded_source_values where patient_id = v_patient;

    perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.patient_blood_profile set genotype = 'AS', attestation_version = 'v1' where patient_id = v_patient;
    reset role;

    select count(*) into v_superseded_after from public.superseded_source_values where patient_id = v_patient;
    if v_superseded_after <> v_superseded_before + 1 then
      raise exception 'FAIL 2: rejected patient claim was not recorded in superseded_source_values (before=%, after=%)', v_superseded_before, v_superseded_after;
    end if;
    if not exists (select 1 from public.patient_blood_profile where patient_id = v_patient and genotype = 'AA' and provenance = 'lab_document') then
      raise exception 'FAIL 2: lab-confirmed genotype was overwritten by a lower-precedence patient attestation';
    end if;
    raise notice 'PASS 2: a lab-confirmed genotype survives a lower-precedence overwrite attempt, and the rejected claim is preserved';

    -- Clean up this test's own fixture writes (not run inside a
    -- migration this time, but the surrounding transaction is rolled
    -- back regardless — belt and braces, matching this repo's other
    -- fixture-writing tests).
    delete from public.superseded_source_values where patient_id = v_patient;
    delete from public.patient_blood_profile where patient_id = v_patient;
    delete from public.lab_result_documents where id = v_doc;
  end if;

  -- ---------------------------------------------------------------------
  -- 3. Retention governance: every clinical/financial/consent category is
  -- explicitly unresolved (null period), never an invented number.
  -- ---------------------------------------------------------------------
  if exists (
    select 1 from public.data_retention_policies
    where category in ('clinical_records', 'financial_records', 'consent_and_legal_records')
      and retention_period_months is not null
  ) then
    raise exception 'FAIL 3: a clinical/financial/consent retention category has a period where none has been legally confirmed';
  end if;
  if not exists (select 1 from public.data_retention_policies where category = 'clinical_records') then
    raise exception 'FAIL 3: clinical_records retention category is missing';
  end if;
  raise notice 'PASS 3: retention policy seed data has no invented legal periods';

  -- ---------------------------------------------------------------------
  -- 4. anon must never reach any of this.
  -- ---------------------------------------------------------------------
  if has_function_privilege('anon', 'public.resolve_source_precedence(text,text,text)', 'EXECUTE')
    or has_table_privilege('anon', 'public.superseded_source_values', 'SELECT')
    or has_table_privilege('anon', 'public.data_retention_policies', 'SELECT')
  then
    raise exception 'FAIL 4: anon holds access to source-precedence or retention tables/functions it should not';
  end if;
  raise notice 'PASS 4: anon has no access to source-precedence or retention tables/functions';

  raise notice 'ALL MDM SOURCE PRECEDENCE + RETENTION CHECKS PASSED';
end $$;

rollback;
