-- Tarragon Health — MDM terminology core + clinical concept links
-- verification (spec §34.5/§34.6/§34.11).
--
-- Covers: mdm_terminology_core.sql, mdm_units_and_concept_seed.sql,
-- mdm_clinical_concept_links.sql.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/mdm_terminology_and_concept_links.sql
--
-- Run inside a transaction that is always rolled back — nothing here
-- should ever be committed.

begin;

do $$
declare
  v_result record;
  v_org_id uuid;
  v_patient_id uuid;
  v_wrong_domain_concept_id uuid;
  v_insert_wrongly_succeeded boolean := false;
begin
  -- ---------------------------------------------------------------------
  -- 1. lookup_concept: exact code beats exact display beats synonym beats
  -- fuzzy, and an unrelated term stays below the default threshold.
  -- ---------------------------------------------------------------------
  select * into v_result from public.lookup_concept('condition', 'I10') limit 1;
  if v_result.code is distinct from 'I10' or v_result.matched_on is distinct from 'code' then
    raise exception 'FAIL 1: exact code lookup for I10 did not match_on=code (got code=%, matched_on=%)', v_result.code, v_result.matched_on;
  end if;
  raise notice 'PASS 1: lookup_concept exact code match';

  select * into v_result from public.lookup_concept('condition', 'high blood pressure') limit 1;
  if v_result.code is distinct from 'I10' or v_result.matched_on is distinct from 'synonym' then
    raise exception 'FAIL 2: synonym lookup for "high blood pressure" did not resolve to I10 via synonym (got code=%, matched_on=%)', v_result.code, v_result.matched_on;
  end if;
  raise notice 'PASS 2: lookup_concept synonym match ("high blood pressure" -> I10)';

  if exists (select 1 from public.lookup_concept('condition', 'a term with no relation to any seeded concept whatsoever')) then
    raise exception 'FAIL 3: an unrelated term should not clear the default 0.35 score threshold';
  end if;
  raise notice 'PASS 3: an unrelated term returns no candidates';

  -- ---------------------------------------------------------------------
  -- 2. resolve_analyte_concept bridges the TS analyte-catalogue code
  -- string straight to its seeded LOINC concept.
  -- ---------------------------------------------------------------------
  if public.resolve_analyte_concept('creatinine') is null then
    raise exception 'FAIL 4: resolve_analyte_concept(creatinine) should resolve to the seeded LOINC concept';
  end if;
  if public.resolve_analyte_concept('a-code-that-was-never-seeded') is not null then
    raise exception 'FAIL 5: resolve_analyte_concept should return null for an unseeded code, not guess';
  end if;
  raise notice 'PASS 4/5: resolve_analyte_concept resolves seeded codes and returns null for unseeded ones';

  -- ---------------------------------------------------------------------
  -- 3. private.validate_concept_domain rejects a cross-domain concept_id
  -- assignment (a medication concept on patient_conditions.
  -- condition_concept_id).
  -- ---------------------------------------------------------------------
  select id into v_org_id from public.organisations limit 1;
  select id into v_patient_id from public.profiles where role = 'patient' limit 1;
  select id into v_wrong_domain_concept_id from public.reference_concepts where domain = 'medication' limit 1;

  if v_org_id is not null and v_patient_id is not null and v_wrong_domain_concept_id is not null then
    begin
      insert into public.patient_conditions (organisation_id, patient_id, condition_name, condition_concept_id)
      values (v_org_id, v_patient_id, 'mdm terminology test', v_wrong_domain_concept_id);
      v_insert_wrongly_succeeded := true;
    exception
      when others then
        if sqlerrm not like '%must reference a "condition" concept%' then
          raise exception 'FAIL 6: unexpected error from domain guard: %', sqlerrm;
        end if;
    end;

    if v_insert_wrongly_succeeded then
      raise exception 'FAIL 6: patient_conditions accepted a medication-domain concept as condition_concept_id';
    end if;
    raise notice 'PASS 6: cross-domain concept_id assignment is rejected';
  else
    raise notice 'SKIP 6: no org/patient/medication-concept fixture available';
  end if;

  -- ---------------------------------------------------------------------
  -- 4. anon must never reach any of this.
  -- ---------------------------------------------------------------------
  if has_function_privilege('anon', 'public.lookup_concept(public.reference_concept_domain, text, numeric, integer)', 'EXECUTE') then
    raise exception 'FAIL 7: anon holds EXECUTE on lookup_concept';
  end if;
  if has_table_privilege('anon', 'public.reference_concepts', 'SELECT') then
    raise exception 'FAIL 7: anon holds SELECT on reference_concepts';
  end if;
  raise notice 'PASS 7: anon has no access to the terminology core';

  raise notice 'ALL MDM TERMINOLOGY + CONCEPT LINK CHECKS PASSED';
end $$;

rollback;
