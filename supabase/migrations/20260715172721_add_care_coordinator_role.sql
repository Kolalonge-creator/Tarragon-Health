-- Tarragon Health
-- Care Coordinator becomes a distinct account/login type —
-- docs/Tarragon_Health_Master_Operating_Plan_v4.md §4. Non-clinical staff:
-- adherence/logistics only, never medications/escalation-resolution/
-- protocol-signing write access — that restriction is enforced at the
-- app/server-action layer (see CLAUDE.md's Clinical Tier Ladder section),
-- not here; is_org_staff() still treats this role as org staff for read
-- access and org-boundary purposes, matching how every other staff role
-- already works.
--
-- Own migration file: Postgres forbids using a freshly-added enum value in
-- the same transaction that adds it (same reason
-- 20260713140000_stripe_payment_transaction_type.sql is its own file).

alter type public.user_role add value 'care_coordinator';
