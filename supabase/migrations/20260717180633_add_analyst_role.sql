-- Tarragon Health — 'analyst' account role (Platform Analytics & Audit Console)
--
-- Tarragon HQ needs a company-wide, cross-organisation view for business,
-- financial, and population-health analytics plus an audit-log viewer, kept
-- SEPARATE from the org-scoped 'admin' role. An 'analyst' is NOT org staff and
-- gets NO broad RLS grants: every byte it reads flows through vetted
-- SECURITY DEFINER aggregation RPCs gated by private.is_analyst() (see the next
-- migration). This migration only adds the enum value, in its own transaction,
-- because a new enum value can't be used in the same transaction that adds it
-- (same split used for the 'pharmacist' role, 20260716177000). Idempotent via
-- ADD VALUE IF NOT EXISTS.

alter type public.user_role add value if not exists 'analyst';
