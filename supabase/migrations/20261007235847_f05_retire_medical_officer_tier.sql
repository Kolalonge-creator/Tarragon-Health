-- F-05 (founder decision 2026-09-30, confirmed 2026-10-07): the Medical Officer doctor tier is retired. One doctor tier
-- (Senior Medical Officer level) plus the Chief Medical Officer remain; the non-clinical Care Coordinator stays dormant (OQ-27).
--
-- Counts before this migration (live, 2026-10-07): clinical_staff 0 medical_officer (2 senior, 1 chief); case_review_actions 0;
-- clinical_incident_reports 0; clinical_staff_indemnity_exemptions 0; clinical_tasks.min_tier 0; fhir_import_proposed_resources 0;
-- task_types.min_doctor_tier 8; clinical_tier_cost_rates 1 (the medical_officer rate); service_delivery_cost_model 19.
-- No doctor held the tier, so no person changes. The 8 task types and the 19 cost-model rows move to senior_medical_officer, and the
-- retired rate row is deleted: costing a task at the senior rate is the honest effect of "every doctor is at the senior level".
--
-- The enum VALUE is deleted, not hidden: Postgres cannot drop a label, so the type is rebuilt. Only 2 policies, 3 views, 3 functions
-- with the type in their signature and 3 CHECK constraints depend on it; each is captured, dropped and recreated unchanged apart from
-- the retired value. Sixteen functions that named the value are rewritten. private.doctor_tier_rank keeps its numbers
-- (care_coordinator 0, senior 2, chief 3) so no comparison elsewhere moves.

-- 1. data ------------------------------------------------------------------------------------------------------------------------
-- task_types are moved in place (clinical_tasks holds 0 rows, so no task references a version); the registry mirrors this as queue.task_types v2.
update public.task_types set min_doctor_tier = 'senior_medical_officer' where min_doctor_tier = 'medical_officer';
delete from public.clinical_tier_cost_rates where doctor_tier = 'medical_officer';
update public.service_delivery_cost_model set delivered_by_tier = 'senior_medical_officer' where delivered_by_tier = 'medical_officer';

do $$
declare n integer;
begin
  select (select count(*) from public.clinical_staff where doctor_tier = 'medical_officer')
       + (select count(*) from public.case_review_actions where confirmed_at_tier = 'medical_officer')
       + (select count(*) from public.clinical_incident_reports where reviewed_by_tier = 'medical_officer')
       + (select count(*) from public.clinical_staff_indemnity_exemptions where doctor_tier = 'medical_officer')
       + (select count(*) from public.clinical_tasks where min_tier = 'medical_officer')
       + (select count(*) from public.fhir_import_proposed_resources where confirmed_at_tier = 'medical_officer')
       + (select count(*) from public.task_types where min_doctor_tier = 'medical_officer')
       + (select count(*) from public.clinical_tier_cost_rates where doctor_tier = 'medical_officer')
       + (select count(*) from public.service_delivery_cost_model where delivered_by_tier = 'medical_officer')
    into n;
  if n <> 0 then raise exception 'F-05: % rows still hold medical_officer', n; end if;
end $$;

