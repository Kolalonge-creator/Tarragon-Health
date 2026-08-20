-- ============================================================================
-- Confirmed sodium on a logged meal, mirroring confirmed_carbs_g.
--
-- meal-vision.ts now estimates sodium alongside carbs/calories (coaching
-- telemetry only, per the existing column's own convention). A patient can
-- already override the AI's carb estimate on confirm; this gives them the
-- same for sodium so the daily sodium budget meter (HTN's diet module) can
-- use a patient-corrected figure. No RLS/grant changes: this is a nullable
-- column on an existing table already covered by nutrition_log_entries'
-- patient-owns-own-row policies.
-- ============================================================================

alter table public.nutrition_log_entries
  add column if not exists confirmed_sodium_mg numeric;
