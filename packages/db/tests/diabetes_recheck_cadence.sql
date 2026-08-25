-- Diabetes blood-sugar recheck cadence (20260821175716).
--
-- The founder's decision, as clinical director, on 2026-08-21: HbA1c twice a
-- year when stable and up to four times a year when not — INCLUDING the
-- annual check-up in both counts. So 6 months at target, 3 months above it,
-- and an annual review's own HbA1c line has to reset the clock exactly like a
-- standalone recheck, or the patient ends up with an annual review in
-- September and a "due" reminder in October.
--
-- Run inside a single transaction and ROLLED BACK. Every negative is paired
-- with a positive control, and the two cadence assertions are deliberately
-- written so that a system which had simply kept the old flat 12-month
-- screen_types.frequency_months would FAIL them rather than pass quietly.
--
-- To re-run:
--   npx supabase db query --linked -f packages/db/tests/diabetes_recheck_cadence.sql

begin;

create temporary table test_results (case_name text, passed boolean, detail text) on commit drop;

do $$
declare
  v_patient uuid := 'bb707ae8-1d0b-49c2-b990-1950de601db4';
  v_org     uuid := '00000000-0000-0000-0000-000000000001';
  v_hba1c   uuid;
  v_state   public.chronic_control_state;
  v_interval int;
  v_due     date;
  v_staff   uuid;
