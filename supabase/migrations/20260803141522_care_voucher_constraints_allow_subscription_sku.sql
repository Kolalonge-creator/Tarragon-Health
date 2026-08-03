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

do $$
begin
  -- A reward voucher must still be unable to carry a purchaser or a SKU.
  begin
    insert into public.care_vouchers
      (organisation_id, voucher_number, kind, beneficiary_profile_id,
       purchaser_profile_id, face_value_kobo, status)
    select o.id, 'TAR-VCH-CHECK', 'reward_discount', p.id, p.id, 100, 'active'
      from public.organisations o
      join public.profiles p on p.organisation_id = o.id and p.role='patient'
     limit 1;
    raise exception 'a reward voucher was allowed to carry a purchaser';
  exception when check_violation then null;
  end;

  -- A redeemed voucher pointing at nothing must still be refused.
  begin
    insert into public.care_vouchers
      (organisation_id, voucher_number, kind, beneficiary_profile_id,
       purchaser_profile_id, sku_code, panel_bundle_id,
       face_value_kobo, amount_paid_kobo, status, redeemed_at)
    select o.id, 'TAR-VCH-CHECK2', 'prepaid_service', p.id, p.id, 'x', b.id,
           100, 100, 'redeemed', now()
      from public.organisations o
      join public.profiles p on p.organisation_id = o.id and p.role='patient'
      join public.panel_bundles b on true
     limit 1;
    raise exception 'a redeemed voucher pointing at nothing was allowed';
  exception when check_violation then null;
  end;
end $$;
