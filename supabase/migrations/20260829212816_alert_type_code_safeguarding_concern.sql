-- Tarragon Health
-- Patient Safety gap-closure, item 3 of 5 (§89.12 "safeguarding" of the
-- 2026-08-29 governance/safety spec audit) -- step 1 of 2. Confirmed live
-- before writing this: zero tables named safeguarding% exist anywhere on
-- the project, and alert_type_code has no value that fits a safeguarding
-- concern (child/vulnerable-adult/abuse/neglect/exploitation/immediate-
-- safety-risk) -- the closest existing values are all clinical-monitoring or
-- operational in nature.
--
-- Split into its own migration, not combined with the safeguarding_concerns
-- table that will use it: Postgres cannot use a newly-added enum value in
-- the same transaction that added it, and every apply_migration call here
-- runs as its own transaction -- same reason this codebase's own
-- alert_status 'snoozed'/'closed' values got their own migration
-- (20260828013522) separate from the taxonomy work that needed them.

alter type public.alert_type_code add value if not exists 'safeguarding_concern';
