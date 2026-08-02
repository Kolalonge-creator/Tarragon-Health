-- Corrects a mistake in the previous migration in this batch
-- (20260802010500_screening_subscriber_discount_and_video_price_fix.sql):
-- it wrote to lab_orders.discount_kobo, which does not exist on the live
-- database. The live `payable_kobo` generated column is actually
-- `greatest(total_kobo - voucher_covered_kobo, 0)` — a real drift between
-- the committed care-vouchers migration files (which define a separate
-- discount_kobo column) and what is actually live. Not investigated further
-- here — out of scope for this batch — but flagged.
--
-- Reusing voucher_covered_kobo directly for a non-voucher discount would be
-- wrong: private.redeem_care_voucher accounts against that column
-- specifically as "covered by a real voucher redemption," and a patient who
-- both gets the subscriber discount AND later redeems a real voucher would
-- have the two silently conflated. Adds a genuinely separate column instead
-- and widens payable_kobo's generation expression to subtract both.

alter table public.lab_orders
  add column if not exists subscriber_discount_kobo bigint not null default 0
  check (subscriber_discount_kobo >= 0);

alter table public.lab_orders drop column payable_kobo;
alter table public.lab_orders
  add column payable_kobo bigint
  generated always as (
    greatest(coalesce(total_kobo, 0) - voucher_covered_kobo - subscriber_discount_kobo, 0)
  ) stored;

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

  if v_subscribed and coalesce(new.subscriber_discount_kobo, 0) = 0 then
    new.subscriber_discount_kobo := round(coalesce(new.total_kobo, 0) * 0.15);
  end if;

  return new;
end;
$$;

do $$
declare
  v_gen text;
begin
  select generation_expression into v_gen from information_schema.columns
    where table_schema='public' and table_name='lab_orders' and column_name='payable_kobo';
  if v_gen not ilike '%subscriber_discount_kobo%' then
    raise exception 'payable_kobo generation expression was not widened, is: %', v_gen;
  end if;
end $$;
