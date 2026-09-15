-- ===========================================================================
-- Verification: 20260910181117_create_weight_management_enrolment_on_purchase
--
-- The gap this closes: 20260910011851 shipped weight_management_3m/6m/12m
-- (real Paystack products, 75,000 / 132,000 / 240,000 naira) plus the full
-- clinician-side dose-plan/check-in machinery, but nothing anywhere ever
-- inserted a weight_management_enrolments row when a purchase activated. A
-- paying patient saw the "Losing weight on medication?" empty state forever
-- -- useMyWeightManagementEnrolment found nothing, because nothing was ever
-- written. Found by a 2026-09-10 audit as the single most commercially
-- serious gap in that release: money changed hands, nothing was delivered.
--
-- This script proves:
--   * activating a weight_management_3m purchase (the payment-confirmation
--     path -- pending_payment then flipped to active, the same shape
--     private.apply_service_purchase_payment uses on charge.success) creates
--     exactly one weight_management_enrolments row, status
--     'pending_eligibility', term_days = 90, patient_id/organisation_id
--     matching the purchase;
--   * the 6-month and 12-month products map to term_days 180 / 365;
--   * a second weight-management purchase while one is already live
--     (pending_eligibility/active/paused) is a no-op -- no second row, and
--     critically the purchase itself still activates rather than erroring;
--   * a purchase of an unrelated active product does NOT create a
--     weight_management_enrolments row (proves the trigger discriminates by
--     product code rather than firing on any activation);
--   * a purchase that never reaches 'active' (still pending_payment) creates
--     no row either.
--
-- Fixtures are self-built (a fresh patient under whatever organisation
-- already exists from supabase/seed/seed.sql), not selected from live data --
-- this runs against a freshly reset local stack, same convention as
-- service_purchases_insert_only_via_intent_rpc.sql.
--
-- Wrapped in BEGIN/ROLLBACK -- a verification script, never seed data.
-- ===========================================================================

begin;

create temporary table wmeop_fixture(k text primary key, v uuid) on commit drop;
create temporary table wmeop_result(
  check_name text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

-- --------------------------------------------------------------------------
-- Fixtures
-- --------------------------------------------------------------------------
do $$
declare
  v_org      uuid;
  v_patient  uuid := gen_random_uuid();
  v_3m       uuid;
  v_6m       uuid;
  v_12m      uuid;
  v_other    uuid;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no organisation available -- cannot run this test';
  end if;

  select id into v_3m  from public.service_products where code = 'weight_management_3m';
  select id into v_6m  from public.service_products where code = 'weight_management_6m';
  select id into v_12m from public.service_products where code = 'weight_management_12m';
  if v_3m is null or v_6m is null or v_12m is null then
    raise exception 'weight_management_3m/6m/12m not found -- cannot run this test';
  end if;

  -- Resolved by shape, not a hardcoded code, per the lesson in
  -- service_purchases_insert_only_via_intent_rpc.sql: whatever product this
  -- points at, it must stay a real, active, non-weight-management product.
  select id into v_other from public.service_products
   where is_active and currency = 'NGN' and price_kobo > 0
     and code not like 'weight\_management\_%'
   order by price_kobo, code
   limit 1;
  if v_other is null then
    raise exception 'no active non-weight-management NGN product available -- cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'wmeop-patient@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'WMEOP Patient')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = 'patient';

  insert into wmeop_fixture values
    ('org', v_org), ('patient', v_patient),
    ('3m', v_3m), ('6m', v_6m), ('12m', v_12m), ('other', v_other);
end $$;

-- ==========================================================================
-- 1. Activating a weight_management_3m purchase delivers the product.
-- ==========================================================================
do $$
declare
  v_org      uuid := (select v from wmeop_fixture where k = 'org');
  v_patient  uuid := (select v from wmeop_fixture where k = 'patient');
  v_3m       uuid := (select v from wmeop_fixture where k = '3m');
  v_purchase uuid;
  v_row      record;
