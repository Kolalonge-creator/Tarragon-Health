-- Membership Plus checkout: the buyer chooses an approved collection state before paying (founder decision 2026-10-26, docs/DECISIONS.md).
-- Applies after 20261026155002_annual_bundle_review_fixes.sql and the Membership ladder (20261021110528 and its follow-ups).
--
--   * create_order gains a trailing p_collection_state (default null). While the platform module membership_two_member_tiers is ON, buying
--     Membership Plus (membership_annual) or the Membership to Plus upgrade (membership_upgrade_plus) needs a state that an admin has
--     approved for Plus (service_regions.plus_collection_enabled): plus_state_required / plus_state_not_available otherwise. Any other item,
--     and every item while the module is off, ignores the argument (the state is stored only on a Plus order).
--   * The state is written on the order, and copied to the membership the payment creates or upgrades (patient_memberships.collection_state).
--     It is fixed at registration: a Plus holder who later moves travels to an approved state; they are not refunded or switched (founder).
--   * Both columns reference service_regions(state), so only a real state can be stored. my_membership returns the state.
--   * The one-argument-shorter create_order is dropped, not overloaded, so a bare call can never be ambiguous.
--   * A retry that names a DIFFERENT state than the order it replays is refused (plus_state_changed), so a changed choice can never pay for the old one.
--   * A gift accepted later and a sponsor-covered Plus order copy the order's state to the membership too.
--   * Plus cannot be requested through a supporter's payment link while the module is on (plus_needs_direct_checkout): the supporter cannot choose the state.
--   * A Plus order paid with no state (opened before the module was switched on) or for a state withdrawn since, raises an ops incident.
-- NOT covered (OQ-PLUS-1): Plus given without a checkout (an employer seat, an admin grant, a legacy conversion) carries no state.
-- Live counts before: orders 0, patient_memberships with tier plus and a purchase source: see the proof; the tier module is OFF.
-- ROLLBACK: recreate create_order(text,uuid,uuid,text,boolean,bigint) from 20261026135940 and drop the two columns.

alter table public.orders add column collection_state text references public.service_regions (state);
alter table public.patient_memberships add column collection_state text references public.service_regions (state);
comment on column public.orders.collection_state is 'Only for a Membership Plus order (or the upgrade): the approved state the buyer chose for Tarragon-arranged blood collection.';
comment on column public.patient_memberships.collection_state is 'The state fixed when Membership Plus was bought. Blood collection is only arranged here; a member who moves travels back.';

create function private.plus_needs_state(p_code text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_code in ('membership_annual', 'membership_upgrade_plus')
     and coalesce((select is_enabled from public.platform_modules where key = 'membership_two_member_tiers'), false)
$$;
revoke all on function private.plus_needs_state(text) from public, anon, authenticated;

create or replace function pg_temp.patch_text(p_text text, p_pairs text[], p_what text) returns text language plpgsql as $f$
declare d text := p_text; i integer := 1; n integer;
begin
  while i < array_length(p_pairs, 1) loop
    n := (length(d) - length(replace(d, p_pairs[i], ''))) / length(p_pairs[i]);
    if n <> 1 then raise exception 'plus checkout patch of % expected 1 match for [%], found %', p_what, p_pairs[i], n; end if;
    d := replace(d, p_pairs[i], p_pairs[i + 1]);
    i := i + 2;
  end loop;
  return d;
end $f$;

do $mig$
declare d text := pg_get_functiondef('public.create_order(text,uuid,uuid,text,boolean,bigint)'::regprocedure);
begin
  d := pg_temp.patch_text(d, array[
    $r$p_expected_amount_kobo bigint DEFAULT NULL::bigint)$r$,
    $r$p_expected_amount_kobo bigint DEFAULT NULL::bigint, p_collection_state text DEFAULT NULL::text)$r$,
    $r$    if found then
      return private.order_replay_reply(o);$r$,
    $r$    if found then
      -- a retry that names a different state than the order it replays would otherwise pay for the old one
      if o.collection_state is not null and o.collection_state is distinct from nullif(btrim(coalesce(p_collection_state, '')), '') then
        raise exception 'plus_state_changed' using errcode = 'P0001';
      end if;
      return private.order_replay_reply(o);$r$,
    $r$  v_prog uuid;
begin$r$,
    $r$  v_prog uuid;
  v_state text;
begin$r$,
    $r$  v_due := (q ->> 'amount_due_kobo')::bigint;$r$,
    $r$  -- Membership Plus (and the upgrade to it) is bought for a state where Tarragon collects blood. Only while the two-tier module is on.
  v_state := nullif(btrim(coalesce(p_collection_state, '')), '');
  if private.plus_needs_state(it.code) then
    if v_state is null then raise exception 'plus_state_required' using errcode = 'P0001'; end if;
    if not private.plus_collection_state_enabled(v_state) then raise exception 'plus_state_not_available' using errcode = 'P0001'; end if;
  else
    v_state := null;
  end if;

  v_due := (q ->> 'amount_due_kobo')::bigint;$r$,
    $r$price_book_entry_id, pricing_rules_version, quote)$r$,
    $r$price_book_entry_id, pricing_rules_version, quote, collection_state)$r$,
    $r$(q ->> 'price_book_entry_id')::uuid, (q ->> 'pricing_rules_version')::integer, q)$r$,
    $r$(q ->> 'price_book_entry_id')::uuid, (q ->> 'pricing_rules_version')::integer, q, v_state)$r$
  ], 'create_order');
  drop function public.create_order(text, uuid, uuid, text, boolean, bigint);
  execute d;
