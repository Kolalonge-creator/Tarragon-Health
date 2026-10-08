-- S47e (code review findings 1 and 6, founder two-tier model 2026-10-08). Nothing signed, nothing applied to production, no payment touched.
--
-- THE MODEL (founder, 2026-10-08): there are only TWO patient tiers.
--   FREE   technology only: no human time and no services.
--   MEMBER 120,000 naira a year (12,000,000 kobo): ONE annual blood test covering everything Tarragon wants to check annually, plus a doctor following up
--          about once a month. (Medicines are not included.)
--   BOTH tiers get preventive health alerts (cancer screening due, immunisations due, and so on). Those are not behind any plan or entitlement; see the proof
--   s47_two_tier_model.sql, which scans the reminder and calendar functions and fails if one ever consults a plan, an entitlement or a membership.
--
-- WHAT CHANGES HERE
--   1. The separate Essential / Core / Advanced / Comprehensive screens (and the older Annual Health Check bundles) are no longer a purchase path: the annual
--      blood test is part of Membership. They are NOT repriced. They are flagged legacy_tier, kept guidance_only (never billed), made not self-bookable, and a
--      trigger now refuses to let a legacy bundle become purchasable or bookable again. Their descriptions say the annual blood test is part of Membership.
--      The four S45 "packages" over them are switched off. No home collection can exist for a bundle that cannot be ordered.
--   2. Imaging (abdominal ultrasound, breast imaging, prostate ultrasound) is removed from the Comprehensive bundle's contents and from every bundle description
--      (finding 6). Tarragon does not sell imaging; the advanced-diagnostics page says so.
--   3. The Membership price is a CATALOGUE ROW with versions (public.prices). A new version at 12,000,000 kobo is added from the moment this migration is applied;
--      the 10,000,000 kobo version is closed, not edited (a price is a fact about a time range). Orders already placed keep the amount they recorded. The
--      checkout itself is still dormant behind the v5_checkout module, and no Paystack object is touched. FLAGGED for the founder: OQ-S47-12.
--
-- Counts first: panel_bundles carries 0 purchasable rows today (every bundle is guidance_only), so flagging the legacy ones changes nothing that can be bought;
-- prices holds one open version for membership_annual (10,000,000 kobo, "Seeded by S25") and, on production, 0 paid non-test orders at the last count.

alter table public.panel_bundles add column legacy_tier boolean not null default false;
comment on column public.panel_bundles.legacy_tier is 'S47e: true for the screening-tier and annual-health-check bundles that Membership replaced. A legacy bundle is never purchasable and never self-bookable (trigger panel_bundles_legacy_never_purchasable).';

update public.panel_bundles
   set legacy_tier = true, self_bookable = false, guidance_only = true
 where code in ('screen_essential', 'screen_core', 'screen_advanced', 'screen_comprehensive', 'annual_health_check', 'health_check_basic', 'health_check_comprehensive');

-- imaging is not part of any bundle
update public.panel_bundles
   set test_codes = array(select t from unnest(test_codes) t where t not in ('abdominal_ultrasound', 'breast_imaging', 'prostate_ultrasound', 'mammography'))
 where test_codes && array['abdominal_ultrasound', 'breast_imaging', 'prostate_ultrasound', 'mammography'];

update public.panel_bundles set description = 'The annual blood test is part of Tarragon Membership, so this screen is no longer sold on its own. Your Membership includes one yearly blood test covering what we check each year.'
 where code in ('screen_essential', 'screen_core', 'screen_advanced', 'screen_comprehensive', 'annual_health_check', 'health_check_basic', 'health_check_comprehensive');

update public.screening_packages set is_active = false where code in ('essential', 'preventive', 'full_screen', 'annual_health_check');

create function private.panel_bundles_legacy_never_purchasable() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.legacy_tier and (new.self_bookable or not new.guidance_only) then
    raise exception 'legacy_bundle_not_purchasable: % is replaced by Membership and cannot be sold or booked', new.code using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.panel_bundles_legacy_never_purchasable() from public, anon, authenticated;
create trigger panel_bundles_legacy_never_purchasable before insert or update on public.panel_bundles
  for each row execute function private.panel_bundles_legacy_never_purchasable();

-- ---------------------------------------------------------------------------
-- The Membership price: a new catalogue version, 12,000,000 kobo
-- ---------------------------------------------------------------------------
do $$
declare v_item record; v_old public.prices%rowtype; v_orders integer;
begin
  for v_item in select id, organisation_id from public.catalog_items where code = 'membership_annual' loop
    select * into v_old from public.prices where catalog_item_id = v_item.id and valid_to is null;
    if found and v_old.amount_kobo = 12000000 then continue; end if;
    select count(*) into v_orders from public.orders o where o.catalog_item_id = v_item.id and o.state = 'paid' and not o.is_test;
    if found then
      update public.prices set valid_to = now() where id = v_old.id;
    end if;
    insert into public.prices (organisation_id, catalog_item_id, amount_kobo, valid_from, reason)
    values (v_item.organisation_id, v_item.id, 12000000, now(), 'Founder two-tier model 2026-10-08: Membership 120,000 naira a year (one annual blood test + a doctor about monthly). Previous version 10,000,000 kobo closed, not edited. ' || v_orders || ' paid non-test order(s) kept their recorded amount.');
  end loop;
end $$;

do $$
begin
  if exists (select 1 from public.panel_bundles where legacy_tier and (self_bookable or not guidance_only)) then raise exception 'S47e: a legacy bundle is purchasable'; end if;
  if exists (select 1 from public.panel_bundles where test_codes && array['abdominal_ultrasound', 'breast_imaging', 'prostate_ultrasound']) then raise exception 'S47e: a bundle still contains imaging'; end if;
  if exists (select 1 from public.panel_bundles where description ~* '(ultrasound|imaging|mammogra)') then raise exception 'S47e: a bundle description still promises imaging'; end if;
  if exists (select 1 from public.catalog_items i where i.code = 'membership_annual' and not exists (select 1 from public.prices p where p.catalog_item_id = i.id and p.valid_to is null and p.amount_kobo = 12000000)) then
    raise exception 'S47e: the Membership price is not 12,000,000 kobo';
  end if;
end $$;
