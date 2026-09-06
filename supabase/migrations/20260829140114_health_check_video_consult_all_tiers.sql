-- Extend the Annual Health Check's bundled doctor video consult to every
-- Screen tier, and build the scheduling handshake that was never actually
-- wired up for it.
--
-- Founder ask 2026-08-29: the Annual Health Check should include the blood
-- test AND a doctor video consultation to go through the result with the
-- patient. Before this migration that was true only for Comprehensive Screen
-- (private.handle_screen_tier_resulted, from
-- 20260802212529_retire_annual_review_fold_into_screen_ladder.sql) -- Core
-- and Advanced Screen got a written "clinician-reviewed report" instead. The
-- founder confirmed this should be uniform: every tier ends in the same
-- 15-minute video consult, not just the top tier.
--
-- Investigating the existing Comprehensive-only mechanic surfaced a second,
-- more serious gap: the video_consultations row it creates
-- (context='annual_review', proposed_slots null) was never actually
-- reachable by any UI. The one place that proposes slots
-- (clinician/annual-reviews) only queries the RETIRED annual_reviews table,
-- and video_consultations' UPDATE policy is staff-only (patients are a
-- read-only party to this table, see 20260716110000_video_consultations.sql)
-- with no RPC ever built to let a patient confirm one. So even
-- Comprehensive Screen's consult has been a dead end for every patient who
-- ever bought it. This migration closes that loop as well as widening it:
--
--   1. annual_health_checks gains video_consultation_id, so both the
--      clinician chart page and the patient's Health Check page can find
--      the specific consult tied to THIS year's check, the same
--      single-link pattern the old annual_reviews table used
--      (video_consultation_id) before it was retired.
--   2. private.handle_screen_tier_resulted creates that row for
--      screen_core/screen_advanced/screen_comprehensive alike (previously
--      gated to screen_comprehensive only) and links it via
--      annual_health_checks.lab_order_id, which is already set at order
--      insert time (20260811225324_fix_annual_health_check_self_arranged_
--      order_link.sql) -- reliable by the time the SAME lab_orders row
--      later transitions to 'resulted'.
--   3. A new RPC, public.confirm_health_check_video_slot, is the patient's
--      missing half of the handshake: security definer, ownership checked
--      structurally (patient_id = auth.uid() in the row lookup, not a
--      bolt-on check), same shape as the sibling
--      public.select_video_visit_alternate_slot RPC
--      (20260731013604_video_visit_doctor_proposes_alternate_time.sql).
--      The clinician side needs no new RPC: org staff already have UPDATE
--      on video_consultations under the existing RLS policy, so a plain
--      client-side update (setting proposed_slots) is enough, same as the
--      legacy proposeAnnualReviewConsult action did.
--
-- Money-safety note: this is the same real, deliberate cost decision
-- 20260802212529 flagged when it first bundled the consult into
-- Comprehensive Screen's price -- giving away doctor video time on Core/
-- Advanced too is a genuine COGS increase on those tiers, not an oversight.
-- Recorded here because it is exactly the kind of pricing fact CLAUDE.md
-- says not to trust from a stale changelog -- check panel_bundles.price_kobo
-- live if this ever needs re-costing.

