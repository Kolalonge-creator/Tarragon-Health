-- S04b-1e: a new patient table is guarded for an under-18 dependant by default.
--
-- Why: the under-18 scope guard (S04b-1, founder rule 2026-10-13: a dependant under 18 holds immunisation and preventive tracking only) was
-- installed by a one-off migration over the tables that existed then. Every table added later had to remember to call
-- private.guard_minor_dependant_table() itself, and the ones that forgot reached production unguarded: 11 tables found by S04b-1b on 2026-10-13
-- and 12 more by S04b-1c on 2026-10-14. Release Integrity finds them after the fact; this removes the cause.
--
-- What: an event trigger (the same mechanism as rls_auto_enable, 20260729235803) that fires after CREATE TABLE, CREATE TABLE AS, SELECT INTO
-- and ALTER TABLE, and guards any public table that now has a patient_id column and no row in minor_dependant_table_policy. The guard is
-- the stricter default (deny); it never exempts anything on its own.
--
-- A migration that really needs a table to stay writable for a child (a system, data-rights or safety table), or that holds immunisation or
-- preventive-tracking rows, classifies it after creating it with private.classify_minor_dependant_table(table, 'allowed'|'exempt', reason),
-- which records the policy and removes the trigger. Do not rely on `insert ... on conflict do nothing`: the table is already recorded as guarded by then.
--
-- The four profile_id tables the guard also covers are unchanged (they are named explicitly in S04b-1). Idempotent. Declares no transaction.

create or replace function private.guard_new_patient_tables()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_table text;
begin
  for r in
    select objid from pg_event_trigger_ddl_commands()
     where object_type = 'table' and schema_name = 'public'
  loop
    select c.relname::text into v_table
      from pg_class c
     where c.oid = r.objid and c.relkind in ('r', 'p') and not c.relispartition;
    if v_table is null then continue; end if;
    if exists (select 1 from pg_attribute a where a.attrelid = r.objid and a.attname = 'patient_id' and not a.attisdropped)
       and not exists (select 1 from public.minor_dependant_table_policy p where p.table_name = v_table) then
      perform private.guard_minor_dependant_table(v_table, 'patient_id');
      raise notice 'S04b-1e: guarded new patient table % for under-18 dependants (use private.classify_minor_dependant_table to allow or exempt it)', v_table;
    end if;
  end loop;
end;
$$;
revoke all on function private.guard_new_patient_tables() from public, anon, authenticated;
comment on function private.guard_new_patient_tables() is
  'S04b-1e event-trigger function: guards a public table that gains a patient_id column and is not yet in minor_dependant_table_policy. Never invoke directly.';

create or replace function private.classify_minor_dependant_table(p_table text, p_policy text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_policy not in ('allowed', 'exempt') then
    raise exception 'classify_minor_dependant_table: policy must be allowed or exempt (guarded is the default and is set by guard_minor_dependant_table), got %', p_policy;
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'classify_minor_dependant_table: a reason is required';
  end if;
  insert into public.minor_dependant_table_policy (table_name, policy, reason)
  values (p_table, p_policy, p_reason)
  on conflict (table_name) do update set policy = excluded.policy, reason = excluded.reason;
  if to_regclass(format('public.%I', p_table)) is not null then
    execute format('drop trigger if exists "00_minor_dependant_scope" on public.%I', p_table);
  end if;
end;
$$;
revoke all on function private.classify_minor_dependant_table(text, text, text) from public, anon, authenticated;
comment on function private.classify_minor_dependant_table(text, text, text) is
  'S04b-1e: record a table as allowed (immunisation or preventive tracking) or exempt (system, data-rights, safety) for under-18 dependants and remove its guard trigger. Run it after creating the table, with a reason.';

drop event trigger if exists guard_new_patient_tables_trigger;
create event trigger guard_new_patient_tables_trigger
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE')
  execute function private.guard_new_patient_tables();

do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'guard_new_patient_tables_trigger' and evtenabled = 'O') then
    raise exception 'S04b-1e: the guard_new_patient_tables_trigger event trigger is not enabled';
  end if;
  if exists (select 1 from private.minor_guard_gaps()) then
    raise exception 'S04b-1e: patient tables still escape the under-18 scope guard: %',
      (select string_agg(g.table_name || ' (' || g.problem || ')', ', ') from private.minor_guard_gaps() g);
  end if;
  if has_function_privilege('anon', 'private.classify_minor_dependant_table(text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.classify_minor_dependant_table(text,text,text)', 'EXECUTE') then
    raise exception 'S04b-1e: classify_minor_dependant_table is callable by an API role';
  end if;
end $$;
