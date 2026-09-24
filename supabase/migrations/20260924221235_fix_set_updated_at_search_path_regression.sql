-- CORRECTS a regression introduced by
-- 20260924215642_fix_account_lockouts_anon_execute_and_backfill_migration_record.sql,
-- caught by /code-review high before that migration's PR merged. That
-- migration redefined private.set_updated_at() -- the shared updated_at
-- trigger reused by ~280 tables across the platform (originally defined in
-- 20260705211044_core_auth_multitenancy.sql) -- while copying in the
-- table-specific functions it actually meant to backfill, and dropped
-- `set search_path = ''` from the shared function in the process. Every
-- other function in that migration explicitly pins search_path; only this
-- one, redefined for no reason the migration needed, silently lost it.
--
-- The live function was corrected immediately on discovery (same session,
-- before any dependent trigger fired with the regressed version) -- this is
-- the matching git record for that live correction, kept as its own
-- migration rather than editing the original file, so this file's content
-- matches exactly what supabase_migrations.schema_migrations recorded for
-- each version.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_proc
    where pronamespace = 'private'::regnamespace
      and proname = 'set_updated_at'
      and array_to_string(proconfig, ',') like '%search_path=%'
  ) then
    raise exception 'private.set_updated_at() must have search_path pinned';
  end if;
end $$;
