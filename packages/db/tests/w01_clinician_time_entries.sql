-- W-01 proof: clinician_time_entries, record_clinician_time, the consult trigger and member_month_minutes
-- (migration *_w01_clinician_time_entries.sql). NOT EXECUTED LOCALLY when written (Docker was down); the CI replay is its first run.
--   1. Time is recorded for own work only; patient, anon, other clinician, consult source, bad shape refused; append-only.
--   2. Own rows only; the CMO reads the organisation's rows.
--   3. The consult trigger writes one row from call_started_at/call_ended_at, once per note.
--   4. member_month_minutes: CMO/finance only; test rows and Free patients excluded; groups under 3 Members have no median; no clinician column.
--   5. SABOTAGE: the claimed_by check and the CMO check removed; both checks must flip.
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
  values (v, 'w01-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'W01 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
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
  values (p_org, v, 'W01 ' || p_label, 'MDCN', 'W01-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true);
  return v;
end $f$;

-- 0. Fixtures ----------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_doc uuid; v_other uuid; v_cmo uuid; v_p1 uuid; v_p2 uuid; v_p3 uuid; v_free uuid; v_test uuid; v_task uuid;
        v_thread uuid; v_i integer; v_pp uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_doc := pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', v_admin);
  v_other := pg_temp.mkdoc(v_org, 'other', 'senior_medical_officer', v_admin);
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin);
  v_free := pg_temp.mkuser(v_org, 'free', 'patient');
  v_test := pg_temp.mkuser(v_org, 'testpat', 'patient');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('other', v_other); perform pg_temp.setf('cmo', v_cmo);
  perform pg_temp.setf('free', v_free); perform pg_temp.setf('testpat', v_test);
  -- three plus Members (so the group clears the n>=3 floor) and one evergreen Member
  for v_i in 1..4 loop
    v_pp := pg_temp.mkuser(v_org, 'mem' || v_i, 'patient');
    perform pg_temp.setf('mem' || v_i, v_pp);
    insert into public.patient_memberships (organisation_id, patient_id, source, state, granted_by, grant_reason, tier, is_test)
    values (v_org, v_pp, 'granted', 'active', v_admin, 'W01 proof fixture membership', case when v_i = 4 then 'evergreen' else 'plus' end, true);
  end loop;
  -- a held task for the doctor, and a thread for message time
  set local session_replication_role = replica;
  insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at, state,
      claimed_by, claimed_at, claim_expires_at, is_test)
  select v_org, tt.code, tt.version, 5, 5, pg_temp.f('mem1'), 'senior_medical_officer', now() + interval '1 day', 'claimed', v_doc, now(), now() + interval '1 hour', true
    from public.task_types tt order by tt.code limit 1 returning id into v_task;
  insert into public.care_message_threads (organisation_id, patient_id, subject, category)
  values (v_org, pg_temp.f('mem1'), 'W01 proof', 'general') returning id into v_thread;
  set local session_replication_role = origin;
  perform pg_temp.setf('task', v_task); perform pg_temp.setf('thread', v_thread);
end $$;

