-- Sole-CMO on-call exception proof (migration *_sole_cmo_on_call_exception.sql). One rolled-back transaction, own org and own is_test fixtures.
--   * self grant of any competency is refused without an exception (the existing rule is unchanged);
--   * signing: only the CMO, only competency on_call, reason at least 40 characters, only while the organisation has exactly one active CMO;
--   * with an exception: the CMO grants THEMSELVES on_call (audited under clinician_competency.self_granted_under_exception with the exception id,
--     reviewers notified); any other competency is still refused; granting another clinician on_call is the unchanged normal path;
--   * the exception stops working when it expires, when it is revoked, and the moment a second active CMO exists (and resumes if that ends);
--   * no direct client write to the table, read only for admin and CMO of the organisation, anon cannot execute.
--   SABOTAGE 1: the sole-CMO condition removed (second-CMO refusal must flip).  SABOTAGE 2: the expiry check removed (expired refusal must flip).
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
  values (v, 'scmo-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'SCMO ' || p_label, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, organisation_id = excluded.organisation_id;
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
create function pg_temp.anon_sql(p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql into v; exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return coalesce(v, 'ok');
end $f$;
create function pg_temp.chk(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$f$ insert into results values (p_phase, p_name, p_expected, p_actual) $f$;
create function pg_temp.audits(p_action text, p_entity uuid) returns integer language sql as
$f$ select count(*)::int from public.audit_log where action = p_action and entity_id = p_entity $f$;

do $$
declare v_org uuid; v_admin uuid; v_cmo uuid; v_doc uuid; v_cmo2 uuid; v_cmo_staff uuid; v_doc_staff uuid; v_other text;
begin
  insert into public.organisations (name, type) select 'SCMO proof org', type from public.organisations limit 1 returning id into v_org;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician');
  v_cmo2 := pg_temp.mkuser(v_org, 'cmo2', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_cmo, 'SCMO CMO', 'MDCN', 'SCMO-CMO-1', true, 'active', now(), v_admin, 'chief_medical_officer', 'contracted', 2, true, v_admin, true)
    returning id into v_cmo_staff;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
    values (v_org, v_doc, 'SCMO Doc', 'MDCN', 'SCMO-D-1', true, 'active', now(), v_admin, 'senior_medical_officer', 'employed', 2, true)
    returning id into v_doc_staff;
  select code into v_other from public.competencies where is_active and code <> 'on_call' and requires_level <= 2 order by code limit 1;
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('cmo', v_cmo); perform pg_temp.setf('doc', v_doc);
  perform pg_temp.setf('cmo2', v_cmo2); perform pg_temp.setf('cmo_staff', v_cmo_staff); perform pg_temp.setf('doc_staff', v_doc_staff);
  create temp table if not exists meta(k text primary key, v text) on commit drop;
  grant all on meta to public;
  insert into meta values ('other', v_other);

  -- before any exception
  perform pg_temp.chk('real', 'self grant of on_call refused without an exception', 'ERR:42501', pg_temp.sql_as(v_cmo, format($q$select public.grant_clinician_competency(%L, 'on_call')::text$q$, v_cmo_staff)));
  perform pg_temp.chk('real', 'a plain clinician cannot sign', 'ERR:42501', pg_temp.sql_as(v_doc, $q$select public.sign_sole_cmo_exception('on_call', repeat('x', 50))::text$q$));
  perform pg_temp.chk('real', 'an admin cannot sign', 'ERR:42501', pg_temp.sql_as(v_admin, $q$select public.sign_sole_cmo_exception('on_call', repeat('x', 50))::text$q$));
  perform pg_temp.chk('real', 'anon cannot execute sign', 'ERR:42501', pg_temp.anon_sql($q$select public.sign_sole_cmo_exception('on_call', repeat('x', 50))::text$q$));
  perform pg_temp.chk('real', 'anon has no execute on sign or revoke', 'false,false',
    has_function_privilege('anon', 'public.sign_sole_cmo_exception(text,text)', 'EXECUTE')::text || ',' || has_function_privilege('anon', 'public.revoke_sole_cmo_exception(uuid,text)', 'EXECUTE')::text);
  perform pg_temp.chk('real', 'a short reason is refused', 'ERR:23514', pg_temp.sql_as(v_cmo, $q$select public.sign_sole_cmo_exception('on_call', '   too short   ')::text$q$));
  perform pg_temp.chk('real', 'another competency is refused', 'ERR:22023', pg_temp.sql_as(v_cmo, format($q$select public.sign_sole_cmo_exception(%L, repeat('x', 50))::text$q$, v_other)));
  perform pg_temp.chk('real', 'no row was created by any refusal', '0', (select count(*)::text from public.sole_cmo_exceptions where organisation_id = v_org));
end $$;

do $$
declare v_org uuid := pg_temp.f('org'); v_cmo uuid := pg_temp.f('cmo'); v_doc uuid := pg_temp.f('doc'); v_admin uuid := pg_temp.f('admin');
        v_cs uuid := pg_temp.f('cmo_staff'); v_ds uuid := pg_temp.f('doc_staff'); v_other text := (select v from meta where k = 'other'); v_ex uuid;
begin
  perform pg_temp.chk('real', 'the sole CMO signs', 'ok', pg_temp.ok_as(v_cmo, $q$select public.sign_sole_cmo_exception('on_call', 'Only one chief medical officer exists, so the on-call rota needs the CMO on it.')::text$q$));
  select id into v_ex from public.sole_cmo_exceptions where organisation_id = v_org;
  perform pg_temp.setf('ex', v_ex);
  perform pg_temp.chk('real', 'the exception expires about 12 months out', 'true', (select (expires_at > now() + interval '364 days' and expires_at < now() + interval '367 days')::text from public.sole_cmo_exceptions where id = v_ex));
  perform pg_temp.chk('real', 'signing is audited once', '1', pg_temp.audits('sole_cmo_exception.signed', v_ex)::text);
  perform pg_temp.chk('real', 'the admin gets one notice with no clinical content', '1',
    (select count(*)::text from public.notifications where recipient_id = v_admin and template = 'credential_notice' and payload->>'kind' = 'sole_cmo_exception_signed' and channel = 'in_app' and content_class = 'non_clinical'));
  perform pg_temp.chk('real', 'a second signature while one is in force is refused', 'ERR:23514', pg_temp.sql_as(v_cmo, $q$select public.sign_sole_cmo_exception('on_call', repeat('x', 50))::text$q$));

  perform pg_temp.chk('real', 'self grant of ANOTHER competency still refused', 'ERR:42501', pg_temp.sql_as(v_cmo, format($q$select public.grant_clinician_competency(%L, %L)::text$q$, v_cs, v_other)));
  perform pg_temp.chk('real', 'a plain clinician still cannot grant (even themselves)', 'ERR:42501', pg_temp.sql_as(v_doc, format($q$select public.grant_clinician_competency(%L, 'on_call')::text$q$, v_ds)));
  perform pg_temp.chk('real', 'the CMO self-grants on_call under the exception', 'ok', pg_temp.ok_as(v_cmo, format($q$select public.grant_clinician_competency(%L, 'on_call')::text$q$, v_cs)));
  perform pg_temp.chk('real', 'the competency row exists', '1', (select count(*)::text from public.clinician_competencies where clinical_staff_id = v_cs and competency_code = 'on_call'));
  perform pg_temp.chk('real', 'self grant is audited under the exception action with the exception id', '1',
    (select count(*)::text from public.audit_log where action = 'clinician_competency.self_granted_under_exception' and entity_id = v_cs and event->>'exception_id' = v_ex::text));
  perform pg_temp.chk('real', 'self grant is NOT recorded as an ordinary grant', '0', pg_temp.audits('clinician_competency.granted', v_cs)::text);
  perform pg_temp.chk('real', 'reviewers are told about the self grant', '1',
    (select count(*)::text from public.notifications where recipient_id = v_admin and payload->>'kind' = 'sole_cmo_self_grant'));
  perform pg_temp.chk('real', 'granting ANOTHER clinician on_call is the unchanged path', 'ok', pg_temp.ok_as(v_cmo, format($q$select public.grant_clinician_competency(%L, 'on_call')::text$q$, v_ds)));
  perform pg_temp.chk('real', 'that grant is an ordinary audited grant', '1', pg_temp.audits('clinician_competency.granted', v_ds)::text);
end $$;

-- level check, done properly: lower the CMO level, expect 23514, restore
do $$
declare v_cmo uuid := pg_temp.f('cmo'); v_cs uuid := pg_temp.f('cmo_staff');
begin
  update public.clinical_staff set credentialing_level = 1 where id = v_cs;
  perform pg_temp.chk('real', 'the credentialing level still applies to a self grant', 'ERR:23514', pg_temp.sql_as(v_cmo, format($q$select public.grant_clinician_competency(%L, 'on_call')::text$q$, v_cs)));
  update public.clinical_staff set credentialing_level = 2 where id = v_cs;
end $$;

-- table access
do $$
declare v_org uuid := pg_temp.f('org'); v_cmo uuid := pg_temp.f('cmo'); v_doc uuid := pg_temp.f('doc'); v_admin uuid := pg_temp.f('admin'); v_ex uuid := pg_temp.f('ex');
begin
  perform pg_temp.chk('real', 'client insert refused', 'ERR:42501', pg_temp.sql_as(v_cmo, format($q$insert into public.sole_cmo_exceptions (organisation_id, competency_code, reason, signed_by, expires_at) values (%L, 'on_call', repeat('x', 50), %L, now() + interval '1 day')$q$, v_org, v_cmo)));
  perform pg_temp.chk('real', 'client update refused', 'ERR:42501', pg_temp.sql_as(v_cmo, format($q$update public.sole_cmo_exceptions set expires_at = now() + interval '5 years' where id = %L$q$, v_ex)));
  perform pg_temp.chk('real', 'client delete refused', 'ERR:42501', pg_temp.sql_as(v_cmo, format($q$delete from public.sole_cmo_exceptions where id = %L$q$, v_ex)));
  perform pg_temp.chk('real', 'the CMO reads it', '1', pg_temp.sql_as(v_cmo, 'select count(*)::text from public.sole_cmo_exceptions'));
  perform pg_temp.chk('real', 'the admin reads it', '1', pg_temp.sql_as(v_admin, 'select count(*)::text from public.sole_cmo_exceptions'));
  perform pg_temp.chk('real', 'a plain clinician reads nothing', '0', pg_temp.sql_as(v_doc, 'select count(*)::text from public.sole_cmo_exceptions'));
  perform pg_temp.chk('real', 'anon cannot read', 'ERR:42501', pg_temp.anon_sql('select count(*)::text from public.sole_cmo_exceptions'));
  perform pg_temp.chk('real', 'a short revoke reason is refused', 'ERR:23514', pg_temp.sql_as(v_admin, format($q$select public.revoke_sole_cmo_exception(%L, 'no')::text$q$, v_ex)));
  perform pg_temp.chk('real', 'a plain clinician cannot revoke', 'ERR:42501', pg_temp.sql_as(v_doc, format($q$select public.revoke_sole_cmo_exception(%L, 'not allowed to do this')::text$q$, v_ex)));
end $$;

-- a second active CMO ends it
do $$
declare v_org uuid := pg_temp.f('org'); v_cmo uuid := pg_temp.f('cmo'); v_cmo2 uuid := pg_temp.f('cmo2'); v_admin uuid := pg_temp.f('admin'); v_cs uuid := pg_temp.f('cmo_staff');
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_cmo2, 'SCMO CMO Two', 'MDCN', 'SCMO-CMO-2', true, 'active', now(), v_admin, 'chief_medical_officer', 'contracted', 2, true, v_admin, true);
  perform pg_temp.chk('real', 'with a second active CMO the self grant is refused', 'ERR:42501', pg_temp.sql_as(v_cmo, format($q$select public.grant_clinician_competency(%L, 'on_call')::text$q$, v_cs)));
end $$;

-- SABOTAGE 1: sole-CMO condition removed
do $$
declare v_orig text; v_def text;
begin
  v_orig := pg_get_functiondef('private.sole_cmo_exception_active(uuid,text,uuid)'::regprocedure);
  v_def := replace(v_orig, 'and private.sole_cmo_count(p_org, cs.is_test) = 1', '');
  if v_def = v_orig then raise exception 'SABOTAGE 1 not applied'; end if;
  execute v_def;
  perform pg_temp.chk('sabotaged', 'second CMO refusal', 'ERR:42501', pg_temp.sql_as(pg_temp.f('cmo'), format($q$select public.grant_clinician_competency(%L, 'on_call')::text$q$, pg_temp.f('cmo_staff'))));
  execute v_orig;
end $$;

do $$
declare v_org uuid := pg_temp.f('org'); v_cmo uuid := pg_temp.f('cmo'); v_cs uuid := pg_temp.f('cmo_staff'); v_ex uuid := pg_temp.f('ex');
begin
  perform pg_temp.chk('real', 'signing is refused while two CMOs are active', 'ERR:23514', pg_temp.sql_as(v_cmo, $q$select public.sign_sole_cmo_exception('on_call', repeat('x', 50))::text$q$));
  update public.clinical_staff set active = false where organisation_id = v_org and credential_number = 'SCMO-CMO-2';
  perform pg_temp.chk('real', 'the exception works again once the second CMO is gone', 'ok', pg_temp.ok_as(v_cmo, format($q$select public.grant_clinician_competency(%L, 'on_call')::text$q$, v_cs)));
  -- expiry
  update public.sole_cmo_exceptions set signed_at = now() - interval '2 days', expires_at = now() - interval '1 day' where id = v_ex;
  perform pg_temp.chk('real', 'an expired exception stops working', 'ERR:42501', pg_temp.sql_as(v_cmo, format($q$select public.grant_clinician_competency(%L, 'on_call')::text$q$, v_cs)));
end $$;

-- SABOTAGE 2: expiry check removed
do $$
declare v_orig text; v_def text;
begin
  v_orig := pg_get_functiondef('private.sole_cmo_exception_active(uuid,text,uuid)'::regprocedure);
  v_def := replace(v_orig, 'and e.expires_at > now()', '');
  if v_def = v_orig then raise exception 'SABOTAGE 2 not applied'; end if;
  execute v_def;
  perform pg_temp.chk('sabotaged', 'expired refusal', 'ERR:42501', pg_temp.sql_as(pg_temp.f('cmo'), format($q$select public.grant_clinician_competency(%L, 'on_call')::text$q$, pg_temp.f('cmo_staff'))));
  execute v_orig;
end $$;

do $$
declare v_org uuid := pg_temp.f('org'); v_cmo uuid := pg_temp.f('cmo'); v_admin uuid := pg_temp.f('admin'); v_cs uuid := pg_temp.f('cmo_staff'); v_ex uuid := pg_temp.f('ex'); v_new uuid;
begin
  -- an expired but unrevoked row does not block a fresh signature, and is closed by it
  perform pg_temp.chk('real', 'a fresh signature after expiry works', 'ok', pg_temp.ok_as(v_cmo, $q$select public.sign_sole_cmo_exception('on_call', 'Renewed: still only one chief medical officer in the organisation.')::text$q$));
  select id into v_new from public.sole_cmo_exceptions where organisation_id = v_org and revoked_at is null;
  perform pg_temp.chk('real', 'the expired row was closed, a new one is active', 'true', (v_new <> v_ex and (select revoked_at is not null from public.sole_cmo_exceptions where id = v_ex))::text);
  perform pg_temp.chk('real', 'the renewed exception grants again', 'ok', pg_temp.ok_as(v_cmo, format($q$select public.grant_clinician_competency(%L, 'on_call')::text$q$, v_cs)));
  -- revoke
  perform pg_temp.chk('real', 'the admin revokes with a reason', 'ok', pg_temp.ok_as(v_admin, format($q$select public.revoke_sole_cmo_exception(%L, 'revoked by the proof for testing')::text$q$, v_new)));
  perform pg_temp.chk('real', 'revocation is audited and notified', '1,1', pg_temp.audits('sole_cmo_exception.revoked', v_new)::text || ',' ||
    (select count(*)::text from public.notifications where recipient_id = v_admin and payload->>'kind' = 'sole_cmo_exception_revoked'));
  perform pg_temp.chk('real', 'a revoked exception stops working', 'ERR:42501', pg_temp.sql_as(v_cmo, format($q$select public.grant_clinician_competency(%L, 'on_call')::text$q$, v_cs)));
  perform pg_temp.chk('real', 'a second revoke is refused', 'ERR:23514', pg_temp.sql_as(v_cmo, format($q$select public.revoke_sole_cmo_exception(%L, 'revoking a second time')::text$q$, v_new)));
  perform pg_temp.chk('real', 'the CMO can sign again after a revocation', 'ok', pg_temp.ok_as(v_cmo, $q$select public.sign_sole_cmo_exception('on_call', 'Signed again after a revocation, still the only CMO here.')::text$q$));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'sole-CMO proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotages flipped a check', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results order by phase desc, check_name;
rollback;
