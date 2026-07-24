-- Tarragon Health — surface the Care Coordinator as a named person.
--
-- care_team_assignment already carries the patient's named doctor and the
-- supervising Clinical Director; this adds the third (non-clinical) member so
-- the patient-facing "Your care team" card can show a real coordinator by
-- name — the Maven "Care Advocate" pattern. Null-gated exactly like the
-- doctor line: no assignment, no claim. The coordinator remains logistics-only
-- (tier-ladder rule); this is purely visibility, not authority.

alter table public.care_team_assignment
  add column if not exists care_coordinator_id uuid references public.profiles (id) on delete set null;
