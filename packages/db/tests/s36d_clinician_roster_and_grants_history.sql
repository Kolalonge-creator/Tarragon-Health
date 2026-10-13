-- S36d proof: clinician roster (ops view and request, suspend with a reason, CMO-only decisions) and the role-grants history.
--   * ops (clinical_staff.manage) reads the roster, suspends with an audited reason, and can only REQUEST a reinstatement or competency grant;
--     it cannot reinstate or grant directly and cannot decide a request. Only the active CMO decides, and not their own request.
--   * a plain clinician and a patient read neither the roster nor the grants history; a users.permissions.grant holder and an admin read the history;
--     an ops holder without users.permissions.grant cannot. No client write to the requests table.
--   SABOTAGE 1: the history gate opened (the patient denial must flip).  SABOTAGE 2: the CMO check removed from decide (ops refusal must flip).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's36d-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'S36d ' || p_label, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
create function pg_temp.sql_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into v; exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return coalesce(v, 'ok');
end $f$;
create function pg_temp.ok_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  v := pg_temp.sql_as(p_uid, p_sql);
  return case when v like 'ERR:%' then v else 'ok' end;
end $f$;
create function pg_temp.chk(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$f$ insert into results values (p_phase, p_name, p_expected, p_actual) $f$;

do $$
declare v_org uuid; v_admin uuid; v_ops uuid; v_cmo uuid; v_doc uuid; v_pat uuid; v_grantor uuid; v_tprof uuid;
        v_cmo_staff uuid; v_staff uuid; v_r1 uuid; v_r2 uuid; v_r3 uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_ops := pg_temp.mkuser(v_org, 'ops', 'finance');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  v_grantor := pg_temp.mkuser(v_org, 'grantor', 'finance');
  v_tprof := pg_temp.mkuser(v_org, 'target', 'clinician');
  insert into public.user_permission_grants (profile_id, permission_key, granted_by) values
    (v_ops, 'clinical_staff.manage', v_admin), (v_grantor, 'users.permissions.grant', v_admin);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_cmo, 'S36d CMO', 'MDCN', 'S36D-CMO-1', true, 'active', now(), v_admin, 'chief_medical_officer', 'contracted', 2, true, v_admin, true)
    returning id into v_cmo_staff;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
    values (v_org, v_tprof, 'S36d Target', 'MDCN', 'S36D-T-1', true, 'active', now(), v_admin, 'senior_medical_officer', 'employed', 2, true)
    returning id into v_staff;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
    values (v_org, v_doc, 'S36d Plain', 'MDCN', 'S36D-D-1', true, 'active', now(), v_admin, 'senior_medical_officer', 'employed', 2, true);
  perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('ops', v_ops); perform pg_temp.setf('cmo', v_cmo); perform pg_temp.setf('doc', v_doc);
  perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('grantor', v_grantor); perform pg_temp.setf('staff', v_staff);

  perform pg_temp.chk('real', 'ops reads the roster and sees the clinician', 'true',
    pg_temp.sql_as(v_ops, format($q$select (public.clinician_roster() @> jsonb_build_array(jsonb_build_object('id', %L)))::text$q$, v_staff)));
  perform pg_temp.chk('real', 'the CMO reads the roster', 'true',
    pg_temp.sql_as(v_cmo, $q$select (jsonb_array_length(public.clinician_roster()) >= 2)::text$q$));
  perform pg_temp.chk('real', 'a plain clinician cannot read the roster', 'ERR:42501', pg_temp.sql_as(v_doc, 'select public.clinician_roster()::text'));
  perform pg_temp.chk('real', 'a patient cannot read the roster', 'ERR:42501', pg_temp.sql_as(v_pat, 'select public.clinician_roster()::text'));
  perform pg_temp.chk('real', 'the roster carries no phone or email', 'false',
    pg_temp.sql_as(v_ops, $q$select (public.clinician_roster()::text ~ '(phone|email)')::text$q$));

  perform pg_temp.chk('real', 'no client write to the requests table', 'ERR:42501',
    pg_temp.sql_as(v_ops, format($q$insert into public.clinician_change_requests (organisation_id, clinical_staff_id, kind, reason, requested_by)
      values (%L, %L, 'reinstatement', 'a long enough reason', %L)$q$, v_org, v_staff, v_ops)));

  perform pg_temp.chk('real', 'a short reason is refused', 'ERR:23514', pg_temp.sql_as(v_ops, format($q$select public.ops_suspend_clinician(%L, 'short')::text$q$, v_staff)));
  perform pg_temp.chk('real', 'a plain clinician cannot suspend', 'ERR:42501', pg_temp.sql_as(v_doc, format($q$select public.ops_suspend_clinician(%L, 'a long enough reason')::text$q$, v_staff)));
  perform pg_temp.chk('real', 'ops suspends with a reason', 'ok', pg_temp.ok_as(v_ops, format($q$select public.ops_suspend_clinician(%L, 'documents flagged by operations')::text$q$, v_staff)));
  perform pg_temp.chk('real', 'the clinician is suspended', 'suspended,false', (select status::text || ',' || active::text from public.clinical_staff where id = v_staff));
  perform pg_temp.chk('real', 'the suspension is audited with the actor', 'true',
    ((select count(*) from public.audit_log where action = 'clinical_staff.suspended' and entity_id = v_staff and actor_id = v_ops) = 1)::text);
  perform pg_temp.chk('real', 'a second suspend is refused', 'ERR:23514', pg_temp.sql_as(v_ops, format($q$select public.ops_suspend_clinician(%L, 'documents flagged by operations')::text$q$, v_staff)));

  perform pg_temp.chk('real', 'ops cannot reinstate directly', 'ERR:42501', pg_temp.sql_as(v_ops, format($q$select public.reinstate_clinician(%L, 'ops tries to reinstate')::text$q$, v_staff)));
  perform pg_temp.chk('real', 'ops cannot grant a competency directly', 'ERR:42501', pg_temp.sql_as(v_ops, format($q$select public.grant_clinician_competency(%L, 'hypertension')::text$q$, v_staff)));

  perform pg_temp.chk('real', 'ops asks for a reinstatement', 'ok', pg_temp.ok_as(v_ops, format($q$select public.request_clinician_change(%L, 'reinstatement', null, 'renewed documents were checked')::text$q$, v_staff)));
  select id into v_r1 from public.clinician_change_requests where clinical_staff_id = v_staff and kind = 'reinstatement' and state = 'pending';
  perform pg_temp.chk('real', 'the same request twice is refused', 'ERR:23505', pg_temp.sql_as(v_ops, format($q$select public.request_clinician_change(%L, 'reinstatement', null, 'renewed documents were checked')::text$q$, v_staff)));
  perform pg_temp.chk('real', 'ops asks for a competency', 'ok', pg_temp.ok_as(v_ops, format($q$select public.request_clinician_change(%L, 'competency_grant', 'hypertension', 'completed the pathway training')::text$q$, v_staff)));
  select id into v_r2 from public.clinician_change_requests where clinical_staff_id = v_staff and kind = 'competency_grant' and state = 'pending';
  perform pg_temp.chk('real', 'an unknown competency is refused', 'ERR:P0002', pg_temp.sql_as(v_ops, format($q$select public.request_clinician_change(%L, 'competency_grant', 'nope', 'completed the pathway training')::text$q$, v_staff)));
  perform pg_temp.chk('real', 'a plain clinician cannot request', 'ERR:42501', pg_temp.sql_as(v_doc, format($q$select public.request_clinician_change(%L, 'competency_grant', 'diabetes', 'completed the pathway training')::text$q$, v_staff)));

  perform pg_temp.chk('real', 'ops cannot decide', 'ERR:42501', pg_temp.sql_as(v_ops, format($q$select public.decide_clinician_change(%L, true, null)::text$q$, v_r1)));
  perform pg_temp.chk('real', 'an admin account cannot decide either (CMO only)', 'ERR:42501', pg_temp.sql_as(v_admin, format($q$select public.decide_clinician_change(%L, true, null)::text$q$, v_r1)));
  perform pg_temp.chk('real', 'the CMO approves the reinstatement', 'ok', pg_temp.ok_as(v_cmo, format($q$select public.decide_clinician_change(%L, true, null)::text$q$, v_r1)));
  perform pg_temp.chk('real', 'the clinician is active again', 'active,true', (select status::text || ',' || active::text from public.clinical_staff where id = v_staff));
  perform pg_temp.chk('real', 'a decided request cannot be decided again', 'ERR:23514', pg_temp.sql_as(v_cmo, format($q$select public.decide_clinician_change(%L, true, null)::text$q$, v_r1)));
  perform pg_temp.chk('real', 'declining needs a reason', 'ERR:23514', pg_temp.sql_as(v_cmo, format($q$select public.decide_clinician_change(%L, false, 'no')::text$q$, v_r2)));
  perform pg_temp.chk('real', 'the CMO approves the competency', 'ok', pg_temp.ok_as(v_cmo, format($q$select public.decide_clinician_change(%L, true, null)::text$q$, v_r2)));
  perform pg_temp.chk('real', 'the competency is now held', 'true',
    (exists (select 1 from public.clinician_competencies where clinical_staff_id = v_staff and competency_code = 'hypertension' and revoked_at is null))::text);
  perform pg_temp.chk('real', 'both decisions are audited', '2',
    (select count(*) from public.audit_log where action = 'clinician_change.approved' and entity_id = v_staff)::text);
  perform pg_temp.chk('real', 'the CMO can open a request', 'ok', pg_temp.ok_as(v_cmo, format($q$select public.request_clinician_change(%L, 'competency_grant', 'diabetes', 'completed the pathway training')::text$q$, v_staff)));
  select id into v_r3 from public.clinician_change_requests where clinical_staff_id = v_staff and competency_code = 'diabetes' and state = 'pending';
  perform pg_temp.chk('real', 'nobody decides their own request', 'ERR:42501', pg_temp.sql_as(v_cmo, format($q$select public.decide_clinician_change(%L, true, null)::text$q$, v_r3)));
  perform pg_temp.chk('real', 'a plain clinician reads no requests', '0', pg_temp.sql_as(v_doc, 'select count(*)::text from public.clinician_change_requests'));

  perform pg_temp.chk('real', 'ops (clinical_staff.manage only) cannot read the grants history', 'ERR:42501', pg_temp.sql_as(v_ops, 'select public.permission_grants_history()::text'));
  perform pg_temp.chk('real', 'a plain clinician cannot read it', 'ERR:42501', pg_temp.sql_as(v_doc, 'select public.permission_grants_history()::text'));
  perform pg_temp.chk('real', 'a patient cannot read it', 'ERR:42501', pg_temp.sql_as(v_pat, 'select public.permission_grants_history()::text'));
  perform pg_temp.chk('real', 'a users.permissions.grant holder reads it', 'true',
    pg_temp.sql_as(v_grantor, format($q$select (((public.permission_grants_history() -> 'current')::jsonb) @> jsonb_build_array(jsonb_build_object('permission_key', 'clinical_staff.manage', 'holder_id', %L)))::text$q$, v_ops)));
  perform pg_temp.chk('real', 'an admin reads it', 'true', pg_temp.sql_as(v_admin, $q$select (jsonb_array_length(public.permission_grants_history() -> 'history') >= 2)::text$q$));
  perform pg_temp.chk('real', 'every current grant carries an expiry field (null: grants do not expire)', 'true',
    pg_temp.sql_as(v_admin, $q$select (select bool_and(e ? 'expires_at') from jsonb_array_elements(public.permission_grants_history() -> 'current') e)::text$q$));
  update public.user_permission_grants set revoked_at = now(), revoked_by = v_admin where profile_id = v_ops and permission_key = 'clinical_staff.manage';
  perform pg_temp.chk('real', 'a revoked grant leaves the current list and stays in the history', 'false,true',
    pg_temp.sql_as(v_admin, format($q$select (((public.permission_grants_history() -> 'current')::jsonb) @> jsonb_build_array(jsonb_build_object('permission_key', 'clinical_staff.manage', 'holder_id', %L)))::text
        || ',' || (((public.permission_grants_history() -> 'history')::jsonb) @> jsonb_build_array(jsonb_build_object('permission_key', 'clinical_staff.manage', 'holder_id', %L)))::text$q$, v_ops, v_ops)));
  perform pg_temp.chk('real', 'revoked ops loses the roster', 'ERR:42501', pg_temp.sql_as(v_ops, 'select public.clinician_roster()::text'));
