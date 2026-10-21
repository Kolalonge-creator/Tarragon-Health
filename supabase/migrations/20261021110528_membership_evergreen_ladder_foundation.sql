-- NOTE on the version: it sorts after 20261021110417 on purpose. s25b and money_reconciliation carry versions ahead of the database clock,
-- and s25b redefines record_order_payment, so this patch must replay after it or it would be overwritten.
-- Evergreen ladder, foundation (founder decision 2026-10-21, docs/DECISIONS.md "Three-tier annual-only membership"; build brief
-- docs/plans/three-tier-membership-build-brief.md steps 1, 2, 3 and 11).
--
-- Two paid tiers, both a "Member" for every safety purpose, billed once a year:
--   Evergreen       membership_annual_no_panel   NGN  84,000 (8,400,000 kobo)   everything in the Membership EXCEPT the annual blood panel
--   Evergreen Plus  membership_annual            NGN 129,000 (12,900,000 kobo)  the Membership INCLUDING the annual blood panel
-- The existing code membership_annual stays Evergreen Plus (it already includes the panel), so nothing existing is renamed.
--
-- What this migration does, and what it deliberately leaves for the next slices:
--   1. patient_memberships.tier ('evergreen' | 'plus'), default 'plus'. Every existing row is therefore grandfathered as Plus at the price
--      it was bought (step 11). Live count before (read-only, 2026-10-21): patient_memberships 2, both active, 0 paid by purchase.
--   2. private.membership_tier_for_item(code): membership_annual -> plus, anything else -> evergreen (the safe direction: an unknown
--      code never hands out the panel).
--   3. private.patient_membership_tier(patient): the tier of the person's current Membership (year plus grace), null for Free.
--      private.patient_is_member is NOT touched: it stays true for BOTH tiers, so the Free red path and every Member safety gate treat
--      Evergreen and Evergreen Plus identically (TT-5, TT-1).
--   4. The Evergreen catalogue item (inactive, like every item while v5_checkout is off) and the two new price rows. Prices are
--      versioned: the 12,000,000 kobo row of membership_annual is closed, never edited. The public marketing price stays the registry's
--      commerce.membership_prices until the pricing page is rewritten and the tier flag is switched on (nothing can be bought: the
--      item is inactive and v5_checkout is off).
--   5. Every path that creates a Membership row now stamps the tier from the item that was bought: record_order_payment (purchase),
--      record_instalment_payment (the instalment path, both inserts; being retired, brief step 9), settle_sponsor_order, respond_to_gifted_pack (gift accepted), grant_org_seat (employer seat). Each is patched from its LIVE
--      definition (pg_get_functiondef), with a check that the patched fragment was found exactly once.
--   6. The annual panel is only checked in for Evergreen Plus: check_in_testing_booking refuses an Evergreen member with
--      annual_panel_requires_plus. A clinically required test is never tier-gated (this guards the Membership panel only).
--   7. my_membership() also returns the tier.
-- NOT here: the checkout picker, the upgrade order, gift/sponsor tier choice, employer per-code prices, voucher layaway rejection and
-- renewal wording (later slices); the feature flag membership_two_member_tiers is added with the checkout slice. grant_membership
-- (admin grant) keeps creating Plus; a tier choice is added with the admin slice.
-- ROLLBACK: restore the function bodies from migrations 20261013012331 / s71 / s29b (see git), drop the two private functions,
--   drop column patient_memberships.tier, close the new price rows, delete the Evergreen catalogue item (it has no orders).

-- ---------------------------------------------------------------------------
-- 1. The tier on a Membership
-- ---------------------------------------------------------------------------
alter table public.patient_memberships add column tier text not null default 'plus';
alter table public.patient_memberships add constraint patient_memberships_tier_check check (tier in ('evergreen', 'plus'));
comment on column public.patient_memberships.tier is
  'evergreen = no annual blood panel; plus = with it. Both are a Member for every safety purpose (private.patient_is_member does not read this). Stamped from the item bought; existing rows are plus.';

-- ---------------------------------------------------------------------------
-- 2 and 3. Tier helpers
-- ---------------------------------------------------------------------------
create function private.membership_tier_for_item(p_code text) returns text
language sql immutable set search_path = ''
as $$ select case when p_code = 'membership_annual' then 'plus' else 'evergreen' end $$;
revoke all on function private.membership_tier_for_item(text) from public, anon, authenticated;

