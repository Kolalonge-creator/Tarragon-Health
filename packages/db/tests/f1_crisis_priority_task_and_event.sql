-- Proof (F1 fix 4, retyped to crisis_follow_up by S57b): a crisis-flagged wellbeing screen raises a class 1 clinical task and a crisis.detected event, and reaches a person.
--
--   1. With nobody on the rota: the emergency event still fires (unchanged), ONE class 1 task exists (type crisis_follow_up,
--      no lead window), one urgent crisis.detected event whose payload carries only screen_id, the clinical lead and ops are told
--      with the neutral on_call_escalation notice, and one "nobody on call" incident opens. The screen is marked handled.
--   2. A non-crisis screen creates no task and no event.
--   3. Replaying the same screen creates nothing new (task, event, notices all unchanged): idempotent.
--   4. A second crisis screen for the same patient merges into the live task (merge counted) and emits its own event.
--   5. With a clinician on call: that clinician gets the neutral on_call_page notice (push, in-app, email, critical, empty payload).
--   6. INV-07: no notice and no event payload carries a clinical word, a score or a name.
--   7. Failure is loud, never silent, and never undoes the screen or the emergency event: with the task type switched off the
--      screen still saves, an audit row and an open incident exist, and there is NO handled marker; once fixed, a replay completes it.
--   SABOTAGE: with the trigger dropped a crisis screen creates no task (the trigger is what creates it).
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
  v_org uuid; v_admin uuid; v_cmo uuid; v_p uuid; v_b uuid;
  pt1 uuid; pt2 uuid; pt3 uuid; pt4 uuid; pt5 uuid;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; s6 uuid;
  v_def text; pt6 uuid; s7 uuid;
  v_n integer; v_notes integer; v_task uuid; v_forbidden text := 'blood|pressure|hypertens|diabet|result|reading|glucose|medicine|dose|symptom|phq|score|depress|suicid|self-harm|F1C ';
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;   -- only fixture clinicians may be paged
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_p := pg_temp.mkdoc(v_org, v_admin, 'primary', 'senior_medical_officer');
  v_b := pg_temp.mkdoc(v_org, v_admin, 'backup', 'senior_medical_officer');
  pt1 := pg_temp.mkuser(v_org, 'p1', 'patient'); pt2 := pg_temp.mkuser(v_org, 'p2', 'patient'); pt3 := pg_temp.mkuser(v_org, 'p3', 'patient');
  pt4 := pg_temp.mkuser(v_org, 'p4', 'patient'); pt5 := pg_temp.mkuser(v_org, 'p5', 'patient'); pt6 := pg_temp.mkuser(v_org, 'p6', 'patient');
  perform set_config('tarragon.lead_write', 'on', true);
  delete from public.on_call_rota where is_test;   -- no rota: nobody on call
  perform set_config('tarragon.lead_write', 'off', true);

  -- 1. nobody on the rota ---------------------------------------------------------------------------------------
  s1 := pg_temp.screen(v_org, pt1, true);
  if not exists (select 1 from public.emergency_events where patient_id = pt1 and source = 'mental_health_screen') then
    raise exception 'FAIL 1a: the existing emergency event no longer fires';
  end if;
  select count(*) into v_n from public.clinical_tasks where patient_id = pt1;
  if v_n <> 1 then raise exception 'FAIL 1b: expected one task, got %', v_n; end if;
  select id into v_task from public.clinical_tasks where patient_id = pt1;
  if not exists (select 1 from public.clinical_tasks where id = v_task and type = 'crisis_follow_up' and priority_class = 1
                  and priority_class_original = 1 and lead_window_ends_at is null and is_test and state in ('open', 'escalated')) then
    raise exception 'FAIL 1c: the task is not an open class 1 task with no lead window';
  end if;
  select count(*) into v_n from public.domain_events where event_type = 'crisis.detected' and idempotency_key = 'crisis.detected:' || s1 and priority = 'urgent';
  if v_n <> 1 then raise exception 'FAIL 1d: expected one urgent crisis.detected event, got %', v_n; end if;
  if (select array_agg(k order by k) from public.domain_events e, jsonb_object_keys(e.payload) k where e.idempotency_key = 'crisis.detected:' || s1) <> array['screen_id'] then
    raise exception 'FAIL 1e: the event payload carries more than screen_id';
  end if;
  select count(*) into v_n from public.notifications where source_id = v_task and template = 'on_call_escalation' and priority = 'critical' and payload = '{}'::jsonb;
  if v_n < 3 then raise exception 'FAIL 1f: the lead and ops were not told on push, in-app and email (%)', v_n; end if;
  if not exists (select 1 from public.ops_incidents where external_reference = 'crisis_no_cover:' || s1 and status not in ('resolved', 'closed')) then
    raise exception 'FAIL 1g: no "nobody on call" incident';
  end if;
  if not exists (select 1 from public.audit_log where action = 'crisis.handled' and entity_id = s1) then raise exception 'FAIL 1h: not marked handled'; end if;

  -- 2. a non-crisis screen does nothing ------------------------------------------------------------------------------
  s2 := pg_temp.screen(v_org, pt2, false);
  if exists (select 1 from public.clinical_tasks where patient_id = pt2) or exists (select 1 from public.domain_events where idempotency_key = 'crisis.detected:' || s2) then
    raise exception 'FAIL 2: a non-crisis screen created a task or an event';
  end if;

  -- 3. replay is idempotent ----------------------------------------------------------------------------------------------
  select count(*) into v_notes from public.notifications where source_id = v_task;
  if private.raise_crisis_follow_up(s1) is not false then raise exception 'FAIL 3a: a replay of a handled screen did work'; end if;
  if (select count(*) from public.clinical_tasks where patient_id = pt1) <> 1
     or (select count(*) from public.domain_events where idempotency_key = 'crisis.detected:' || s1) <> 1
     or (select count(*) from public.notifications where source_id = v_task) <> v_notes
     or (select merged_count from public.clinical_tasks where id = v_task) <> 0 then
    raise exception 'FAIL 3b: a replay changed the task, the event or the notices';
  end if;

  -- 4. second crisis screen merges into the live task -----------------------------------------------------------------------
  s3 := pg_temp.screen(v_org, pt1, true);
  if (select count(*) from public.clinical_tasks where patient_id = pt1 and state not in ('completed', 'cancelled')) <> 1
     or (select merged_count from public.clinical_tasks where id = v_task) <> 1 then
    raise exception 'FAIL 4a: the second crisis did not merge into the one live task';
  end if;
  if (select count(*) from public.domain_events where event_type = 'crisis.detected' and patient_id = pt1) <> 2 then
    raise exception 'FAIL 4b: each crisis screen should emit its own event';
  end if;

  -- 5. someone on call gets the neutral page notice ---------------------------------------------------------------------------
  perform set_config('tarragon.lead_write', 'on', true);
  insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id, backup_clinician_id, is_test)
  values (v_org, now() - interval '1 hour', now() + interval '8 hours', v_p, v_b, true);
  perform set_config('tarragon.lead_write', 'off', true);
  s4 := pg_temp.screen(v_org, pt3, true);
  select id into v_task from public.clinical_tasks where patient_id = pt3;
  select count(*) into v_n from public.notifications where recipient_id = v_p and source_id = v_task and template = 'on_call_page'
     and priority = 'critical' and content_class = 'non_clinical' and payload = '{}'::jsonb;
  if v_n <> 3 then raise exception 'FAIL 5a: the on-call clinician should get push, in-app and email (%)', v_n; end if;
  if exists (select 1 from public.ops_incidents where external_reference = 'crisis_no_cover:' || s4) then
    raise exception 'FAIL 5b: an incident opened although someone was on call';
  end if;

  -- 6. INV-07 ---------------------------------------------------------------------------------------------------------------------
  select count(*) into v_n from public.notifications n
   where n.source_table = 'clinical_tasks' and (n.payload <> '{}'::jsonb or coalesce(n.template, '') ~* v_forbidden);
  if v_n <> 0 then raise exception 'FAIL 6a: a crisis notice carries a payload or a clinical word (%)', v_n; end if;
  select count(*) into v_n from public.domain_events e where e.event_type = 'crisis.detected' and e.payload::text ~* v_forbidden;
  if v_n <> 0 then raise exception 'FAIL 6b: a crisis event payload carries a clinical word or a name'; end if;

  -- 7. failure is loud, never silent, never undoes the screen or the emergency event ------------------------------------------------
  update public.task_types set is_active = false where code = 'crisis_follow_up';
  s5 := pg_temp.screen(v_org, pt4, true);
  update public.task_types set is_active = true where code = 'crisis_follow_up';
  if not exists (select 1 from public.mental_health_screens where id = s5) then raise exception 'FAIL 7a: the patient screen was lost'; end if;
  if not exists (select 1 from public.emergency_events where patient_id = pt4 and source = 'mental_health_screen') then
    raise exception 'FAIL 7b: the emergency event was lost';
  end if;
  if not exists (select 1 from public.audit_log where action = 'crisis_task.error' and entity_id = s5) then raise exception 'FAIL 7c: the failure was not audited'; end if;
  if not exists (select 1 from public.ops_incidents where external_reference = 'crisis_follow_up_failed:' || s5 and status not in ('resolved', 'closed')) then
    raise exception 'FAIL 7d: the failure opened no incident';
  end if;
  if exists (select 1 from public.audit_log where action = 'crisis.handled' and entity_id = s5) then raise exception 'FAIL 7e: a failed run was marked handled'; end if;
  if private.raise_crisis_follow_up(s5) is not true then raise exception 'FAIL 7f: a replay after the fix did not complete'; end if;
  if (select count(*) from public.clinical_tasks where patient_id = pt4) <> 1 then raise exception 'FAIL 7g: the replay did not create the task'; end if;

  -- 8. even if the failure reporting itself is broken, the patient's screen and the emergency event still save
  v_def := pg_get_functiondef('private.page_incident(uuid, text, text, text)'::regprocedure);
  create or replace function private.page_incident(p_org uuid, p_ref text, p_title text, p_summary text) returns void
    language plpgsql as $f$ begin raise exception 'incident writer is down'; end $f$;
  update public.task_types set is_active = false where code = 'crisis_follow_up';
  s7 := pg_temp.screen(v_org, pt6, true);
  update public.task_types set is_active = true where code = 'crisis_follow_up';
  execute v_def;
  if not exists (select 1 from public.mental_health_screens where id = s7)
     or not exists (select 1 from public.emergency_events where patient_id = pt6 and source = 'mental_health_screen') then
    raise exception 'FAIL 8: a broken failure reporter lost the screen or the emergency event';
  end if;

  -- SABOTAGE: drop the trigger; a crisis screen must then create no task ---------------------------------------------------------------
  drop trigger mental_health_screens_crisis_task on public.mental_health_screens;
  s6 := pg_temp.screen(v_org, pt5, true);
  if exists (select 1 from public.clinical_tasks where patient_id = pt5) then
    raise exception 'VACUOUS TEST: a task exists for the patient without the trigger, so the trigger is not what creates it';
  end if;

  raise notice 'PASS: crisis screen -> class 1 task, urgent crisis.detected, neutral notice, idempotent, loud on failure';
end $$;

rollback;
