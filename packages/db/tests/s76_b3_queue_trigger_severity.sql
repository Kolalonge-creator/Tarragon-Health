-- S76 B3 proof: the queue's second key, trigger severity (migration *_s76_queue_second_key_trigger_severity.sql).
--   1. A task created from a triage event takes severity red 3, amber 2, green 1; one with no triage event keeps 0.
--   2. Within one priority class the more severe trigger is claimed first even when its due time is later; severity 0 is last.
--   3. Claim atomicity is unchanged: one live claim, a retry returns the same claim; a second clinician gets nothing while it is held.
--   4. Priority class still beats severity (a class 2 task with severity 0 comes before a class 4 task with severity 3).
--   5. Risk is not consulted: queue_next does not reference any risk table or score.
--   6. SABOTAGE: with the severity key removed from the ordering, the severe task is no longer claimed first.
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
  values (v, 's76b3-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S76B3 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
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
  values (p_org, v, 'S76B3 ' || p_label, 'MDCN', 'S76B3-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
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
  select pr.organisation_id, p_patient, 'observation', gen_random_uuid(), p_grade, 'S76B3', v_rs.id, v_rs.code, v_rs.version, v_rs.status,
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

do $$
declare
  v_org uuid; v_admin uuid; v_a uuid; v_b uuid; v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid; v_p5 uuid;
  t_green uuid; t_amber uuid; t_red uuid; t_plain uuid; t_c2 uuid; r jsonb; v_def text; v_first uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;  -- only fixture clinicians may be picked or pushed to
  v_a := pg_temp.mkdoc(v_org, 'A', v_admin);
  v_b := pg_temp.mkdoc(v_org, 'B', v_admin);
  v_p1 := pg_temp.mkuser(v_org, 'p1', 'patient'); v_p2 := pg_temp.mkuser(v_org, 'p2', 'patient'); v_p3 := pg_temp.mkuser(v_org, 'p3', 'patient');
  v_p4 := pg_temp.mkuser(v_org, 'p4', 'patient'); v_p5 := pg_temp.mkuser(v_org, 'p5', 'patient');

  -- 1. severity set from the triage grade
  t_green := pg_temp.mktask(v_p1, 'amber_bp_review', 100, 'green');
  t_amber := pg_temp.mktask(v_p2, 'amber_bp_review', 300, 'amber');
  t_red := pg_temp.mktask(v_p3, 'amber_bp_review', 600, 'red');
  t_plain := pg_temp.mktask(v_p4, 'amber_bp_review', 50, null);
  perform pg_temp.rec('green is 1', '1', (select trigger_severity::text from public.clinical_tasks where id = t_green));
  perform pg_temp.rec('amber is 2', '2', (select trigger_severity::text from public.clinical_tasks where id = t_amber));
  perform pg_temp.rec('red is 3', '3', (select trigger_severity::text from public.clinical_tasks where id = t_red));
  perform pg_temp.rec('no triage event is 0', '0', (select trigger_severity::text from public.clinical_tasks where id = t_plain));

  -- 2 and 3. order within the class; one claim; retry; second clinician blocked while held
  perform pg_temp.rec('the most severe trigger is claimed first although due last', t_red::text, pg_temp.next_task(v_a)::text);
  r := pg_temp.next_as(v_a);
  perform pg_temp.rec('a retry returns the same claim', t_red::text || ',true', (r -> 'task' ->> 'id') || ',' || (r ->> 'already_claimed'));
  perform pg_temp.rec('exactly one live claim', '1', (select count(*)::text from public.task_claims where clinician_id = v_a and ended_at is null));
  perform pg_temp.rec('a second clinician does not get the held task', 'true', (pg_temp.next_task(v_b) is distinct from t_red)::text);
  perform pg_temp.finish(v_b, pg_temp.next_task(v_b));  -- B took the next one (amber) so the chain below continues deterministically
  perform pg_temp.finish(v_a, t_red);
  perform pg_temp.rec('then the amber trigger', 'true', (select state = 'completed' from public.clinical_tasks where id = t_amber)::text);
  perform pg_temp.rec('next is the green trigger', t_green::text, pg_temp.next_task(v_a)::text);
  perform pg_temp.finish(v_a, t_green);
  perform pg_temp.rec('severity 0 comes last even though due first', t_plain::text, pg_temp.next_task(v_a)::text);
  perform pg_temp.finish(v_a, t_plain);

  -- 4. class still beats severity
  t_amber := pg_temp.mktask(v_p2, 'amber_bp_review', 300, 'red');
  t_c2 := pg_temp.mktask(v_p5, 'critical_result_review', null, null);
  perform pg_temp.rec('a lower priority class beats a higher severity', t_c2::text, pg_temp.next_task(v_a)::text);
  perform pg_temp.finish(v_a, t_c2);
  perform pg_temp.finish(v_a, pg_temp.next_task(v_a));

  -- 5. risk is not consulted
  v_def := lower(pg_get_functiondef('public.queue_next(text[])'::regprocedure));
  perform pg_temp.rec('queue_next never mentions risk', 'false', (position('risk' in v_def) > 0)::text);

  -- 6. SABOTAGE
  t_green := pg_temp.mktask(v_p1, 'amber_bp_review', 100, 'green');
  t_red := pg_temp.mktask(v_p3, 'amber_bp_review', 600, 'red');
  execute replace(pg_get_functiondef('public.queue_next(text[])'::regprocedure), 'ct.trigger_severity desc, ', '');
  insert into results values ('sabotaged', 'the severe trigger is claimed first', t_red::text, pg_temp.next_task(v_a)::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S76 B3 proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then raise exception 'VACUOUS TEST: removing the severity key did not change the order'; end if;
end $$;
select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
