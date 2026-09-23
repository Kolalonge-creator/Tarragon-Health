-- The repo's Release Integrity CI (check-anon-security-definer-execute.mjs)
-- flagged 3 SECURITY DEFINER functions as anon-executable, none of them on
-- the deliberate ALLOWLIST: private.ai_required_evaluation_status(uuid),
-- private.is_active_clinical_director(), and
-- public.finance_reverse_journal(uuid, text). This is the recurring
-- anon-inherits-EXECUTE-via-PUBLIC bug documented in that script's own
-- header and the supabase-anon-execute-gotcha memory: each function's
-- migration granted EXECUTE to authenticated without first revoking the
-- implicit PUBLIC grant every newly created function carries, so `anon`
-- (a fully unauthenticated caller) inherited EXECUTE through the PUBLIC
-- pseudo-role. Confirmed live via `has_function_privilege('anon', ...,
-- 'EXECUTE')` before this migration: true for all three.
--
-- None of the three appear to have been reachable to real harm --
-- is_active_clinical_director() reads auth.uid() (null for anon, so it
-- just returns false), and finance_reverse_journal() gates internally on
-- private.finance_can('finance.gl.post') before doing anything -- but
-- letting an unauthenticated caller invoke internal AI-governance and
-- money-moving functions at all is exactly the defense-in-depth gap this
-- check exists to close, and finance_reverse_journal in particular is a
-- live journal-reversal RPC that should never depend solely on its own
-- internal gate holding correctly.
--
-- Fixed the standard way (per the gotcha memory): revoke from public AND
-- anon directly (in case of a stray direct grant), then re-grant only to
-- authenticated. service_role already has its own unconditional grant and
-- is untouched. Not added to the ALLOWLIST -- none of these are meant to
-- be anon-executable by design.
revoke all on function private.ai_required_evaluation_status(uuid) from public, anon;
grant execute on function private.ai_required_evaluation_status(uuid) to authenticated;

revoke all on function private.is_active_clinical_director() from public, anon;
grant execute on function private.is_active_clinical_director() to authenticated;

revoke all on function public.finance_reverse_journal(uuid, text) from public, anon;
grant execute on function public.finance_reverse_journal(uuid, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'private.ai_required_evaluation_status(uuid)', 'EXECUTE') then
    raise exception 'anon can still execute private.ai_required_evaluation_status';
  end if;
  if has_function_privilege('anon', 'private.is_active_clinical_director()', 'EXECUTE') then
    raise exception 'anon can still execute private.is_active_clinical_director';
  end if;
  if has_function_privilege('anon', 'public.finance_reverse_journal(uuid, text)', 'EXECUTE') then
    raise exception 'anon can still execute public.finance_reverse_journal';
  end if;
  if not has_function_privilege('authenticated', 'private.ai_required_evaluation_status(uuid)', 'EXECUTE') then
    raise exception 'authenticated lost EXECUTE on private.ai_required_evaluation_status';
  end if;
  if not has_function_privilege('authenticated', 'private.is_active_clinical_director()', 'EXECUTE') then
    raise exception 'authenticated lost EXECUTE on private.is_active_clinical_director';
  end if;
  if not has_function_privilege('authenticated', 'public.finance_reverse_journal(uuid, text)', 'EXECUTE') then
    raise exception 'authenticated lost EXECUTE on public.finance_reverse_journal';
  end if;
end $$;
