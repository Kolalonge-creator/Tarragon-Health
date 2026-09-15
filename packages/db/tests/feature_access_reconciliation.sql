-- Tarragon Health — verification for
-- 20260831190512_reconcile_feature_access_with_programme_purchases.sql
--
-- This session's platform-wide pay-per-service rewrite
-- (20260831141943_rewire_feature_access_to_service_purchases.sql) landed on
-- top of the prior day's "episodic-fee rebuild"
-- (20260830014719_entitlement_gates_use_programme_purchases.sql +
-- 20260830015233_entitlement_allowlist_missed_features.sql) without either
-- session knowing about the other. Because both rewrote
-- private.patient_has_feature_access in place, the later CREATE OR REPLACE
-- silently DROPPED the earlier one's programme_purchases-based grant for
-- vitals_red_flag_doctor_escalation, lifestyle_coaching, quarterly_report,
-- ai_coach, clinician_review, doctor_checkin, async_doctor_visit, and
-- health_education — a patient with only an active programme_purchases row
-- (a paid 12-week chronic-care programme) would have silently lost all
-- eight, including the single highest-priority safety gate on the platform.
-- Zero real patients were ever affected (programme_purchases had 0 rows at
-- the time this was caught).
--
-- Proves the reconciled function grants the shared feature set from EITHER
-- purchase system independently — a service_purchases-only patient keeps
-- access, a programme_purchases-only patient has (or regains) access
-- including the 12-week-programme track flag chronic_doctor_supported_track,
-- and a patient with neither has none of it.
--
-- Rolled back. Fixtures resolved at runtime, per this repo's test
-- convention. Also sidesteps a real, separate wrinkle found while writing
-- this: every chronic_condition_programmes row currently has price_kobo =
-- null (no programme is actually purchasable yet, a founder-pricing gap
-- unrelated to this bug), so a real INSERT into programme_purchases would
-- fail closed via private.set_programme_purchase_computed_price — this test
-- temporarily prices one programme for the duration of the rolled-back
-- transaction rather than depending on real catalogue pricing existing.
begin;

do $$
declare
  v_org               uuid;
  v_svc_patient       uuid := gen_random_uuid();
  v_prog_patient      uuid := gen_random_uuid();
  v_neither_patient   uuid := gen_random_uuid();
  v_complete_pack_id  uuid;
  v_programme_id      uuid;
