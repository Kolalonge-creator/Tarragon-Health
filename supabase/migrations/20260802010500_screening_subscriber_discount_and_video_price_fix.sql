-- 15% subscriber discount on Screen-tier purchases, and a real bug fix: the
-- live video-visit platform default was ₦5,000, not the ₦10,000 the founder
-- confirmed 2026-07-31 — the correction either never landed or was
-- overwritten by a later rebuild. Fixed regardless of the discount work.

update public.video_visit_prices
  set amount_minor = 1000000, updated_at = now()
  where organisation_id is null and amount_minor = 500000;

-- ---------------------------------------------------------------------------
-- Subscriber discount: any patient with an active/trialing subscription on a
-- non-Free plan gets 15% off list on a Screen-tier order. Writes
-- discount_kobo (payable_kobo is a generated column derived from it — see
-- 20260731214826_care_vouchers_enums_and_order_discount.sql). Runs BEFORE
-- the exclusion-annotation trigger in insert order does not matter — both
-- only set columns on NEW, neither rejects the row.
-- ---------------------------------------------------------------------------
create or replace function private.apply_screening_subscriber_discount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bundle_code text;
  v_subscribed boolean;
begin
  select code into v_bundle_code from public.panel_bundles where id = new.panel_bundle_id;

  if v_bundle_code not in ('screen_core', 'screen_advanced', 'screen_comprehensive') then
    return new;
  end if;

  select exists (
    select 1
    from public.subscriptions s
    join public.subscription_plans pl on pl.id = s.plan_id
    where s.subscriber_id = new.patient_id
      and s.status in ('active', 'trialing')
      and pl.code <> 'free'
  ) into v_subscribed;

  if v_subscribed and new.discount_kobo = 0 then
    new.discount_kobo := round(coalesce(new.total_kobo, 0) * 0.15);
  end if;

  return new;
end;
$$;

drop trigger if exists lab_orders_screening_subscriber_discount on public.lab_orders;
create trigger lab_orders_screening_subscriber_discount
  before insert on public.lab_orders
  for each row execute function private.apply_screening_subscriber_discount();

do $$
declare
  v_row public.video_visit_prices%rowtype;
begin
  select * into v_row from public.video_visit_prices where organisation_id is null;
  if v_row.amount_minor <> 1000000 then
    raise exception 'video_visit_prices platform default did not update to 1000000, is %', v_row.amount_minor;
  end if;
end $$;
