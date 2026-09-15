-- Tarragon Health — referral_urgency gains a fourth tier: emergency.
--
-- Split into its own migration: adding an enum value and using it in the
-- same transaction raises 55P04 (same restriction the codebase already hit
-- for referral_status's 'waitlisted' value — see
-- 20260716113000_referral_status_add_waitlisted.sql).
--
-- routine/priority/urgent are untouched — no rename, nothing that already
-- reads 'priority' breaks. emergency sits above urgent, for a referral
-- originating from an emergency/urgent assessment (67.5): the
-- referral-letter document already special-cased
-- `data.urgency === "emergency"` for its URGENT banner
-- (apps/web/src/lib/referrals/referral-letter-document.tsx) before this
-- value could ever be set, so this closes a gap that was already anticipated
-- there rather than introducing a new concept.

alter type public.referral_urgency add value if not exists 'emergency';
