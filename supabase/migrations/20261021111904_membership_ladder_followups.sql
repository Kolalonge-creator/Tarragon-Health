-- Membership ladder follow-ups (founder decision 2026-10-21; build brief steps 6, 7, 9, 10 and the review follow-ups of the foundation PR).
-- Applies after 20261021111211_membership_upgrade_order_and_tier_flag.sql.
--
--   1. Extension paths keep the larger tier. When a paid or accepted Membership extends an existing dated one (record_order_payment,
--      record_instalment_payment, respond_to_gifted_pack), the tier becomes plus if the item bought is plus, and is otherwise left alone.
--      Before this, an Membership holder who was gifted or bought Membership Plus kept the Membership tier and never got the panel.
--   2. No instalments for the two paid tiers. While the module membership_two_member_tiers is on, create_instalment_order refuses every
--      Membership code with instalment_not_available (one yearly payment only, no monthly payment, no instalments).
--   3. Care vouchers can never be a Membership. A care voucher is a prepaid service; layaway toward it is an instalment path, so a voucher
--      row whose sku_code names a Membership is refused at the table.
--   4. Renewal reminders carry the tier in their payload so the wording can differ by tier; the schedule (30, 14, 7 days, then the 14 day
--      grace) is unchanged and identical for both tiers.
--   5. Employer seats price per item code: the organisation price guard now refuses a price for any code that has no active limits row.
--      Only membership_annual (Membership Plus) has limits, so there are no Membership-only seats until the doctor-minutes are measured and
--      the CMO signs (build brief step 7). The employer sees counts and money only, never a tier (I9; unchanged).
--   6. public.grant_membership_tier(patient, tier, reason, ends_at): the admin grant with a tier choice. grant_membership itself is
--      untouched (it still grants Plus), so no overload is added to a function with existing callers.
-- Functions are patched from their LIVE definitions, each fragment checked to match the stated number of times.
-- ROLLBACK: restore the patched function bodies, drop grant_membership_tier and the voucher trigger.

create or replace function pg_temp.patch_fn(p_sig regprocedure, p_pairs text[], p_counts integer[] default null) returns void language plpgsql as $f$
declare d text := pg_get_functiondef(p_sig); i integer := 1; n integer; want integer;
begin
  while i < array_length(p_pairs, 1) loop
    n := (length(d) - length(replace(d, p_pairs[i], ''))) / length(p_pairs[i]);
    want := coalesce(p_counts[(i + 1) / 2], 1);
    if n <> want then raise exception 'followups patch of % expected % match(es) for [%], found %', p_sig, want, p_pairs[i], n; end if;
    d := replace(d, p_pairs[i], p_pairs[i + 1]);
    i := i + 2;
  end loop;
  execute d;
end $f$;

-- 1. extension keeps the larger tier
select pg_temp.patch_fn('public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure, array[
  $p$ends_at = greatest(ends_at, v_start) + make_interval(days => it.duration_days)$p$,
  $p$ends_at = greatest(ends_at, v_start) + make_interval(days => it.duration_days),
             tier = case when private.membership_tier_for_item(it.code) = 'plus' then 'plus' else tier end$p$]);
select pg_temp.patch_fn('private.record_instalment_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure, array[
  $p$ends_at = greatest(ends_at, v_start) + make_interval(days => it.duration_days)$p$,
  $p$ends_at = greatest(ends_at, v_start) + make_interval(days => it.duration_days),
             tier = case when private.membership_tier_for_item(it.code) = 'plus' then 'plus' else tier end$p$]);
select pg_temp.patch_fn('public.respond_to_gifted_pack(uuid,boolean)'::regprocedure, array[
  $p$ends_at = greatest(ends_at, now()) + make_interval(days => it.duration_days)$p$,
  $p$ends_at = greatest(ends_at, now()) + make_interval(days => it.duration_days),
             tier = case when private.membership_tier_for_item(it.code) = 'plus' then 'plus' else tier end$p$]);

