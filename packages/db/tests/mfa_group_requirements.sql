-- ===========================================================================
-- Proof: two-factor sign-in (2FA) required per group (migration 20261105110919_mfa_group_requirements).
--
-- Proves, with simulated sessions in one rolled-back transaction:
--   1. Shipped state: every group is off; an AAL1 doctor reads a staff-only table, is_org_staff and is_admin are true at AAL1,
--      and my_mfa_requirement says "not required" (nothing changes until an admin switches a group on).
--   2. The switch: only an admin may call it (a doctor, a patient and anon are refused); a short change note is refused; turning
--      a group on while any member has no factor is refused unless confirmed; with confirmation the version moves to 2 and one
--      history row is written; an admin cannot UPDATE the table directly.
--   3. Enforcement, clinician group on: an AAL1 doctor reads ZERO rows of the staff-only table and is_org_staff, staff_may_read
--      and has_emergency_access are all false; the same doctor at AAL2 reads the row; a care coordinator (another group) at AAL1
--      is unaffected; task_is_mine is false for the doctor's own claimed task at AAL1 and true at AAL2; my_mfa_requirement says required for the doctor and not for the coordinator.
--   4. Tier group: with only the chief_medical_officer tier on, the CMO at AAL1 is held and a senior medical officer is not.
--   5. Lock-out guards: an admin at AAL1 cannot switch on the admin group (they are in it); an admin at AAL2 can; then an AAL1
--      admin is no longer is_admin and holds no capability through has_permission; turning a group OFF needs no confirmation.
--   6. The admin page function: right member and enrolled counts, unenrolled CMO counted, empty for a non-admin.
--   7. SABOTAGE, each MUST flip: (a) mfa_requirement_met always true (the AAL1 doctor reads the row again); (b) the "caller in
--      group must be AAL2" guard removed (an AAL1 admin can switch on the admin group); (c) the unenrolled-confirmation guard
--      removed (switching on succeeds without confirmation); (d) mfa_required_for ignoring the tier (a senior medical officer is
--      held by the CMO-tier group).
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures. Sabotaged rows print as PASS (caught) when the check flipped.
-- ===========================================================================
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.rec(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

-- Run p_sql as p_role with the given user id and assurance level; return the scalar or ERR:<sqlstate>.
create function pg_temp.as_val(p_uid uuid, p_role text, p_aal text, p_sql text) returns text language plpgsql as
$f$
declare v_out text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then json_build_object('role', p_role)::text
         else json_build_object('sub', p_uid, 'role', p_role, 'aal', p_aal)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := 'ERR:' || sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end $f$;

create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p_k text) returns uuid language sql as $$ select v from fx where k = p_k $$;

do $$
declare
  v_org uuid;
  v_admin uuid := gen_random_uuid();   -- admin, HAS a verified factor
  v_admin2 uuid := gen_random_uuid();  -- admin, no factor
  v_cmo uuid := gen_random_uuid();     -- clinician, chief_medical_officer tier, no factor
  v_smo uuid := gen_random_uuid();     -- clinician, senior_medical_officer tier, HAS a factor
  v_coord uuid := gen_random_uuid();   -- care_coordinator, no factor
  v_pat uuid := gen_random_uuid();
  v_inc uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'mfa-group-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}'
    from unnest(array[v_admin, v_admin2, v_cmo, v_smo, v_coord, v_pat]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_admin,  v_org, 'admin',            'MFA Admin',        '+2348058881701'),
    (v_admin2, v_org, 'admin',            'MFA Admin Two',    '+2348058881702'),
    (v_cmo,    v_org, 'clinician',        'MFA CMO',          '+2348058881703'),
    (v_smo,    v_org, 'clinician',        'MFA Senior',       '+2348058881704'),
    (v_coord,  v_org, 'care_coordinator', 'MFA Coordinator',  '+2348058881705'),
    (v_pat,    v_org, 'patient',          'MFA Patient',      '+2348058881706')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  -- clinical_staff rows written as the table owner; triggers that demand credentials for activation stay out of the way by
  -- leaving the rows inactive (tier groups follow doctor_tier whether or not the row is active, by design).
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, doctor_tier) values
    (v_org, v_cmo, 'MFA CMO', false, 'chief_medical_officer'),
    (v_org, v_smo, 'MFA Senior', false, 'senior_medical_officer');
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
    (gen_random_uuid(), v_admin, 'proof', 'totp', 'verified', now(), now(), 'x'),
    (gen_random_uuid(), v_smo, 'proof', 'totp', 'verified', now(), now(), 'x'),
    -- An unverified factor is not a factor.
    (gen_random_uuid(), v_cmo, 'proof-unverified', 'totp', 'unverified', now(), now(), 'x');
  insert into public.clinical_incident_reports (id, organisation_id, category, severity, description, reported_by)
  values (v_inc, v_org, 'other', 'low', 'MFA proof incident', v_smo);
  insert into public.emergency_record_access_grants (patient_id, patient_org_id, requester_id, requester_org_id, reason, expires_at)
  values (v_pat, v_org, v_cmo, v_org, 'MFA proof break-glass grant', now() + interval '1 hour');

  insert into fx values ('org', v_org), ('admin', v_admin), ('admin2', v_admin2), ('cmo', v_cmo), ('smo', v_smo),
                        ('coord', v_coord), ('pat', v_pat), ('inc', v_inc);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Shipped state.
