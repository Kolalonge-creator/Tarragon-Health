-- ===========================================================================
-- Proof: s04b1e_guard_new_patient_tables_by_default migration
--   1. A new public table with a patient_id column is guarded and recorded as guarded the moment it is created.
--   2. A new public table without patient_id is left alone.
--   3. A column patient_id added later (ALTER TABLE) guards the table.
--   4. private.classify_minor_dependant_table records allowed / exempt and removes the trigger; guarded is refused; a reason is required.
--   5. A table already classified is not re-guarded by a later ALTER TABLE.
--   6. SABOTAGE: with the event trigger disabled a new patient_id table is reported by private.minor_guard_gaps(), so the checks above
--      are not passing vacuously.
-- Wrapped in BEGIN/ROLLBACK; mints its own tables.
-- ===========================================================================
begin;

create function pg_temp.has_guard(p text) returns boolean language sql as $$
  select exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = p and g.tgname = '00_minor_dependant_scope' and not g.tgisinternal)
$$;
create function pg_temp.pol(p text) returns text language sql as $$
  select policy from public.minor_dependant_table_policy where table_name = p
$$;

-- 1
create table public.zz_s04b1e_new (id uuid primary key default gen_random_uuid(), patient_id uuid);
do $$
begin
  if not pg_temp.has_guard('zz_s04b1e_new') then raise exception '1: a new patient_id table has no guard trigger'; end if;
  if pg_temp.pol('zz_s04b1e_new') is distinct from 'guarded' then raise exception '1: a new patient_id table is not recorded as guarded: %', pg_temp.pol('zz_s04b1e_new'); end if;
  if exists (select 1 from private.minor_guard_gaps()) then raise exception '1: gaps remain: %', (select string_agg(table_name, ',') from private.minor_guard_gaps()); end if;
end $$;

-- 2
create table public.zz_s04b1e_plain (id uuid primary key default gen_random_uuid(), note text);
do $$
begin
  if pg_temp.pol('zz_s04b1e_plain') is not null or pg_temp.has_guard('zz_s04b1e_plain') then raise exception '2: a table without patient_id was touched'; end if;
end $$;

-- 3
alter table public.zz_s04b1e_plain add column patient_id uuid;
do $$
begin
  if not pg_temp.has_guard('zz_s04b1e_plain') or pg_temp.pol('zz_s04b1e_plain') is distinct from 'guarded' then
    raise exception '3: adding patient_id later did not guard the table';
  end if;
end $$;

-- 4
create table public.zz_s04b1e_sys (id uuid primary key default gen_random_uuid(), patient_id uuid);
select private.classify_minor_dependant_table('zz_s04b1e_sys', 'exempt', 'proof: a system table');
do $$
begin
  if pg_temp.has_guard('zz_s04b1e_sys') or pg_temp.pol('zz_s04b1e_sys') is distinct from 'exempt' then raise exception '4: exempt did not remove the trigger / record the policy'; end if;
  if exists (select 1 from private.minor_guard_gaps()) then raise exception '4: gaps remain after classifying: %', (select string_agg(table_name, ',') from private.minor_guard_gaps()); end if;
  begin
    perform private.classify_minor_dependant_table('zz_s04b1e_sys', 'guarded', 'x');
    raise exception '4: guarded was accepted as a classification';
  exception when raise_exception then
    if sqlerrm like '4:%' then raise; end if;
  end;
  begin
    perform private.classify_minor_dependant_table('zz_s04b1e_sys', 'exempt', '  ');
    raise exception '4: an empty reason was accepted';
  exception when raise_exception then
    if sqlerrm like '4:%' then raise; end if;
  end;
end $$;

-- 5
alter table public.zz_s04b1e_sys add column note text;
do $$
begin
  if pg_temp.has_guard('zz_s04b1e_sys') or pg_temp.pol('zz_s04b1e_sys') is distinct from 'exempt' then raise exception '5: a later ALTER TABLE re-guarded a classified table'; end if;
end $$;

-- 6 SABOTAGE
alter event trigger guard_new_patient_tables_trigger disable;
create table public.zz_s04b1e_off (id uuid primary key default gen_random_uuid(), patient_id uuid);
do $$
begin
  if pg_temp.has_guard('zz_s04b1e_off') then raise exception '6: the trigger is disabled yet the table was guarded'; end if;
  if not exists (select 1 from private.minor_guard_gaps() g where g.table_name = 'zz_s04b1e_off') then
    raise exception '6: SABOTAGE not caught: an unguarded new patient table is not reported';
  end if;
end $$;

rollback;
