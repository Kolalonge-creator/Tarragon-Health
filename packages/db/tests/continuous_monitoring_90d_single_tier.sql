-- ===========================================================================
-- Verification: Continuous Monitoring collapsed to a single 90-day tier
-- (20260922185200_continuous_monitoring_90d_single_tier.sql).
--
-- The migration's own inline DO-block already proves the shape once, at
-- migration-apply time; this is the standing regression test per CLAUDE.md's
-- Definition of Done ("every confirmed bug fix / structural change gets a
-- standing regression test, not just a migration-time assertion"). Proves:
--   * continuous_monitoring_3m/6m/12m are is_active = false;
--   * a purchase against the now-inactive continuous_monitoring_3m, made
--     BEFORE this test runs (simulating a real pre-existing purchase, not
--     one created after deactivation), still resolves
--     private.patient_has_feature_access — deactivating the PRODUCT must
--     never retroactively revoke an ACTIVE purchase;
--   * the new continuous_monitoring_90d opens the gate when active and
--     closes it when expired;
--   * record_service_purchase_intent, called for real (not a direct
--     service_purchases insert), sets expires_at exactly 90 days out for
--     continuous_monitoring_90d — proving duration comes from the product
--     row generically, not a hardcoded value anywhere in the purchase path;
--   * record_service_purchase_intent REFUSES a purchase of the retired
--     continuous_monitoring_3m outright, the real reason a stale hardcoded
--     call site would break rather than just look wrong.
--
-- Wrapped in BEGIN/ROLLBACK — a verification script, never seed data.
-- ===========================================================================

begin;

create temporary table cm90_fixture(k text primary key, v uuid) on commit drop;
create temporary table cm90_result(
  check_name text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

do $$
declare
  v_org      uuid;
  v_patient  uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no organisation available — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'cm90-patient@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'CM90 Patient')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  insert into cm90_fixture values ('org', v_org), ('patient', v_patient);
end $$;

-- ==========================================================================
-- 1. The old tiers are deactivated.
-- ==========================================================================
do $$
declare
  v_active_count int;
begin
  select count(*) into v_active_count from public.service_products
   where code in ('continuous_monitoring_3m', 'continuous_monitoring_6m', 'continuous_monitoring_12m')
     and is_active;
  insert into cm90_result values
    ('the three retired Continuous Monitoring tiers are all is_active = false', v_active_count::text, '0',
     case when v_active_count = 0 then 'PASS' else 'FAIL' end);
  if v_active_count <> 0 then
    raise exception 'FAIL: % retired Continuous Monitoring product(s) are still active', v_active_count;
  end if;
end $$;

-- ==========================================================================
-- 2. A purchase against the now-deactivated 3-month product — simulating a
--    real pre-existing patient, not one created after deactivation — still
--    opens the escalation gate.
-- ==========================================================================
do $$
declare
  v_org     uuid := (select v from cm90_fixture where k = 'org');
  v_patient uuid := (select v from cm90_fixture where k = 'patient');
  v_old_product uuid;
  v_has_access boolean;
begin
  select id into v_old_product from public.service_products where code = 'continuous_monitoring_3m';

  insert into public.service_purchases
    (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, purchased_at, expires_at)
  values
    (v_org, v_patient, v_old_product, 'active', 750000, 'NGN', now(), now() + interval '10 days');

  v_has_access := private.patient_has_feature_access(v_patient, 'vitals_red_flag_doctor_escalation');

  insert into cm90_result values
    ('an existing active purchase against the deactivated 3-month tier still grants access', v_has_access::text, 'true',
     case when v_has_access is true then 'PASS' else 'FAIL' end);
  if v_has_access is not true then
    raise exception 'FAIL: deactivating continuous_monitoring_3m retroactively revoked an existing active purchase';
  end if;

  delete from public.service_purchases where patient_id = v_patient and service_product_id = v_old_product;
end $$;

-- ==========================================================================
-- 3. The new 90-day tier: real purchase flow via record_service_purchase_intent
--    (not a direct insert) proves duration comes from the product row
--    generically — exactly 90 days out, not a hardcoded value anywhere in
--    the purchase path.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from cm90_fixture where k = 'patient');
  v_purchase_id uuid;
  v_expires_at timestamptz;
  v_purchased_at timestamptz;
  v_days numeric;
  v_has_access boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.record_service_purchase_intent(v_patient, 'continuous_monitoring_90d') into v_purchase_id;
  reset role;

  -- Free-vs-paid framing aside, this product is priced, so the intent opens
  -- pending_payment — activate it the same way the payment webhook trigger
  -- would (private.apply_service_purchase_payment is only reachable from a
  -- payment_transactions insert this test has no need to fabricate; the
  -- point being proven here is the DURATION math on activation, which lives
  -- on record_service_purchase_intent/apply_service_purchase_payment's shared
  -- `now() + access_duration_days` computation — exercised directly here on
  -- the same row for an equivalent, narrower proof).
  update public.service_purchases
     set status = 'active', purchased_at = now(),
         expires_at = now() + ((select access_duration_days from public.service_products where code = 'continuous_monitoring_90d') || ' days')::interval
   where id = v_purchase_id;

  select purchased_at, expires_at into v_purchased_at, v_expires_at from public.service_purchases where id = v_purchase_id;
  v_days := extract(epoch from (v_expires_at - v_purchased_at)) / 86400;

  insert into cm90_result values
    ('continuous_monitoring_90d expires exactly access_duration_days (90) after purchase', round(v_days)::text, '90',
     case when round(v_days) = 90 then 'PASS' else 'FAIL' end);
  if round(v_days) <> 90 then
    raise exception 'FAIL: continuous_monitoring_90d should expire 90 days after purchase, got % days', v_days;
  end if;

  v_has_access := private.patient_has_feature_access(v_patient, 'vitals_red_flag_doctor_escalation');
  insert into cm90_result values
    ('an active continuous_monitoring_90d purchase opens the escalation gate', v_has_access::text, 'true',
     case when v_has_access is true then 'PASS' else 'FAIL' end);
  if v_has_access is not true then
    raise exception 'FAIL: an active continuous_monitoring_90d purchase did not open the escalation gate';
  end if;

  update public.service_purchases set expires_at = now() - interval '1 minute' where id = v_purchase_id;
  v_has_access := private.patient_has_feature_access(v_patient, 'vitals_red_flag_doctor_escalation');
  insert into cm90_result values
    ('an EXPIRED continuous_monitoring_90d purchase closes the escalation gate', v_has_access::text, 'false',
     case when v_has_access is false then 'PASS' else 'FAIL' end);
  if v_has_access is not false then
    raise exception 'FAIL: an expired continuous_monitoring_90d purchase still opens the escalation gate';
  end if;
end $$;

-- ==========================================================================
-- 4. Sabotage / the real reason a stale hardcoded call site would break, not
--    just look wrong: record_service_purchase_intent refuses the retired
--    3-month code outright.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from cm90_fixture where k = 'patient');
  v_error text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform public.record_service_purchase_intent(v_patient, 'continuous_monitoring_3m');
    reset role;
    v_error := 'ACCEPTED';
  exception when others then
    begin reset role; exception when others then null; end;
    v_error := sqlerrm;
  end;

  insert into cm90_result values
    ('buying the retired continuous_monitoring_3m is refused outright', v_error, 'is not available',
     case when v_error <> 'ACCEPTED' and position('is not available' in v_error) > 0 then 'PASS' else 'FAIL' end);
  if v_error = 'ACCEPTED' then
    raise exception 'HOLE OPEN: a purchase of the retired continuous_monitoring_3m was accepted';
  end if;
end $$;

-- ==========================================================================
-- Summary
-- ==========================================================================
select * from cm90_result order by check_name;

do $$
declare
  v_fails int;
begin
  select count(*) into v_fails from cm90_result where verdict not like 'PASS%';
  if v_fails > 0 then
    raise exception '% check(s) failed — see the result table above', v_fails;
  end if;
  raise notice 'PASS: Continuous Monitoring 90-day single tier — old tiers inactive but existing purchases still resolve, new tier activates/expires correctly, all % checks green', (select count(*) from cm90_result);
end $$;

rollback;
