-- S68 proof 1: the WHO growth reference, the z-scores, and malnutrition routing (migrations *_s68a to *_s68d). One rolled-back transaction.
-- Proves:
--   1. Structure: 21,584 WHO rows loaded under two reference versions with the expected series sizes; no z_scores json cache column exists;
--      the new tables are closed to anon; the config table is read-only for signed-in roles.
--   2. GOLDEN: every z-score the database stores matches the value computed OUTSIDE the database (anthro for 0 to 5 years, the WHO 2007 workbooks
--      for 5 to 19), within 0.006 (z is stored to two places). See scripts/who-growth/golden_cases.py for what is compared and what is not.
--   3. Interpolation between neighbouring rows; NULL, never a guess, outside the table; the recumbent/standing 0.7 cm correction; the reference
--      version recorded on each row; WHO implausible flags (kept and still routed).
--   4. Routing (CMO pack A7, PROPOSED values from maternal_child_config): MUAC under 115 mm, weight-for-height z below -3 or oedema is severe and
--      raises a Priority 1 alert with a 12 hour due time and pages test clinicians only; MUAC 115 to under 125 mm is moderate (amber, 3 days); a well
--      child, and a baby under 6 months with a low MUAC, raise nothing. With the maternal_enabled guard OFF a real child's class is stored and NO alert
--      is raised (the test-account rule lets test children through); with it ON a real child is routed. One open same-day alert per 24 hours.
--   5. Who recorded it is derived by the database, not by the client; roles: parent, patient, stranger, anon, clinician.
--   6. SABOTAGE: (a) interpolation removed, (b) the 0.7 cm correction removed, (c) the classifier forced to none. The matching checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); perform set_config('request.jwt.claim.sub', '', true); end $f$;
-- run a statement as a user; 'ok' or the error message
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- run a statement as a user and return the first column of the first row ('ERR:' + message on error)
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q(p_sql text) returns text language plpgsql as
$f$ declare r text; begin execute p_sql into r; return r; end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role anon;
  begin execute p_sql into r; r := 'ok'; exception when others then r := sqlerrm; end;
  reset role;
  return r;
end $f$;
-- a profile (auth user first). p_dob / p_sex optional. Test accounts by default (INV-13).
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_dob date default null, p_sex text default null, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's68-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S68 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          coalesce(p_dob, (current_date - interval '30 years')::date), p_test)
  on conflict (id) do update set role = excluded.role, is_test = excluded.is_test, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  if p_sex is not null then update public.profiles set sex = p_sex::public.sex where id = v; end if;
  return v;
end $f$;
-- a dependent child managed by a parent
create function pg_temp.mkchild(p_org uuid, p_parent uuid, p_label text, p_dob date, p_sex text, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'patient', p_dob, p_sex, p_test);
begin
  update public.profiles set is_dependent_account = true where id = v;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v, p_parent, 'manage', p_parent);
  return v;
end $f$;
-- the guard, for the proof only: the real guard row can be switched by nobody but set_go_live_guard
create function pg_temp.guard_state(p_on boolean) returns void language plpgsql as
$f$ begin
  execute format('create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = '''' as ''select %s''', p_on);
end $f$;

create temp table golden (sex text, age_days int, weight numeric, height numeric, muac numeric, pos text,
  e_wfa numeric, e_lhfa numeric, e_bmi numeric, e_acfa numeric, e_wflh numeric, src text) on commit drop;
