-- W-01 proof: clinician_time_entries, record_clinician_time, void_clinician_time, the consult trigger and member_month_minutes
-- (migration *_w01_clinician_time_entries.sql). NOT EXECUTED LOCALLY when written (Docker was down); the CI replay is its first run.
--   1. Time is recorded for own work only (task claim history counts; a real patient relationship is needed for message and manual time);
--      patient, anon, other clinician, consult source, bad shape and manual over 120 minutes refused; a double send inserts once; append-only.
--   2. Raw rows are readable by the owner only: another clinician, the CMO, finance and a patient select none.
--   3. Voiding: the owner within 7 days or the CMO, never delete, never twice.
--   4. The consult trigger writes one row from call_started_at/call_ended_at, once per note.
--   5. member_month_minutes: starts from Members (a zero-minute Member counts, one who ended mid-month counts), per-Member totals across all
--      sources, consult replaces overlapping task time, voided/test/Free/out-of-month time ignored, groups under 3 report no figures, per-source
--      rows are totals only, no clinician column, CMO or finance only.
--   6. SABOTAGE: the relationship check, idempotency, the voided filter, the overlap subtraction and the zero-minute denominator each removed.
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

create function pg_temp.msg_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;

-- 0. Fixtures ----------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_doc uuid; v_other uuid; v_cmo uuid; v_fin uuid; v_free uuid; v_pp uuid; v_i integer;
        v_task uuid; v_task2 uuid; v_thread uuid; v_month timestamptz := date_trunc('month', now());
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_doc := pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', v_admin);
  v_other := pg_temp.mkdoc(v_org, 'other', 'senior_medical_officer', v_admin);
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin);
  v_fin := pg_temp.mkuser(v_org, 'fin', 'finance');
  v_free := pg_temp.mkuser(v_org, 'free', 'patient');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('other', v_other); perform pg_temp.setf('cmo', v_cmo);
  perform pg_temp.setf('fin', v_fin); perform pg_temp.setf('free', v_free);
  -- mem1..mem4 are plus Members; mem5 is an evergreen Member who ended mid-month; mem6 ended before the month began
  for v_i in 1..6 loop
    v_pp := pg_temp.mkuser(v_org, 'mem' || v_i, 'patient');
    perform pg_temp.setf('mem' || v_i, v_pp);
  end loop;
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  select v_org, pg_temp.f('mem' || n), v_doc, now() from generate_series(1, 4) n;
  set local session_replication_role = replica;
  for v_i in 1..4 loop
    insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, granted_by, grant_reason, tier, is_test)
    values (v_org, pg_temp.f('mem' || v_i), 'granted', 'active', v_month - interval '40 days', v_admin, 'W01 proof fixture membership', 'plus', false);
  end loop;
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, ended_at, ended_by, end_reason, granted_by, grant_reason, tier, is_test)
  values (v_org, pg_temp.f('mem5'), 'granted', 'ended', v_month - interval '20 days', v_month + interval '3 days', v_month + interval '3 days', v_admin, 'W01 proof ended mid month', v_admin, 'W01 proof fixture membership', 'evergreen', false),
         (v_org, pg_temp.f('mem6'), 'granted', 'ended', v_month - interval '60 days', v_month - interval '10 days', v_month - interval '10 days', v_admin, 'W01 proof ended before month', v_admin, 'W01 proof fixture membership', 'evergreen', false);
  update public.profiles set is_test = false where id in (select pg_temp.f('mem' || n) from generate_series(1, 6) n);
  insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at, state,
      claimed_by, claimed_at, claim_expires_at, is_test)
  select v_org, tt.code, tt.version, 5, 5, pg_temp.f('mem1'), 'senior_medical_officer', now() + interval '1 day', 'claimed', v_doc, now(), now() + interval '1 hour', true
    from public.task_types tt order by tt.code limit 1 returning id into v_task;
  -- a task the doctor held earlier and handed back: no longer claimed, but the claim is in the history
  insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at, state, is_test)
  select v_org, tt.code, tt.version, 5, 5, pg_temp.f('mem2'), 'senior_medical_officer', now() + interval '1 day', 'created', true
    from public.task_types tt order by tt.code limit 1 returning id into v_task2;
  insert into public.task_claims (organisation_id, task_id, clinician_id, claimed_at, expires_at, ended_at, end_reason, is_test)
  values (v_org, v_task2, v_doc, now() - interval '1 hour', now() - interval '30 minutes', now() - interval '40 minutes', 'handed_back', true);
  insert into public.care_message_threads (organisation_id, patient_id, subject, category)
  values (v_org, pg_temp.f('mem1'), 'W01 proof', 'general') returning id into v_thread;
  set local session_replication_role = origin;
  perform pg_temp.setf('task', v_task); perform pg_temp.setf('task2', v_task2); perform pg_temp.setf('thread', v_thread);
