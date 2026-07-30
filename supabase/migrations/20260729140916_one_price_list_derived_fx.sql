-- ---------------------------------------------------------------------------
-- One price list, payable in naira, pounds or dollars.
--
-- Removal 3, pass 2 of 2. Founder decision 2026-07-29: the same SKU costs the
-- same amount everywhere; currency is a payment rail, not a price band. v3 §15
-- calls this "no currency-based price discrimination".
--
-- Until now GBP and USD amounts were set independently of the naira ones and
-- drifted far above them (ParentCare was ₦20,000/mo against £119/mo). After
-- this migration a diaspora row has no price of its own: it is its naira
-- parent converted at the admin-set reference rate, and the database refuses
-- to store anything else.
--
-- The founder's requirement is that the rate is editable in the admin panel at
-- any time and the change shows up everywhere, Stripe included. Half of that
-- is here: changing the rate recomputes every derived price, and because
-- Paystack Plans and Stripe Prices are amount-immutable it also clears each
-- changed row's provider reference and deactivates it, so nothing can be sold
-- at a price the rate no longer supports. The other half — minting the
-- replacement Stripe Prices and reactivating — is the admin action, which
-- cannot live in SQL.
-- ---------------------------------------------------------------------------

-- 1. Say which row derives from which -----------------------------------------
-- An explicit column, not a code convention: the codes are not consistent
-- enough for one (health-education_gbp uses an underscore,
-- extra-parentcare-member-gbp a hyphen, and family_lite_gbp derives from a
-- naira row called plain ).

alter table public.subscription_plans
  add column if not exists derived_from_code text
    references public.subscription_plans (code) on delete restrict;
alter table public.add_ons
  add column if not exists derived_from_code text
    references public.add_ons (code) on delete restrict;

comment on column public.subscription_plans.derived_from_code is
  'The naira row this price is converted from. Non-null means the price is not '
  'independently settable — see private.expected_derived_price_minor.';

update public.subscription_plans p set derived_from_code = m.base
from (values
    ('prevent_gbp', 'prevent'),
    ('prevent_usd', 'prevent'),
    ('prevent_yearly_gbp', 'prevent_yearly'),
    ('prevent_yearly_usd', 'prevent_yearly'),
    ('essential_gbp', 'essential'),
    ('essential_usd', 'essential'),
    ('essential_yearly_gbp', 'essential_yearly'),
    ('essential_yearly_usd', 'essential_yearly'),
    ('complete_gbp', 'complete'),
    ('complete_usd', 'complete'),
    ('complete_yearly_gbp', 'complete_yearly'),
    ('complete_yearly_usd', 'complete_yearly'),
    ('family_lite_gbp', 'family'),
    ('family_lite_usd', 'family'),
    ('family_plus_gbp', 'family_plus'),
    ('family_plus_usd', 'family_plus'),
    ('family_premium_gbp', 'family_premium'),
    ('family_premium_usd', 'family_premium'),
    ('parentcare_gbp', 'parentcare'),
    ('parentcare_usd', 'parentcare'),
    ('parentcare_yearly_gbp', 'parentcare_yearly'),
    ('parentcare_yearly_usd', 'parentcare_yearly')
) as m(code, base)
where p.code = m.code;

update public.add_ons a set derived_from_code = m.base
from (values
    ('annual-review_gbp', 'annual-review'),
    ('annual-review_usd', 'annual-review'),
    ('care-coordinator_gbp', 'care-coordinator'),
    ('care-coordinator_usd', 'care-coordinator'),
    ('expedited-response_gbp', 'expedited-response'),
    ('expedited-response_usd', 'expedited-response'),
    ('extra-family-member_gbp', 'extra-family-member'),
    ('extra-family-member_usd', 'extra-family-member'),
    ('extra-family-member-plus_gbp', 'extra-family-member-plus'),
    ('extra-family-member-plus_usd', 'extra-family-member-plus'),
    ('extra-family-member-premium_gbp', 'extra-family-member-premium'),
    ('extra-family-member-premium_usd', 'extra-family-member-premium'),
    ('extra-parentcare-member-gbp', 'extra-parentcare-member'),
    ('extra-parentcare-member-usd', 'extra-parentcare-member'),
    ('extra-parentcare-member-yearly-gbp', 'extra-parentcare-member-yearly'),
    ('extra-parentcare-member-yearly-usd', 'extra-parentcare-member-yearly'),
    ('health-education_gbp', 'health-education'),
    ('health-education_usd', 'health-education'),
    ('lifestyle-coaching_gbp', 'lifestyle-coaching'),
    ('lifestyle-coaching_usd', 'lifestyle-coaching'),
    ('prevention-screening_gbp', 'prevention-screening'),
    ('prevention-screening_usd', 'prevention-screening')
) as m(code, base)
where a.code = m.code;

