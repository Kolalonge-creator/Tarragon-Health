-- S76 B4 proof: task types by configuration (migration *_s76_create_task_type_proposal.sql).
--   1. Who may propose: admin and the CMO; a patient, an ordinary clinician and anon are refused.
--   2. Validation: existing code, bad code, class range, class 1 with a window, unknown competency, a triage key already answered.
--   3. The proposal is unconfirmed (needs_confirmation, no confirmed_at) and is audited; only the CMO confirms it, an admin cannot.
--   4. ACCEPTANCE (spec 23): a new type appears in the queue with its own priority class and is claimed through queue_next()
--      before a lower-class task, with no code change.
--   5. SABOTAGE: with the who-may-propose guard removed a patient can propose.
begin;
create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.next_as(p_uid uuid) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.queue_next(); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.next_task(p_uid uuid) returns uuid language sql as
$$ select (pg_temp.next_as(p_uid) -> 'task' ->> 'id')::uuid $$;
create function pg_temp.finish(p_uid uuid, p_task uuid) returns void language plpgsql as
$f$ begin
  perform pg_temp.act(p_uid);
  perform public.queue_complete(p_task, '{"code":"completed_action_taken"}'::jsonb);
  perform pg_temp.back();
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's76b4-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S76B4 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid; c text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S76B4 ' || p_label, 'MDCN', 'S76B4-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      'senior_medical_officer', 'contracted', 2, true, p_admin, true) returning id into s;
  foreach c in array array['hypertension', 'adult_general', 'result_review', 'prescribing', 'on_call'] loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, true);
  end loop;
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
    values (p_org, v, now() - interval '1 minute', now() + interval '2 hours', 'queue', true);
  return v;
end $f$;
create function pg_temp.mkevent(p_patient uuid, p_grade text) returns uuid language plpgsql as
$f$ declare v_rs record; v_id uuid;
begin
  select * into v_rs from public.triage_rule_sets order by (status = 'approved') desc, version desc limit 1;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code,
      rule_set_version, rule_set_status, actions, shadow, is_test, basis)
  select pr.organisation_id, p_patient, 'observation', gen_random_uuid(), p_grade, 'S76B4', v_rs.id, v_rs.code, v_rs.version, v_rs.status,
         case when p_grade = 'red' then '[{"kind":"page_on_call"}]'::jsonb else '[]'::jsonb end, v_rs.status <> 'approved', true, gen_random_uuid()::text
    from public.profiles pr where pr.id = p_patient returning id into v_id;
  return v_id;
end $f$;
create function pg_temp.mktask(p_patient uuid, p_type text, p_due integer, p_grade text) returns uuid language plpgsql as
$f$ declare v_ev uuid; v_ver integer;
begin
  if p_grade is null then return private.create_clinical_task(p_patient, p_type, p_due); end if;
  v_ev := pg_temp.mkevent(p_patient, p_grade);
  select rule_set_version into v_ver from public.triage_events where id = v_ev;
  return private.create_clinical_task(p_patient, p_type, p_due, null, v_ev, v_ver, null);
