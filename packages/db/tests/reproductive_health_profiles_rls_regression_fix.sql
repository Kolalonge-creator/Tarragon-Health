-- ===========================================================================
-- Live proof for 20260902213714_fix_reproductive_health_profiles_rls_regression.sql.
--
-- Run: npx supabase db query --linked -f packages/db/tests/reproductive_health_profiles_rls_regression_fix.sql
-- Wrapped in BEGIN/ROLLBACK -- a verification script, not seed data.
--
-- Checks:
--   1. THE REGRESSION ITSELF: an adult patient's caregiver holding only a
--      bare 'view' profile_access grant with NO category (the non-clinical
--      "appointments" tier) reads ZERO rows -- this is exactly the leak
--      20260902205428_adolescent_health_module.sql reintroduced.
--   2. A caregiver with an EXPLICIT 'reproductive_health' category grant
--      (the intended, patient-consented path) still reads the row --
--      proves the fix didn't overcorrect into a false negative.
--   3. The adolescent waiver feature (20260902205713) still works: a
--      15-year-old with an explicit reproductive_health category grant AND
--      an adolescent_confidentiality_waivers row is readable by that
--      specific grantee.
--   4. Without a waiver, the same 15-year-old's record is NOT readable by a
--      caregiver who otherwise has a category grant -- the age-band gate
--      still applies on top of can_read_clinical, proving the fix layers
--      correctly rather than just restoring the old behaviour wholesale.
--
-- TO CONFIRM THIS TEST DISCRIMINATES, break it on purpose: temporarily
-- revert reproductive_health_profiles_select to the pre-fix bare-EXISTS
-- form and re-run -- check 1 must FAIL, showing the bare view-grant
-- caregiver reading the adult's record.
-- ===========================================================================

begin;

create temporary table rhp_fixture(k text primary key, v uuid) on commit drop;
create temporary table rhp_result(
  check_name text, role text, observed text, expected text, verdict text
) on commit drop;

do $$
declare
  v_org uuid;
  r     record;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;

  if v_org is null then
    raise exception 'no organisation has patient profiles -- cannot run this test';
  end if;

  insert into rhp_fixture(k, v) values ('org', v_org);

  for r in select * from (values
      ('adult_patient', 'patient'), ('view_only_caregiver', 'patient'),
      ('category_caregiver', 'patient'), ('adolescent', 'patient'),
      ('adolescent_waived_to', 'patient')
    ) as t(key_name, role_name)
  loop
    insert into rhp_fixture(k, v) values (r.key_name, gen_random_uuid());

    insert into auth.users (id, email)
    values ((select v from rhp_fixture where k = r.key_name),
            format('rhptest.%s@example.com', r.key_name));

    insert into public.profiles (id, organisation_id, role, full_name, date_of_birth)
    values ((select v from rhp_fixture where k = r.key_name),
            v_org, r.role_name::public.user_role, format('RHP Test %s', r.key_name),
            case when r.key_name = 'adolescent' then (current_date - interval '15 years')::date
                 else date '1990-01-01' end)
    on conflict (id) do update
      set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name,
          date_of_birth = excluded.date_of_birth;
  end loop;

  insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage)
  values (v_org, (select v from rhp_fixture where k = 'adult_patient'), 'menstruating')
  on conflict (patient_id) do nothing;

  insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage)
  values (v_org, (select v from rhp_fixture where k = 'adolescent'), 'menstruating')
  on conflict (patient_id) do nothing;
end $$;

-- ==========================================================================
-- 1. THE REGRESSION: a bare 'view'-level, no-category grant reads nothing.
-- ==========================================================================
do $$
declare
  v_adult uuid := (select v from rhp_fixture where k = 'adult_patient');
  v_grantee uuid := (select v from rhp_fixture where k = 'view_only_caregiver');
  v_grant_id uuid;
  v_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_adult::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_adult, v_grantee, 'view', v_adult)
  returning id into v_grant_id;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.reproductive_health_profiles where patient_id = v_adult;
  reset role;

  insert into rhp_result values
    ('REGRESSION: bare view-only grant, no category -- must read 0', 'view_only_caregiver',
     v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);
  if v_count <> 0 then
    raise exception 'LEAK: a bare view-only, no-category profile_access grantee reads % row(s) of an adult patient''s reproductive_health_profiles -- the regression this migration fixes is still live', v_count;
  end if;
end $$;

-- ==========================================================================
-- 2. An explicit reproductive_health category grant still works.
-- ==========================================================================
do $$
declare
  v_adult uuid := (select v from rhp_fixture where k = 'adult_patient');
  v_grantee uuid := (select v from rhp_fixture where k = 'category_caregiver');
  v_grant_id uuid;
  v_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_adult::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_adult, v_grantee, 'view', v_adult)
  returning id into v_grant_id;
  perform public.set_care_access_categories(v_grant_id, array['reproductive_health']::public.care_access_category[]);
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.reproductive_health_profiles where patient_id = v_adult;
  reset role;

  insert into rhp_result values
    ('explicit reproductive_health category grant reads 1', 'category_caregiver',
     v_count::text, '1', case when v_count = 1 then 'PASS' else 'FAIL' end);
  if v_count <> 1 then
    raise exception 'GAP: a grantee with an explicit reproductive_health category grant cannot read the adult patient''s record -- the fix over-restricted the intended path';
  end if;
end $$;

-- ==========================================================================
-- 3/4. Adolescent waiver: category grant alone is not enough (age-band gate
-- still applies); category grant + waiver together works.
-- ==========================================================================
do $$
declare
  v_adolescent uuid := (select v from rhp_fixture where k = 'adolescent');
  v_grantee uuid := (select v from rhp_fixture where k = 'adolescent_waived_to');
  v_org uuid := (select v from rhp_fixture where k = 'org');
  v_grant_id uuid;
  v_count_before bigint;
  v_count_after bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_adolescent::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_adolescent, v_grantee, 'view', v_adolescent)
  returning id into v_grant_id;
  perform public.set_care_access_categories(v_grant_id, array['reproductive_health']::public.care_access_category[]);
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count_before from public.reproductive_health_profiles where patient_id = v_adolescent;
  reset role;

  insert into rhp_result values
    ('category grant alone, no waiver, adolescent patient -- must read 0', 'adolescent_waived_to',
     v_count_before::text, '0', case when v_count_before = 0 then 'PASS' else 'FAIL' end);
  if v_count_before <> 0 then
    raise exception 'GAP: a category-grant-only caregiver reads an adolescent''s reproductive_health_profiles with no waiver -- the age-band gate is not layering correctly on top of can_read_clinical';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_adolescent::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.adolescent_confidentiality_waivers (organisation_id, patient_id, grantee_user_id, domain)
  values (v_org, v_adolescent, v_grantee, 'sexual_reproductive_health');
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count_after from public.reproductive_health_profiles where patient_id = v_adolescent;
  reset role;

  insert into rhp_result values
    ('category grant + explicit waiver, adolescent patient -- reads 1', 'adolescent_waived_to',
     v_count_after::text, '1', case when v_count_after = 1 then 'PASS' else 'FAIL' end);
  if v_count_after <> 1 then
    raise exception 'GAP: an adolescent''s explicit confidentiality waiver did not restore their chosen grantee''s read access';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from rhp_result
order by verdict desc, check_name, role;

rollback;