end $$;

do $$
declare v_orig text; v_def text;
begin
  v_orig := pg_get_functiondef('public.permission_grants_history(integer)'::regprocedure);
  v_def := replace(v_orig, 'if not (private.is_admin() or private.has_permission(''users.permissions.grant'')) then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE 1 not applied'; end if;
  execute v_def;
  perform pg_temp.chk('sabotaged', 'a patient cannot read it', 'ERR:42501', pg_temp.sql_as(pg_temp.f('pat'), 'select public.permission_grants_history()::text'));
  execute v_orig;
end $$;
do $$
declare v_orig text; v_def text; v_staff uuid := pg_temp.f('staff'); v_id uuid;
begin
  update public.user_permission_grants set revoked_at = null, revoked_by = null where profile_id = pg_temp.f('ops') and permission_key = 'clinical_staff.manage';
  insert into public.clinician_change_requests (organisation_id, clinical_staff_id, kind, competency_code, reason, requested_by, is_test)
    select organisation_id, id, 'competency_grant', 'result_review', 'sabotage fixture request', pg_temp.f('admin'), true from public.clinical_staff where id = v_staff returning id into v_id;
  v_orig := pg_get_functiondef('public.decide_clinician_change(uuid, boolean, text)'::regprocedure);
  v_def := replace(v_orig, 'if not private.credential_is_cmo() then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE 2 not applied'; end if;
  execute v_def;
  perform pg_temp.chk('sabotaged', 'ops cannot decide', 'ERR:42501', pg_temp.sql_as(pg_temp.f('ops'), format($q$select public.decide_clinician_change(%L, false, 'sabotage decline reason')::text$q$, v_id)));
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S36d proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotages flipped a check', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