-- ---------------------------------------------------------------------------
select pg_temp.rec('1 shipped', 'no group is on', '0', (select count(*)::text from public.mfa_group_requirements where required));
select pg_temp.rec('1 shipped', 'every role and every tier has a row', 'true',
  ((select count(*) from public.mfa_group_requirements)
    = (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname in ('user_role', 'doctor_tier')))::text);
select pg_temp.rec('1 shipped', 'AAL1 doctor reads the staff-only row', '1',
  pg_temp.as_val(pg_temp.f('smo'), 'authenticated', 'aal1', format('select count(*) from public.clinical_incident_reports where id = %L', pg_temp.f('inc'))));
select pg_temp.rec('1 shipped', 'AAL1 CMO break-glass grant usable', 'true',
  pg_temp.as_val(pg_temp.f('cmo'), 'authenticated', 'aal1', format('select private.has_emergency_access(%L, null)', pg_temp.f('pat'))));
select pg_temp.rec('1 shipped', 'AAL1 doctor task_is_mine on own claimed task', 'true',
  pg_temp.as_val(pg_temp.f('smo'), 'authenticated', 'aal1', format($q$select private.task_is_mine(null, %L, null, 'claimed')$q$, pg_temp.f('smo'))));
select pg_temp.rec('1 shipped', 'AAL1 admin has_permission', 'true', pg_temp.as_val(pg_temp.f('admin2'), 'authenticated', 'aal1', $q$select private.has_permission('anything.at_all')$q$));
select pg_temp.rec('1 shipped', 'AAL1 admin is_admin', 'true', pg_temp.as_val(pg_temp.f('admin2'), 'authenticated', 'aal1', 'select private.is_admin()'));
select pg_temp.rec('1 shipped', 'AAL1 doctor not required', 'false',
  pg_temp.as_val(pg_temp.f('cmo'), 'authenticated', 'aal1', 'select required from public.my_mfa_requirement()'));
select pg_temp.rec('1 shipped', 'mfa_any_group_required false', 'false',
  pg_temp.as_val(pg_temp.f('cmo'), 'authenticated', 'aal1', 'select public.mfa_any_group_required()'));
select pg_temp.rec('1 shipped', 'anon cannot read my_mfa_requirement', 'ERR:42501',
  pg_temp.as_val(null, 'anon', null, 'select required from public.my_mfa_requirement()'));

-- ---------------------------------------------------------------------------
-- 2. The switch.
-- ---------------------------------------------------------------------------
select pg_temp.rec('2 switch', 'doctor refused', 'ERR:42501', pg_temp.as_val(pg_temp.f('smo'), 'authenticated', 'aal2',
  $q$select public.set_mfa_group_requirement('clinician', null, true, 'A doctor trying to switch this on', true)$q$));
select pg_temp.rec('2 switch', 'patient refused', 'ERR:42501', pg_temp.as_val(pg_temp.f('pat'), 'authenticated', 'aal1',
  $q$select public.set_mfa_group_requirement('patient', null, true, 'A patient trying to switch this on', true)$q$));
select pg_temp.rec('2 switch', 'anon refused', 'ERR:42501', pg_temp.as_val(null, 'anon', null,
  $q$select public.set_mfa_group_requirement('patient', null, true, 'Anon trying to switch this one on', true)$q$));
