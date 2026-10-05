-- clinical_staff_directory's `years_of_experience` column depends on
-- clinical_staff.years_of_experience, which was added by a DIFFERENT,
-- concurrently-developed, not-yet-merged branch's migration
-- (20260925012019_clinical_staff_years_of_experience.sql, on
-- fix/patient-facing-doctor-credibility) — applied to this shared live
-- project ahead of that branch merging, per this project's usual concurrent-
-- worktree-one-shared-database practice. This PR (clinical_staff column-
-- exposure fix) never actually needed years_of_experience in the safe-column
-- view — it was included speculatively "for the same kind of clinician-
-- profile display use case" — and CI's fresh migration replay (which only
-- sees migrations committed to THIS branch) correctly failed with
-- `column "years_of_experience" does not exist`, since that column's own
-- migration isn't part of this branch's history yet.
--
-- Fix: drop the column from the view rather than take a premature dependency
-- on the other branch's unmerged migration. CREATE OR REPLACE VIEW cannot
-- remove a column (even a trailing one) — Postgres requires the same column
-- set/order/types, only additions at the end are allowed — so this needs a
-- full DROP + CREATE, re-adding the comment and grants that DROP VIEW would
-- otherwise take with it.

drop view public.clinical_staff_directory;

create view public.clinical_staff_directory
  with (security_invoker = false)
  as
  select
    id,
    organisation_id,
    profile_id,
    full_name,
    photo_url,
    credential_type,
    credential_number,
    specialty,
    bio,
    active,
    doctor_tier,
    employment_type,
    offers_therapy_sessions
  from public.clinical_staff
  where organisation_id = private.current_org_id()
     or private.is_org_staff(organisation_id)
     or ((profile_id is not null) and private.can_support_view(profile_id))
     or coalesce(current_setting('role', true), '') = 'service_role'
     or coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';

comment on view public.clinical_staff_directory is
  'Safe-column subset of clinical_staff for patient/family-facing trust display (docs/CLINICAL_TRUST_MODEL_SPEC.md), plus internal service-role callers (cron/notification routes) that have no auth.uid() at all. Deliberately owner-run, not security_invoker: embeds its own org/staff/service-role predicate rather than inheriting the base table''s RLS, which no longer admits a patient. Never add indemnity_*/staff_number/verified_by/credential_verified_by/*_verified_at columns here.';

revoke all on public.clinical_staff_directory from public;
grant select on public.clinical_staff_directory to authenticated;