insert into golden values
-- golden-begin (generated by scripts/who-growth/golden_cases.py; do not edit)
  ('male', 1, 3.67, 48.2, null, 'recumbent', 0.6984, -0.9817, 1.6904, null, 2.2204, 'anthro'),
  ('male', 5, 2.78, 51.1, null, 'recumbent', -1.3850, 0.1771, -2.2556, null, -2.9256, 'anthro'),
  ('male', 29, 3.82, 57.2, null, 'recumbent', -1.0499, 1.3752, -2.5646, null, -3.7334, 'anthro'),
  ('male', 61, 4.82, 58.8, null, 'recumbent', -1.1535, 0.1808, -1.8024, null, -1.9470, 'anthro'),
  ('male', 95, 5.2, 63.7, 163.0000, 'recumbent', -1.8258, 0.9496, -3.2781, 2.5861, -3.6502, 'anthro'),
  ('male', 150, 8.02, 65.0, 133.0000, 'recumbent', 0.6349, -0.3646, 1.1210, -0.7128, 1.1791, 'anthro'),
  ('male', 270, 8.79, 69.6, 139.0000, 'recumbent', -0.0789, -0.9804, 0.6685, -0.5645, 0.6445, 'anthro'),
  ('male', 365, 8.82, 78.7, 128.0000, 'recumbent', -0.8171, 1.2462, -2.1351, -1.7362, -1.8063, 'anthro'),
  ('male', 500, 8.65, 83.1, 165.0000, 'recumbent', -1.8433, 0.9363, -3.5151, 1.4249, -3.1112, 'anthro'),
  ('male', 640, 10.06, 84.2, 131.0000, 'recumbent', -1.2291, -0.3336, -1.5084, -1.7472, -1.4581, 'anthro'),
  ('male', 729, 11.66, 91.0, 136.0000, 'recumbent', -0.3544, 1.0569, -1.4843, -1.3989, -1.3381, 'anthro'),
  ('male', 731, 14.24, 91.3, 159.0000, 'standing', 1.3841, 1.3642, 0.8100, 0.6190, 0.9408, 'anthro'),
  ('male', 800, 13.33, 92.4, 142.0000, 'standing', 0.4856, 1.0526, -0.2595, -0.9513, -0.1092, 'anthro'),
  ('male', 1000, 16.13, 93.7, 143.0000, 'standing', 1.2970, -0.0761, 1.9405, -1.1232, 1.9304, 'anthro'),
  ('male', 1300, 18.48, 100.0, 133.0000, 'standing', 1.4160, -0.0692, 2.1764, -2.3049, 2.1774, 'anthro'),
  ('male', 1500, 18.23, 98.9, 155.0000, 'standing', 0.7435, -1.2131, 2.2844, -0.5200, 2.2623, 'anthro'),
  ('male', 1700, 15.84, 107.1, 157.0000, 'standing', -0.8237, -0.1312, -1.1802, -0.5075, -1.1925, 'anthro'),
  ('male', 1825, 22.71, 111.0, 159.0000, 'standing', 1.5602, 0.2285, 2.0811, -0.4454, 2.0197, 'anthro'),
  ('female', 1, 2.99, 49.2, null, 'recumbent', -0.4515, -0.0625, -0.8037, null, -0.7373, 'anthro'),
  ('female', 5, 2.81, 48.1, null, 'recumbent', -1.0375, -1.0077, -0.8773, null, -0.7009, 'anthro'),
  ('female', 29, 4.39, 53.9, null, 'recumbent', 0.4363, 0.2015, 0.4473, null, 0.3241, 'anthro'),
  ('female', 61, 6.1, 55.3, null, 'recumbent', 1.3412, -0.8738, 2.5586, null, 2.8724, 'anthro'),
  ('female', 95, 5.09, 57.3, 141.0000, 'recumbent', -1.2002, -1.3259, -0.6122, 0.9075, -0.1584, 'anthro'),
  ('female', 150, 8.21, 66.7, 135.0000, 'recumbent', 1.4489, 1.2650, 1.0084, -0.0812, 1.0289, 'anthro'),
  ('female', 270, 9.24, 68.9, 149.0000, 'recumbent', 0.9793, -0.4428, 1.6500, 0.6935, 1.6289, 'anthro'),
  ('female', 365, 11.04, 72.7, 127.0000, 'recumbent', 1.6784, -0.5068, 2.6582, -1.3668, 2.5115, 'anthro'),
  ('female', 500, 9.74, 80.6, 161.0000, 'recumbent', -0.1346, 0.5450, -0.6570, 1.3557, -0.5349, 'anthro'),
  ('female', 640, 12.88, 81.5, 160.0000, 'recumbent', 1.3510, -0.7140, 2.4337, 1.0646, 2.2972, 'anthro'),
  ('female', 729, 12.09, 88.2, 165.0000, 'recumbent', 0.4236, 0.5672, 0.1020, 1.2637, 0.0630, 'anthro'),
  ('female', 731, 9.8, 85.1, 140.0000, 'standing', -1.3079, -0.1952, -1.8243, -0.7547, -1.7693, 'anthro'),
  ('female', 800, 12.09, 92.0, 160.0000, 'standing', 0.0911, 1.2902, -1.0881, 0.7434, -0.9489, 'anthro'),
  ('female', 1000, 14.25, 89.3, 133.0000, 'standing', 0.5616, -0.9597, 1.6422, -1.8570, 1.4586, 'anthro'),
  ('female', 1300, 13.63, 101.8, 145.0000, 'standing', -0.7773, 0.5625, -1.7867, -1.1410, -1.6304, 'anthro'),
  ('female', 1500, 18.67, 107.8, 151.0000, 'standing', 0.9475, 0.9906, 0.5525, -0.8728, 0.5257, 'anthro'),
  ('female', 1700, 20.99, 103.7, 132.0000, 'standing', 1.2190, -0.7596, 2.3920, -2.5796, 2.5889, 'anthro'),
  ('female', 1825, 20.66, 114.3, 148.0000, 'standing', 0.8324, 1.0302, 0.3511, -1.4052, 0.1493, 'anthro'),
  ('female', 1414, 13.24, 100.6, 123.0000, 'standing', -1.3187, -0.2847, -1.7801, null, -1.7072, 'anthro'),
  ('male', 1244, 12.89, 97.0, 165.0000, 'standing', -1.3208, -0.5529, -1.5376, 0.4495, -1.5298, 'anthro'),
  ('male', 886, 11.12, 94.4, 161.0000, 'standing', -1.4258, 0.9341, -3.1919, 0.5351, -2.9001, 'anthro'),
  ('female', 545, 9.59, 84.2, 161.0000, 'recumbent', -0.5147, 1.2380, -1.8146, 1.2950, -1.6088, 'anthro'),
  ('female', 899, 12.2, 86.8, 122.0000, 'standing', -0.2669, -1.0036, 0.4824, -2.8029, 0.3291, 'anthro'),
  ('female', 343, 8.37, 76.5, 142.0000, 'recumbent', -0.3936, 1.3371, -1.6270, 0.0189, -1.3520, 'anthro'),
  ('male', 87, 6.76, 58.6, null, 'recumbent', 0.6352, -1.1963, 1.8336, null, 2.1837, 'anthro'),
  ('female', 219, 8.48, 66.7, 161.0000, 'recumbent', 0.7833, -0.3781, 1.3287, 1.7185, 1.3695, 'anthro'),
  ('female', 115, 5.49, 61.5, 139.0000, 'recumbent', -1.1127, -0.0537, -1.4723, 0.5313, -1.4570, 'anthro'),
  ('male', 1625, 19.8, 104.9, 123.0000, 'standing', 1.0463, -0.3252, 1.8789, null, 1.8718, 'anthro'),
  ('male', 401, 11.28, 73.5, 127.0000, 'recumbent', 1.1828, -1.4863, 2.6980, -1.8698, 2.3855, 'anthro'),
  ('male', 11, 3.95, 53.5, null, 'recumbent', 0.5941, 0.8813, 0.2215, null, -0.5327, 'anthro'),
  ('female', 904, 14.73, 88.2, 155.0000, 'standing', 1.1847, -0.6393, 2.2171, 0.1598, 2.0446, 'anthro'),
  ('female', 1074, 17.0, 95.5, 129.0000, 'standing', 1.6118, 0.2506, 2.1183, -2.3181, 2.0690, 'anthro'),
  ('male', 400, 9.6, 74.2, null, 'standing', -0.2867, -0.8963, 0.3359, null, 0.1477, 'anthro'),
  ('female', 600, 11.0, 82.0, null, 'standing', 0.3090, 0.0925, 0.3487, null, 0.3378, 'anthro'),
  ('male', 900, 12.5, 88.5, null, 'recumbent', -0.4779, -1.1273, 0.3208, null, 0.1390, 'anthro'),
  ('female', 1200, 14.1, 96.3, null, 'recumbent', -0.2100, -0.4474, 0.0631, null, 0.0442, 'anthro'),
  ('male', 1860, 18.26, 112.7, null, 'standing', -0.1109, 0.5173, -0.7297, null, null, 'who2007_files'),
  ('male', 2000, 16.81, 108.8, null, 'standing', -1.0843, -0.8358, -0.8750, null, null, 'who2007_files'),
  ('male', 2400, 23.8, 121.8, null, 'standing', 0.6191, 0.4914, 0.4525, null, null, 'who2007_files'),
  ('male', 2900, 24.21, 124.6, null, 'standing', -0.3004, -0.4159, -0.0851, null, null, 'who2007_files'),
  ('male', 3300, 31.58, 128.4, null, 'standing', 0.7135, -0.7218, 1.5218, null, null, 'who2007_files'),
  ('male', 3652, 28.11, 132.4, null, 'standing', -0.6531, -0.8430, -0.2425, null, null, 'who2007_files'),
  ('male', 4200, 34.31, 146.2, null, 'standing', null, 0.0314, -0.6639, null, null, 'who2007_files'),
  ('male', 5000, 44.8, 165.3, null, 'standing', null, 0.5582, -1.2474, null, null, 'who2007_files'),
  ('male', 6000, 69.74, 169.9, null, 'standing', null, -0.5380, 1.0834, null, null, 'who2007_files'),
  ('male', 6800, 68.82, 179.7, null, 'standing', null, 0.4444, -0.2551, null, null, 'who2007_files'),
  ('female', 1860, 15.1, 105.9, null, 'standing', -1.3967, -0.7869, -1.3537, null, null, 'who2007_files'),
  ('female', 2000, 21.94, 108.3, null, 'standing', 0.9291, -0.7569, 1.8721, null, null, 'who2007_files'),
  ('female', 2400, 20.95, 121.6, null, 'standing', -0.1349, 0.6056, -0.7857, null, null, 'who2007_files'),
  ('female', 2900, 23.26, 128.2, null, 'standing', -0.4177, 0.3453, -0.9651, null, null, 'who2007_files'),
  ('female', 3300, 26.69, 135.1, null, 'standing', -0.3602, 0.3912, -0.8811, null, null, 'who2007_files'),
  ('female', 3652, 29.45, 141.8, null, 'standing', -0.4651, 0.4959, -1.1256, null, null, 'who2007_files'),
  ('female', 4200, 46.95, 151.3, null, 'standing', null, 0.4630, 1.0583, null, null, 'who2007_files'),
  ('female', 5000, 55.13, 161.3, null, 'standing', null, 0.3437, 0.6343, null, null, 'who2007_files'),
  ('female', 6000, 58.66, 165.6, null, 'standing', null, 0.4310, 0.1750, null, null, 'who2007_files'),
  ('female', 6800, 63.9, 157.8, null, 'standing', null, -0.8130, 1.1845, null, null, 'who2007_files')
