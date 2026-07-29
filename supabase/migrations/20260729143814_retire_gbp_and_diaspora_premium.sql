-- ---------------------------------------------------------------------------
-- One diaspora currency: dollars. Pounds and Diaspora Premium retired.
--
-- Founder decisions, 2026-07-29, closing the two questions removal 3 left open:
--
--   1. The reference rate. USD only — "the universal currency" — at ₦1,365 to
--      the dollar. GBP is not given a rate; it is removed.
--   2. Diaspora Premium. Retired. It was the one tier with no naira parent, so
--      it could never sit on a single price list, and it was GBP-only anyway.
--
-- Every GBP row was already inactive with no Paystack Plan and no Stripe Price
-- (removal 3 cleared them when it made diaspora prices derived), so nothing
-- purchasable is being withdrawn and no provider object is orphaned by this.
--
-- Setting the rate at the bottom of this file is what actually prices the
-- dollar list: the trigger from 20260729140916 recomputes every derived row
-- from its naira parent the moment the rate moves. Those rows come out
-- inactive with no stripe_price_id, by design — a Stripe Price is immutable,
-- so each one needs minting fresh before it can be sold.
-- ---------------------------------------------------------------------------

-- 1. Remove the pound rows -----------------------------------------------------
-- Derived rows are the children in the derived_from_code FK, so they delete
-- without disturbing the naira list they were priced from.

delete from public.subscription_plans where currency = 'GBP';
delete from public.add_ons where currency = 'GBP';

-- Diaspora Premium had no naira counterpart in any currency; 20260729140916
-- asserted it stayed off sale for exactly that reason. It is retired outright.
delete from public.subscription_plans where code like 'diaspora_premium%';

-- 2. Keep it removed -----------------------------------------------------------
-- The currency enum keeps its GBP member: it is stamped on payment_transactions
-- and other historical rows across the schema, and rewriting a type that widely
-- used to delete one label would risk far more than it buys. The guarantee is
-- made where it matters instead — the two price tables refuse a pound price, so
-- reintroducing a GBP list requires a visible migration rather than an INSERT.

alter table public.subscription_plans
  drop constraint if exists subscription_plans_no_gbp,
  add constraint subscription_plans_no_gbp check (currency <> 'GBP');

alter table public.add_ons
  drop constraint if exists add_ons_no_gbp,
  add constraint add_ons_no_gbp check (currency <> 'GBP');

-- 3. One rate, not two ---------------------------------------------------------

create or replace function private.expected_derived_price_minor(
  p_base_minor bigint,
  p_currency public.currency
) returns bigint language sql stable security definer set search_path = '' as $$
  select case p_currency
    when 'USD' then (select case when s.ngn_per_usd is null or s.ngn_per_usd <= 0 then null
                                 else round(p_base_minor / s.ngn_per_usd) end
                     from public.platform_currency_settings s where s.id)
    else null
  end;
$$;

create or replace function private.on_currency_rate_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.ngn_per_usd is distinct from old.ngn_per_usd then
    perform private.recompute_derived_prices();
  end if;
  return new;
end;
$$;

-- The two-rate admin entry point goes with the second rate. Replaced rather
-- than left in place, so a caller still passing a pound rate fails loudly
-- instead of silently having it ignored.
drop function if exists public.set_currency_reference_rates(numeric, numeric);

create or replace function public.set_usd_reference_rate(p_ngn_per_usd numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'only a superadmin may change the reference rate' using errcode = '42501';
  end if;
  if p_ngn_per_usd is null or p_ngn_per_usd <= 0 then
    raise exception 'the reference rate must be greater than zero' using errcode = '23514';
  end if;

  update public.platform_currency_settings
    set ngn_per_usd = p_ngn_per_usd,
        updated_at = now(),
        updated_by = (select auth.uid())
    where id;

  -- The recompute trigger has already run. Report what now needs a fresh
  -- Stripe Price, since the old one charges an amount the rate no longer supports.
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

revoke all on function public.set_usd_reference_rate(numeric) from public, anon;
grant execute on function public.set_usd_reference_rate(numeric) to authenticated;

-- 4. Drop the pound columns -----------------------------------------------------
-- usd_per_gbp existed only to cross-rate the two diaspora currencies against
-- each other; with one diaspora currency there is nothing to cross.

alter table public.platform_currency_settings
  drop column if exists ngn_per_gbp,
  drop column if exists usd_per_gbp;

-- 5. Set the rate ----------------------------------------------------------------
-- ₦1,365 to the dollar, founder-supplied 2026-07-29. Editable at any time from
-- /admin/settings/diaspora-pricing; changing it here or there runs the same
-- recompute, because the trigger is on the row, not on the admin path.

update public.platform_currency_settings
   set ngn_per_usd = 1365, updated_at = now()
 where id;

-- 6. Assertions --------------------------------------------------------------------

do $$
declare v_n int; v_bad text;
begin
  select count(*) into v_n from public.subscription_plans where currency = 'GBP';
  if v_n <> 0 then raise exception '% GBP plan rows survived', v_n; end if;

  select count(*) into v_n from public.add_ons where currency = 'GBP';
  if v_n <> 0 then raise exception '% GBP add-on rows survived', v_n; end if;

  select count(*) into v_n from public.subscription_plans where code like 'diaspora_premium%';
  if v_n <> 0 then raise exception 'Diaspora Premium survived (% rows)', v_n; end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'set_currency_reference_rates') then
    raise exception 'the two-rate entry point still exists';
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'platform_currency_settings'
               and column_name in ('ngn_per_gbp', 'usd_per_gbp')) then
    raise exception 'a pound rate column survived';
  end if;

  select ngn_per_usd into v_n from public.platform_currency_settings where id;
  if v_n is distinct from 1365 then raise exception 'the USD rate is % not 1365', v_n; end if;

  -- Every dollar row must now be exactly its naira parent at the set rate.
  -- This is the whole claim of "one price list" and it is cheap to prove.
  select string_agg(p.code, ', ') into v_bad
    from public.subscription_plans p
    join public.subscription_plans b on b.code = p.derived_from_code
   where p.price_minor is distinct from round(b.price_minor / 1365.0);
  if v_bad is not null then raise exception 'derived plans off the rate: %', v_bad; end if;

  select string_agg(a.code, ', ') into v_bad
    from public.add_ons a
    join public.add_ons b on b.code = a.derived_from_code
   where a.price_minor is distinct from round(b.price_minor / 1365.0);
  if v_bad is not null then raise exception 'derived add-ons off the rate: %', v_bad; end if;

  -- A pound price must be impossible, not merely absent. Probing by UPDATE
  -- rather than INSERT keeps the test about the constraint: an INSERT could
  -- fail on some unrelated NOT NULL and read as a pass.
  begin
    update public.subscription_plans set currency = 'GBP' where code = 'essential';
    raise exception 'a GBP currency was accepted on a plan row';
  exception when check_violation then null;
  end;
end $$;
