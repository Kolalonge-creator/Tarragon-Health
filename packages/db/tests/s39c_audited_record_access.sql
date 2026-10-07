-- S39c proof: audited record access (founder direction 2026-10-07, OQ-278; migration *_s39c_audited_record_access.sql).
-- One rolled-back transaction. Proves: an untied clinician reads nothing about a patient until they open the record, then reads it (HIV status
-- table as the example), and every opening writes one log row; a second opening in the window writes none; a tied clinician is logged with
-- basis tied; a care coordinator, an admin, a patient, another organisation's clinician and anon cannot open; reproductive_health never opens
-- through this path; the window expires; the log cannot be updated, deleted or truncated and is unreadable to ordinary clinicians;
-- the review report is refused to a clinician and open to an admin; many untied openings in an hour raise ONE incident and never an error;
-- the active security config carries the window, the alert limit and the retention periods, with no auto-delete of real data.
-- SABOTAGE: staff_has_open made to always return true (an untied clinician reads without any opening), and open_patient_record with its log insert removed.
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
declare v_org uuid; v_org2 uuid; v_pat uuid; v_c1 uuid; v_c2 uuid; v_c3 uuid; v_co uuid; v_ad uuid; v_ox uuid; v_pat2 uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_org2 from public.organisations where id <> v_org order by created_at limit 1;
  if v_org2 is null then insert into public.organisations (name, type) values ('S39c second org', 'clinic') returning id into v_org2; end if;
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient'); v_pat2 := pg_temp.mkuser(v_org, 'patient two', 'patient');
  v_c1 := pg_temp.mkuser(v_org, 'untied clinician', 'clinician');
  v_c2 := pg_temp.mkuser(v_org, 'tied clinician', 'clinician');
  v_c3 := pg_temp.mkuser(v_org, 'bulk clinician', 'clinician');
  v_co := pg_temp.mkuser(v_org, 'coordinator', 'care_coordinator');
  v_ad := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_ox := pg_temp.mkuser(v_org2, 'other org clinician', 'clinician');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at) values (v_org, v_pat2, v_c2, v_co, now())
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id, care_coordinator_id = excluded.care_coordinator_id, clinical_director_id = null;
  insert into public.patient_serology_status (organisation_id, patient_id) values (v_org, v_pat);
  insert into public.patient_serology_status (organisation_id, patient_id) values (v_org, v_pat2);
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('pat2', v_pat2); perform pg_temp.setf('c1', v_c1); perform pg_temp.setf('c2', v_c2);
  perform pg_temp.setf('c3', v_c3); perform pg_temp.setf('co', v_co); perform pg_temp.setf('ad', v_ad); perform pg_temp.setf('ox', v_ox);
end $$;

-- A. before opening: nothing --------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'A1 an untied clinician reads nothing of the patient before opening', '0',
  pg_temp.as_user(pg_temp.f('c1'), format('select count(*) from public.patient_serology_status where patient_id = %L', pg_temp.f('pat'))));
-- B. open ------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'B1 opening works for an untied clinician, basis open', 'open',
  pg_temp.as_user(pg_temp.f('c1'), format('select (public.open_patient_record(%L)) ->> ''basis''', pg_temp.f('pat'))));
select pg_temp.ck('real', 'B2 after opening the clinician reads the record', '1',
  pg_temp.as_user(pg_temp.f('c1'), format('select count(*) from public.patient_serology_status where patient_id = %L', pg_temp.f('pat'))));
select pg_temp.ck('real', 'B3 ...and only that patient (another patient stays closed)', '0',
  pg_temp.as_user(pg_temp.f('c1'), format('select count(*) from public.patient_serology_status where patient_id = %L', pg_temp.f('pat2'))));
select pg_temp.ck('real', 'B4 one log row for the opening', '1',
  (select count(*)::text from public.staff_record_opens where staff_id = pg_temp.f('c1') and patient_id = pg_temp.f('pat') and basis = 'open'));
select pg_temp.ck('real', 'B5 a second opening inside the window is the same visit: no new row', '1',
  (pg_temp.as_user(pg_temp.f('c1'), format('select (public.open_patient_record(%L)) ->> ''new''', pg_temp.f('pat'))) = 'false'
   and (select count(*) from public.staff_record_opens where staff_id = pg_temp.f('c1') and patient_id = pg_temp.f('pat')) = 1)::integer::text);
select pg_temp.ck('real', 'B6 the generic audit log also holds the opening', '1',
  (select count(*)::text from public.audit_log where actor_id = pg_temp.f('c1') and action = 'record_open' and entity_id = pg_temp.f('pat')));