-- golden-end
;

do $$
declare
  v_org uuid; v_parent uuid; v_stranger uuid; v_clin uuid; v_clin_real uuid; v_admin uuid;
  v_boy uuid; v_girl uuid; g record; m public.child_growth_measurements%rowtype; v_dob date := date '2000-01-01';
  v_n integer := 0; v_bad integer := 0; v_cmp integer := 0; e numeric; a numeric; v_id uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_parent := pg_temp.mkuser(v_org, 'parent', 'patient'); v_stranger := pg_temp.mkuser(v_org, 'stranger', 'patient');
  v_clin := pg_temp.mkuser(v_org, 'clin_test', 'clinician'); v_clin_real := pg_temp.mkuser(v_org, 'clin_real', 'clinician', null, null, false);
  v_boy := pg_temp.mkchild(v_org, v_parent, 'boy', v_dob, 'male'); v_girl := pg_temp.mkchild(v_org, v_parent, 'girl', v_dob, 'female');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('parent', v_parent); perform pg_temp.setf('stranger', v_stranger);
  perform pg_temp.setf('clin', v_clin); perform pg_temp.setf('clin_real', v_clin_real); perform pg_temp.setf('boy', v_boy); perform pg_temp.setf('girl', v_girl);

  -- 1. structure
  perform pg_temp.ck('WHO rows loaded', '21584', (select count(*)::text from public.growth_reference_lms));
  perform pg_temp.ck('2006 standard rows', '20792', (select count(*)::text from public.growth_reference_lms where reference_version = 'who-2006-v1'));
  perform pg_temp.ck('2007 reference rows', '792', (select count(*)::text from public.growth_reference_lms where reference_version = 'who-2007-v1'));
  perform pg_temp.ck('weight-for-age boys has a row for every day 0 to 1856', '1857',
    (select count(*)::text from public.growth_reference_lms where sex = 'male' and measurement_type = 'weight_for_age' and index_unit = 'age_days'));
  perform pg_temp.ck('weight-for-length girls runs 45.0 to 110.0 in 0.1 steps', '651',
    (select count(*)::text from public.growth_reference_lms where sex = 'female' and measurement_type = 'weight_for_length'));
  perform pg_temp.ck('MUAC-for-age starts at day 91', '91', (select min(index_value)::integer::text from public.growth_reference_lms where measurement_type = 'muac_for_age'));
  perform pg_temp.ck('no z_scores json cache column was added', '0', (select count(*)::text from information_schema.columns where table_name = 'child_growth_measurements' and column_name = 'z_scores'));
  perform pg_temp.ck('anon cannot read the config table', 'permission denied for table maternal_child_config', pg_temp.try_anon('select 1 from public.maternal_child_config limit 1'));
  perform pg_temp.ck('a signed-in user cannot write the config table', 'permission denied for table maternal_child_config',
    pg_temp.try_as(v_parent, 'update public.maternal_child_config set is_active = false'));
  perform pg_temp.ck('a signed-in user reads the config', '1', pg_temp.q_as(v_parent, $q$select count(*)::text from public.maternal_child_config where config_key = 'growth.nutrition_routing'$q$));
  perform pg_temp.ck('maternal_enabled exists and is off', 'false', (select is_on::text from public.go_live_guards where key = 'maternal_enabled'));

  -- 2. golden
  for g in select * from golden loop
    v_n := v_n + 1;
    insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, height_cm, muac_mm, measure_position)
    values (v_org, case g.sex when 'male' then v_boy else v_girl end, (v_dob + g.age_days)::timestamptz + interval '12 hours', g.weight, g.height, g.muac, g.pos)
    returning * into m;
    foreach e in array array[1]::numeric[] loop null; end loop;
    if g.e_wfa is not null then v_cmp := v_cmp + 1; if m.weight_for_age_z is null or abs(m.weight_for_age_z - g.e_wfa) > 0.006 then v_bad := v_bad + 1; raise notice 'WFA % % d%: db % expected %', g.src, g.sex, g.age_days, m.weight_for_age_z, g.e_wfa; end if; end if;
    if g.e_lhfa is not null then v_cmp := v_cmp + 1; if m.height_for_age_z is null or abs(m.height_for_age_z - g.e_lhfa) > 0.006 then v_bad := v_bad + 1; raise notice 'HFA % % d%: db % expected %', g.src, g.sex, g.age_days, m.height_for_age_z, g.e_lhfa; end if; end if;
    if g.e_bmi is not null then v_cmp := v_cmp + 1; if m.bmi_for_age_z is null or abs(m.bmi_for_age_z - g.e_bmi) > 0.006 then v_bad := v_bad + 1; raise notice 'BMI % % d%: db % expected %', g.src, g.sex, g.age_days, m.bmi_for_age_z, g.e_bmi; end if; end if;
    if g.e_acfa is not null then v_cmp := v_cmp + 1; if m.muac_for_age_z is null or abs(m.muac_for_age_z - g.e_acfa) > 0.006 then v_bad := v_bad + 1; raise notice 'MUAC % % d%: db % expected %', g.src, g.sex, g.age_days, m.muac_for_age_z, g.e_acfa; end if; end if;
    if g.e_wflh is not null then v_cmp := v_cmp + 1; if m.weight_for_height_z is null or abs(m.weight_for_height_z - g.e_wflh) > 0.006 then v_bad := v_bad + 1; raise notice 'WFH % % d%: db % expected %', g.src, g.sex, g.age_days, m.weight_for_height_z, g.e_wflh; end if; end if;
  end loop;
  perform pg_temp.ck('golden cases run', 'true', (v_n >= 60)::text);
  perform pg_temp.ck('golden comparisons made (not vacuous)', 'true', (v_cmp >= 200)::text);
  perform pg_temp.ck('golden comparisons that disagree', '0', v_bad::text);
  perform pg_temp.setf('golden_ok', v_org);
