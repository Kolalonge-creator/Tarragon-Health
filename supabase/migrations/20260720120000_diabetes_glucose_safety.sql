-- ===========================================================================
-- Diabetes Clinical Pathway (TH-CP-DM-001) — Sprint A: glucose safety core
-- ---------------------------------------------------------------------------
-- The pathway's §15 non-negotiable: "the platform detects and surfaces EVERY
-- red flag automatically from the app/web logs — they are hard-coded, not left
-- to human vigilance". Today only blood_pressure has an on-log assessment
-- (assess-bp-control); glucose has none, and the validation range even rejects
-- the exact emergency values (a true severe hypo <2, a DKA-range high >33) it
-- needs to capture. This migration adds ONLY the schema those safety features
-- need; the detection logic lives in TS (lib/vitals/assess-glucose.ts) so it
-- shares the never-throw best-effort contract of the other assessors.
--
-- No new enum value is USED in this migration (only added) — safe to run in a
-- single transaction on PG17.
-- ===========================================================================

-- --- G5: richer glucose context (§10.1) -----------------------------------
-- Existing: fasting / random / post_meal. The pathway logs pre-meal (which
-- meal), bedtime and night too — needed for a meaningful time-in-range /
-- fasting-vs-post-meal pattern.
alter type public.glucose_context add value if not exists 'pre_meal';
alter type public.glucose_context add value if not exists 'bedtime';
alter type public.glucose_context add value if not exists 'night';

-- --- G3: ketones as a structured reading (§10.1, §15.3, §17.2) -------------
-- Ketones live in the same structured record as every other reading (no
-- parallel table, per the vitals ingestion-boundary rule). A reading may be a
-- blood value (mmol/L) or a urine dipstick band — either is enough to fire the
-- DKA workflow.
alter type public.vital_type add value if not exists 'ketones';

alter table public.vitals_readings
  add column if not exists ketones_mmol_l numeric(4, 2)
    check (ketones_mmol_l is null or (ketones_mmol_l >= 0 and ketones_mmol_l <= 20));

alter table public.vitals_readings
  add column if not exists ketone_urine text
    check (ketone_urine is null or ketone_urine in ('negative', 'trace', 'small', 'moderate', 'large'));

-- --- G1/G24: a glucose/ketone red flag can open an emergency event ---------
-- The severe-hypo and suspected-DKA paths reuse the existing emergency_events
-- machinery (acknowledge-gated safety-net UI + emergency-contact auto-notify +
-- emergency-tier clinician_alert), so the patient gets the same reliable
-- safety net a danger-symptom report already gives them.
alter type public.emergency_source add value if not exists 'glucose_red_flag';

comment on column public.vitals_readings.ketones_mmol_l is
  'Blood ketone reading (mmol/L). >= 3.0 with high glucose fires the DKA workflow (pathway §15.3).';
comment on column public.vitals_readings.ketone_urine is
  'Urine ketone dipstick band. moderate/large with high glucose fires the DKA workflow (pathway §15.3).';
