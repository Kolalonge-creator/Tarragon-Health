-- S66 (Module 16, function 16.4, decision A15): two more menopause symptom types so the log covers what the CMO pack lists:
-- hot flushes (hot_flashes, exists), sleep (sleep_disturbance, exists), mood (mood_changes, exists), VAGINAL symptoms (vaginal_dryness exists;
-- vaginal_discomfort added) and the BLEEDING PATTERN (irregular_bleeding added: changing or unpredictable periods around the menopause, as
-- distinct from the existing postmenopausal_bleeding flag, which always raises a clinician alert).
--
-- Own migration on purpose: ALTER TYPE ... ADD VALUE cannot be used in the transaction that adds it, so nothing here uses the new values.
-- Counted first (live, 2026-10-07): menopause_symptom_logs = 0 rows, so nothing to convert.
alter type public.menopause_symptom_type add value if not exists 'irregular_bleeding';
alter type public.menopause_symptom_type add value if not exists 'vaginal_discomfort';
