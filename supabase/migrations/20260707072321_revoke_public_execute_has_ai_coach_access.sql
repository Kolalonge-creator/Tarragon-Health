-- Tarragon Health
-- Same issue as 20260706033358_revoke_rls_auto_enable_execute.sql: CREATE
-- FUNCTION grants EXECUTE to PUBLIC by default, so public.has_ai_coach_access()
-- (20260707020000) was callable by the anon role even though only
-- `authenticated` was ever explicitly granted — flagged by Supabase's
-- security advisor (anon_security_definer_function_executable). The
-- function is harmless for anon callers today (every internal lookup keys
-- off auth.uid(), which is null for anon, so it just returns false), but an
-- anonymous caller has no business invoking a security-definer function at
-- all, so tighten it explicitly rather than relying on that being true.
revoke execute on function public.has_ai_coach_access() from public;
grant execute on function public.has_ai_coach_access() to authenticated;