end $f$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.propose(p_uid uuid, p_args text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  r := pg_temp.try('select public.create_task_type_proposal(' || p_args || ')');
  perform pg_temp.back();
  return r;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_a uuid; v_pat uuid; v_pat2 uuid; v_pat3 uuid; v_id uuid; v_ev uuid;
  t_new uuid; t_amber uuid; v_claimed uuid; v_sab text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by,
      doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_cmo, 'S76B4 CMO', 'MDCN', 'S76B4-CMO', true, 'active', now(), v_admin, 'chief_medical_officer', 'contracted', 2, true, v_admin, true);
  v_a := pg_temp.mkdoc(v_org, 'A', v_admin);
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient'); v_pat2 := pg_temp.mkuser(v_org, 'pat2', 'patient'); v_pat3 := pg_temp.mkuser(v_org, 'pat3', 'patient');

  -- 1. who may propose
  perform pg_temp.rec('a patient cannot propose', '42501', pg_temp.propose(v_pat, quote_literal('zz_s76_patient') || ', 4::smallint, 60, ''senior_medical_officer''::public.doctor_tier'));
  perform pg_temp.rec('an ordinary clinician cannot propose', '42501', pg_temp.propose(v_a, quote_literal('zz_s76_clin') || ', 4::smallint, 60, ''senior_medical_officer''::public.doctor_tier'));
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot propose', '42501', pg_temp.try('select public.create_task_type_proposal(''zz_s76_anon'', 4::smallint, 60, ''senior_medical_officer''::public.doctor_tier)'));
  perform pg_temp.back();

  -- 2. validation (as the admin)
  perform pg_temp.rec('an existing code is refused', '22023', pg_temp.propose(v_admin, '''symptom_review'', 4::smallint, 60, ''senior_medical_officer''::public.doctor_tier'));
  perform pg_temp.rec('a bad code is refused', '22023', pg_temp.propose(v_admin, '''Bad Code'', 4::smallint, 60, ''senior_medical_officer''::public.doctor_tier'));
  perform pg_temp.rec('class 10 is refused', '22023', pg_temp.propose(v_admin, '''zz_s76_c10'', 10::smallint, 60, ''senior_medical_officer''::public.doctor_tier'));
  perform pg_temp.rec('class 1 with a window is refused', '22023', pg_temp.propose(v_admin, '''zz_s76_c1'', 1::smallint, 0, ''senior_medical_officer''::public.doctor_tier, ''{}''::text[], 30'));
  perform pg_temp.rec('an unknown competency is refused', '22023', pg_temp.propose(v_admin, '''zz_s76_comp'', 4::smallint, 60, ''senior_medical_officer''::public.doctor_tier, ''{no_such_skill}''::text[]'));
  perform pg_temp.rec('a triage key already answered is refused', '22023', pg_temp.propose(v_admin, '''zz_s76_key'', 4::smallint, 60, ''senior_medical_officer''::public.doctor_tier, ''{}''::text[], 0, 30, false, ''{bp_review}''::text[]'));

  -- 3. admin proposes; unconfirmed; audited; only the CMO confirms
  perform pg_temp.rec('an admin can propose', 'ok', pg_temp.propose(v_admin, '''zz_s76_new_type'', 3::smallint, 120, ''senior_medical_officer''::public.doctor_tier, ''{adult_general}''::text[], 0, 30, false, ''{}''::text[], ''S76B4 proof type'''));
  perform pg_temp.rec('the proposal is active and unconfirmed', 'true,true,true', (select is_active::text || ',' || needs_confirmation::text || ',' || (confirmed_at is null)::text from public.task_types where code = 'zz_s76_new_type'));
  perform pg_temp.rec('the proposal is audited', '1', (select count(*)::text from public.audit_log where action = 'task_type.proposed' and event ->> 'code' = 'zz_s76_new_type'));
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin cannot confirm', '42501', pg_temp.try('select public.confirm_task_type(''zz_s76_new_type'', ''x'')'));
  perform pg_temp.back();
  perform pg_temp.rec('the CMO can propose too', 'ok', pg_temp.propose(v_cmo, '''zz_s76_cmo_type'', 6::smallint, 600, ''senior_medical_officer''::public.doctor_tier'));

  -- 4. ACCEPTANCE: the new type is in the queue with its own class and claimable, ahead of a lower-class task, no code change
  t_amber := private.create_clinical_task(v_pat2, 'amber_bp_review', 60);
  t_new := private.create_clinical_task(v_pat, 'zz_s76_new_type', null);
  perform pg_temp.rec('the new task has the configured class', '3', (select priority_class::text from public.clinical_tasks where id = t_new));
  perform pg_temp.rec('the new task is waiting in the queue', 'true', (select state in ('open', 'offered_to_lead') from public.clinical_tasks where id = t_new)::text);
  perform pg_temp.rec('queue_next claims the new type first (class 3 before class 4)', t_new::text, pg_temp.next_task(v_a)::text);
  perform pg_temp.finish(v_a, t_new);
  perform pg_temp.rec('then the older type', t_amber::text, pg_temp.next_task(v_a)::text);
  perform pg_temp.finish(v_a, t_amber);
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('the CMO confirms it', 'ok', pg_temp.try('select public.confirm_task_type(''zz_s76_new_type'', ''S76B4 proof'')'));
  perform pg_temp.back();
  perform pg_temp.rec('the confirmation is recorded', 'true', (select (confirmed_at is not null and confirmed_by = v_cmo)::text from public.task_types where code = 'zz_s76_new_type'));

  -- 5. SABOTAGE: remove the who-may-propose guard; a patient can now propose
  execute replace(pg_get_functiondef('public.create_task_type_proposal(text, smallint, integer, public.doctor_tier, text[], integer, integer, boolean, text[], text)'::regprocedure),
    'if not private.can_credential_review() then', 'if false then');
  insert into results values ('sabotaged', 'a patient cannot propose', '42501',
    pg_temp.propose(v_pat, quote_literal('zz_s76_sab') || ', 4::smallint, 60, ''senior_medical_officer''::public.doctor_tier'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S76 B4 proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then raise exception 'VACUOUS TEST: removing the guard did not let a patient propose'; end if;
end $$;
select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