-- 2. The conversion, in one place ---------------------------------------------
-- price_minor is kobo for NGN and pence/cents for GBP/USD, both hundredths, so
-- the conversion is just a division by the naira-per-unit rate. Returns null
-- when the rate is unset, which callers treat as "cannot derive yet" rather
-- than as zero.

create or replace function private.expected_derived_price_minor(
  p_base_minor bigint,
  p_currency public.currency
) returns bigint language sql stable security definer set search_path = '' as $$
  select case p_currency
    when 'GBP' then (select case when s.ngn_per_gbp is null or s.ngn_per_gbp <= 0 then null
                                 else round(p_base_minor / s.ngn_per_gbp) end
                     from public.platform_currency_settings s where s.id)
    when 'USD' then (select case when s.ngn_per_usd is null or s.ngn_per_usd <= 0 then null
                                 else round(p_base_minor / s.ngn_per_usd) end
                     from public.platform_currency_settings s where s.id)
    else null
  end;
$$;

-- 3. Recompute -----------------------------------------------------------------
-- Rewrites every derived row from its parent. A row whose amount actually
-- moves loses its provider reference and its activation, because the existing
-- Paystack Plan / Stripe Price still charges the old amount and cannot be
-- edited. Rows that land on the same number are left completely alone, so
-- re-running this is cheap and does not churn live plans.

create or replace function private.recompute_derived_prices()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_changed jsonb := '[]'::jsonb;
  r record;
  v_expected bigint;
begin
  for r in
    select p.code, p.currency, p.price_minor, b.price_minor as base_minor
    from public.subscription_plans p
    join public.subscription_plans b on b.code = p.derived_from_code
    where p.derived_from_code is not null
  loop
    v_expected := private.expected_derived_price_minor(r.base_minor, r.currency);
    if v_expected is null or v_expected = r.price_minor then continue; end if;

    update public.subscription_plans
      set price_minor = v_expected,
          price_locked = false,
          is_active = false,
          paystack_plan_code = null,
          stripe_price_id = null,
          stripe_product_id = null
      where code = r.code;

    v_changed := v_changed || jsonb_build_object(
      'kind', 'plan', 'code', r.code, 'currency', r.currency,
      'was', r.price_minor, 'now', v_expected);
  end loop;

  for r in
    select a.code, a.currency, a.price_minor, b.price_minor as base_minor
    from public.add_ons a
    join public.add_ons b on b.code = a.derived_from_code
    where a.derived_from_code is not null
  loop
    v_expected := private.expected_derived_price_minor(r.base_minor, r.currency);
    if v_expected is null or v_expected = r.price_minor then continue; end if;

    update public.add_ons
      set price_minor = v_expected,
          price_locked = false,
          is_active = false,
          paystack_plan_code = null,
          stripe_price_id = null,
          stripe_product_id = null
      where code = r.code;

    v_changed := v_changed || jsonb_build_object(
      'kind', 'addon', 'code', r.code, 'currency', r.currency,
      'was', r.price_minor, 'now', v_expected);
  end loop;

  return jsonb_build_object('changed', v_changed,
                            'changed_count', jsonb_array_length(v_changed));
end;
$$;

-- 4. Changing the rate is the only way to change a diaspora price --------------
-- Firing on the settings row means the guarantee holds however the rate is
-- edited — through the admin panel, through a console, through a future
-- script. There is no path that updates the rate and forgets the prices.

create or replace function private.on_currency_rate_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.ngn_per_gbp is distinct from old.ngn_per_gbp
     or new.ngn_per_usd is distinct from old.ngn_per_usd then
    perform private.recompute_derived_prices();
  end if;
  return new;
end;
$$;

drop trigger if exists platform_currency_settings_recompute on public.platform_currency_settings;
create trigger platform_currency_settings_recompute
  after update on public.platform_currency_settings
  for each row execute function private.on_currency_rate_change();

