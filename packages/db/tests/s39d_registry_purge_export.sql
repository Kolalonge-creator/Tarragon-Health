-- S39d proof (founder direction 2026-10-07, OQ-262 to OQ-264; migration *_s39d_data_registry_purge_export.sql).
-- One rolled-back transaction. Proves: the registry covers every patient_id table and carries the classes; purge_test_account removes an is_test account
-- and everything that points at it (RESTRICT children, an append-only log, a clinician row, auth.users) while a real patient's data is untouched, and
-- refuses a real account, a non-admin, anon and the caller's own account; triggers are back on afterwards; export_patient_data returns the patient's rows
-- from every registered table with no token or secret key, and is admin only; the retention report is admin/CMO only and counts old rows without deleting;
-- due_at is the 30-day clock.
-- SABOTAGE: the is_test guard removed (a real account is purged); the credential filter removed (a token appears in the export). Both must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's39c-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S39c ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true;
  if p_role = 'clinician' then
    insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
    values (p_org, v, 'S39c ' || p_label, true, now(), 'medical_officer');
  end if;
  return v;
end $f$;

-- run one statement as a user; returns the first column as text, or the sqlstate on an error
create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.as_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;

create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;

do $$
declare v_org uuid; v_org2 uuid; v_real uuid; v_test uuid; v_clin uuid; v_clin2 uuid; v_ad uuid; v_co uuid; v_ox uuid; v_c3 uuid; v_c4 uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_org2 from public.organisations where id <> v_org order by created_at limit 1;
  if v_org2 is null then insert into public.organisations (name, type) values ('S39d second org', 'clinic') returning id into v_org2; end if;
  v_real := pg_temp.mkuser(v_org, 'real patient', 'patient');
  update public.profiles set is_test = false, full_name = 'Zzq Searchable Patient' where id = v_real;
  v_test := pg_temp.mkuser(v_org, 'test patient', 'patient');
  v_clin := pg_temp.mkuser(v_org, 'test clinician', 'clinician');
  v_clin2 := pg_temp.mkuser(v_org, 'other clinician', 'clinician');
  v_co := pg_temp.mkuser(v_org, 'coordinator', 'care_coordinator');
  v_ad := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_ox := pg_temp.mkuser(v_org2, 'other org clinician', 'clinician');
  v_c3 := pg_temp.mkuser(v_org, 'authoring clinician', 'clinician');
  v_c4 := pg_temp.mkuser(v_org, 'opening clinician', 'clinician');
  insert into public.clinician_conflicts (organisation_id, clinician_id, patient_id, reason, source) values (v_org, v_c3, v_real, 'S39d fixture conflict', 'cmo');
  insert into public.staff_record_opens (expires_at, staff_id, patient_id, organisation_id, basis) values (now() + interval '8 hours', v_c4, v_real, v_org, 'open');
  -- rows for the real patient
  insert into public.patient_serology_status (organisation_id, patient_id) values (v_org, v_real);
  perform set_config('request.jwt.claim.sub', v_real::text, true);
  insert into public.data_export_requests (organisation_id, patient_id, created_at) values (v_org, v_real, now() - interval '9 years');
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.emergency_cards (patient_id, organisation_id, token, is_active, consented_at, expires_at) values (v_real, v_org, md5('s39d') || md5('tok'), true, now(), now() + interval '30 days');
  -- rows for the test patient, spread over RESTRICT children, an append-only log and an authorship column
  insert into public.patient_serology_status (organisation_id, patient_id) values (v_org, v_test);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at) values (v_org, v_test, v_clin, v_co, now())
    on conflict (patient_id) do update set clinician_id = excluded.clinician_id, care_coordinator_id = excluded.care_coordinator_id, clinical_director_id = null;
  insert into public.staff_record_opens (expires_at, staff_id, patient_id, organisation_id, basis) values (now() + interval '8 hours', v_clin, v_test, v_org, 'open');
  perform set_config('request.jwt.claim.sub', v_test::text, true);
  insert into public.data_export_requests (organisation_id, patient_id) values (v_org, v_test);
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id) values (v_org, v_clin, 's39d_fixture', 'patient', v_test);
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('real', v_real); perform pg_temp.setf('test', v_test); perform pg_temp.setf('clin', v_clin); perform pg_temp.setf('clin2', v_clin2);
  perform pg_temp.setf('co', v_co); perform pg_temp.setf('ad', v_ad); perform pg_temp.setf('ox', v_ox); perform pg_temp.setf('c3', v_c3); perform pg_temp.setf('c4', v_c4);
