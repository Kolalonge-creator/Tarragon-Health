-- Tarragon Health — Patient Identity & MPI gap analysis (docs/PATIENT_IDENTITY_MPI_SPEC.md §3)
-- Two new delegable permission keys for the identity-integrity tools added by the companion
-- migrations in this batch. Both default to super-admin-only in practice: nothing in this
-- migration grants either key to any non-admin role, and private.has_permission() already treats
-- 'admin' as holding every capability implicitly — a super admin must deliberately grant one of
-- these to a specific member via the existing Members & access screen before anyone else can
-- touch duplicate-review or merge, matching the "the founder, manually, at current patient
-- volume" default the gap-analysis doc's open questions section landed on.

insert into public.permissions (key, label, category, description) values
  ('patients.duplicates.review', 'Review duplicate patients', 'Patient identity', 'See and dismiss flagged possible-duplicate patient records'),
  ('patients.merge', 'Merge patient records', 'Patient identity', 'Merge two duplicate patient records into one, repointing their history')
on conflict (key) do nothing;
