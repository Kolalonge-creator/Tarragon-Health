-- ===========================================================================
-- Verification: partner-employee and back-office roles read zero patient rows
-- after 20260729194127_scoped_access_roles_out_of_org_staff.sql.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data; it
-- always leaves the database exactly as it found it.
--
-- Pattern (same as packages/db/tests/m1_invariant_and_rls_suite.sql):
--   set_config('request.jwt.claims', ...) + `set local role authenticated`
-- simulates a real client session. Running as the connecting superuser would
-- silently bypass RLS via table ownership — `set local role authenticated` is
-- what makes this a real test.
--
-- NOTE ON FIXTURES: the platform database was rebuilt on 2026-07-29 and its
-- clinical tables are currently EMPTY, so a bare "reads 0 rows" result would
-- prove nothing. This script therefore seeds real vitals/medication/care-plan/
-- result-document rows for an existing patient inside the transaction, so the
-- clinician control genuinely sees data and "0" for the other roles is a
-- meaningful difference rather than an empty table.
--
-- Results are returned as a table (db query does not surface RAISE NOTICE),
-- and every check also raises on failure so the script cannot pass silently.
-- ===========================================================================

begin;

create temporary table scoped_fixture(k text primary key, v uuid) on commit drop;
create temporary table scoped_result(
  check_name text,
  role       text,
  observed   bigint,
  expected   text,
  verdict    text
) on commit drop;

-- --------------------------------------------------------------------------
-- Fixtures
-- --------------------------------------------------------------------------
do $$
declare
  v_org     uuid;
  v_other   uuid;
  v_patient uuid;
  v_vital   text;
  r         record;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;

  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  select id into v_patient
  from public.profiles
  where role = 'patient' and organisation_id = v_org limit 1;

  select id into v_other from public.organisations where id <> v_org limit 1;

  insert into scoped_fixture(k, v) values
    ('org', v_org), ('other_org', v_other), ('patient', v_patient);

  -- One account per role under test, plus a clinician control, all in the
  -- same organisation as the patient whose data we seed.
  for r in select * from (values
      ('pharmacist'),('lab_liaison'),('finance'),('analyst'),('clinician')
    ) as t(role_name)
  loop
    insert into scoped_fixture(k, v) values (r.role_name, gen_random_uuid());

    insert into auth.users (id, email)
    values ((select v from scoped_fixture where k = r.role_name),
            format('scopedtest.%s@example.com', r.role_name));

    -- handle_new_user may already have created the profile from the auth.users
    -- insert; upsert so this works either way.
    insert into public.profiles (id, organisation_id, role, full_name)
    values ((select v from scoped_fixture where k = r.role_name),
            v_org, r.role_name::public.user_role,
            format('Scoped Test %s', r.role_name))
    on conflict (id) do update
      set organisation_id = excluded.organisation_id,
          role            = excluded.role,
          full_name       = excluded.full_name;
  end loop;

  -- Seed real clinical rows so the clinician control is non-empty.
  select enumlabel into v_vital
  from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'vital_type' limit 1;

  execute format(
    'insert into public.vitals_readings (organisation_id, patient_id, vital_type)
     values (%L, %L, %L::public.vital_type)', v_org, v_patient, v_vital);

  insert into public.medications (organisation_id, patient_id, drug_name)
  values (v_org, v_patient, 'Scoped Test Drug');

  insert into public.lab_result_documents
    (organisation_id, patient_id, file_path, original_filename, source, note)
  values (v_org, v_patient, format('%s/scopedtest.pdf', v_patient),
          'scopedtest.pdf', 'lab_liaison', 'scoped-access verification fixture');
end $$;

-- ==========================================================================
-- 1. Zero rows for the four roles; non-zero for the clinician control.
-- ==========================================================================
do $$
declare
  v_tables text[] := array[
    'vitals_readings','medications','lab_result_documents','profiles'
  ];
  v_roles  text[] := array['pharmacist','lab_liaison','finance','analyst'];
  v_tbl    text;
  v_role   text;
  v_id     uuid;
  v_count  bigint;
  v_ctrl   bigint;
begin
  foreach v_tbl in array v_tables loop
    -- Control: a clinician must actually see rows, or "0" below proves nothing.
    v_id := (select v from scoped_fixture where k = 'clinician');
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_id::text, 'role', 'authenticated')::text, true);
    set local role authenticated;
    if v_tbl = 'profiles' then
      select count(*) into v_ctrl from public.profiles where role = 'patient';
    else
      execute format('select count(*) from public.%I', v_tbl) into v_ctrl;
    end if;
    reset role;

    insert into scoped_result values
      (format('control reads %s', v_tbl), 'clinician', v_ctrl, '> 0',
       case when v_ctrl > 0 then 'PASS' else 'FAIL' end);

    if v_ctrl = 0 then
      raise exception 'control failure: clinician sees 0 rows in %', v_tbl;
    end if;

    foreach v_role in array v_roles loop
      v_id := (select v from scoped_fixture where k = v_role);
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_id::text, 'role', 'authenticated')::text, true);
      set local role authenticated;
      if v_tbl = 'profiles' then
        select count(*) into v_count from public.profiles where role = 'patient';
      else
        execute format('select count(*) from public.%I', v_tbl) into v_count;
      end if;
      reset role;

      -- The lab liaison is deliberately re-granted these two surfaces.
      if v_role = 'lab_liaison' and v_tbl in ('profiles', 'lab_result_documents') then
        insert into scoped_result values
          (format('re-granted: %s', v_tbl), v_role, v_count, '> 0 (by design)',
           case when v_count > 0 then 'PASS' else 'FAIL' end);
        if v_count = 0 then
          raise exception 'BROKEN: lab_liaison lost its % surface', v_tbl;
        end if;
      else
        insert into scoped_result values
          (format('reads %s', v_tbl), v_role, v_count, '0',
           case when v_count = 0 then 'PASS' else 'FAIL' end);
        if v_count <> 0 then
          raise exception 'LEAK: % still reads % rows from public.%',
            v_role, v_count, v_tbl;
        end if;
      end if;
    end loop;
  end loop;