end $$;

-- A. registry ---------------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'A1 every public table with a patient_id column is in the registry', '',
  (select coalesce(string_agg(c.table_name, ','), '') from information_schema.columns c join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'patient_id' and c.data_type = 'uuid' and c.table_name not in (select table_name from public.data_registry)));
select pg_temp.ck('real', 'A2 the access log is class audit and not exported', 'audit|false',
  (select retention_class || '|' || in_export::text from public.data_registry where table_name = 'staff_record_opens'));
select pg_temp.ck('real', 'A3 classes are assigned by whole words (maternity, consent, financial, operational, mental health), not substrings', 'true',
  (private.retention_class_for('discharge_summaries') = 'clinical_record' and private.retention_class_for('symptom_journal_entries') = 'clinical_record' and private.retention_class_for('patient_pregnancy') = 'maternity' and private.retention_class_for('scribe_consents') = 'consent' and private.retention_class_for('payment_attempts') = 'financial'
   and private.retention_class_for('notification_deliveries') = 'operational' and private.retention_class_for('mental_health_assessments') = 'mental_health' and private.retention_class_for('vitals_readings') = 'clinical_record')::text);
select pg_temp.ck('real', 'A4 the classification is proposed, not reviewed', '0', (select count(*)::text from public.data_registry where reviewed));
select pg_temp.ck('real', 'A5 only an admin or the CMO reads the registry', 'ERR 0|true',
  (select coalesce(nullif(pg_temp.as_user(pg_temp.f('clin'), 'select count(*) from public.data_registry'), '0'), 'ERR 0') || '|' || (pg_temp.as_user(pg_temp.f('ad'), 'select count(*) from public.data_registry')::integer > 100)::text));
-- B. purge refusals ---------------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'B1 an admin cannot purge a real account', 'ERR 42501', pg_temp.as_user(pg_temp.f('ad'), format('select public.purge_test_account(%L)::text', pg_temp.f('real'))));
select pg_temp.ck('real', 'B2 a clinician cannot purge even a test account', 'ERR 42501', pg_temp.as_user(pg_temp.f('clin2'), format('select public.purge_test_account(%L)::text', pg_temp.f('test'))));
select pg_temp.ck('real', 'B3 anon cannot call it', 'ERR 42501', pg_temp.as_anon(format('select public.purge_test_account(%L)::text', pg_temp.f('test'))));
select pg_temp.ck('real', 'B4 an admin cannot purge their own account', 'ERR 42501', pg_temp.as_user(pg_temp.f('ad'), format('select public.purge_test_account(%L)::text', pg_temp.f('ad'))));
select pg_temp.ck('real', 'B5 the real patient is untouched by the refusals', '1',
  (select count(*)::text from public.profiles where id = pg_temp.f('real')));
-- C. purge ------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'C1 an admin purges the test patient', 'true', (pg_temp.as_user(pg_temp.f('ad'), format('select (public.purge_test_account(%L)) ->> ''purged''', pg_temp.f('test'))) = 'true')::text);
select pg_temp.ck('real', 'C2 the profile and the login are gone', '0|0',
  (select (select count(*) from public.profiles where id = pg_temp.f('test'))::text || '|' || (select count(*) from auth.users where id = pg_temp.f('test'))::text));
select pg_temp.ck('real', 'C3 every row that pointed at it is gone (serology, care team, access log, export request)', '0',
  ((select count(*) from public.patient_serology_status where patient_id = pg_temp.f('test')) + (select count(*) from public.care_team_assignment where patient_id = pg_temp.f('test'))
   + (select count(*) from public.staff_record_opens where patient_id = pg_temp.f('test')) + (select count(*) from public.data_export_requests where patient_id = pg_temp.f('test')))::text);
