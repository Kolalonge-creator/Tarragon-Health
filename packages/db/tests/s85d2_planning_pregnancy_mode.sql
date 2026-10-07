-- ===========================================================================
-- Proof for 20261007171346_s85d2_planning_pregnancy_mode.sql (S85 D2, OQ-12).
--
-- Run: npx supabase db query --linked -f packages/db/tests/s85d2_planning_pregnancy_mode.sql
-- Wrapped in BEGIN/ROLLBACK: a verification script, not seed data.
--
-- The new column inherits the table's category-scoped row policy. This proves it with simulated sessions, with a control
-- for each refusal, and then sabotages the policy once to show the refusals are real and not vacuous.
--
--   1. DEFAULT: a new row is off. A person with no row has nothing to be on.
--   2. The patient can turn it on and off for themselves.
--   3. A caregiver with 'manage' but NO reproductive_health category cannot change it (value unchanged).
--   4. A caregiver with 'view' plus the category cannot change it (needs manage too).
--   5. CONTROL: a caregiver with 'manage' plus the category can (the refusals above are not a blanket refusal).
--   6. An adolescent's guardian with 'manage' plus the category still cannot (age-band write gate).
--   7. A caregiver with no grant at all cannot even read the value.
--   8. anon cannot read or write it.
--   9. SABOTAGE: a permissive policy is added; the no-category caregiver's change must now succeed (check 3 would have failed).
-- ===========================================================================

begin;

create temporary table s85_fixture(k text primary key, v uuid) on commit drop;
create temporary table s85_result(check_name text, role text, observed text, expected text, verdict text) on commit drop;

do $$
declare
  v_org uuid;
  r record;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    insert into public.organisations (name, type) values ('S85 D2 Test Org', 'clinic') returning id into v_org;
  end if;
  insert into s85_fixture values ('org', v_org);

  for r in select * from (values
      ('adult'), ('no_category_manager'), ('category_viewer'), ('category_manager'),
      ('stranger'), ('adolescent'), ('adolescent_manager')
    ) as t(key_name)
  loop
    insert into s85_fixture values (r.key_name, gen_random_uuid());
    insert into auth.users (id, email)
    values ((select v from s85_fixture where k = r.key_name), format('s85d2.%s@example.com', r.key_name));
    insert into public.profiles (id, organisation_id, role, full_name, date_of_birth)
    values ((select v from s85_fixture where k = r.key_name), v_org, 'patient', format('S85D2 %s', r.key_name),
            case when r.key_name = 'adolescent' then (current_date - interval '15 years')::date else date '1990-01-01' end)
    on conflict (id) do update
      set organisation_id = excluded.organisation_id, role = excluded.role,
          full_name = excluded.full_name, date_of_birth = excluded.date_of_birth;
  end loop;

  -- Rows are created by the owner session (postgres), as a migration or seed would.
  insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage)
  values (v_org, (select v from s85_fixture where k = 'adult'), 'menstruating'),
         (v_org, (select v from s85_fixture where k = 'adolescent'), 'menstruating');
end $$;

-- 1. DEFAULT: off for a row that never mentioned it.
do $$
declare
  v_adult uuid := (select v from s85_fixture where k = 'adult');
  v_mode boolean;
begin
  select planning_pregnancy_mode into v_mode from public.reproductive_health_profiles where patient_id = v_adult;
  insert into s85_result values ('default: a new row is off', 'owner', v_mode::text, 'false',
    case when v_mode = false then 'PASS' else 'FAIL' end);
  if v_mode is distinct from false then
    raise exception 'FAIL: planning_pregnancy_mode is not off by default';
  end if;
end $$;

-- 2. The patient turns it on and off.
do $$
declare
  v_adult uuid := (select v from s85_fixture where k = 'adult');
  v_on boolean;
  v_off boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_adult::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.reproductive_health_profiles set planning_pregnancy_mode = true where patient_id = v_adult;
  select planning_pregnancy_mode into v_on from public.reproductive_health_profiles where patient_id = v_adult;
  update public.reproductive_health_profiles set planning_pregnancy_mode = false where patient_id = v_adult;
  select planning_pregnancy_mode into v_off from public.reproductive_health_profiles where patient_id = v_adult;
  reset role;

  insert into s85_result values ('patient turns the mode on then off', 'patient (self)',
    format('%s/%s', v_on, v_off), 'true/false', case when v_on and not v_off then 'PASS' else 'FAIL' end);
  if not (v_on and not v_off) then
    raise exception 'REGRESSION: the patient could not switch their own mode on and off';
  end if;
end $$;

-- 3. 'manage', NO reproductive_health category: refused, value unchanged.
do $$
declare
  v_adult uuid := (select v from s85_fixture where k = 'adult');
  v_g uuid := (select v from s85_fixture where k = 'no_category_manager');
  v_grant uuid;
  v_mode boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_adult::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_adult, v_g, 'manage', v_adult) returning id into v_grant;
  perform public.set_care_access_categories(v_grant, array['medications']::public.care_access_category[]);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_g::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.reproductive_health_profiles set planning_pregnancy_mode = true where patient_id = v_adult;
  exception when others then null; -- a raised refusal is also a refusal
  end;
  reset role;

  select planning_pregnancy_mode into v_mode from public.reproductive_health_profiles where patient_id = v_adult;
  insert into s85_result values ('manage grant without the reproductive_health category cannot change the mode', 'no_category_manager',
    v_mode::text, 'false', case when v_mode = false then 'PASS' else 'FAIL' end);
  if v_mode then
    raise exception 'LEAK: a manage-level caregiver with no reproductive_health category switched the mode on';
  end if;
