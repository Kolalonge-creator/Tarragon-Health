-- Tarragon Health
-- Revoking from PUBLIC (20260707020100) didn't clear the anon grant: this
-- project has a default-privileges rule that grants EXECUTE on new public-
-- schema functions to anon/authenticated/service_role directly (not via the
-- PUBLIC pseudo-role), confirmed via information_schema.role_routine_grants.
-- Revoke anon specifically — only `authenticated` should ever call this.
revoke execute on function public.has_ai_coach_access() from anon;
