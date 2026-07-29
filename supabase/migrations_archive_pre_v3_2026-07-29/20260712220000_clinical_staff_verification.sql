-- Tarragon Health
-- clinical_staff license verification — docs/CLINICAL_TRUST_MODEL_SPEC.md
-- §5: "License verification, not self-attestation." Structural guarantees,
-- not just app-layer checks:
--   1. A record can't be active until license_verified_at is set — no
--      clinician/doctor can appear in care-team assignment, protocol
--      signing, or attribution UI unmarked as verified.
--   2. verified_by can never equal the record's own profile_id — the
--      clinician/doctor being verified cannot be the one who verified them.
-- verified_by references profiles (the admin who performed the check), not
-- clinical_staff, since verification is an action taken by a logged-in
-- staff account — same rationale as escalations.reviewed_by.

alter table public.clinical_staff
  add column verified_by uuid references public.profiles (id) on delete set null;

alter table public.clinical_staff
  add constraint clinical_staff_active_requires_verification
  check (not active or license_verified_at is not null);

alter table public.clinical_staff
  add constraint clinical_staff_no_self_verification
  check (verified_by is null or profile_id is null or verified_by <> profile_id);
