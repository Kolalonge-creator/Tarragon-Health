-- P4 proof: exercise_session_logs (exercise progress needs a real record of sessions done).
--  * a patient inserts their own session; another patient cannot insert for them, read, or delete it
--  * the guard: no future date, at most 30 days back (30 passes, 31 is refused), a programme that is not theirs is refused
--  * minutes 1..600; owner, date and programme cannot be changed afterwards, minutes can be corrected
--  * staff read only through a care tie (tied clinician sees it, untied clinician and coordinator without a tie do not); anon is denied
--  * both registries carry the table (data_registry unreviewed, staff_read_scope tied)
-- SABOTAGE: guard trigger dropped, immutable trigger dropped, SELECT policy opened to organisation staff; each must flip checks.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
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
-- run a statement as a user; returns 'ok' or the error message (the message is the stable queue_* code)
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- run a scalar query as a user; returns the value as text, or 'ERR:' || message
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- the same as anon
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
  values (v, 's22-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S22 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_emp text, p_comps text[], p_admin uuid, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid; s uuid; c text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S22 ' || p_label, 'MDCN', 'S17-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, p_emp::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
      p_emp = 'contracted', case when p_emp = 'contracted' then p_admin else null end, p_test)
  returning id into s;
  foreach c in array p_comps loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, true);
  end loop;
  return v;
end $f$;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sab(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
create function pg_temp.cnt(p_uid uuid, p_table text) returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select count(*)::text from public.%I', p_table)) $$;
create function pg_temp.lagos_today() returns date language sql as $$ select (now() at time zone 'Africa/Lagos')::date $$;
create function pg_temp.ins(p_uid uuid, p_for uuid, p_days_back integer, p_minutes integer, p_enrol uuid default null) returns text language sql as
$$ select pg_temp.try_as(p_uid, format(
     'insert into public.exercise_session_logs (organisation_id, patient_id, enrollment_id, performed_on, duration_minutes, kind) values (%L, %L, %L, %L, %s, ''walking'')',
     pg_temp.f('org'), p_for, p_enrol, pg_temp.lagos_today() - p_days_back, p_minutes)) $$;

do $$
declare v_org uuid; v_admin uuid; v_pat uuid; v_doc uuid; v_prog uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin'); perform pg_temp.setf('admin', v_admin);
  update public.clinical_staff set active = false where is_test is not true;
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient'); perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient'));
  v_doc := pg_temp.mkdoc(v_org, 'doctied', 'senior_medical_officer', 'contracted', '{adult_general}', v_admin); perform pg_temp.setf('doctied', v_doc);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, v_pat, v_doc);
  perform pg_temp.setf('docuntied', pg_temp.mkdoc(v_org, 'docuntied', 'senior_medical_officer', 'contracted', '{adult_general}', v_admin));
  perform pg_temp.setf('coord', pg_temp.mkdoc(v_org, 'coord', 'care_coordinator', 'employed', '{}', v_admin));
  select id into v_prog from public.exercise_programmes where intensity_level = 'beginner' and is_active order by key limit 1;
  insert into public.patient_exercise_enrollments (organisation_id, patient_id, programme_id) values (v_org, pg_temp.f('pat'), v_prog);
  perform pg_temp.setf('enrol_pat', (select id from public.patient_exercise_enrollments where patient_id = pg_temp.f('pat')));
  insert into public.patient_exercise_enrollments (organisation_id, patient_id, programme_id) values (v_org, pg_temp.f('pat2'), v_prog);
  perform pg_temp.setf('enrol_pat2', (select id from public.patient_exercise_enrollments where patient_id = pg_temp.f('pat2')));
end $$;