select pg_temp.rec('2 switch', 'short note refused', 'ERR:22023', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'aal2',
  $q$select public.set_mfa_group_requirement('clinician', null, true, 'too short', true)$q$));
select pg_temp.rec('2 switch', 'unenrolled members need confirmation', 'ERR:P0001', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'aal1',
  $q$select public.set_mfa_group_requirement('clinician', null, true, 'Doctors must use 2FA from today on', false)$q$));
select pg_temp.rec('2 switch', 'confirmed: version 2', '2', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'aal1',
  $q$select public.set_mfa_group_requirement('clinician', null, true, 'Doctors must use 2FA from today on', true)$q$));
select pg_temp.rec('2 switch', 'one history row with note and author', '1',
  (select count(*)::text from public.mfa_group_requirement_changes
    where role = 'clinician' and doctor_tier is null and required and version = 2 and changed_by = pg_temp.f('admin')
      and change_note = 'Doctors must use 2FA from today on'));
select pg_temp.rec('2 switch', 'same value again is a no-op (still version 2)', '2', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'aal1',
  $q$select public.set_mfa_group_requirement('clinician', null, true, 'Doctors must use 2FA from today on', true)$q$));
select pg_temp.rec('2 switch', 'admin cannot UPDATE the table directly', 'ERR:42501', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'aal2',
  $q$update public.mfa_group_requirements set required = false where role = 'clinician' returning 1$q$));

-- ---------------------------------------------------------------------------
-- 3. Enforcement with the clinician group on.
-- ---------------------------------------------------------------------------
select pg_temp.rec('3 enforce', 'AAL1 doctor reads ZERO staff-only rows', '0',
  pg_temp.as_val(pg_temp.f('smo'), 'authenticated', 'aal1', format('select count(*) from public.clinical_incident_reports where id = %L', pg_temp.f('inc'))));
select pg_temp.rec('3 enforce', 'AAL1 doctor is_org_staff false', 'false',
  pg_temp.as_val(pg_temp.f('smo'), 'authenticated', 'aal1', format('select private.is_org_staff(%L)', pg_temp.f('org'))));
select pg_temp.rec('3 enforce', 'AAL1 doctor staff_may_read false', 'false',
  pg_temp.as_val(pg_temp.f('smo'), 'authenticated', 'aal1',
    format('select coalesce(private.staff_may_read(%L, %L, %L), false)', pg_temp.f('pat'), pg_temp.f('org'), 'vitals_readings')));
select pg_temp.rec('3 enforce', 'AAL1 CMO break-glass grant unusable', 'false',
  pg_temp.as_val(pg_temp.f('cmo'), 'authenticated', 'aal1', format('select private.has_emergency_access(%L, null)', pg_temp.f('pat'))));
select pg_temp.rec('3 enforce', 'AAL1 doctor task_is_mine false', 'false',
  pg_temp.as_val(pg_temp.f('smo'), 'authenticated', 'aal1', format($q$select private.task_is_mine(null, %L, null, 'claimed')$q$, pg_temp.f('smo'))));
select pg_temp.rec('3 enforce', 'AAL2 doctor task_is_mine true', 'true',
  pg_temp.as_val(pg_temp.f('smo'), 'authenticated', 'aal2', format($q$select private.task_is_mine(null, %L, null, 'claimed')$q$, pg_temp.f('smo'))));
select pg_temp.rec('3 enforce', 'AAL2 doctor reads the row', '1',
  pg_temp.as_val(pg_temp.f('smo'), 'authenticated', 'aal2', format('select count(*) from public.clinical_incident_reports where id = %L', pg_temp.f('inc'))));
select pg_temp.rec('3 enforce', 'AAL1 coordinator (other group) unaffected', '1',
  pg_temp.as_val(pg_temp.f('coord'), 'authenticated', 'aal1', format('select count(*) from public.clinical_incident_reports where id = %L', pg_temp.f('inc'))));
select pg_temp.rec('3 enforce', 'my_mfa_requirement: doctor required', 'true',
  pg_temp.as_val(pg_temp.f('cmo'), 'authenticated', 'aal1', 'select required from public.my_mfa_requirement()'));
