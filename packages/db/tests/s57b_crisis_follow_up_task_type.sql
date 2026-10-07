-- Proof (S57b): the crisis route has its own task type, crisis_follow_up, and nothing the F1 route did is lost.
--   1. The type exists: class 1, due at once, no lead window, senior medical officer, on_call, creatable, awaiting the CMO (not confirmed by the build).
--   2. A crisis screen creates ONE open class 1 task of the NEW type (never the older red_event_unacknowledged), with no lead window, and tells the
--      clinician on call with the neutral notice (push, in-app, email; critical; empty payload): the old behaviour is kept.
--   3. A replay is idempotent; a second crisis merges into the live task; with the new type switched off the failure is loud (audit row, incident,
--      no handled marker) and the screen and emergency event survive; a replay after the fix completes it.
--   4. The side effect is real and deliberate: a triage rule set cannot be approved while crisis_follow_up awaits confirmation; the CMO's confirmation
--      (and nobody else's) clears it.
--   5. anon and authenticated cannot run the follow-up function.
--   SABOTAGE: the function is put back to the F1 text (creates red_event_unacknowledged); this proof must then fail on the task type.
-- Wrapped in BEGIN/ROLLBACK; fails loudly with raise exception.
begin;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'f1c-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'F1C ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'F1C ' || p_label, 'MDCN', 'F1C-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, true)
  returning id into v_staff;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, v_staff, 'on_call', p_admin, true);
  insert into public.on_call_readiness (clinician_id, checklist_version, organisation_id, items, is_test) values (v, private.readiness_version(), p_org, private.readiness_items(), true);
  return v;
