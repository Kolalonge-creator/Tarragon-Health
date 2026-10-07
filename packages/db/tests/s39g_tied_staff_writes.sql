-- S39g proof: staff WRITES on the tied tables need a tie or a logged opening (OQ-279; migration *_s39g_tied_staff_writes.sql).
-- One rolled-back transaction on patient_smoking_profiles (and the reproductive profile table). Proves: a clinician tied to the patient inserts, updates and deletes; an
-- untied clinician cannot insert, update or delete until they open the record (S39c), then can; the window never reaches the reproductive tables; a care coordinator,
-- an admin and another organisation's clinician cannot write even for a tied patient; the switch tied_staff_writes off gives back the old organisation-wide write;
-- every tied write policy was rewritten (no plain arm left) and patient arms were kept. SABOTAGE: staff_may_write always true; the untied insert must flip.
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
  values (v, 's39g-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S39g ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true;
  if p_role = 'clinician' then
    insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
    values (p_org, v, 'S39g ' || p_label, true, now(), 'medical_officer');
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

create function pg_temp.ins(p_uid uuid, p_org uuid, p_pat uuid) returns text language sql as
$$ select pg_temp.as_user(p_uid, format('insert into public.patient_smoking_profiles (organisation_id, patient_id) values (%L, %L) returning patient_id::text', p_org, p_pat)) $$;
create function pg_temp.upd(p_uid uuid, p_pat uuid) returns text language sql as
$$ select pg_temp.as_user(p_uid, format('with u as (update public.patient_smoking_profiles set organisation_id = organisation_id where patient_id = %L returning 1) select count(*)::text from u', p_pat)) $$;
create function pg_temp.del(p_uid uuid, p_pat uuid) returns text language sql as
$$ select pg_temp.as_user(p_uid, format('with u as (delete from public.patient_smoking_profiles where patient_id = %L returning 1) select count(*)::text from u', p_pat)) $$;

do $$
declare v_org uuid; v_org2 uuid; v_a uuid; v_b uuid; v_co uuid; v_ad uuid; v_ox uuid; v_pt uuid; v_pu uuid; i integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_org2 from public.organisations where id <> v_org order by created_at limit 1;
  if v_org2 is null then insert into public.organisations (name, type) values ('S39g second org', 'clinic') returning id into v_org2; end if;
  v_a := pg_temp.mkuser(v_org, 'tied clinician', 'clinician'); v_b := pg_temp.mkuser(v_org, 'untied clinician', 'clinician'); v_co := pg_temp.mkuser(v_org, 'coordinator', 'care_coordinator');
  v_ad := pg_temp.mkuser(v_org, 'admin', 'admin'); v_ox := pg_temp.mkuser(v_org2, 'other org clinician', 'clinician');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('a', v_a); perform pg_temp.setf('b', v_b); perform pg_temp.setf('co', v_co); perform pg_temp.setf('ad', v_ad); perform pg_temp.setf('ox', v_ox);
  -- tied patients (care team: a), untied patients (care team: someone else = the coordinator row has no clinician; use a second clinician as owner)
  for i in 1..8 loop
    v_pt := pg_temp.mkuser(v_org, 'tied patient ' || i, 'patient');
    insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at) values (v_org, v_pt, v_a, v_co, now());
    perform pg_temp.setf('t' || i, v_pt);
  end loop;
  v_pu := pg_temp.mkuser(v_org, 'owner clinician', 'clinician');
  for i in 1..8 loop
    v_pt := pg_temp.mkuser(v_org, 'untied patient ' || i, 'patient');
    insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at) values (v_org, v_pt, v_pu, v_co, now());
    perform pg_temp.setf('u' || i, v_pt);
  end loop;
  -- rows to update and delete
  insert into public.patient_smoking_profiles (organisation_id, patient_id)
    select v_org, pg_temp.f(x) from unnest(array['t2', 't3', 'u2', 'u3', 'u4', 'u5']) x;
end $$;

-- the tied clinician
select pg_temp.ck('real', 'W1 a tied clinician inserts for a tied patient', 'true', (pg_temp.ins(pg_temp.f('a'), pg_temp.f('org'), pg_temp.f('t1')) !~ '^ERR')::text);
select pg_temp.ck('real', 'W2 ...updates a tied patient''s row', '1', pg_temp.upd(pg_temp.f('a'), pg_temp.f('t2')));
select pg_temp.ck('real', 'W3 ...and deletes it', '1', pg_temp.del(pg_temp.f('a'), pg_temp.f('t3')));
-- the untied clinician, before opening
select pg_temp.ck('real', 'W4 an untied clinician cannot insert for a patient they are not tied to', 'ERR 42501', pg_temp.ins(pg_temp.f('b'), pg_temp.f('org'), pg_temp.f('u1')));
select pg_temp.ck('real', 'W5 ...cannot update their row', '0', pg_temp.upd(pg_temp.f('b'), pg_temp.f('u2')));
select pg_temp.ck('real', 'W6 ...cannot delete their row', '0', pg_temp.del(pg_temp.f('b'), pg_temp.f('u3')));
-- after opening
select pg_temp.ck('real', 'W7 opening the record (S39c) opens the write too: insert', 'true',
  ((select pg_temp.as_user(pg_temp.f('b'), format('select public.open_patient_record(%L)::text', pg_temp.f('u1')))) is not null and pg_temp.ins(pg_temp.f('b'), pg_temp.f('org'), pg_temp.f('u1')) !~ '^ERR')::text);
