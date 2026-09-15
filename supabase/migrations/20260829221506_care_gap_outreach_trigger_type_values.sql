-- Operations & Command Centre (§96.5): 3 new outreach_trigger_type values for
-- the 3 new care-gap types added by the next migration
-- (20260829221530_care_gap_referral_medication_monitoring.sql).
--
-- Deliberately its own migration: ALTER TYPE ... ADD VALUE cannot be used in
-- the same transaction that adds it (a new enum label isn't visible to a
-- CREATE FUNCTION's parse-time validation until committed) -- the two prior
-- gap-type additions in this codebase (20260803125639, 20260828000123) never
-- combine the two either, for the same reason.

alter type public.outreach_trigger_type add value if not exists 'overdue_referral';
alter type public.outreach_trigger_type add value if not exists 'overdue_medication_review';
alter type public.outreach_trigger_type add value if not exists 'overdue_lab_monitoring';
