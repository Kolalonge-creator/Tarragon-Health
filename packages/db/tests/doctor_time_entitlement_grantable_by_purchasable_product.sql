-- Tarragon Health — verification for
-- 20260904235834_doctor_time_features_grantable_by_the_purchasable_programme.sql
--
-- THE ASSERTION THAT WAS MISSING.
--
-- Every earlier test of private.patient_has_feature_access proved the gate is
-- CLOSED (packages/db/tests/vitals_red_flag_plan_gate.sql,
-- pulse_red_flag_engine_and_plan_gate.sql,
-- symptom_triage_assessment_engine.sql), or proved it OPENS for a fixture built
-- on a product code hardcoded in the test itself — 'complete_pack', retired and
-- is_active = false since 2026-09-02, or a hand-inserted programme_purchases row,
-- a table with 0 rows that no application code writes
-- (feature_access_reconciliation.sql). Both kinds kept passing while the gate was
-- shut for every real patient: the only ACTIVE product,
-- 'chronic_doctor_supported_pack', carried features =
-- ['chronic_doctor_supported_track'] and nothing else, so a patient who paid for
-- the 12-week doctor-supported programme resolved false for
-- 'vitals_red_flag_doctor_escalation' and a dangerous BP reading paged nobody.
--
-- This test therefore refuses to name a product code as its fixture input. It
-- resolves the product the way a paying patient does — "the active product a
-- patient can buy today that grants this feature" — and fails if there is none.
-- A future retirement that strands doctor time again breaks this test at
-- section 1, before any behaviour is exercised.
--
-- Proves, in one rolled-back transaction:
--   1. At least one product is ON SALE that grants each doctor-time feature.
--   2. OPEN direction — a patient holding an active purchase of it gets true for
--      every doctor-time feature, including 'annual_review' (which used to be in
--      neither list of the function and so returned false for the whole platform,
--      leaving private.queue_annual_reviews() scheduling nothing for anyone).
--   3. CLOSED direction — a patient holding no purchase at all gets false for
--      every one of them, and the now-free features stay free for both.
--   4. End to end — a RED-range BP reading from the entitled patient raises a
--      clinician_alerts row; the identical reading from the unentitled patient
--      raises none and gets the free-tier self-care notification instead. No
--      clinical threshold is involved: both readings are the same numbers.
--   5. public.patient_has_feature_access(uuid, text) — the RPC that replaces the
--      hand-rolled TypeScript copy in
--      apps/web/src/lib/clinical/vitals-escalation-access.ts — answers for the
--      patient themselves and REFUSES (42501) for an unrelated patient, rather
--      than returning a quiet false.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — a verification script, not seed data.

begin;

do $$
declare
  v_org        uuid;
  v_paid       uuid := gen_random_uuid();
  v_free       uuid := gen_random_uuid();
  v_other      uuid := gen_random_uuid();
  v_product    uuid;
  v_code       text;
  v_price      bigint;
  v_days       integer;
  v_k          text;
  v_alerts     integer;
  v_notifs     integer;
  v_rpc        boolean;
  v_refused    boolean := false;
  DOCTOR_TIME  text[] := array[
    'vitals_red_flag_doctor_escalation',
    'clinician_review',
    'doctor_checkin',
    'async_doctor_visit',
    'multi_condition_review',
    'result_document_review',
    'annual_review'
  ];