-- 2. functions that name the retired value ---------------------------------------------------------------------------------------
do $$
declare r record; v_def text; v_new text;
begin
  for r in
    select p.oid, p.oid::regprocedure::text as sig from pg_proc p
     where p.pronamespace::regnamespace::text in ('public', 'private', 'analytics') and p.prokind = 'f'
       and p.prosrc ~ '''medical_officer''' and p.proname <> 'doctor_tier_rank'
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := regexp_replace(v_def, '''medical_officer''\s*,\s*', '', 'g');
    if v_new ~ '''medical_officer''' then raise exception 'F-05: % still names medical_officer after the rewrite', r.sig; end if;
    execute v_new;
  end loop;
end $$;

-- 3. rebuild the enum -----------------------------------------------------------------------------------------------------------
create temp table f05_swap (ord integer, kind text, name text, ddl text, grants jsonb) on commit drop;

do $$
declare r record; v_def text; v_ord integer := 0;
begin
  -- policies that mention a doctor_tier column
  for r in
    select distinct pol.polrelid::regclass::text as tbl, pol.polname, pol.polcmd, pol.polpermissive,
           (select string_agg(case when x = 0 then 'public' else quote_ident(pg_get_userbyid(x)) end, ', ') from unnest(pol.polroles) x) as roles,
           pg_get_expr(pol.polqual, pol.polrelid) as qual, pg_get_expr(pol.polwithcheck, pol.polrelid) as wcheck, pol.oid
      from pg_depend d join pg_policy pol on pol.oid = d.objid
      join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid join pg_type t on t.oid = a.atttypid
     where d.classid = 'pg_policy'::regclass and t.typname = 'doctor_tier'
  loop
    v_ord := v_ord + 1;
    insert into f05_swap values (v_ord, 'policy', r.tbl || '.' || r.polname,
      format('create policy %I on %s as %s for %s to %s%s%s', r.polname, r.tbl,
             case when r.polpermissive then 'permissive' else 'restrictive' end,
             case r.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end,
             r.roles, case when r.qual is not null then ' using (' || r.qual || ')' else '' end,
             case when r.wcheck is not null then ' with check (' || r.wcheck || ')' else '' end), null);
    execute format('drop policy %I on %s', r.polname, r.tbl);
  end loop;

  -- check constraints that mention a doctor_tier column (the primary key is rebuilt by the column change itself)
  for r in
    select distinct c.conrelid::regclass::text as tbl, c.conname, pg_get_constraintdef(c.oid) as def
      from pg_depend d join pg_constraint c on c.oid = d.objid
      join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid join pg_type t on t.oid = a.atttypid
     where d.classid = 'pg_constraint'::regclass and t.typname = 'doctor_tier' and c.contype = 'c'
  loop
    v_ord := v_ord + 1;
    insert into f05_swap values (v_ord, 'constraint', r.tbl || '.' || r.conname, format('alter table %s add constraint %I %s', r.tbl, r.conname, r.def), null);
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;

  -- partial or expression indexes that read a doctor_tier column (their stored constants are of the old type)
  for r in
    select distinct i.indexrelid::regclass::text as nm, pg_get_indexdef(i.indexrelid) as def
      from pg_depend d join pg_index i on i.indexrelid = d.objid
      join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid join pg_type t on t.oid = a.atttypid
     where d.classid = 'pg_class'::regclass and t.typname = 'doctor_tier' and not i.indisprimary and not i.indisunique
       and (i.indpred is not null or i.indexprs is not null)
  loop
    v_ord := v_ord + 1;
    insert into f05_swap values (v_ord, 'index', r.nm, r.def, null);
    execute format('drop index %s', r.nm);
  end loop;

  -- views that read a doctor_tier column
  for r in
    select distinct c.oid, c.oid::regclass::text as nm, c.reloptions, pg_get_viewdef(c.oid, true) as def
      from pg_depend d join pg_rewrite rw on rw.oid = d.objid join pg_class c on c.oid = rw.ev_class
      join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid join pg_type t on t.oid = a.atttypid
     where d.classid = 'pg_rewrite'::regclass and t.typname = 'doctor_tier' and c.relkind = 'v' and c.oid <> d.refobjid
  loop
    v_ord := v_ord + 1;
    insert into f05_swap values (v_ord, 'view', r.nm,
      format('create view %s%s as %s', r.nm,
             case when r.reloptions is not null then ' with (' || array_to_string(r.reloptions, ', ') || ')' else '' end,
             rtrim(r.def, ';')),
      (select coalesce(jsonb_agg(jsonb_build_object('grantee', case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end, 'priv', a.privilege_type)), '[]'::jsonb)
         from aclexplode((select relacl from pg_class where oid = r.oid)) a where a.grantee <> (select relowner from pg_class where oid = r.oid)));
    execute format('drop view %s', r.nm);
  end loop;

  -- functions with the type in their signature
  for r in
    select p.oid, p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def from pg_proc p
     where p.pronamespace::regnamespace::text in ('public', 'private', 'analytics')
       and (exists (select 1 from unnest(p.proargtypes) x where x = 'doctor_tier'::regtype) or p.prorettype = 'doctor_tier'::regtype)
  loop
    v_ord := v_ord + 1;
    v_def := r.def;
    if r.sig like 'private.doctor_tier_rank%' then
      v_def := replace(v_def, E'  when ''medical_officer'' then 1\n', '');
      if v_def ~ '''medical_officer''' then raise exception 'F-05: doctor_tier_rank still names medical_officer'; end if;
    end if;
    insert into f05_swap values (v_ord, 'function', r.sig, v_def,
      (select coalesce(jsonb_agg(jsonb_build_object('grantee', case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end, 'priv', a.privilege_type)), '[]'::jsonb)
         from aclexplode((select proacl from pg_proc where oid = r.oid)) a where a.grantee <> (select proowner from pg_proc where oid = r.oid)));
    execute format('drop function %s', r.sig);
  end loop;
end $$;

alter type public.doctor_tier rename to doctor_tier_retired;
create type public.doctor_tier as enum ('care_coordinator', 'senior_medical_officer', 'chief_medical_officer');

do $$
declare r record;
begin
  for r in
    select table_schema, table_name, column_name from information_schema.columns
     where udt_schema = 'public' and udt_name = 'doctor_tier_retired'
       and table_name in (select c.relname from pg_class c where c.relkind in ('r', 'p'))
  loop
    execute format('alter table %I.%I alter column %I type public.doctor_tier using %I::text::public.doctor_tier',
                   r.table_schema, r.table_name, r.column_name, r.column_name);
  end loop;
end $$;

do $$
declare r record; g jsonb; v_kind_order text[] := array['index', 'function', 'view', 'constraint', 'policy'];
begin
  for r in select * from f05_swap order by array_position(v_kind_order, kind), ord loop
    execute r.ddl;
    if r.kind = 'function' then
      execute format('revoke all on function %s from public, anon, authenticated, service_role', r.name);
      for g in select * from jsonb_array_elements(r.grants) loop
        execute format('grant %s on function %s to %s', g->>'priv', r.name, case when g->>'grantee' = 'public' then 'public' else quote_ident(g->>'grantee') end);
      end loop;
    elsif r.kind = 'view' then
      execute format('revoke all on %s from public, anon, authenticated, service_role', r.name);
      for g in select * from jsonb_array_elements(r.grants) loop
        execute format('grant %s on %s to %s', g->>'priv', r.name, case when g->>'grantee' = 'public' then 'public' else quote_ident(g->>'grantee') end);
      end loop;
    end if;
  end loop;
end $$;

drop type public.doctor_tier_retired;
comment on type public.doctor_tier is 'F-05: care_coordinator (non-clinical, dormant), senior_medical_officer (the one doctor tier), chief_medical_officer (management and sign-off). The Medical Officer tier was retired 2026-10-07.';

-- 4. proof inside the migration ---------------------------------------------------------------------------------------------------
do $$
declare n integer;
begin
  if (select array_agg(enumlabel::text order by enumsortorder) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'doctor_tier')
     is distinct from array['care_coordinator', 'senior_medical_officer', 'chief_medical_officer'] then
    raise exception 'F-05: doctor_tier labels are not the three expected';
  end if;
  select count(*) into n from pg_proc p
   where p.pronamespace::regnamespace::text in ('public', 'private', 'analytics') and p.prosrc ~ '''medical_officer''';
  if n <> 0 then raise exception 'F-05: % functions still name medical_officer', n; end if;
  if exists (select 1 from pg_type where typname = 'doctor_tier_retired') then raise exception 'F-05: the old type was not dropped'; end if;
  if (select count(*) from public.clinical_tier_cost_rates) <> 3 then raise exception 'F-05: expected 3 cost rates (coordinator, senior, chief)'; end if;
  if not has_table_privilege('authenticated', 'public.clinical_staff_directory', 'SELECT') then raise exception 'F-05: clinical_staff_directory lost its authenticated grant'; end if;
  if has_function_privilege('authenticated', 'private.doctor_tier_rank(public.doctor_tier)', 'EXECUTE') then raise exception 'F-05: doctor_tier_rank became callable by authenticated'; end if;
  if (select private.doctor_tier_rank('senior_medical_officer')) <> 2 or (select private.doctor_tier_rank('chief_medical_officer')) <> 3 then raise exception 'F-05: tier ranks moved'; end if;
end $$;