end $$;

-- 1. Writes ------------------------------------------------------------------------------------------------------------
do $$
declare r text; n0 integer; k uuid := gen_random_uuid();
begin
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_clinician_time('task', %L, %L, 300)::text$q$, pg_temp.f('task'), pg_temp.f('mem1')));
  insert into results values ('real', 'clinician records time on a task they hold', 'true', (r !~ '^ERR')::text);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_clinician_time('task', %L, %L, 200)::text$q$, pg_temp.f('task2'), pg_temp.f('mem2')));
  insert into results values ('real', 'time on a task they held earlier (claim history) is accepted', 'true', (r !~ '^ERR')::text);
  r := pg_temp.q_as(pg_temp.f('other'), format($q$select public.record_clinician_time('task', %L, %L, 200)::text$q$, pg_temp.f('task2'), pg_temp.f('mem2')));
  insert into results values ('real', 'a clinician who never held the task is refused', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_clinician_time('message', %L, %L, 120)::text$q$, pg_temp.f('thread'), pg_temp.f('mem1')));
  insert into results values ('real', 'message time for a patient on their care team is accepted', 'true', (r !~ '^ERR')::text);
  r := pg_temp.q_as(pg_temp.f('other'), format($q$select public.record_clinician_time('message', %L, %L, 120)::text$q$, pg_temp.f('thread'), pg_temp.f('mem1')));
  insert into results values ('real', 'message time with no relationship to the patient is refused', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_clinician_time('manual', null, %L, 600)::text$q$, pg_temp.f('mem2')));
  insert into results values ('real', 'manual time for a patient on their care team is accepted', 'true', (r !~ '^ERR')::text);
  r := pg_temp.q_as(pg_temp.f('other'), format($q$select public.record_clinician_time('manual', null, %L, 600)::text$q$, pg_temp.f('mem2')));
  insert into results values ('real', 'manual time with no relationship to the patient is refused', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_clinician_time('manual', null, %L, 7201)::text$q$, pg_temp.f('mem2')));
  insert into results values ('real', 'manual time over 120 minutes is refused', 'ERR:22023', r);
  r := pg_temp.q_as(pg_temp.f('mem1'), format($q$select public.record_clinician_time('manual', null, %L, 60)::text$q$, pg_temp.f('mem1')));
  insert into results values ('real', 'a patient is refused', 'ERR:42501', r);
  r := pg_temp.try_anon(format($q$select public.record_clinician_time('manual', null, %L, 60)$q$, pg_temp.f('mem1')));
  insert into results values ('real', 'anon is refused', '42501', r);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_clinician_time('consult', null, %L, 60)::text$q$, pg_temp.f('mem1')));
  insert into results values ('real', 'a client cannot write consult time', 'ERR:22023', r);
  -- idempotent: the same send twice inserts once and returns the same id
  perform pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_clinician_time('manual', null, %L, 90, %L)::text$q$, pg_temp.f('mem3'), k));
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_clinician_time('manual', null, %L, 90, %L)::text$q$, pg_temp.f('mem3'), k));
  insert into results values ('real', 'a second send with the same client key is accepted without an error', 'true', (r !~ '^ERR')::text);
  insert into results values ('real', 'a double send inserts one row', '1', (select count(*)::text from public.clinician_time_entries where client_key = k));
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$insert into public.clinician_time_entries (organisation_id, clinician_profile_id, source, seconds) values (%L, %L, 'manual', 5)$q$, pg_temp.f('org'), pg_temp.f('doc')));
  insert into results values ('real', 'direct insert is refused', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('doc'), 'update public.clinician_time_entries set seconds = 1');
  insert into results values ('real', 'update by a client is refused', 'ERR:42501', r);
  begin
    update public.clinician_time_entries set seconds = 1;
    insert into results values ('real', 'changing seconds is refused even for the owner role', 'raised', 'no error');
  exception when others then
    insert into results values ('real', 'changing seconds is refused even for the owner role', 'raised', 'raised');
  end;
  begin
    delete from public.clinician_time_entries;
    insert into results values ('real', 'delete is refused even for the owner role', 'raised', 'no error');
  exception when others then
    insert into results values ('real', 'delete is refused even for the owner role', 'raised', 'raised');
  end;
