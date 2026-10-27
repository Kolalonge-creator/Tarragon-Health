-- W-02 proof: override reason codes, task reasons, case brief feedback (migration *_w02_override_reason_codes_and_brief_feedback.sql).
-- NOT EXECUTED LOCALLY when written (Docker was down); the CI replay is its first run.
--   1. A clinician records a coded reason only on a task they hold, once; others, patients, anon and unknown codes refused; append-only.
--   2. Brief feedback: valid values only, once per clinician per brief; own read plus CMO read; counts are CMO only with no clinician column.
--   3. clinician_alerts.override_reason_code exists and is nullable.
--   4. SABOTAGE: the claimed_by check and the CMO check removed; both checks must flip.
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
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'w02-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'W02 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'W02 ' || p_label, 'MDCN', 'W01-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true);
  return v;
end $f$;

-- 0. Fixtures ----------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_doc uuid; v_other uuid; v_cmo uuid; v_pat uuid; v_task uuid; v_brief uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_doc := pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', v_admin);
  v_other := pg_temp.mkdoc(v_org, 'other', 'senior_medical_officer', v_admin);
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin);
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('other', v_other); perform pg_temp.setf('cmo', v_cmo); perform pg_temp.setf('pat', v_pat);
  set local session_replication_role = replica;
  insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at, state,
      claimed_by, claimed_at, claim_expires_at, is_test)
  select v_org, tt.code, tt.version, 5, 5, v_pat, 'senior_medical_officer', now() + interval '1 day', 'claimed', v_doc, now(), now() + interval '1 hour', true
    from public.task_types tt order by tt.code limit 1 returning id into v_task;
  insert into public.case_briefs (organisation_id, clinician_alert_id, patient_id, status, model_id, input_snapshot)
  values (v_org, gen_random_uuid(), v_pat, 'generated', 'w02-proof', '{}'::jsonb) returning id into v_brief;
  set local session_replication_role = origin;
  perform pg_temp.setf('task', v_task); perform pg_temp.setf('brief', v_brief);
end $$;