do $$
declare v_pat uuid := pg_temp.f('pat'); v_pat2 uuid := pg_temp.f('pat2'); v_id uuid;
begin
  -- writes
  perform pg_temp.ck('a patient logs their own session', 'ok', pg_temp.ins(v_pat, v_pat, 0, 30, pg_temp.f('enrol_pat')));
  perform pg_temp.ck('a patient cannot log for another patient', 'false', (pg_temp.ins(v_pat2, v_pat, 0, 30) = 'ok')::text);
  perform pg_temp.ck('a future date is refused', 'A session cannot be dated in the future.', pg_temp.ins(v_pat, v_pat, -1, 30));
  perform pg_temp.ck('30 days back is accepted', 'ok', pg_temp.ins(v_pat, v_pat, 30, 20));
  perform pg_temp.ck('31 days back is refused', 'Sessions can be logged up to 30 days back.', pg_temp.ins(v_pat, v_pat, 31, 20));
  perform pg_temp.ck('another patient''s programme is refused', 'That programme is not yours.', pg_temp.ins(v_pat, v_pat, 0, 30, pg_temp.f('enrol_pat2')));
  perform pg_temp.ck('0 minutes is refused', 'false', (pg_temp.ins(v_pat, v_pat, 0, 0) = 'ok')::text);
  perform pg_temp.ck('601 minutes is refused', 'false', (pg_temp.ins(v_pat, v_pat, 0, 601) = 'ok')::text);
  perform pg_temp.ck('several sessions in one day are fine', 'ok', pg_temp.ins(v_pat, v_pat, 0, 15));
  perform pg_temp.ck('anon cannot insert', '42501', pg_temp.try_anon(format('insert into public.exercise_session_logs (organisation_id, patient_id, performed_on, duration_minutes) values (%L, %L, current_date, 5)', pg_temp.f('org'), v_pat)));

  -- reads
  perform pg_temp.ck('the patient reads their 3 sessions', '3', pg_temp.cnt(v_pat, 'exercise_session_logs'));
  perform pg_temp.ck('another patient reads none', '0', pg_temp.cnt(v_pat2, 'exercise_session_logs'));
  perform pg_temp.ck('a tied clinician reads them', '3', pg_temp.cnt(pg_temp.f('doctied'), 'exercise_session_logs'));
  perform pg_temp.ck('an untied clinician reads none', '0', pg_temp.cnt(pg_temp.f('docuntied'), 'exercise_session_logs'));
  perform pg_temp.ck('a coordinator without a tie reads none', '0', pg_temp.cnt(pg_temp.f('coord'), 'exercise_session_logs'));
  perform pg_temp.ck('anon reads nothing', '42501', pg_temp.try_anon('select count(*) from public.exercise_session_logs'));

  -- updates and deletes
  select id into v_id from public.exercise_session_logs where patient_id = v_pat and duration_minutes = 30 and performed_on = pg_temp.lagos_today();
  perform pg_temp.ck('minutes can be corrected', 'ok', pg_temp.try_as(v_pat, format('update public.exercise_session_logs set duration_minutes = 35 where id = %L', v_id)));
  perform pg_temp.ck('the date cannot be changed', 'Owner, date and programme of a logged session cannot be changed.',
    pg_temp.try_as(v_pat, format('update public.exercise_session_logs set performed_on = performed_on - 1 where id = %L', v_id)));
  perform pg_temp.try_as(v_pat2, format('update public.exercise_session_logs set duration_minutes = 1 where id = %L', v_id));
  perform pg_temp.ck('the edit by another patient changed nothing', '35', (select duration_minutes::text from public.exercise_session_logs where id = v_id));
  perform pg_temp.try_as(v_pat2, format('delete from public.exercise_session_logs where id = %L', v_id));
  perform pg_temp.ck('another patient cannot delete it', '1', (select count(*)::text from public.exercise_session_logs where id = v_id));
  perform pg_temp.try_as(v_pat, format('delete from public.exercise_session_logs where id = %L', v_id));
  perform pg_temp.ck('the owner can delete it', '0', (select count(*)::text from public.exercise_session_logs where id = v_id));

  -- registries
  perform pg_temp.ck('data_registry carries the table, unreviewed', '1', (select count(*)::text from public.data_registry where table_name = 'exercise_session_logs' and not reviewed));
  perform pg_temp.ck('staff_read_scope carries the table as tied', '1', (select count(*)::text from public.staff_read_scope where table_name = 'exercise_session_logs' and mode = 'tied'));
  perform pg_temp.ck('anon holds no privilege', 'false', has_table_privilege('anon', 'public.exercise_session_logs', 'SELECT')::text);
end $$;

-- SABOTAGE: each break must make a check above come out differently
do $$
declare v_pat uuid := pg_temp.f('pat'); v_pat2 uuid := pg_temp.f('pat2'); v_id uuid;
begin
  drop trigger exercise_session_logs_guard on public.exercise_session_logs;
  perform pg_temp.sab('a future date is refused', 'A session cannot be dated in the future.', pg_temp.ins(v_pat, v_pat, -1, 30));
  perform pg_temp.sab('another patient''s programme is refused', 'That programme is not yours.', pg_temp.ins(v_pat, v_pat, 0, 30, pg_temp.f('enrol_pat2')));

  select id into v_id from public.exercise_session_logs where patient_id = v_pat limit 1;
  drop trigger exercise_session_logs_immutable on public.exercise_session_logs;
  perform pg_temp.sab('the date cannot be changed', 'Owner, date and programme of a logged session cannot be changed.',
    pg_temp.try_as(v_pat, format('update public.exercise_session_logs set performed_on = performed_on - 1 where id = %L', v_id)));

  drop policy exercise_session_logs_select on public.exercise_session_logs;
  create policy exercise_session_logs_select on public.exercise_session_logs for select to authenticated
    using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
  perform pg_temp.sab('an untied clinician reads none', '0', pg_temp.cnt(pg_temp.f('docuntied'), 'exercise_session_logs'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'exercise_session_logs proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