-- 2. no instalments for the paid tiers
select pg_temp.patch_fn('public.create_instalment_order(text,uuid,integer)'::regprocedure, array[
  $p$if not coalesce((select is_enabled from public.platform_modules where key = 'membership_instalments'), false) then$p$,
  $p$if p_code in ('membership_annual', 'membership_annual_no_panel', 'membership_upgrade_plus')
     and coalesce((select is_enabled from public.platform_modules where key = 'membership_two_member_tiers'), false) then
    raise exception 'instalment_not_available' using errcode = 'P0001';
  end if;
  if not coalesce((select is_enabled from public.platform_modules where key = 'membership_instalments'), false) then$p$]);

-- 3. a care voucher can never be a Membership
create function private.care_vouchers_not_membership() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.sku_code ~* 'membership' or coalesce(new.sku_name, '') ~* 'membership|evergreen' then
    raise exception 'care_voucher_cannot_be_membership' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function private.care_vouchers_not_membership() from public, anon, authenticated;
create trigger care_vouchers_not_membership before insert or update of sku_code, sku_name on public.care_vouchers
  for each row execute function private.care_vouchers_not_membership();

-- 4. reminders carry the tier
select pg_temp.patch_fn('private.queue_membership_renewal_reminders()'::regprocedure, array[
  $p$select m.id, m.patient_id, m.organisation_id, m.ends_at, m.source from public.patient_memberships m$p$,
  $p$select m.id, m.patient_id, m.organisation_id, m.ends_at, m.source, m.tier from public.patient_memberships m$p$,
  $p$'days_before', v_due));$p$,
  $p$'days_before', v_due, 'tier', r.tier));$p$]);

-- 5. employer seats price per code: a code without an active limits row has no organisation price
select pg_temp.patch_fn('private.organisation_member_prices_guard()'::regprocedure, array[
  $p$from public.organisation_price_limits where is_active;$p$,
  $p$from public.organisation_price_limits l
    where l.is_active and l.rules ->> 'item_code' = (select c.code from public.catalog_items c where c.id = new.catalog_item_id);$p$]);

-- 6. admin grant with a tier
create function public.grant_membership_tier(p_patient uuid, p_tier text, p_reason text, p_ends_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if p_tier is null or p_tier not in ('evergreen', 'plus') then raise exception 'membership_tier_invalid' using errcode = '22023'; end if;
  -- every authorisation, reason and overlap rule is grant_membership's own
  v_id := public.grant_membership(p_patient, p_reason, p_ends_at);
  update public.patient_memberships set tier = p_tier where id = v_id;
  return v_id;
end $$;
revoke all on function public.grant_membership_tier(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.grant_membership_tier(uuid, text, text, timestamptz) to authenticated;

do $$
begin
  if pg_get_functiondef('public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure) not ilike '%membership_tier_for_item(it.code) = ''plus''%'
     or pg_get_functiondef('private.record_instalment_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure) not ilike '%membership_tier_for_item(it.code) = ''plus''%'
     or pg_get_functiondef('public.respond_to_gifted_pack(uuid,boolean)'::regprocedure) not ilike '%membership_tier_for_item(it.code) = ''plus''%' then
    raise exception 'followups: an extension path does not keep the larger tier';
  end if;
  if pg_get_functiondef('public.create_instalment_order(text,uuid,integer)'::regprocedure) not ilike '%membership_two_member_tiers%' then raise exception 'followups: instalment guard missing'; end if;
  if pg_get_functiondef('private.queue_membership_renewal_reminders()'::regprocedure) not ilike '%''tier'', r.tier%' then raise exception 'followups: reminder payload has no tier'; end if;
  if has_function_privilege('anon', 'public.grant_membership_tier(uuid,text,text,timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'private.care_vouchers_not_membership()', 'EXECUTE') then
    raise exception 'followups: a new function is callable by anon';
  end if;
end $$;
