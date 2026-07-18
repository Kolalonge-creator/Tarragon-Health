-- Tarragon Health
-- Subscriptions/payments (Sprint 6) — columns needed before the Paystack
-- integration and admin CRUD can be built: a plan's synced Paystack Plan
-- object code, a lock flag once the plan has real subscribers (blocks price
-- edits — see admin/settings/subscriptions), and the pending checkout
-- reference on a subscription row before its activating webhook lands.

alter table public.subscription_plans
  add column paystack_plan_code text,
  add column price_locked boolean not null default false;

alter table public.subscriptions
  add column pending_provider_ref text;

-- Flip price_locked once a plan gets its first active/trialing subscriber —
-- Paystack Plan objects are price-immutable, so editing price_minor after
-- real money is flowing would silently desync the DB from what Paystack
-- actually charges. The admin UI reads this flag to make price fields
-- read-only and offer "clone as new plan" instead (see plans-manager.tsx).
create or replace function private.lock_subscription_plan_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('active', 'trialing') and new.plan_id is not null then
    update public.subscription_plans
      set price_locked = true
      where id = new.plan_id and price_locked = false;
  end if;
  return new;
end;
$$;

create trigger subscriptions_lock_plan_price
  after insert or update of status on public.subscriptions
  for each row execute function private.lock_subscription_plan_price();