end $mig$;
revoke all on function public.create_order(text, uuid, uuid, text, boolean, bigint, text) from public, anon;
grant execute on function public.create_order(text, uuid, uuid, text, boolean, bigint, text) to authenticated;

do $mig$
declare d text;
begin
  d := pg_temp.patch_text(pg_get_functiondef('public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure), array[
    $r$select * into it from public.catalog_items where id = o.catalog_item_id;$r$,
    $r$select * into it from public.catalog_items where id = o.catalog_item_id;
  -- Plus must carry an approved state. An order opened before the module was switched on, or a state withdrawn since the order was made, needs a person.
  if private.plus_needs_state(it.code) and o.collection_state is null then
    perform private.order_incident(o.organisation_id, 'order-plus-no-state:' || o.id, 'A Membership Plus order was paid with no collection state',
      'Order ' || o.id || ' was paid for Membership Plus but carries no blood-collection state (it was opened before Plus needed one). Ask the member which approved state they want and record it.');
  elsif o.collection_state is not null and not private.plus_collection_state_enabled(o.collection_state) then
    perform private.order_incident(o.organisation_id, 'order-plus-state-withdrawn:' || o.id, 'A Membership Plus order was paid for a state that is no longer approved',
      'Order ' || o.id || ' was paid for ' || o.collection_state || ', which was withdrawn from Plus after the order was made. Contact the member to agree another approved state.');
  end if;$r$,
    'insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test, tier)',
    'insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test, tier, collection_state)',
    'o.is_test, private.membership_tier_for_item(it.code));',
    'o.is_test, private.membership_tier_for_item(it.code), o.collection_state);',
    'update public.patient_memberships set tier = ''plus'' where id = v_up;',
    'update public.patient_memberships set tier = ''plus'', collection_state = o.collection_state where id = v_up;'
  ], 'record_order_payment');
  execute d;
  d := pg_temp.patch_text(pg_get_functiondef('public.my_membership()'::regprocedure), array[
    '''source'', m.source, ''tier'', m.tier,',
    '''source'', m.source, ''tier'', m.tier, ''collection_state'', m.collection_state,'
  ], 'my_membership');
  execute d;
end $mig$;

