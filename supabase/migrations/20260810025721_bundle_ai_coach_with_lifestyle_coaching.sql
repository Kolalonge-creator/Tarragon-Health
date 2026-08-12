-- Tarragon Health — bundle 'ai_coach' into every plan/add-on that already
-- grants 'lifestyle_coaching' (founder-confirmed, 2026-08-10).
--
-- Context: Lifestyle Coaching (Complete Care line item / the
-- 'lifestyle-coaching' add-on) is a structured, protocol-driven programme
-- (packages/lifestyle-engine) with a safety-audited two-way AI Coach chat
-- (apps/web/src/lib/ai-coach) now wired to it (see the same-day app-layer
-- change grounding the coach in the patient's actual programme state). Until
-- this migration, 'ai_coach' was never listed in ANY subscription_plans or
-- add_ons features[] array anywhere — it was reachable only through the
-- admin-managed ai_coach_access_rules allowlist, fully decoupled from paid
-- plans. A patient paying for Lifestyle Coaching got no chat access unless
-- an admin manually granted it. This migration makes chat access part of
-- what Lifestyle Coaching actually buys.
--
-- Data-driven WHERE clause, not a hardcoded plan-code pattern (e.g.
-- 'complete%') — plan codes have churned before (family/parentcare/
-- diaspora_premium were retired then restored by
-- 20260729130000_restore_subscription_price_book.sql) and matching on the
-- feature itself is self-correcting against that kind of churn.
--
-- Not the "UPDATE runs before seed.sql creates the row" footgun seed.sql's
-- own comments warn about (~line 336): every plan/add-on row that currently
-- carries 'lifestyle_coaching' is created by an earlier MIGRATION
-- (20260717141000_lifestyle_coaching_entitlement.sql for the add-ons,
-- 20260729130000_restore_subscription_price_book.sql for the plans), so it
-- already exists by the time this migration's UPDATE runs, on both
-- production and a fresh `supabase db reset`.
--
-- Idempotent: guarded by `not ('ai_coach' = any(features))`.

update public.subscription_plans
set features = array_append(features, 'ai_coach')
where 'lifestyle_coaching' = any(features)
  and not ('ai_coach' = any(features));

update public.add_ons
set features = array_append(features, 'ai_coach')
where 'lifestyle_coaching' = any(features)
  and not ('ai_coach' = any(features));

-- Prove it landed, not just hope.
do $$
declare
  v_missing_plans text;
  v_missing_addons text;
begin
  select string_agg(code, ', ') into v_missing_plans
  from public.subscription_plans
  where 'lifestyle_coaching' = any(features) and not ('ai_coach' = any(features));
  if v_missing_plans is not null then
    raise exception 'FAIL: plans grant lifestyle_coaching but not ai_coach: %', v_missing_plans;
  end if;

  select string_agg(code, ', ') into v_missing_addons
  from public.add_ons
  where 'lifestyle_coaching' = any(features) and not ('ai_coach' = any(features));
  if v_missing_addons is not null then
    raise exception 'FAIL: add-ons grant lifestyle_coaching but not ai_coach: %', v_missing_addons;
  end if;

  raise notice 'PASS: ai_coach bundled onto every lifestyle_coaching-granting plan/add-on';
end $$;
