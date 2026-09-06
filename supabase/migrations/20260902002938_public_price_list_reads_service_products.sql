-- ---------------------------------------------------------------------------
-- public_price_list() was left reading the retired subscription_plans/add_ons
-- tables after the pay-per-service migration (PR #418) replaced them with
-- service_products as the entitlement source of truth. The two happened to
-- still agree on every number, which is exactly the kind of drift that looks
-- fine right up until someone reprices one catalogue without the other —
-- this closes that gap by pointing the function at service_products, the
-- table that's actually charged from.
--
-- Return shape: service_products has no `interval` column — a one-off credit
-- (Ask a Doctor, a video visit) has no billing interval at all, so inventing
-- one for it would be dishonest. `access_duration_days` (30 for a monthly
-- pack, 365 for yearly, 90 for most one-off credits) is what the table
-- actually stores; the marketing site's only real caller
-- (lib/marketing/plan-prices.ts) has never read the interval-ish column
-- anyway, it only ever used code + price_minor, so this is a safe rename.
--
-- CREATE OR REPLACE can't change a function's return type, so this needs a
-- real DROP first — which also drops its grants, hence the explicit re-grant
-- below (see the standing anon-EXECUTE-via-PUBLIC gotcha in CLAUDE.md: it's
-- `revoke ... from public`, not `from anon`, that actually matters here).
-- ---------------------------------------------------------------------------

drop function if exists public.public_price_list();

create function public.public_price_list()
returns table (
  code text,
  currency public.currency,
  access_duration_days integer,
  price_minor bigint
)
language sql stable security definer set search_path = '' as $$
  select p.code, p.currency, p.access_duration_days, p.price_kobo
  from public.service_products p
  where p.is_active;
$$;

comment on function public.public_price_list() is
  'Prices of on-sale service products, for the public marketing site. Deliberately returns no features, no provider references and no inactive rows.';

revoke all on function public.public_price_list() from public, anon;
grant execute on function public.public_price_list() to anon, authenticated;

do $$
begin
  if not has_function_privilege('anon', 'public.public_price_list()', 'EXECUTE') then
    raise exception 'the marketing site cannot read the price list';
  end if;
  -- It must never leak a row that is not on sale.
  if exists (
    select 1 from public.public_price_list() f
    where not exists (
      select 1 from public.service_products p where p.code = f.code and p.is_active
    )
  ) then
    raise exception 'the public price list is exposing an off-sale row';
  end if;
  -- It must actually be sourced from service_products now, not the retired
  -- subscription_plans/add_ons tables (a stale price there could otherwise
  -- silently keep matching by coincidence and mask this check being wrong).
  -- Originally hardcoded a check for a specific 'prevent_pack' row being
  -- active — but that row's is_active traces back through
  -- 20260831140512_service_products_and_purchases_core.sql's seed-copy to
  -- subscription_plans.prevent.is_active, which
  -- 20260805201508_raise_ngn_tier_prices_and_fold_prevention_into_chronic_plans.sql
  -- deliberately sets to false pending a manual Paystack "Sync now" admin
  -- action (see that migration's own comment) — an app-level action outside
  -- the migration system, not something a fresh `supabase db reset` can ever
  -- reproduce. It happens to be true on live today because someone
  -- re-synced it after that migration ran. Replaced with a structural count
  -- check instead: every currently-active service_products row must appear
  -- in the function's output, and nothing else — this proves the function
  -- reads service_products correctly on ANY environment, without asserting
  -- the activation state of one specific, non-deterministic row.
  if (select count(*) from public.public_price_list()) <> (select count(*) from public.service_products where is_active) then
    raise exception 'the public price list result count does not match service_products active rows — check it is reading the right table';
  end if;
end $$;