select pg_temp.ck('real', 'W8 ...update', '1', (select case when pg_temp.as_user(pg_temp.f('b'), format('select public.open_patient_record(%L)::text', pg_temp.f('u4'))) is not null then pg_temp.upd(pg_temp.f('b'), pg_temp.f('u4')) end));
select pg_temp.ck('real', 'W9 ...delete', '1', (select case when pg_temp.as_user(pg_temp.f('b'), format('select public.open_patient_record(%L)::text', pg_temp.f('u5'))) is not null then pg_temp.del(pg_temp.f('b'), pg_temp.f('u5')) end));
select pg_temp.ck('real', 'W10 an opening for one patient does not open another''s write', 'ERR 42501', pg_temp.ins(pg_temp.f('b'), pg_temp.f('org'), pg_temp.f('u6')));
-- other roles, even for a tied patient
select pg_temp.ck('real', 'W11 a care coordinator cannot write a clinical table even for their own patient', 'ERR 42501', pg_temp.ins(pg_temp.f('co'), pg_temp.f('org'), pg_temp.f('t4')));
select pg_temp.ck('real', 'W12 an admin cannot write a clinical table', 'ERR 42501', pg_temp.ins(pg_temp.f('ad'), pg_temp.f('org'), pg_temp.f('t5')));
select pg_temp.ck('real', 'W13 another organisation''s clinician cannot', 'ERR 42501', pg_temp.ins(pg_temp.f('ox'), pg_temp.f('org'), pg_temp.f('t6')));
select pg_temp.ck('real', 'W14 anon cannot', 'ERR 42501', pg_temp.as_anon(format('insert into public.patient_smoking_profiles (organisation_id, patient_id) values (%L, %L) returning patient_id::text', pg_temp.f('org'), pg_temp.f('t7'))));
-- reproductive
select pg_temp.ck('real', 'W15 an opening never opens a reproductive table for writing', 'ERR 42501',
  (select case when pg_temp.as_user(pg_temp.f('b'), format('select public.open_patient_record(%L)::text', pg_temp.f('u7'))) is not null
     then pg_temp.as_user(pg_temp.f('b'), format('insert into public.reproductive_health_profiles (organisation_id, patient_id) values (%L, %L) returning patient_id::text', pg_temp.f('org'), pg_temp.f('u7'))) end));
-- structure
select pg_temp.ck('real', 'S1 no tied table keeps the plain organisation-wide staff arm on a write policy', '0',
  (select count(*)::text from pg_policies pp join public.staff_read_scope s on s.table_name = pp.tablename and s.mode = 'tied'
    where pp.schemaname = 'public' and pp.cmd in ('INSERT', 'UPDATE', 'DELETE') and (coalesce(pp.qual, '') like '%private.is_org_staff(organisation_id)%' or coalesce(pp.with_check, '') like '%private.is_org_staff(organisation_id)%')));
select pg_temp.ck('real', 'S2 more than 150 write policies now use staff_may_write, and the patient arm is kept where there was one', 'true',
  ((select count(*) from pg_policies where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE') and (qual like '%staff_may_write%' or with_check like '%staff_may_write%')) > 150
   and (select count(*) from pg_policies where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE') and (qual like '%staff_may_write%' or with_check like '%staff_may_write%') and (qual like '%auth.uid()%' or with_check like '%auth.uid()%')) > 10)::text);
select pg_temp.ck('real', 'S3 the old policy text is saved for rollback', 'true', ((select count(*) from public.staff_read_policy_backup where cmd in ('INSERT', 'UPDATE', 'DELETE')) > 150)::text);
-- switch off (reads too, so the inserted row can be returned under the old organisation-wide rule)
update public.platform_modules set is_enabled = false where key in ('tied_staff_writes', 'tied_staff_reads');
select pg_temp.ck('real', 'SW the switches off give back the old organisation-wide write (a coordinator inserts again)', 'true', (pg_temp.ins(pg_temp.f('co'), pg_temp.f('org'), pg_temp.f('t8')) !~ '^ERR')::text);
update public.platform_modules set is_enabled = true where key in ('tied_staff_writes', 'tied_staff_reads');

-- SABOTAGE
do $$
declare v_def text; v_out text;
begin
  select pg_get_functiondef('private.staff_may_write(uuid, uuid, public.care_access_category)'::regprocedure) into v_def;
  v_def := replace(v_def, 'select case', 'select true or case');
  execute v_def;
  update public.platform_modules set is_enabled = false where key = 'tied_staff_reads';  -- so the returned row is readable and the write itself decides
  v_out := pg_temp.ins(pg_temp.f('b'), pg_temp.f('org'), pg_temp.f('u8'));
  insert into results values ('sabotaged', 'SABOTAGE: a staff_may_write that always passes lets an untied clinician write', 'ERR 42501', case when v_out like 'ERR %' then v_out else 'written' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S39g proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotage did not flip'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