-- C. tied ----------------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'C1 a tied clinician is logged with basis tied', 'tied',
  pg_temp.as_user(pg_temp.f('c2'), format('select (public.open_patient_record(%L)) ->> ''basis''', pg_temp.f('pat2'))));
-- D. who cannot open ---------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'D1 a care coordinator cannot open', 'ERR 42501', pg_temp.as_user(pg_temp.f('co'), format('select public.open_patient_record(%L)::text', pg_temp.f('pat'))));
select pg_temp.ck('real', 'D2 an admin cannot open', 'ERR 42501', pg_temp.as_user(pg_temp.f('ad'), format('select public.open_patient_record(%L)::text', pg_temp.f('pat'))));
select pg_temp.ck('real', 'D3 a patient cannot open', 'ERR 42501', pg_temp.as_user(pg_temp.f('pat'), format('select public.open_patient_record(%L)::text', pg_temp.f('pat2'))));
select pg_temp.ck('real', 'D4 another organisation''s clinician cannot open this patient', 'ERR P0002', pg_temp.as_user(pg_temp.f('ox'), format('select public.open_patient_record(%L)::text', pg_temp.f('pat'))));
select pg_temp.ck('real', 'D5 anon cannot call it', 'ERR 42501', pg_temp.as_anon(format('select public.open_patient_record(%L)::text', pg_temp.f('pat'))));
select pg_temp.ck('real', 'D6 a coordinator, an admin and another organisation read nothing of the opened patient', '0',
  (pg_temp.as_user(pg_temp.f('co'), format('select count(*) from public.patient_serology_status where patient_id = %L', pg_temp.f('pat')))::integer
 + pg_temp.as_user(pg_temp.f('ad'), format('select count(*) from public.patient_serology_status where patient_id = %L', pg_temp.f('pat')))::integer
 + pg_temp.as_user(pg_temp.f('ox'), format('select count(*) from public.patient_serology_status where patient_id = %L', pg_temp.f('pat')))::integer)::text);
-- D7: a window never reaches reproductive_health
do $$ begin
  begin insert into public.reproductive_health_profiles (organisation_id, patient_id) values (pg_temp.f('org'), pg_temp.f('pat')); exception when others then raise notice 'fixture reproductive row skipped: %', sqlerrm; end;
end $$;
select pg_temp.ck('real', 'D7 an open window never reaches the reproductive tables', '0',
  pg_temp.as_user(pg_temp.f('c1'), format('select count(*) from public.reproductive_health_profiles where patient_id = %L', pg_temp.f('pat'))));
-- E. window expiry ----------------------------------------------------------------------------------------------------------------------------
alter table public.staff_record_opens disable trigger staff_record_opens_no_change;
update public.staff_record_opens set expires_at = now() - interval '1 minute' where staff_id = pg_temp.f('c1');
alter table public.staff_record_opens enable trigger staff_record_opens_no_change;
select pg_temp.ck('real', 'E1 an expired window closes the record again', '0',
  pg_temp.as_user(pg_temp.f('c1'), format('select count(*) from public.patient_serology_status where patient_id = %L', pg_temp.f('pat'))));
select pg_temp.ck('real', 'E2 opening again after expiry is a new visit', 'true',
  (pg_temp.as_user(pg_temp.f('c1'), format('select (public.open_patient_record(%L)) ->> ''new''', pg_temp.f('pat'))) = 'true')::text);
select pg_temp.ck('real', 'E3 ...and the log now holds two rows for that pair', '2',
  (select count(*)::text from public.staff_record_opens where staff_id = pg_temp.f('c1') and patient_id = pg_temp.f('pat')));
