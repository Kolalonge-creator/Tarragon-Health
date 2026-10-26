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
-- NOT covered (OQ-PLUS-1): Plus given without a checkout (an employer seat, an admin grant, a gift accepted later) carries no state.
-- Live counts before: orders 0, patient_memberships with tier plus and a purchase source: see the proof; the tier module is OFF.
-- ROLLBACK: recreate create_order(text,uuid,uuid,text,boolean,bigint) from 20261026135940 and drop the two columns.

alter table public.orders add column collection_state text references public.service_regions (state) on update cascade;
alter table public.patient_memberships add column collection_state text references public.service_regions (state) on update cascade;
comment on column public.orders.collection_state is 'Only for a Membership Plus order (or the upgrade): the approved state the buyer chose for Tarragon-arranged blood collection.';
comment on column public.patient_memberships.collection_state is 'The state fixed when Membership Plus was bought. Blood collection is only arranged here; a member who moves travels back.';

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
    $r$  v_prog uuid;
begin$r$,
    $r$  v_prog uuid;
  v_state text;
begin$r$,
    $r$  v_due := (q ->> 'amount_due_kobo')::bigint;$r$,
    $r$  -- Membership Plus (and the upgrade to it) is bought for a state where Tarragon collects blood. Only while the two-tier module is on.
  v_state := nullif(btrim(coalesce(p_collection_state, '')), '');
  if it.code in ('membership_annual', 'membership_upgrade_plus')
     and coalesce((select is_enabled from public.platform_modules where key = 'membership_two_member_tiers'), false) then
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

do $$
begin
  if to_regprocedure('public.create_order(text,uuid,uuid,text,boolean,bigint)') is not null then raise exception 'plus checkout: the old create_order still exists'; end if;
  if has_function_privilege('anon', 'public.create_order(text,uuid,uuid,text,boolean,bigint,text)', 'EXECUTE') then raise exception 'plus checkout: anon can call create_order'; end if;
  if not has_function_privilege('authenticated', 'public.create_order(text,uuid,uuid,text,boolean,bigint,text)', 'EXECUTE') then raise exception 'plus checkout: signed-in users cannot call create_order'; end if;
  if pg_get_functiondef('public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure) not ilike '%o.collection_state%'
     or pg_get_functiondef('public.my_membership()'::regprocedure) not ilike '%collection_state%'
     or pg_get_functiondef('public.create_order(text,uuid,uuid,text,boolean,bigint,text)'::regprocedure) not ilike '%plus_state_required%' then
    raise exception 'plus checkout: a patched function does not carry the change';
  end if;
end $$;