begin
  select id into v_hba1c from public.screen_types where code = 'hba1c';
  select id into v_staff from public.clinical_staff limit 1;

  -- Clean slate for this patient inside the transaction.
  delete from public.screening_schedules where patient_id = v_patient and screen_type_id = v_hba1c;
  delete from public.lab_analyte_readings where patient_id = v_patient and code = 'hba1c';
  delete from public.screening_results where patient_id = v_patient and screen_type_code = 'hba1c';
  delete from public.patient_glucose_targets where patient_id = v_patient;
  delete from public.care_plans where patient_id = v_patient and condition = 'diabetes';

  -- -----------------------------------------------------------------------
  -- 0. Control: a patient who is NOT on the diabetes pathway has no pathway
  --    control state and no pathway interval — the general-population
  --    12-month HbA1c cadence still governs them. Without this, every
  --    assertion below could be passing because the function returns the
  --    same thing for everybody.
  -- -----------------------------------------------------------------------
  insert into test_results select 'd0_control_non_diabetic_has_no_pathway_state',
    private.patient_chronic_control_state(v_patient, 'diabetes') is null
    and private.patient_screen_interval_months(v_patient, 'hba1c') is null,
    null;

  insert into test_results select 'd0b_control_general_population_cadence_is_annual',
    (select frequency_months = 12 from public.screen_types where code = 'hba1c'),
    null;

  -- Enrol them.
  insert into public.care_plans (organisation_id, patient_id, condition, status)
  values (v_org, v_patient, 'diabetes', 'active');

  -- -----------------------------------------------------------------------
  -- 1. Newly diagnosed, no HbA1c on file: not_yet_established, tight
  --    interval. Never silently treated as stable.
  -- -----------------------------------------------------------------------
  v_state := private.patient_chronic_control_state(v_patient, 'diabetes');
  insert into test_results select 'd1_new_patient_is_not_assumed_stable',
    v_state = 'not_yet_established', v_state::text;

  insert into test_results select 'd1b_and_is_rechecked_at_three_months',
    private.patient_screen_interval_months(v_patient, 'hba1c') = 3,
    private.patient_screen_interval_months(v_patient, 'hba1c')::text;

  -- -----------------------------------------------------------------------
  -- 2. At target -> 6 months -> twice a year.
  -- -----------------------------------------------------------------------
  insert into public.patient_glucose_targets
    (organisation_id, patient_id, category, hba1c_target_percent)
  values (v_org, v_patient, 'standard', 7.0);

  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at)
  values (v_org, v_patient, 'hba1c', 6.4, '%', now() - interval '2 days');

  v_state := private.patient_chronic_control_state(v_patient, 'diabetes');
  v_interval := private.patient_screen_interval_months(v_patient, 'hba1c');

  insert into test_results select 'd2_at_target_is_twice_a_year',
    v_state = 'at_target' and v_interval = 6 and 12 / v_interval = 2,
    v_state::text || ' / every ' || v_interval || ' months';

  -- -----------------------------------------------------------------------
  -- 3. Above target -> 3 months -> four times a year. Same patient, same
  --    target, one different number.
  -- -----------------------------------------------------------------------
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at)
  values (v_org, v_patient, 'hba1c', 8.9, '%', now() - interval '1 day');

  v_state := private.patient_chronic_control_state(v_patient, 'diabetes');
  v_interval := private.patient_screen_interval_months(v_patient, 'hba1c');

  insert into test_results select 'd3_above_target_is_four_times_a_year',
    v_state = 'above_target' and v_interval = 3 and 12 / v_interval = 4,
    v_state::text || ' / every ' || v_interval || ' months';

  -- -----------------------------------------------------------------------
  -- 4. The individualised target is what decides it, not a global number.
  --    8.9 is above the standard 7.0 target but at a relaxed 9.0 one, and
  --    the same reading must classify differently for the two patients.
  -- -----------------------------------------------------------------------
  update public.patient_glucose_targets
     set category = 'relaxed', hba1c_target_percent = 9.0
   where patient_id = v_patient;

  insert into test_results select 'd4_individualised_target_decides_not_a_global_one',
    private.patient_chronic_control_state(v_patient, 'diabetes') = 'at_target',
    private.patient_chronic_control_state(v_patient, 'diabetes')::text;

  update public.patient_glucose_targets
     set category = 'standard', hba1c_target_percent = 7.0
   where patient_id = v_patient;

  -- -----------------------------------------------------------------------
  -- 5. A doctor can override, and cannot do it anonymously.
  -- -----------------------------------------------------------------------
  begin
    update public.patient_glucose_targets
       set control_state_override = 'at_target'
     where patient_id = v_patient;
    insert into test_results select 'd5_override_requires_attribution', false,
      'an unattributed override was accepted';
  exception when check_violation then
    insert into test_results select 'd5_override_requires_attribution', true, null;
  end;

  update public.patient_glucose_targets
     set control_state_override        = 'at_target',
         control_state_override_by     = v_staff,
         control_state_override_at     = now(),
         control_state_override_reason = 'Frail, recent hypo — accepting a looser recheck interval.'
   where patient_id = v_patient;

  insert into test_results select 'd5b_control_attributed_override_is_accepted_and_wins',
    private.patient_chronic_control_state(v_patient, 'diabetes') = 'at_target'
    and private.patient_screen_interval_months(v_patient, 'hba1c') = 6,
    'reading is still 8.9, override says at_target';

  update public.patient_glucose_targets
     set control_state_override = null, control_state_override_by = null,
         control_state_override_at = null, control_state_override_reason = null
   where patient_id = v_patient;

  -- -----------------------------------------------------------------------
  -- 6. THE POINT OF THE WHOLE MIGRATION: the annual review counts as one of
  --    the occurrences. Bring the patient back to target, then record an
  --    HbA1c the way an annual review records one, and check the calendar
  --    schedules the next one 6 months out — not 12 (the old general-
  --    population interval) and not "as well as" anything.
  -- -----------------------------------------------------------------------
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at)
  values (v_org, v_patient, 'hba1c', 6.2, '%', now());

  delete from public.screening_schedules where patient_id = v_patient and screen_type_id = v_hba1c;

  insert into public.screening_results (organisation_id, patient_id, screen_type_code, result_status)
  values (v_org, v_patient, 'hba1c', 'normal');

  select due_date into v_due
    from public.screening_schedules
   where patient_id = v_patient and screen_type_id = v_hba1c and status = 'pending'
   order by created_at desc limit 1;

  insert into test_results select 'd6_annual_review_result_rolls_the_recheck_six_months',
    v_due = (current_date + interval '6 months')::date,
    coalesce(v_due::text, 'no schedule created');

  insert into test_results select 'd6b_and_not_the_old_twelve_month_interval',
    v_due is distinct from (current_date + interval '12 months')::date,
    null;

  insert into test_results select 'd6c_exactly_one_open_recheck_not_two',
    (select count(*) from public.screening_schedules
      where patient_id = v_patient and screen_type_id = v_hba1c
        and status in ('pending', 'booked', 'overdue')) = 1,
    (select count(*)::text from public.screening_schedules
      where patient_id = v_patient and screen_type_id = v_hba1c
        and status in ('pending', 'booked', 'overdue'));

  -- -----------------------------------------------------------------------
  -- 7. The billing side of the same decision: a stable diabetic's HbA1c done
  --    four months ago now counts as covered by the pathway, so it is not
  --    re-collected or re-billed inside a Screen order. Under the old
  --    3-month medication-review window it would have been.
  -- -----------------------------------------------------------------------
  delete from public.screening_results where patient_id = v_patient and screen_type_code = 'hba1c';
  insert into public.screening_results (organisation_id, patient_id, screen_type_code, result_status, created_at)
  values (v_org, v_patient, 'hba1c', 'normal', now() - interval '4 months');

  insert into test_results select 'd7_recent_hba1c_is_covered_by_the_pathway',
    exists (
      select 1 from jsonb_array_elements(
        private.compute_screening_order_exclusions(v_patient, v_org, array['hba1c'])) e
      where e ->> 'item_code' = 'hba1c' and e ->> 'reason' = 'owned_by_pathway:diabetes'),
    private.compute_screening_order_exclusions(v_patient, v_org, array['hba1c'])::text;

  -- Positive control: push the same result back beyond the 6-month cadence
  -- and it must become due again. Without this, d7 would pass just as
  -- happily against a function that excludes hba1c unconditionally.
  update public.screening_results set created_at = now() - interval '8 months'
   where patient_id = v_patient and screen_type_code = 'hba1c';

  insert into test_results select 'd7_control_older_hba1c_is_due_again',
    not exists (
      select 1 from jsonb_array_elements(
        private.compute_screening_order_exclusions(v_patient, v_org, array['hba1c'])) e
      where e ->> 'item_code' = 'hba1c'),
    null;
end $$;

select case_name, passed, detail from test_results order by case_name;

select count(*) filter (where not passed) as failures, count(*) as total from test_results;

rollback;