-- F. the log is append-only and private --------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'F1 a clinician cannot update the log', 'ERR 42501', pg_temp.as_user(pg_temp.f('c1'), 'update public.staff_record_opens set basis = ''tied'' returning id::text'));
select pg_temp.ck('real', 'F2 a clinician cannot delete from the log', 'ERR 42501', pg_temp.as_user(pg_temp.f('c1'), 'delete from public.staff_record_opens returning id::text'));
select pg_temp.ck('real', 'F3 not even the owner can update a row (trigger)', 'blocked', case when pg_temp.try_sql('update public.staff_record_opens set basis = basis') like '%append-only%' then 'blocked' else 'open' end);
select pg_temp.ck('real', 'F4 ...or delete one', 'blocked', case when pg_temp.try_sql('delete from public.staff_record_opens') like '%append-only%' then 'blocked' else 'open' end);
select pg_temp.ck('real', 'F5 ...or truncate the table', 'blocked', case when pg_temp.try_sql('truncate public.staff_record_opens') like '%append-only%' then 'blocked' else 'open' end);
select pg_temp.ck('real', 'F6 an ordinary clinician sees none of the log', '0', pg_temp.as_user(pg_temp.f('c1'), 'select count(*) from public.staff_record_opens'));
select pg_temp.ck('real', 'F7 an admin reads the log', 'true', (pg_temp.as_user(pg_temp.f('ad'), 'select count(*) from public.staff_record_opens')::integer >= 3)::text);
select pg_temp.ck('real', 'F8 anon cannot read the log', 'ERR 42501', pg_temp.as_anon('select count(*) from public.staff_record_opens'));
-- G. review ------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'G1 a clinician is refused the review report', 'ERR 42501', pg_temp.as_user(pg_temp.f('c1'), 'select count(*) from public.access_review_report(7)'));
select pg_temp.ck('real', 'G2 an admin gets the report, with the untied clinician counted', 'true',
  (pg_temp.as_user(pg_temp.f('ad'), format('select untied_openings from public.access_review_report(7) where staff_id = %L', pg_temp.f('c1')))::integer >= 2)::text);
select pg_temp.ck('real', 'G3 anon cannot call the report', 'ERR 42501', pg_temp.as_anon('select count(*) from public.access_review_report(7)'));
-- H. the bulk alert -----------------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_c3 uuid := pg_temp.f('c3'); i integer; v_p uuid; v_failed boolean := false;
begin
  update public.security_config set config = jsonb_set(config, '{untied_open_alert_per_hour}', '3'::jsonb) where is_active;
  for i in 1..5 loop
    v_p := pg_temp.mkuser(v_org, 'bulk patient ' || i, 'patient');
    if pg_temp.as_user(v_c3, format('select (public.open_patient_record(%L)) ->> ''opened''', v_p)) is distinct from 'true' then v_failed := true; end if;
  end loop;
  perform pg_temp.ck('real', 'H1 five untied openings against a limit of three all still succeed', 'false', v_failed::text);
  perform pg_temp.ck('real', 'H2 exactly one security incident for that clinician', '1', (select count(*)::text from public.ops_incidents where external_reference = 'record-opens-' || v_c3 and category = 'security'));
end $$;
-- I. config -------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'I1 the active config is version 2 with the window, the limit and no auto-delete of real data', 'true',
  (select (version = 2 and config ? 'record_open_window_hours' and config ? 'untied_open_alert_per_hour' and (config -> 'retention' ->> 'real_data_auto_delete') = 'false'
           and (config -> 'retention' ->> 'adult_clinical_record_years_after_last_contact') = '8' and (config -> 'retention' ->> 'maternity_record_years') = '25')::text from public.security_config where is_active));

-- SABOTAGE ---------------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_p5 uuid := pg_temp.mkuser(pg_temp.f('org'), 'sabotage patient', 'patient'); v_def text; v_before integer; v_after integer;
begin
  insert into public.patient_serology_status (organisation_id, patient_id) values (pg_temp.f('org'), v_p5);
  perform pg_temp.ck('real', 'J0 an untied clinician cannot read an unopened patient', '0', pg_temp.as_user(pg_temp.f('c1'), format('select count(*) from public.patient_serology_status where patient_id = %L', v_p5)));
  select pg_get_functiondef('private.staff_has_open(uuid, public.care_access_category)'::regprocedure) into v_def;
  v_def := replace(v_def, 'select p_category is distinct from', 'select true or p_category is distinct from');
  execute v_def;
  insert into results values ('sabotaged', 'SABOTAGE 1: a window check that always passes lets an unopened patient be read', '0', pg_temp.as_user(pg_temp.f('c1'), format('select count(*) from public.patient_serology_status where patient_id = %L', v_p5)));
  select pg_get_functiondef('public.open_patient_record(uuid)'::regprocedure) into v_def;
  v_def := replace(v_def, E'insert into public.staff_record_opens (expires_at, staff_id, patient_id, organisation_id, basis, after_hours)\n  values (v_exp, v_me, p_patient, v_org, v_basis, v_after);', 'null;');
  execute v_def;
  select count(*) into v_before from public.staff_record_opens where staff_id = pg_temp.f('c1') and patient_id = v_p5;
  perform pg_temp.as_user(pg_temp.f('c1'), format('select (public.open_patient_record(%L)) ->> ''opened''', v_p5));
  select count(*) into v_after from public.staff_record_opens where staff_id = pg_temp.f('c1') and patient_id = v_p5;
  insert into results values ('sabotaged', 'SABOTAGE 2: an opening with its log insert removed adds a row', '1', (v_after - v_before)::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S39c proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
