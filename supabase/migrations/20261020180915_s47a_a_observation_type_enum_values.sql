-- S47a (1 of 2): three new observation types on the existing vital_type enum.
--
-- WHY THIS ENUM AND NOT A NEW TABLE. The S05 design (20261001004126_s05_health_record_data_model.sql) added vitals_readings.value_numeric and value_unit for
-- exactly this: "an observation type with no dedicated column, added later with ALTER TYPE vital_type ADD VALUE". A new type that lives in vitals_readings
-- inherits the supersede-not-edit chain (S05b: correct_clinical_value), the tied-read RLS, the offline client_reading_id dedupe, the S05 public.observations
-- view (type text, value_numeric, unit all fall through to value_numeric / value_unit) and the outbox path of the phone, with no parallel record.
--
-- The three values are only ADDED here. ALTER TYPE ... ADD VALUE cannot be used in the transaction that adds it, so every use (a CHECK, the guard trigger,
-- the event trigger) is in the next migration, 20261020*_s47a_b_*. Nothing in this file changes a row, a function or a trigger.
--
-- Inhaler use is NOT a value here: it carries two facts (puffs and a reason) and a vitals row has one number, so it is its own append-only table in part 2.
-- Waist already exists (waist_circumference, 20260719141000). Glucose timing tags already exist (glucose_context: fasting, pre_meal, post_meal, bedtime, night).
--
-- COUNTS / LIVE FACTS (2026-10-20, read-only): vital_type had 10 labels (blood_pressure, glucose, weight, pulse, temperature, spo2, waist_circumference,
-- ketones, respiratory_rate, peak_flow); no row, view or function names water_ml, sleep_hours or mood. 25 triggers on vitals_readings, audited in part 2.
alter type public.vital_type add value if not exists 'water_ml';
alter type public.vital_type add value if not exists 'sleep_hours';
alter type public.vital_type add value if not exists 'mood';
