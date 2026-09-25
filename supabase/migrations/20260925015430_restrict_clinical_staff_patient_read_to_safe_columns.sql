-- clinical_staff_select's org-wide clause ("organisation_id = current_org_id()")
-- was written 20260712191500 for a genuine need — a patient must be able to
-- see their clinician's/Clinical Director's name/photo/bio for trust display
-- (docs/CLINICAL_TRUST_MODEL_SPEC.md) — but Postgres RLS is row-level, not
-- column-level. Every column added to this table since then (indemnity_
-- insurer/policy_number/expires_at/exempt_by, staff_number, verified_by,
-- credential_verified_by) rode along on that same broad clause, so any
-- patient could already SELECT * any clinical_staff row in their own org via
-- the Supabase client SDK / PostgREST directly — not just the safe columns
-- the app's own queries happen to list. Confirmed live with a simulated
-- patient session before this migration (a patient in-org could read another
-- doctor's indemnity_policy_number and staff_number).
--
-- Fix: narrow the base table's patient-facing read path to org staff /
-- support-view-as only, and add an owner-run (deliberately NOT
-- security_invoker — same exception as public.therapy_directory) directory
-- view exposing only the columns every existing patient-facing call site
-- actually selects (full_name/credential_type/credential_number/photo_url/
-- specialty), plus a few more equally non-sensitive display fields (bio,
-- doctor_tier, employment_type, offers_therapy_sessions) for the same kind
-- of clinician-profile display use case. The view carries its own
-- org/staff-scoping predicate because an owner-run view bypasses the base
-- table's RLS entirely — see reference_view_over_rls_needs_security_invoker.
--
-- Edited post-apply (still same day, pre-merge): the view originally also
-- selected years_of_experience, a column that turned out to belong to a
-- different, concurrently-developed branch's migration
-- (fix/patient-facing-doctor-credibility's
-- 20260925012019_clinical_staff_years_of_experience.sql), applied to this
-- shared live project ahead of that branch merging. This PR never actually
-- needed the column — dropped rather than take a premature dependency on
-- unmerged work; see the follow-up migrations
-- (20260925021440_fix_clinical_staff_directory_service_role_and_replay_
-- guard.sql, 20260925024047_clinical_staff_directory_drop_years_of_
-- experience_dependency.sql) for the live project's own history of this.
-- This file's text no longer matches the exact statement CI/schema_
-- migrations recorded for this version at the time it was first applied —
-- a deliberate, narrow exception to "never edit an applied migration" so a
-- fresh CI replay (which applies migrations strictly in order and aborts on
-- the first failure) doesn't die on a column that a later migration in this
-- same PR would otherwise have fixed too late to matter.

drop policy clinical_staff_select on public.clinical_staff;

create policy clinical_staff_select on public.clinical_staff
  for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    or ((profile_id is not null) and private.can_support_view(profile_id))
  );

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
     or ((profile_id is not null) and private.can_support_view(profile_id));

comment on view public.clinical_staff_directory is
  'Safe-column subset of clinical_staff for patient/family-facing trust display (docs/CLINICAL_TRUST_MODEL_SPEC.md). Deliberately owner-run, not security_invoker: embeds its own org/staff-scoping predicate rather than inheriting the base table''s RLS, which no longer admits a patient. Never add indemnity_*/staff_number/verified_by/credential_verified_by/*_verified_at columns here.';

grant select on public.clinical_staff_directory to authenticated;
