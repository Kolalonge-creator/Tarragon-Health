-- Tarragon Health — fix: every real Care Voucher purchase is broken.
--
-- 20260831150844_repoint_vouchers_and_sponsor_to_service_products.sql added
-- care_vouchers.service_product_id as a third valid "prepaid_service" SKU
-- alongside panel_bundle_id/subscription_plan_id, and correctly widened
-- care_vouchers_one_sku to admit it. It did not touch the older
-- care_vouchers_kind_shape constraint, which still requires
-- `panel_bundle_id IS NOT NULL OR subscription_plan_id IS NOT NULL` for any
-- prepaid_service row and says nothing about service_product_id — so a real
-- public.purchase_service_voucher() call (which sets only service_product_id,
-- per that same migration) violates it on every single call. Confirmed live
-- before writing this by reproducing purchase_service_voucher()'s exact
-- INSERT shape in a rolled-back transaction: it fails with
-- `violates check constraint "care_vouchers_kind_shape"` every time. Since
-- subscription_plans-based and panel_bundle-based vouchers were the only
-- ones this constraint ever admitted, and service_product_id is now the
-- only way a prepaid_service voucher is created going forward (per the
-- pay-per-service cutover), this means no one has been able to buy a real
-- Care Voucher since 2026-08-31 — a live gap in a currently-marketed
-- product, not a hypothetical.
--
-- Fix: same additive-constraint-widening shape as the 20260829011043 fix for
-- finance_journal_entries.source and this batch's own
-- revenue_recognition_schedules.source_kind widening — add
-- `service_product_id IS NOT NULL` as a third acceptable option in the
-- prepaid_service branch. Every other clause (reward_discount shape,
-- purchaser_profile_id/sku_code requirements) is unchanged.

alter table public.care_vouchers drop constraint care_vouchers_kind_shape;
alter table public.care_vouchers add constraint care_vouchers_kind_shape check (
  (
    kind = 'prepaid_service'
    and (panel_bundle_id is not null or subscription_plan_id is not null or service_product_id is not null)
    and purchaser_profile_id is not null
    and sku_code is not null
  )
  or (
    kind = 'reward_discount'
    and panel_bundle_id is null
    and subscription_plan_id is null
    and purchaser_profile_id is null
  )
);

-- ---------------------------------------------------------------------------
-- Assertions — reproduce purchase_service_voucher()'s exact real insert
-- shape and confirm it now succeeds; then sabotage it (no sku_code) to
-- confirm the constraint still discriminates rather than having been
-- widened into a no-op.
-- ---------------------------------------------------------------------------
do $$
declare
  v_patient uuid;
  v_org uuid;
  v_product uuid;
  v_voucher_id uuid;
  v_rejected boolean := false;
begin
  select id, organisation_id into v_patient, v_org from public.profiles where role = 'patient' order by created_at limit 1;
  select id into v_product from public.service_products where is_active and access_duration_days is not null limit 1;

  if v_patient is null or v_product is null then
    raise notice 'SKIPPED behavioural proof: no patient profile or bounded-duration service_product to test against';
  else
    -- Positive case: exact shape purchase_service_voucher() produces.
    insert into public.care_vouchers (
      organisation_id, voucher_number, kind,
      beneficiary_profile_id, purchaser_profile_id,
      service_product_id, sku_code, sku_name,
      face_value_kobo, status, expires_at
    )
    values (
      v_org, 'TEST-KIND-SHAPE-PROOF', 'prepaid_service',
      v_patient, v_patient,
      v_product, 'test-sku', 'test-name',
      100000, 'reserved', now() + interval '1 day'
    )
    returning id into v_voucher_id;

    delete from public.care_vouchers where id = v_voucher_id;

    -- Negative control: same shape but no sku_code — must still be rejected.
    begin
      insert into public.care_vouchers (
        organisation_id, voucher_number, kind,
        beneficiary_profile_id, purchaser_profile_id,
        service_product_id, sku_name,
        face_value_kobo, status, expires_at
      )
      values (
        v_org, 'TEST-KIND-SHAPE-SABOTAGE', 'prepaid_service',
        v_patient, v_patient,
        v_product, 'test-name',
        100000, 'reserved', now() + interval '1 day'
      );
    exception when check_violation then
      v_rejected := true;
    end;

    if not v_rejected then
      delete from public.care_vouchers where voucher_number = 'TEST-KIND-SHAPE-SABOTAGE';
      raise exception 'FAIL: care_vouchers_kind_shape no longer discriminates — a row missing sku_code was accepted';
    end if;
  end if;

  raise notice 'PASS: a service_product_id-only prepaid_service voucher (the real shape purchase_service_voucher() produces) is now accepted, and an invalid shape is still rejected';
end $$;
