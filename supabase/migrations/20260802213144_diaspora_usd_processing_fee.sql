-- ---------------------------------------------------------------------------
-- Diaspora processing fee (10%), on top of the existing one-price-list
-- conversion. Plus a real bug this uncovered: recompute_derived_prices() had
-- never been exercised against a price-locked derived row before (the first
-- real diaspora subscriber -- complete_usd -- appeared today), and it has no
-- exception handling around the per-row UPDATE, so hitting one aborts the
-- WHOLE recompute, for every plan and add-on, not just the locked one. That
-- would have broken every future currency-rate change too, not just this fee.
--
-- Founder decision, 2026-08-02: an international card charge costs more to
-- process than a Paystack-in-Nigeria one (cross-border interchange + FX
-- conversion), and until now that real cost was invisible -- 20260729140916
-- held every USD row at EXACT parity with its naira parent, so the platform
-- was quietly absorbing the difference on every diaspora charge. This
-- recovers it as a flat, disclosed 10% processing fee, applied to both
-- monthly and annual charges alike: annual halves the number of card charges
-- a year, it does not change the per-charge processing cost rate, so there is
-- no cost basis for exempting it.
--
-- This is deliberately NOT a return to the retired 2.5-3.5x diaspora markup
-- (20260729143814 killed that for having no cost basis and being folded
-- silently into the sticker price). The fee here is (1) cost-based rather
-- than an arbitrary multiple, (2) uniform across every plan and add-on rather
-- than priced per tier, and (3) shown to the buyer as its own line, never
-- hidden inside a bigger number -- see the marketing/app-layer changes in the
-- same commit for the disclosure copy.
--
-- private.expected_derived_price_minor is the single formula both the
-- recompute path and the write-time enforcement trigger call, so this is the
-- only formula edit needed. It applies uniformly to subscription_plans AND
-- add_ons, since the reason a card costs more to process from abroad does not
-- depend on which SKU it is attached to.
-- ---------------------------------------------------------------------------

-- 1. Fix recompute_derived_prices() to skip a price-locked row instead of
--    aborting the whole recompute -----------------------------------------------
-- A locked row has active subscribers; private.enforce_subscription_plan_
-- price_lock() (and its add_ons twin) already refuse to move its price, by
-- design -- the founder's own 30-days'-notice pricing promise depends on an
-- existing subscriber never having their price move under them. The bug was
-- never that the write was refused; it is that the refusal was allowed to
-- blow up every OTHER row's recompute in the same pass. Reported in a
-- separate "locked" list rather than silently dropped, so an admin acting on
-- the "needs_sync" report is not left wondering why one plan never appears.

create or replace function private.recompute_derived_prices()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_changed jsonb := '[]'::jsonb;
  v_locked jsonb := '[]'::jsonb;
  r record;
  v_expected bigint;
begin
  for r in
    select p.code, p.currency, p.price_minor, p.price_locked, b.price_minor as base_minor
    from public.subscription_plans p
    join public.subscription_plans b on b.code = p.derived_from_code
    where p.derived_from_code is not null
  loop
    v_expected := private.expected_derived_price_minor(r.base_minor, r.currency);
    if v_expected is null or v_expected = r.price_minor then continue; end if;

    if r.price_locked then
      v_locked := v_locked || jsonb_build_object(
        'kind', 'plan', 'code', r.code, 'currency', r.currency,
        'was', r.price_minor, 'would_be', v_expected);
      continue;
    end if;

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
    select a.code, a.currency, a.price_minor, a.price_locked, b.price_minor as base_minor
    from public.add_ons a
    join public.add_ons b on b.code = a.derived_from_code
    where a.derived_from_code is not null
  loop
    v_expected := private.expected_derived_price_minor(r.base_minor, r.currency);
    if v_expected is null or v_expected = r.price_minor then continue; end if;

    if r.price_locked then
      v_locked := v_locked || jsonb_build_object(
        'kind', 'addon', 'code', r.code, 'currency', r.currency,
        'was', r.price_minor, 'would_be', v_expected);
      continue;
    end if;

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
                            'changed_count', jsonb_array_length(v_changed),
                            'locked', v_locked,
                            'locked_count', jsonb_array_length(v_locked));
end;
$$;

-- 2. The fee lives with the rate, editable the same way -----------------------

alter table public.platform_currency_settings
  add column if not exists usd_processing_fee_pct numeric not null default 0
    check (usd_processing_fee_pct >= 0 and usd_processing_fee_pct < 1);

comment on column public.platform_currency_settings.usd_processing_fee_pct is
  'Fraction (0.10 = 10%) added on top of the naira-converted price for every '
  'USD-derived plan/add-on. Recovers real international-card processing '
  'cost; editable at /admin/settings/diaspora-pricing the same way the '
  'reference rate is. Changing it runs the same recompute-then-resync path '
  'as the rate.';

-- 3. The formula, one place ----------------------------------------------------