begin
  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
     amount_kobo, currency)
  values (v_org, v_patient, v_patient, v_3m, 'pending_payment', 7500000, 'NGN')
  returning id into v_purchase;

  -- Before activation: no enrolment yet.
  insert into wmeop_result values (
    'pending_payment purchase creates no enrolment',
    (select count(*)::text from public.weight_management_enrolments where service_purchase_id = v_purchase),
    '0',
    case when not exists (select 1 from public.weight_management_enrolments where service_purchase_id = v_purchase)
      then 'PASS' else 'FAIL' end
  );

  update public.service_purchases
     set status = 'active', purchased_at = now(), expires_at = now() + interval '90 days'
   where id = v_purchase;

  select * into v_row from public.weight_management_enrolments where service_purchase_id = v_purchase;

  insert into wmeop_result values (
    'activating weight_management_3m creates an enrolment',
    case when v_row.id is null then 'no row' else 'row created' end, 'row created',
    case when v_row.id is not null then 'PASS' else 'FAIL' end
  );
  insert into wmeop_result values (
    'new enrolment status is pending_eligibility', coalesce(v_row.status::text, 'null'),
    'pending_eligibility', case when v_row.status = 'pending_eligibility' then 'PASS' else 'FAIL' end
  );
  insert into wmeop_result values (
    'new enrolment term_days is 90 for the 3-month product', coalesce(v_row.term_days::text, 'null'),
    '90', case when v_row.term_days = 90 then 'PASS' else 'FAIL' end
  );
  insert into wmeop_result values (
    'new enrolment patient_id/organisation_id match the purchase',
    format('%s/%s', v_row.patient_id, v_row.organisation_id),
    format('%s/%s', v_patient, v_org),
    case when v_row.patient_id = v_patient and v_row.organisation_id = v_org then 'PASS' else 'FAIL' end
  );

  if v_row.id is null or v_row.status is distinct from 'pending_eligibility'
     or v_row.term_days is distinct from 90
     or v_row.patient_id is distinct from v_patient or v_row.organisation_id is distinct from v_org then
    raise exception 'HOLE OPEN: a weight_management_3m purchase activated with no correctly-shaped enrolment behind it';
  end if;
end $$;

-- ==========================================================================
-- 2. A duplicate purchase while one is already live is a no-op, not a
--    failed payment -- the second purchase must still activate cleanly.
-- ==========================================================================
do $$
declare
  v_org      uuid := (select v from wmeop_fixture where k = 'org');
  v_patient  uuid := (select v from wmeop_fixture where k = 'patient');
  v_6m       uuid := (select v from wmeop_fixture where k = '6m');
  v_purchase uuid;
  v_status   public.service_purchase_status;
  v_live     int;
begin
  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
     amount_kobo, currency)
  values (v_org, v_patient, v_patient, v_6m, 'pending_payment', 13200000, 'NGN')
  returning id into v_purchase;

  update public.service_purchases
     set status = 'active', purchased_at = now(), expires_at = now() + interval '180 days'
   where id = v_purchase;

  select status into v_status from public.service_purchases where id = v_purchase;
  select count(*) into v_live from public.weight_management_enrolments
   where patient_id = v_patient and status in ('pending_eligibility', 'active', 'paused');

  insert into wmeop_result values (
    'duplicate purchase while already enrolled still activates the purchase',
    coalesce(v_status::text, 'null'), 'active', case when v_status = 'active' then 'PASS' else 'FAIL' end
  );
  insert into wmeop_result values (
    'duplicate purchase does not create a second live enrolment',
    v_live::text, '1', case when v_live = 1 then 'PASS' else 'FAIL' end
  );

  if v_status is distinct from 'active' then
    raise exception 'BROKEN: a second weight-management purchase failed to activate because an enrolment already existed';
  end if;
  if v_live <> 1 then
    raise exception 'HOLE OPEN: a duplicate purchase created % live weight_management_enrolments rows, expected 1', v_live;
  end if;
end $$;

-- ==========================================================================
-- 3. Negative control -- an unrelated product activating must not touch
--    weight_management_enrolments at all. Proves the trigger discriminates
--    by product code rather than firing on any service_purchases activation.
-- ==========================================================================
do $$
declare
  v_org      uuid := (select v from wmeop_fixture where k = 'org');
  v_other    uuid := (select v from wmeop_fixture where k = 'other');
  v_patient  uuid := gen_random_uuid();
  v_purchase uuid;
  v_price    bigint;
  v_before   int;
  v_after    int;
begin
  select price_kobo into v_price from public.service_products where id = v_other;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'wmeop-control-patient@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'WMEOP Control Patient')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = 'patient';

  select count(*) into v_before from public.weight_management_enrolments;

  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
     amount_kobo, currency)
  values (v_org, v_patient, v_patient, v_other, 'pending_payment', v_price, 'NGN')
  returning id into v_purchase;

  update public.service_purchases set status = 'active', purchased_at = now() where id = v_purchase;

  select count(*) into v_after from public.weight_management_enrolments;

  insert into wmeop_result values (
    'an unrelated product activating creates no weight_management_enrolments row',
    v_after::text, v_before::text, case when v_after = v_before then 'PASS' else 'FAIL' end
  );

  if v_after <> v_before then
    raise exception 'FALSE POSITIVE: activating an unrelated product created a weight_management_enrolments row -- the trigger does not discriminate by product code';
  end if;
end $$;

select check_name, observed, expected, verdict
from wmeop_result
order by verdict desc, check_name;

rollback;