begin
  select organisation_id into v_org
  from public.profiles where role = 'patient' and organisation_id is not null limit 1;
  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  select id into v_complete_pack_id from public.service_products where code = 'complete_pack' limit 1;
  if v_complete_pack_id is null then
    raise exception 'no complete_pack service_products row found — cannot run this test';
  end if;

  select id into v_programme_id from public.chronic_condition_programmes where code = 'hypertension';
  if v_programme_id is null then
    raise exception 'no hypertension chronic_condition_programmes row found — cannot run this test';
  end if;

  -- Unpriced in the live catalogue today (a founder-pricing gap, not this
  -- bug) — price it for the duration of this rolled-back transaction only.
  update public.chronic_condition_programmes
    set price_kobo = 1500000, default_duration_weeks = coalesce(default_duration_weeks, 12)
    where id = v_programme_id;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_svc_patient, 'far-svc@example.invalid', 'x', now(), '{}', '{}'),
    (v_prog_patient, 'far-prog@example.invalid', 'x', now(), '{}', '{}'),
    (v_neither_patient, 'far-neither@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_svc_patient, v_org, 'patient', 'FAR Test Service Patient'),
    (v_prog_patient, v_org, 'patient', 'FAR Test Programme Patient'),
    (v_neither_patient, v_org, 'patient', 'FAR Test Neither Patient')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency, purchased_at, expires_at)
  values (v_org, v_svc_patient, v_svc_patient, v_complete_pack_id, 'active', 2000000, 'NGN', now(), now() + interval '30 days');

  insert into public.programme_purchases (patient_id, programme_id, payment_provider)
  values (v_prog_patient, v_programme_id, 'paystack');
  update public.programme_purchases
    set status = 'active', purchased_at = now(), starts_at = current_date, ends_at = current_date + 84
    where patient_id = v_prog_patient;

  ---------------------------------------------------------------- 1. service_purchases-only patient keeps every shared feature
  if not private.patient_has_feature_access(v_svc_patient, 'vitals_red_flag_doctor_escalation') then
    raise exception 'FAIL 1: service_purchases-only (complete_pack) patient lost vitals_red_flag_doctor_escalation';
  end if;
  if not private.patient_has_feature_access(v_svc_patient, 'ai_coach') then
    raise exception 'FAIL 1: service_purchases-only (complete_pack) patient lost ai_coach';
  end if;

  ---------------------------------------------------------------- 2. programme_purchases-only patient has the full shared set, including the 12-week track flag
  if not private.patient_has_feature_access(v_prog_patient, 'vitals_red_flag_doctor_escalation') then
    raise exception 'FAIL 2: programme_purchases-only patient does not have vitals_red_flag_doctor_escalation — the regression this migration fixes';
  end if;
  if not private.patient_has_feature_access(v_prog_patient, 'lifestyle_coaching') then
    raise exception 'FAIL 2: programme_purchases-only patient does not have lifestyle_coaching';
  end if;
  if not private.patient_has_feature_access(v_prog_patient, 'quarterly_report') then
    raise exception 'FAIL 2: programme_purchases-only patient does not have quarterly_report';
  end if;
  if not private.patient_has_feature_access(v_prog_patient, 'ai_coach') then
    raise exception 'FAIL 2: programme_purchases-only patient does not have ai_coach';
  end if;
  if not private.patient_has_feature_access(v_prog_patient, 'clinician_review') then
    raise exception 'FAIL 2: programme_purchases-only patient does not have clinician_review';
  end if;
  if not private.patient_has_feature_access(v_prog_patient, 'doctor_checkin') then
    raise exception 'FAIL 2: programme_purchases-only patient does not have doctor_checkin';
  end if;
  if not private.patient_has_feature_access(v_prog_patient, 'async_doctor_visit') then
    raise exception 'FAIL 2: programme_purchases-only patient does not have async_doctor_visit';
  end if;
  if not private.patient_has_feature_access(v_prog_patient, 'health_education') then
    raise exception 'FAIL 2: programme_purchases-only patient does not have health_education';
  end if;
  if not private.patient_has_feature_access(v_prog_patient, 'chronic_doctor_supported_track') then
    raise exception 'FAIL 2: programme_purchases-only patient does not have chronic_doctor_supported_track — the 12-week programme would silently place them on self_monitoring despite already paying for doctor check-ins';
  end if;

  -- A feature that is neither in the shared allow-list nor in any
  -- service_products.features array must still resolve false — the
  -- reconciliation must not have widened access to everything.
  if private.patient_has_feature_access(v_prog_patient, 'priority_escalation') then
    raise exception 'FAIL 2: programme_purchases-only patient unexpectedly has priority_escalation, which is service_products-only and not in the shared allow-list';
  end if;

  ---------------------------------------------------------------- 3. a patient with neither purchase type has none of it
  if private.patient_has_feature_access(v_neither_patient, 'vitals_red_flag_doctor_escalation') then
    raise exception 'FAIL 3: patient with neither purchase type has vitals_red_flag_doctor_escalation';
  end if;
  if private.patient_has_feature_access(v_neither_patient, 'chronic_doctor_supported_track') then
    raise exception 'FAIL 3: patient with neither purchase type has chronic_doctor_supported_track';
  end if;

  ---------------------------------------------------------------- 4. public.has_feature_access (auth.uid()-based) delegates identically
  perform set_config('request.jwt.claims', json_build_object('sub', v_prog_patient, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  if not public.has_feature_access('vitals_red_flag_doctor_escalation') then
    raise exception 'FAIL 4: public.has_feature_access does not agree with private.patient_has_feature_access for the programme_purchases-only patient';
  end if;
  perform set_config('role', 'postgres', true);

  raise notice 'PASS: private.patient_has_feature_access grants the shared feature set from EITHER purchase system independently, denies a feature that belongs to neither, and public.has_feature_access delegates identically — the platform-wide/episodic-fee entitlement conflict is closed';
end $$;

rollback;
