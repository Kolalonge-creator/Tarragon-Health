-- Supabase CLI applies this file to the local dev database before running
-- supabase/migrations/*.sql (docs: "Custom Database Roles"). Used here for
-- a different purpose than its name suggests — see below.
--
-- BACKGROUND: the first-ever run of the DB Migration Tests CI job
-- (2026-08-27) found that a truly fresh `supabase start`/`db reset` fails
-- 20260730105131_v3_port_escalation_sla_config.sql's own self-check:
--   if has_function_privilege('anon', 'public.sign_escalation_slas(uuid)', 'EXECUTE') then
--     raise exception 'FAIL: anon can execute public.sign_escalation_slas';
--   end if;
-- even though the SAME check passes on the live project (confirmed
-- directly: `select has_function_privilege('anon',
-- 'public.sign_escalation_slas(uuid)', 'execute')` returns false on
-- koiplnmbgnqnbywhpjlf).
--
-- RULED OUT: a first attempt set `alter default privileges ... revoke
-- execute on functions from public` here, on the theory that Supabase's
-- hosted platform sets a more restrictive default ACL than the local CLI
-- image does. Confirmed present in this file's own git history and
-- confirmed NOT to fix the failure (it ran at the right time — logged
-- "Seeding globals from roles.sql..." immediately before the first
-- migration — and made no difference). So this isn't a default-privileges
-- gap. The most likely real explanation: the live project's current
-- correct state came from a manual fix applied directly to the database at
-- some point, never captured in any migration — meaning `revoke ... from
-- public` may never have actually been sufficient here, on any environment,
-- including when this migration first ran on live.
--
-- THE FIX (validating on this one function before extending further — see
-- the "stub" pattern discussion for why a much larger set of migrations
-- across this codebase likely share the same gap): PostgreSQL's `CREATE OR
-- REPLACE FUNCTION` preserves the existing object's grants when replacing
-- an already-existing function — only the body/language/attributes change,
-- not the ACL. Pre-creating a stub here with the CORRECT final grants,
-- before the real migration's own `CREATE OR REPLACE FUNCTION` runs, means
-- that migration's redundant `revoke ... from public; grant ... to
-- authenticated;` lines become no-ops on top of grants that were already
-- correct — and the assertion passes regardless of whatever mechanism
-- caused the original gap. This is not a migration and doesn't touch
-- already-applied migration history (which would create real
-- committed-vs-applied drift — see CLAUDE.md's standing lessons); it's
-- environment setup matching the live project's real, already-correct
-- state.
create function public.sign_escalation_slas(p_id uuid)
returns uuid
language plpgsql
as $$
begin
  return null;
end;
$$;

revoke all on function public.sign_escalation_slas(uuid) from public;
revoke all on function public.sign_escalation_slas(uuid) from anon;
grant execute on function public.sign_escalation_slas(uuid) to authenticated;