end $$;

-- ==========================================================================
-- 2. The three roles with NO re-grant see exactly their own profile row.
-- ==========================================================================
do $$
declare
  v_role text; v_id uuid; v_count bigint;
begin
  foreach v_role in array array['pharmacist','finance','analyst'] loop
    v_id := (select v from scoped_fixture where k = v_role);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_id::text, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_count from public.profiles;
    reset role;

    insert into scoped_result values
      ('total profiles visible', v_role, v_count, '1 (own row only)',
       case when v_count = 1 then 'PASS' else 'FAIL' end);
    if v_count <> 1 then
      raise exception '% reads % profiles rows; expected exactly 1 (its own)',
        v_role, v_count;
    end if;
  end loop;
end $$;

-- ==========================================================================
-- 3. The liaison re-grant is scoped to patient rows in its own org only.
-- ==========================================================================
do $$
declare
  v_id     uuid := (select v from scoped_fixture where k = 'lab_liaison');
  v_other  uuid := (select v from scoped_fixture where k = 'other_org');
  v_nonpat bigint;
  v_cross  bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_nonpat
  from public.profiles where role <> 'patient' and id <> v_id;
  select count(*) into v_cross
  from public.profiles where organisation_id is not distinct from v_other;
  reset role;

  insert into scoped_result values
    ('other staff profiles visible', 'lab_liaison', v_nonpat, '0',
     case when v_nonpat = 0 then 'PASS' else 'FAIL' end);
  if v_nonpat <> 0 then
    raise exception 'lab_liaison reads % non-patient profiles — re-grant too wide', v_nonpat;
  end if;

  if v_other is not null then
    insert into scoped_result values
      ('cross-org profiles visible', 'lab_liaison', v_cross, '0',
       case when v_cross = 0 then 'PASS' else 'FAIL' end);
    if v_cross <> 0 then
      raise exception 'CROSS-ORG LEAK: lab_liaison reads % rows from another org', v_cross;
    end if;
  end if;
end $$;

-- ==========================================================================
-- 4. Each role's own RPC surface still answers (SECURITY DEFINER, so it must
--    be entirely unaffected by the narrowing).
-- ==========================================================================
do $$
declare
  v_id uuid; v_res jsonb; v_n bigint;
begin
  v_id := (select v from scoped_fixture where k = 'finance');
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.finance_dashboard_summary() into v_res;
  reset role;
  insert into scoped_result values
    ('finance_dashboard_summary()', 'finance', case when v_res is null then 0 else 1 end,
     'answers', case when v_res is not null then 'PASS' else 'FAIL' end);
  if v_res is null then
    raise exception 'BROKEN: finance_dashboard_summary() returned null for a finance session';
  end if;

  v_id := (select v from scoped_fixture where k = 'analyst');
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.analytics_business_summary() into v_res;
  reset role;
  insert into scoped_result values
    ('analytics_business_summary()', 'analyst', case when v_res is null then 0 else 1 end,
     'answers', case when v_res is not null then 'PASS' else 'FAIL' end);
  if v_res is null then
    raise exception 'BROKEN: analytics_business_summary() returned null for an analyst session';
  end if;

  -- pharmacist_orders() must EXECUTE cleanly. It returns 0 rows because the
  -- fixture has no pharmacy_partner_id — which is the correct isolated result.
  v_id := (select v from scoped_fixture where k = 'pharmacist');
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.pharmacist_orders();
  reset role;
  insert into scoped_result values
    ('pharmacist_orders()', 'pharmacist', v_n, 'executes', 'PASS');
end $$;

select check_name, role, observed, expected, verdict
from scoped_result
order by verdict desc, check_name, role;

rollback;
