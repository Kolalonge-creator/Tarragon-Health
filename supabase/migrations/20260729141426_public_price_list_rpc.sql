-- ---------------------------------------------------------------------------
-- A public, minimal view of the price list.
--
-- The marketing /pricing page has to show the same numbers the platform will
-- actually charge, otherwise "change the rate and it shows everywhere" stops
-- being true at the most visible surface of all. But subscription_plans and
-- add_ons are `authenticated`-only, and a public page has no session.
--
-- Rather than opening those tables to anon — which would also expose feature
-- arrays, provider references and inactive draft rows — this exposes exactly
-- the four fields a price list needs, for on-sale rows only.
--
-- The output column is `billing_interval`, not `interval`, because `interval`
-- is a reserved word in a RETURNS TABLE list.
-- ---------------------------------------------------------------------------

create or replace function public.public_price_list()
returns table (
  code text,
  currency public.currency,
  billing_interval public.billing_interval,
  price_minor bigint
)
language sql stable security definer set search_path = '' as $$
  select p.code, p.currency, p.interval, p.price_minor
  from public.subscription_plans p
  where p.is_active
  union all
  select a.code, a.currency, a.interval, a.price_minor
  from public.add_ons a
  where a.is_active;
$$;

comment on function public.public_price_list() is
  'Prices of on-sale plans and add-ons, for the public marketing site. Deliberately returns no features, no provider references and no inactive rows.';

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
      select 1 from public.subscription_plans p where p.code = f.code and p.is_active
      union all
      select 1 from public.add_ons a where a.code = f.code and a.is_active
    )
  ) then
    raise exception 'the public price list is exposing an off-sale row';
  end if;
end $$;
