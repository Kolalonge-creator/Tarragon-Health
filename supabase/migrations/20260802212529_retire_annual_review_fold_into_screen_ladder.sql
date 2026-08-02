-- Retire "Annual Doctor Review" as a standalone product. It duplicated the
-- new Screen ladder almost entirely (its workup catalogue — ECG, FBC, U&E,
-- LFTs, lipids, glucose/HbA1c, TSH, urinalysis, cancer-screening review — is
-- now just Core/Advanced Screen's own panel) and its bundled video consult
-- is the same online doctor review Comprehensive Screen now includes. Two
-- separately-named "annual ___" products was confusing; there is now one.
--
-- Preserved, folded into the Screen ladder rather than lost:
--   * Medication-review reconciliation (a completed comprehensive workup
--     satisfies + rolls the patient's pending per-condition medication
--     review) — now fires on ANY Screen-tier order resulting, not just the
--     top tier, since the underlying labs are the same regardless of which
--     tier the patient bought.
--   * The doctor video consult — now Comprehensive Screen's own bundled
--     consult, created automatically when a Comprehensive Screen order
--     results. Reuses the existing video_consultations
--     context='annual_review' enum value (unchanged — renaming an enum
--     value has no product-facing effect, the label lives in app copy) and
--     the same clinician-offers-slots / patient-confirms-one handshake
--     already built for annual reviews.
--
-- NOT preserved as "free": annual_review was included at zero extra cost on
-- Complete Care / Complete Care (yearly). Comprehensive Screen has real,
-- substantial lab+imaging COGS that annual_review's old free-video-consult
-- mechanic never had to cost for (its own workup items were ordered and
-- paid for separately, as normal lab_orders). Complete Care subscribers now
-- get the same 15% subscriber discount as every other paid plan on Screen
-- tier purchases (see the subscriber-discount migration) rather than a full
-- comp — flagged explicitly, this is a real, deliberate change to what
-- those subscribers previously received, not an oversight.

-- ---------------------------------------------------------------------------
-- 1. Stop the cron, deactivate the add-on, remove the plan feature.
-- ---------------------------------------------------------------------------
select cron.unschedule('annual-reviews-daily')
  where exists (select 1 from cron.job where jobname = 'annual-reviews-daily');

update public.add_ons set is_active = false where code in ('annual-review', 'annual-review_gbp', 'annual-review_usd');

update public.subscription_plans
  set features = array(select x from unnest(features) as x where x <> 'annual_review')
  where 'annual_review' = any(coalesce(features, '{}'));

-- ---------------------------------------------------------------------------
-- 2. Fold medication-review reconciliation + the bundled consult into a
--    resulted Screen-tier order.
-- ---------------------------------------------------------------------------
create or replace function private.handle_screen_tier_resulted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bundle_code text;
begin
  if not (new.status = 'resulted' and old.status is distinct from 'resulted') then
    return new;
  end if;

  select code into v_bundle_code from public.panel_bundles where id = new.panel_bundle_id;

  if v_bundle_code not in ('screen_core', 'screen_advanced', 'screen_comprehensive') then
    return new;
  end if;

  -- Adopt + roll any pending per-condition medication review this workup
  -- satisfies — same effect as the old reconcile_annual_medication_reviews,
  -- now triggered by any Screen-tier result rather than a separate annual
  -- review record.
  update public.medication_reviews
    set status = 'completed'
    where patient_id = new.patient_id
      and status = 'pending';

  -- Comprehensive Screen's bundled video consult — created once the order
  -- results, ready for the clinician to propose slots via the existing
  -- availability-manager UI.
  if v_bundle_code = 'screen_comprehensive' then
    insert into public.video_consultations (organisation_id, patient_id, context)
    values (new.organisation_id, new.patient_id, 'annual_review');
  end if;

  return new;
end;
$$;

drop trigger if exists lab_orders_screen_tier_resulted on public.lab_orders;
create trigger lab_orders_screen_tier_resulted
  after update on public.lab_orders
  for each row execute function private.handle_screen_tier_resulted();

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.subscription_plans
    where 'annual_review' = any(coalesce(features, '{}'));
  if v_count > 0 then
    raise exception 'annual_review feature should be fully removed from every plan, found % remaining', v_count;
  end if;

  select count(*) into v_count from public.add_ons where code = 'annual-review' and is_active = true;
  if v_count > 0 then
    raise exception 'annual-review add-on should be deactivated';
  end if;
end $$;
