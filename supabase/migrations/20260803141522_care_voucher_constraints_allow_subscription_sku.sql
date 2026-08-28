-- Two constraints written when every prepaid voucher was a lab bundle.
-- Relaxed to admit a subscription SKU, keeping exactly what each was actually
-- protecting.
--
-- care_vouchers_kind_shape demanded panel_bundle_id on every prepaid voucher.
-- What it is really protecting is: a prepaid voucher names a purchaser, a SKU
-- code, and a thing being bought. WHICH thing is now a choice of two, and
-- care_vouchers_one_sku (20260803141409) already enforces exactly one, so this
-- only needs to require that at least one is present rather than naming the
-- bundle specifically.
--
-- care_vouchers_redeemed_has_order demanded redeemed_order_id on redemption.
-- A subscription redemption has no order to point at, so this would have
-- blocked the final step. Relaxed to: a redeemed voucher must have a
-- redeemed_at and must point at either an order or a plan. A voucher that
-- claims to be redeemed against nothing is still refused, which is the point.

alter table public.care_vouchers drop constraint if exists care_vouchers_kind_shape;
alter table public.care_vouchers add constraint care_vouchers_kind_shape check (
  (
    kind = 'prepaid_service'
    and (panel_bundle_id is not null or subscription_plan_id is not null)
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

alter table public.care_vouchers drop constraint if exists care_vouchers_redeemed_has_order;
alter table public.care_vouchers add constraint care_vouchers_redeemed_has_order check (
  status <> 'redeemed'
  or (redeemed_at is not null and (redeemed_order_id is not null or subscription_plan_id is not null))
);

-- The assertion below needs a real patient profile to reference. A from-
-- scratch replay has none (seed.sql only inserts reference/lookup data —
-- no organisations, profiles or auth.users — and no earlier migration
-- creates one either), which previously made both checks below silently
-- insert zero rows via their `join ... limit 1` and fall straight through
-- to the "was allowed" exception, even though the constraints themselves
-- were never actually exercised. Creates and tears down its own minimal
-- patient fixture so the checks hold on every environment, not just this
-- project's already-populated live database.
do $$
declare
  v_test_user uuid := gen_random_uuid();
  v_org uuid;
  v_bundle uuid;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_test_user, 'care-voucher-constraint-check@example.invalid', 'x', now(), '{}', '{}');

  select organisation_id into v_org from public.profiles where id = v_test_user;
  if v_org is null then
    select id into v_org from public.organisations limit 1;
    update public.profiles set organisation_id = v_org where id = v_test_user;
  end if;

  -- A reward voucher must still be unable to carry a purchaser or a SKU.
  begin
    insert into public.care_vouchers
      (organisation_id, voucher_number, kind, beneficiary_profile_id,
       purchaser_profile_id, face_value_kobo, status)
    values (v_org, 'TAR-VCH-CHECK', 'reward_discount', v_test_user, v_test_user, 100, 'active');
    raise exception 'a reward voucher was allowed to carry a purchaser';
  exception when check_violation then null;
  end;

  -- A redeemed voucher pointing at nothing must still be refused.
  begin
    select id into v_bundle from public.panel_bundles limit 1;
    insert into public.care_vouchers
      (organisation_id, voucher_number, kind, beneficiary_profile_id,
       purchaser_profile_id, sku_code, panel_bundle_id,
       face_value_kobo, amount_paid_kobo, status, redeemed_at)
    values (v_org, 'TAR-VCH-CHECK2', 'prepaid_service', v_test_user, v_test_user, 'x', v_bundle,
            100, 100, 'redeemed', now());
    raise exception 'a redeemed voucher pointing at nothing was allowed';
  exception when check_violation then null;
  end;

  -- Cascades to the auto-created profiles row; nothing from this fixture
  -- persists past the migration.
  delete from auth.users where id = v_test_user;
end $$;
