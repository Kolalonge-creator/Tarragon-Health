-- OQ-39: the analytics_clean views freeze their column list (select t.*). This proof keeps them in step with their base tables.
--
--   A. every view has a catalogue row in private.analytics_clean_view_sources and the reverse (one source of truth)
--   B. no base table behind a view has a column the view lacks. A failure prints the exact fix line.
--   C. sabotage: add a column to a real base table; B must flag it and name the fix; the fix (rebuild) must clear it
--   D. the recipe for DROP COLUMN / ALTER COLUMN TYPE, run on a fixture table: a direct ALTER is refused while a view uses the
--      column; drop_analytics_clean_views() -> ALTER -> rebuild_analytics_clean_views() works in one transaction
--   E. both functions and the catalogue are closed to every API role
--
-- Always rolled back.

begin;

create temp table drift_results (check_name text, observed text, expected text, verdict text);

create function pg_temp.drift() returns text[] language plpgsql as $$
declare r record; c record; v_out text[] := '{}';
begin
  for r in select view_name, source_rel from private.analytics_clean_view_sources where source_rel is not null order by view_name loop
    for c in
      select a.attname::text as col from pg_attribute a
      where a.attrelid = r.source_rel::regclass and a.attnum > 0 and not a.attisdropped
        and not exists (select 1 from pg_attribute v where v.attrelid = ('analytics_clean.' || quote_ident(r.view_name))::regclass
                        and v.attnum > 0 and not v.attisdropped and v.attname = a.attname)
    loop
      v_out := v_out || format('analytics_clean.%s lacks %s.%s -> add "select private.rebuild_analytics_clean_views();" to the migration that adds the column', r.view_name, r.source_rel, c.col);
    end loop;
  end loop;
  return v_out;
end $$;

-- A
do $$
declare v_missing_row text; v_missing_view text;
begin
  select string_agg(c.relname, ',') into v_missing_row from pg_class c
   where c.relnamespace = 'analytics_clean'::regnamespace and c.relkind = 'v'
     and not exists (select 1 from private.analytics_clean_view_sources s where s.view_name = c.relname);
  select string_agg(s.view_name, ',') into v_missing_view from private.analytics_clean_view_sources s
   where to_regclass('analytics_clean.' || quote_ident(s.view_name)) is null;
  insert into drift_results values ('A views without a catalogue row', coalesce(v_missing_row, 'none'), 'none', case when v_missing_row is null then 'PASS' else 'FAIL' end);
  insert into drift_results values ('A catalogue rows without a view', coalesce(v_missing_view, 'none'), 'none', case when v_missing_view is null then 'PASS' else 'FAIL' end);
end $$;

-- B
do $$
declare d text[] := pg_temp.drift();
begin
  insert into drift_results values ('B no base column missing from its analytics_clean view', coalesce(nullif(array_to_string(d, '; '), ''), 'none'), 'none', case when cardinality(d) = 0 then 'PASS' else 'FAIL' end);
end $$;

-- C
alter table public.appointments add column oq39_probe_col integer;
do $$
declare d text[] := pg_temp.drift(); d2 text[]; v_ok boolean;
begin
  v_ok := exists (select 1 from unnest(d) x where x like 'analytics_clean.appointments lacks public.appointments.oq39_probe_col%rebuild_analytics_clean_views%');
  insert into drift_results values ('C sabotage: a new base column is flagged, with the fix line', coalesce(array_to_string(d, '; '), 'nothing flagged'), 'flags oq39_probe_col and prints the fix', case when v_ok then 'PASS' else 'FAIL' end);
  perform private.rebuild_analytics_clean_views();
  d2 := pg_temp.drift();
  insert into drift_results values ('C the fix line clears it', coalesce(nullif(array_to_string(d2, '; '), ''), 'none'), 'none', case when cardinality(d2) = 0 then 'PASS' else 'FAIL' end);
  insert into drift_results values ('C the rebuilt view exposes the new column',
    (select count(*)::text from pg_attribute where attrelid = 'analytics_clean.appointments'::regclass and attname = 'oq39_probe_col' and not attisdropped), '1',
    case when exists (select 1 from pg_attribute where attrelid = 'analytics_clean.appointments'::regclass and attname = 'oq39_probe_col' and not attisdropped) then 'PASS' else 'FAIL' end);
end $$;