end $$;

-- 2. Reads: the owner only ------------------------------------------------------------------------------------------------
do $$
declare r text;
begin
  r := pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.clinician_time_entries');
  insert into results values ('real', 'a clinician reads their own rows', '5', r);
  r := pg_temp.q_as(pg_temp.f('other'), 'select count(*)::text from public.clinician_time_entries');
  insert into results values ('real', 'another clinician reads none', '0', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select count(*)::text from public.clinician_time_entries');
  insert into results values ('real', 'the CMO cannot select other clinicians'' rows', '0', r);
  r := pg_temp.q_as(pg_temp.f('fin'), 'select count(*)::text from public.clinician_time_entries');
  insert into results values ('real', 'finance cannot select clinicians'' rows', '0', r);
  r := pg_temp.q_as(pg_temp.f('mem1'), 'select count(*)::text from public.clinician_time_entries');
  insert into results values ('real', 'a patient reads none', '0', r);
end $$;

-- 3. Voiding -----------------------------------------------------------------------------------------------------------
do $$
declare r text; v_e uuid; v_old uuid;
begin
  select id into v_e from public.clinician_time_entries where source = 'manual' and seconds = 600 limit 1;
  r := pg_temp.q_as(pg_temp.f('other'), format($q$select public.void_clinician_time(%L, 'wrong person voiding')::text$q$, v_e));
  insert into results values ('real', 'another clinician cannot void a row', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.void_clinician_time(%L, 'a mistake')::text$q$, v_e));
  insert into results values ('real', 'the owner voids their own row within 7 days', 'true', (r !~ '^ERR')::text);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.void_clinician_time(%L, 'again please')::text$q$, v_e));
  insert into results values ('real', 'a row cannot be voided twice', 'ERR:P0002', r);
  insert into results values ('real', 'a voided row is kept, with who and why', 'true',
    (select (voided_at is not null and voided_by = pg_temp.f('doc') and void_reason = 'a mistake')::text from public.clinician_time_entries where id = v_e));
  -- 8 days old: the owner can no longer void it, the CMO can
  set local session_replication_role = replica;
  update public.clinician_time_entries set created_at = now() - interval '8 days' where source = 'message';
  set local session_replication_role = origin;
  select id into v_old from public.clinician_time_entries where source = 'message' limit 1;
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.void_clinician_time(%L, 'too late now')::text$q$, v_old));
  insert into results values ('real', 'the owner cannot void a row older than 7 days', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), format($q$select public.void_clinician_time(%L, 'CMO correction')::text$q$, v_old));
  insert into results values ('real', 'the CMO can void an old row', 'true', (r !~ '^ERR')::text);
end $$;

-- 4. Consult trigger ---------------------------------------------------------------------------------------------------
do $$
declare v_note uuid; r text; v_cnt integer;
begin
  set local session_replication_role = replica;
  -- the attribution trigger needs the caller to be an active clinical-tier staff member of the note's organisation
  perform set_config('request.jwt.claim.sub', pg_temp.f('doc')::text, true);
  insert into public.clinical_encounter_notes (organisation_id, patient_id, encounter_type, reason_for_encounter, status, authored_by_profile)
  values (pg_temp.f('org'), pg_temp.f('mem1'), 'video_consult', 'W01 proof', 'draft', pg_temp.f('doc')) returning id into v_note;
  perform set_config('request.jwt.claim.sub', '', true);
  set local session_replication_role = origin;
  select count(*) into v_cnt from public.clinician_time_entries where source = 'consult' and source_ref = v_note;
  insert into results values ('real', 'no consult row while the call has not ended', '0', v_cnt::text);
  update public.clinical_encounter_notes set call_started_at = now() - interval '10 minutes', call_ended_at = now() where id = v_note;
  select seconds::text into r from public.clinician_time_entries where source = 'consult' and source_ref = v_note;
  insert into results values ('real', 'consult seconds come from the call timestamps', '600', r);
  update public.clinical_encounter_notes set call_ended_at = now() + interval '1 minute' where id = v_note;
  select count(*) into v_cnt from public.clinician_time_entries where source = 'consult' and source_ref = v_note;
  insert into results values ('real', 'one consult row per note', '1', v_cnt::text);
end $$;