-- 1. Task reasons ------------------------------------------------------------------------------------------------------
do $$
declare r text;
begin
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_task_override_reason(%L, 'context_known')::text$q$, pg_temp.f('task')));
  insert into results values ('real', 'the clinician who holds the task records a reason', 'true', (r !~ '^ERR')::text);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_task_override_reason(%L, 'other')::text$q$, pg_temp.f('task')));
  insert into results values ('real', 'a second reason for the same task is refused', 'ERR:23505', r);
  r := pg_temp.q_as(pg_temp.f('other'), format($q$select public.record_task_override_reason(%L, 'other')::text$q$, pg_temp.f('task')));
  insert into results values ('real', 'a clinician who does not hold the task is refused', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('pat'), format($q$select public.record_task_override_reason(%L, 'other')::text$q$, pg_temp.f('task')));
  insert into results values ('real', 'a patient is refused', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_task_override_reason(%L, 'not_a_code')::text$q$, pg_temp.f('task')));
  insert into results values ('real', 'a code outside the list is refused', 'ERR:22P02', r);
  r := pg_temp.try_anon(format($q$select public.record_task_override_reason(%L, 'other')$q$, pg_temp.f('task')));
  insert into results values ('real', 'anon is refused', '42501', r);
  r := pg_temp.q_as(pg_temp.f('other'), 'select count(*)::text from public.clinical_task_override_reasons');
  insert into results values ('real', 'another clinician reads none', '0', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select count(*)::text from public.clinical_task_override_reasons');
  insert into results values ('real', 'the CMO reads the row', '1', r);
  begin
    update public.clinical_task_override_reasons set code = 'other';
    insert into results values ('real', 'update is refused even for the owner role', 'raised', 'no error');
  exception when others then
    insert into results values ('real', 'update is refused even for the owner role', 'raised', 'raised');
  end;
end $$;

-- 2. Brief feedback ----------------------------------------------------------------------------------------------------
do $$
declare r text;
begin
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_case_brief_feedback(%L, 'unsafe')::text$q$, pg_temp.f('brief')));
  insert into results values ('real', 'a clinician records brief feedback', 'true', (r !~ '^ERR')::text);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_case_brief_feedback(%L, 'useful')::text$q$, pg_temp.f('brief')));
  insert into results values ('real', 'one feedback per clinician per brief', 'ERR:23505', r);
  r := pg_temp.q_as(pg_temp.f('other'), format($q$select public.record_case_brief_feedback(%L, 'great')::text$q$, pg_temp.f('brief')));
  insert into results values ('real', 'a feedback value outside the list is refused', 'ERR:22023', r);
  r := pg_temp.q_as(pg_temp.f('pat'), format($q$select public.record_case_brief_feedback(%L, 'useful')::text$q$, pg_temp.f('brief')));
  insert into results values ('real', 'a patient is refused', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('other'), 'select count(*)::text from public.case_brief_feedback');
  insert into results values ('real', 'another clinician reads none', '0', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select count(*)::text from public.case_brief_feedback');
  insert into results values ('real', 'the CMO reads the row', '1', r);
  r := pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.case_brief_feedback_counts()');
  insert into results values ('real', 'a doctor who is not the CMO cannot read the counts', 'ERR:42501', r);
  set local session_replication_role = replica;
  update public.case_brief_feedback set is_test = false;
  set local session_replication_role = origin;
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select string_agg(feedback || '':'' || responses, '','') from public.case_brief_feedback_counts()');
  insert into results values ('real', 'the CMO reads counts without any clinician identity', 'unsafe:1', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select count(*)::text from information_schema.parameters p where p.specific_name like ''case_brief_feedback_counts%'' and p.parameter_name ilike ''%clinician%''');
  insert into results values ('real', 'the counts function has no clinician column', '0', r);
end $$;

-- 3. The column --------------------------------------------------------------------------------------------------------
do $$
begin
  insert into results values ('real', 'clinician_alerts.override_reason_code exists and is nullable', 'YES',
    (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'clinician_alerts' and column_name = 'override_reason_code'));
end $$;

-- 4. SABOTAGE ----------------------------------------------------------------------------------------------------------
do $$
declare v_orig text; v_def text; r text; v_task2 uuid;
begin
  v_orig := pg_get_functiondef('public.record_task_override_reason(uuid,public.override_reason_code)'::regprocedure);
  v_def := replace(v_orig, 'if t.id is null or t.claimed_by is distinct from v_uid then', 'if t.id is null then');
  if v_def = v_orig then raise exception 'SABOTAGE 1 not applied'; end if;
  execute v_def;
  set local session_replication_role = replica;
  insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at, state,
      claimed_by, claimed_at, claim_expires_at, is_test)
  select pg_temp.f('org'), tt.code, tt.version, 5, 5, pg_temp.f('pat'), 'senior_medical_officer', now() + interval '1 day', 'claimed', pg_temp.f('doc'), now(), now() + interval '1 hour', true
    from public.task_types tt order by tt.code limit 1 returning id into v_task2;
  set local session_replication_role = origin;
  r := pg_temp.q_as(pg_temp.f('other'), format($q$select public.record_task_override_reason(%L, 'other')::text$q$, v_task2));
  insert into results values ('sabotaged', 'a clinician who does not hold the task is refused', 'ERR:42501', case when r like 'ERR:%' then r else 'ERR:none' end);

  v_orig := pg_get_functiondef('public.case_brief_feedback_counts()'::regprocedure);
  v_def := replace(v_orig, 'if not private.credential_is_cmo() then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE 2 not applied'; end if;
  execute v_def;
  r := pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.case_brief_feedback_counts()');
  insert into results values ('sabotaged', 'a doctor who is not the CMO cannot read the counts', 'ERR:42501', case when r like 'ERR:%' then r else 'ERR:none' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'W02 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks (%)', v_caught,
      (select string_agg(check_name || ' => ' || actual, '; ') from results where phase = 'sabotaged');
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
