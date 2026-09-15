-- Tarragon Health — Alert System infrastructure, part 2a/6.
--
-- Extends alert_status with the two lifecycle stages the spec's Generated ->
-- Assigned -> Delivered -> Acknowledged -> Actioned -> Resolved -> Closed
-- chain needs that don't exist yet ('open'/'acknowledged'/'resolved' only
-- today). 'open' keeps covering generated/assigned/delivered/actioned
-- internally (those are tracked as timestamps on the row in part 2b, not as
-- separate statuses -- 'open' already has dozens of live call sites
-- filtering on it and renaming/splitting it is a much bigger, riskier change
-- than this feature needs). 'snoozed' and 'closed' are genuinely new
-- terminal-ish states with no existing meaning to collide with.
--
-- Split into its own migration deliberately: Postgres cannot use a
-- newly-added enum value inside the same transaction that added it ("unsafe
-- use of new value of enum type"), and this project already has precedent
-- for the same split (20260716113000_referral_status_add_waitlisted.sql,
-- followed by 20260716113500_specialist_referrals_waitlist_columns.sql).
-- Part 2b (immediately following) is the migration that actually uses these
-- two new values in CHECK constraints and trigger logic.

alter type public.alert_status add value 'snoozed';
alter type public.alert_status add value 'closed';
