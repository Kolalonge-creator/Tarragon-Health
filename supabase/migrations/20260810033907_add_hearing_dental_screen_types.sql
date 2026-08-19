-- Tarragon Health — add hearing and dental as real, schedulable screen_types.
--
-- Found during a 2026-08-10 preventative-programme review: docs/
-- FULL_SPECIFICATION_V4.md's "ships now" list proposed broadening
-- screen_types to "vision, hearing, dental, osteoporosis." vision_check and
-- bone_density (the osteoporosis proxy) shipped as real, schedulable rows
-- in 20260716... catalogue work; hearing and dental never did — the only
-- live trace of either is health-education article copy
-- (dm-dental-health-link in 20260810013935_health_education_track_
-- expansions.sql), which explains a link between diabetes and gum disease
-- but creates no screen_types row, so no patient's screening_schedules
-- calendar has ever surfaced a due hearing or dental check.
--
-- private.calculate_due_screenings() (the reminder engine — see
-- 20260807121855_screening_due_reminders.sql) and apps/web/src/lib/rules/
-- screening-recommendations.ts both read screen_types generically by
-- age/sex/frequency, with no per-code branching, so these two new rows are
-- picked up automatically — no application code change needed.
--
-- Cadence/age choices, [LOCALISE] pending founder/partner confirmation on
-- exact numbers if they want to tighten them:
--   * hearing_check: age 50+ (age-related hearing loss / presbycusis is the
--     common screening trigger), every 24 months — mirrors vision_check's
--     own age/cadence exactly, the platform's other "sensory" screen.
--   * dental_check: age 18+ (routine adult oral health), every 12 months —
--     matches this catalogue's general annual-screen convention; global
--     guidance ranges 6-12 months, so a partner dental network's own
--     recommendation should override this if/when one exists.
-- Neither is a sensitive result type (no HIV/hep/cancer-style suppression
-- needed) and both route through a clinic, not a lab, matching vision_
-- check's recommended_provider_type.

insert into public.screen_types
  (code, name, sex_applicability, age_from, age_to, frequency_months, commission_rate, recommended_provider_type)
values
  ('hearing_check', 'Hearing / Audiometry Screening', 'all', 50, null, 24, 0.1500, 'clinic'),
  ('dental_check',  'Dental / Oral Health Check-up',   'all', 18, null, 12, 0.1500, 'clinic')
on conflict (code) do nothing;

do $$
begin
  if not exists (select 1 from public.screen_types where code = 'hearing_check') then
    raise exception 'FAIL: hearing_check screen_type not present';
  end if;
  if not exists (select 1 from public.screen_types where code = 'dental_check') then
    raise exception 'FAIL: dental_check screen_type not present';
  end if;
  raise notice 'PASS: hearing_check and dental_check are real, schedulable screen_types';
end $$;
