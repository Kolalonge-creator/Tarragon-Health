-- Verifies the structured per-analyte result pipeline for the Core/Advanced/
-- Comprehensive Screen ladder: annual_health_checks links to the purchased
-- order, screening_results.follow_up_action stores, an order auto-resolves
-- to 'resulted' only once every APPLICABLE test_code has a result, and the
-- once-per-lifetime (genotype/blood group) vs annual vs dormant-imaging vs
-- sex/age-gated (psa) distinctions all hold. Rolled back, no residue.
--
-- total_kobo is 0 and status is never 'pending_payment'/'payment_confirmed'
-- throughout — every Screen-tier order is self-arranged fulfilment as of
-- 20260803124833_self_arranged_lab_fulfilment.sql, and
-- private.enforce_lab_order_origin rejects both for a self_arranged order
-- (which lab_orders.fulfilment now defaults to).
--
-- Reuses three real, pre-existing patient fixtures rather than minting new
-- auth.users rows: one with sex=null (age ~41), one male (age ~66, born
-- 1960), and one female (age ~71) — swap the ids below if any stops
-- existing.
begin;

create temporary table test_results (case_name text, passed boolean) on commit drop;

do $$
declare
  v_patient uuid := 'bb707ae8-1d0b-49c2-b990-1950de601db4'; -- sex null, age ~41
  v_male uuid := '04280ae6-f1bd-4fc9-a588-fac792e032af';    -- male, age ~66
  v_female uuid := '365067dc-7c0f-45e8-a807-8cd70f2da8dd';  -- female, age ~71
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_core_bundle uuid;
  v_comp_bundle uuid;
  v_order1 uuid;
  v_order2 uuid;
  v_order3 uuid;
  v_order4 uuid;
  v_order5 uuid;
  v_year int := extract(year from (now() at time zone 'Africa/Lagos'))::int;
