-- ===========================================================================
-- Live proof for 20260902222215_fix_reproductive_health_profiles_write_side_category_scoping.sql.
--
-- Run: npx supabase db query --linked -f packages/db/tests/reproductive_health_profiles_write_side_category_scoping.sql
-- Wrapped in BEGIN/ROLLBACK -- a verification script, not seed data.
--
-- Checks:
--   1. THE GAP ITSELF: an adult patient's caregiver holding a 'manage'-level
--      profile_access grant but NO 'reproductive_health' category (only
--      'medications') cannot INSERT or UPDATE that patient's
--      reproductive_health_profiles row -- this is exactly the leak
--      20260902222215 closes.
--   2. A caregiver with 'manage' AND an explicit 'reproductive_health'
--      category grant CAN insert/update -- proves the fix didn't
--      overcorrect into a false negative on the intended path.
--   3. A caregiver with the 'reproductive_health' category grant but only
--      'view'-level permission (not 'manage') is still blocked from writing
--      -- proves the category check is additive to, not a replacement for,
--      the permission_level = 'manage' requirement.
--   4. The adolescent write gate still applies on top: a 'manage' + explicit
--      'reproductive_health' category grantee is STILL blocked from writing
--      to a 15-year-old's record (no waiver escape hatch on the write side,
--      by design -- see guardian_may_edit_confidential_domain's own comment).
--   5. The patient can always write their own row, unaffected.
--
-- TO CONFIRM THIS TEST DISCRIMINATES, break it on purpose: temporarily revert
-- reproductive_health_profiles_insert/update to the pre-fix form (drop the
-- profile_access_categories EXISTS clause, keep permission_level='manage' and
-- guardian_may_edit_confidential_domain) and re-run -- check 1 must FAIL,
-- showing the no-category 'manage' caregiver writing to the adult's record.
-- ===========================================================================

begin;

create temporary table rhpw_fixture(k text primary key, v uuid) on commit drop;
create temporary table rhpw_result(
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

  insert into rhpw_fixture(k, v) values ('org', v_org);

  for r in select * from (values
      ('adult_patient', 'patient'), ('no_category_manager', 'patient'),
      ('category_manager', 'patient'), ('category_viewer', 'patient'),
      ('adolescent', 'patient'), ('adolescent_manager', 'patient')
    ) as t(key_name, role_name)
  loop
    insert into rhpw_fixture(k, v) values (r.key_name, gen_random_uuid());

    insert into auth.users (id, email)
    values ((select v from rhpw_fixture where k = r.key_name),
            format('rhpwtest.%s@example.com', r.key_name));

    insert into public.profiles (id, organisation_id, role, full_name, date_of_birth)
    values ((select v from rhpw_fixture where k = r.key_name),
            v_org, r.role_name::public.user_role, format('RHPW Test %s', r.key_name),
            case when r.key_name = 'adolescent' then (current_date - interval '15 years')::date
                 else date '1990-01-01' end)
    on conflict (id) do update
      set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name,
          date_of_birth = excluded.date_of_birth;
  end loop;
end $$;

-- ==========================================================================
-- 1. THE GAP: 'manage'-level grant, NO reproductive_health category -> blocked.
-- ==========================================================================
do $$
declare
  v_adult uuid := (select v from rhpw_fixture where k = 'adult_patient');
  v_grantee uuid := (select v from rhpw_fixture where k = 'no_category_manager');
  v_org uuid := (select v from rhpw_fixture where k = 'org');
  v_grant_id uuid;
  v_raised boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_adult::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_adult, v_grantee, 'manage', v_adult)
  returning id into v_grant_id;
  perform public.set_care_access_categories(v_grant_id, array['medications']::public.care_access_category[]);
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage)
    values (v_org, v_adult, 'menstruating');
  exception when others then
    v_raised := true;
  end;
  reset role;

  insert into rhpw_result values
    ('GAP: manage grant, no reproductive_health category -- insert must be blocked', 'no_category_manager',
     v_raised::text, 'true', case when v_raised then 'PASS' else 'FAIL' end);
  if not v_raised then
    raise exception 'LEAK: a manage-level grantee with NO reproductive_health category grant inserted into the adult patient''s reproductive_health_profiles -- the gap this migration closes is still live';
  end if;
end $$;

