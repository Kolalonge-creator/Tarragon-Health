-- Tarragon Health — five founder-directed screening/vaccination scope cuts,
-- reviewed together 2026-09-22 (COVID-19 vaccine, malaria RDT, dental/oral
-- check-up, echocardiogram, urine albumin:creatinine ratio). A sixth item in
-- the same request — antenatal booking only for pregnant women — was
-- already fixed live on 2026-09-18 (cf595c7e/01aae1c6, the
-- LIFE_STAGE_GATED_SCREENS gate in screening-recommendations.ts) and needs
-- no further change here; confirmed via git log and a live query before
-- starting this migration, not assumed.
--
-- Root cause common to four of these five: computeScreeningRecommendations
-- (apps/web/src/lib/rules/screening-recommendations.ts) applies only
-- sex_applicability/age_from/age_to/frequency_months when deciding what to
-- auto-schedule onto a patient's screening_schedules calendar — it reads
-- neither screen_types.guidance_only nor screen_types.is_optional. The same
-- class of bug the antenatal_booking life-stage gate fixed 2026-09-18: a
-- catalogue row correct for "who this test concerns" was being read as
-- "who should be told this is due", which is a stronger and different claim.
--
--   * malaria_rdt — the patient tests themselves when unwell; never a
--     preventative/chronic-disease-management screen (confirmed live: zero
--     panel_bundles.test_codes and zero screening_pathway_coverage/
--     exposure_retest_rules rows reference it — no other code path reaches
--     it besides this auto-scheduler). Deactivated outright, same treatment
--     as the 2026-09-17 mammography fix (20260917222259).
--   * echo — screen-order-results-section.tsx already documents echo as
--     "conditional on an ECG/BP/symptom finding, not a calendar screen" and
--     "never added to any panel_bundles.test_codes in the first place" —
--     the live screen_types row (is_active = true) contradicted its own
--     code comment. Deactivated to match the already-documented intent:
--     doctor-ordered only, never auto-flagged.
--   * urine_acr — NOT deactivated from the catalogue outright: it is a real
--     KDIGO CKD-staging input (lib/rules/kdigo-ckd-risk.ts), it is in the
--     diabetes_panel/hypertension_panel/kidney_panel/screen_advanced/
--     screen_comprehensive/single_urine_acr panel bundles, and it is
--     required by both signed pathways (screening_pathway_coverage already
--     lists it for diabetes/hypertension/ckd; the Hypertension Pathway Gap
--     Closure Plan's H14 item added it to the baseline bundle specifically).
--     Deactivating screen_types.is_active only stops the ANNUAL
--     general-population auto-recommendation pushed at every adult 18+ —
--     panel_bundles/lab-order queries never filter on screen_types.is_active
--     (confirmed live), so every bundle above stays exactly as orderable as
--     before, and every chronic-disease read path keys off
--     screening_results/lab_analyte_readings, never off this flag.
--   * dental_check — genuinely marked is_optional already exists as a column
--     for exactly this ("Offered when due, never assumed. The patient opts
--     in rather than finding it already inside their review." — screen_
--     types.is_optional's own column comment), but nothing has ever read it.
--     Fixed at the root in the same commit as this migration
--     (screening-recommendations.ts now skips is_optional screen types when
--     auto-inserting, and a new patient-facing "optional screenings" offer
--     surface lets a patient opt in explicitly), which also, for the first
--     time, actually applies to the three OTHER screens already marked
--     is_optional — ferritin, tft, vitamin_b12 — that were being
--     force-scheduled despite the flag (psa currently has zero live pending
--     rows, so nothing to retroactively cancel there; its existing SDM gate
--     at result-recording time, 20260802212152, is unaffected either way).
--
-- COVID-19 vaccine is the one item on a different table (vaccination_catalog,
-- not screen_types) and a different reason: per founder direction, COVID-19
-- vaccination is not part of Nigeria's immunisation programme/practice, so
-- this was never a locally-correct recommendation regardless of scheduling
-- logic. Deactivated (is_active = false) rather than deleted, matching this
-- table's own existing soft-disable column and every other item in this
-- migration — vaccination_schedule_signoffs snapshots active catalog rows
-- into governed draft/signed versions, so a hard DELETE risks breaking a
-- historical signoff's referential integrity for no benefit over
-- deactivation (functionally identical: private.queue_vaccination_reminders
-- and generate-vaccination-schedule.ts both filter on is_active = true, so
-- a deactivated vaccine can never again be scheduled, reminded, or shown as
-- due — same mechanism screen_types.is_active already uses).
--
-- Confirmed live before writing this: every screening_schedules /
-- vaccination_schedules row touched below belongs to one of exactly two QA
-- fixture patients (bb707ae8.../13dadadb...), and zero screening_results /
-- vaccination_records reference any of these five items — a pure
-- structural change, not a real-patient data migration.

-- ---------------------------------------------------------------------------
-- 1. COVID-19 vaccine
-- ---------------------------------------------------------------------------
update public.vaccination_catalog
set is_active = false
where code = 'covid_19';

-- Passes through vaccination_schedules_enforce_non_administration untouched:
-- non_administration_reason isn't set here (neither 'declined' nor
-- 'contraindicated' fits "the platform stopped offering this vaccine"), so
-- the trigger's NEW.non_administration_reason IS NOT DISTINCT FROM OLD
-- early-return branch applies and status/note pass through as written.
update public.vaccination_schedules vs
set status = 'cancelled',
    non_administration_note = 'COVID-19 vaccination removed from the platform catalogue — not part of Nigeria''s immunisation programme (2026-09-22).'
from public.vaccination_catalog vc
where vs.vaccination_catalog_id = vc.id
  and vc.code = 'covid_19'
  and vs.status in ('pending', 'booked');

-- ---------------------------------------------------------------------------
-- 2. malaria_rdt, echo — deactivated outright (never routine screening)
-- ---------------------------------------------------------------------------
update public.screen_types
set is_active = false
where code in ('malaria_rdt', 'echo');

-- 'cancelled', deliberately not 'declined' — same reasoning as the
-- antenatal_booking retroactive fix (20260918105225): private.block_
-- screening_schedule_after_decline only locks re-scheduling behind a
-- 'declined' row, and these patients never made that choice themselves.
update public.screening_schedules ss
set status = 'cancelled',
    declined_reason = 'Removed from routine screening — not part of preventative/chronic-disease-management screening (2026-09-22).'
from public.screen_types st
where ss.screen_type_id = st.id
  and st.code in ('malaria_rdt', 'echo')
  and ss.status in ('pending', 'booked', 'overdue');

-- ---------------------------------------------------------------------------
-- 3. urine_acr — deactivated from GENERAL screening only; stays orderable
--    via every panel_bundle above and stays the input to KDIGO/chronic-
--    pathway monitoring.
-- ---------------------------------------------------------------------------
update public.screen_types
set is_active = false
where code = 'urine_acr';

update public.screening_schedules ss
set status = 'cancelled',
    declined_reason = 'Removed from general-population annual screening — still ordered directly for diabetes/hypertension/CKD monitoring via the existing panel bundles (2026-09-22).'
from public.screen_types st
where ss.screen_type_id = st.id
  and st.code = 'urine_acr'
  and ss.status in ('pending', 'booked', 'overdue');

-- ---------------------------------------------------------------------------
-- 4. dental_check → opt-in (is_optional = true), plus retroactively cancel
--    every is_optional screen's pre-existing force-scheduled row — this
--    also covers ferritin/tft/vitamin_b12, already is_optional = true but
--    never actually gated by the engine until this commit's app-layer fix.
--    A patient who wants any of these back can accept it from the new
--    "optional screenings" offer surface, which inserts a fresh row.
-- ---------------------------------------------------------------------------
update public.screen_types
set is_optional = true
where code = 'dental_check';

update public.screening_schedules ss
set status = 'cancelled',
    declined_reason = 'Optional screening — was auto-scheduled before computeScreeningRecommendations respected is_optional. Offered for opt-in instead (2026-09-22).'
from public.screen_types st
where ss.screen_type_id = st.id
  and st.is_optional = true
  and ss.status in ('pending', 'booked', 'overdue');

do $$
declare
  v_bad_count integer;
begin
  if exists (select 1 from public.vaccination_catalog where code = 'covid_19' and is_active) then
    raise exception 'FAIL: covid_19 should be is_active = false';
  end if;

  if exists (
    select 1 from public.vaccination_schedules vs
    join public.vaccination_catalog vc on vc.id = vs.vaccination_catalog_id
    where vc.code = 'covid_19' and vs.status in ('pending', 'booked')
  ) then
    raise exception 'FAIL: no pending/booked covid_19 vaccination_schedules rows should remain';
  end if;

  if exists (select 1 from public.screen_types where code in ('malaria_rdt', 'echo', 'urine_acr') and is_active) then
    raise exception 'FAIL: malaria_rdt/echo/urine_acr should all be is_active = false';
  end if;

  if not exists (select 1 from public.screen_types where code = 'dental_check' and is_active and is_optional) then
    raise exception 'FAIL: dental_check should remain is_active but become is_optional';
  end if;

  select count(*) into v_bad_count
  from public.screening_schedules ss
  join public.screen_types st on st.id = ss.screen_type_id
  where st.code in ('malaria_rdt', 'echo', 'urine_acr')
    and ss.status in ('pending', 'booked', 'overdue');
  if v_bad_count <> 0 then
    raise exception 'FAIL: % pending/booked/overdue schedule row(s) remain for a deactivated screen type', v_bad_count;
  end if;

  select count(*) into v_bad_count
  from public.screening_schedules ss
  join public.screen_types st on st.id = ss.screen_type_id
  where st.is_optional = true
    and ss.status in ('pending', 'booked', 'overdue');
  if v_bad_count <> 0 then
    raise exception 'FAIL: % pending/booked/overdue schedule row(s) remain for an is_optional = true screen type', v_bad_count;
  end if;

  raise notice 'PASS: covid_19/malaria_rdt/echo deactivated, urine_acr removed from general screening only (still orderable + chronic-pathway-linked), dental_check (+ ferritin/tft/vitamin_b12) now correctly is_optional with no orphaned force-scheduled rows';
end $$;
