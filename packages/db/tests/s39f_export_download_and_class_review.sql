-- S39f proof: the complete export reaches the patient only after an admin approves it; the CMO's class confirmation (migration *_s39f_export_download_and_class_review.sql).
-- One rolled-back transaction. Proves: export_my_data() refuses a patient with no request, with a pending request, with a denied request and with an approval older than
-- the review period; returns the patient's own rows from the registry tables (and nobody else's) once an admin has fulfilled a request, and writes an
-- audit row; refuses a clinician, a coordinator, an admin and anon; export_patient_data (admin) still works and shares the same body; the registry is fully reviewed with the CMO's
-- corrections applied. SABOTAGE: the fulfilled-request check removed (a patient with no approval downloads); must flip.
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
  values (v, 's39f-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S39f ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true;
  if p_role = 'clinician' then
    insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
    values (p_org, v, 'S39f ' || p_label, true, now(), 'medical_officer');
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
declare v_org uuid; v_p uuid; v_q uuid; v_n uuid; v_ad uuid; v_cl uuid; v_co uuid; v_req uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_p := pg_temp.mkuser(v_org, 'patient', 'patient'); v_q := pg_temp.mkuser(v_org, 'other patient', 'patient'); v_n := pg_temp.mkuser(v_org, 'no request patient', 'patient');
  v_ad := pg_temp.mkuser(v_org, 'admin', 'admin'); v_cl := pg_temp.mkuser(v_org, 'clinician', 'clinician'); v_co := pg_temp.mkuser(v_org, 'coordinator', 'care_coordinator');
  insert into public.patient_serology_status (organisation_id, patient_id) values (v_org, v_p), (v_org, v_q), (v_org, v_n);
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('p', v_p); perform pg_temp.setf('q', v_q); perform pg_temp.setf('n', v_n);
  perform pg_temp.setf('ad', v_ad); perform pg_temp.setf('cl', v_cl); perform pg_temp.setf('co', v_co);
  -- p asks for the data (the attribution trigger stamps the patient from the session)
  perform set_config('request.jwt.claim.sub', v_p::text, true);
  insert into public.data_export_requests (organisation_id, patient_id) values (v_org, v_p) returning id into v_req;
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.setf('req', v_req);
end $$;

-- before approval
select pg_temp.ck('real', 'E1 a patient with no request is refused', 'ERR 42501', pg_temp.as_user(pg_temp.f('n'), 'select public.export_my_data()::text'));
select pg_temp.ck('real', 'E2 a patient with a PENDING request is refused', 'ERR 42501', pg_temp.as_user(pg_temp.f('p'), 'select public.export_my_data()::text'));
select pg_temp.ck('real', 'E3 a clinician, a coordinator, an admin and anon are refused', 'ERR 42501|ERR 42501|ERR 42501|ERR 42501',
  (pg_temp.as_user(pg_temp.f('cl'), 'select public.export_my_data()::text') || '|' || pg_temp.as_user(pg_temp.f('co'), 'select public.export_my_data()::text') || '|'
   || pg_temp.as_user(pg_temp.f('ad'), 'select public.export_my_data()::text') || '|' || pg_temp.as_anon('select public.export_my_data()::text')));

-- the admin approves and fulfils
do $$ begin
  perform set_config('request.jwt.claim.sub', pg_temp.f('ad')::text, true);
  update public.data_export_requests set status = 'under_review', reviewed_by = pg_temp.f('ad'), reviewed_at = now() where id = pg_temp.f('req');
  update public.data_export_requests set status = 'fulfilled', fulfilled_by = pg_temp.f('ad'), fulfilled_at = now() where id = pg_temp.f('req');
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
select pg_temp.ck('real', 'E4 after approval the patient downloads their own export, with their own rows', 'true',
  (pg_temp.as_user(pg_temp.f('p'), 'select jsonb_array_length(public.export_my_data() -> ''tables'' -> ''patient_serology_status'')')::integer = 1)::text);
select pg_temp.ck('real', 'E5 ...and only their own: the export names this patient and holds no row of another', 'true',
  (pg_temp.as_user(pg_temp.f('p'), format('select (public.export_my_data() ->> ''patient'') = %L and not ((public.export_my_data())::text like %L)', pg_temp.f('p')::text, '%' || pg_temp.f('q')::text || '%'))::text));
select pg_temp.ck('real', 'E6 every download is audited with the request it used', 'true',
  (select (count(*) >= 1)::text from public.audit_log where action = 'patient_data_export_download' and entity_id = pg_temp.f('p') and event ->> 'request_id' = pg_temp.f('req')::text));
select pg_temp.ck('real', 'E7 an approval for one patient opens nothing for another', 'ERR 42501', pg_temp.as_user(pg_temp.f('n'), 'select public.export_my_data()::text'));
select pg_temp.ck('real', 'E8 the admin function still works and shares the body', 'true',
  (pg_temp.as_user(pg_temp.f('ad'), format('select (public.export_patient_data(%L) -> ''tables'' -> ''patient_serology_status'') is not null', pg_temp.f('q')))::text));
select pg_temp.ck('real', 'E9 the export carries no credential keys', 'false', (pg_temp.as_user(pg_temp.f('p'), 'select (public.export_my_data())::text ~* ''"(token|secret|password|api_key)"''')::text));
-- an old approval expires
alter table public.data_export_requests disable trigger user;
update public.data_export_requests set fulfilled_at = now() - interval '40 days' where id = pg_temp.f('req');
alter table public.data_export_requests enable trigger user;
select pg_temp.ck('real', 'E10 an approval older than the review period no longer opens the download', 'ERR 42501', pg_temp.as_user(pg_temp.f('p'), 'select public.export_my_data()::text'));
-- denied
alter table public.data_export_requests disable trigger user;
update public.data_export_requests set fulfilled_at = now(), status = 'denied', decision_note = 'test denial' where id = pg_temp.f('req');
alter table public.data_export_requests enable trigger user;
select pg_temp.ck('real', 'E11 a denied request does not open it', 'ERR 42501', pg_temp.as_user(pg_temp.f('p'), 'select public.export_my_data()::text'));

-- class review
select pg_temp.ck('real', 'R1 every registry row is reviewed, with a date and a note', '0', (select count(*)::text from public.data_registry where not reviewed or reviewed_at is null or reviewed_note is null));
select pg_temp.ck('real', 'R2 the CMO''s corrections are applied', 'clinical_record|clinical_record|operational|audit|true|clinical_record',
  (select string_agg(x, '|' order by ord) from (values
    (1, (select retention_class from public.data_registry where table_name = 'sti_partner_notifications')),
    (2, (select retention_class from public.data_registry where table_name = 'risk_reassessment_queue')),
    (3, (select retention_class from public.data_registry where table_name = 'wellness_points_ledger')),
    (4, (select retention_class from public.data_registry where table_name = 'care_access_events')),
    (5, (select in_export::text from public.data_registry where table_name = 'care_access_events')),
    (6, (select retention_class from public.data_registry where table_name = 'wellbeing_checkins'))) v(ord, x)));
select pg_temp.ck('real', 'R3 the access log stays audit and unexported', 'audit|false', (select retention_class || '|' || in_export::text from public.data_registry where table_name = 'staff_record_opens'));

-- SABOTAGE: the approval check removed
do $$
declare v_def text; v_out text;
begin
  select pg_get_functiondef('public.export_my_data()'::regprocedure) into v_def;
  v_def := replace(v_def, 'if v_req is null then', 'if false then');
  execute v_def;
  v_out := pg_temp.as_user(pg_temp.f('n'), 'select public.export_my_data()::text');
  insert into results values ('sabotaged', 'SABOTAGE: without the approval check a patient with no request downloads', 'ERR 42501', case when v_out like 'ERR %' then v_out else 'downloaded' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S39f proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotage did not flip'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
