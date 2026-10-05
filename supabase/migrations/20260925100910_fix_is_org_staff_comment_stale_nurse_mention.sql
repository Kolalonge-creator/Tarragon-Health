-- Tarragon Health — fix a doc-only inaccuracy a code review caught in
-- 20260925093444_enforce_profiles_is_active_in_core_authz.sql: that
-- migration's new comment on private.is_org_staff(uuid) said "clinician,
-- care_coordinator, nurse, and the admin super-user" — but `nurse` was
-- merged into `clinician` back in 20260705211611_merge_nurse_into_clinician.sql
-- and has not existed as a separate role since. The prior comment (from
-- 20260922184145_ngo_funded_cohort_schema.sql) did not mention nurse; this
-- was a new inaccuracy introduced while rewriting the comment, not one
-- carried forward. Comment-only change — the function body is untouched.

comment on function private.is_org_staff(uuid) is
  'Tarragon care-team and operations staff for an organisation: clinician '
  '(nurse was merged into this role, see 20260705211611_merge_nurse_into_clinician.sql), '
  'care_coordinator, and the admin super-user -- provided the account has '
  'not been deactivated (profiles.is_active). Institution admins (I9), partner '
  'employees (pharmacist, lab_partner, lab_liaison), back-office roles (finance, '
  'analyst), the two counterparty platform roles (payer_admin, '
  'provider_org_staff) and NGO/funding-partner admins (ngo_admin) are all '
  'excluded and are served by named grants or their own SECURITY DEFINER RPCs '
  'instead. is_active gate added 2026-09-25; see '
  '20260925093444_enforce_profiles_is_active_in_core_authz.sql for why this had '
  'never been enforced before despite the column existing.';
