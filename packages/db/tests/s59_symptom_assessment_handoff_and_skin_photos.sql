begin;

create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
-- run a statement under the current role and return 'ok' or its sqlstate
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.scalar(p_sql text) returns text language plpgsql as
$f$ declare v text; begin execute p_sql into v; return v; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's59-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language, sex, state)
  values (v, p_org, p_role::public.user_role, 'S59 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test, 'en', 'female', 'Lagos')
  on conflict (id) do update set role = excluded.role, is_test = excluded.is_test, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name, sex = excluded.sex, state = excluded.state;
  return v;
end $f$;
create function pg_temp.mkstaff(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, case when p_tier = 'care_coordinator' then 'care_coordinator' else 'clinician' end);
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'S59 ' || p_label, 'MDCN', 'S59-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true, array['en'], 'General practice');
  return v;
end $f$;
create function pg_temp.assess(p_org uuid, p_patient uuid, p_category text default 'urgent') returns uuid language plpgsql as
$f$ declare v uuid; begin
  insert into public.symptom_triage_assessments
    (organisation_id, patient_id, presenting_complaint_key, protocol_version, initial_capture, questions_asked, red_flag_screen,
     category, clinician_review_required, safety_net_message_key, rationale)
  values (p_org, p_patient, 'headache', (select min(version) from public.triage_protocols), '{}', '[]', '{}',
          p_category::public.triage_category, false, 'routine', 'S60 proof')
  returning id into v;
  return v;
end $f$;


do $$
declare
  v_org uuid; v_admin uuid; v_p1 uuid; v_p2 uuid; v_kid uuid; v_mgr uuid; v_c1 uuid; v_c2 uuid; v_cc uuid;
  v_a1 uuid; v_a_kid uuid; v_r text; v_n integer; v_j jsonb; v_sum uuid; v_appt uuid; v_appt2 uuid; v_photo uuid; v_photo2 uuid;
  v_path text; v_path2 text; v_task uuid; v_pa uuid;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_p1 := pg_temp.mkuser(v_org, 'patient1', 'patient');
  v_p2 := pg_temp.mkuser(v_org, 'patient2', 'patient');
  v_kid := pg_temp.mkuser(v_org, 'child', 'patient');
  v_mgr := pg_temp.mkuser(v_org, 'carer', 'patient');
  v_c1 := pg_temp.mkstaff(v_org, v_admin, 'tied', 'medical_officer');
  v_c2 := pg_temp.mkstaff(v_org, v_admin, 'untied', 'medical_officer');
  v_cc := pg_temp.mkstaff(v_org, v_admin, 'coordinator', 'care_coordinator');
  update public.profiles set date_of_birth = (current_date - interval '6 years')::date, is_dependent_account = true where id = v_kid;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_kid, v_mgr, 'manage', v_mgr);
  insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant) values (v_org, v_p1, true), (v_org, v_kid, true);
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, status) values (v_org, v_p1, 'Hypertension', 'active');
  insert into public.medications (organisation_id, patient_id, drug_name, is_active) values (v_org, v_p1, 'Warfarin', true);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, spo2_pct, taken_at) values (v_org, v_p1, 'spo2', 91, now() - interval '1 day');

  insert into public.symptom_triage_assessments
    (organisation_id, patient_id, presenting_complaint_key, protocol_version, initial_capture, questions_asked, red_flag_screen, category,
     clinician_review_required, safety_net_message_key, rationale)
  values (v_org, v_p1, 'headache', (select min(version) from public.triage_protocols),
          '{"presentingComplaintKey":"headache","onset":"gradual","severity":6,"associatedSymptoms":["fever"],"triggers":[],"relevantHistory":["pregnant","hiv_or_immunocompromised"],"measurements":{}}',
          '[{"questionKey":"q1","prompt":"Has it lasted long?","answer":true}]', '{"fired":[{"key":"k.x","label":"A flag label"}]}', 'urgent', false, 'routine', 'S59 proof')
  returning id into v_a1;
  insert into public.symptom_triage_assessments
    (organisation_id, patient_id, logged_by_profile_id, presenting_complaint_key, protocol_version, initial_capture, questions_asked, red_flag_screen, category,
     clinician_review_required, safety_net_message_key, rationale)
  values (v_org, v_kid, v_mgr, 'headache', (select min(version) from public.triage_protocols), '{}', '[]', '{}', 'routine', false, 'routine', 'S59 proof child')
  returning id into v_a_kid;

  -- 1. columns and defaults
  if (select engine || '/' || engine_version from public.symptom_triage_assessments where id = v_a1) <> 'internal/in_house.1' then raise exception 'FAIL 1a: engine defaults'; end if;
  if pg_temp.try('update public.symptom_triage_assessments set engine = ''magic'' where id = ''' || v_a1 || '''') = 'ok' then raise exception 'FAIL 1b: an unknown engine was accepted'; end if;
  if pg_temp.try('update public.symptom_triage_assessments set urgency_level = ''today'' where id = ''' || v_a1 || '''') = 'ok' then raise exception 'FAIL 1c: a level without a map version, or an unknown level, was accepted'; end if;

  -- 2. symptom_sessions: no staff path
  perform pg_temp.act(v_p1);
  if pg_temp.scalar('select count(id) from public.symptom_sessions') <> '1' then raise exception 'FAIL 2a: the patient does not see their session'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_mgr);
  if pg_temp.scalar('select count(id) from public.symptom_sessions') <> '1' then raise exception 'FAIL 2b: the carer does not see the check they ran'; end if;
  perform pg_temp.back();
  foreach v_r in array array['p2', 'c1', 'c2', 'admin', 'cc'] loop
    perform pg_temp.act(case v_r when 'p2' then v_p2 when 'c1' then v_c1 when 'c2' then v_c2 when 'admin' then v_admin else v_cc end);
    if pg_temp.scalar('select count(id) from public.symptom_sessions') <> '0' then raise exception 'FAIL 2c: role % reads symptom_sessions (INV-12)', v_r; end if;
    perform pg_temp.back();
  end loop;
  perform pg_temp.act_anon();
  if pg_temp.try('select count(id) from public.symptom_sessions') <> '42501' then raise exception 'FAIL 2d: anon reads symptom_sessions'; end if;
  perform pg_temp.back();

  -- 3. context: own record whole, acted-for record never carries pregnancy, strangers refused
  perform pg_temp.act(v_p1);
  v_j := public.symptom_check_context();
  perform pg_temp.back();
  if (v_j ->> 'pregnant') <> 'true' or v_j -> 'conditions' <> '["hypertension"]'::jsonb or v_j -> 'medicines' <> '["warfarin"]'::jsonb or (v_j #>> '{readings,spo2_pct}') <> '91' then
    raise exception 'FAIL 3a: own context wrong: %', v_j;
  end if;
  perform pg_temp.act(v_mgr);
  v_j := public.symptom_check_context(v_kid);
  perform pg_temp.back();
  if (v_j ->> 'pregnant') is not null or v_j -> 'sections' ? 'pregnancy' then raise exception 'FAIL 3b: pregnancy returned for someone acted for: %', v_j; end if;
  if (v_j ->> 'age_years')::integer <> 6 then raise exception 'FAIL 3c: child age wrong'; end if;
  perform pg_temp.act(v_p2);
  if pg_temp.try(format('select public.symptom_check_context(%L)', v_p1)) <> '42501' then raise exception 'FAIL 3d: a stranger read another patient''s context'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_c1);
  if pg_temp.try(format('select public.symptom_check_context(%L)', v_p1)) <> '42501' then raise exception 'FAIL 3e: a clinician read a patient context through the patient function'; end if;
  perform pg_temp.back();
  if has_function_privilege('anon', 'public.symptom_check_context(uuid,integer)', 'EXECUTE') then raise exception 'FAIL 3f: anon executes the context function'; end if;

  -- 4. audited staff read of a session
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, v_p1, v_c1);
  perform pg_temp.act(v_c2);
  v_j := public.read_symptom_session_audited(v_a1, 'checking without a tie (proof)');
  perform pg_temp.back();
  if v_j ->> 'status' <> 'denied' then raise exception 'FAIL 4a: an untied clinician read the session'; end if;
  if not exists (select 1 from public.audit_log where actor_id = v_c2 and action = 'staff.chart_read' and subject_patient_id = v_p1 and result = 'denied') then raise exception 'FAIL 4b: denial not audited'; end if;
  perform pg_temp.act(v_cc);
  if pg_temp.try(format('select public.read_symptom_session_audited(%L, %L)', v_a1, 'coordinator reading (proof)')) <> '42501' then raise exception 'FAIL 4c: coordinator read'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_c1);
  v_j := public.read_symptom_session_audited(v_a1, 'reviewing a symptom session (proof)');
  perform pg_temp.back();
  if v_j ->> 'status' <> 'ok' or v_j #>> '{session,engine}' <> 'internal' then raise exception 'FAIL 4d: tied clinician could not read: %', v_j; end if;
  if not exists (select 1 from public.audit_log where actor_id = v_c1 and action = 'staff.chart_read' and subject_patient_id = v_p1 and result = 'success' and reason = 'reviewing a symptom session (proof)') then
    raise exception 'FAIL 4e: allowed read not audited';
  end if;

  -- 5. summary hand-off. A REAL patient with the guard off is refused.
  update public.profiles set is_test = false where id = v_p1;
  perform pg_temp.act(v_p1);
  v_r := pg_temp.try(format('select public.send_symptom_summary(%L, true)', v_a1));
  perform pg_temp.back();
  if v_r <> '42501' then raise exception 'FAIL 5a: guard closed but send returned %', v_r; end if;
  update public.profiles set is_test = true where id = v_p1;
  perform pg_temp.act(v_p1);
  if pg_temp.try(format('select public.send_symptom_summary(%L, false)', v_a1)) <> '22023' then raise exception 'FAIL 5b: sent without being shown'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_p2);
  if pg_temp.try(format('select public.send_symptom_summary(%L, true)', v_a1)) <> '42501' then raise exception 'FAIL 5c: another patient sent this summary'; end if;
  perform pg_temp.back();
  if exists (select 1 from public.symptom_session_summaries) then raise exception 'FAIL 5d: a summary exists before anyone chose to send one'; end if;

  -- the clinician c1 is tied by care team, so first show: SENT BUT NOT LINKED is not in the patient summary
  perform pg_temp.act(v_p1);
  v_j := public.send_symptom_summary(v_a1, true);
  perform pg_temp.back();
  v_sum := (v_j ->> 'summary_id')::uuid;
  if (v_j ->> 'linked')::boolean then raise exception 'FAIL 5e: linked without an appointment'; end if;
  if exists (select 1 from public.symptom_session_summaries s where s.id = v_sum and s.payload::text like '%pregnant%') then raise exception 'FAIL 5f: pregnancy copied into the summary'; end if;
  if (select payload ->> 'complaint' from public.symptom_session_summaries where id = v_sum) <> 'headache' then raise exception 'FAIL 5g: payload not built from the assessment'; end if;
  perform pg_temp.act(v_c1);
  v_j := public.clinician_patient_summary(v_p1, 'opening the patient summary (proof)');
  perform pg_temp.back();
  if not (v_j ? 'symptom_summaries') or jsonb_array_length(v_j -> 'symptom_summaries') <> 0 then raise exception 'FAIL 5h: an unlinked summary appears for staff: %', v_j -> 'symptom_summaries'; end if;

  -- SABOTAGE (a): if the linked-appointment filter were missing the unlinked summary WOULD appear (proves 5h discriminates)
  begin
    create or replace function private.symptom_summaries_for_clinician(p_patient uuid) returns jsonb language sql stable security definer set search_path = ''
      as $q$ select coalesce(jsonb_agg(jsonb_build_object('id', s.id)), '[]'::jsonb) from public.symptom_session_summaries s where s.patient_id = p_patient $q$;
    perform pg_temp.act(v_c1);
    v_j := public.clinician_patient_summary(v_p1, 'opening the patient summary (sabotage)');
    perform pg_temp.back();
    if jsonb_array_length(v_j -> 'symptom_summaries') = 0 then raise exception 'VACUOUS TEST (a): the sabotaged function still hid the summary'; end if;
    raise exception 'undo-sabotage-a';
  exception when others then
    perform pg_temp.back();
    if sqlerrm <> 'undo-sabotage-a' then raise; end if;
  end;

  -- BOOK a consultation (acceptance test): the clinician gets the appointment, the patient links the summary, and it appears
  insert into public.appointments (organisation_id, patient_id, clinician_id, scheduled_for, ends_at, status, appointment_type, consultation_method)
  values (v_org, v_p1, v_c1, now() + interval '1 day', now() + interval '1 day 30 minutes', 'booked', 'telemedicine', 'telemedicine') returning id into v_appt;
  insert into public.appointments (organisation_id, patient_id, clinician_id, scheduled_for, ends_at, status, appointment_type, consultation_method, cancelled_at)
  values (v_org, v_p1, v_c1, now() + interval '2 day', now() + interval '2 day 30 minutes', 'cancelled', 'telemedicine', 'telemedicine', now()) returning id into v_appt2;
  perform pg_temp.act(v_p2);
  if pg_temp.try(format('select public.link_symptom_summary_to_appointment(%L, %L)', v_sum, v_appt)) <> '42501' then raise exception 'FAIL 5i: another patient linked'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_p1);
  if pg_temp.try(format('select public.link_symptom_summary_to_appointment(%L, %L)', v_sum, v_appt2)) <> '22023' then raise exception 'FAIL 5j: linked to a cancelled booking'; end if;
  v_j := public.link_symptom_summary_to_appointment(v_sum, v_appt);
  perform pg_temp.back();
  if not (v_j ->> 'linked')::boolean then raise exception 'FAIL 5k: link failed'; end if;
  perform pg_temp.act(v_c1);
  v_j := public.clinician_patient_summary(v_p1, 'opening the patient summary (proof)');
  perform pg_temp.back();
  if jsonb_array_length(v_j -> 'symptom_summaries') <> 1 or v_j #>> '{symptom_summaries,0,payload,complaint_label}' is null then
    raise exception 'FAIL 5l: the session summary does not appear in the clinician patient summary once the consultation is booked: %', v_j -> 'symptom_summaries';
  end if;
  -- an untied clinician still gets nothing
  perform pg_temp.act(v_c2);
  v_j := public.clinician_patient_summary(v_p1, 'opening without a tie (proof)');
  perform pg_temp.back();
  if v_j ->> 'status' <> 'denied' then raise exception 'FAIL 5m: untied clinician got the patient summary'; end if;
  -- the summary table: patient only, nobody else, no direct writes
  perform pg_temp.act(v_p1);
  if pg_temp.scalar('select count(id) from public.symptom_session_summaries') <> '1' then raise exception 'FAIL 5n: patient cannot read own summary'; end if;
  if pg_temp.try('update public.symptom_session_summaries set payload = ''{}''') = 'ok' then raise exception 'FAIL 5o: patient edited a sent summary'; end if;
  if pg_temp.try('delete from public.symptom_session_summaries') = 'ok' then raise exception 'FAIL 5p: patient deleted a sent summary'; end if;
  perform pg_temp.back();
  foreach v_r in array array['p2', 'c1', 'c2', 'admin', 'cc'] loop
    perform pg_temp.act(case v_r when 'p2' then v_p2 when 'c1' then v_c1 when 'c2' then v_c2 when 'admin' then v_admin else v_cc end);
    if pg_temp.scalar('select count(id) from public.symptom_session_summaries') <> '0' then raise exception 'FAIL 5q: role % reads summaries directly', v_r; end if;
    perform pg_temp.back();
  end loop;
  -- when the booking is cancelled the summary leaves the clinician's view
  update public.appointments set status = 'cancelled', cancelled_at = now() where id = v_appt;
  perform pg_temp.act(v_c1);
  v_j := public.clinician_patient_summary(v_p1, 'opening the patient summary (proof)');
  perform pg_temp.back();
  if jsonb_array_length(v_j -> 'symptom_summaries') <> 0 then raise exception 'FAIL 5r: a summary stays visible after the booking was cancelled'; end if;

  -- 6. skin photos
  v_path := v_p1 || '/proof-1.jpg';
  insert into storage.objects (bucket_id, name, metadata) values ('skin-photos', v_path, '{"size": 100000, "mimetype": "image/jpeg"}');
  insert into storage.objects (bucket_id, name, metadata) values ('skin-photos', v_p2 || '/other.jpg', '{"size": 1000, "mimetype": "image/jpeg"}');
  insert into storage.objects (bucket_id, name, metadata) values ('skin-photos', v_p1 || '/big.jpg', '{"size": 9000000, "mimetype": "image/jpeg"}');
  insert into storage.objects (bucket_id, name, metadata) values ('skin-photos', v_p1 || '/gif.gif', '{"size": 1000, "mimetype": "image/gif"}');
  -- storage RLS: own folder readable, other folder not, no client writes
  perform pg_temp.act(v_p1);
  if pg_temp.scalar('select count(*) from storage.objects where bucket_id = ''skin-photos''') <> '3' then raise exception 'FAIL 6a: patient does not see exactly their own 3 files'; end if;
  if pg_temp.try(format('insert into storage.objects (bucket_id, name) values (''skin-photos'', %L)', v_p1 || '/self.jpg')) = 'ok' then raise exception 'FAIL 6b: a client wrote into the bucket'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_c1);
  if pg_temp.scalar('select count(*) from storage.objects where bucket_id = ''skin-photos''') <> '0' then raise exception 'FAIL 6c: a clinician lists the bucket directly'; end if;
  perform pg_temp.back();

  -- guard closed for a real patient
  update public.profiles set is_test = false where id = v_p1;
  perform pg_temp.act(v_p1);
  v_r := pg_temp.try(format('select public.register_skin_photo(%L, %L, ''face'', null, true, ''v1'')', v_p1, v_path));
  perform pg_temp.back();
  update public.profiles set is_test = true where id = v_p1;
  if v_r <> '42501' then raise exception 'FAIL 6d: guard closed but register returned %', v_r; end if;

  perform pg_temp.act(v_p1);
  if pg_temp.try(format('select public.register_skin_photo(%L, %L, ''face'', null, false, ''v1'')', v_p1, v_path)) <> '22023' then raise exception 'FAIL 6e: registered without consent'; end if;
  if pg_temp.try(format('select public.register_skin_photo(%L, %L, ''face'', null, true, ''v1'')', v_p1, v_p1 || '/big.jpg')) <> '22023' then raise exception 'FAIL 6f: an oversize photo was accepted'; end if;
  if pg_temp.try(format('select public.register_skin_photo(%L, %L, ''face'', null, true, ''v1'')', v_p1, v_p1 || '/gif.gif')) <> '22023' then raise exception 'FAIL 6g: a gif was accepted'; end if;
  if pg_temp.try(format('select public.register_skin_photo(%L, %L, ''face'', null, true, ''v1'')', v_p1, v_p2 || '/other.jpg')) <> '22023' then raise exception 'FAIL 6h: registered another patient''s file'; end if;
  if pg_temp.try(format('select public.register_skin_photo(%L, %L, ''genitals'', null, true, ''v1'')', v_p1, v_path)) = 'ok' then raise exception 'FAIL 6i: an intimate body area was accepted'; end if;
  v_j := public.register_skin_photo(v_p1, v_path, 'face', 'a rash', true, 'v1');
  perform pg_temp.back();
  v_photo := (v_j ->> 'photo_id')::uuid;
  if not (v_j ->> 'has_task')::boolean then raise exception 'FAIL 6j: no review task was created'; end if;
  v_task := (select task_id from public.skin_photos where id = v_photo);
  if (select type from public.clinical_tasks where id = v_task) <> 'symptom_review' then raise exception 'FAIL 6k: wrong task type'; end if;
  if (select consent_text_version from public.skin_photos where id = v_photo) <> 'v1' or (select retention_until from public.skin_photos where id = v_photo) < now() + interval '29 days' then raise exception 'FAIL 6l: consent or retention not recorded'; end if;
  if not exists (select 1 from public.domain_events where event_type = 'skin_photo.submitted' and aggregate_id = v_photo and (payload - 'photo_id') = '{}'::jsonb) then raise exception 'FAIL 6m: event missing or not ids only'; end if;
  -- the carer registers for the child; a stranger cannot
  perform pg_temp.act(v_p2);
  if pg_temp.try(format('select public.register_skin_photo(%L, %L, ''face'', null, true, ''v1'')', v_p1, v_path)) <> '42501' then raise exception 'FAIL 6n: a stranger registered a photo for another patient'; end if;
  perform pg_temp.back();

  -- table RLS by role
  perform pg_temp.act(v_p1);
  if pg_temp.scalar('select count(id) from public.skin_photos') <> '1' then raise exception 'FAIL 6o: patient cannot see own photo row'; end if;
  if pg_temp.try('select internal_note from public.skin_photos') <> '42501' then raise exception 'FAIL 6p: patient can select the internal note'; end if;
  if pg_temp.try('select clinician_id from public.skin_photos') <> '42501' then raise exception 'FAIL 6q: patient can select the clinician id'; end if;
  if pg_temp.try('update public.skin_photos set note = ''x''') = 'ok' then raise exception 'FAIL 6r: direct update'; end if;
  if pg_temp.try('delete from public.skin_photos') = 'ok' then raise exception 'FAIL 6s: direct delete'; end if;
  perform pg_temp.back();
  foreach v_r in array array['p2', 'c1', 'c2', 'admin', 'cc'] loop
    perform pg_temp.act(case v_r when 'p2' then v_p2 when 'c1' then v_c1 when 'c2' then v_c2 when 'admin' then v_admin else v_cc end);
    if pg_temp.scalar('select count(id) from public.skin_photos') <> '0' then raise exception 'FAIL 6t: role % reads skin_photos directly (INV-12)', v_r; end if;
    perform pg_temp.back();
  end loop;
  perform pg_temp.act_anon();
  if pg_temp.try('select count(id) from public.skin_photos') <> '42501' then raise exception 'FAIL 6u: anon reads skin_photos'; end if;
  perform pg_temp.back();

  -- clinician queue and audited read
  perform pg_temp.act(v_c2);
  if jsonb_array_length(public.list_my_skin_photo_reviews()) <> 0 then raise exception 'FAIL 6v: untied clinician sees the photo in the queue'; end if;
  v_j := public.read_skin_photo_audited(v_photo, 'looking without a tie (proof)');
  perform pg_temp.back();
  if v_j ->> 'status' <> 'denied' then raise exception 'FAIL 6w: untied clinician opened the photo'; end if;
  if not exists (select 1 from public.audit_log where actor_id = v_c2 and subject_patient_id = v_p1 and result = 'denied' and reason = 'looking without a tie (proof)') then raise exception 'FAIL 6x: denial not audited'; end if;
  perform pg_temp.act(v_cc);
  if pg_temp.try('select public.list_my_skin_photo_reviews()') <> '42501' then raise exception 'FAIL 6y: coordinator lists photos'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_c1);
  v_j := public.list_my_skin_photo_reviews();
  if jsonb_array_length(v_j) <> 1 or (v_j -> 0) ? 'body_area' or (v_j -> 0) ? 'note' or (v_j -> 0) ? 'name' then raise exception 'FAIL 6z: queue leaks content: %', v_j; end if;
  v_j := public.read_skin_photo_audited(v_photo, 'reviewing the photo (proof)');
  perform pg_temp.back();
  if v_j ->> 'status' <> 'ok' or v_j #>> '{photo,storage_path}' <> v_path then raise exception 'FAIL 6aa: tied clinician could not open: %', v_j; end if;
  if not exists (select 1 from public.audit_log where actor_id = v_c1 and subject_patient_id = v_p1 and result = 'success' and reason = 'reviewing the photo (proof)') then raise exception 'FAIL 6ab: read not audited'; end if;

  -- completion
  perform pg_temp.act(v_c2);
  v_j := public.complete_skin_photo_review(v_photo, 'routine', 'Please book a visit so we can look at it.');
  perform pg_temp.back();
  if v_j ->> 'status' <> 'denied' then raise exception 'FAIL 6ac: untied clinician completed: %', v_j; end if;
  perform pg_temp.act(v_c1);
  v_j := public.complete_skin_photo_review(v_photo, 'routine', 'Please book a visit so we can look at it.', 'internal');
  perform pg_temp.back();
  if v_j ->> 'ok' <> 'true' then raise exception 'FAIL 6ad: completion failed: %', v_j; end if;
  perform pg_temp.act(v_p1);
  if pg_temp.scalar('select clinician_message from public.skin_photos') <> 'Please book a visit so we can look at it.' then raise exception 'FAIL 6ae: patient cannot read the clinician message'; end if;
  perform pg_temp.back();
  if (select state::text from public.clinical_tasks where id = v_task) not in ('completed', 'cancelled') then raise exception 'FAIL 6af: the photo task was left open'; end if;
  if pg_temp.try(format('update public.skin_photos set clinician_message = ''Changed message here ok'' where id = %L', v_photo)) <> 'ok' then null; end if;
  if (select clinician_message from public.skin_photos where id = v_photo) <> 'Please book a visit so we can look at it.' then raise exception 'FAIL 6ag: a completed review was edited'; end if;

  -- withdraw, and retention helpers
  insert into storage.objects (bucket_id, name, metadata) values ('skin-photos', v_p1 || '/proof-2.jpg', '{"size": 5000, "mimetype": "image/png"}');
  perform pg_temp.act(v_p1);
  v_j := public.register_skin_photo(v_p1, v_p1 || '/proof-2.jpg', 'arm_or_hand', null, true, 'v1');
  v_photo2 := (v_j ->> 'photo_id')::uuid;
  v_j := public.withdraw_skin_photo(v_photo2);
  perform pg_temp.back();
  if v_j ->> 'status' <> 'withdrawn' then raise exception 'FAIL 6ah: withdraw failed'; end if;
  if not exists (select 1 from public.skin_photos_due_for_purge() d where d.id = v_photo2) then raise exception 'FAIL 6ai: a withdrawn photo is not due for removal'; end if;
  if exists (select 1 from public.skin_photos_due_for_purge() d where d.id = v_photo) then raise exception 'FAIL 6aj: a fresh photo is due for removal'; end if;
  perform pg_temp.act(v_p1);
  if pg_temp.try('select * from public.skin_photos_due_for_purge()') <> '42501' then raise exception 'FAIL 6ak: a patient runs the purge list'; end if;
  perform pg_temp.back();
  if pg_temp.try(format('select public.mark_skin_photo_purged(%L)', v_photo)) <> '22023' then raise exception 'FAIL 6al: purged a photo that is not due'; end if;
  perform public.mark_skin_photo_purged(v_photo2);
  if (select status from public.skin_photos where id = v_photo2) <> 'purged' then raise exception 'FAIL 6am: not purged'; end if;

  -- SABOTAGE (b): widen the storage select policy; another patient must then see the file
  begin
    drop policy "skin photo patient select" on storage.objects;
    create policy "skin photo patient select" on storage.objects for select to authenticated using (bucket_id = 'skin-photos');
    perform pg_temp.act(v_p2);
    v_n := pg_temp.scalar('select count(*) from storage.objects where bucket_id = ''skin-photos''')::integer;
    perform pg_temp.back();
    if v_n <= 1 then raise exception 'VACUOUS TEST (b): the widened storage policy did not expose other folders'; end if;
    raise exception 'undo-sabotage-b';
  exception when others then
    perform pg_temp.back();
    if sqlerrm <> 'undo-sabotage-b' then raise; end if;
  end;
  -- SABOTAGE (c): widen the skin_photos policy; another patient must then see the row
  begin
    drop policy skin_photos_select_own on public.skin_photos;
    create policy skin_photos_select_own on public.skin_photos for select to authenticated using (true);
    perform pg_temp.act(v_p2);
    v_n := pg_temp.scalar('select count(id) from public.skin_photos')::integer;
    perform pg_temp.back();
    if v_n = 0 then raise exception 'VACUOUS TEST (c): widened policy still hid the row'; end if;
    raise exception 'undo-sabotage-c';
  exception when others then
    perform pg_temp.back();
    if sqlerrm <> 'undo-sabotage-c' then raise; end if;
  end;

  -- 7. no automated score anywhere, bucket private
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('skin_photos', 'symptom_session_summaries', 'symptom_sessions')
              and column_name ~* '(score|probab|classif|malig|cancer|possible_causes)') then
    raise exception 'FAIL 7a: a score, classification or possible-causes column exists';
  end if;
  if (select public from storage.buckets where id = 'skin-photos') then raise exception 'FAIL 7b: bucket is public'; end if;

  raise notice 'PASS: S59 sessions view, audited reads, context, summary hand-off (acceptance), skin photos RLS/consent/retention/review';
end $$;

rollback;
