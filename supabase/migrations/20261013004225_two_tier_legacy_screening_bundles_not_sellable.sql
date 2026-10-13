-- Two-tier decisions, item 8 (CMO, 2026-10-08): the legacy screening bundles that duplicate the Membership annual test are
-- no longer sellable. NOT repriced: prices are left exactly as they are (history stays truthful).
--
-- WHICH. screen_core, screen_advanced, screen_comprehensive (named by the CMO) and screen_essential (same annual_core family,
-- a subset of the same blood tests), plus annual_health_check, health_check_basic and health_check_comprehensive (older
-- annual-check bundles, already inactive but still self_bookable). The Membership annual panel (membership_annual) is the
-- one annual test from here on.
--
-- WHERE THE PURCHASE PATH IS. Read from the live function bodies (not guessed): every patient purchase route asks
-- panel_bundles.self_bookable. public.purchase_care_voucher and public.sponsor_book_care refuse a bundle that is not
-- self_bookable; private.enforce_lab_order_origin refuses a patient-initiated order for a bundle that is not self_bookable
-- unless it matches a due single-test screening; public.request_screening_day / confirm_screening_day check the same flag.
-- So self_bookable = false closes every patient route in the database, not just the screen. is_active is also cleared.
-- A clinician can still order the individual tests (clinician orders do not use the bundle flag), which is intended.
-- is_screen_tier is NOT changed: handle_screen_tier_resulted, the subscriber discount and the screening link read it for
-- orders already placed, and clearing it would change what happens to results that are already in flight.
--
-- A CHECK constraint now keeps them off: nobody can flip them back on by an UPDATE without first dropping the constraint on
-- purpose.
--
-- LIVE COUNTS BEFORE (2026-10-12), of the 7 bundles: all 7 were self_bookable and 2 were active (screen_core at 24,650,000
-- kobo and screen_essential at 18,100,000 kobo); the other 5 were already inactive but still bookable. Rows referencing them:
-- care_vouchers 0, lab_orders 0, screening_days 0, chronic_programme_schedule_templates 0. service_products and catalog_items
-- hold none of these codes. So this is a pure structural change: no voucher, order or day needs converting or refunding.

-- Dependent objects scanned (function bodies, \y word boundaries): enforce_lab_order_origin, purchase_care_voucher,
-- sponsor_book_care, request_screening_day, confirm_screening_day (all read self_bookable and keep working: they now refuse
-- these bundles); handle_screen_tier_resulted, link_screen_order_to_annual_check (name the codes, read for existing orders,
-- unchanged); annotate_screening_order_exclusions, apply_screening_subscriber_discount (read is_screen_tier, unchanged).

update public.panel_bundles
   set is_active = false, self_bookable = false
 where code in ('screen_core', 'screen_essential', 'screen_advanced', 'screen_comprehensive',
                'annual_health_check', 'health_check_basic', 'health_check_comprehensive');

alter table public.panel_bundles add constraint panel_bundles_membership_duplicates_not_sellable
  check (code not in ('screen_core', 'screen_essential', 'screen_advanced', 'screen_comprehensive',
                      'annual_health_check', 'health_check_basic', 'health_check_comprehensive')
         or (not is_active and not self_bookable));

do $$
declare v_still integer; v_missing integer; v_refs bigint;
begin
  select count(*) into v_still from public.panel_bundles
   where code in ('screen_core', 'screen_essential', 'screen_advanced', 'screen_comprehensive', 'annual_health_check', 'health_check_basic', 'health_check_comprehensive')
     and (is_active or self_bookable);
  if v_still <> 0 then raise exception 'item 8: % legacy bundles are still sellable', v_still; end if;
  select 7 - count(*) into v_missing from public.panel_bundles
   where code in ('screen_core', 'screen_essential', 'screen_advanced', 'screen_comprehensive', 'annual_health_check', 'health_check_basic', 'health_check_comprehensive');
  if v_missing <> 0 and current_database() = 'postgres' and exists (select 1 from public.panel_bundles where code = 'screen_core') then
    raise exception 'item 8: % of the 7 named bundles are missing', v_missing;
  end if;
  -- the other self-bookable bundles were not touched
  if not exists (select 1 from public.panel_bundles where self_bookable and is_active and code not in
       ('screen_core', 'screen_essential', 'screen_advanced', 'screen_comprehensive', 'annual_health_check', 'health_check_basic', 'health_check_comprehensive')) then
    raise exception 'item 8: no other self-bookable bundle remains, the change was too wide';
  end if;
  -- prices untouched: screen_core keeps its list price
  if exists (select 1 from public.panel_bundles where code = 'screen_core' and price_kobo <> 24650000) then
    raise exception 'item 8: a price changed';
  end if;
  -- the constraint refuses re-enabling
  begin
    update public.panel_bundles set self_bookable = true where code = 'screen_core';
    raise exception 'item 8: the constraint did not refuse re-enabling';
  exception when check_violation then null;
  end;
  -- the purchase RPC refuses (checked on the flag it reads)
  select count(*) into v_refs from public.panel_bundles where code = 'screen_core' and self_bookable;
  if v_refs <> 0 then raise exception 'item 8: screen_core is still bookable'; end if;
end $$;
