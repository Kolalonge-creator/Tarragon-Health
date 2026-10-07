-- Tarragon Health — Continuous Monitoring: 3/6/12-month tiers -> one 90-day
-- tier at ₦30,000.
--
-- Launch-scope audit reconciliation, 2026-09-22 (founder decision, see
-- docs/LAUNCH_SCOPE_AND_PLATFORM_REBUILD_AUDIT_2026-09-21.md §4.3/§6.1 and
-- the accompanying plan's "Decisions locked in" table). The audit argued a
-- single bounded term is easier to sell, staff and support than an open
-- choice of three; the founder accepted the single-90-day-tier shape but set
-- the actual price (₦30,000) rather than the audit's own figure.
--
-- WHY NO DATA MIGRATION
-- ----------------------
-- Live data checked before writing this migration (2026-09-22): exactly 2
-- active service_purchases rows reference continuous_monitoring_3m, both on
-- QA/seed profiles ("First Patient", "Test Free Patient"), both expiring
-- mid-December 2026 — disposable fixtures, not real patients. Zero rows
-- reference continuous_monitoring_6m or continuous_monitoring_12m. So this
-- is a pure structural change: deactivate, don't delete (service_products.
-- code is plain text, not an enum, so no enum-drop step applies either —
-- see CLAUDE.md's standing removal-pattern checklist), and
-- private.patient_has_feature_access never filters on service_products.
-- is_active (only on service_purchases.status/expires_at — confirmed by
-- reading its live definition before writing this), so the two QA purchases
-- keep resolving exactly as before even once their product is deactivated.
--
-- WHY NO CODE CHANGE TO THE ESCALATION GATE ITSELF
-- ---------------------------------------------------
-- access_duration_days on the product row drives service_purchases.
-- expires_at generically inside public.record_service_purchase_intent /
-- private.apply_service_purchase_payment — a new product row needs no
-- change to that path. subscription-manager.tsx, monitoring-cover-card.tsx
-- and mobile's monitoring-cover.ts all match on
-- `code.startsWith("continuous_monitoring_")`, so they need no change
-- either. Two call sites DO hardcode 'continuous_monitoring_3m' and are
-- fixed in the same PR at the application layer (chronic-programme-
-- actions.ts, guest-checkout-products.ts) — not in this migration, since
-- they are TypeScript, not SQL.
--
-- Deliberately NOT editing the DO-block assertion in this platform's earlier
-- 20260910011849_continuous_monitoring_cover.sql ("expected 3 active
-- Continuous Monitoring products") even though the plan that scoped this
-- work suggested doing so: that migration is already live in production,
-- and its assertion runs at ITS OWN point in migration order (before this
-- one), when all three tiers are still genuinely active — so it keeps
-- passing on a fresh replay without being touched. Editing an
-- already-applied migration file is the opposite of this codebase's own
-- standing convention (every other removal in CLAUDE.md's archive amends
-- forward with a new migration, never rewrites history) and would only
-- create a mismatch between the file's git history and what actually ran in
-- production. This migration's own assertions below prove the NEW state
-- instead.

begin;

insert into public.service_products
  (code, name, description, price_kobo, currency, access_duration_days, features, is_active)
values
  ('continuous_monitoring_90d',
   'Continuous Monitoring, 90 days',
   'For 90 days, every reading you log is checked against care protocols, and a dangerous one is put in front of a doctor on your care team rather than sitting on your record. You keep the emergency safety net either way; what this adds is a doctor who is told. Paid once, for the term. Nothing renews, and there is no card kept on file.',
   3000000, 'NGN', 90,
   array['vitals_red_flag_doctor_escalation'], true)
on conflict (code) do update
  set name                 = excluded.name,
      description          = excluded.description,
      price_kobo           = excluded.price_kobo,
      access_duration_days = excluded.access_duration_days,
      features             = excluded.features,
      is_active             = true;

update public.service_products
   set is_active = false
 where code in ('continuous_monitoring_3m', 'continuous_monitoring_6m', 'continuous_monitoring_12m')
   and is_active = true;

-- Delivery-cost model row for the new product (public.service_delivery_cost_model,
-- 20260910011854_service_delivery_cost_model.sql) — same per-exception costing
-- convention as the three retired tiers (kept as-is, not deleted: "keyed on
-- service_products.code by TEXT... so a retired product keeps its costing for
-- historical margin analysis"). 0.9 units_per_term (0.3 escalations/patient-
-- month assumption x 3 months) matches the old 3-month row exactly, since the
-- term length is the same 90 days.
insert into public.service_delivery_cost_model
  (service_product_code, component, expected_minutes, delivered_by_tier, coordination_minutes, units_per_term, notes)
values
  ('continuous_monitoring_90d', 'delivery', 15, 'medical_officer', 5, 0.9,
   '0.3 escalations per patient-month over 90 days. Assumption, not observation — same figure as the retired 3-month tier this replaces.')
on conflict (service_product_code, component) do update
  set expected_minutes     = excluded.expected_minutes,
      delivered_by_tier    = excluded.delivered_by_tier,
      coordination_minutes = excluded.coordination_minutes,
      units_per_term       = excluded.units_per_term,
      notes                = excluded.notes;

-- ---------------------------------------------------------------------------
-- Proof that the gate OPENS on the new product and STAYS OPEN for an
-- existing purchase against a now-deactivated old one — "assert the gate
-- opens, not just closes" convention, same shape as 20260910011849's own
-- check, rolled back so no test row survives.
-- ---------------------------------------------------------------------------

do $$
declare
  v_patient   uuid;
  v_org       uuid;
  v_new_product uuid;
  v_old_product uuid;
  v_new_open    boolean;
  v_new_expired boolean;
  v_old_still_open boolean;
begin
  select id, organisation_id into v_patient, v_org
    from public.profiles where role = 'patient' limit 1;

  if v_patient is null then
    raise notice 'SKIP: no patient row to prove the gate against; structural checks only';
  else
    select id into v_new_product from public.service_products where code = 'continuous_monitoring_90d';
    select id into v_old_product from public.service_products where code = 'continuous_monitoring_3m';

    begin
      -- (a) The NEW 90-day product opens the gate and an expired one closes it.
      insert into public.service_purchases
        (organisation_id, patient_id, service_product_id, status, amount_kobo, currency,
         purchased_at, expires_at)
      values
        (v_org, v_patient, v_new_product, 'active', 3000000, 'NGN', now(), now() + interval '90 days');

      v_new_open := private.patient_has_feature_access(v_patient, 'vitals_red_flag_doctor_escalation');

      update public.service_purchases
         set expires_at = now() - interval '1 day'
       where patient_id = v_patient and service_product_id = v_new_product;

      v_new_expired := private.patient_has_feature_access(v_patient, 'vitals_red_flag_doctor_escalation');

      -- (b) An EXISTING active purchase against the now-deactivated 3-month
      -- product must keep resolving exactly as before (the QA-fixture case
      -- this migration's header describes) — deactivating the PRODUCT must
      -- never retroactively revoke an ACTIVE purchase's grant.
      delete from public.service_purchases
       where patient_id = v_patient and service_product_id = v_new_product;

      insert into public.service_purchases
        (organisation_id, patient_id, service_product_id, status, amount_kobo, currency,
         purchased_at, expires_at)
      values
        (v_org, v_patient, v_old_product, 'active', 750000, 'NGN', now(), now() + interval '10 days');

      v_old_still_open := private.patient_has_feature_access(v_patient, 'vitals_red_flag_doctor_escalation');

      raise exception 'ROLLBACK_PROBE';
    exception when others then
      if sqlerrm <> 'ROLLBACK_PROBE' then
        raise;
      end if;
    end;

    if v_new_open is not true then
      raise exception 'FAIL: an active continuous_monitoring_90d purchase did NOT open the escalation gate';
    end if;
    if v_new_expired is not false then
      raise exception 'FAIL: an EXPIRED continuous_monitoring_90d purchase still opens the escalation gate';
    end if;
    if (select is_active from public.service_products where code = 'continuous_monitoring_3m') is not false then
      raise exception 'FAIL: continuous_monitoring_3m should be deactivated by this migration';
    end if;
    if v_old_still_open is not true then
      raise exception 'FAIL: an EXISTING active purchase against the now-deactivated continuous_monitoring_3m stopped opening the gate — deactivating a product must never retroactively revoke an active purchase';
    end if;

    raise notice 'PASS: 90-day tier opens/closes the gate correctly; an existing purchase against a deactivated old tier still resolves';
  end if;

  if (select count(*) from public.service_products
       where code like 'continuous\_monitoring\_%' and is_active
         and 'vitals_red_flag_doctor_escalation' = any(features)) <> 1 then
    raise exception 'FAIL: expected exactly 1 active Continuous Monitoring product (the 90-day tier)';
  end if;
  if (select is_active from public.service_products where code = 'continuous_monitoring_6m') is not false then
    raise exception 'FAIL: continuous_monitoring_6m should be deactivated';
  end if;
  if (select is_active from public.service_products where code = 'continuous_monitoring_12m') is not false then
    raise exception 'FAIL: continuous_monitoring_12m should be deactivated';
  end if;

  raise notice 'PASS: Continuous Monitoring collapsed to a single 90-day tier at ₦30,000; old tiers deactivated, not deleted';
end $$;

commit;