create function private.patient_membership_tier(p_patient uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select m.tier from public.patient_memberships m
    join public.profiles pr on pr.id = m.patient_id and pr.role = 'patient'
   where m.patient_id = p_patient and m.state = 'active' and m.starts_at <= now()
     and (m.ends_at is null or m.ends_at + make_interval(days => private.membership_grace_days()) > now())
   order by (m.tier = 'plus') desc, m.starts_at desc
   limit 1
$$;
revoke all on function private.patient_membership_tier(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Evergreen catalogue item and the two prices
-- ---------------------------------------------------------------------------
insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, included_keys, duration_days, uses, grants_lead, active, note, audience)
select c.organisation_id, 'membership_annual_no_panel', c.kind, 'catalog.membership_annual_no_panel.name', 'catalog.membership_annual_no_panel.description',
       array['catalog.membership_annual_no_panel.incl.1', 'catalog.membership_annual_no_panel.incl.2', 'catalog.membership_annual_no_panel.incl.3'],
       c.duration_days, c.uses, c.grants_lead, false,
       'Evergreen (founder decision 2026-10-21): the Membership without the annual blood panel. Inactive until the tier flag and v5_checkout are switched on.', c.audience
  from public.catalog_items c
 where c.code = 'membership_annual'
   and not exists (select 1 from public.catalog_items x where x.organisation_id = c.organisation_id and x.code = 'membership_annual_no_panel');

do $$
declare
  v_plus public.catalog_items%rowtype; v_eg public.catalog_items%rowtype; v_old public.prices%rowtype; v_now timestamptz := now();
begin
  select * into v_plus from public.catalog_items where code = 'membership_annual' order by created_at limit 1;
  select * into v_eg from public.catalog_items where code = 'membership_annual_no_panel' and organisation_id = v_plus.organisation_id;
  if v_plus.id is null or v_eg.id is null then return; end if;

  select * into v_old from public.prices where catalog_item_id = v_plus.id and valid_to is null;
  if not found or v_old.amount_kobo <> 12900000 then
    if found then
      v_now := greatest(v_now, v_old.valid_from + interval '1 microsecond');
      update public.prices set valid_to = v_now where id = v_old.id;
    end if;
    insert into public.prices (organisation_id, catalog_item_id, amount_kobo, valid_from, reason)
    values (v_plus.organisation_id, v_plus.id, 12900000, v_now,
            'Founder decision 2026-10-21: Evergreen Plus, 129,000 naira a year, with the annual blood panel. Replaces the 120,000 naira single-tier price.');
  end if;

  if not exists (select 1 from public.prices where catalog_item_id = v_eg.id and valid_to is null) then
    insert into public.prices (organisation_id, catalog_item_id, amount_kobo, valid_from, reason)
    values (v_eg.organisation_id, v_eg.id, 8400000, v_now,
            'Founder decision 2026-10-21: Evergreen, 84,000 naira a year, without the annual blood panel.');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5, 6, 7. Patch the live function bodies. Each replacement must match exactly once or the migration stops.
-- ---------------------------------------------------------------------------
create function pg_temp.patch_fn(p_sig regprocedure, p_pairs text[], p_counts integer[] default null) returns void language plpgsql as $f$
declare d text := pg_get_functiondef(p_sig); i integer := 1; n integer; want integer;
begin
  while i < array_length(p_pairs, 1) loop
    n := (length(d) - length(replace(d, p_pairs[i], ''))) / length(p_pairs[i]);
    want := coalesce(p_counts[(i + 1) / 2], 1);
    if n <> want then raise exception 'evergreen patch of % expected % match(es) for [%], found %', p_sig, want, p_pairs[i], n; end if;
    d := replace(d, p_pairs[i], p_pairs[i + 1]);
    i := i + 2;
  end loop;
  execute d;
end $f$;

select pg_temp.patch_fn('public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure, array[
  'insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test)',
  'insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test, tier)',
  'v_start + make_interval(days => it.duration_days), o.is_test);',
  'v_start + make_interval(days => it.duration_days), o.is_test, private.membership_tier_for_item(it.code));']);

select pg_temp.patch_fn('private.record_instalment_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure, array[
  'insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test)',
  'insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test, tier)',
  'v_start + make_interval(days => it.duration_days), o.is_test);',
  'v_start + make_interval(days => it.duration_days), o.is_test, private.membership_tier_for_item(it.code));',
  'now(), ent.ends_at, o.is_test);',
  'now(), ent.ends_at, o.is_test, private.membership_tier_for_item(it.code));'], array[2, 1, 1]);

select pg_temp.patch_fn('private.settle_sponsor_order(uuid)'::regprocedure, array[
  'insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test)',
  'insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test, tier)',
  'v_start + make_interval(days => it.duration_days), o.is_test);',
  'v_start + make_interval(days => it.duration_days), o.is_test, private.membership_tier_for_item(it.code));']);

