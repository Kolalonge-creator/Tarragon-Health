-- S62 follow-up proof: sweep_pathway_scheduled_tests() honours the pathway go-live guard (migration *_s62_tests_sweep_rechecks_pathway_guard.sql).
--
-- One rolled-back transaction. A REAL patient is enrolled in diabetes while the guard is on (the only way a real patient can enrol), then:
--   1. guard off: the sweep adds no test_* milestone for that enrolment;
--   2. guard on: it does (so check 1 is not vacuous);
--   3. a TEST patient is open regardless of the guard, as for the review sweep.
--   4. SABOTAGE: with the guard clause removed from the function, check 1 flips.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act_service() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_test boolean) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's62g-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, 'patient', 'S62g ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  update public.profiles set is_test = p_test where id = v;
  return v;
end $f$;
create function pg_temp.enrol(p_patient uuid) returns uuid language plpgsql as
$f$ declare v_org uuid; v_id uuid;
begin
  select organisation_id into v_org from public.profiles where id = p_patient;
  insert into public.chronic_programme_enrolments (organisation_id, patient_id, programme_id, status, source)
  select v_org, p_patient, id, 'enrolled', 'staff' from public.chronic_condition_programmes where code = 'diabetes'
  returning id into v_id;
  return v_id;
end $f$;
-- go_live_guards changes only through set_go_live_guard() (a CMO act); this proof is rolled back, so it steps around that trigger.
create function pg_temp.guard(p_on boolean) returns void language plpgsql as
$f$ begin
  alter table public.go_live_guards disable trigger user;
  update public.go_live_guards set is_on = p_on, changed_at = case when p_on then now() end,
      changed_by = case when p_on then (select id from public.profiles limit 1) end, change_note = case when p_on then 'proof' end
   where key = 'pathway_diabetes_care';
  alter table public.go_live_guards enable trigger user;
end $f$;
create function pg_temp.sweep() returns integer language plpgsql as
$f$ declare v integer;
begin
  perform pg_temp.act_service();
  select public.sweep_pathway_scheduled_tests() into v;
  perform pg_temp.back();
  return v;
end $f$;
create function pg_temp.test_rows(p_enrol uuid) returns text language sql as
$$ select count(*)::text from public.pathway_milestones where enrolment_id = p_enrol and code like 'test\_%' $$;

do $$
declare
  v_org uuid; v_real uuid; v_test uuid; v_e_real uuid; v_e_test uuid; v_n integer;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_real := pg_temp.mkuser(v_org, 'real', false);
  v_test := pg_temp.mkuser(v_org, 'test', true);
  alter table public.chronic_condition_programmes disable trigger chronic_condition_programmes_protocol_gate;
  update public.chronic_condition_programmes set is_active = true where code = 'diabetes';
  alter table public.chronic_condition_programmes enable trigger chronic_condition_programmes_protocol_gate;

  perform pg_temp.guard(true);
  v_e_real := pg_temp.enrol(v_real);
  v_e_test := pg_temp.enrol(v_test);
  perform pg_temp.rec('both enrolments got a first cycle', '2', (select count(distinct enrolment_id)::text from public.pathway_milestones where enrolment_id in (v_e_real, v_e_test)));

  perform pg_temp.guard(false);
  v_n := pg_temp.sweep();
  perform pg_temp.rec('guard off: no test milestone for the real patient', '0', pg_temp.test_rows(v_e_real));
  perform pg_temp.rec('guard off: a test patient is still swept', 'true', (pg_temp.test_rows(v_e_test)::int > 0)::text);

  perform pg_temp.guard(true);
  v_n := pg_temp.sweep();
  perform pg_temp.rec('guard on: the real patient gets test milestones', 'true', (pg_temp.test_rows(v_e_real)::int > 0)::text);

  -- SABOTAGE: remove the guard clause from the function; with the guard off the real patient is swept again.
  execute replace(pg_get_functiondef('public.sweep_pathway_scheduled_tests()'::regprocedure),
    ' or not private.go_live_open_patient((private.pathway_def_for_programme(e.programme_id)).guard_key, e.patient_id)', '');
  delete from public.pathway_milestones where enrolment_id = v_e_real and code like 'test\_%';
  perform pg_temp.guard(false);
  v_n := pg_temp.sweep();
  insert into results values ('sabotaged', 'guard off: no test milestone for the real patient', '0', pg_temp.test_rows(v_e_real));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S62 tests sweep guard proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 1 then
    raise exception 'VACUOUS TEST: removing the guard clause did not change the guard-off check';
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;

rollback;
