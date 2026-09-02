-- Spec §76.7 (patient dashboard "health goals") lists stop-smoking as a goal
-- a patient should be able to set, alongside the existing activity/diet/
-- sleep/mood goals. public.lpe_module (20260719120001_lpe_foundation.sql)
-- only has diet/activity/behaviour/sleep/stress today — no smoking value, so
-- a smoking-cessation goal can't be tagged. Own migration: a freshly added
-- enum value can't be used in the same transaction it's added in (same split
-- this codebase always uses).
alter type public.lpe_module add value if not exists 'smoking';
