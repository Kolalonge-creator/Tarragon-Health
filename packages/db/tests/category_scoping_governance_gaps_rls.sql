-- ===========================================================================
-- Verification: the three governance follow-ups after
-- 20260830_resolve_category_scoping_governance_gaps.sql --
--   1. patient_timeline gets a per-row event_category instead of a flat
--      medical_history gate.
--   2. care_vouchers requires reproductive_health specifically when the
--      voucher is linked to a reproductive-health panel_bundle.
--   3. A dependent-account manager (guardian of a child with no login) can
--      read reproductive_health_profiles again, while a next-of-kin/eldercare
--      grant between two adults still cannot without an explicit category.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — leaves the database exactly as it found it.
-- Simulated-session pattern per packages/db/tests/scoped_access_roles_rls.sql.
-- ===========================================================================

begin;

create temporary table gov_result(check_name text, observed text, expected text, verdict text) on commit drop;

do $$
declare
  v_org                uuid;
  v_patient             uuid;
  v_dependent           uuid := gen_random_uuid();
  v_meds_grantee        uuid := gen_random_uuid();
  v_messaging_grantee   uuid := gen_random_uuid();
  v_dependent_manager   uuid := gen_random_uuid();
  v_adult_manager       uuid := gen_random_uuid();
  v_repro_bundle_id     uuid;
  v_plain_bundle_id     uuid;
  v_repro_voucher_id    uuid;
  v_plain_voucher_id    uuid;
  v_medical_history_grantee uuid := gen_random_uuid();
  v_thread_id           uuid;
  v_count               bigint;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;

  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  select id into v_patient
  from public.profiles where role = 'patient' and organisation_id = v_org limit 1;

  insert into auth.users (id, email) values
    (v_dependent, 'govtest.dependent@example.com'),
    (v_meds_grantee, 'govtest.meds.grantee@example.com'),
    (v_messaging_grantee, 'govtest.messaging.grantee@example.com'),
    (v_dependent_manager, 'govtest.dependent.manager@example.com'),
    (v_adult_manager, 'govtest.adult.manager@example.com'),
    (v_medical_history_grantee, 'govtest.medhist.grantee@example.com');

  insert into public.profiles (id, organisation_id, role, full_name, is_dependent_account)
  values (v_dependent, v_org, 'patient', 'Gov Test Dependent', true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, is_dependent_account = true;

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_meds_grantee, v_org, 'patient', 'Gov Test Meds Grantee'),
    (v_messaging_grantee, v_org, 'patient', 'Gov Test Messaging Grantee'),
    (v_dependent_manager, v_org, 'patient', 'Gov Test Dependent Manager'),
    (v_adult_manager, v_org, 'patient', 'Gov Test Adult Manager'),
    (v_medical_history_grantee, v_org, 'patient', 'Gov Test MedHist Grantee')
  on conflict (id) do update set organisation_id = excluded.organisation_id;

  -- === 1. patient_timeline per-row category ===
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_patient, v_meds_grantee, 'view', v_patient);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_patient, v_messaging_grantee, 'view', v_patient);

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_care_access_categories(
    (select id from public.profile_access where profile_id = v_patient and grantee_user_id = v_meds_grantee),
    array['medications']::public.care_access_category[]);
  perform public.set_care_access_categories(
    (select id from public.profile_access where profile_id = v_patient and grantee_user_id = v_messaging_grantee),
    array['messaging']::public.care_access_category[]);
  reset role;

  insert into public.patient_timeline (organisation_id, patient_id, event_type, occurred_at, source_table, title)
  values (v_org, v_patient, 'medication_started', now(), 'medications', 'Gov test medication started');
  insert into public.patient_timeline (organisation_id, patient_id, event_type, occurred_at, source_table, title)
  values (v_org, v_patient, 'message_posted', now(), 'care_messages', 'Gov test message posted');

  -- event_category was correctly server-derived.
  select count(*) into v_count from public.patient_timeline
    where patient_id = v_patient and event_type = 'medication_started' and event_category = 'medications';
  insert into gov_result values ('medication_started auto-categorised as medications', v_count::text, '>= 1', case when v_count >= 1 then 'PASS' else 'FAIL' end);

  select count(*) into v_count from public.patient_timeline
    where patient_id = v_patient and event_type = 'message_posted' and event_category = 'messaging';
  insert into gov_result values ('message_posted auto-categorised as messaging', v_count::text, '>= 1', case when v_count >= 1 then 'PASS' else 'FAIL' end);

  -- Medications-only grantee sees the medication event but not the message event.
  perform set_config('request.jwt.claims', json_build_object('sub', v_meds_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.patient_timeline where patient_id = v_patient and event_type = 'medication_started';
  reset role;
  insert into gov_result values ('medications-only grantee sees medication_started', v_count::text, '>= 1', case when v_count >= 1 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_meds_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.patient_timeline where patient_id = v_patient and event_type = 'message_posted';
  reset role;
  insert into gov_result values ('medications-only grantee blocked from message_posted', v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);

  -- Messaging-only grantee: the reverse.
  perform set_config('request.jwt.claims', json_build_object('sub', v_messaging_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.patient_timeline where patient_id = v_patient and event_type = 'message_posted';
  reset role;
  insert into gov_result values ('messaging-only grantee sees message_posted', v_count::text, '>= 1', case when v_count >= 1 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_messaging_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.patient_timeline where patient_id = v_patient and event_type = 'medication_started';
  reset role;
  insert into gov_result values ('messaging-only grantee blocked from medication_started', v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);

  -- === 2. care_vouchers reproductive-health panel classification ===
  insert into public.panel_bundles (code, name, price_kobo, test_codes)
  values ('GOVTEST-REPRO', 'Gov Test Repro Panel', 1000000, array['cervical_smear'])
  returning id into v_repro_bundle_id;
  insert into public.panel_bundles (code, name, price_kobo, test_codes)
  values ('GOVTEST-PLAIN', 'Gov Test Plain Panel', 1000000, array['lab_completed'])
  returning id into v_plain_bundle_id;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_patient, v_medical_history_grantee, 'view', v_patient);
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_care_access_categories(
    (select id from public.profile_access where profile_id = v_patient and grantee_user_id = v_medical_history_grantee),
    array['medical_history']::public.care_access_category[]);
  reset role;

  insert into public.care_vouchers (organisation_id, beneficiary_profile_id, purchaser_profile_id, panel_bundle_id, sku_code, sku_name, kind, face_value_kobo, amount_paid_kobo, voucher_number, status)
  values (v_org, v_patient, v_patient, v_repro_bundle_id, 'GOVTEST-REPRO', 'Gov Test Repro Panel', 'prepaid_service', 1000000, 1000000, 'GOVTEST-VR-1', 'active')
  returning id into v_repro_voucher_id;
  insert into public.care_vouchers (organisation_id, beneficiary_profile_id, purchaser_profile_id, panel_bundle_id, sku_code, sku_name, kind, face_value_kobo, amount_paid_kobo, voucher_number, status)
  values (v_org, v_patient, v_patient, v_plain_bundle_id, 'GOVTEST-PLAIN', 'Gov Test Plain Panel', 'prepaid_service', 1000000, 1000000, 'GOVTEST-VR-2', 'active')
  returning id into v_plain_voucher_id;

  -- medical_history-only grantee: sees the plain voucher, NOT the reproductive-health one.
  perform set_config('request.jwt.claims', json_build_object('sub', v_medical_history_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.care_vouchers where id = v_plain_voucher_id;
  reset role;
  insert into gov_result values ('medical_history grantee reads plain-panel voucher', v_count::text, '1', case when v_count = 1 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_medical_history_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.care_vouchers where id = v_repro_voucher_id;
  reset role;
  insert into gov_result values ('medical_history grantee blocked from repro-panel voucher', v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);

  -- Granting reproductive_health specifically unlocks it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_care_access_categories(
    (select id from public.profile_access where profile_id = v_patient and grantee_user_id = v_medical_history_grantee),
    array['medical_history', 'reproductive_health']::public.care_access_category[]);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_medical_history_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.care_vouchers where id = v_repro_voucher_id;
  reset role;
  insert into gov_result values ('reproductive_health grant unlocks repro-panel voucher', v_count::text, '1', case when v_count = 1 then 'PASS' else 'FAIL' end);

  -- === 3. Dependent-account manager regains reproductive_health; adult-to-adult stays excluded ===
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_dependent, v_dependent_manager, 'manage', v_dependent_manager);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_patient, v_adult_manager, 'manage', v_patient);

  insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage)
  values (v_org, v_dependent, 'menstruating')
  on conflict (patient_id) do update set life_stage = excluded.life_stage;

  perform set_config('request.jwt.claims', json_build_object('sub', v_dependent_manager::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.reproductive_health_profiles where patient_id = v_dependent;
  reset role;
  insert into gov_result values ('dependent-account manager reads reproductive_health with no explicit grant', v_count::text, '1', case when v_count = 1 then 'PASS' else 'FAIL' end);

  -- Control: an adult-to-adult manage grant (not a dependent account) still gets nothing
  -- without an explicit reproductive_health category grant.
  perform set_config('request.jwt.claims', json_build_object('sub', v_adult_manager::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.reproductive_health_profiles where patient_id = v_patient;
  reset role;
  insert into gov_result values ('adult-to-adult manage grantee still blocked from reproductive_health', v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);

  if exists (select 1 from gov_result where verdict = 'FAIL') then
    raise exception 'one or more checks failed — see gov_result';
  end if;
end $$;

select * from gov_result order by check_name;

rollback;