end $f$;
create function pg_temp.screen(p_org uuid, p_patient uuid, p_crisis boolean) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band, crisis_flagged, item_responses)
  values (p_org, p_patient, 'phq9', case when p_crisis then 20 else 3 end, case when p_crisis then 'severe' else 'minimal' end, p_crisis, '{}')
  returning id into v;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_p uuid; v_b uuid; pt1 uuid; pt2 uuid; pt3 uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; v_task uuid; v_n integer; v_def text; v_set uuid; v_ok boolean;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_p := pg_temp.mkdoc(v_org, v_admin, 'primary', 'senior_medical_officer');
  v_b := pg_temp.mkdoc(v_org, v_admin, 'backup', 'senior_medical_officer');
  pt1 := pg_temp.mkuser(v_org, 'p1', 'patient'); pt2 := pg_temp.mkuser(v_org, 'p2', 'patient'); pt3 := pg_temp.mkuser(v_org, 'p3', 'patient');

  -- 1. the type
  if not exists (select 1 from public.task_types where code = 'crisis_follow_up' and is_active and priority_class = 1 and default_due_minutes = 0
      and lead_window_minutes = 0 and min_doctor_tier = 'senior_medical_officer' and required_competencies = '{on_call}' and creatable and not pushable
      and needs_confirmation and confirmed_at is null and confirmed_by is null) then
    raise exception 'FAIL 1: crisis_follow_up is missing, mis-shaped, or confirmed by the build';
  end if;
  if (select (priority_class, min_doctor_tier::text, required_competencies, default_due_minutes) from public.task_types where code = 'crisis_follow_up')
     is distinct from (select (priority_class, min_doctor_tier::text, required_competencies, default_due_minutes) from public.task_types where code = 'red_event_unacknowledged') then
    raise exception 'FAIL 1b: the new type is not as urgent or as senior as the type it replaces on this route';
  end if;

  -- 2. with a clinician on call
  perform set_config('tarragon.lead_write', 'on', true);
  delete from public.on_call_rota where is_test;
  insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id, backup_clinician_id, is_test)
  values (v_org, now() - interval '1 hour', now() + interval '8 hours', v_p, v_b, true);
  perform set_config('tarragon.lead_write', 'off', true);
  s1 := pg_temp.screen(v_org, pt1, true);
  select count(*) into v_n from public.clinical_tasks where patient_id = pt1;
  if v_n <> 1 then raise exception 'FAIL 2a: expected one task, got %', v_n; end if;
  select id into v_task from public.clinical_tasks where patient_id = pt1;
  if not exists (select 1 from public.clinical_tasks where id = v_task and type = 'crisis_follow_up' and priority_class = 1 and priority_class_original = 1
      and lead_window_ends_at is null and state in ('open', 'escalated')) then
    raise exception 'FAIL 2b: the task is not an open class 1 crisis_follow_up with no lead window';
  end if;
  if exists (select 1 from public.clinical_tasks where patient_id = pt1 and type = 'red_event_unacknowledged') then raise exception 'FAIL 2c: the older type was created'; end if;
  select count(*) into v_n from public.notifications where recipient_id = v_p and source_id = v_task and template = 'on_call_page'
     and priority = 'critical' and content_class = 'non_clinical' and payload = '{}'::jsonb;
  if v_n <> 3 then raise exception 'FAIL 2d: the on-call clinician should get push, in-app and email (%)', v_n; end if;
  if not exists (select 1 from public.domain_events where event_type = 'crisis.detected' and idempotency_key = 'crisis.detected:' || s1 and priority = 'urgent')
     or not exists (select 1 from public.emergency_events where patient_id = pt1 and source = 'mental_health_screen') then
    raise exception 'FAIL 2e: the urgent event or the emergency event is missing';
  end if;

  -- 3. idempotent, merging, loud on failure
  if private.raise_crisis_follow_up(s1) is not false then raise exception 'FAIL 3a: a replay did work'; end if;
  s2 := pg_temp.screen(v_org, pt1, true);
  if (select count(*) from public.clinical_tasks where patient_id = pt1 and state not in ('completed', 'cancelled')) <> 1
     or (select merged_count from public.clinical_tasks where id = v_task) <> 1 then
    raise exception 'FAIL 3b: the second crisis did not merge into the one live task';
  end if;
  update public.task_types set is_active = false where code = 'crisis_follow_up';
  s3 := pg_temp.screen(v_org, pt2, true);
  update public.task_types set is_active = true where code = 'crisis_follow_up';
  if not exists (select 1 from public.mental_health_screens where id = s3) or not exists (select 1 from public.emergency_events where patient_id = pt2 and source = 'mental_health_screen') then
    raise exception 'FAIL 3c: the screen or the emergency event was lost';
  end if;
  if not exists (select 1 from public.audit_log where action = 'crisis_task.error' and entity_id = s3)
     or not exists (select 1 from public.ops_incidents where external_reference = 'crisis_follow_up_failed:' || s3 and status not in ('resolved', 'closed'))
     or exists (select 1 from public.audit_log where action = 'crisis.handled' and entity_id = s3) then
    raise exception 'FAIL 3d: the failure was not loud (audit row, open incident, no handled marker)';
  end if;
  v_ok := private.raise_crisis_follow_up(s3);   -- a variable first: a subquery in the same condition would be evaluated before the call
  if v_ok is not true or (select count(*) from public.clinical_tasks where patient_id = pt2 and type = 'crisis_follow_up') <> 1 then
    raise exception 'FAIL 3e: a replay after the fix did not complete';
  end if;

  -- 4. the deliberate side effect and its cure
  insert into public.triage_rule_sets (code, version, status, rules) values ('s57b_set', 1, 'draft',
    '{"code":"s57b_set","version":1,"rules":[{"id":"R1","actions":[{"kind":"create_task","task":"bp_review","dueMinutes":60}]}]}'::jsonb) returning id into v_set;
  update public.task_types set confirmed_by = v_cmo, confirmed_at = now() where code = 'adherence_follow_up' and is_active and needs_confirmation;
  perform set_config('request.jwt.claim.sub', v_cmo::text, true); perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.approve_triage_rule_set(v_set);
    raise exception 'FAIL 4a: a rule set was approved while crisis_follow_up awaited confirmation';
  exception when sqlstate '22023' then null; end;
  perform public.confirm_task_type('crisis_follow_up', 'proof');
  perform public.approve_triage_rule_set(v_set);
  reset role;
  if (select status from public.triage_rule_sets where id = v_set) <> 'approved' then raise exception 'FAIL 4b: confirming did not release approval'; end if;

  -- 5. grants
  if has_function_privilege('anon', 'private.raise_crisis_follow_up(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'private.raise_crisis_follow_up(uuid)', 'EXECUTE') then
    raise exception 'FAIL 5: raise_crisis_follow_up is callable by anon or authenticated';
  end if;

  -- SABOTAGE: put the F1 text back; the task type assertion must then fail
  v_def := pg_get_functiondef('private.raise_crisis_follow_up(uuid)'::regprocedure);
  execute replace(v_def, '''crisis_follow_up'', null', '''red_event_unacknowledged'', null');
  s4 := pg_temp.screen(v_org, pt3, true);
  if exists (select 1 from public.clinical_tasks where patient_id = pt3 and type = 'crisis_follow_up') then
    raise exception 'VACUOUS TEST: the sabotaged function still made a crisis_follow_up task';
  end if;
  if not exists (select 1 from public.clinical_tasks where patient_id = pt3 and type = 'red_event_unacknowledged') then
    raise exception 'VACUOUS TEST: the sabotage did not take effect';
  end if;

  raise notice 'PASS: crisis_follow_up is the crisis route type; class 1, on-call notice, idempotency and loud failure kept';
end $$;

rollback;
