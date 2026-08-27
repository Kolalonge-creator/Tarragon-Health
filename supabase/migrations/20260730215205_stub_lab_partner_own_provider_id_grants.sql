-- Local/CI-only fix-forward, NOT a functional migration: see
-- supabase/roles.sql's header ("STATUS (2026-08-27)") for the full anon-
-- execute background. This one function couldn't be pre-stubbed in
-- roles.sql like sign_escalation_slas / admin_broadcast_content_check /
-- admin_send_broadcast were, because 20260729234618_harden_is_org_staff_
-- exclude_lab_partner.sql (which runs BEFORE this file) asserts "exactly 3"
-- public.lab_partner_* functions exist and that all of them are SECURITY
-- DEFINER -- a roles.sql stub exists before every migration and made that
-- count 4, failing a real, correct assertion (confirmed via CI). Placing
-- this one second before its real consumer,
-- 20260730215206_facilities_lab_partner_self_service.sql, means it doesn't
-- exist yet when 20260729234618 counts, and already has the correct final
-- grants (matching the live project's real state) by the time
-- 20260730215206's own CREATE OR REPLACE FUNCTION runs -- which, per
-- Postgres semantics, preserves an existing function's ACL rather than
-- resetting it, so that migration's own anon-execute assertion passes
-- regardless of whatever mechanism caused the original gap on a fresh
-- local/CI replay (the live project itself already has these grants
-- correct; see roles.sql).
--
-- MUST be a no-op on the live project, where this function already exists
-- (real, working body, created by 20260730215206 long ago) -- an
-- unconditional CREATE OR REPLACE here would silently overwrite that real
-- body with this stub's dummy one the moment this migration reaches
-- production. Guarded so it only ever creates anything on a database where
-- the function doesn't exist yet (a fresh reset stopping exactly here).
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'lab_partner_own_provider_id'
  ) then
    execute $create$
      create function public.lab_partner_own_provider_id()
      returns uuid
      language plpgsql
      security definer
      set search_path = ''
      as $body$
      begin
        return null;
      end;
      $body$;
    $create$;

    execute 'revoke all on function public.lab_partner_own_provider_id() from public';
    execute 'revoke all on function public.lab_partner_own_provider_id() from anon';
    execute 'grant execute on function public.lab_partner_own_provider_id() to authenticated';
  end if;
end $$;
