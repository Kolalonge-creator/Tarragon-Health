-- Patient Health Record architecture review — respiratory rate and peak
-- flow, the two core vitals from spec §1.12 with no home in vitals_readings.
--
-- Same additive-faster-path shape as waist_circumference
-- (20260719141000_waist_circumference_vital.sql): a new vital_type value +
-- a dedicated column each, no parallel table (Device & Wearable rule).
-- ALTER TYPE ... ADD VALUE and the column adds coexist fine in one
-- transaction because neither new enum value is referenced by any DML in
-- this same migration.
--
-- Schema only, matching the same precedent: input forms, red-flag
-- thresholds, and timeline/UI wiring for these two are a follow-up, tracked
-- in docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md rather than guessed at here.

alter type public.vital_type add value if not exists 'respiratory_rate';
alter type public.vital_type add value if not exists 'peak_flow';

alter table public.vitals_readings
  add column if not exists respiratory_rate_bpm integer,
  add column if not exists peak_flow_l_min numeric(6, 1);

comment on column public.vitals_readings.respiratory_rate_bpm is
  'Breaths per minute. Populated when vital_type = respiratory_rate.';
comment on column public.vitals_readings.peak_flow_l_min is
  'Peak expiratory flow, litres/min, from a peak flow meter. Populated when vital_type = peak_flow (asthma/respiratory pathways).';
