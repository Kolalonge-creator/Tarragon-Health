-- ===========================================================================
-- Verification: the 2026-09-10 B2C revenue reset
--
-- Proves the four rules that carry real money or real clinical risk, each in
-- BOTH directions. Asserting only that something is refused proves nothing when
-- the mechanism is refusing everyone — which is exactly how this platform once
-- shipped a doctor-escalation gate that resolved false for every patient while
-- its tests stayed green.
--
--   1. Tarragon does not bill for a laboratory test. A partner-billed order for
--      a guidance_only bundle is refused, and the FREE self-arranged request for
--      the same bundle still works. The second half matters more than the first:
--      setting self_bookable = false would have "stopped the selling" by
--      breaking the free request that is now the entire product.
--
--   2. Continuous Monitoring OPENS the escalation gate, an expired one closes
--      it again, and a patient holding neither is refused.
--
--   3. Supervision is supervision. A weight-management enrolment against a
--      medication Tarragon prescribed (source = 'clinician') is refused; the
--      same enrolment against the patient's own medication is accepted.
--
--   4. A crisis-flagged wellbeing screen raises an emergency_events row from
--      the DATABASE, not from application code — so a third writer, or a failed
--      insert in either of the two existing ones, cannot lose it.
--
-- Run via `supabase db query --linked -f this_file.sql`, `psql $DATABASE_URL -f
-- this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK: a verification script, never seed data. It always
-- leaves the database exactly as it found it, and it builds every fixture it
-- needs rather than borrowing a row the live project happens to hold -- a proof
-- that borrows passes there and fails on a fresh reset.
-- ===========================================================================

begin;

do $$
declare
  v_org      uuid;
  v_patient  uuid := gen_random_uuid();
  v_bundle   uuid;
  v_product  uuid;
  v_med      uuid;
  v_refused  boolean;
  v_ok       boolean;
  v_after    boolean;
  v_expired  boolean;
begin
  -- Fixtures are built here rather than borrowed, per packages/db/tests/ci.manifest:
  -- a proof that depends on a row the live project happens to hold passes there
  -- and fails on a fresh reset, which is the opposite of useful. Only the
  -- organisation is borrowed, exactly as
  -- doctor_time_entitlement_grantable_by_purchasable_product.sql does.
  select organisation_id into v_org
    from public.profiles where role = 'patient' and organisation_id is not null limit 1;
  if v_org is null then
    select id into v_org from public.organisations limit 1;
  end if;
  if v_org is null then
    raise exception 'no organisation exists — cannot run this proof';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'b2c-reset@example.invalid', 'x', now(), '{}', '{}');
  -- auth.users' new-user trigger creates the profiles row already; upsert.
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'B2C Reset Probe')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id,
        role = excluded.role,
        full_name = excluded.full_name;

  -- ----------------------------------------------------------------------
  -- 1. Tarragon does not bill for a test, but the free request still works
  -- ----------------------------------------------------------------------
  select id into v_bundle
    from public.panel_bundles
   where guidance_only and is_active and self_bookable
   limit 1;
  if v_bundle is null then
    raise exception 'FAIL(1): no active, self_bookable, guidance_only bundle exists. Either the catalogue migration did not run, or self_bookable was wrongly turned off.';
  end if;

  v_refused := false;
  begin
    insert into public.lab_orders
      (organisation_id, patient_id, panel_bundle_id, fulfilment, status, origin, total_kobo)
    values (v_org, v_patient, v_bundle, 'partner', 'pending_payment', 'patient_initiated', 100);
  exception when others then
    if sqlerrm like '%does not bill for this test%' then
      v_refused := true;
    else
      raise exception 'FAIL(1): partner billing was refused, but for the wrong reason: %', sqlerrm;
    end if;
  end;
  if not v_refused then
    raise exception 'FAIL(1): Tarragon accepted a partner-billed order for a guidance_only bundle.';
  end if;

  -- The half that would have been silently broken by turning self_bookable off.
  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, fulfilment, status, origin, total_kobo)
  values (v_org, v_patient, v_bundle, 'self_arranged', 'ordered', 'patient_initiated', 0);
  raise notice 'PASS(1): partner billing refused; the free self-arranged request still works';

  -- ----------------------------------------------------------------------
  -- 2. The escalation gate opens, and closes again
  -- ----------------------------------------------------------------------
  if private.patient_has_feature_access(v_patient, 'vitals_red_flag_doctor_escalation') then
    raise exception 'FAIL(2): a brand-new patient with no purchase already has escalation.';
  end if;

  select id into v_product from public.service_products where code = 'continuous_monitoring_12m';
  if v_product is null then
    raise exception 'FAIL(2): continuous_monitoring_12m does not exist.';
  end if;

  insert into public.service_purchases
    (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, purchased_at, expires_at)
  values (v_org, v_patient, v_product, 'active', 1800000, 'NGN', now(), now() + interval '365 days');

  v_after := private.patient_has_feature_access(v_patient, 'vitals_red_flag_doctor_escalation');
  if not v_after then
    raise exception 'FAIL(2): active Continuous Monitoring did NOT open the escalation gate. The gate is dead.';
  end if;

  update public.service_purchases
     set expires_at = now() - interval '1 day'
   where patient_id = v_patient and service_product_id = v_product;

  v_expired := private.patient_has_feature_access(v_patient, 'vitals_red_flag_doctor_escalation');
  if v_expired then
    raise exception 'FAIL(2): EXPIRED cover still opens the escalation gate.';
  end if;
  raise notice 'PASS(2): escalation gate closed, opens with active cover, closes once expired';

  -- ----------------------------------------------------------------------
  -- 3. Supervision only, enforced rather than asserted in copy
  -- ----------------------------------------------------------------------
  insert into public.medications (organisation_id, patient_id, drug_name, source, is_active)
  values (v_org, v_patient, 'ZZ probe: Tarragon-prescribed', 'clinician', true)
  returning id into v_med;

  v_refused := false;
  begin
    insert into public.weight_management_enrolments
      (organisation_id, patient_id, medication_id, term_days, status)
    values (v_org, v_patient, v_med, 90, 'pending_eligibility');
  exception when others then
    if sqlerrm like '%patient obtained themselves%' then
      v_refused := true;
    else
      raise exception 'FAIL(3): refused for the wrong reason: %', sqlerrm;
    end if;
  end;
  if not v_refused then
    raise exception 'FAIL(3): a Tarragon-prescribed medication was accepted for supervision.';
  end if;

  -- And the legitimate case is accepted, or the rule is just a wall.
  insert into public.medications
    (organisation_id, patient_id, drug_name, source, prescriber_name, is_active)
  values (v_org, v_patient, 'ZZ probe: patient-supplied', 'patient', 'Dr External', true)
  returning id into v_med;

  insert into public.weight_management_enrolments
    (organisation_id, patient_id, medication_id, term_days, status)
  values (v_org, v_patient, v_med, 90, 'pending_eligibility');
  raise notice 'PASS(3): supervision refuses a Tarragon-prescribed medicine and accepts the patient''s own';

  -- ----------------------------------------------------------------------
  -- 4. The crisis route is in the database
  -- ----------------------------------------------------------------------
  insert into public.mental_health_screens
    (organisation_id, patient_id, instrument, total_score, severity_band, crisis_flagged, item_responses)
  values (v_org, v_patient, 'phq9', 18, 'moderately_severe', true, '{"items":[2,2,2,2,2,2,2,2,2]}'::jsonb);

  select exists (
    select 1 from public.emergency_events
     where patient_id = v_patient and source = 'mental_health_screen' and status = 'active'
  ) into v_ok;
  if not v_ok then
    raise exception 'FAIL(4): a crisis-flagged screen raised no emergency event from the trigger.';
  end if;

  -- And a NON-crisis screen must not raise one, or the check is vacuous.
  delete from public.emergency_events
   where patient_id = v_patient and source = 'mental_health_screen';

  insert into public.mental_health_screens
    (organisation_id, patient_id, instrument, total_score, severity_band, crisis_flagged, item_responses)
  values (v_org, v_patient, 'gad7', 4, 'minimal', false, '{"items":[1,0,1,0,1,0,1]}'::jsonb);

  select exists (
    select 1 from public.emergency_events
     where patient_id = v_patient and source = 'mental_health_screen' and status = 'active'
  ) into v_ok;
  if v_ok then
    raise exception 'FAIL(4): a NON-crisis screen raised an emergency event. The trigger is not discriminating.';
  end if;
  raise notice 'PASS(4): a crisis screen raises an emergency event; a non-crisis screen does not';

  raise notice 'ALL PASS: B2C revenue reset invariants hold';
end $$;

rollback;