-- 5. And the price cannot be set by hand ---------------------------------------
-- Without this the column is only a convention. With it, "one price list" is a
-- property of the database: an admin editing a diaspora price directly is
-- rejected and told to move the rate or the naira price instead.

create or replace function private.enforce_derived_price()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_base bigint; v_expected bigint;
begin
  if new.derived_from_code is null then return new; end if;

  if tg_table_name = 'subscription_plans' then
    select price_minor into v_base from public.subscription_plans where code = new.derived_from_code;
  else
    select price_minor into v_base from public.add_ons where code = new.derived_from_code;
  end if;
  if v_base is null then return new; end if;

  v_expected := private.expected_derived_price_minor(v_base, new.currency);
  -- No rate set yet: nothing to enforce against, leave the row alone.
  if v_expected is null then return new; end if;

  if new.price_minor is distinct from v_expected then
    raise exception
      '% is priced from its naira plan (%): expected % but got %. Change the naira price or the reference rate, not this row.',
      new.code, new.derived_from_code, v_expected, new.price_minor
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists subscription_plans_enforce_derived on public.subscription_plans;
create trigger subscription_plans_enforce_derived
  before insert or update of price_minor, derived_from_code on public.subscription_plans
  for each row execute function private.enforce_derived_price();

drop trigger if exists add_ons_enforce_derived on public.add_ons;
create trigger add_ons_enforce_derived
  before insert or update of price_minor, derived_from_code on public.add_ons
  for each row execute function private.enforce_derived_price();

-- 6. Admin-callable wrapper -----------------------------------------------------

create or replace function public.set_currency_reference_rates(
  p_ngn_per_gbp numeric,
  p_ngn_per_usd numeric
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'only a superadmin may change the reference rates' using errcode = '42501';
  end if;
  if p_ngn_per_gbp is null or p_ngn_per_gbp <= 0 or p_ngn_per_usd is null or p_ngn_per_usd <= 0 then
    raise exception 'both reference rates must be greater than zero' using errcode = '23514';
  end if;

  update public.platform_currency_settings
    set ngn_per_gbp = p_ngn_per_gbp,
        ngn_per_usd = p_ngn_per_usd,
        updated_at = now(),
        updated_by = (select auth.uid())
    where id;

  -- The trigger above has already recomputed by this point; report what moved
  -- so the caller knows exactly which rows now need a fresh Stripe Price.
  select jsonb_agg(jsonb_build_object('kind', kind, 'code', code, 'currency', currency,
                                      'price_minor', price_minor))
    into v_result
  from (
    select 'plan' as kind, code, currency, price_minor from public.subscription_plans
      where derived_from_code is not null and not is_active
    union all
    select 'addon', code, currency, price_minor from public.add_ons
      where derived_from_code is not null and not is_active
  ) x;

  return jsonb_build_object('needs_sync', coalesce(v_result, '[]'::jsonb));
end;
$$;

revoke all on function public.set_currency_reference_rates(numeric, numeric) from public, anon;
grant execute on function public.set_currency_reference_rates(numeric, numeric) to authenticated;

-- 7. Assertions ------------------------------------------------------------------

do $$
declare v_bad text; v_n int;
begin
  select count(*) into v_n from public.subscription_plans where derived_from_code is not null;
  if v_n <> 22 then raise exception 'expected 22 derived plans, found %', v_n; end if;

  select count(*) into v_n from public.add_ons where derived_from_code is not null;
  if v_n <> 22 then raise exception 'expected 22 derived add-ons, found %', v_n; end if;

  -- Every derived row must point at a naira row that exists.
  select string_agg(code, ', ') into v_bad from public.subscription_plans p
  where p.derived_from_code is not null
    and not exists (select 1 from public.subscription_plans b
                    where b.code = p.derived_from_code and b.currency = 'NGN');
  if v_bad is not null then raise exception 'derived plans with no naira parent: %', v_bad; end if;

  -- Flag, do not silently price: these two are diaspora-only tiers with no
  -- naira counterpart, so they are deliberately NOT on the single price list.
  -- They are inactive and stay that way until the founder decides whether they
  -- get a naira parent or are retired.
  if exists (select 1 from public.subscription_plans
             where code like 'diaspora_premium%' and is_active) then
    raise exception 'a diaspora-only tier is active but is not on the single price list';
  end if;
end $$;
