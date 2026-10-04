-- S07 proof (OQ-73 option a): public.my_home_bp_target() returns the home blood
-- pressure target the SERVER uses for the signed-in patient, and only hers.
--
-- Proves in one rolled-back transaction:
--   1. An explicit care team target (clinician recorded) comes back as 'explicit', with its date.
--   2. An explicit row whose set_by was cleared is still the target the server uses, but is
--      labelled 'explicit_unattributed', with no date.
--   3. With no row, the standard starting target 135/85 ('derived_standard').
--   4. With no row and an active diabetes care plan, 130/80 ('derived_high_risk').
--   5. ISOLATION: a patient with no row never receives another patient's explicit target
--      (the function has no argument, so it cannot be pointed at someone else).
--   6. Exactly one row is returned each time; a session with no user id returns none.
--   7. CONTROL: a staff account gets its own derived target, never a patient's.
--   8. anon cannot execute it (42501).
--   9. SABOTAGE: with the function replaced by one that ignores the caller and returns the first
--      target in the table, check 5 must flip to FAIL, proving it discriminates.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;

create or replace function pg_temp.run_checks(p_phase text) returns void
language plpgsql as $f$
declare
  v_org uuid;
  v_p1 uuid := gen_random_uuid();
  v_p2 uuid := gen_random_uuid();
  v_p3 uuid := gen_random_uuid();
  v_p4 uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_cs uuid;
  v_rec record;
  v_n integer;
  v_failed boolean;
  v_sqlstate text;
  v_res jsonb := '[]'::jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'S07 target proof needs one organisation (seed fixture missing)'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 's07-tgt-' || u || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_p1, v_p2, v_p3, v_p4, v_staff]) u;
  insert into public.profiles (id, organisation_id, role, full_name) values
    (v_p1,    v_org, 'patient',   'S07 Target One'),
    (v_p2,    v_org, 'patient',   'S07 Target Two'),
    (v_p3,    v_org, 'patient',   'S07 Target Three'),
    (v_p4,    v_org, 'patient',   'S07 Target Four'),
    (v_staff, v_org, 'clinician', 'S07 Target Staff')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier,
                                     indemnity_insurer, indemnity_policy_number, indemnity_expires_at)
    values (v_org, v_staff, 'S07 Target Staff', true, now(), 'senior_medical_officer', 'Probe Indemnity', 'S07-1', now() + interval '1 year')
    returning id into v_cs;

  -- p1: explicit, attributed. p2: explicit, set_by cleared. p3: nothing. p4: nothing but an active diabetes plan.
  insert into public.patient_bp_targets (organisation_id, patient_id, home_systolic, home_diastolic, office_systolic, office_diastolic, set_by)
    values (v_org, v_p1, 125, 78, 140, 90, v_cs);
  insert into public.patient_bp_targets (organisation_id, patient_id, home_systolic, home_diastolic, office_systolic, office_diastolic, set_by)
    values (v_org, v_p2, 128, 79, 140, 90, null);
  insert into public.care_plans (organisation_id, patient_id, condition, status) values (v_org, v_p4, 'diabetes', 'active');

  -- 1 and 6. p1
  perform set_config('request.jwt.claims', json_build_object('sub', v_p1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.my_home_bp_target();
  v_res := v_res || jsonb_build_array(jsonb_build_array('exactly one row is returned', '1', v_n::text));
  select * into v_rec from public.my_home_bp_target();
  v_res := v_res || jsonb_build_array(jsonb_build_array('explicit target numbers', '125/78', v_rec.systolic || '/' || v_rec.diastolic));
  v_res := v_res || jsonb_build_array(jsonb_build_array('explicit source', 'explicit', coalesce(v_rec.source, 'null')));
  v_res := v_res || jsonb_build_array(jsonb_build_array('explicit target carries its date', 'true', (v_rec.set_at is not null)::text));
  execute 'reset role';

  -- 2. p2
  perform set_config('request.jwt.claims', json_build_object('sub', v_p2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into v_rec from public.my_home_bp_target();
  v_res := v_res || jsonb_build_array(jsonb_build_array('unattributed row is still the target the server uses', '128/79', v_rec.systolic || '/' || v_rec.diastolic));
  v_res := v_res || jsonb_build_array(jsonb_build_array('unattributed row is labelled as such, with no date', 'explicit_unattributed:true',
    coalesce(v_rec.source, 'null') || ':' || (v_rec.set_at is null)::text));
  execute 'reset role';

  -- 3 and 5. p3 (no row) while other patients DO have explicit rows
  perform set_config('request.jwt.claims', json_build_object('sub', v_p3, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into v_rec from public.my_home_bp_target();
  v_res := v_res || jsonb_build_array(jsonb_build_array('standard starting target when there is no row', '135/85:derived_standard',
    v_rec.systolic || '/' || v_rec.diastolic || ':' || coalesce(v_rec.source, 'null')));
  v_res := v_res || jsonb_build_array(jsonb_build_array('never receives another patient''s explicit target', 'false',
    (v_rec.source in ('explicit', 'explicit_unattributed'))::text));
  execute 'reset role';

  -- 4. p4
  perform set_config('request.jwt.claims', json_build_object('sub', v_p4, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into v_rec from public.my_home_bp_target();
  v_res := v_res || jsonb_build_array(jsonb_build_array('higher-risk starting target with an active diabetes plan', '130/80:derived_high_risk',
    v_rec.systolic || '/' || v_rec.diastolic || ':' || coalesce(v_rec.source, 'null')));
  execute 'reset role';

  -- 7. staff
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into v_rec from public.my_home_bp_target();
  v_res := v_res || jsonb_build_array(jsonb_build_array('control: staff get their own derived target, never a patient''s', 'derived_standard', coalesce(v_rec.source, 'null')));
  execute 'reset role';

  -- 6. no user id
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.my_home_bp_target();
  v_res := v_res || jsonb_build_array(jsonb_build_array('a session with no user id gets no row', '0', v_n::text));
  execute 'reset role';

  -- 8. anon
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  v_failed := false; v_sqlstate := null;
  begin
    perform 1 from public.my_home_bp_target();
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  execute 'reset role';
  v_res := v_res || jsonb_build_array(jsonb_build_array('anon cannot execute it', 'true:42501', v_failed::text || ':' || coalesce(v_sqlstate, 'none')));

  -- results are written with the session role reset, because a switched role cannot write the temp table
  insert into results select p_phase, e->>0, e->>1, e->>2 from jsonb_array_elements(v_res) e;
end
$f$;

select pg_temp.run_checks('real');

-- Sabotage: ignore the caller and return the first target in the table.
create or replace function public.my_home_bp_target()
returns table (systolic smallint, diastolic smallint, source text, set_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select b.home_systolic, b.home_diastolic, 'explicit'::text, b.updated_at
  from public.patient_bp_targets b order by b.created_at limit 1;
$$;
select pg_temp.run_checks('sabotaged');

do $$
declare v_bad integer; v_caught text;
begin
  select count(*) into v_bad from results where phase = 'real' and expected <> actual;
  if v_bad > 0 then
    raise exception 'S07 my_home_bp_target proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => ' || actual, '; ') from results where phase = 'real' and expected <> actual);
  end if;
  select string_agg(check_name, '; ') into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught is null then
    raise exception 'VACUOUS TEST: the caller-ignoring function did not fail any check';
  end if;
  if v_caught not like '%never receives another patient''s explicit target%' then
    raise exception 'sabotage did not flip the isolation check; flipped: %', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