end $$;

-- 3. behaviour of the method
do $$
declare
  v_org uuid := pg_temp.f('org'); v_boy uuid := pg_temp.f('boy'); v_dob date := date '2000-01-01';
  a record; b record; mid record; m1 public.child_growth_measurements%rowtype; m2 public.child_growth_measurements%rowtype;
begin
  -- interpolation: halfway between two monthly rows is the mean of the two (2007 reference, months 100 and 101)
  select * into a from private.growth_lms_at('who-2007-v1', 'male', 'height_for_age', 'age_months', 100);
  select * into b from private.growth_lms_at('who-2007-v1', 'male', 'height_for_age', 'age_months', 101);
  select * into mid from private.growth_lms_at('who-2007-v1', 'male', 'height_for_age', 'age_months', 100.5);
  perform pg_temp.ck('interpolation: M halfway between two rows is their mean', 'true', (abs(mid.m - (a.m + b.m) / 2) < 0.0000001)::text);
  perform pg_temp.ck('interpolation: L halfway between two rows is their mean', 'true', (abs(mid.l - (a.l + b.l) / 2) < 0.0000001)::text);
  -- outside the table is NULL, never a guess
  perform pg_temp.ck('weight-for-height above 120 cm is null', 'true', (private.growth_z_weight_for_length('male', 1000, 125, 20) is null)::text);
  perform pg_temp.ck('weight-for-length below 45 cm is null', 'true', (private.growth_z_weight_for_length('male', 30, 40, 2) is null)::text);
  perform pg_temp.ck('MUAC-for-age before day 91 is null', 'true', (private.growth_z_age('male', 'muac_for_age', 60, 12.0) is null)::text);
  perform pg_temp.ck('weight-for-age after month 120 (2007 reference ends) is null', 'true', (private.growth_z_age('male', 'weight_for_age', 3800, 40) is null)::text);
  perform pg_temp.ck('head circumference after day 1856 is null (no 2007 table)', 'true', (private.growth_z_age('male', 'head_circumference_for_age', 3000, 52) is null)::text);
  perform pg_temp.ck('height-for-age at 18 years is computed', 'true', (private.growth_z_age('female', 'height_for_age', 6500, 160) is not null)::text);
  perform pg_temp.ck('a median value is z = 0 (boy, birth weight 3.3464)', 'true', (abs(private.growth_z_age('male', 'weight_for_age', 0, 3.3464)) < 0.001)::text);
  perform pg_temp.ck('the old entry point still answers (delegates, no nearest-row guess)', 'true', (abs(private.growth_z_score('male', 'weight_for_age', 0, 3.3464)) < 0.001)::text);

  -- recumbent and standing: the same child read two ways differs by exactly the 0.7 cm correction
  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, height_cm, measure_position)
  values (v_org, v_boy, (v_dob + 400)::timestamptz + interval '12 hours', 9.6, 74.2, 'standing') returning * into m1;
  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, height_cm, measure_position)
  values (v_org, v_boy, (v_dob + 400)::timestamptz + interval '13 hours', 9.6, 74.9, 'recumbent') returning * into m2;
  perform pg_temp.ck('standing 74.2 cm under 2 years scores as recumbent 74.9 cm (height-for-age)', m2.height_for_age_z::text, m1.height_for_age_z::text);
  perform pg_temp.ck('...and the weight-for-length too', m2.weight_for_height_z::text, m1.weight_for_height_z::text);
  perform pg_temp.ck('a toddler is scored on the 2006 standard', 'who-2006-v1', m1.reference_version);
  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, height_cm, measure_position)
  values (v_org, v_boy, (v_dob + 900)::timestamptz + interval '12 hours', 12.5, 88.5, 'recumbent') returning * into m1;
  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, height_cm, measure_position)
  values (v_org, v_boy, (v_dob + 900)::timestamptz + interval '13 hours', 12.5, 87.8, 'standing') returning * into m2;
  perform pg_temp.ck('recumbent 88.5 cm over 2 years scores as standing 87.8 cm', m2.height_for_age_z::text, m1.height_for_age_z::text);
  -- which table: length up to 730 days, height after
  perform pg_temp.ck('age 700 days uses weight-for-length', 'true', (private.growth_z_weight_for_length('male', 700, 80, 10) =
    (select private.growth_z(l, m, s, 10, true) from private.growth_lms_at('who-2006-v1', 'male', 'weight_for_length', 'length_cm', 80)))::text);
  perform pg_temp.ck('age 800 days uses weight-for-height', 'true', (private.growth_z_weight_for_length('male', 800, 80, 10) =
    (select private.growth_z(l, m, s, 10, true) from private.growth_lms_at('who-2006-v1', 'male', 'weight_for_height', 'height_cm', 80)))::text);

  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, height_cm)
  values (v_org, v_boy, (v_dob + 3000)::timestamptz + interval '12 hours', 28, 130) returning * into m1;
  perform pg_temp.ck('an 8 year old is scored on the 2007 reference', 'who-2007-v1', m1.reference_version);
  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, height_cm)
  values (v_org, v_boy, (v_dob + 400)::timestamptz + interval '14 hours', 1.0, 74.0) returning * into m1;
  perform pg_temp.ck('an impossible weight is flagged', 'true', ('weight_for_age_z_implausible' = any (m1.plausibility_flags))::text);
  perform pg_temp.ck('...and the row is kept', '1', (select count(*)::text from public.child_growth_measurements where id = m1.id));