select pg_temp.rec('3 enforce', 'my_mfa_requirement: unverified factor is no factor', 'false',
  pg_temp.as_val(pg_temp.f('cmo'), 'authenticated', 'aal1', 'select has_verified_factor from public.my_mfa_requirement()'));
select pg_temp.rec('3 enforce', 'my_mfa_requirement: coordinator not required', 'false',
  pg_temp.as_val(pg_temp.f('coord'), 'authenticated', 'aal1', 'select required from public.my_mfa_requirement()'));
select pg_temp.rec('3 enforce', 'AAL1 admin (not in group) still is_admin', 'true',
  pg_temp.as_val(pg_temp.f('admin2'), 'authenticated', 'aal1', 'select private.is_admin()'));
select pg_temp.rec('3 enforce', 'turning OFF needs no confirmation', '3', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'aal1',
  $q$select public.set_mfa_group_requirement('clinician', null, false, 'Rolled back, too many doctors without phones', false)$q$));
select pg_temp.rec('3 enforce', 'off again: AAL1 doctor reads the row', '1',
  pg_temp.as_val(pg_temp.f('smo'), 'authenticated', 'aal1', format('select count(*) from public.clinical_incident_reports where id = %L', pg_temp.f('inc'))));

-- ---------------------------------------------------------------------------
-- 4. Tier group.
-- ---------------------------------------------------------------------------
select pg_temp.rec('4 tier', 'CMO tier on', '2', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'aal1',
  $q$select public.set_mfa_group_requirement('clinician', 'chief_medical_officer', true, 'The CMO account must use 2FA now', true)$q$));
select pg_temp.rec('4 tier', 'AAL1 CMO held', 'false',
  pg_temp.as_val(pg_temp.f('cmo'), 'authenticated', 'aal1', format('select private.is_org_staff(%L)', pg_temp.f('org'))));
select pg_temp.rec('4 tier', 'AAL1 senior medical officer not held', 'true',
  pg_temp.as_val(pg_temp.f('smo'), 'authenticated', 'aal1', format('select private.is_org_staff(%L)', pg_temp.f('org'))));

-- ---------------------------------------------------------------------------
-- 5. Lock-out guards.
-- ---------------------------------------------------------------------------
select pg_temp.rec('5 lockout', 'AAL1 admin cannot switch on the admin group', 'ERR:42501', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'aal1',
  $q$select public.set_mfa_group_requirement('admin', null, true, 'Admins must use 2FA from today on', true)$q$));
select pg_temp.rec('5 lockout', 'AAL2 admin can', '2', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'aal2',
  $q$select public.set_mfa_group_requirement('admin', null, true, 'Admins must use 2FA from today on', true)$q$));
select pg_temp.rec('5 lockout', 'AAL1 admin no longer is_admin', 'false',
  pg_temp.as_val(pg_temp.f('admin2'), 'authenticated', 'aal1', 'select private.is_admin()'));
select pg_temp.rec('5 lockout', 'AAL1 admin has no delegated capability either', 'false',
  pg_temp.as_val(pg_temp.f('admin2'), 'authenticated', 'aal1', $q$select private.has_permission('anything.at_all')$q$));
select pg_temp.rec('5 lockout', 'AAL2 admin still is_admin', 'true',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'aal2', 'select private.is_admin()'));

-- ---------------------------------------------------------------------------
-- 6. The admin page function.
-- ---------------------------------------------------------------------------
select pg_temp.rec('6 page', 'CMO tier row counts the unenrolled CMO', 'true', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'aal2',
  $q$select (member_count >= 1 and unenrolled_cmo_count >= 1)::text from public.admin_mfa_group_requirements()
      where role = 'clinician' and doctor_tier = 'chief_medical_officer'$q$));
select pg_temp.rec('6 page', 'senior tier row counts the enrolled doctor', 'true', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'aal2',
  $q$select (enrolled_count >= 1)::text from public.admin_mfa_group_requirements()
      where role = 'clinician' and doctor_tier = 'senior_medical_officer'$q$));
select pg_temp.rec('6 page', 'non-admin sees nothing', '0', pg_temp.as_val(pg_temp.f('smo'), 'authenticated', 'aal2',
  'select count(*) from public.admin_mfa_group_requirements()'));

-- Back to all-off for the sabotage phase.
update public.mfa_group_requirements set required = false;

