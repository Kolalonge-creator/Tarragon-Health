-- Fixes 20260827195333_record_corrections_platform_wide.sql's stated
-- intent ("No insert/update/delete grant to authenticated at all") which
-- was never actually enforced: this project auto-grants select/insert/
-- update/delete to `authenticated` on every newly created public-schema
-- table via an `alter default privileges` rule (the same mechanism CLAUDE.md
-- documents as having silently broken/granted access before). record_
-- corrections inherited that grant at CREATE TABLE time; the migration's own
-- `grant select ...` only ADDED to it, never revoked insert/update/delete.
--
-- Currently still safe in practice -- RLS has zero INSERT/UPDATE/DELETE
-- policies on this table, and Postgres's row-security default-deny means an
-- authenticated client's INSERT is rejected (raises) and UPDATE/DELETE
-- silently affect 0 rows -- confirmed by testing. But relying solely on
-- "no policy happens to exist" as the only barrier is fragile: explicitly
-- revoking matches the stated design and adds a second, independent layer
-- that doesn't depend on nobody ever adding a policy here by mistake.

revoke insert, update, delete on public.record_corrections from authenticated;

do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'record_corrections'
    and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if v_count <> 0 then
    raise exception 'FAIL: authenticated still has % of INSERT/UPDATE/DELETE on record_corrections', v_count;
  end if;
  raise notice 'PASS: authenticated no longer has INSERT/UPDATE/DELETE on record_corrections';
end $$;