-- 5. Aggregate -----------------------------------------------------------------------------------------------------------
-- Real (non-test) data for the month. Per Member in minutes:
--   mem1: task 900 s, but 600 s of consult the same day with the same doctor replaces them: task counts 300 s, consult 600 s = 15 min
--   mem2: manual 600 s = 10 min       mem3: message 300 s = 5 min (and a voided 3600 s manual that must not count)
--   mem4: nothing at all = 0 min (still a Member)      Free patient: time but no membership (excluded)
--   mem5 (evergreen, ended mid month): nothing = 0 min      mem6 (ended before the month): time that must not count
do $$
declare r text; v_org uuid := pg_temp.f('org'); v_doc uuid := pg_temp.f('doc');
begin
  set local session_replication_role = replica;
  delete from public.clinician_time_entries;
  insert into public.clinician_time_entries (organisation_id, clinician_profile_id, patient_id, source, seconds, voided_at, voided_by, void_reason, is_test) values
    (v_org, v_doc, pg_temp.f('mem1'), 'task', 900, null, null, null, false),
    (v_org, v_doc, pg_temp.f('mem1'), 'consult', 600, null, null, null, false),
    (v_org, v_doc, pg_temp.f('mem2'), 'manual', 600, null, null, null, false),
    (v_org, v_doc, pg_temp.f('mem3'), 'message', 300, null, null, null, false),
    (v_org, v_doc, pg_temp.f('mem3'), 'manual', 3600, now(), v_doc, 'voided in the proof', false),
    (v_org, v_doc, pg_temp.f('free'), 'manual', 900, null, null, null, false),
    (v_org, v_doc, pg_temp.f('mem6'), 'manual', 900, null, null, null, false),
    (v_org, v_doc, pg_temp.f('mem2'), 'manual', 900, null, null, null, true);
  set local session_replication_role = origin;

  r := pg_temp.q_as(pg_temp.f('cmo'), $q$select members::text from public.member_month_minutes(null) where kind = 'total' and tier = 'plus'$q$);
  insert into results values ('real', 'the zero-minute Member is counted: four plus Members', '4', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), $q$select mean_minutes::text from public.member_month_minutes(null) where kind = 'total' and tier = 'plus'$q$);
  insert into results values ('real', 'mean of each Member''s total, zeros included (15, 10, 5, 0)', '7.5', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), $q$select median_minutes::text from public.member_month_minutes(null) where kind = 'total' and tier = 'plus'$q$);
  insert into results values ('real', 'median of each Member''s total', '7.5', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), $q$select p90_minutes::text from public.member_month_minutes(null) where kind = 'total' and tier = 'plus'$q$);
  insert into results values ('real', 'p90 of each Member''s total', '13.5', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), $q$select total_minutes::text from public.member_month_minutes(null) where kind = 'total' and tier = 'plus'$q$);
  insert into results values ('real', 'total minutes: voided, test, Free and out-of-month time are not counted', '30.0', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), $q$select total_minutes::text from public.member_month_minutes(null) where kind = 'source' and tier = 'plus' and source = 'task'$q$);
  insert into results values ('real', 'consult time replaces the overlapping task time (900 s becomes 300 s)', '5.0', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), $q$select total_minutes::text from public.member_month_minutes(null) where kind = 'source' and tier = 'plus' and source = 'consult'$q$);
  insert into results values ('real', 'consult time is kept in full', '10.0', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), $q$select members::text || '/' || (median_minutes is null)::text || '/' || (mean_minutes is null)::text from public.member_month_minutes(null) where kind = 'total' and tier = 'evergreen'$q$);
  insert into results values ('real', 'a Member who ended mid-month is counted, and a group under 3 reports no figures', '1/true/true', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), $q$select count(*)::text from public.member_month_minutes(null) where kind = 'source' and tier = 'evergreen'$q$);
  insert into results values ('real', 'no per-source rows for a group under 3', '0', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), $q$select count(*)::text from public.member_month_minutes(null) where kind = 'source' and (median_minutes is not null or mean_minutes is not null or p90_minutes is not null)$q$);
  insert into results values ('real', 'per-source rows carry totals only, no medians', '0', r);
  r := pg_temp.q_as(pg_temp.f('fin'), $q$select count(*)::text from public.member_month_minutes(null)$q$);
  insert into results values ('real', 'finance can read the aggregate', 'true', (r !~ '^ERR')::text);
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select count(*)::text from information_schema.parameters p where p.specific_name like ''member_month_minutes%'' and p.parameter_mode = ''OUT'' and p.parameter_name ilike ''%clinician%''');
  insert into results values ('real', 'the aggregate has no clinician column', '0', r);
  r := pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.member_month_minutes(null)');
  insert into results values ('real', 'a doctor who is not the CMO cannot read the aggregate', 'ERR:42501', r);
  r := pg_temp.try_anon('select count(*) from public.member_month_minutes(null)');
  insert into results values ('real', 'anon cannot read the aggregate', '42501', r);
end $$;

-- 6. SABOTAGE ----------------------------------------------------------------------------------------------------------
do $$
declare v_orig text; v_def text; r text; k uuid := gen_random_uuid();
begin
  -- (a) the relationship check removed: a clinician with no tie to the patient can record manual time
  v_orig := pg_get_functiondef('public.record_clinician_time(text,uuid,uuid,integer,uuid)'::regprocedure);
  v_def := replace(v_orig, 'and private.clinician_has_patient_access(p_patient);', ';');
  if v_def = v_orig then raise exception 'SABOTAGE a not applied'; end if;
  execute v_def;
  r := pg_temp.q_as(pg_temp.f('other'), format($q$select public.record_clinician_time('manual', null, %L, 600)::text$q$, pg_temp.f('mem2')));
  insert into results values ('sabotaged', 'manual time with no relationship to the patient is refused', 'ERR:42501', case when r like 'ERR:%' then r else 'ERR:none' end);

  -- (b) idempotency removed: the same client key twice
  v_orig := pg_get_functiondef('public.record_clinician_time(text,uuid,uuid,integer,uuid)'::regprocedure);
  v_def := replace(v_orig, 'if v_id is not null then return v_id; end if;', '');
  v_def := replace(v_def, 'on conflict (clinician_profile_id, client_key) do nothing', '');
  if v_def = v_orig then raise exception 'SABOTAGE b not applied'; end if;
  execute v_def;
  perform pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_clinician_time('manual', null, %L, 90, %L)::text$q$, pg_temp.f('mem3'), k));
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_clinician_time('manual', null, %L, 90, %L)::text$q$, pg_temp.f('mem3'), k));
  insert into results values ('sabotaged', 'a second send with the same client key is accepted without an error', 'true', (r !~ '^ERR')::text);

  -- (c) the voided filter removed from the aggregate
  v_orig := pg_get_functiondef('public.member_month_minutes(date)'::regprocedure);
  v_def := replace(v_orig, 'and e.voided_at is null', '');
  if v_def = v_orig then raise exception 'SABOTAGE c not applied'; end if;
  execute v_def;
  r := pg_temp.q_as(pg_temp.f('cmo'), $q$select total_minutes::text from public.member_month_minutes(null) where kind = 'total' and tier = 'plus'$q$);
  insert into results values ('sabotaged', 'total minutes: voided, test, Free and out-of-month time are not counted', '30.0', r);

  -- (d) the overlap subtraction removed from the aggregate
  v_orig := pg_get_functiondef('public.member_month_minutes(date)'::regprocedure);
  v_def := replace(v_orig, 'then greatest(0::numeric, b.secs - coalesce((select sum(x.secs) from base x where x.pid = b.pid and x.cid = b.cid and x.d = b.d and x.src = ''consult''), 0))', 'then b.secs');
  if v_def = v_orig then raise exception 'SABOTAGE d not applied'; end if;
  execute v_def;
  r := pg_temp.q_as(pg_temp.f('cmo'), $q$select total_minutes::text from public.member_month_minutes(null) where kind = 'source' and tier = 'plus' and source = 'task'$q$);
  insert into results values ('sabotaged', 'consult time replaces the overlapping task time (900 s becomes 300 s)', '5.0', r);

  -- (e) the denominator: Members with no time dropped (inner join instead of left join)
  v_orig := pg_get_functiondef('public.member_month_minutes(date)'::regprocedure);
  v_def := replace(v_orig, 'members m left join per_src s', 'members m join per_src s');
  if v_def = v_orig then raise exception 'SABOTAGE e not applied'; end if;
  execute v_def;
  r := pg_temp.q_as(pg_temp.f('cmo'), $q$select members::text from public.member_month_minutes(null) where kind = 'total' and tier = 'plus'$q$);
  insert into results values ('sabotaged', 'the zero-minute Member is counted: four plus Members', '4', r);
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
  if v_caught < 5 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 5 checks (%)', v_caught,
      (select string_agg(check_name || ' => ' || actual, '; ') from results where phase = 'sabotaged');
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
