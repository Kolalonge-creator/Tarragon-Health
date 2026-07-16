-- Tarragon Health
-- Premium ParentCare as a real, standalone subscription tier (Category 4/5,
-- docs/Tarragon_Health_Master_Operating_Plan_v4.md §13 — "Premium ParentCare
-- tier: dedicated coordinator, scheduled Tier 2+ doctor review, quarterly
-- family report"). Distinct product line from Family Lite/Plus/Premium per
-- the master plan's revenue-model bullet, which lists "family plans" and
-- "premium ParentCare" as two separate line items. Launches with NGN + GBP
-- + USD together, up to 2 parents included per subscription (extra parents
-- via a per-currency add-on, see below), monthly + yearly billing.
--
-- Prices below are launch estimates, not final: is_active=false and
-- price_locked=false until an admin syncs each row to a real Paystack Plan
-- / Stripe Price via /admin/settings/subscriptions (same convention as
-- every other unsynced row added this sprint) — tune freely before that
-- happens, since the price-lock trigger only bites once a real subscriber
-- exists.

-- ---------------------------------------------------------------------------
-- 0. Bug fix found in passing: family_plus, family_premium, and both
-- diaspora_premium_gbp rows were inserted with an EMPTY features[] array in
-- 20260715142113_doctor_led_pricing_v2_family_tiers.sql — meaning a
-- subscriber on any of these "higher" tiers would get FEWER entitlements
-- than Family Lite through public.has_feature_access(), the opposite of
-- what the tier ladder promises. Zero real subscribers exist on any of
-- these four rows today (confirmed live), and all four are still
-- is_active=false, so this is a safe, no-blast-radius fix rather than a
-- behavior change for a real subscriber. Backfilling the correct
-- features[] here since it's the same subsystem this migration is already
-- touching, not deferring it to a separate PR.
-- ---------------------------------------------------------------------------

update public.subscription_plans
set features = array['chronic','clinician_review','doctor_checkin','lab_coordination','medication_refills','priority_escalation','family_dashboard','dedicated_coordinator']
where code = 'family_plus';

update public.subscription_plans
set features = array['chronic','clinician_review','doctor_checkin','lab_coordination','medication_refills','priority_escalation','family_dashboard','dedicated_coordinator','expedited_response','quarterly_report']
where code = 'family_premium';

update public.subscription_plans
set features = array['chronic','clinician_review','doctor_checkin','lab_coordination','medication_refills','priority_escalation','dedicated_coordinator','quarterly_report']
where code in ('diaspora_premium_gbp', 'diaspora_premium_yearly_gbp');

-- ---------------------------------------------------------------------------
-- 1. ParentCare plans — dedicated_coordinator is INCLUDED in the base plan
-- here (unlike every other tier, where it's an add-on-only feature code),
-- per the master plan's "dedicated coordinator" being a defining feature of
-- this specific tier, not an optional extra. quarterly_report is a
-- genuinely new feature code (see Workstream 2's shared quarterly-report
-- infrastructure, built alongside this migration) shared with
-- family_premium/diaspora_premium above rather than duplicated.
-- ---------------------------------------------------------------------------

insert into public.subscription_plans (code, name, description, price_minor, currency, interval, is_active, price_locked, features)
values
  ('parentcare', 'ParentCare', 'Dedicated monitoring for up to 2 parents: named doctor coordinator, scheduled doctor review, quarterly family report, priority escalation, and lab/pharmacy coordination.', 2000000, 'NGN', 'monthly', false, false, array['chronic','clinician_review','doctor_checkin','lab_coordination','medication_refills','priority_escalation','family_dashboard','dedicated_coordinator','quarterly_report']),
  ('parentcare_yearly', 'ParentCare (yearly)', 'ParentCare billed annually — 2 months free.', 20000000, 'NGN', 'yearly', false, false, array['chronic','clinician_review','doctor_checkin','lab_coordination','medication_refills','priority_escalation','family_dashboard','dedicated_coordinator','quarterly_report']),
  ('parentcare_gbp', 'ParentCare', 'Dedicated monitoring for up to 2 parents from abroad: named doctor coordinator, scheduled doctor review, quarterly family report, priority escalation, and lab/pharmacy coordination in Nigeria.', 11900, 'GBP', 'monthly', false, false, array['chronic','clinician_review','doctor_checkin','lab_coordination','medication_refills','priority_escalation','family_dashboard','dedicated_coordinator','quarterly_report']),
  ('parentcare_yearly_gbp', 'ParentCare (yearly)', 'ParentCare billed annually — 2 months free.', 119000, 'GBP', 'yearly', false, false, array['chronic','clinician_review','doctor_checkin','lab_coordination','medication_refills','priority_escalation','family_dashboard','dedicated_coordinator','quarterly_report']),
  ('parentcare_usd', 'ParentCare', 'Dedicated monitoring for up to 2 parents from abroad: named doctor coordinator, scheduled doctor review, quarterly family report, priority escalation, and lab/pharmacy coordination in Nigeria.', 2000, 'USD', 'monthly', false, false, array['chronic','clinician_review','doctor_checkin','lab_coordination','medication_refills','priority_escalation','family_dashboard','dedicated_coordinator','quarterly_report']),
  ('parentcare_yearly_usd', 'ParentCare (yearly)', 'ParentCare billed annually — 2 months free.', 20000, 'USD', 'yearly', false, false, array['chronic','clinician_review','doctor_checkin','lab_coordination','medication_refills','priority_escalation','family_dashboard','dedicated_coordinator','quarterly_report'])
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Extra-parent add-on, one row per plan-code variant — following the
-- exact precedent already established by extra-family-member /
-- extra-family-member-plus / extra-family-member-premium
-- (restricted_to_plan_code is a single exact-match string, so a tier with
-- multiple currency/interval variants gets one add-on row per variant,
-- not a generalized trigger change). Priced at roughly 70% of the base
-- plan's per-parent rate, matching the discount ratio already used for
-- extra-family-member-premium relative to Family Premium's per-person cost.
-- ---------------------------------------------------------------------------

insert into public.add_ons (code, name, description, price_minor, currency, interval, restricted_to_plan_code, is_active, price_locked)
values
  ('extra-parentcare-member', 'Extra Parent (ParentCare)', 'Adds a third parent to a ParentCare subscription at the same level of monitoring.', 700000, 'NGN', 'monthly', 'parentcare', false, false),
  ('extra-parentcare-member-yearly', 'Extra Parent (ParentCare, yearly)', 'Adds a third parent to a yearly ParentCare subscription at the same level of monitoring.', 7000000, 'NGN', 'yearly', 'parentcare_yearly', false, false),
  ('extra-parentcare-member-gbp', 'Extra Parent (ParentCare)', 'Adds a third parent to a ParentCare subscription at the same level of monitoring.', 3900, 'GBP', 'monthly', 'parentcare_gbp', false, false),
  ('extra-parentcare-member-yearly-gbp', 'Extra Parent (ParentCare, yearly)', 'Adds a third parent to a yearly ParentCare subscription at the same level of monitoring.', 39000, 'GBP', 'yearly', 'parentcare_yearly_gbp', false, false),
  ('extra-parentcare-member-usd', 'Extra Parent (ParentCare)', 'Adds a third parent to a ParentCare subscription at the same level of monitoring.', 700, 'USD', 'monthly', 'parentcare_usd', false, false),
  ('extra-parentcare-member-yearly-usd', 'Extra Parent (ParentCare, yearly)', 'Adds a third parent to a yearly ParentCare subscription at the same level of monitoring.', 7000, 'USD', 'yearly', 'parentcare_yearly_usd', false, false)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Fix + extend private.validate_family_plan_member_count() (originally
-- 20260712201534_family_plan_member_limits.sql).
--
-- Confirmed bug in the existing function: it hardcodes a base limit of 4
-- and only counts add-ons with code = 'extra-family-member' EXACTLY --
-- meaning a Family Plus/Premium subscriber who buys
-- extra-family-member-plus / extra-family-member-premium was never
-- actually credited for it; the limit stayed at 4 regardless. Generalizing
-- this to derive the plan family from the member's own plan_id (joined
-- through subscriptions -> subscription_plans.code) fixes this as a
-- byproduct while adding ParentCare's 2-parent-base / +1-per-add-on rule.
-- ---------------------------------------------------------------------------

create or replace function private.validate_family_plan_member_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_count integer;
  v_extra_addons integer;
  v_limit integer;
  v_plan_code text;
  v_base_limit integer;
  v_addon_pattern text;
begin
  select count(*) into v_current_count
    from public.family_plan_members
    where plan_owner_id = new.plan_owner_id;

  select p.code into v_plan_code
    from public.subscriptions s
    join public.subscription_plans p on p.id = s.plan_id
    where s.id = new.plan_id;

  if v_plan_code like 'parentcare%' then
    v_base_limit := 2;
    v_addon_pattern := 'extra-parentcare-member%';
  else
    v_base_limit := 4;
    v_addon_pattern := 'extra-family-member%';
  end if;

  select count(*) into v_extra_addons
    from public.subscription_add_ons sao
    join public.add_ons a on a.id = sao.add_on_id
    join public.subscriptions s on s.id = sao.subscription_id
    where s.subscriber_id = new.plan_owner_id
      and a.code like v_addon_pattern
      and sao.status in ('active', 'trialing');

  v_limit := v_base_limit + v_extra_addons;

  if v_current_count >= v_limit then
    raise exception 'family_plan_member_limit_reached: % of % members (attach an extra-member add-on to add more)',
      v_current_count, v_limit;
  end if;

  return new;
end;
$$;