end $$;

-- 4. routing. Test children are routed even with the guard off; a real child only when the guard is on.
do $$
declare
  v_org uuid := pg_temp.f('org'); v_parent uuid := pg_temp.f('parent'); v_clin uuid := pg_temp.f('clin'); v_real uuid := pg_temp.f('clin_real');
  v_t uuid; v_r uuid; v_dob date := (current_date - 400); m public.child_growth_measurements%rowtype; v_al public.clinician_alerts%rowtype; c uuid;
begin
  v_t := pg_temp.mkchild(v_org, v_parent, 'sam_test_child', v_dob, 'female', true);
  v_r := pg_temp.mkchild(v_org, v_parent, 'sam_real_child', v_dob, 'female', false);
  perform pg_temp.setf('t_child', v_t); perform pg_temp.setf('r_child', v_r);

  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, height_cm, muac_mm)
  values (v_org, v_t, now(), 6.2, 72, 108) returning * into m;
  perform pg_temp.ck('severe MUAC is classed severe_acute', 'severe_acute', m.nutrition_class);
  perform pg_temp.ck('the config version used is on the row', '1', m.nutrition_config_version::text);
  select * into v_al from public.clinician_alerts where id = m.nutrition_alert_id;
  perform pg_temp.ck('a test child raises a Priority 1 alert', 'urgent_escalation', v_al.level::text);
  perform pg_temp.ck('...due within 12 hours', 'true', (v_al.sla_due_at between now() + interval '11 hours 55 minutes' and now() + interval '12 hours 5 minutes')::text);
  perform pg_temp.ck('...whose text says it is not a diagnosis', 'true', (v_al.detail like '%not a diagnosis%')::text);
  perform pg_temp.ck('neutral title', 'Child growth check: same-day review', v_al.title);
  perform pg_temp.ck('a test clinician is paged once', '1', (select count(*)::text from public.notifications where recipient_id = v_clin and source_id = v_al.id));
  perform pg_temp.ck('a real clinician is NOT paged for a test child', '0', (select count(*)::text from public.notifications where recipient_id = v_real and source_id = v_al.id));
  perform pg_temp.ck('the page names no reading and no condition', 'child growth check', (select payload ->> 'vital_label' from public.notifications where recipient_id = v_clin and source_id = v_al.id limit 1));
  perform pg_temp.ck('the outbox carries child.growth_recorded', '1', (select count(*)::text from public.domain_events where event_type = 'child.growth_recorded' and aggregate_id = m.id));
  perform pg_temp.ck('...and an urgent child.nutrition_flagged', 'urgent', (select priority from public.domain_events where event_type = 'child.nutrition_flagged' and aggregate_id = m.id));
  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, muac_mm) values (v_org, v_t, now() + interval '1 minute', 105);
  perform pg_temp.ck('one open same-day alert per 24 hours', '1', (select count(*)::text from public.clinician_alerts where patient_id = v_t and title = 'Child growth check: same-day review'));

  c := pg_temp.mkchild(v_org, v_parent, 'mam_child', v_dob, 'male', true);
  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, muac_mm) values (v_org, c, now(), 120) returning * into m;
  select * into v_al from public.clinician_alerts where id = m.nutrition_alert_id;
  perform pg_temp.ck('MUAC 120 mm is moderate', 'moderate_acute', m.nutrition_class);
  perform pg_temp.ck('...an amber review', 'clinician_review', v_al.level::text);
  perform pg_temp.ck('...due within 3 days', 'true', (v_al.sla_due_at between now() + interval '71 hours' and now() + interval '73 hours')::text);
  perform pg_temp.ck('moderate pages nobody', '0', (select count(*)::text from public.notifications where source_id = v_al.id));
  perform pg_temp.ck('MUAC exactly 115 is moderate not severe', 'moderate_acute', private.classify_nutrition(400, 115, null, false, private.maternal_child_rules('growth.nutrition_routing')));
  perform pg_temp.ck('MUAC exactly 125 is not flagged', 'none', private.classify_nutrition(400, 125, null, false, private.maternal_child_rules('growth.nutrition_routing')));
  perform pg_temp.ck('weight-for-height z -3.01 is severe', 'severe_acute', private.classify_nutrition(400, null, -3.01, false, private.maternal_child_rules('growth.nutrition_routing')));
  perform pg_temp.ck('weight-for-height z -3.0 is moderate', 'moderate_acute', private.classify_nutrition(400, null, -3.0, false, private.maternal_child_rules('growth.nutrition_routing')));
  perform pg_temp.ck('weight-for-height z -2.0 is none', 'none', private.classify_nutrition(400, null, -2.0, false, private.maternal_child_rules('growth.nutrition_routing')));
  perform pg_temp.ck('bilateral oedema alone is severe', 'severe_acute', private.classify_nutrition(400, 140, 0, true, private.maternal_child_rules('growth.nutrition_routing')));
  perform pg_temp.ck('a baby under 6 months is not classed by MUAC', 'none', private.classify_nutrition(150, 100, 0, false, private.maternal_child_rules('growth.nutrition_routing')));
  perform pg_temp.ck('a child of 5 years is not classed by MUAC', 'none', private.classify_nutrition(1900, 100, null, false, private.maternal_child_rules('growth.nutrition_routing')));
  c := pg_temp.mkchild(v_org, v_parent, 'thin_child', v_dob, 'male', true);
  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, height_cm) values (v_org, c, now(), 5.6, 74) returning * into m;
  perform pg_temp.ck('a very low weight-for-height is severe by z alone', 'severe_acute', m.nutrition_class);
  c := pg_temp.mkchild(v_org, v_parent, 'well_child', v_dob, 'male', true);
  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, height_cm, muac_mm) values (v_org, c, now(), 10.0, 76, 150) returning * into m;
  perform pg_temp.ck('a well child is none and raises nothing', 'none|', m.nutrition_class || '|' || coalesce(m.nutrition_alert_id::text, ''));
  c := pg_temp.mkchild(v_org, v_parent, 'odd_child', v_dob, 'male', true);
  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, height_cm, muac_mm) values (v_org, c, now(), 1.2, 76, 104) returning * into m;
  select * into v_al from public.clinician_alerts where id = m.nutrition_alert_id;
  perform pg_temp.ck('an implausible reading is still routed, and the alert says to check it', 'true', (v_al.id is not null and v_al.detail like '%check the measurement%')::text);

  -- guard OFF, REAL child: class stored, no alert, nobody paged
  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, height_cm, muac_mm) values (v_org, v_r, now(), 6.2, 72, 108) returning * into m;
  perform pg_temp.ck('guard off: a real child still gets the class stored', 'severe_acute', m.nutrition_class);
  perform pg_temp.ck('guard off: but no alert is raised', '0', (select count(*)::text from public.clinician_alerts where patient_id = v_r));
  perform pg_temp.ck('guard off: and nobody is paged', '0', (select count(*)::text from public.notifications where recipient_id = v_real and created_at > now() - interval '1 minute'));
  perform pg_temp.guard_state(true);
  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, height_cm, muac_mm) values (v_org, v_r, now() + interval '2 minutes', 6.2, 72, 108) returning * into m;
  perform pg_temp.ck('guard on: a real child is routed', '1', (select count(*)::text from public.clinician_alerts where patient_id = v_r and level = 'urgent_escalation'));
  perform pg_temp.ck('guard on: a real clinician is paged for a real child', '1', (select count(*)::text from public.notifications where recipient_id = v_real and source_id = m.nutrition_alert_id));
  perform pg_temp.guard_state(false);
