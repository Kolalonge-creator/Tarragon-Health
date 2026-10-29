-- Tarragon Health: owner-run views are a reviewed list, not an accident.
--
-- The Supabase security advisor reports every public view that runs with its owner's permissions (security_definer_view, ERROR).
-- Checked live on 2026-10-29: 18 views are owner-run, ALL on purpose (security_invoker explicitly set false/off, each with a
-- comment saying why): five directories that must show patients a safe subset of columns of an admin-only table, and thirteen
-- staff/admin/metrics views whose own predicate decides who sees rows. Switching them to caller permissions would break the
-- directories and gain nothing, so the advisor finding is an accepted exception. This proof turns "accepted" into "enforced":
--   1. any NEW owner-run view in public that is not on the reviewed list fails the run (a new one needs a human decision);
--   2. no owner-run view is readable by anon;
--   3. the five directory views never carry a commission, contact, cost, credential-number, staff-number, indemnity or
--      verifier column (their comments promise this);
--   4. every non-directory owner-run view carries a caller predicate in its definition (so it is not an open window onto a table).
-- Checks 1 to 4 are run once on the real database, then run again after a deliberately bad fixture is added in the same
-- rolled-back transaction, which must be caught, so the check itself is proven able to fail.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/owner_run_views_allowlist.sql

begin;

create temp table directory_views (name text primary key) on commit drop;
insert into directory_views values ('clinical_staff_directory'), ('lab_provider_directory'), ('pharmacy_partner_directory'), ('specialist_directory'), ('therapy_directory');

create temp table admin_views_extra (name text primary key) on commit drop;

create function pg_temp.owner_run_problems() returns text language plpgsql as
$f$
declare
  v_directories text[] := (select array_agg(name) from directory_views);
  v_admin text[] := array['care_message_communication_log','diabetes_quality_metrics','hypertension_quality_metrics','lab_tests_admin',
    'lpe_programme_outcomes','obesity_quality_metrics','panel_bundles_admin','pharmacy_medications_admin','risk_model_drift_signal',
    'risk_model_performance','risk_model_performance_by_subgroup','screen_types_admin','triage_safety_monitoring'] || coalesce((select array_agg(name) from admin_views_extra), '{}');
  v_out text := '';
  r record;
begin
  -- 1. unlisted owner-run views
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
       and not (coalesce(c.reloptions::text, '') ~ 'security_invoker=(on|true)')
       and c.relname <> all (v_directories || v_admin)
  loop v_out := v_out || format('[1] owner-run view %s is not on the reviewed list; ', r.relname); end loop;
  -- 2. anon can read none of the listed ones
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v' and c.relname = any (v_directories || v_admin)
       and has_table_privilege('anon', c.oid, 'SELECT')
  loop v_out := v_out || format('[2] anon can read %s; ', r.relname); end loop;
  -- 3. directories never carry forbidden columns
  for r in
    select c.relname, a.attname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where n.nspname = 'public' and c.relname = any (v_directories)
       and a.attname ~ '^(commission|cost_basis|contact_(email|phone)|credential_number|staff_number|business_registration_number|verified_by|credential_verified_by|compliance_owner|indemnity|status_notes)'
  loop v_out := v_out || format('[3] directory %s carries %s; ', r.relname, r.attname); end loop;
  -- 4. admin/metrics views carry a caller predicate
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v' and c.relname = any (v_admin)
       and not (pg_get_viewdef(c.oid) ~* '(is_org_staff|is_admin|is_clinician|auth\.uid\(\)|can_read_clinical|is_superadmin|has_role|credential_is_cmo|service_role|private\.[a-z_]+\()')
  loop v_out := v_out || format('[4] %s has no caller predicate; ', r.relname); end loop;
  return nullif(v_out, '');
end $f$;

do $$
declare v_problems text;
begin
  -- on the real database: clean
  v_problems := pg_temp.owner_run_problems();
  if v_problems is not null then raise exception 'FAIL real database: %', v_problems; end if;

  -- sabotage 1: a new, unlisted owner-run view must be caught
  create view public.zz_proof_unlisted_view with (security_invoker = false) as select 1 as x;
  v_problems := pg_temp.owner_run_problems();
  if v_problems is null or v_problems not like '%[1]%zz_proof_unlisted_view%' then
    raise exception 'FAIL sabotage 1: an unlisted owner-run view was not caught (got %)', v_problems;
  end if;
  drop view public.zz_proof_unlisted_view;

  -- sabotage 2: anon granted on a listed view must be caught
  grant select on public.care_message_communication_log to anon;
  v_problems := pg_temp.owner_run_problems();
  if v_problems is null or v_problems not like '%[2]%care_message_communication_log%' then
    raise exception 'FAIL sabotage 2: an anon grant was not caught (got %)', v_problems;
  end if;
  revoke select on public.care_message_communication_log from anon;

  -- sabotage 3: a forbidden column in a directory must be caught (an invoker view, registered as a directory for this transaction only)
  create view public.zz_proof_dir with (security_invoker = true) as select 1 as x, 2 as commission_rate;
  insert into directory_views values ('zz_proof_dir');
  v_problems := pg_temp.owner_run_problems();
  if v_problems is null or v_problems not like '%[3]%zz_proof_dir carries commission_rate%' then
    raise exception 'FAIL sabotage 3: a forbidden directory column was not caught (got %)', v_problems;
  end if;
  delete from directory_views where name = 'zz_proof_dir';
  drop view public.zz_proof_dir;

  -- sabotage 4: an owner-run admin view with no caller predicate must be caught
  create view public.zz_proof_open_admin with (security_invoker = false) as select 1 as x;
  insert into admin_views_extra values ('zz_proof_open_admin');
  v_problems := pg_temp.owner_run_problems();
  if v_problems is null or v_problems not like '%[4]%zz_proof_open_admin has no caller predicate%' then
    raise exception 'FAIL sabotage 4: an open admin view was not caught (got %)', v_problems;
  end if;
  delete from admin_views_extra where name = 'zz_proof_open_admin';
  drop view public.zz_proof_open_admin;

  if pg_temp.owner_run_problems() is not null then raise exception 'FAIL: fixtures were not cleaned up'; end if;
  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
