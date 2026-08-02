-- Every table a migration creates in `public` is born unreachable by a real
-- logged-in user, and has been for the life of this project.
--
-- ROOT CAUSE, confirmed against pg_default_acl rather than guessed at: the
-- default privileges for tables created by `postgres` in schema `public` are
--     {postgres=arwdDxtm/postgres, service_role=arwdDxtm/postgres}
-- with `authenticated` absent. Compare the `storage` schema on the same
-- project, which Supabase provisions as
--     {postgres=…, anon=…, authenticated=…, service_role=…}
--
-- So a table created through the dashboard at project bootstrap is reachable,
-- and a table created by `create table` in a migration is not. RLS policies
-- restrict *rows*; they do not grant *table access*. A carefully written
-- policy on an ungranted table therefore governs nothing, and PostgREST
-- returns `42501 permission denied` — which supabase-js surfaces as an empty
-- result, so the UI renders a confident, wrong zero instead of an error.
--
-- This is the third time this class has been fixed one table at a time
-- (M1 sprint, then `case_briefs`). It is fixed at the root here so there is
-- no fourth.
--
-- Deliberately NOT granting to `anon`. Public exposure on this platform is
-- always a specific decision (the three marketing RPCs, published resources),
-- never a default. `patient_testimonials` carries an anon SELECT policy that
-- does nothing today; marketing reads it through a service-role client
-- instead. Making that policy live would add real public exposure with no
-- consumer asking for it, so it is left alone and flagged rather than
-- silently switched on.

-- 1. THE ROOT FIX -----------------------------------------------------------
-- Every future table in `public` is reachable by `authenticated` the moment it
-- is created, exactly as `storage` already behaves. Paired with the existing
-- `rls_auto_enable` event trigger (20260729235803), a newly created table is
-- now both RLS-protected and reachable: the two halves finally agree. Without
-- RLS a table would still be default-deny to `authenticated` only if RLS were
-- on, which is precisely what that event trigger guarantees.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated;

-- 2. BACKFILL ---------------------------------------------------------------
-- Grant existing tables exactly what their own policies already imply, rather
-- than a blanket grant. A table with only a SELECT policy gets only SELECT.
-- This is strictly tighter than the platform default above and cannot
-- over-grant: no policy for an action means no grant for that action.
do $$
declare
  r record;
  v_granted int := 0;
begin
  for r in
    select c.relname as tbl,
           bool_or(p.cmd in ('ALL','SELECT')) as need_select,
           bool_or(p.cmd in ('ALL','INSERT')) as need_insert,
           bool_or(p.cmd in ('ALL','UPDATE')) as need_update,
           bool_or(p.cmd in ('ALL','DELETE')) as need_delete
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relrowsecurity
       -- only policies that an ordinary signed-in caller could ever satisfy
       and (p.roles && array['authenticated','public']::name[])
     group by c.relname
  loop
    if r.need_select and not has_table_privilege('authenticated','public.'||quote_ident(r.tbl),'SELECT') then
      execute format('grant select on public.%I to authenticated', r.tbl);
      v_granted := v_granted + 1;
    end if;
    if r.need_insert and not has_table_privilege('authenticated','public.'||quote_ident(r.tbl),'INSERT') then
      execute format('grant insert on public.%I to authenticated', r.tbl);
      v_granted := v_granted + 1;
    end if;
    if r.need_update and not has_table_privilege('authenticated','public.'||quote_ident(r.tbl),'UPDATE') then
      execute format('grant update on public.%I to authenticated', r.tbl);
      v_granted := v_granted + 1;
    end if;
    if r.need_delete and not has_table_privilege('authenticated','public.'||quote_ident(r.tbl),'DELETE') then
      execute format('grant delete on public.%I to authenticated', r.tbl);
      v_granted := v_granted + 1;
    end if;
  end loop;
  raise notice 'granted % missing privilege(s)', v_granted;
end $$;

-- 3. ASSERT -----------------------------------------------------------------
-- The migration is the test. If any RLS-enabled table still carries a policy
-- an ordinary caller could satisfy but lacks the privilege to attempt it, this
-- fails and nothing is applied.
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s:%s', tbl, action), ', ')
    into v_bad
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

  if v_bad is not null then
    raise exception 'RLS-enabled tables still missing the privilege their policy implies: %', v_bad;
  end if;
end $$;
