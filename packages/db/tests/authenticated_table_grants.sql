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
