-- ===========================================================================
-- Standing proof (S04b-1): no table that holds a patient can silently escape the under-18 dependant scope guard.
--
-- Every public base table with a patient_id column (and the four profile_id tables the guard also covers) must be
-- listed in public.minor_dependant_table_policy as exactly one of:
--   guarded  - has the 00_minor_dependant_scope trigger (install with private.guard_minor_dependant_table('<table>'))
--   allowed  - immunisation or preventive tracking; no trigger
--   exempt   - system, data-rights or safety table; no trigger; give a reason
-- A later migration that adds such a table without doing one of these fails this proof, which is the point.
-- Sabotage: an unclassified table and a guarded table with its trigger dropped must both be caught.
-- ===========================================================================
begin;

create function pg_temp.problems() returns text language sql as $$
  with scoped as (
    select distinct c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public'
       and (c.column_name = 'patient_id'
            or (c.column_name = 'profile_id'
                and c.table_name in ('booking_requests', 'risk_assessment_responses', 'prevention_risk_scores', 'ai_conversations')))
  ),
  has_trigger as (
    select c.relname as table_name
      from pg_trigger g join pg_class c on c.oid = g.tgrelid
     where g.tgname = '00_minor_dependant_scope' and not g.tgisinternal
  )
  select string_agg(problem, '; ' order by problem) from (
    select s.table_name || ' is not in minor_dependant_table_policy' as problem
      from scoped s left join public.minor_dependant_table_policy p using (table_name)
     where p.table_name is null
    union all
    select p.table_name || ' is listed guarded but has no 00_minor_dependant_scope trigger'
      from public.minor_dependant_table_policy p
     where p.policy = 'guarded' and exists (select 1 from scoped s where s.table_name = p.table_name)
       and not exists (select 1 from has_trigger h where h.table_name = p.table_name)
    union all
    select p.table_name || ' is listed ' || p.policy || ' but is guarded'
      from public.minor_dependant_table_policy p
     where p.policy <> 'guarded' and exists (select 1 from has_trigger h where h.table_name = p.table_name)
  ) q;
$$;

do $$
declare v text;
begin
  v := pg_temp.problems();
  if v is not null then
    raise exception 'FAIL: under-18 dependant scope is incomplete. Classify each table in minor_dependant_table_policy (use private.guard_minor_dependant_table for clinical tables): %', v;
  end if;
  if (select count(*) from public.minor_dependant_table_policy where policy = 'guarded') < 200 then
    raise exception 'FAIL: suspiciously few guarded tables';
  end if;
end $$;

-- SABOTAGE 1: a new patient table nobody classified must be caught
-- S04b-1e guards a new patient_id table the moment it is created; this proof needs an UNCLASSIFIED one to test the check itself, so it turns the event trigger off (rolled back with the rest).
alter event trigger guard_new_patient_tables_trigger disable;
create table public.zz_s04b1_unclassified (id uuid primary key default gen_random_uuid(), patient_id uuid);
do $$
begin
  if pg_temp.problems() is null or pg_temp.problems() not like '%zz_s04b1_unclassified is not in minor_dependant_table_policy%' then
    raise exception 'SABOTAGE 1: an unclassified patient_id table was not caught';
  end if;
end $$;
select private.guard_minor_dependant_table('zz_s04b1_unclassified');
do $$
begin
  if pg_temp.problems() is not null then raise exception 'SABOTAGE 1: guarding the table did not satisfy the check: %', pg_temp.problems(); end if;
end $$;

-- SABOTAGE 2: a guarded table whose trigger was dropped must be caught
drop trigger "00_minor_dependant_scope" on public.zz_s04b1_unclassified;
do $$
begin
  if pg_temp.problems() is null then raise exception 'SABOTAGE 2: a guarded table without its trigger was not caught'; end if;
end $$;

rollback;