-- 1. Writes ------------------------------------------------------------------------------------------------------------
do $$
declare r text; n0 integer;
begin
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_clinician_time('task', %L, %L, 300)::text$q$, pg_temp.f('task'), pg_temp.f('mem1')));
  insert into results values ('real', 'clinician records time on a task they hold', 'true', (r !~ '^ERR')::text);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_clinician_time('message', %L, %L, 120)::text$q$, pg_temp.f('thread'), pg_temp.f('mem1')));
  insert into results values ('real', 'clinician records message time', 'true', (r !~ '^ERR')::text);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_clinician_time('manual', null, %L, 600)::text$q$, pg_temp.f('mem2')));
  insert into results values ('real', 'clinician adds manual time', 'true', (r !~ '^ERR')::text);
  r := pg_temp.q_as(pg_temp.f('other'), format($q$select public.record_clinician_time('task', %L, %L, 300)::text$q$, pg_temp.f('task'), pg_temp.f('mem1')));
  insert into results values ('real', 'a clinician who does not hold the task is refused', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('mem1'), format($q$select public.record_clinician_time('manual', null, %L, 60)::text$q$, pg_temp.f('mem1')));
  insert into results values ('real', 'a patient is refused', 'ERR:42501', r);
  r := pg_temp.try_anon(format($q$select public.record_clinician_time('manual', null, %L, 60)$q$, pg_temp.f('mem1')));
  insert into results values ('real', 'anon is refused', '42501', r);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_clinician_time('consult', null, %L, 60)::text$q$, pg_temp.f('mem1')));
  insert into results values ('real', 'a client cannot write consult time', 'ERR:22023', r);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_clinician_time('manual', null, %L, 99999)::text$q$, pg_temp.f('mem1')));
  insert into results values ('real', 'an out-of-range duration is refused', 'ERR:22023', r);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$insert into public.clinician_time_entries (organisation_id, clinician_profile_id, source, seconds) values (%L, %L, 'manual', 5)$q$, pg_temp.f('org'), pg_temp.f('doc')));
  insert into results values ('real', 'direct insert is refused', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('doc'), 'update public.clinician_time_entries set seconds = 1');
  insert into results values ('real', 'update by a client is refused', 'ERR:42501', r);
  begin
    update public.clinician_time_entries set seconds = 1;
    insert into results values ('real', 'update is refused even for the owner role', 'raised', 'no error');
  exception when others then
    insert into results values ('real', 'update is refused even for the owner role', 'raised', 'raised');
  end;
  begin
    delete from public.clinician_time_entries;
    insert into results values ('real', 'delete is refused even for the owner role', 'raised', 'no error');
  exception when others then
    insert into results values ('real', 'delete is refused even for the owner role', 'raised', 'raised');
  end;
end $$;