create or replace function private.expected_derived_price_minor(
  p_base_minor bigint,
  p_currency public.currency
) returns bigint language sql stable security definer set search_path = '' as $$
  select case p_currency
    when 'USD' then (
      select case when s.ngn_per_usd is null or s.ngn_per_usd <= 0 then null
                  else round(p_base_minor / s.ngn_per_usd * (1 + coalesce(s.usd_processing_fee_pct, 0)))
             end
      from public.platform_currency_settings s where s.id)
    else null
  end;
$$;

-- 4. The fee is a recompute trigger too, same as the rate ---------------------

create or replace function private.on_currency_rate_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.ngn_per_usd is distinct from old.ngn_per_usd
     or new.usd_processing_fee_pct is distinct from old.usd_processing_fee_pct then
    perform private.recompute_derived_prices();
  end if;
  return new;
end;
$$;

-- 5. Admin-callable wrapper, mirrors set_usd_reference_rate exactly -----------

create or replace function public.set_usd_processing_fee(p_fee_pct numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'only a superadmin may change the processing fee' using errcode = '42501';
  end if;
  if p_fee_pct is null or p_fee_pct < 0 or p_fee_pct >= 1 then
    raise exception 'the processing fee must be between 0 and 100 percent' using errcode = '23514';
  end if;

  update public.platform_currency_settings
    set usd_processing_fee_pct = p_fee_pct,
        updated_at = now(),
        updated_by = (select auth.uid())
    where id;

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

revoke all on function public.set_usd_processing_fee(numeric) from public, anon;
grant execute on function public.set_usd_processing_fee(numeric) to authenticated;

-- 6. Set it: 10%, founder-confirmed 2026-08-02 ----------------------------------
-- Firing the trigger recomputes every USD-derived row that is not price-
-- locked. complete_usd carries one real active subscriber (Test Diaspora
-- Patient, created earlier today) and stays exactly as it is: same price,
-- same active Stripe subscription, untouched. Every other USD-derived row
-- moves and switches off until resynced from /admin/settings/diaspora-pricing
-- -- same fails-closed behaviour a rate change already has.

update public.platform_currency_settings
   set usd_processing_fee_pct = 0.10
 where id;

-- 7. Assertions -------------------------------------------------------------------

do $$
declare v_fee numeric; v_rate numeric; v_bad text;
begin
  select usd_processing_fee_pct, ngn_per_usd into v_fee, v_rate
    from public.platform_currency_settings where id;

  if v_fee is distinct from 0.10 then
    raise exception 'the USD processing fee is % not 0.10', v_fee;
  end if;
  if v_rate is null or v_rate <= 0 then
    raise exception 'no usable reference rate to check derived prices against';
  end if;

  -- Every unlocked USD-derived plan/add-on row must reflect the fee now,
  -- whether or not it has been resynced with a provider yet.
  select string_agg(p.code, ', ') into v_bad
    from public.subscription_plans p
    join public.subscription_plans b on b.code = p.derived_from_code
   where p.currency = 'USD' and not p.price_locked
     and p.price_minor is distinct from round(b.price_minor / v_rate * (1 + v_fee));
  if v_bad is not null then raise exception 'derived plans off the fee-inclusive rate: %', v_bad; end if;

  select string_agg(a.code, ', ') into v_bad
    from public.add_ons a
    join public.add_ons b on b.code = a.derived_from_code
   where a.currency = 'USD' and not a.price_locked
     and a.price_minor is distinct from round(b.price_minor / v_rate * (1 + v_fee));
  if v_bad is not null then raise exception 'derived add-ons off the fee-inclusive rate: %', v_bad; end if;

  -- A locked row must be completely untouched: still active, still its old
  -- price, still price_locked. The whole point of the lock.
  if exists (
    select 1 from public.subscription_plans p
    join public.subscription_plans b on b.code = p.derived_from_code
    where p.currency = 'USD' and p.price_locked
      and (not p.is_active or p.price_minor is distinct from round(b.price_minor / v_rate))
  ) then
    raise exception 'a price-locked USD plan was disturbed by the fee recompute';
  end if;

  -- Every unlocked derived row must now be off sale (no stale Stripe Price
  -- charging the pre-fee amount) until an admin resyncs it.
  if exists (
    select 1 from public.subscription_plans
    where derived_from_code is not null and currency = 'USD' and not price_locked and is_active
  ) then
    raise exception 'an unlocked USD-derived plan is still active on a pre-fee Stripe price';
  end if;
  if exists (
    select 1 from public.add_ons
    where derived_from_code is not null and currency = 'USD' and not price_locked and is_active
  ) then
    raise exception 'an unlocked USD-derived add-on is still active on a pre-fee Stripe price';
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'set_usd_processing_fee'
               and has_function_privilege('anon', p.oid, 'EXECUTE')) then
    raise exception 'set_usd_processing_fee is anon-executable';
  end if;
end $$;