do $mig$
declare p record;
begin
  -- a sponsor-covered Plus order and a gift accepted later carry the state the buyer chose
  execute pg_temp.patch_text(pg_get_functiondef('private.settle_sponsor_order(uuid)'::regprocedure), array[
    $r$insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test, tier)$r$,
    $r$insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test, tier, collection_state)$r$,
    $r$o.is_test, private.membership_tier_for_item(it.code));$r$,
    $r$o.is_test, private.membership_tier_for_item(it.code), o.collection_state);$r$], 'settle_sponsor_order');
  execute pg_temp.patch_text(pg_get_functiondef('public.respond_to_gifted_pack(uuid,boolean)'::regprocedure), array[
    $r$insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test, tier)$r$,
    $r$insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test, tier, collection_state)$r$,
    $r$o.is_test, private.membership_tier_for_item(it.code));$r$,
    $r$o.is_test, private.membership_tier_for_item(it.code), o.collection_state);$r$], 'respond_to_gifted_pack');
  -- Plus cannot be bought through a supporter's link: the supporter cannot choose the state
  for p in select oid from pg_proc where proname = 'create_payment_request' and pronamespace = 'public'::regnamespace loop
    execute pg_temp.patch_text(pg_get_functiondef(p.oid), array[
      $r$  if not private.gift_item_allowed(it.kind::text, it.duration_days) then raise exception 'gift_item_not_allowed' using errcode = 'P0001'; end if;$r$,
      $r$  if not private.gift_item_allowed(it.kind::text, it.duration_days) then raise exception 'gift_item_not_allowed' using errcode = 'P0001'; end if;
  if private.plus_needs_state(it.code) then raise exception 'plus_needs_direct_checkout' using errcode = 'P0001'; end if;$r$], 'create_payment_request');
  end loop;
  for p in select oid from pg_proc where proname = 'create_request_order' and pronamespace = 'public'::regnamespace loop
    execute pg_temp.patch_text(pg_get_functiondef(p.oid), array[
      $r$  if not it.active or it.audience <> 'patient' or private.current_price(it.id) is null then raise exception 'item_not_available' using errcode = 'P0001'; end if;$r$,
      $r$  if not it.active or it.audience <> 'patient' or private.current_price(it.id) is null then raise exception 'item_not_available' using errcode = 'P0001'; end if;
  if private.plus_needs_state(it.code) then raise exception 'plus_needs_direct_checkout' using errcode = 'P0001'; end if;$r$], 'create_request_order');
  end loop;
end $mig$;

do $$
begin
  if to_regprocedure('public.create_order(text,uuid,uuid,text,boolean,bigint)') is not null then raise exception 'plus checkout: the old create_order still exists'; end if;
  if has_function_privilege('anon', 'public.create_order(text,uuid,uuid,text,boolean,bigint,text)', 'EXECUTE') then raise exception 'plus checkout: anon can call create_order'; end if;
  if not has_function_privilege('authenticated', 'public.create_order(text,uuid,uuid,text,boolean,bigint,text)', 'EXECUTE') then raise exception 'plus checkout: signed-in users cannot call create_order'; end if;
  if pg_get_functiondef('public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure) not ilike '%o.collection_state%'
     or pg_get_functiondef('public.my_membership()'::regprocedure) not ilike '%collection_state%'
     or pg_get_functiondef('public.create_order(text,uuid,uuid,text,boolean,bigint,text)'::regprocedure) not ilike '%plus_state_changed%'
     or pg_get_functiondef('private.settle_sponsor_order(uuid)'::regprocedure) not ilike '%o.collection_state%'
     or pg_get_functiondef('public.respond_to_gifted_pack(uuid,boolean)'::regprocedure) not ilike '%o.collection_state%'
     or not exists (select 1 from pg_proc p where p.proname = 'create_payment_request' and p.pronamespace = 'public'::regnamespace and pg_get_functiondef(p.oid) ilike '%plus_needs_direct_checkout%')
     or not exists (select 1 from pg_proc p where p.proname = 'create_request_order' and p.pronamespace = 'public'::regnamespace and pg_get_functiondef(p.oid) ilike '%plus_needs_direct_checkout%')
     or pg_get_functiondef('public.create_order(text,uuid,uuid,text,boolean,bigint,text)'::regprocedure) not ilike '%plus_state_required%' then
    raise exception 'plus checkout: a patched function does not carry the change';
  end if;
end $$;
