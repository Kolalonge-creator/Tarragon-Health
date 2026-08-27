-- Fix for a gap in 20260730105131_v3_port_escalation_sla_config.sql, caught
-- 2026-08-27 by this project's first-ever from-scratch migration replay (new
-- CI job, "Supabase migration replay" — see .github/workflows/ci.yml). That
-- migration's own closing assertion failed on a fresh `supabase db reset`:
-- `anon` still had EXECUTE on `public.sign_escalation_slas(uuid)` despite an
-- explicit `revoke all on function public.sign_escalation_slas(uuid) from
-- public` right after the function's creation.
--
-- Checked live (project koiplnmbgnqnbywhpjlf): `anon` cannot execute this
-- function there today — `has_function_privilege('anon',
-- 'public.sign_escalation_slas(uuid)', 'EXECUTE')` returns false. So the
-- live database is not currently exposed; this closes the gap for every
-- environment built by replaying migration history from scratch (a fresh
-- local `supabase db reset`, CI, or a new project), which is exactly what
-- this project's own recurring "anon inherits EXECUTE via the PUBLIC
-- pseudo-grant" gotcha (see CLAUDE.md's standing engineering lessons) has
-- bitten before. Re-running this revoke is a safe no-op wherever the
-- privilege is already correctly closed.
revoke execute on function public.sign_escalation_slas(uuid) from public;
grant execute on function public.sign_escalation_slas(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.sign_escalation_slas(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can still execute public.sign_escalation_slas';
  end if;
  if not has_function_privilege('authenticated', 'public.sign_escalation_slas(uuid)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute public.sign_escalation_slas';
  end if;
  raise notice 'PASS: anon denied, authenticated allowed on public.sign_escalation_slas';
end $$;