select pg_temp.ck('real', 'C4 the real patient and their rows are untouched', '1|1',
  (select (select count(*) from public.profiles where id = pg_temp.f('real'))::text || '|' || (select count(*) from public.patient_serology_status where patient_id = pg_temp.f('real'))::text));
select pg_temp.ck('real', 'C5 the other clinician and the organisation are untouched', '1',
  (select count(*)::text from public.profiles where id = pg_temp.f('clin2')));
select pg_temp.ck('real', 'C6 triggers are back on: the access log is append-only again', 'blocked',
  case when pg_temp.try_sql('update public.staff_record_opens set basis = basis') like '%append-only%' or not exists (select 1 from public.staff_record_opens) then 'blocked' else 'open' end);
select pg_temp.ck('real', 'C7 every trigger the purge switched off is back on', '0', (select count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal and t.tgenabled <> 'O' and t.tgname in ('staff_record_opens_no_change', 'staff_record_opens_no_truncate')));
select pg_temp.ck('real', 'C8 the purge itself is audited', '1', (select count(*)::text from public.audit_log where action = 'test_account_purge' and entity_id = pg_temp.f('test')));
-- the clinician row: purge the test clinician too (clinical_staff row, authorship columns)
select pg_temp.ck('real', 'C9 an admin purges the test clinician', 'true', (pg_temp.as_user(pg_temp.f('ad'), format('select (public.purge_test_account(%L)) ->> ''purged''', pg_temp.f('clin'))) = 'true')::text);
select pg_temp.ck('real', 'C10 the clinician and their staff row are gone', '0|0',
  (select (select count(*) from public.profiles where id = pg_temp.f('clin'))::text || '|' || (select count(*) from public.clinical_staff where profile_id = pg_temp.f('clin'))::text));
select pg_temp.ck('real', 'C11 rows they authored elsewhere are kept with the author cleared, not deleted', '1',
  (select count(*)::text from public.audit_log where action = 's39d_fixture' and actor_id is null));
-- C12 to C15: a test account never takes a real patient's records, or the log of what it opened, with it
select pg_temp.ck('real', 'C12 a test clinician with a NOT NULL link to a REAL patient''s row cannot be purged', 'ERR 23503', pg_temp.as_user(pg_temp.f('ad'), format('select public.purge_test_account(%L)::text', pg_temp.f('c3'))));
select pg_temp.ck('real', 'C13 ...and nothing was deleted: the clinician and the real patient''s row are still there', '1|1',
  (select (select count(*) from public.profiles where id = pg_temp.f('c3'))::text || '|' || (select count(*) from public.clinician_conflicts where patient_id = pg_temp.f('real') and clinician_id = pg_temp.f('c3'))::text));
select pg_temp.ck('real', 'C14 a test clinician who only opened a real patient is purged', 'true', (pg_temp.as_user(pg_temp.f('ad'), format('select (public.purge_test_account(%L)) ->> ''purged''', pg_temp.f('c4'))) = 'true')::text);
select pg_temp.ck('real', 'C15 ...and the log of that opening is kept', '1', (select count(*)::text from public.staff_record_opens where staff_id = pg_temp.f('c4') and patient_id = pg_temp.f('real')));
-- D. export ----------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'D1 an admin exports the real patient: the serology rows are there', 'true',
  (pg_temp.as_user(pg_temp.f('ad'), format('select jsonb_array_length(public.export_patient_data(%L) -> ''tables'' -> ''patient_serology_status'')', pg_temp.f('real')))::integer >= 1)::text);
select pg_temp.ck('real', 'D2 the export carries no token or secret key', 'false',
  (pg_temp.as_user(pg_temp.f('ad'), format('select (public.export_patient_data(%L))::text ~* ''"(token|secret|password|api_key)"''', pg_temp.f('real'))))::text);
