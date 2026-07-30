-- Tarragon Health — the missing RLS auto-enable safety net, written for real.
--
-- 20260706033358_revoke_rls_auto_enable_execute.sql documented, but never
-- fixed, a real gap: public.rls_auto_enable() was created directly against
-- the ORIGINAL remote database, its DDL was never committed to this repo,
-- and the platform was rebuilt from migration history on 2026-07-29 without
-- it. That migration's own comment says so explicitly: "a rebuilt database
-- has NO rls_auto_enable event trigger... it must be written as a real
-- migration -- do not reconstruct it from this comment." This is that
-- migration. Every table created after this one applies is auto-enabled for
-- RLS the moment CREATE TABLE runs, closing the gap for good — a migration
-- author who forgets `enable row level security` no longer ships an
-- unprotected table by omission.
--
-- Design:
--   * Fires on ddl_command_end for CREATE TABLE (and CREATE TABLE AS / SELECT
--     INTO, which also create a table even though this codebase has never
--     used either — belt-and-suspenders for future migrations).
--   * Only touches the public schema. auth/storage/realtime/extensions
--     schemas are Supabase-managed and out of scope.
--   * Enables RLS, nothing more. It does NOT attach a policy (there is no
--     generic policy that would be correct for an arbitrary new table) and it
--     does NOT force RLS on table owners — enabling with zero policies is
--     default-deny for every role except the table owner, matching the
--     rls_enabled_no_policy INFO advisory already accepted elsewhere in this
--     schema (e.g. the finance_* tables, which are SECURITY DEFINER-RPC-only
--     by design). A migration that needs real policies still has to write
--     them; this only prevents the silent zero-protection case.
--   * Idempotent: `enable row level security` on an already-enabled table is
--     a harmless no-op, so a migration that also writes its own explicit
--     `alter table ... enable row level security` (the established, still-
--     correct pattern for every existing migration) is unaffected either way.
--
-- Keeps the function name public.rls_auto_enable() so the guard in
-- 20260706033358 (`where p.proname = 'rls_auto_enable'`) now finds and
-- revokes it going forward, same as it always intended to once the function
-- existed again.

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type = 'table'
  loop
    if r.schema_name = 'public' then
      execute format('alter table %s enable row level security', r.object_identity);
    end if;
  end loop;
end;
$$;

comment on function public.rls_auto_enable() is
  'Event-trigger function (ddl_command_end on CREATE TABLE). Auto-enables '
  'RLS on every new public-schema table the instant it is created, so a '
  'migration that forgets to enable RLS explicitly still ships default-deny '
  'rather than wide open. Never invoke directly — see the anon/public '
  'EXECUTE revokes below.';

drop event trigger if exists rls_auto_enable_trigger;

create event trigger rls_auto_enable_trigger
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();

-- This is an event-trigger function with no legitimate direct-invocation use
-- (flagged by Supabase's security advisor the same way the original,
-- out-of-band version of this function was). Close both loopholes in the same
-- migration this time rather than needing a follow-up: `revoke ... from
-- public` is what actually removes the PUBLIC pseudo-grant anon inherits
-- through in this project (confirmed repeatedly — 20260724020855,
-- 20260724163357, 20260727004156/20260729234532) — a bare `revoke ... from
-- anon` alone is a no-op when anon never held a direct grant.
revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon;

do $$
begin
  if not exists (
    select 1 from pg_event_trigger where evtname = 'rls_auto_enable_trigger'
  ) then
    raise exception 'rls_auto_enable_trigger was not created';
  end if;

  if (select evtenabled from pg_event_trigger where evtname = 'rls_auto_enable_trigger') <> 'O' then
    raise exception 'rls_auto_enable_trigger exists but is not enabled';
  end if;

  if has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE') then
    raise exception 'anon can still execute rls_auto_enable() — the revoke did not take';
  end if;
end $$;
