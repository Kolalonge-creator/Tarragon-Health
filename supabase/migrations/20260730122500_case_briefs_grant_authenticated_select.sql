-- Tarragon Health
-- Real bug caught live-verifying case_briefs (Phase 3 of the doctor-
-- efficiency initiative): RLS policies restrict ROWS, they don't grant
-- table-level access at all. The prior migration created case_briefs +
-- its SELECT policy but never granted the underlying SQL privilege --
-- Supabase only auto-provisions `authenticated`'s base table grants at
-- project creation, not for tables added later via migration (same class
-- of gap this codebase's M1 sprint hit: "authenticated had no base
-- table-level GRANT after the schema reset"). Confirmed live: a
-- JWT-simulated authenticated read of case_briefs failed with
-- `permission denied for table case_briefs` before this grant, and
-- succeeded after.

grant select on public.case_briefs to authenticated;