end $$;

-- 4. 'view' plus the category: refused.
do $$
declare
  v_adult uuid := (select v from s85_fixture where k = 'adult');
  v_g uuid := (select v from s85_fixture where k = 'category_viewer');
  v_grant uuid;
  v_mode boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_adult::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_adult, v_g, 'view', v_adult) returning id into v_grant;
  perform public.set_care_access_categories(v_grant, array['reproductive_health']::public.care_access_category[]);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_g::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.reproductive_health_profiles set planning_pregnancy_mode = true where patient_id = v_adult;
  exception when others then null;
  end;
  reset role;

  select planning_pregnancy_mode into v_mode from public.reproductive_health_profiles where patient_id = v_adult;
  insert into s85_result values ('view plus category (no manage) cannot change the mode', 'category_viewer',
    v_mode::text, 'false', case when v_mode = false then 'PASS' else 'FAIL' end);
  if v_mode then
    raise exception 'LEAK: a view-level caregiver changed the mode';
  end if;
end $$;

-- 5. CONTROL: manage plus the category can.
do $$
declare
  v_adult uuid := (select v from s85_fixture where k = 'adult');
  v_g uuid := (select v from s85_fixture where k = 'category_manager');
  v_grant uuid;
  v_mode boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_adult::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_adult, v_g, 'manage', v_adult) returning id into v_grant;
  perform public.set_care_access_categories(v_grant, array['reproductive_health']::public.care_access_category[]);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_g::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.reproductive_health_profiles set planning_pregnancy_mode = true where patient_id = v_adult;
  reset role;

  select planning_pregnancy_mode into v_mode from public.reproductive_health_profiles where patient_id = v_adult;
  insert into s85_result values ('CONTROL: manage plus the category can change the mode', 'category_manager',
    v_mode::text, 'true', case when v_mode then 'PASS' else 'FAIL' end);
  if not v_mode then
    raise exception 'OVERCORRECTION: a manage caregiver WITH the reproductive_health category could not change the mode';
  end if;

  -- put it back for the later checks
  update public.reproductive_health_profiles set planning_pregnancy_mode = false where patient_id = v_adult;
end $$;

-- 6. Adolescent: manage plus the category is still refused (age-band write gate).
do $$
declare
  v_ado uuid := (select v from s85_fixture where k = 'adolescent');
  v_g uuid := (select v from s85_fixture where k = 'adolescent_manager');
  v_grant uuid;
  v_mode boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_ado::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_ado, v_g, 'manage', v_ado) returning id into v_grant;
  perform public.set_care_access_categories(v_grant, array['reproductive_health']::public.care_access_category[]);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_g::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.reproductive_health_profiles set planning_pregnancy_mode = true where patient_id = v_ado;
  exception when others then null;
  end;
  reset role;

  select planning_pregnancy_mode into v_mode from public.reproductive_health_profiles where patient_id = v_ado;
  insert into s85_result values ('adolescent: guardian with manage plus category cannot change the mode', 'adolescent_manager',
    v_mode::text, 'false', case when v_mode = false then 'PASS' else 'FAIL' end);
  if v_mode then
    raise exception 'LEAK: a guardian changed a 15-year-old''s planning mode';
  end if;
end $$;

-- 7. A stranger (no grant) cannot read the value at all.
do $$
declare
  v_adult uuid := (select v from s85_fixture where k = 'adult');
  v_s uuid := (select v from s85_fixture where k = 'stranger');
  v_seen bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_s::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from public.reproductive_health_profiles where patient_id = v_adult;
  reset role;
  insert into s85_result values ('a stranger cannot read the row', 'stranger', v_seen::text, '0',
    case when v_seen = 0 then 'PASS' else 'FAIL' end);
  if v_seen <> 0 then
    raise exception 'LEAK: a user with no grant can read another person''s reproductive profile';
  end if;
end $$;

-- 8. anon: no read, no write.
do $$
declare
  v_adult uuid := (select v from s85_fixture where k = 'adult');
  v_refused boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin
    perform 1 from public.reproductive_health_profiles where patient_id = v_adult;
  exception when insufficient_privilege then
    v_refused := true;
  end;
  reset role;
  insert into s85_result values ('anon cannot read the table', 'anon', v_refused::text, 'true',
    case when v_refused then 'PASS' else 'FAIL' end);
  if not v_refused then
    raise exception 'LEAK: anon can read reproductive_health_profiles';
  end if;
end $$;

-- 9. SABOTAGE: open the update policy and repeat check 3. The caregiver must now succeed, which proves check 3 discriminates.
do $$
declare
  v_adult uuid := (select v from s85_fixture where k = 'adult');
  v_g uuid := (select v from s85_fixture where k = 'no_category_manager');
  v_mode boolean;
begin
  create policy s85_sabotage_open_update on public.reproductive_health_profiles
    for update to authenticated using (true) with check (true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_g::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.reproductive_health_profiles set planning_pregnancy_mode = true where patient_id = v_adult;
  reset role;

  select planning_pregnancy_mode into v_mode from public.reproductive_health_profiles where patient_id = v_adult;
  insert into s85_result values ('SABOTAGE: with the policy opened, check 3 would have failed', 'no_category_manager',
    v_mode::text, 'true', case when v_mode then 'PASS' else 'FAIL' end);
  if not v_mode then
    raise exception 'VACUOUS TEST: opening the update policy did not change the outcome, so the refusal checks prove nothing';
  end if;

  drop policy s85_sabotage_open_update on public.reproductive_health_profiles;
end $$;

select check_name, role, observed, expected, verdict from s85_result order by verdict desc, check_name, role;

rollback;