-- ==========================================================================
-- 2. 'manage' + explicit reproductive_health category -> insert/update work.
-- ==========================================================================
do $$
declare
  v_adult uuid := (select v from rhpw_fixture where k = 'adult_patient');
  v_grantee uuid := (select v from rhpw_fixture where k = 'category_manager');
  v_org uuid := (select v from rhpw_fixture where k = 'org');
  v_grant_id uuid;
  v_raised boolean := false;
  v_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_adult::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_adult, v_grantee, 'manage', v_adult)
  returning id into v_grant_id;
  perform public.set_care_access_categories(v_grant_id, array['reproductive_health']::public.care_access_category[]);
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage)
    values (v_org, v_adult, 'menstruating');
  exception when others then
    v_raised := true;
  end;
  reset role;

  insert into rhpw_result values
    ('intended path: manage + reproductive_health category -- insert must succeed', 'category_manager',
     (not v_raised)::text, 'true', case when not v_raised then 'PASS' else 'FAIL' end);
  if v_raised then
    raise exception 'OVERCORRECTION: a manage-level grantee WITH an explicit reproductive_health category grant could not insert -- the fix over-restricted the intended path';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    update public.reproductive_health_profiles set life_stage = 'perimenopausal' where patient_id = v_adult;
  exception when others then
    v_raised := true;
  end;
  reset role;

  select count(*) into v_count from public.reproductive_health_profiles
    where patient_id = v_adult and life_stage = 'perimenopausal';

  insert into rhpw_result values
    ('intended path: manage + reproductive_health category -- update must succeed', 'category_manager',
     v_count::text, '1', case when not v_raised and v_count = 1 then 'PASS' else 'FAIL' end);
  if v_raised or v_count <> 1 then
    raise exception 'OVERCORRECTION: a manage-level grantee WITH an explicit reproductive_health category grant could not update -- the fix over-restricted the intended path';
  end if;
end $$;

-- ==========================================================================
-- 3. reproductive_health category but only 'view' permission -> still blocked.
-- ==========================================================================
do $$
declare
  v_adult uuid := (select v from rhpw_fixture where k = 'adult_patient');
  v_grantee uuid := (select v from rhpw_fixture where k = 'category_viewer');
  v_org uuid := (select v from rhpw_fixture where k = 'org');
  v_grant_id uuid;
  v_raised boolean := false;
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
  begin
    insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage)
    values (v_org, v_adult, 'menstruating')
    on conflict (patient_id) do update set life_stage = excluded.life_stage;
  exception when others then
    v_raised := true;
  end;
  reset role;

  insert into rhpw_result values
    ('view-level + reproductive_health category (no manage) -- write must be blocked', 'category_viewer',
     v_raised::text, 'true', case when v_raised then 'PASS' else 'FAIL' end);
  if not v_raised then
    raise exception 'GAP: a view-level grantee with a reproductive_health category grant but no manage permission wrote to the record -- permission_level=manage is no longer enforced';
  end if;
end $$;

-- ==========================================================================
-- 4. Adolescent write gate: manage + category grant is still blocked from
--    writing to a 15-year-old's record -- no waiver escape hatch on writes.
-- ==========================================================================
do $$
declare
  v_adolescent uuid := (select v from rhpw_fixture where k = 'adolescent');
  v_grantee uuid := (select v from rhpw_fixture where k = 'adolescent_manager');
  v_org uuid := (select v from rhpw_fixture where k = 'org');
  v_grant_id uuid;
  v_raised boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_adolescent::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_adolescent, v_grantee, 'manage', v_adolescent)
  returning id into v_grant_id;
  perform public.set_care_access_categories(v_grant_id, array['reproductive_health']::public.care_access_category[]);
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage)
    values (v_org, v_adolescent, 'menstruating');
  exception when others then
    v_raised := true;
  end;
  reset role;

  insert into rhpw_result values
    ('adolescent patient: manage + reproductive_health category still blocked (age-band write gate)', 'adolescent_manager',
     v_raised::text, 'true', case when v_raised then 'PASS' else 'FAIL' end);
  if not v_raised then
    raise exception 'GAP: a manage + category grantee wrote to a 15-year-old''s reproductive_health_profiles -- guardian_may_edit_confidential_domain is not layering correctly with the new category check';
  end if;
end $$;

-- ==========================================================================
-- 5. The patient themselves can always write their own row.
-- ==========================================================================
do $$
declare
  v_adult uuid := (select v from rhpw_fixture where k = 'adult_patient');
  v_raised boolean := false;
  v_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_adult::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.reproductive_health_profiles set life_stage = 'menstruating' where patient_id = v_adult;
  exception when others then
    v_raised := true;
  end;
  reset role;

  select count(*) into v_count from public.reproductive_health_profiles
    where patient_id = v_adult and life_stage = 'menstruating';

  insert into rhpw_result values
    ('patient can always write their own row', 'adult_patient (self)',
     v_count::text, '1', case when not v_raised and v_count = 1 then 'PASS' else 'FAIL' end);
  if v_raised or v_count <> 1 then
    raise exception 'REGRESSION: the patient themselves could no longer write their own reproductive_health_profiles row';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from rhpw_result
order by verdict desc, check_name, role;

rollback;
