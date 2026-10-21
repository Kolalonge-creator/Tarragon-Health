-- Evergreen to Evergreen Plus upgrade, and the platform switch for the two paid tiers (founder decision 2026-10-21,
-- docs/DECISIONS.md; build brief steps 2 and 5). Applies after 20261021110528_membership_evergreen_ladder_foundation.sql.
--
--   * platform module membership_two_member_tiers (OFF). create_order refuses the Evergreen item and the upgrade while it is off, on top
--     of those items being inactive.
--   * catalogue item membership_upgrade_plus (kind membership, inactive, 4,500,000 kobo = 45,000 naira): the flat difference between the
--     two prices, one named order, one Paystack payment. It is NOT a second Membership: paying it flips the buyer's existing active
--     Evergreen membership to Plus and changes nothing else (the end date is untouched), makes NO entitlement row (so outcome and
--     retention readers, which anchor on membership entitlements, never see a second membership) and stores NO balance (INV-09).
--     duration_days is 365 only because catalog_items_check demands a duration for kind membership; it is not used for the upgrade.
--   * who can buy it: the beneficiary themselves (never a gift), and only with a dated, current Evergreen membership. There is no
--     mid-year downgrade; a downgrade only happens at renewal.
--   * refund: the 21 day window already runs from the order's own paid_at (request_order_refund reads the item kind), so it runs from
--     the top-up date. Approving the refund puts the tier back to Evergreen and does NOT end the membership (decide_order_refund
--     only ends a membership when an entitlement exists, and the upgrade makes none).
--   * ledger: the amount is deferred revenue (2000) like any Membership, but recognised over the days left in the membership, not 365.
-- Functions are patched from their LIVE definitions (pg_get_functiondef), each fragment checked to match the stated number of times.
-- NOT here: gifting the upgrade (the brief's optional "gift the blood test"), the instalment route (a later migration rejects
--   Membership items there), the checkout screen. A panel already delivered when an upgrade is refunded is an open item (TT-6).
-- ROLLBACK: restore the four function bodies from the previous migrations, delete the module row and the upgrade item (no orders yet).

insert into public.platform_modules (key, label, description, is_enabled)
values ('membership_two_member_tiers', 'Two paid Membership tiers (Evergreen, Evergreen Plus)',
        'When on, the Evergreen item and the Evergreen to Evergreen Plus upgrade can be bought. Off until the launch conditions in docs/DECISIONS.md (2026-10-21) are met: the CMO baseline-labs rule, an independent CMO, one live Paystack payment and refund.',
        false)
on conflict (key) do nothing;

insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, included_keys, duration_days, uses, grants_lead, active, note, audience)
select c.organisation_id, 'membership_upgrade_plus', 'membership', 'catalog.membership_upgrade_plus.name', 'catalog.membership_upgrade_plus.description',
       array['catalog.membership_upgrade_plus.incl.1'], 365, null, false, false,
       'Evergreen to Evergreen Plus (founder decision 2026-10-21): the flat difference, one order, end date unchanged, no stored balance. Inactive until the tier module is on.', 'patient'
  from public.catalog_items c
 where c.code = 'membership_annual'
   and not exists (select 1 from public.catalog_items x where x.organisation_id = c.organisation_id and x.code = 'membership_upgrade_plus');

insert into public.prices (organisation_id, catalog_item_id, amount_kobo, valid_from, reason)
select i.organisation_id, i.id, 4500000, now(),
       'Founder decision 2026-10-21: the upgrade from Evergreen to Evergreen Plus is the flat difference, 45,000 naira.'
  from public.catalog_items i
 where i.code = 'membership_upgrade_plus'
   and not exists (select 1 from public.prices p where p.catalog_item_id = i.id and p.valid_to is null);

create or replace function pg_temp.patch_fn(p_sig regprocedure, p_pairs text[], p_counts integer[] default null) returns void language plpgsql as $f$
declare d text := pg_get_functiondef(p_sig); i integer := 1; n integer; want integer;
begin
  while i < array_length(p_pairs, 1) loop
    n := (length(d) - length(replace(d, p_pairs[i], ''))) / length(p_pairs[i]);
    want := coalesce(p_counts[(i + 1) / 2], 1);
    if n <> want then raise exception 'upgrade patch of % expected % match(es) for [%], found %', p_sig, want, p_pairs[i], n; end if;
    d := replace(d, p_pairs[i], p_pairs[i + 1]);
    i := i + 2;
  end loop;
  execute d;
end $f$;