-- 2. Reads -------------------------------------------------------------------------------------------------------------
do $$
declare r text;
begin
  r := pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.clinician_time_entries');
  insert into results values ('real', 'a clinician reads their own three rows', '3', r);
  r := pg_temp.q_as(pg_temp.f('other'), 'select count(*)::text from public.clinician_time_entries');
  insert into results values ('real', 'another clinician reads none', '0', r);
  r := pg_temp.q_as(pg_temp.f('mem1'), 'select count(*)::text from public.clinician_time_entries');
  insert into results values ('real', 'a patient reads none', '0', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select (count(*) >= 3)::text from public.clinician_time_entries');
  insert into results values ('real', 'the CMO reads the organisation''s rows', 'true', r);
end $$;

-- 3. Consult trigger ---------------------------------------------------------------------------------------------------
do $$
declare v_note uuid; r text; v_cnt integer;
begin
  set local session_replication_role = replica;
  insert into public.clinical_encounter_notes (organisation_id, patient_id, note_type, title, status, authored_by_profile, is_test)
  values (pg_temp.f('org'), pg_temp.f('mem3'), 'video_consult', 'W01 proof', 'draft', pg_temp.f('doc'), true) returning id into v_note;
  set local session_replication_role = origin;
  perform pg_temp.setf('cnote', v_note);
  select count(*) into v_cnt from public.clinician_time_entries where source = 'consult' and source_ref = v_note;
  insert into results values ('real', 'no consult row while the call has not ended', '0', v_cnt::text);
  update public.clinical_encounter_notes set call_started_at = now() - interval '12 minutes', call_ended_at = now() where id = v_note;
  select seconds::text into r from public.clinician_time_entries where source = 'consult' and source_ref = v_note;
  insert into results values ('real', 'consult seconds come from the call timestamps', '720', r);
  update public.clinical_encounter_notes set call_ended_at = now() + interval '1 minute' where id = v_note;
  select count(*) into v_cnt from public.clinician_time_entries where source = 'consult' and source_ref = v_note;
  insert into results values ('real', 'one consult row per note', '1', v_cnt::text);
end $$;

-- 4. Aggregate ---------------------------------------------------------------------------------------------------------
do $$
declare r text; v_org uuid := pg_temp.f('org');
begin
  -- real (non-test) data: the fixtures above are is_test, so mark exactly the Member rows as real for the aggregate, and add a Free and a test patient
  set local session_replication_role = replica;
  update public.clinician_time_entries set is_test = false where patient_id in (pg_temp.f('mem1'), pg_temp.f('mem2'), pg_temp.f('mem3'));
  insert into public.clinician_time_entries (organisation_id, clinician_profile_id, patient_id, source, seconds, is_test)
  values (v_org, pg_temp.f('doc'), pg_temp.f('free'), 'manual', 900, false),
         (v_org, pg_temp.f('doc'), pg_temp.f('mem4'), 'manual', 900, true);
  set local session_replication_role = origin;
  update public.patient_memberships set is_test = false where patient_id in (pg_temp.f('mem1'), pg_temp.f('mem2'), pg_temp.f('mem3'));

  r := pg_temp.q_as(pg_temp.f('cmo'), 'select count(*)::text from public.member_month_minutes(current_date) where source = ''manual'' and tier = ''evergreen''');
  insert into results values ('real', 'test rows are excluded (the only evergreen row is test)', '0', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select coalesce(sum(members), 0)::text from public.member_month_minutes(current_date) where source = ''manual''');
  insert into results values ('real', 'Free patients are excluded (one plus Member has manual time, the Free patient does not count)', '1', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select (median_minutes is null)::text from public.member_month_minutes(current_date) where source = ''manual'' and tier = ''plus''');
  insert into results values ('real', 'a group under 3 Members reports no median', 'true', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select count(*)::text from information_schema.routines r join information_schema.parameters p on p.specific_name = r.specific_name where r.routine_name = ''member_month_minutes'' and p.parameter_mode = ''OUT'' and p.parameter_name ilike ''%clinician%''');
  insert into results values ('real', 'the aggregate has no clinician column', '0', r);
  r := pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.member_month_minutes(current_date)');
  insert into results values ('real', 'a doctor who is not the CMO cannot read the aggregate', 'ERR:42501', r);
  r := pg_temp.try_anon('select count(*) from public.member_month_minutes(current_date)');
  insert into results values ('real', 'anon cannot read the aggregate', '42501', r);
end $$;

-- 5. SABOTAGE ----------------------------------------------------------------------------------------------------------
do $$
declare v_orig text; v_def text; r text;
begin
  v_orig := pg_get_functiondef('public.record_clinician_time(text,uuid,uuid,integer)'::regprocedure);
  v_def := replace(v_orig, 'and t.claimed_by = v_uid ', '');
  if v_def = v_orig then raise exception 'SABOTAGE 1 not applied'; end if;
  execute v_def;
  r := pg_temp.q_as(pg_temp.f('other'), format($q$select public.record_clinician_time('task', %L, %L, 300)::text$q$, pg_temp.f('task'), pg_temp.f('mem1')));
  insert into results values ('sabotaged', 'a clinician who does not hold the task is refused', 'ERR:42501', case when r like 'ERR:%' then r else 'ERR:none' end);

  v_orig := pg_get_functiondef('public.member_month_minutes(date)'::regprocedure);
  v_def := replace(v_orig, 'if not (private.credential_is_cmo() or private.is_finance()) then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE 2 not applied'; end if;
  execute v_def;
  r := pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.member_month_minutes(current_date)');
  insert into results values ('sabotaged', 'a doctor who is not the CMO cannot read the aggregate', 'ERR:42501', case when r like 'ERR:%' then r else 'ERR:none' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'W01 proof FAILED on the real migration: %',
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