-- D. DROP COLUMN / ALTER COLUMN TYPE on a fixture
create table public.oq39_fixture (patient_id uuid, a integer, b text);
insert into public.oq39_fixture values (gen_random_uuid(), 1, 'x');
insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values
  ('oq39_fixture', 'public.oq39_fixture',
   'select t.* from public.oq39_fixture t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)');
do $$
declare v_err text; v_type text; v_cols text; v_rows bigint;
begin
  perform private.rebuild_analytics_clean_views();
  insert into drift_results values ('D fixture view created by rebuild', (select count(*)::text from analytics_clean.oq39_fixture), '1', case when (select count(*) from analytics_clean.oq39_fixture) = 1 then 'PASS' else 'FAIL' end);
  -- a column added later: drift is flagged, rebuild fixes
  alter table public.oq39_fixture add column c date;
  insert into drift_results values ('D added column flagged', array_to_string(pg_temp.drift(), '; '), 'names oq39_fixture.c',
    case when exists (select 1 from unnest(pg_temp.drift()) x where x like '%oq39_fixture lacks public.oq39_fixture.c%') then 'PASS' else 'FAIL' end);
  perform private.rebuild_analytics_clean_views();
  -- a direct ALTER TYPE while the view uses the column is refused
  begin
    alter table public.oq39_fixture alter column a type text;
    v_err := 'no error';
  exception when others then v_err := sqlstate;
  end;
  insert into drift_results values ('D direct ALTER COLUMN TYPE is refused while a view uses the column', v_err, '0A000', case when v_err = '0A000' then 'PASS' else 'FAIL' end);
  -- the recipe
  perform private.drop_analytics_clean_views();
  alter table public.oq39_fixture alter column a type text;
  alter table public.oq39_fixture drop column b;
  perform private.rebuild_analytics_clean_views();
  select format_type(atttypid, null) into v_type from pg_attribute where attrelid = 'analytics_clean.oq39_fixture'::regclass and attname = 'a';
  select string_agg(attname, ',' order by attnum) into v_cols from pg_attribute where attrelid = 'analytics_clean.oq39_fixture'::regclass and attnum > 0 and not attisdropped;
  select count(*) into v_rows from analytics_clean.oq39_fixture;
  insert into drift_results values ('D recipe: type change and drop column, then rebuild', v_type || ' / ' || v_cols || ' / ' || v_rows || ' row', 'text / patient_id,a,c / 1 row',
    case when v_type = 'text' and v_cols = 'patient_id,a,c' and v_rows = 1 then 'PASS' else 'FAIL' end);
  insert into drift_results values ('D recipe: no drift afterwards', coalesce(nullif(array_to_string(pg_temp.drift(), '; '), ''), 'none'), 'none', case when cardinality(pg_temp.drift()) = 0 then 'PASS' else 'FAIL' end);
  -- the rebuilt view still filters test accounts
  insert into drift_results values ('D rebuilt view keeps the is_test filter', (select position('is_test' in pg_get_viewdef('analytics_clean.oq39_fixture'::regclass)))::text, '> 0',
    case when position('is_test' in pg_get_viewdef('analytics_clean.oq39_fixture'::regclass)) > 0 then 'PASS' else 'FAIL' end);
end $$;

-- E. closed to API roles
do $$
declare r text; bad text := '';
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(r, 'private.rebuild_analytics_clean_views()', 'EXECUTE') then bad := bad || r || ':rebuild '; end if;
    if has_function_privilege(r, 'private.drop_analytics_clean_views()', 'EXECUTE') then bad := bad || r || ':drop '; end if;
    if has_table_privilege(r, 'private.analytics_clean_view_sources', 'SELECT') then bad := bad || r || ':catalogue '; end if;
    if has_schema_privilege(r, 'analytics_clean', 'USAGE') then bad := bad || r || ':schema '; end if;
  end loop;
  insert into drift_results values ('E rebuild/drop functions, catalogue and schema closed to API roles', coalesce(nullif(bad, ''), 'closed'), 'closed', case when bad = '' then 'PASS' else 'FAIL' end);
end $$;

select check_name, observed, expected, verdict from drift_results order by (verdict = 'PASS'), check_name;

do $$
begin
  if exists (select 1 from drift_results where verdict = 'FAIL') then
    raise exception 'OQ-39 view drift proof FAILED: %', (select string_agg(check_name, '; ') from drift_results where verdict = 'FAIL');
  end if;
end $$;

rollback;