-- Payment: the upgrade completes here, before any entitlement or membership row would be made
select pg_temp.patch_fn('public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure, array[
  $p$select * into it from public.catalog_items where id = o.catalog_item_id;$p$,
  $p$select * into it from public.catalog_items where id = o.catalog_item_id;
  -- Evergreen to Evergreen Plus: flip the tier of the current Evergreen membership, nothing else. No entitlement, no new membership row.
  if it.code = 'membership_upgrade_plus' then
    update public.patient_memberships set tier = 'plus'
     where patient_id = o.beneficiary_patient_id and state = 'active' and tier = 'evergreen' and (ends_at is null or ends_at > now());
    if not found then
      perform private.order_incident(o.organisation_id, 'order-upgrade-no-evergreen:' || o.id, 'An upgrade was paid with no Evergreen membership to upgrade',
        'Order ' || o.id || ' was paid but the patient has no current Evergreen membership, so nothing was upgraded. Refund the payment.');
    end if;
    perform private.emit_domain_event('order.paid', o.organisation_id,
      jsonb_build_object('order_id', o.id, 'kind', 'membership_upgrade', 'code', it.code),
      'order:' || o.id, o.beneficiary_patient_id, 'order', o.id);
    perform private.post_order_safely(o.id);
    return jsonb_build_object('result', 'paid', 'order_id', o.id, 'entitlement_id', null);
  end if;$p$]);

-- Ledger: recognise the upgrade over the days left in the membership, not 365
select pg_temp.patch_fn('private.post_order_to_ledger(uuid,boolean)'::regprocedure, array[
  $p$v_date + it.duration_days);$p$,
  $p$v_date + case when it.code = 'membership_upgrade_plus'
                      then greatest(1, coalesce((select (m.ends_at at time zone 'Africa/Lagos')::date - v_date from public.patient_memberships m
                                                  where m.patient_id = o.beneficiary_patient_id and m.ends_at is not null
                                                  order by m.starts_at desc limit 1), it.duration_days))
                      else it.duration_days end);$p$]);

-- Refund: an approved upgrade refund puts the tier back to Evergreen; the membership itself keeps running
select pg_temp.patch_fn('public.decide_order_refund(uuid,boolean,text)'::regprocedure, array[
  $p$select * into e from public.entitlements where order_id = r.order_id and state = 'active';$p$,
  $p$select * into e from public.entitlements where order_id = r.order_id and state = 'active';
  if exists (select 1 from public.catalog_items ci where ci.id = o.catalog_item_id and ci.code = 'membership_upgrade_plus') then
    update public.patient_memberships set tier = 'evergreen'
     where patient_id = o.beneficiary_patient_id and state = 'active' and tier = 'plus';
  end if;$p$]);

-- Create: the module switch for the two new items, and the upgrade rules
select pg_temp.patch_fn('public.create_order(text,uuid,uuid,text,boolean,bigint)'::regprocedure, array[
  $p$if it.kind = 'membership' and exists ($p$,
  $p$if it.kind = 'membership' and it.code <> 'membership_upgrade_plus' and exists ($p$,
  $p$if private.current_price(it.id) is null then raise exception 'item_not_available' using errcode = 'P0001'; end if;$p$,
  $p$if private.current_price(it.id) is null then raise exception 'item_not_available' using errcode = 'P0001'; end if;
  if it.code in ('membership_annual_no_panel', 'membership_upgrade_plus')
     and not coalesce((select is_enabled from public.platform_modules where key = 'membership_two_member_tiers'), false) then
    raise exception 'item_not_available' using errcode = 'P0001';
  end if;
  if it.code = 'membership_upgrade_plus' then
    if v_ben <> v_uid then raise exception 'gift_item_not_allowed' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.patient_memberships m
                    where m.patient_id = v_ben and m.state = 'active' and m.tier = 'evergreen' and m.ends_at is not null and m.ends_at > now()) then
      raise exception 'upgrade_not_available' using errcode = 'P0001';
    end if;
  end if;$p$]);

do $$
declare v_it uuid;
begin
  select id into v_it from public.catalog_items where code = 'membership_upgrade_plus' order by created_at limit 1;
  if v_it is not null then
    if (select amount_kobo from public.prices where catalog_item_id = v_it and valid_to is null) <> 4500000 then raise exception 'upgrade: price is not 4,500,000 kobo'; end if;
    if (select active from public.catalog_items where id = v_it) then raise exception 'upgrade: the item must be inactive until the module is on'; end if;
    if (select p.amount_kobo from public.prices p join public.catalog_items c on c.id = p.catalog_item_id where c.code = 'membership_annual' and p.valid_to is null)
       - (select p.amount_kobo from public.prices p join public.catalog_items c on c.id = p.catalog_item_id where c.code = 'membership_annual_no_panel' and p.valid_to is null) <> 4500000 then
      raise exception 'upgrade: the price is not the difference between the two tiers';
    end if;
  end if;
  if coalesce((select is_enabled from public.platform_modules where key = 'membership_two_member_tiers'), true) then raise exception 'upgrade: the tier module must start OFF'; end if;
  if pg_get_functiondef('public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure) not ilike '%membership_upgrade_plus%'
     or pg_get_functiondef('private.post_order_to_ledger(uuid,boolean)'::regprocedure) not ilike '%membership_upgrade_plus%'
     or pg_get_functiondef('public.decide_order_refund(uuid,boolean,text)'::regprocedure) not ilike '%membership_upgrade_plus%'
     or pg_get_functiondef('public.create_order(text,uuid,uuid,text,boolean,bigint)'::regprocedure) not ilike '%membership_two_member_tiers%' then
    raise exception 'upgrade: a patched function does not carry the change';
  end if;
end $$;
