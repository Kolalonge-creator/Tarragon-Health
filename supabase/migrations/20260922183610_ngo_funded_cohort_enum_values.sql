-- NGO-funded cohort readiness, step 1 of 2: new enum values only.
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction as anything
-- that references the new value (see the specialist-referral auto-matching
-- migration's header for the same constraint) — so this is a standalone
-- migration. The tables, RLS, is_org_staff() exclusion, and RPCs that use
-- these values are the next migration.
alter type public.organisation_type add value if not exists 'ngo';
alter type public.user_role add value if not exists 'ngo_admin';