end $$;

-- 5. who recorded it, and roles
do $$
declare
  v_org uuid := pg_temp.f('org'); v_parent uuid := pg_temp.f('parent'); v_stranger uuid := pg_temp.f('stranger'); v_clin uuid := pg_temp.f('clin'); v_t uuid := pg_temp.f('t_child');
  v_teen uuid; m public.child_growth_measurements%rowtype; r text;
begin
  perform pg_temp.act(v_parent);
  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, source) values (v_org, v_t, now() + interval '3 minutes', 8.0, 'clinician_recorded') returning * into m;
  perform pg_temp.back();
  perform pg_temp.ck('a parent entry is caregiver_entered whatever the client sent', 'caregiver_entered', m.source);
  perform pg_temp.ck('...with the parent as recorded_by', v_parent::text, m.recorded_by::text);
  v_teen := pg_temp.mkuser(v_org, 'teen', 'patient', (current_date - interval '16 years')::date, 'female');
  perform pg_temp.act(v_teen);
  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, height_cm) values (v_org, v_teen, now(), 55, 160) returning * into m;
  perform pg_temp.back();
  perform pg_temp.ck('a self entry is patient_entered', 'patient_entered', m.source);
  perform pg_temp.ck('a 16 year old is scored on the 2007 reference', 'who-2007-v1', m.reference_version);
  perform pg_temp.act(v_clin);
  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, height_cm) values (v_org, v_t, now() + interval '4 minutes', 8.4, 70) returning * into m;
  perform pg_temp.back();
  perform pg_temp.ck('a clinician entry is clinician_recorded', 'clinician_recorded', m.source);
  perform pg_temp.ck('a stranger cannot add a measurement for the child', 'true', (pg_temp.try_as(v_stranger, format('insert into public.child_growth_measurements (organisation_id, patient_id, weight_kg) values (%L, %L, 7)', v_org, v_t)) like '%row-level security%')::text);
  perform pg_temp.ck('a stranger reads none of the child''s measurements', '0', pg_temp.q_as(v_stranger, format('select count(*)::text from public.child_growth_measurements where patient_id = %L', v_t)));
  perform pg_temp.ck('the parent reads the child''s measurements', 'true', (pg_temp.q_as(v_parent, format('select count(*)::text from public.child_growth_measurements where patient_id = %L', v_t))::integer > 0)::text);
  perform pg_temp.ck('anon reads nothing', 'permission denied for table child_growth_measurements', pg_temp.try_anon('select 1 from public.child_growth_measurements limit 1'));
  perform pg_temp.ck('the parent cannot delete a measurement directly', '0', pg_temp.q_as(v_parent, format($q$with d as (delete from public.child_growth_measurements where patient_id = %L returning 1) select count(*)::text from d$q$, v_t)));