-- ---------------------------------------------------------------------------
-- 1. Link column, mirroring the old annual_reviews.video_consultation_id.
-- ---------------------------------------------------------------------------
alter table public.annual_health_checks
  add column if not exists video_consultation_id uuid references public.video_consultations (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. Every Screen tier gets the bundled consult, linked to this year's check.
-- ---------------------------------------------------------------------------
create or replace function private.handle_screen_tier_resulted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bundle_code text;
  v_consult_id uuid;
begin
  if not (new.status = 'resulted' and old.status is distinct from 'resulted') then
    return new;
  end if;

  select code into v_bundle_code from public.panel_bundles where id = new.panel_bundle_id;

  if v_bundle_code not in ('screen_core', 'screen_advanced', 'screen_comprehensive') then
    return new;
  end if;

  -- Adopt + roll any pending per-condition medication review this workup
  -- satisfies -- same effect as the old reconcile_annual_medication_reviews,
  -- now triggered by any Screen-tier result rather than a separate annual
  -- review record.
  update public.medication_reviews
    set status = 'completed'
    where patient_id = new.patient_id
      and status = 'pending';

  -- Every tier's bundled video consult -- created once the order results,
  -- ready for the clinician to offer times. Linked to this year's
  -- annual_health_checks row via lab_order_id, which is already set to
  -- this exact lab_orders row (new.id) by the time it results.
  insert into public.video_consultations (organisation_id, patient_id, context)
  values (new.organisation_id, new.patient_id, 'annual_review')
  returning id into v_consult_id;

  update public.annual_health_checks
    set video_consultation_id = v_consult_id
    where lab_order_id = new.id;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Patient's missing half of the propose -> confirm handshake.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_health_check_video_slot(p_consultation_id uuid, p_slot timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consult record;
begin
  select * into v_consult
  from public.video_consultations
  where id = p_consultation_id and patient_id = (select auth.uid())
  for update;
  if v_consult.id is null then
    raise exception 'consultation not found' using errcode = '42501';
  end if;

  if v_consult.context <> 'annual_review' then
    raise exception 'this consultation has no offered times to confirm';
  end if;
  if v_consult.scheduled_at is not null then
    raise exception 'this consultation is already scheduled';
  end if;
  if v_consult.proposed_slots is null or not (p_slot = any(v_consult.proposed_slots)) then
    raise exception 'that time was not one of the offered options';
  end if;

  update public.video_consultations
    set scheduled_at = p_slot,
        patient_confirmed_at = now()
    where id = p_consultation_id;
end;
$$;

revoke execute on function public.confirm_health_check_video_slot(uuid, timestamptz) from public, anon;
grant execute on function public.confirm_health_check_video_slot(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Product copy: the video consult is no longer Comprehensive-exclusive.
-- ---------------------------------------------------------------------------
update public.panel_bundles
  set description = 'Cardiometabolic, organ-baseline and blood-borne-virus screen: HbA1c, full lipid panel, FBC, liver/kidney/thyroid function, urinalysis, HIV, Hepatitis B, Hepatitis C, genotype and blood group (once), plus PHQ-9/GAD-7, and a 15-minute doctor video consult to walk through your results.'
  where code = 'screen_core';

update public.panel_bundles
  set description = 'Everything in Advanced Screen, plus abdominal ultrasound, breast imaging, prostate ultrasound, syphilis screening, an STI risk assessment, and a vaccination catch-up plan.'
  where code = 'screen_comprehensive';

-- ---------------------------------------------------------------------------
-- 5. Assertions -- provable, not hopeful.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_count int;
begin
  select count(*) into v_count from information_schema.columns
    where table_schema = 'public' and table_name = 'annual_health_checks' and column_name = 'video_consultation_id';
  if v_count <> 1 then
    raise exception 'annual_health_checks.video_consultation_id should exist';
  end if;

  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'handle_screen_tier_resulted' and pronamespace = 'private'::regnamespace;
  if v_def like '%if v_bundle_code = ''screen_comprehensive'' then%' then
    raise exception 'handle_screen_tier_resulted still gates the bundled video consult to screen_comprehensive only';
  end if;
  if v_def not like '%insert into public.video_consultations%' then
    raise exception 'handle_screen_tier_resulted lost its video consult insert entirely';
  end if;

  if has_function_privilege('anon', 'public.confirm_health_check_video_slot(uuid, timestamptz)', 'EXECUTE') then
    raise exception 'anon must not execute confirm_health_check_video_slot';
  end if;
  if not has_function_privilege('authenticated', 'public.confirm_health_check_video_slot(uuid, timestamptz)', 'EXECUTE') then
    raise exception 'authenticated should be able to execute confirm_health_check_video_slot';
  end if;

  select count(*) into v_count from public.panel_bundles
    where code = 'screen_comprehensive' and description like '%doctor video consult%';
  if v_count > 0 then
    raise exception 'screen_comprehensive should no longer describe the video consult as its own exclusive addition';
  end if;
  select count(*) into v_count from public.panel_bundles
    where code = 'screen_core' and description like '%doctor video consult%';
  if v_count <> 1 then
    raise exception 'screen_core should now describe the bundled doctor video consult';
  end if;
end $$;