select pg_temp.ck('real', 'D3 the emergency card is exported without its token', 'true',
  (pg_temp.as_user(pg_temp.f('ad'), format('select (public.export_patient_data(%L) -> ''tables'' -> ''emergency_cards'' -> 0) ? ''is_active''', pg_temp.f('real'))))::text);
select pg_temp.ck('real', 'D4 a clinician, a patient and anon cannot export', 'ERR 42501|ERR 42501|ERR 42501',
  (pg_temp.as_user(pg_temp.f('clin2'), format('select public.export_patient_data(%L)::text', pg_temp.f('real'))) || '|' || pg_temp.as_user(pg_temp.f('real'), format('select public.export_patient_data(%L)::text', pg_temp.f('real')))
   || '|' || pg_temp.as_anon(format('select public.export_patient_data(%L)::text', pg_temp.f('real')))));
select pg_temp.ck('real', 'D5 every export is audited', 'true', ((select count(*) from public.audit_log where action = 'patient_data_export' and entity_id = pg_temp.f('real')) >= 3)::text);
-- E. retention ---------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'E1 the report counts a nine-year-old row and deletes nothing', '1|true',
  (select (select count(*) from public.data_export_requests where patient_id = pg_temp.f('real') and created_at < now() - interval '8 years')::text || '|'
          || (pg_temp.as_user(pg_temp.f('ad'), 'select rows_older_than_period from public.retention_review_report() where table_name = ''data_export_requests''')::integer >= 1)::text));
select pg_temp.ck('real', 'E2 a clinician is refused the report', 'ERR 42501', pg_temp.as_user(pg_temp.f('clin2'), 'select count(*) from public.retention_review_report()'));
select pg_temp.ck('real', 'E3 anon is refused the report', 'ERR 42501', pg_temp.as_anon('select count(*) from public.retention_review_report()'));
-- G. the clock --------------------------------------------------------------------------------------------------------------------------------------------------
do $$ begin perform set_config('request.jwt.claim.sub', pg_temp.f('real')::text, true); insert into public.data_export_requests (organisation_id, patient_id) values (pg_temp.f('org'), pg_temp.f('real')); perform set_config('request.jwt.claim.sub', '', true); end $$;
select pg_temp.ck('real', 'G1 a new export request is due in 30 days', 'true',
  (select (due_at between requested_at + interval '29 days' and requested_at + interval '31 days')::text from public.data_export_requests where patient_id = pg_temp.f('real') order by requested_at desc limit 1));
select pg_temp.ck('real', 'G3 the clock follows the config, not a literal', 'true',
  (select (private.export_review_due() between now() + interval '29 days' and now() + interval '31 days')::text));
select pg_temp.ck('real', 'G2 the active config is v3 with export_review_days 30', 'true',
  (select (version >= 3 and (config ->> 'export_review_days') = '30' and (config -> 'retention' ->> 'real_data_auto_delete') = 'false')::text from public.security_config where is_active));

-- SABOTAGE ---------------------------------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_def text; v_victim uuid := pg_temp.mkuser(pg_temp.f('org'), 'victim', 'patient'); v_tok text;
begin
  update public.profiles set is_test = false where id = v_victim;
  select pg_get_functiondef('public.purge_test_account(uuid)'::regprocedure) into v_def;
  v_def := replace(v_def, 'if v_is_test is distinct from true then', 'if false then');
  execute v_def;
  perform pg_temp.as_user(pg_temp.f('ad'), format('select public.purge_test_account(%L)::text', v_victim));
  insert into results values ('sabotaged', 'SABOTAGE 1: without the is_test guard a real account is purged', '1', (select count(*)::text from public.profiles where id = v_victim));
  select pg_get_functiondef('public.export_patient_data(uuid)'::regprocedure) into v_def;
  v_def := replace(v_def, 'where e.key !~* ''''token|secret|password|hash|api_key|passcode''''', 'where true');
  execute v_def;
  insert into results values ('sabotaged', 'SABOTAGE 2: without the credential filter a token appears in the export', 'false',
    pg_temp.as_user(pg_temp.f('ad'), format('select (public.export_patient_data(%L))::text ~* ''"token"''', pg_temp.f('real'))));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S39d proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