end $$;

-- 6. SABOTAGE. Each one breaks the code and a matching check must flip.
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('private.growth_lms_at(text,sex,growth_measurement_type,text,numeric)'::regprocedure);
  execute replace(replace(v_def, 'lo.l_value + (hi.l_value - lo.l_value) * (p_x - lo.index_value) / (hi.index_value - lo.index_value)', 'lo.l_value'),
                  'lo.m_value + (hi.m_value - lo.m_value) * (p_x - lo.index_value) / (hi.index_value - lo.index_value)', 'lo.m_value');
end $$;
do $$
declare a record; b record; mid record;
begin
  select * into a from private.growth_lms_at('who-2007-v1', 'male', 'height_for_age', 'age_months', 100);
  select * into b from private.growth_lms_at('who-2007-v1', 'male', 'height_for_age', 'age_months', 101);
  select * into mid from private.growth_lms_at('who-2007-v1', 'male', 'height_for_age', 'age_months', 100.5);
  insert into results values ('sabotaged', 'interpolation: M halfway between two rows is their mean', 'true', (abs(mid.m - (a.m + b.m) / 2) < 0.0000001)::text);
end $$;
update public.maternal_child_config set rules = jsonb_set(rules, '{length_height_correction_cm}', '0') where config_key = 'growth.reference_versions';
do $$
declare v_org uuid := pg_temp.f('org'); v_boy uuid := pg_temp.f('boy'); m1 public.child_growth_measurements%rowtype; m2 public.child_growth_measurements%rowtype; v_dob date := date '2000-01-01';
begin
  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, height_cm, measure_position) values (v_org, v_boy, (v_dob + 410)::timestamptz + interval '12 hours', 9.6, 74.2, 'standing') returning * into m1;
  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, height_cm, measure_position) values (v_org, v_boy, (v_dob + 410)::timestamptz + interval '13 hours', 9.6, 74.9, 'recumbent') returning * into m2;
  insert into results values ('sabotaged', 'standing 74.2 cm under 2 years scores as recumbent 74.9 cm (height-for-age)', m2.height_for_age_z::text, m1.height_for_age_z::text);
end $$;
create or replace function private.classify_nutrition(p_age_days integer, p_muac_mm numeric, p_wfh_z numeric, p_oedema boolean, p_rules jsonb)
returns text language sql immutable set search_path = '' as $$ select 'none'::text $$;
do $$
declare v_org uuid := pg_temp.f('org'); v_parent uuid := pg_temp.f('parent'); c uuid; m public.child_growth_measurements%rowtype;
begin
  c := pg_temp.mkchild(v_org, v_parent, 'sabotage_child', current_date - 400, 'male', true);
  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, height_cm, muac_mm) values (v_org, c, now(), 6.2, 72, 108) returning * into m;
  insert into results values ('sabotaged', 'severe MUAC is classed severe_acute', 'severe_acute', coalesce(m.nutrition_class, 'null'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S68 WHO growth proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