-- ---------------------------------------------------------------------------
-- 7. Sabotage.
-- ---------------------------------------------------------------------------
update public.mfa_group_requirements set required = true where role = 'clinician' and doctor_tier is null;

-- (a) the database layer switched off.
alter function private.mfa_requirement_met() rename to mfa_requirement_met_real;
create function private.mfa_requirement_met() returns boolean language sql stable as $$ select true $$;
select pg_temp.rec('7 sabotage', '(a) caught: AAL1 doctor reads the row', '1',
  pg_temp.as_val(pg_temp.f('smo'), 'authenticated', 'aal1', format('select count(*) from public.clinical_incident_reports where id = %L', pg_temp.f('inc'))));
drop function private.mfa_requirement_met();
alter function private.mfa_requirement_met_real() rename to mfa_requirement_met;
select pg_temp.rec('7 sabotage', '(a) restored: AAL1 doctor reads nothing', '0',
  pg_temp.as_val(pg_temp.f('smo'), 'authenticated', 'aal1', format('select count(*) from public.clinical_incident_reports where id = %L', pg_temp.f('inc'))));
update public.mfa_group_requirements set required = false;

-- (b) and (c): patched copies of the switch, from its live body.
do $$
declare v_def text := pg_get_functiondef('public.set_mfa_group_requirement(public.user_role, public.doctor_tier, boolean, text, boolean)'::regprocedure);
declare v_b text; v_c text;
begin
  v_b := replace(v_def, 'if v_caller_in_group and coalesce', 'if false and v_caller_in_group and coalesce');
  v_c := replace(v_def, 'if v_unenrolled > 0 and not coalesce', 'if false and v_unenrolled > 0 and not coalesce');
  if v_b = v_def or v_c = v_def then raise exception 'sabotage patch did not apply'; end if;
  execute v_b;
  perform pg_temp.rec('7 sabotage', '(b) caught: AAL1 admin switches on the admin group', 'true', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'aal1',
    $q$select (public.set_mfa_group_requirement('admin', null, true, 'Admins must use 2FA from today on', true) > 1)::text$q$));
  update public.mfa_group_requirements set required = false;
  execute v_c;
  perform pg_temp.rec('7 sabotage', '(c) caught: switched on without confirmation', 'true', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'aal1',
    $q$select (public.set_mfa_group_requirement('care_coordinator', null, true, 'Coordinators must use 2FA from today', false) > 1)::text$q$));
  update public.mfa_group_requirements set required = false;
  execute v_def;
end $$;
select pg_temp.rec('7 sabotage', '(b)/(c) restored: refused again', 'ERR:42501', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'aal1',
  $q$select public.set_mfa_group_requirement('admin', null, true, 'Admins must use 2FA from today on', true)$q$));

-- (d) tier ignored.
update public.mfa_group_requirements set required = true where role = 'clinician' and doctor_tier = 'chief_medical_officer';
do $$
declare v_def text := pg_get_functiondef('private.mfa_required_for(uuid)'::regprocedure);
declare v_d text;
begin
  v_d := replace(v_def, 'r.doctor_tier is null' || chr(10), 'true' || chr(10));
  if v_d = v_def then raise exception 'sabotage (d) patch did not apply'; end if;
  execute v_d;
  perform pg_temp.rec('7 sabotage', '(d) caught: senior medical officer held by the CMO tier', 'false',
    pg_temp.as_val(pg_temp.f('smo'), 'authenticated', 'aal1', format('select private.is_org_staff(%L)', pg_temp.f('org'))));
  execute v_def;
end $$;
select pg_temp.rec('7 sabotage', '(d) restored: senior medical officer not held', 'true',
  pg_temp.as_val(pg_temp.f('smo'), 'authenticated', 'aal1', format('select private.is_org_staff(%L)', pg_temp.f('org'))));

-- ---------------------------------------------------------------------------
-- Verdict. A sabotage row passes when it shows the hole the guard closes (the check flipped).
-- ---------------------------------------------------------------------------
select phase, check_name, expected, actual,
       case when actual is not distinct from expected then 'PASS' else 'FAIL' end as verdict
  from results order by phase, check_name;

do $$
declare v_fail int;
begin
  select count(*) into v_fail from results where actual is distinct from expected;
  if v_fail > 0 then
    raise exception 'mfa_group_requirements proof: % check(s) FAILED', v_fail;
  end if;
end $$;

rollback;
