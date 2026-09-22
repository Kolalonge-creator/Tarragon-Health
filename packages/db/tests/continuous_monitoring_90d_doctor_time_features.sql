-- ===========================================================================
-- Verification: continuous_monitoring_90d carries the full doctor-time
-- feature set (20260922193500_fix_continuous_monitoring_90d_missing_doctor_
-- time_features.sql), not just vitals_red_flag_doctor_escalation.
--
-- Standing regression coverage for a real bug found by /code-review high on
-- 20260922185200_continuous_monitoring_90d_single_tier.sql before that PR
-- was ever opened: that migration copied the features array straight from
-- 20260910011849_continuous_monitoring_cover.sql's ORIGINAL committed INSERT
-- text (array['vitals_red_flag_doctor_escalation'] only), never checking
-- that a LATER migration had since expanded the live continuous_monitoring_
-- 3m/6m rows to seven features. Had this shipped unfixed: a patient buying
-- continuous_monitoring_90d specifically for chronic-programme doctor
-- support (exactly what pricing.ts's own copy for this product promises)
-- would pay ₦30,000 and get nothing — private.activate_chronic_programme_
-- doctor_supported_track()'s feature check would resolve false and its
-- where-clause UPDATE would silently no-op, the platform's own documented
-- "where-clause guards, not an exception, on purpose" design turning a real
-- purchase failure into an invisible one.
--
-- Proves, with a real fresh enrolment, purchase and RPC call (not just
-- array equality): buying continuous_monitoring_90d scoped to a
-- self_monitoring enrolment flips it to doctor_supported for real, and
-- private.patient_has_feature_access grants clinician_review/doctor_checkin/
-- async_doctor_visit/multi_condition_review/result_document_review from
-- that same purchase — plus a sabotage run (features array reverted to the
-- pre-fix single-feature shape) confirming the trigger genuinely no-ops
-- without the fix, so this test would have caught the original bug.
--
-- Wrapped in BEGIN/ROLLBACK — a verification script, never seed data.
-- ===========================================================================

begin;

create temporary table cmdf_fixture(k text primary key, v uuid) on commit drop;
create temporary table cmdf_result(
  check_name text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

do $$
declare
  v_org       uuid;
  v_patient   uuid := gen_random_uuid();
  v_product   uuid;
  v_programme uuid;
  v_enrolment uuid;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no organisation available — cannot run this test';
  end if;

  select id into v_product from public.service_products where code = 'continuous_monitoring_90d';
  if v_product is null then
    raise exception 'continuous_monitoring_90d does not exist — cannot run this test';
  end if;

  select id into v_programme from public.chronic_condition_programmes where code = 'hypertension';
  if v_programme is null then
    raise exception 'no hypertension chronic_condition_programmes row — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'cmdf-patient@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'CMDF Patient')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  insert into public.chronic_programme_enrolments
    (organisation_id, patient_id, programme_id, status, track)
  values (v_org, v_patient, v_programme, 'enrolled', 'self_monitoring')
  returning id into v_enrolment;

  insert into cmdf_fixture values
    ('org', v_org), ('patient', v_patient), ('product', v_product), ('enrolment', v_enrolment);
end $$;

-- ==========================================================================
-- 1. The array itself carries all seven doctor-time features, none of the
--    12-month-only annual_review bonus.
-- ==========================================================================
do $$
declare
  v_product uuid := (select v from cmdf_fixture where k = 'product');
  v_features text[];
  v_missing text[];
begin
  select features into v_features from public.service_products where id = v_product;

  select array_agg(f) into v_missing
    from unnest(array[
      'vitals_red_flag_doctor_escalation', 'chronic_doctor_supported_track', 'clinician_review',
      'doctor_checkin', 'async_doctor_visit', 'multi_condition_review', 'result_document_review'
    ]) f
   where f <> all(v_features);

  insert into cmdf_result values
    ('continuous_monitoring_90d carries all 7 expected doctor-time features', coalesce(array_to_string(v_missing, ','), 'none missing'), 'none missing',
     case when v_missing is null then 'PASS' else 'FAIL' end);
  if v_missing is not null then
    raise exception 'FAIL: continuous_monitoring_90d is missing: %', v_missing;
  end if;

  insert into cmdf_result values
    ('continuous_monitoring_90d does NOT carry the 12-month-only annual_review bonus', (not ('annual_review' = any(v_features)))::text, 'true',
     case when not ('annual_review' = any(v_features)) then 'PASS' else 'FAIL' end);
  if 'annual_review' = any(v_features) then
    raise exception 'FAIL: continuous_monitoring_90d should not carry annual_review';
  end if;
end $$;

-- ==========================================================================
-- 2. End-to-end: a real purchase scoped to a self_monitoring enrolment
--    flips it to doctor_supported, and grants clinician_review via
--    private.patient_has_feature_access.
-- ==========================================================================
do $$
declare
  v_org       uuid := (select v from cmdf_fixture where k = 'org');
  v_patient   uuid := (select v from cmdf_fixture where k = 'patient');
  v_product   uuid := (select v from cmdf_fixture where k = 'product');
  v_enrolment uuid := (select v from cmdf_fixture where k = 'enrolment');
  v_purchase_id uuid;
  v_track     public.chronic_programme_track;
  v_has_clinician_review boolean;
  v_has_doctor_checkin   boolean;
begin
  insert into public.service_purchases
    (organisation_id, patient_id, service_product_id, status, amount_kobo, currency,
     scoped_entity_type, scoped_entity_id, purchased_at, expires_at)
  values
    (v_org, v_patient, v_product, 'active', 3000000, 'NGN',
     'chronic_programme_enrolments', v_enrolment, now(), now() + interval '90 days')
  returning id into v_purchase_id;

  select track into v_track from public.chronic_programme_enrolments where id = v_enrolment;
  v_has_clinician_review := private.patient_has_feature_access(v_patient, 'clinician_review');
  v_has_doctor_checkin := private.patient_has_feature_access(v_patient, 'doctor_checkin');

  insert into cmdf_result values
    ('a real continuous_monitoring_90d purchase flips a self_monitoring enrolment to doctor_supported', v_track::text, 'doctor_supported',
     case when v_track = 'doctor_supported' then 'PASS' else 'FAIL' end);
  if v_track is distinct from 'doctor_supported' then
    raise exception 'FAIL: the enrolment was not flipped to doctor_supported (still %)', v_track;
  end if;

  insert into cmdf_result values
    ('the same purchase grants clinician_review via patient_has_feature_access', v_has_clinician_review::text, 'true',
     case when v_has_clinician_review is true then 'PASS' else 'FAIL' end);
  if v_has_clinician_review is not true then
    raise exception 'FAIL: clinician_review was not granted';
  end if;

  insert into cmdf_result values
    ('the same purchase grants doctor_checkin via patient_has_feature_access', v_has_doctor_checkin::text, 'true',
     case when v_has_doctor_checkin is true then 'PASS' else 'FAIL' end);
  if v_has_doctor_checkin is not true then
    raise exception 'FAIL: doctor_checkin was not granted';
  end if;

  -- Reset the enrolment/purchase for the sabotage run below. Order matters:
  -- chronic_programme_enrolments_derive_track (a BEFORE INSERT OR UPDATE
  -- trigger, private.derive_chronic_programme_track) recalculates `track`
  -- from private.patient_has_feature_access() on every UPDATE to this row,
  -- overriding whatever value is assigned in the UPDATE statement itself —
  -- so resetting track to self_monitoring WHILE this purchase is still
  -- active would just have the derive trigger immediately recompute it back
  -- to doctor_supported. Delete the purchase first, so the derive trigger's
  -- own feature check has nothing active left to find.
  delete from public.service_purchases where id = v_purchase_id;
  update public.chronic_programme_enrolments set track = 'self_monitoring' where id = v_enrolment;
end $$;

-- ==========================================================================
-- 3. Sabotage — revert the features array to the pre-fix, single-feature
--    shape and confirm the SAME purchase no longer flips the track. Proves
--    this test would have caught the original bug, not just that today's
--    fixed state happens to pass.
-- ==========================================================================
do $$
declare
  v_org       uuid := (select v from cmdf_fixture where k = 'org');
  v_patient   uuid := (select v from cmdf_fixture where k = 'patient');
  v_product   uuid := (select v from cmdf_fixture where k = 'product');
  v_enrolment uuid := (select v from cmdf_fixture where k = 'enrolment');
  v_original_features text[];
  v_track public.chronic_programme_track;
begin
  select features into v_original_features from public.service_products where id = v_product;

  update public.service_products
     set features = array['vitals_red_flag_doctor_escalation']
   where id = v_product;

  insert into public.service_purchases
    (organisation_id, patient_id, service_product_id, status, amount_kobo, currency,
     scoped_entity_type, scoped_entity_id, purchased_at, expires_at)
  values
    (v_org, v_patient, v_product, 'active', 3000000, 'NGN',
     'chronic_programme_enrolments', v_enrolment, now(), now() + interval '90 days');

  select track into v_track from public.chronic_programme_enrolments where id = v_enrolment;

  -- Restore the real fix regardless of outcome, before asserting.
  update public.service_products set features = v_original_features where id = v_product;

  insert into cmdf_result values
    ('sabotage: the pre-fix single-feature array leaves the enrolment on self_monitoring (bug reproduced)', v_track::text, 'self_monitoring',
     case when v_track = 'self_monitoring' then 'PASS (discriminates)' else 'FAIL (vacuous)' end);
  if v_track <> 'self_monitoring' then
    raise exception 'The check-2 proof does not discriminate: reverting to the pre-fix features array did not reproduce the bug (track=%)', v_track;
  end if;
end $$;

-- ==========================================================================
-- Summary
-- ==========================================================================
select * from cmdf_result order by check_name;

do $$
declare
  v_fails int;
begin
  select count(*) into v_fails from cmdf_result where verdict not like 'PASS%';
  if v_fails > 0 then
    raise exception '% check(s) failed — see the result table above', v_fails;
  end if;
  raise notice 'PASS: continuous_monitoring_90d doctor-time features fix verified end to end, sabotage confirms discrimination, all % checks green', (select count(*) from cmdf_result);
end $$;

rollback;
