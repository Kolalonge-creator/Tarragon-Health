-- Tarragon Health
-- Enforces price_locked at the DB level, not just as an admin-UI hint —
-- once a subscription_plans/add_ons row has an active/trialing subscriber,
-- Paystack's own Plan object is price-immutable, so allowing price_minor/
-- currency/interval to drift out of sync with what Paystack actually
-- charges would silently break billing. The admin UI reads price_locked to
-- disable those fields client-side (plans-manager.tsx/add-ons-manager.tsx);
-- this trigger is the defense-in-depth guarantee that holds even if the UI
-- check is ever bypassed.
create or replace function private.enforce_subscription_plan_price_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.price_locked
    and (new.price_minor <> old.price_minor or new.currency <> old.currency or new.interval <> old.interval)
  then
    raise exception 'plan_price_locked: this plan has active subscribers — clone it as a new plan to change price/currency/interval';
  end if;
  return new;
end;
$$;

create trigger subscription_plans_enforce_price_lock
  before update on public.subscription_plans
  for each row execute function private.enforce_subscription_plan_price_lock();

create or replace function private.enforce_add_on_price_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.price_locked
    and (new.price_minor <> old.price_minor or new.currency <> old.currency or new.interval <> old.interval)
  then
    raise exception 'add_on_price_locked: this add-on has active subscribers — clone it as a new add-on to change price/currency/interval';
  end if;
  return new;
end;
$$;

create trigger add_ons_enforce_price_lock
  before update on public.add_ons
  for each row execute function private.enforce_add_on_price_lock();
