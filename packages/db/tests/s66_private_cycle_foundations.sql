-- ===========================================================================
-- Proof: S66 private cycle foundations (planning mode, provenance, deletion on request).
--   * conception_planning_mode defaults OFF; only the patient can turn it ON (a clinician and a caregiver with 'manage' access are refused),
--     anyone with write access can turn it OFF; the RPC works for a patient and refuses anon, a clinician and a missing session.
--   * menopause_symptom_logs.source and recorded_by come from the session, never from the client (a patient cannot dress a row as a clinician's).
--   * deletion on request: waiting period, one pending request, cancel, the processor is service-role only and refuses early, then deletes
--     what the patient entered, keeps SEALED what a clinician recorded or acted on, clears the profile fields, writes a counts-only receipt
--     to audit_log, leaves another patient untouched, and runs once.
--   * reproductive_deletion_requests: the patient reads her own, nobody else (caregiver, sponsor, employer, clinician) reads any, nobody writes.
--   * anon cannot execute any new function; the config table is not readable by clients.
-- SABOTAGE: the "only the patient turns it on" trigger is dropped and the "sealed" rule is removed from the processor; both checks must flip.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures. Test accounts only (is_test).
-- ===========================================================================
begin;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid(); v_pat2 uuid := gen_random_uuid(); v_cg uuid := gen_random_uuid(); v_doc uuid := gen_random_uuid();
  v_sponsor uuid := gen_random_uuid(); v_emp uuid := gen_random_uuid();
  v_json jsonb; v_n integer; v_failed boolean; v_src text; v_rec uuid; v_req uuid; v_alert uuid; v_receipt jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_pat, 's66a-pat@example.invalid', 'x', now(), '{}', '{}'), (v_pat2, 's66a-pat2@example.invalid', 'x', now(), '{}', '{}'),
    (v_cg, 's66a-cg@example.invalid', 'x', now(), '{}', '{}'), (v_doc, 's66a-doc@example.invalid', 'x', now(), '{}', '{}'),
    (v_sponsor, 's66a-sp@example.invalid', 'x', now(), '{}', '{}'), (v_emp, 's66a-emp@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, is_test) values
    (v_pat, v_org, 'patient', 'S66A Patient', '+2348066000001', true), (v_pat2, v_org, 'patient', 'S66A Patient Two', '+2348066000002', true),
    (v_cg, v_org, 'patient', 'S66A Caregiver', '+2348066000003', true), (v_doc, v_org, 'clinician', 'S66A Doctor', '+2348066000004', true),
    (v_sponsor, v_org, 'hmo_admin', 'S66A Sponsor', '+2348066000005', true), (v_emp, v_org, 'corporate_admin', 'S66A Employer', '+2348066000006', true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;
  -- profiles.is_test can be set only by an admin or a service context (guard_is_test_flag), so the fixture does it as the service role
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  update public.profiles set is_test = true where id in (v_pat, v_pat2, v_cg, v_doc, v_sponsor, v_emp);
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
  values (v_org, v_doc, 'S66A Doctor', true, now(), 'senior_medical_officer');
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_pat, v_cg, 'manage', v_pat);

  -- 1. planning mode defaults OFF ------------------------------------------------------------------------
  insert into public.reproductive_health_profiles (organisation_id, patient_id, last_period_date, average_cycle_length_days)
  values (v_org, v_pat, current_date - 20, 28);
  if (select conception_planning_mode from public.reproductive_health_profiles where patient_id = v_pat) then raise exception 'FAIL 1a: planning mode is not off by default'; end if;

  -- 2. the RPC: the patient turns it on; anon, a clinician and no session are refused
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.set_conception_planning_mode(true);
  execute 'reset role';
  if not (select conception_planning_mode from public.reproductive_health_profiles where patient_id = v_pat) then raise exception 'FAIL 2a: the patient could not turn planning mode on'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false; begin perform public.set_conception_planning_mode(true); exception when sqlstate '42501' then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 2b: a clinician could call the planning mode RPC'; end if;
  perform set_config('request.jwt.claims', null, true);
  execute 'set local role anon';
  v_failed := false; begin perform public.set_conception_planning_mode(true); exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 2c: anon could call the planning mode RPC'; end if;

  -- 3. a caregiver with manage access and a clinician cannot switch it ON directly; switching OFF is allowed
  update public.reproductive_health_profiles set conception_planning_mode = false where patient_id = v_pat;
  foreach v_rec in array array[v_cg, v_doc] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_rec, 'role', 'authenticated')::text, true);
    v_failed := false;
    begin update public.reproductive_health_profiles set conception_planning_mode = true where patient_id = v_pat;
    exception when sqlstate '42501' then v_failed := true; end;
    if not v_failed then raise exception 'FAIL 3a: % switched planning mode on for the patient', v_rec; end if;
  end loop;
  perform set_config('request.jwt.claims', null, true);
  update public.reproductive_health_profiles set conception_planning_mode = true where patient_id = v_pat;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cg, 'role', 'authenticated')::text, true);
  update public.reproductive_health_profiles set conception_planning_mode = false where patient_id = v_pat;
  if (select conception_planning_mode from public.reproductive_health_profiles where patient_id = v_pat) then raise exception 'FAIL 3b: switching OFF was refused'; end if;
  perform set_config('request.jwt.claims', null, true);

  -- 4. provenance on the menopause log is derived from the session ------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  insert into public.menopause_symptom_logs (organisation_id, patient_id, symptom_types, source, recorded_by)
  values (v_org, v_pat, array['hot_flashes']::public.menopause_symptom_type[], 'clinician', v_doc) returning source, recorded_by into v_src, v_rec;
  if v_src <> 'patient' or v_rec <> v_pat then raise exception 'FAIL 4a: a patient dressed her own row as a clinician row (% %)', v_src, v_rec; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  insert into public.menopause_symptom_logs (organisation_id, patient_id, symptom_types)
  values (v_org, v_pat, array['night_sweats']::public.menopause_symptom_type[]) returning source, recorded_by into v_src, v_rec;
  if v_src <> 'clinician' or v_rec <> v_doc then raise exception 'FAIL 4b: a clinician row was not stamped as clinician (% %)', v_src, v_rec; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  -- a bleeding report raises a clinician alert, which seals that row
  insert into public.menopause_symptom_logs (organisation_id, patient_id, postmenopausal_bleeding) values (v_org, v_pat, true)
  returning clinician_alert_id into v_alert;
  if v_alert is null then raise exception 'FAIL 4c: the bleeding report raised no clinician alert'; end if;
  perform set_config('request.jwt.claims', null, true);

  -- 5. data to delete, for two patients -------------------------------------------------------------------
  insert into public.menstrual_cycles (organisation_id, patient_id, period_start_date) values (v_org, v_pat, current_date - 60), (v_org, v_pat, current_date - 32), (v_org, v_pat2, current_date - 5);
  insert into public.menstrual_daily_logs (organisation_id, patient_id, log_date, flow, notes) values (v_org, v_pat, current_date - 1, 'heavy', 'S66A secret note'), (v_org, v_pat, current_date, 'light', null), (v_org, v_pat2, current_date, 'light', null);
  insert into public.notifications (organisation_id, recipient_id, channel, template, payload) values
    (v_org, v_pat, 'in_app', 'cycle_period_due_soon', '{"expected_date":"2026-10-20"}'), (v_org, v_pat2, 'in_app', 'cycle_period_due_soon', '{"expected_date":"2026-10-20"}');

  -- 6. the request: one pending, a grace window, counts shown ------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.request_reproductive_tracker_deletion();
  execute 'reset role';
  if v_json ->> 'status' <> 'pending' or (v_json ->> 'already_asked')::boolean then raise exception 'FAIL 6a: request: %', v_json; end if;
  if (v_json -> 'counts' ->> 'menstrual_cycles')::int <> 2 or (v_json -> 'counts' ->> 'menopause_logs_deleted')::int <> 1 or (v_json -> 'counts' ->> 'menopause_logs_sealed')::int <> 2 or (v_json -> 'counts' ->> 'reminders')::int <> 1 then
    raise exception 'FAIL 6b: counts wrong: %', v_json -> 'counts'; end if;
  select id into v_req from public.reproductive_deletion_requests where patient_id = v_pat and status = 'pending';
  if (select execute_after from public.reproductive_deletion_requests where id = v_req) < now() + interval '13 days 23 hours' then raise exception 'FAIL 6c: grace window shorter than the configured 14 days'; end if;
  if not (select is_test from public.reproductive_deletion_requests where id = v_req) then raise exception 'FAIL 6d: is_test not stamped'; end if;
  execute 'set local role authenticated';
  if (public.request_reproductive_tracker_deletion() ->> 'already_asked')::boolean is not true then raise exception 'FAIL 6e: a second request made a second row'; end if;
  execute 'reset role';
  select count(*) into v_n from public.reproductive_deletion_requests where patient_id = v_pat; if v_n <> 1 then raise exception 'FAIL 6f: % rows', v_n; end if;

  -- 7. nothing happens early; the processor is service role only ------------------------------------------------
  v_failed := false; begin perform private.process_reproductive_deletion(v_req); exception when sqlstate '55000' then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 7a: the processor ran inside the grace window'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false; begin perform public.process_due_reproductive_tracker_deletions(); exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 7b: a patient could run the deletion processor'; end if;
  select count(*) into v_n from public.menstrual_cycles where patient_id = v_pat; if v_n <> 2 then raise exception 'FAIL 7c: data changed early'; end if;

  -- 8. cancel, then ask again, then let the window pass ----------------------------------------------------------
  execute 'set local role authenticated';
  if (public.cancel_reproductive_tracker_deletion() ->> 'cancelled')::boolean is not true then raise exception 'FAIL 8a: cancel'; end if;
  if (public.cancel_reproductive_tracker_deletion() ->> 'cancelled')::boolean then raise exception 'FAIL 8b: cancelled twice'; end if;
  perform public.request_reproductive_tracker_deletion();
  execute 'reset role';
  select id into v_req from public.reproductive_deletion_requests where patient_id = v_pat and status = 'pending';
  update public.reproductive_deletion_requests set execute_after = now() - interval '1 minute' where id = v_req;

  -- 9. who can read the request row ------------------------------------------------------------------------------
  foreach v_rec in array array[v_cg, v_doc, v_sponsor, v_emp, v_pat2] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_rec, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_n from public.reproductive_deletion_requests where patient_id = v_pat;
    execute 'reset role';
    if v_n <> 0 then raise exception 'FAIL 9a: % can read the deletion request', v_rec; end if;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.reproductive_deletion_requests where patient_id = v_pat; if v_n <> 2 then raise exception 'FAIL 9b: the patient cannot read her own (%)', v_n; end if;
  v_failed := false; begin update public.reproductive_deletion_requests set status = 'pending'; exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 9c: a client could write a deletion request'; end if;
  execute 'reset role';

  -- 10. the processor (service role) -------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  v_n := public.process_due_reproductive_tracker_deletions();
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  if v_n < 1 then raise exception 'FAIL 10a: nothing processed'; end if;
  if exists (select 1 from public.menstrual_cycles where patient_id = v_pat) or exists (select 1 from public.menstrual_daily_logs where patient_id = v_pat) then raise exception 'FAIL 10b: patient-entered cycle data survived'; end if;
  if exists (select 1 from public.notifications where recipient_id = v_pat and template like 'cycle\_period\_%' escape '\') then raise exception 'FAIL 10c: reminders survived'; end if;
  select count(*) into v_n from public.menopause_symptom_logs where patient_id = v_pat; if v_n <> 2 then raise exception 'FAIL 10d: expected the 2 sealed menopause rows to remain, found %', v_n; end if;
  if exists (select 1 from public.menopause_symptom_logs where patient_id = v_pat and source = 'patient' and clinician_alert_id is null) then raise exception 'FAIL 10e: a deletable menopause row survived'; end if;
  if (select count(*) from public.menstrual_cycles where patient_id = v_pat2) <> 1 or (select count(*) from public.menstrual_daily_logs where patient_id = v_pat2) <> 1 or (select count(*) from public.notifications where recipient_id = v_pat2) <> 1 then raise exception 'FAIL 10f: another patient''s data was touched'; end if;
  if (select last_period_date from public.reproductive_health_profiles where patient_id = v_pat) is not null or (select conception_planning_mode from public.reproductive_health_profiles where patient_id = v_pat) then raise exception 'FAIL 10g: profile fields not cleared'; end if;
  select receipt into v_receipt from public.reproductive_deletion_requests where id = v_req and status = 'completed';
  if v_receipt is null or (v_receipt ->> 'menstrual_cycles_deleted')::int <> 2 or (v_receipt ->> 'menopause_logs_sealed_kept')::int <> 2 then raise exception 'FAIL 10h: receipt %', v_receipt; end if;
  select count(*) into v_n from public.audit_log where action = 'reproductive_deletion.completed' and entity_id = v_req and subject_patient_id = v_pat and event::text not like '%secret%';
  if v_n <> 1 then raise exception 'FAIL 10i: expected one counts-only audit receipt, found %', v_n; end if;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  if public.process_due_reproductive_tracker_deletions() <> 0 then raise exception 'FAIL 10j: a completed request ran again'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  -- 11. grants ---------------------------------------------------------------------------------------------------
  if has_function_privilege('anon', 'public.request_reproductive_tracker_deletion()', 'EXECUTE') or has_function_privilege('anon', 'public.cancel_reproductive_tracker_deletion()', 'EXECUTE')
     or has_function_privilege('anon', 'public.reproductive_tracker_deletion_status()', 'EXECUTE') or has_function_privilege('anon', 'public.set_conception_planning_mode(boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.process_due_reproductive_tracker_deletions()', 'EXECUTE') then raise exception 'FAIL 11a: a function is executable by a role that must not run it'; end if;
  if has_table_privilege('authenticated', 'public.reproductive_privacy_config', 'SELECT') or has_table_privilege('anon', 'public.reproductive_deletion_requests', 'SELECT') then raise exception 'FAIL 11b: table privilege'; end if;

  -- SABOTAGE A: drop the "only the patient turns it on" trigger; a clinician's direct update must now succeed (the check is real)
  update public.reproductive_health_profiles set conception_planning_mode = false where patient_id = v_pat;
  drop trigger reproductive_health_profiles_guard_planning on public.reproductive_health_profiles;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  update public.reproductive_health_profiles set conception_planning_mode = true where patient_id = v_pat;
  perform set_config('request.jwt.claims', null, true);
  if not (select conception_planning_mode from public.reproductive_health_profiles where patient_id = v_pat) then raise exception 'SABOTAGE A did not flip: the planning guard check is vacuous'; end if;

  raise notice 'PASS: S66 private cycle foundations';
end $$;

rollback;