begin
  select id into v_core_bundle from public.panel_bundles where code = 'screen_core';
  select id into v_comp_bundle from public.panel_bundles where code = 'screen_comprehensive';

  -- All three fixtures are real, pre-existing patients and may already carry
  -- a real annual_health_checks row for this year from their own live orders
  -- (this reused v_patient id is, in fact, the real patient behind the
  -- platform's one live self-arranged Screen order) -- delete any such row
  -- inside this rolled-back transaction so check1 below observes a clean
  -- insert-creates-the-link rather than tripping the "first order of the
  -- year keeps the link" coalesce behaviour against unrelated real data.
  delete from public.annual_health_checks where patient_id in (v_patient, v_male, v_female) and year = v_year;

  -- Order 1: screen_core, self-arranged -- the only shape the real app ever
  -- inserts today (apps/web/src/lib/queries/lab-orders.ts's
  -- useCreateLabOrder/useOrderLabTest both insert status='ordered',
  -- total_kobo=0, and rely on fulfilment's table default of
  -- 'self_arranged'; private.enforce_lab_order_origin rejects anything
  -- else for a self_arranged row, so a pending_payment/payment_confirmed
  -- fixture here would not exercise -- and previously did not even survive
  -- -- the real trigger stack). Entering results one code at a time.
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, status, total_kobo, origin, investigation_tier)
  values (v_org, v_patient, v_core_bundle, 'ordered', 0, 'patient_initiated', 1)
  returning id into v_order1;

  insert into test_results select 'check1_self_arranged_insert_links_annual_check',
    exists(select 1 from public.annual_health_checks where patient_id = v_patient and year = v_year
      and lab_order_id = v_order1 and status = 'in_progress');

  insert into public.screening_results (organisation_id, patient_id, lab_order_id, screen_type_code, result_status)
  values
    (v_org, v_patient, v_order1, 'hba1c', 'normal'),
    (v_org, v_patient, v_order1, 'lipid_panel', 'normal'),
    (v_org, v_patient, v_order1, 'fbc', 'normal'),
    (v_org, v_patient, v_order1, 'lft', 'normal'),
    (v_org, v_patient, v_order1, 'kft', 'normal'),
    (v_org, v_patient, v_order1, 'tft', 'normal'),
    (v_org, v_patient, v_order1, 'urinalysis', 'normal'),
    (v_org, v_patient, v_order1, 'hiv', 'normal'),
    (v_org, v_patient, v_order1, 'hep_b', 'normal'),
    (v_org, v_patient, v_order1, 'hep_c', 'normal');

  insert into test_results select 'check2_not_resulted_until_complete',
    (select status = 'ordered' from public.lab_orders where id = v_order1);

  insert into public.screening_results (organisation_id, patient_id, lab_order_id, screen_type_code, result_status, follow_up_action)
  values (v_org, v_patient, v_order1, 'blood_group', 'abnormal', 'test follow-up action stored');

  insert into test_results select 'check3_still_missing_genotype',
    (select status = 'ordered' from public.lab_orders where id = v_order1);

  insert into public.screening_results (organisation_id, patient_id, lab_order_id, screen_type_code, result_status)
  values (v_org, v_patient, v_order1, 'sickle_cell_genotype', 'normal');

  insert into test_results select 'check4_resolves_on_last_code',
    (select status = 'resulted' and resulted_at is not null from public.lab_orders where id = v_order1);

  insert into test_results select 'check5_follow_up_action_persisted',
    (select follow_up_action = 'test follow-up action stored' from public.screening_results
     where lab_order_id = v_order1 and screen_type_code = 'blood_group');

  -- Order 2: a fresh screen_core order, same patient -- once-per-lifetime
  -- genotype/blood group already satisfied without a fresh entry.
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, status, total_kobo, origin, investigation_tier)
  values (v_org, v_patient, v_core_bundle, 'ordered', 0, 'patient_initiated', 1)
  returning id into v_order2;

  insert into public.screening_results (organisation_id, patient_id, lab_order_id, screen_type_code, result_status)
  values
    (v_org, v_patient, v_order2, 'hba1c', 'normal'),
    (v_org, v_patient, v_order2, 'lipid_panel', 'normal'),
    (v_org, v_patient, v_order2, 'fbc', 'normal'),
    (v_org, v_patient, v_order2, 'lft', 'normal'),
    (v_org, v_patient, v_order2, 'kft', 'normal'),
    (v_org, v_patient, v_order2, 'tft', 'normal'),
    (v_org, v_patient, v_order2, 'urinalysis', 'normal'),
    (v_org, v_patient, v_order2, 'hiv', 'normal'),
    (v_org, v_patient, v_order2, 'hep_b', 'normal'),
    (v_org, v_patient, v_order2, 'hep_c', 'normal');

  insert into test_results select 'check6_once_per_lifetime_carries_forward',
    (select status = 'resulted' from public.lab_orders where id = v_order2);

  -- Order 3: screen_comprehensive, null-sex ~41yo patient -- dormant
  -- imaging (echo -- not in any bundle, irrelevant here) AND every sex-gated
  -- code this null-sex patient doesn't match (psa, prostate_ultrasound,
  -- breast_imaging) are correctly excluded from the completeness
  -- requirement. abdominal_ultrasound is sex='all', so unlike the other
  -- three imaging codes it's never excluded here on sex grounds -- it's
  -- required and supplied below, same as any other non-dormant code.
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, status, total_kobo, origin, investigation_tier)
  values (v_org, v_patient, v_comp_bundle, 'ordered', 0, 'patient_initiated', 1)
  returning id into v_order3;

  insert into public.screening_results (organisation_id, patient_id, lab_order_id, screen_type_code, result_status)
  values
    (v_org, v_patient, v_order3, 'hba1c', 'normal'),
    (v_org, v_patient, v_order3, 'lipid_panel', 'normal'),
    (v_org, v_patient, v_order3, 'fbc', 'normal'),
    (v_org, v_patient, v_order3, 'lft', 'normal'),
    (v_org, v_patient, v_order3, 'kft', 'normal'),
    (v_org, v_patient, v_order3, 'tft', 'normal'),
    (v_org, v_patient, v_order3, 'urinalysis', 'normal'),
    (v_org, v_patient, v_order3, 'hiv', 'normal'),
    (v_org, v_patient, v_order3, 'hep_b', 'normal'),
    (v_org, v_patient, v_order3, 'hep_c', 'normal'),
    (v_org, v_patient, v_order3, 'urine_acr', 'normal'),
    (v_org, v_patient, v_order3, 'ogtt_fpg', 'normal'),
    (v_org, v_patient, v_order3, 'ecg_resting', 'normal'),
    (v_org, v_patient, v_order3, 'fit', 'normal'),
    (v_org, v_patient, v_order3, 'syphilis', 'normal'),
    (v_org, v_patient, v_order3, 'abdominal_ultrasound', 'normal');

  insert into test_results select 'check7_comprehensive_ignores_dormant_imaging_and_sex_gated_psa',
    (select status = 'resulted' from public.lab_orders where id = v_order3);

  insert into test_results select 'check8_comprehensive_video_consult_created',
    exists(select 1 from public.video_consultations where patient_id = v_patient and context = 'annual_review'
      and created_at > now() - interval '1 minute');

  -- Order 4: MALE patient -- psa genuinely required, gated on shared
  -- decision-making (private.enforce_psa_sdm_gate).
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, status, total_kobo, origin, investigation_tier)
  values (v_org, v_male, v_comp_bundle, 'ordered', 0, 'patient_initiated', 1)
  returning id into v_order4;

  insert into public.screening_results (organisation_id, patient_id, lab_order_id, screen_type_code, result_status)
  values
    (v_org, v_male, v_order4, 'hba1c', 'normal'),
    (v_org, v_male, v_order4, 'lipid_panel', 'normal'),
    (v_org, v_male, v_order4, 'fbc', 'normal'),
    (v_org, v_male, v_order4, 'lft', 'normal'),
    (v_org, v_male, v_order4, 'kft', 'normal'),
    (v_org, v_male, v_order4, 'tft', 'normal'),
    (v_org, v_male, v_order4, 'urinalysis', 'normal'),
    (v_org, v_male, v_order4, 'hiv', 'normal'),
    (v_org, v_male, v_order4, 'hep_b', 'normal'),
    (v_org, v_male, v_order4, 'hep_c', 'normal'),
    (v_org, v_male, v_order4, 'urine_acr', 'normal'),
    (v_org, v_male, v_order4, 'ogtt_fpg', 'normal'),
    (v_org, v_male, v_order4, 'ecg_resting', 'normal'),
    (v_org, v_male, v_order4, 'fit', 'normal'),
    (v_org, v_male, v_order4, 'syphilis', 'normal'),
    (v_org, v_male, v_order4, 'blood_group', 'normal'),
    (v_org, v_male, v_order4, 'sickle_cell_genotype', 'normal'),
    (v_org, v_male, v_order4, 'abdominal_ultrasound', 'normal'),
    (v_org, v_male, v_order4, 'prostate_ultrasound', 'normal');

  insert into test_results select 'check9_male_missing_psa_stays_unresolved',
    (select status = 'ordered' from public.lab_orders where id = v_order4);

  insert into public.patient_shared_decisions (organisation_id, patient_id, screen_type_code, notes)
  values (v_org, v_male, 'psa', 'test SDM fixture');

  insert into public.screening_results (organisation_id, patient_id, lab_order_id, screen_type_code, result_status)
  values (v_org, v_male, v_order4, 'psa', 'normal');

  insert into test_results select 'check10_male_resolves_once_psa_entered_after_sdm',
    (select status = 'resulted' from public.lab_orders where id = v_order4);

  -- Order 5: FEMALE patient, screen_comprehensive -- breast_imaging is no
  -- longer dormant as of 20260811222950 (self-arranged like fit/mammography),
  -- so it's the one code genuinely required for this patient that a
  -- null-sex or male patient never has to supply. psa/prostate_ultrasound
  -- stay excluded by sex; abdominal_ultrasound (sex='all') is required too,
  -- supplied up front below alongside everything else so breast_imaging is
  -- the sole thing missing for check11/check12 to isolate.
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, status, total_kobo, origin, investigation_tier)
  values (v_org, v_female, v_comp_bundle, 'ordered', 0, 'patient_initiated', 1)
  returning id into v_order5;

  insert into public.screening_results (organisation_id, patient_id, lab_order_id, screen_type_code, result_status)
  values
    (v_org, v_female, v_order5, 'hba1c', 'normal'),
    (v_org, v_female, v_order5, 'lipid_panel', 'normal'),
    (v_org, v_female, v_order5, 'fbc', 'normal'),
    (v_org, v_female, v_order5, 'lft', 'normal'),
    (v_org, v_female, v_order5, 'kft', 'normal'),
    (v_org, v_female, v_order5, 'tft', 'normal'),
    (v_org, v_female, v_order5, 'urinalysis', 'normal'),
    (v_org, v_female, v_order5, 'hiv', 'normal'),
    (v_org, v_female, v_order5, 'hep_b', 'normal'),
    (v_org, v_female, v_order5, 'hep_c', 'normal'),
    (v_org, v_female, v_order5, 'urine_acr', 'normal'),
    (v_org, v_female, v_order5, 'ogtt_fpg', 'normal'),
    (v_org, v_female, v_order5, 'ecg_resting', 'normal'),
    (v_org, v_female, v_order5, 'fit', 'normal'),
    (v_org, v_female, v_order5, 'syphilis', 'normal'),
    (v_org, v_female, v_order5, 'blood_group', 'normal'),
    (v_org, v_female, v_order5, 'sickle_cell_genotype', 'normal'),
    (v_org, v_female, v_order5, 'abdominal_ultrasound', 'normal');

  insert into test_results select 'check11_female_missing_breast_imaging_stays_unresolved',
    (select status = 'ordered' from public.lab_orders where id = v_order5);

  insert into public.screening_results (organisation_id, patient_id, lab_order_id, screen_type_code, result_status)
  values (v_org, v_female, v_order5, 'breast_imaging', 'normal');

  insert into test_results select 'check12_female_resolves_once_breast_imaging_entered',
    (select status = 'resulted' from public.lab_orders where id = v_order5);
end $$;

select * from test_results order by case_name;

-- All 12 rows above should read passed = true. Zero residue below the
-- rollback: no lab_orders/screening_results/annual_health_checks/
-- video_consultations/patient_shared_decisions row from this test survives.
rollback;