select pg_temp.patch_fn('public.respond_to_gifted_pack(uuid,boolean)'::regprocedure, array[
  'insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test)',
  'insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test, tier)',
  'now() + make_interval(days => it.duration_days), o.is_test);',
  'now() + make_interval(days => it.duration_days), o.is_test, private.membership_tier_for_item(it.code));']);

select pg_temp.patch_fn('private.grant_org_seat(uuid)'::regprocedure, array[
  'insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test)',
  'insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test, tier)',
  'now(), v_ends, coalesce(v_is_test, false));',
  'now(), v_ends, coalesce(v_is_test, false), private.membership_tier_for_item(it.code));']);

select pg_temp.patch_fn('public.check_in_testing_booking(uuid)'::regprocedure, array[
  'if not private.patient_is_member(b.patient_id) then raise exception ''membership_required'' using errcode = ''42501''; end if;',
  'if not private.patient_is_member(b.patient_id) then raise exception ''membership_required'' using errcode = ''42501''; end if;
  -- Evergreen has no annual blood panel; only Evergreen Plus is checked in for it (a clinically required test is never gated by tier)
  if private.patient_membership_tier(b.patient_id) is distinct from ''plus'' then raise exception ''annual_panel_requires_plus'' using errcode = ''42501''; end if;']);

select pg_temp.patch_fn('public.my_membership()'::regprocedure, array[
  '''ends_at'', m.ends_at, ''source'', m.source,',
  '''ends_at'', m.ends_at, ''source'', m.source, ''tier'', m.tier,',
  '''source'', null, ''in_grace'', false',
  '''source'', null, ''tier'', null, ''in_grace'', false']);

-- ---------------------------------------------------------------------------
-- Closing self-check
-- ---------------------------------------------------------------------------
do $$
declare v_plus uuid; v_eg uuid;
begin
  if exists (select 1 from public.patient_memberships where tier <> 'plus' and created_at < now() - interval '1 second') then
    raise exception 'evergreen: a pre-existing membership was not grandfathered as plus';
  end if;
  if private.membership_tier_for_item('membership_annual') <> 'plus' or private.membership_tier_for_item('membership_annual_no_panel') <> 'evergreen'
     or private.membership_tier_for_item('anything_else') <> 'evergreen' then
    raise exception 'evergreen: tier mapping is wrong';
  end if;
  select id into v_plus from public.catalog_items where code = 'membership_annual' order by created_at limit 1;
  select id into v_eg from public.catalog_items where code = 'membership_annual_no_panel' order by created_at limit 1;
  if v_plus is not null then
    if (select amount_kobo from public.prices where catalog_item_id = v_plus and valid_to is null) <> 12900000 then raise exception 'evergreen: Plus price is not 12,900,000 kobo'; end if;
    if v_eg is null or (select amount_kobo from public.prices where catalog_item_id = v_eg and valid_to is null) <> 8400000 then raise exception 'evergreen: Evergreen price is not 8,400,000 kobo'; end if;
    if (select active from public.catalog_items where id = v_eg) then raise exception 'evergreen: the Evergreen item must be inactive until the flag is on'; end if;
  end if;
  if pg_get_functiondef('public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure) not ilike '%membership_tier_for_item%'
     or pg_get_functiondef('private.record_instalment_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure) not ilike '%membership_tier_for_item%'
     or pg_get_functiondef('private.settle_sponsor_order(uuid)'::regprocedure) not ilike '%membership_tier_for_item%'
     or pg_get_functiondef('public.respond_to_gifted_pack(uuid,boolean)'::regprocedure) not ilike '%membership_tier_for_item%'
     or pg_get_functiondef('private.grant_org_seat(uuid)'::regprocedure) not ilike '%membership_tier_for_item%'
     or pg_get_functiondef('public.check_in_testing_booking(uuid)'::regprocedure) not ilike '%annual_panel_requires_plus%' then
    raise exception 'evergreen: a patched function does not carry the tier change';
  end if;
  if pg_get_functiondef('private.patient_is_member_at(uuid,timestamptz)'::regprocedure) ilike '%tier%' then
    raise exception 'evergreen: patient_is_member must not read the tier';
  end if;
  if has_function_privilege('anon', 'private.patient_membership_tier(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.patient_membership_tier(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.membership_tier_for_item(text)', 'EXECUTE') then
    raise exception 'evergreen: a tier helper is callable by a client role';
  end if;
end $$;
