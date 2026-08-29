-- Nigerian Nutrition Intelligence — RLS verification.
--
-- Three things to prove:
--   1. nigerian_foods / nigerian_food_portions: a global reference catalogue
--      readable by any authenticated session, writable only by an admin
--      (same shape as condition_protocols).
--   2. nutrition_referrals: a patient can self-request nutrition support and
--      see their own request, but never another patient's; only org staff
--      can change a referral's status.
--   3. nutrition_meal_plans: a patient can insert/read their own generated
--      7-day plan, org staff can view it, and nobody sees another patient's.
--
-- Every negative is paired with a positive control so a blocked-everything
-- policy can't score full marks.
--
-- Run: npx supabase db query --linked -f packages/db/tests/nigerian_nutrition_intelligence_rls.sql
-- (or paste into execute_sql / the SQL editor — already wrapped in
-- begin/rollback below, nothing here is ever committed.)

begin;

do $$
declare
  v_org           uuid;
  v_admin         uuid;
  v_patient_a     uuid := gen_random_uuid();
  v_patient_b     uuid := gen_random_uuid();
  v_staff_profile uuid := gen_random_uuid();
  v_food_id       uuid;
  v_referral_id   uuid;
  v_meal_plan_id  uuid;
  v_count         integer;
  v_status        public.nutrition_referral_status;
  v_failed        boolean;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  if v_org is null or v_admin is null then
    raise exception 'SETUP: need at least one organisation and one admin profile to run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient_a, 'nutrition-rls-test-patient-a@example.invalid', 'x', now(), '{}', '{}'),
    (v_patient_b, 'nutrition-rls-test-patient-b@example.invalid', 'x', now(), '{}', '{}'),
    (v_staff_profile, 'nutrition-rls-test-staff@example.invalid', 'x', now(), '{}', '{}');

  -- handle_new_user already created the profiles rows on the auth.users
  -- insert above; just set what this fixture needs.
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Nutrition RLS Test Patient A'
    where id = v_patient_a;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Nutrition RLS Test Patient B'
    where id = v_patient_b;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Nutrition RLS Test Staff'
    where id = v_staff_profile;

  -- ======================================================================
  -- 1) nigerian_foods / nigerian_food_portions: read-all, admin-only write
  -- ======================================================================

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1a. NEGATIVE: an ordinary patient cannot add to the food catalogue.
  v_failed := false;
  begin
    insert into public.nigerian_foods
      (code, name, category, calories_kcal_100g, carbs_g_100g, protein_g_100g, fat_g_100g, fibre_g_100g, sodium_mg_100g)
    values ('rls_test_food', 'RLS Test Food', 'staple', 100, 10, 1, 1, 1, 1);
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 1a: a patient session inserted a nigerian_foods row';
  end if;
  raise notice 'PASS 1a: only an admin can add to the food catalogue';

  -- 1b. POSITIVE: any authenticated session can read the seeded catalogue,
  -- across every category.
  select count(*) into v_count from public.nigerian_foods;
  if v_count < 40 then
    raise exception 'FAIL 1b: a patient session could not read the seeded food catalogue (found %)', v_count;
  end if;
  select count(distinct category) into v_count from public.nigerian_foods;
  if v_count < 6 then
    raise exception 'FAIL 1b: not all 6 food categories are visible to a patient session';
  end if;
  raise notice 'PASS 1b: the full food catalogue is readable by any authenticated session';

  -- 1c. POSITIVE: portion rows are readable too.
  select count(*) into v_count from public.nigerian_food_portions;
  if v_count = 0 then
    raise exception 'FAIL 1c: a patient session could not read any portion rows';
  end if;
  raise notice 'PASS 1c: portion rows are readable by any authenticated session';

  reset role;

  -- 1d. POSITIVE CONTROL: an admin session can add to the catalogue (food +
  -- a portion for it), proving 1a failed because of role, not something else.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.nigerian_foods
    (code, name, category, calories_kcal_100g, carbs_g_100g, protein_g_100g, fat_g_100g, fibre_g_100g, sodium_mg_100g)
  values ('rls_test_food', 'RLS Test Food', 'staple', 100, 10, 1, 1, 1, 1)
  returning id into v_food_id;
  if v_food_id is null then
    raise exception 'FAIL 1d: an admin session could not add to the food catalogue';
  end if;

  insert into public.nigerian_food_portions (food_id, unit, grams, is_default)
  values (v_food_id, 'serving', 100, true);
  select count(*) into v_count from public.nigerian_food_portions where food_id = v_food_id;
  if v_count <> 1 then
    raise exception 'FAIL 1d: an admin session could not add a portion row';
  end if;
  raise notice 'PASS 1d: an admin session can extend the food catalogue and its portions';

  reset role;
  delete from public.nigerian_foods where id = v_food_id; -- cascades the portion row

  -- ======================================================================
  -- 2) nutrition_referrals: patient self-request, org-staff managed
  -- ======================================================================

  -- 2a. POSITIVE: a patient can request nutrition support for themselves.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.nutrition_referrals (organisation_id, patient_id, reason)
  values (v_org, v_patient_a, 'Patient requested nutrition support.')
  returning id into v_referral_id;
  if v_referral_id is null then
    raise exception 'FAIL 2a: a patient could not self-request nutrition support';
  end if;
  raise notice 'PASS 2a: a patient can request nutrition support for themselves';

  -- 2b. NEGATIVE: a patient cannot request it on someone else's behalf.
  v_failed := false;
  begin
    insert into public.nutrition_referrals (organisation_id, patient_id, reason)
    values (v_org, v_patient_b, 'Forged request');
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 2b: a patient created a nutrition referral for a different patient';
  end if;
  raise notice 'PASS 2b: a patient cannot request nutrition support for someone else';

  reset role;

  -- 2c. NEGATIVE: a different patient cannot see patient A's referral.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.nutrition_referrals where id = v_referral_id;
  if v_count <> 0 then
    raise exception 'FAIL 2c: patient B could see patient A''s nutrition referral';
  end if;
  raise notice 'PASS 2c: a patient cannot see another patient''s nutrition referral';

  reset role;

  -- 2d. NEGATIVE: a patient cannot change their own referral's status —
  -- staff-only, per requestNutritionReferralAction never auto-progressing a
  -- referral past 'requested' on the patient's own say-so. The UPDATE is not
  -- refused outright (no matching row under the patient's own update
  -- policy), it silently affects zero rows — same "no delete policy"
  -- discipline as patient_blood_profile's own test.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.nutrition_referrals set status = 'plan_issued' where id = v_referral_id;
  select status into v_status from public.nutrition_referrals where id = v_referral_id;
  if v_status <> 'requested' then
    raise exception 'FAIL 2d: a patient session changed their own referral status';
  end if;
  raise notice 'PASS 2d: a patient cannot change their referral''s status (staff-only)';

  reset role;

  -- 2e. POSITIVE: org staff can see and progress the referral.
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.nutrition_referrals where id = v_referral_id;
  if v_count <> 1 then
    raise exception 'FAIL 2e: org staff could not see the patient''s nutrition referral';
  end if;

  update public.nutrition_referrals set status = 'scheduled' where id = v_referral_id;
  select status into v_status from public.nutrition_referrals where id = v_referral_id;
  if v_status <> 'scheduled' then
    raise exception 'FAIL 2e: org staff could not update the referral status';
  end if;
  raise notice 'PASS 2e: org staff can view and update a patient''s nutrition referral';

  reset role;

  -- ======================================================================
  -- 3) nutrition_meal_plans: patient owns/reads own generated plans,
  --    org staff can view, nobody can see another patient's plan.
  -- ======================================================================

  -- 3a. POSITIVE: a patient can insert their own generated plan.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.nutrition_meal_plans (organisation_id, patient_id, plan, ai_status)
  values (v_org, v_patient_a, '{"days":[],"summary":"test","notes":null,"droppedItems":[]}'::jsonb, 'generated')
  returning id into v_meal_plan_id;
  if v_meal_plan_id is null then
    raise exception 'FAIL 3a: a patient could not insert their own generated meal plan';
  end if;
  raise notice 'PASS 3a: a patient can insert their own generated meal plan';

  -- 3b. NEGATIVE: a patient cannot insert a plan for someone else.
  v_failed := false;
  begin
    insert into public.nutrition_meal_plans (organisation_id, patient_id, plan, ai_status)
    values (v_org, v_patient_b, '{}'::jsonb, 'generated');
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 3b: a patient inserted a meal plan for a different patient';
  end if;
  raise notice 'PASS 3b: a patient cannot insert a meal plan for someone else';

  reset role;

  -- 3c. NEGATIVE: a different patient cannot see patient A's meal plan.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.nutrition_meal_plans where id = v_meal_plan_id;
  if v_count <> 0 then
    raise exception 'FAIL 3c: patient B could see patient A''s meal plan';
  end if;
  raise notice 'PASS 3c: a patient cannot see another patient''s meal plan';

  reset role;

  -- 3d. POSITIVE: org staff can see the patient's meal plan.
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.nutrition_meal_plans where id = v_meal_plan_id;
  if v_count <> 1 then
    raise exception 'FAIL 3d: org staff could not see the patient''s meal plan';
  end if;
  raise notice 'PASS 3d: org staff can view a patient''s meal plan';

  reset role;
  raise notice 'ALL NIGERIAN NUTRITION INTELLIGENCE RLS CHECKS PASSED';
end $$;

rollback;