begin
  select organisation_id into v_org
    from public.profiles where role = 'patient' and organisation_id is not null limit 1;
  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  ------------------------------------------------------------------ 1. a purchasable vehicle exists for EVERY doctor-time feature
  foreach v_k in array DOCTOR_TIME loop
    if not exists (
      select 1 from public.service_products
       where is_active and v_k = any(features)
    ) then
      raise exception
        'FAIL 1: no product a patient can buy grants % — the entitlement is unreachable, which is exactly the 2026-09-02 defect', v_k;
    end if;
  end loop;

  -- Resolve the vehicle for the safety-critical one and use it for everything
  -- below. Deliberately picked by feature, never by a hardcoded code.
  select id, code, price_kobo, coalesce(access_duration_days, 84)
    into v_product, v_code, v_price, v_days
    from public.service_products
   where is_active and 'vitals_red_flag_doctor_escalation' = any(features)
   order by code
   limit 1;
  raise notice 'entitlement vehicle in use: % (%)', v_code, v_product;

  ------------------------------------------------------------------ fixtures
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_paid,  'dte-paid@example.invalid',  'x', now(), '{}', '{}'),
    (v_free,  'dte-free@example.invalid',  'x', now(), '{}', '{}'),
    (v_other, 'dte-other@example.invalid', 'x', now(), '{}', '{}');

  -- auth.users' new-user trigger creates the profiles row already; upsert.
  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_paid,  v_org, 'patient', 'DTE Paid Patient'),
    (v_free,  v_org, 'patient', 'DTE Free Patient'),
    (v_other, v_org, 'patient', 'DTE Other Patient')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id,
        role = excluded.role,
        full_name = excluded.full_name;

  -- The paid patient buys it exactly as the app does (service_purchases).
  -- The free patient deliberately gets no purchase row of any kind.
  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id,
     status, amount_kobo, currency, purchased_at, expires_at)
  values
    (v_org, v_paid, v_paid, v_product, 'active', v_price, 'NGN',
     now(), now() + (v_days || ' days')::interval);

  ------------------------------------------------------------------ 2. OPEN — the entitled patient
  foreach v_k in array DOCTOR_TIME loop
    if not private.patient_has_feature_access(v_paid, v_k) then
      raise exception
        'FAIL 2: a patient holding an active % purchase is denied % — the entitlement is not grantable by the product that sells it', v_code, v_k;
    end if;
  end loop;

  ------------------------------------------------------------------ 3. CLOSED — the unentitled patient
  foreach v_k in array DOCTOR_TIME loop
    if private.patient_has_feature_access(v_free, v_k) then
      raise exception 'FAIL 3: a patient with no purchase at all was granted %', v_k;
    end if;
  end loop;

  -- and the free-since-2026-09-02 features are still free for both, so this
  -- migration cannot be passing by having made everything true.
  foreach v_k in array array['health_education','lifestyle_coaching','ai_coach','quarterly_report',
                             'prevention_coordination','lab_coordination','medication_refills'] loop
    if not private.patient_has_feature_access(v_free, v_k) then
      raise exception 'FAIL 3: a now-free feature (%) is gated', v_k;
    end if;
  end loop;

  -- a key no product grants and no list contains must still be false for the
  -- paying patient — proof the gate did not simply widen to everything.
  if private.patient_has_feature_access(v_paid, 'priority_escalation') then
    raise exception 'FAIL 3: entitlement widened — priority_escalation belongs to no live product';
  end if;

  ------------------------------------------------------------------ 4. end to end: identical RED-range BP readings, opposite outcomes
  -- 178/104 is RED (private.classify_bp_level: systolic >= 160), not EMERGENCY
  -- (>= 200 / >= 120), so it exercises the clinician_alerts path rather than the
  -- plan-independent emergency_events safety net.
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic)
  values (v_org, v_paid, 'blood_pressure', 178, 104);

  select count(*) into v_alerts
    from public.clinician_alerts where patient_id = v_paid and status = 'open';
  if v_alerts = 0 then
    raise exception
      'FAIL 4: a RED-range BP reading from a patient who PAID for the doctor-supported programme raised no clinician_alerts row — nobody is paged';
  end if;

  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic)
  values (v_org, v_free, 'blood_pressure', 178, 104);

  select count(*) into v_alerts
    from public.clinician_alerts where patient_id = v_free;
  if v_alerts <> 0 then
    raise exception
      'FAIL 4: the identical reading from an unentitled patient raised % clinician_alerts row(s) — doctor time leaked to Free', v_alerts;
  end if;

  select count(*) into v_notifs
    from public.notifications where recipient_id = v_free;
  if v_notifs = 0 then
    raise exception
      'FAIL 4: the unentitled patient got neither an alert nor the free-tier self-care suggestion — the reading vanished silently';
  end if;

  ------------------------------------------------------------------ 5. the public RPC: answers for self, refuses for a stranger
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_paid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select public.patient_has_feature_access(v_paid, 'vitals_red_flag_doctor_escalation') into v_rpc;
  if not v_rpc then
    raise exception 'FAIL 5: the RPC denies the entitled patient their own entitlement';
  end if;

  begin
    perform public.patient_has_feature_access(v_other, 'vitals_red_flag_doctor_escalation');
  exception when insufficient_privilege then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'FAIL 5: the RPC answered for an unrelated patient instead of refusing';
  end if;

  perform set_config('role', 'postgres', true);

  raise notice
    'PASS: the product a patient can actually buy grants every doctor-time feature (OPEN), a patient with no purchase gets none of them (CLOSED), the same RED BP reading pages a doctor for the first and only self-care guidance for the second, and the entitlement RPC refuses rather than quietly denying';
end $$;

rollback;
