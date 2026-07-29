-- Go-live pricing corrections + diaspora FX reference (2026-07-21).

-- 1) Confirmed add-on prices (were founder placeholders): Lifestyle Coaching
--    ₦15,000 → ₦25,000/month; Annual Health Review ₦50,000 → ₦70,000/year.
update public.add_ons set price_minor = 2500000
  where code = 'lifestyle-coaching' and currency = 'NGN'
    and not price_locked and price_minor <> 2500000;
update public.add_ons set price_minor = 7000000
  where code = 'annual-review' and currency = 'NGN'
    and not price_locked and price_minor <> 7000000;

-- 2) Platform currency reference rate. A single-row table an admin edits at
--    /admin/settings/diaspora-pricing; the USD diaspora prices are kept in
--    parity with the GBP prices at this GBP→USD rate. (Diaspora prices are
--    deliberately round numbers, not live conversions — this is a reference
--    the admin applies deliberately, never an automatic price feed.)
create table if not exists public.platform_currency_settings (
  id boolean primary key default true,
  usd_per_gbp numeric(8, 4) not null default 1.34,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  constraint platform_currency_settings_singleton check (id)
);
alter table public.platform_currency_settings enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'platform_currency_settings'
      and policyname = 'pcs_read'
  ) then
    create policy pcs_read on public.platform_currency_settings
      for select to authenticated using (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'platform_currency_settings'
      and policyname = 'pcs_admin_write'
  ) then
    create policy pcs_admin_write on public.platform_currency_settings
      for all to authenticated
      using (private.is_admin()) with check (private.is_admin());
  end if;
end $$;
insert into public.platform_currency_settings (id, usd_per_gbp)
values (true, 1.34)
on conflict (id) do nothing;

-- 3) Correct the stale USD diaspora plan prices. essential/parentcare USD were
--    left at old placeholder values (~6–8× below the GBP equivalent). Their
--    price_locked flags were set only by orphaned test-mode subscriptions whose
--    auth users have since been deleted, so no real subscriber is affected.
--    Unlock, reprice to the GBP-equivalent at the reference rate (yearly = 10×
--    monthly, matching the GBP "2 months free" pattern), and null the Stripe
--    ids so a stale Stripe Price can never be charged until an admin re-syncs.
update public.subscription_plans set price_locked = false
  where currency = 'USD'
    and code in ('essential_usd', 'parentcare_usd', 'parentcare_yearly_usd')
    and price_locked;

update public.subscription_plans sp set
    price_minor = v.minor,
    stripe_price_id = null,
    stripe_product_id = null
from (values
  ('essential_usd', 3400),
  ('essential_yearly_usd', 34000),
  ('complete_usd', 7900),
  ('complete_yearly_usd', 79000),
  ('parentcare_usd', 15900),
  ('parentcare_yearly_usd', 159000),
  ('family_usd', 10700)
) as v(code, minor)
where sp.code = v.code and sp.currency = 'USD' and sp.price_minor <> v.minor;
