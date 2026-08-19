-- H14 (TH-CP-HTN-001 §8.1) fixed the Hypertension Panel's under-delivering test_codes
-- on 2026-07-20 (20260720021422_bp_pathway_sprint_d.sql), using a new 'renal_panel'
-- lab_tests code. The 2026-07-30 catalogue-restore migration
-- (20260730222039_restore_clinical_catalogue.sql) re-inserted panel_bundles from an
-- older snapshot that predated that fix, silently reverting test_codes back to
-- ['lipid_panel','hba1c'] — found live in production on 2026-08-10, three weeks
-- after H14 was logged "built + verified". 'renal_panel' no longer exists as a code
-- (superseded by 'kft', "Kidney Function (U&E, Creatinine, eGFR)", introduced
-- 20260802212103) — all 4 active lab partners already price kft/urinalysis/urine_acr,
-- confirmed before this migration. Re-apply the fix using the current code.

update public.panel_bundles
  set test_codes = array['kft','lipid_panel','hba1c','urinalysis','urine_acr'],
      description = 'BP work-up: kidney function (U&E/creatinine/eGFR), lipids, HbA1c, urinalysis and urine ACR. Add a 12-lead ECG at baseline (recorded separately).'
where code = 'hypertension_panel';

do $$
declare
  v_codes text[];
  v_missing text;
begin
  select test_codes into v_codes from public.panel_bundles where code = 'hypertension_panel';
  if v_codes is null or not (v_codes @> array['kft','urinalysis','urine_acr','lipid_panel','hba1c']) then
    raise exception 'hypertension_panel test_codes fix did not apply as expected: %', v_codes;
  end if;

  select c into v_missing
  from unnest(v_codes) as c
  where not exists (select 1 from public.lab_tests lt where lt.code = c and lt.is_active)
  limit 1;

  if v_missing is not null then
    raise exception 'hypertension_panel references test_code % with no active lab_tests row', v_missing;
  end if;
end $$;
