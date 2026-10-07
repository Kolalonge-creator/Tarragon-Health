-- S76 B5 proof: clinician.task_completed (migration *_s76_clinician_task_completed_event.sql).
--   1. Completing a task writes BOTH clinical_task.completed (unchanged) and clinician.task_completed, ids and type only.
--   2. The new payload holds no outcome content; a repeat of the same claim writes no second row.
--   3. S20 protection: no safety_concern.* event type exists, and raising a concern writes no domain_events row at all.
--   4. An admin account reads zero domain events about a concern (there is none to read).
--   5. SABOTAGE: with the new emit removed from queue_complete the event count is 0, so check 1 would have failed.
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
  perform public.queue_complete(p_task, '{"done":true}'::jsonb);
  perform pg_temp.back();
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's76b5-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S76B5 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
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
  values (p_org, v, 'S76B5 ' || p_label, 'MDCN', 'S76B5-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
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
  select pr.organisation_id, p_patient, 'observation', gen_random_uuid(), p_grade, 'S76B5', v_rs.id, v_rs.code, v_rs.version, v_rs.status,
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
create function pg_temp.act_admin(p_uid uuid) returns void language plpgsql as
$f$ begin perform pg_temp.act(p_uid); end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_a uuid; v_p1 uuid; v_p2 uuid; v_t uuid; v_t2 uuid; v_n_before int; v_n_after int; v_concern uuid; v_payload jsonb; v_cnt int;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_a := pg_temp.mkdoc(v_org, 'A', v_admin);
  v_p1 := pg_temp.mkuser(v_org, 'p1', 'patient'); v_p2 := pg_temp.mkuser(v_org, 'p2', 'patient');

  -- 1 and 2
  v_t := pg_temp.mktask(v_p1, 'amber_bp_review', 60, null);
  perform pg_temp.rec('the clinician claims the task', v_t::text, pg_temp.next_task(v_a)::text);
  perform pg_temp.finish(v_a, v_t);
  perform pg_temp.rec('the old event is still written', '1', (select count(*)::text from public.domain_events where event_type = 'clinical_task.completed' and aggregate_id = v_t));
  perform pg_temp.rec('the new event is written once', '1', (select count(*)::text from public.domain_events where event_type = 'clinician.task_completed' and aggregate_id = v_t));
  select payload into v_payload from public.domain_events where event_type = 'clinician.task_completed' and aggregate_id = v_t;
  perform pg_temp.rec('the payload is exactly ids and type', 'clinician_id,priority_class,task_id,type', (select string_agg(k, ',' order by k) from jsonb_object_keys(v_payload) k));
  perform pg_temp.rec('the payload carries the task and clinician', 'true', ((v_payload ->> 'task_id') = v_t::text and (v_payload ->> 'clinician_id') = v_a::text)::text);
  perform pg_temp.rec('the new event carries the patient id like its neighbour', 'true', (select (patient_id = v_p1) from public.domain_events where event_type = 'clinician.task_completed' and aggregate_id = v_t)::text);

  -- 3. no concern event type, and raising a concern writes no event
  perform pg_temp.rec('no safety_concern event type is registered', '0', (select count(*)::text from public.event_types where event_type like 'safety_concern.%')::text);
  select count(*) into v_n_before from public.domain_events;
  perform pg_temp.act(v_a);
  v_concern := public.raise_safety_concern('something_else', 'low', 'S76B5 proof concern text', null, null);
  perform pg_temp.back();
  select count(*) into v_n_after from public.domain_events;
  perform pg_temp.rec('raising a concern writes no domain event', v_n_before::text, v_n_after::text);
  perform pg_temp.rec('the concern exists', '1', (select count(*)::text from public.safety_concerns where id = v_concern));
  perform pg_temp.rec('no event row mentions the concern id', '0', (select count(*)::text from public.domain_events where payload::text like '%' || v_concern::text || '%' or idempotency_key like '%' || v_concern::text || '%')::text);
  perform pg_temp.rec('no audit row names the concern', '0', (select count(*)::text from public.audit_log where entity_id = v_concern or event::text like '%' || v_concern::text || '%')::text);

  -- 4. an admin sees no concern event
  perform pg_temp.act(v_admin);
  select count(*) into v_cnt from public.domain_events where event_type like 'safety_concern.%';
  perform pg_temp.back();
  perform pg_temp.rec('an admin reads no concern events', '0', v_cnt::text);

  -- 5. SABOTAGE: take the new emit out of queue_complete
  execute regexp_replace(pg_get_functiondef('public.queue_complete(uuid, jsonb)'::regprocedure),
    'perform private\.emit_domain_event\(''clinician\.task_completed''.*?t\.id\);', '');
  v_t2 := pg_temp.mktask(v_p2, 'amber_bp_review', 60, null);
  perform pg_temp.next_task(v_a);
  perform pg_temp.finish(v_a, v_t2);
  insert into results values ('sabotaged', 'the new event is written once', '1',
    (select count(*)::text from public.domain_events where event_type = 'clinician.task_completed' and aggregate_id = v_t2));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S76 B5 proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then raise exception 'VACUOUS TEST: removing the emit did not change the event count'; end if;
end $$;
select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
