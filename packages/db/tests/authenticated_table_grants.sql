-- Guards the bug class fixed by
-- 20260801090000_fix_missing_authenticated_table_grants.sql.
--
-- RLS policies restrict rows; they do not grant table access. A table created
-- by a migration used to be born with no `authenticated` grant at all, so a
-- carefully written policy governed nothing and PostgREST returned
-- `42501 permission denied` — which supabase-js surfaces as an empty result.
-- The UI then renders a confident, wrong zero rather than an error, which is
-- how the Health Wallet showed a ₦0 balance against real money for weeks.
--
-- Run inside a transaction and roll back; the probe table never persists.
--   npx supabase db query --linked -f packages/db/tests/authenticated_table_grants.sql

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;

-- 1. Every RLS-enabled table carries the privilege its own policies imply.
--    A SELECT-only policy needs only SELECT; no policy for an action means no
--    grant is expected for it. This can never demand an over-grant.
--
--    has_table_privilege() alone is not sufficient here: a table that has
--    been deliberately narrowed to column-level grants (e.g.
--    wearable_connections, see 20260808030359_wearable_pull_ingestion.sql,
--    which revokes the table-wide grant and grants SELECT/INSERT/UPDATE on
--    only the non-credential columns so `authenticated` can never read
--    access_token/refresh_token) reports false on has_table_privilege for
--    every action even though the app can do exactly what its policy
--    intends, on the columns it's meant to touch. A false failure here is
--    exactly as misleading as a missed real one, so this check accepts
--    either a table-level grant OR privilege on at least one column as
--    proof the action isn't silently ungranted.
insert into results
select 'no RLS table missing the privilege its policy implies',
       'NONE',
       coalesce(string_agg(distinct tbl || ':' || action, ', '), 'NONE')
from (
  select c.relname as tbl, x.action
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
    cross join lateral (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) as x(action)
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relrowsecurity
     and (p.roles && array['authenticated','public']::name[])
     and p.cmd in ('ALL', x.action)
     and not has_table_privilege('authenticated','public.'||quote_ident(c.relname), x.action)
     and not exists (
       -- Column-level privileges exist for SELECT/INSERT/UPDATE only; asking
       -- has_column_privilege for DELETE raises 22023 "unrecognized privilege
       -- type" and aborts the whole file, which is why this check had never
       -- once run to completion. For DELETE the table-level test above is the
       -- only possible answer, and a DELETE policy with no DELETE grant is a
       -- policy governing nothing -- exactly the bug class this file guards.
       select 1 from information_schema.columns col
        where x.action <> 'DELETE'
          and col.table_schema = 'public' and col.table_name = c.relname
          and has_column_privilege('authenticated', 'public.'||quote_ident(c.relname), col.column_name, x.action)
     )
   group by c.relname, x.action
) s;

-- 2. The root fix: a new table must be reachable the moment it is created,
--    with no GRANT statement written by hand. This is the check that actually
--    prevents recurrence — the backfill above only fixes today.
create table public.zz_grant_probe(id uuid primary key default gen_random_uuid());

insert into results
select 'a new table is auto-granted to authenticated', 'true',
       has_table_privilege('authenticated','public.zz_grant_probe','SELECT')::text;

-- 3. …and simultaneously RLS-protected, by the rls_auto_enable event trigger
--    (20260729235803). Reachable without RLS would be far worse than the bug
--    this file guards. The two halves must hold together.
insert into results
select 'a new table is auto-RLS-enabled', 'true',
       (select relrowsecurity from pg_class where oid = 'public.zz_grant_probe'::regclass)::text;

-- 4. anon is deliberately excluded from the default. Public exposure on this
--    platform is always a specific decision, never a default.
insert into results
select 'a new table is NOT exposed to anon', 'false',
       has_table_privilege('anon','public.zz_grant_probe','SELECT')::text;

drop table public.zz_grant_probe;

select check_name,
       expected,
       actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results;

do $$
declare v_fail int;
begin
  select count(*) into v_fail from results where expected <> actual;
  if v_fail > 0 then
    raise exception '% grant check(s) failed', v_fail;
  end if;
end $$;

rollback;
