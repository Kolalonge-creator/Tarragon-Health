-- Proof (S59d): a clinician's SIGNED consultation diagnosis feeds the symptom checker accuracy audit automatically.
--
--   1. The chain: assessment -> sent summary tied to a booking -> completed encounter -> signed note with an ICD-10 code gives exactly one
--      outcome row, in either order (note signed last, or encounter completed last), with the signer as provenance and ids only in the event.
--      Idempotent. Nothing is written for a draft note, a note with no code, a summary never tied to the booking, or an unfinished encounter.
--   2. Until the CMO confirms a map the code is stored with mapped_category, mapping_version and agrees all NULL and the audit does not
--      count it (no baseline from it). A non-CMO cannot confirm. Confirming fills the NULLs once: agrees compares the mapped category with the
--      category the patient was GIVEN (override first); the longest prefix wins; an unmapped code stays NULL; a computed mapping cannot be edited.
--   3. A signed amendment retracts the original's row (never deleted, event written); a coded amendment writes its own row; a code-less one writes
--      none. A retracted row cannot be changed; no row can be deleted or have its identity edited.
--   4. Access: the table has no policy and no grant for anyone. Patient, other patient, care coordinator, admin and anon are refused outright;
--      an untied reviewing clinician is denied and the denial audited; a tied clinician reads one assessment and the read is audited.
--   5. Audit: with a confirmed map the monthly audit counts the auto rows and shows a 'source' breakdown with Wilson intervals; a manual review of
--      the same assessment is counted once (manual wins); a one-case source cell is suppressed AND takes the other cell with it; no person id is in
--      a report; test-account outcomes are excluded.
--   5b-5e (review fixes): deleting an encounter or appointment behind an outcome succeeds; reproductive_health (pregnancy sessions and O-codes) is not
--   reachable through break-glass, the tie still is, and a not_found read is audited; a report with auto rows carries a selection-bias caveat; a failing
--      audit insert never blocks signing or completion and one failing note does not stop the next.
--   6. The feed never blocks care: with the link function broken, signing a note and completing an encounter still succeed and the failure is audited.
--   SABOTAGE: (a) the guard trigger dropped, a delete must succeed; (b) both feed triggers dropped, a fresh flow must write nothing; (c) the tie check
--   made always-true, the untied clinician must get in; (d) a select policy and grant added, the patient must read the table. The unmapped-row filter
--   of the audit is proven by check 2b (non-vacuous: an unmapped real outcome exists and the report counts none).
-- Wrapped in BEGIN/ROLLBACK; fails loudly with raise exception. NOT RUN against the real schema by its author (Docker was down); the SQL of the
-- migration was exercised against a stub schema on Postgres 16 with the same scenario.
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
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.scalar(p_sql text) returns text language plpgsql as
$f$ declare v text; begin execute p_sql into v; return v; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's59d-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language, sex, state)
  values (v, p_org, p_role::public.user_role, 'S59d ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test, 'en', 'female', 'Lagos')
  on conflict (id) do update set role = excluded.role, is_test = excluded.is_test, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name, sex = excluded.sex, state = excluded.state;
  return v;
end $f$;
create function pg_temp.mkstaff(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, case when p_tier = 'care_coordinator' then 'care_coordinator' else 'clinician' end);
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'S59d ' || p_label, 'MDCN', 'S59D-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true, array['en'], 'General practice');
  return v;
end $f$;

-- the full chain up to a DRAFT note carrying a code, written by the clinician through the real functions
create function pg_temp.flow(p_org uuid, p_patient uuid, p_clin uuid, p_cat text, p_code text, p_tied boolean default true) returns jsonb
language plpgsql as $f$
declare v_a uuid; v_vc uuid; v_appt uuid; v_enc uuid; v_note uuid;
begin
  insert into public.symptom_triage_assessments
    (organisation_id, patient_id, presenting_complaint_key, protocol_version, initial_capture, questions_asked, red_flag_screen,
     category, clinician_review_required, safety_net_message_key, rationale)
  values (p_org, p_patient, 'headache', (select min(version) from public.triage_protocols), '{}', '[]', '{}', p_cat::public.triage_category, false, 'routine', 'S59d proof')
  returning id into v_a;
  insert into public.video_consultations (organisation_id, patient_id, context, initiated_by, status, scheduled_at)
  values (p_org, p_patient, 'general_checkin', p_patient, 'scheduled', now() + interval '1 hour') returning id into v_vc;
  insert into public.appointments (organisation_id, patient_id, clinician_id, scheduled_for, ends_at, status, appointment_type, consultation_method, video_consultation_id)
  values (p_org, p_patient, p_clin, now() + interval '1 hour', now() + interval '90 minutes', 'booked', 'telemedicine', 'telemedicine', v_vc) returning id into v_appt;
  insert into public.symptom_session_summaries (organisation_id, assessment_id, patient_id, recorded_by, payload, appointment_id, linked_at)
  values (p_org, v_a, p_patient, p_patient, '{"proof": true}', case when p_tied then v_appt end, case when p_tied then now() end);
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, started_at, appointment_id, video_consultation_id, policy_version, is_test)
  values (p_org, p_patient, p_clin, 'video', 'in_progress', now(), now(), v_appt, v_vc, private.consult_policy_version(), true) returning id into v_enc;
  perform pg_temp.act(p_clin);
  v_note := public.create_encounter_note(p_patient, 'video_consult', 'S59d proof visit', p_video_consultation_id := v_vc);
  if p_code is not null then perform public.set_encounter_note_diagnosis_code(v_note, p_code); end if;
  perform pg_temp.back();
  return jsonb_build_object('a', v_a, 'enc', v_enc, 'note', v_note, 'vc', v_vc, 'appt', v_appt);
end $f$;
create function pg_temp.sign(p_clin uuid, p_note uuid) returns void language plpgsql as
$f$ begin
  perform pg_temp.act(p_clin);
  perform public.finalize_encounter_note(p_note, 'reassurance'::public.consultation_outcome, true);
  perform pg_temp.back();
end $f$;
create function pg_temp.complete(p_clin uuid, p_enc uuid) returns void language plpgsql as
$f$ begin
  perform pg_temp.act(p_clin);
  perform public.complete_encounter(p_enc);
  perform pg_temp.back();
end $f$;

-- this proof uses test patients; the age gate itself is proven in s59b_children_members_and_closed_staff_read.sql
alter table public.symptom_triage_assessments disable trigger symptom_triage_assessments_01_age_gate;
-- patient 1 is a REAL account in this proof (so the real-basis audit has something to refuse to count); the go-live guard is proven in f1_symptom_checker_go_live_guard.sql
alter table public.symptom_triage_assessments disable trigger symptom_triage_assessments_00_go_live_guard;

do $$
declare
  v_org uuid; v_admin uuid; v_p uuid; v_q uuid; v_c1 uuid; v_c2 uuid; v_cmo uuid; v_cc uuid; v_realp uuid;
  f jsonb; f2 jsonb; i integer; v_j jsonb; v_o public.symptom_encounter_outcomes%rowtype; v_rep uuid; v_cell jsonb; v_n integer;
  v_amend uuid; v_aid uuid; v_aidp uuid; v_oid uuid; v_before integer;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  if not exists (select 1 from public.triage_protocols) then raise exception 'fixture: need a triage_protocols row'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_p := pg_temp.mkuser(v_org, 'patient1', 'patient', false);
  v_q := pg_temp.mkuser(v_org, 'patient2', 'patient');
  v_c1 := pg_temp.mkstaff(v_org, v_admin, 'tied', 'senior_medical_officer');
  v_c2 := pg_temp.mkstaff(v_org, v_admin, 'untied', 'senior_medical_officer');
  v_cmo := pg_temp.mkstaff(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_cc := pg_temp.mkstaff(v_org, v_admin, 'coordinator', 'care_coordinator');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, v_p, v_c1), (v_org, v_q, v_c1);
  -- the shipped state: the map is a draft and nothing is active
  if exists (select 1 from public.symptom_diagnosis_urgency_maps where is_active or confirmed_at is not null) then raise exception 'FAIL 0a: a map is active or confirmed in the shipped data'; end if;
  if not exists (select 1 from public.symptom_diagnosis_urgency_maps where version = 1 and not is_active) then raise exception 'FAIL 0b: map v1 missing'; end if;

  -- 1. the chain, completion last
  f := pg_temp.flow(v_org, v_p, v_c1, 'urgent', 'B50.9');
  perform pg_temp.sign(v_c1, (f ->> 'note')::uuid);
  if exists (select 1 from public.symptom_encounter_outcomes where assessment_id = (f ->> 'a')::uuid) then raise exception 'FAIL 1a: a row before the consultation was completed'; end if;
  perform pg_temp.complete(v_c1, (f ->> 'enc')::uuid);
  select * into v_o from public.symptom_encounter_outcomes where assessment_id = (f ->> 'a')::uuid;
  if v_o.id is null then raise exception 'FAIL 1b: no outcome after completion'; end if;
  if v_o.diagnosis_code <> 'B50.9' or v_o.recorded_by <> v_c1 or v_o.checker_category <> 'urgent' or v_o.given_category <> 'urgent' or v_o.source <> 'encounter_auto' or v_o.status <> 'active' then
    raise exception 'FAIL 1c: row wrong %', to_jsonb(v_o);
  end if;
  if (select count(*) from public.domain_events where event_type = 'symptom_outcome.recorded' and payload ->> 'outcome_id' = v_o.id::text) <> 1 then raise exception 'FAIL 1d: expected exactly one symptom_outcome.recorded event'; end if;
  if exists (select 1 from public.domain_events e, jsonb_object_keys(e.payload) k where e.event_type = 'symptom_outcome.recorded' and e.payload ->> 'outcome_id' = v_o.id::text and k not in ('outcome_id', 'assessment_id')) then raise exception 'FAIL 1e: the event carries more than ids'; end if;
  if private.record_symptom_outcomes_for_note((f ->> 'note')::uuid) <> 0 then raise exception 'FAIL 1f: not idempotent'; end if;
  if (select count(*) from public.symptom_encounter_outcomes where assessment_id = (f ->> 'a')::uuid) <> 1 then raise exception 'FAIL 1g: duplicate row'; end if;
  -- the other order: completion first, signature last
  f2 := pg_temp.flow(v_org, v_p, v_c1, 'routine', 'G43.9');
  perform pg_temp.complete(v_c1, (f2 ->> 'enc')::uuid);
  if exists (select 1 from public.symptom_encounter_outcomes where assessment_id = (f2 ->> 'a')::uuid) then raise exception 'FAIL 1h: a row for an unsigned note'; end if;
  perform pg_temp.sign(v_c1, (f2 ->> 'note')::uuid);
  if not exists (select 1 from public.symptom_encounter_outcomes where assessment_id = (f2 ->> 'a')::uuid) then raise exception 'FAIL 1i: no row when the note was signed last'; end if;
  -- no code, summary never tied, encounter not completed
  f := pg_temp.flow(v_org, v_p, v_c1, 'urgent', null);
  perform pg_temp.sign(v_c1, (f ->> 'note')::uuid); perform pg_temp.complete(v_c1, (f ->> 'enc')::uuid);
  if exists (select 1 from public.symptom_encounter_outcomes where assessment_id = (f ->> 'a')::uuid) then raise exception 'FAIL 1j: a note with no code wrote a row'; end if;
  f := pg_temp.flow(v_org, v_p, v_c1, 'urgent', 'B50.9', false);
  perform pg_temp.sign(v_c1, (f ->> 'note')::uuid); perform pg_temp.complete(v_c1, (f ->> 'enc')::uuid);
  if exists (select 1 from public.symptom_encounter_outcomes where assessment_id = (f ->> 'a')::uuid) then raise exception 'FAIL 1k: a summary never tied to the booking wrote a row'; end if;
  f := pg_temp.flow(v_org, v_p, v_c1, 'urgent', 'B50.9');
  perform pg_temp.sign(v_c1, (f ->> 'note')::uuid);
  if exists (select 1 from public.symptom_encounter_outcomes where assessment_id = (f ->> 'a')::uuid) then raise exception 'FAIL 1l: an unfinished encounter wrote a row'; end if;
  -- the note's code is checked
  perform pg_temp.act(v_c1);
  if pg_temp.try(format('select public.set_encounter_note_diagnosis_code(%L, %L)', (f ->> 'note')::uuid, 'B50.9')) <> '42501' then raise exception 'FAIL 1m: a signed note''s code could be set'; end if;
  perform pg_temp.back();

  -- 2. no confirmed map: stored, not computed, not counted
  select * into v_o from public.symptom_encounter_outcomes where diagnosis_code = 'B50.9' and patient_id = v_p order by created_at limit 1;
  if v_o.mapped_category is not null or v_o.mapping_version is not null or v_o.agrees is not null then raise exception 'FAIL 2a: a value was computed without a confirmed map'; end if;
  update public.symptom_accuracy_config set config = jsonb_set(config, '{min_cell_size}', '5') where is_active;
  -- the REAL basis (patient 1 is a real account): the unmapped outcomes exist for it and are not counted, and the empty report is no baseline
  v_rep := private.run_symptom_accuracy_audit(v_org, current_date, false, v_admin);
  if (select reviewed_total from public.symptom_accuracy_reports where id = v_rep) <> 0 or (select is_baseline from public.symptom_accuracy_reports where id = v_rep) then
    raise exception 'FAIL 2b: unmapped outcomes were counted or made a baseline';
  end if;
  if not exists (select 1 from public.symptom_encounter_outcomes where patient_id = v_p and mapped_category is null and not is_test) then raise exception 'FAIL 2b0: vacuous, no unmapped real outcome existed'; end if;
  perform pg_temp.act(v_c1);
  if pg_temp.try('select public.confirm_symptom_diagnosis_urgency_map(1)') <> '42501' then raise exception 'FAIL 2c: a clinician confirmed the map'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  if pg_temp.try('select public.confirm_symptom_diagnosis_urgency_map(1)') <> '42501' then raise exception 'FAIL 2d: an admin confirmed the map'; end if;
  perform pg_temp.back();
  -- an override recorded BEFORE the link is the category the patient was given
  f := pg_temp.flow(v_org, v_p, v_c1, 'routine', 'I21.9');
  update public.symptom_triage_assessments set override_category = 'urgent' where id = (f ->> 'a')::uuid;
  perform pg_temp.sign(v_c1, (f ->> 'note')::uuid); perform pg_temp.complete(v_c1, (f ->> 'enc')::uuid);
  perform pg_temp.act(v_cmo);
  v_j := public.confirm_symptom_diagnosis_urgency_map(1);
  perform pg_temp.back();
  if (v_j ->> 'outcomes_mapped')::int < 3 then raise exception 'FAIL 2e: the map was not applied %', v_j; end if;
  select * into v_o from public.symptom_encounter_outcomes where diagnosis_code = 'B50.9' and patient_id = v_p and status = 'active' order by created_at limit 1;
  if v_o.mapped_category <> 'urgent' or v_o.agrees is not true or v_o.mapping_version <> 1 then raise exception 'FAIL 2f %', to_jsonb(v_o); end if;
  select * into v_o from public.symptom_encounter_outcomes where assessment_id = (f ->> 'a')::uuid;
  if v_o.given_category <> 'urgent' or v_o.checker_category <> 'routine' or v_o.mapped_category <> 'emergency' or v_o.agrees is not false then raise exception 'FAIL 2g %', to_jsonb(v_o); end if;
  if pg_temp.try(format('update public.symptom_encounter_outcomes set mapped_category = ''self_management'' where id = %L', v_o.id)) <> '42501' then raise exception 'FAIL 2h: a computed mapping was edited'; end if;
  if (select category from private.map_diagnosis_to_category('E10.1')) <> 'emergency' or (select category from private.map_diagnosis_to_category('E10.9')) <> 'routine' then raise exception 'FAIL 2i: the longest prefix must win'; end if;
  if exists (select 1 from private.map_diagnosis_to_category('Z99.9')) then raise exception 'FAIL 2j: an unmapped code got a category'; end if;

  -- 3. amendments
  f := pg_temp.flow(v_org, v_q, v_c1, 'routine', 'R51');
  perform pg_temp.sign(v_c1, (f ->> 'note')::uuid); perform pg_temp.complete(v_c1, (f ->> 'enc')::uuid);
  select id into v_oid from public.symptom_encounter_outcomes where assessment_id = (f ->> 'a')::uuid and status = 'active';
  if v_oid is null then raise exception 'FAIL 3a'; end if;
  perform pg_temp.act(v_c1);
  v_amend := public.create_note_amendment((f ->> 'note')::uuid, 'correction', 'S59d proof: the diagnosis was wrong');
  perform public.set_encounter_note_diagnosis_code(v_amend, 'G00.9');
  perform pg_temp.back();
  perform pg_temp.sign(v_c1, v_amend);
  if (select status from public.symptom_encounter_outcomes where id = v_oid) <> 'retracted' then raise exception 'FAIL 3b: the original was not retracted'; end if;
  if (select count(*) from public.symptom_encounter_outcomes where assessment_id = (f ->> 'a')::uuid and status = 'active' and diagnosis_code = 'G00.9') <> 1 then raise exception 'FAIL 3c: no row from the amendment'; end if;
  if not exists (select 1 from public.domain_events where event_type = 'symptom_outcome.retracted' and payload ->> 'outcome_id' = v_oid::text) then raise exception 'FAIL 3d: no retracted event'; end if;
  f := pg_temp.flow(v_org, v_q, v_c1, 'routine', 'R51');
  perform pg_temp.sign(v_c1, (f ->> 'note')::uuid); perform pg_temp.complete(v_c1, (f ->> 'enc')::uuid);
  perform pg_temp.act(v_c1);
  v_amend := public.create_note_amendment((f ->> 'note')::uuid, 'addendum', 'S59d proof: addendum with no code');
  perform pg_temp.back();
  perform pg_temp.sign(v_c1, v_amend);
  if exists (select 1 from public.symptom_encounter_outcomes where assessment_id = (f ->> 'a')::uuid and status = 'active') then raise exception 'FAIL 3e: a code-less amendment left an active row'; end if;
  if pg_temp.try(format('delete from public.symptom_encounter_outcomes where id = %L', v_oid)) <> '42501' then raise exception 'FAIL 3f: a row was deleted'; end if;
  if pg_temp.try(format('update public.symptom_encounter_outcomes set diagnosis_code = ''A01'' where id = %L', v_oid)) <> '42501' then raise exception 'FAIL 3g: a code was edited'; end if;
  if pg_temp.try(format('update public.symptom_encounter_outcomes set status = ''active'', retracted_at = null, retracted_reason = null where id = %L', v_oid)) <> '42501' then raise exception 'FAIL 3h: a retraction was undone'; end if;

  -- 4. access
  select assessment_id into v_aid from public.symptom_encounter_outcomes where patient_id = v_p order by created_at limit 1;
  v_aidp := v_aid;
  foreach v_n in array array[1, 2, 3, 4] loop
    perform pg_temp.act(case v_n when 1 then v_p when 2 then v_q when 3 then v_cc else v_admin end);
    if pg_temp.try('select count(id) from public.symptom_encounter_outcomes') <> '42501' then raise exception 'FAIL 4a: role % reads the table', v_n; end if;
    if pg_temp.try(format('select public.read_symptom_outcome_audited(%L, %L)', v_aid, 'proof read by a role that must be refused')) <> '42501' then raise exception 'FAIL 4b: role % reads through the function', v_n; end if;
    perform pg_temp.back();
  end loop;
  perform pg_temp.act_anon();
  if pg_temp.try('select count(id) from public.symptom_encounter_outcomes') <> '42501' then raise exception 'FAIL 4c: anon reads the table'; end if;
  if pg_temp.try(format('select public.read_symptom_outcome_audited(%L, %L)', v_aid, 'proof read by anon')) <> '42501' then raise exception 'FAIL 4d: anon reads through the function'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_c2);
  v_j := public.read_symptom_outcome_audited(v_aid, 'untied clinician looking (proof)');
  perform pg_temp.back();
  if v_j ->> 'status' <> 'denied' then raise exception 'FAIL 4e: an untied clinician got %', v_j; end if;
  if not exists (select 1 from public.audit_log where actor_id = v_c2 and subject_patient_id = v_p and result = 'denied' and reason = 'untied clinician looking (proof)') then raise exception 'FAIL 4f: the denial was not audited'; end if;
  perform pg_temp.act(v_c1);
  v_j := public.read_symptom_outcome_audited(v_aid, 'tied clinician reviewing (proof)');
  perform pg_temp.back();
  if v_j ->> 'status' <> 'ok' or jsonb_array_length(v_j -> 'outcomes') <> 1 then raise exception 'FAIL 4g: the tied read wrong %', v_j; end if;
  if v_j::text ~* '(patient_id|full_name|payload)' then raise exception 'FAIL 4h: the read carries more than the outcome'; end if;
  if not exists (select 1 from public.audit_log where actor_id = v_c1 and subject_patient_id = v_p and result = 'success' and reason = 'tied clinician reviewing (proof)') then raise exception 'FAIL 4i: the read was not audited'; end if;
  perform pg_temp.act(v_c1);
  if pg_temp.try(format('select public.read_symptom_outcome_audited(%L, %L)', v_aid, 'short')) <> '22023' then raise exception 'FAIL 4j: a read without a reason'; end if;
  perform pg_temp.back();
  if has_table_privilege('authenticated', 'public.symptom_encounter_outcomes', 'SELECT') or exists (select 1 from pg_policy where polrelid = 'public.symptom_encounter_outcomes'::regclass) then
    raise exception 'FAIL 4k: the table has a grant or a policy';
  end if;

  -- 5. the audit with a confirmed map: the auto rows count, with a source breakdown; a manual review for the same assessment is counted once
  for i in 1 .. 6 loop
    f := pg_temp.flow(v_org, v_p, v_c1, case when i <= 4 then 'urgent' else 'routine' end, 'B50.9');
    perform pg_temp.sign(v_c1, (f ->> 'note')::uuid); perform pg_temp.complete(v_c1, (f ->> 'enc')::uuid);
  end loop;
  select count(*) into v_before from public.symptom_encounter_outcomes where status = 'active' and mapped_category is not null;
  -- one assessment also has a completed manual review: the manual review wins and the assessment is counted once
  insert into public.symptom_reviews (organisation_id, assessment_id, patient_id, status, recorded_by, protocol_version, clinician_id, final_diagnosis_code, clinician_category, agrees, patient_message, reviewed_at, is_test)
    select v_org, assessment_id, patient_id, 'completed', patient_id, protocol_version, v_c1, 'B50.9', 'urgent', (checker_category = 'urgent'), 'Your care team reviewed this check.', now(), true
      from public.symptom_encounter_outcomes where status = 'active' and diagnosis_code = 'B50.9' order by created_at desc limit 1;
  v_rep := private.run_symptom_accuracy_audit(v_org, current_date, true, v_admin);
  select cells into v_j from public.symptom_accuracy_reports where id = v_rep;
  select c into v_cell from jsonb_array_elements(v_j) c where c ->> 'dimension' = 'overall';
  if (v_cell ->> 'n')::int <> v_before then raise exception 'FAIL 5a: counted % (expected % : every computed active row, the manually reviewed assessment once)', v_cell ->> 'n', v_before; end if;
  if not exists (select 1 from jsonb_array_elements(v_j) c where c ->> 'dimension' = 'source') then raise exception 'FAIL 5b: no source breakdown'; end if;
  select count(*) into v_n from jsonb_array_elements(v_j) c where c ->> 'dimension' = 'source' and (c ->> 'suppressed')::boolean;
  if v_n <> 2 then raise exception 'FAIL 5c: the one-case manual cell and the auto cell must both be suppressed (complementary), got % suppressed in %', v_n, v_j; end if;
  if not ((v_cell ->> 'match_low')::numeric <= (v_cell ->> 'match_rate')::numeric and (v_cell ->> 'match_rate')::numeric <= (v_cell ->> 'match_high')::numeric) then raise exception 'FAIL 5d: interval does not bracket the rate'; end if;
  if v_j::text ~* (v_p::text || '|' || v_q::text || '|' || v_c1::text) then raise exception 'FAIL 5e: a person id is in a report'; end if;
  if (select not publishable from public.symptom_accuracy_reports where id = v_rep) is not true then raise exception 'FAIL 5f: publishable'; end if;
  -- 5b (review fix, MEDIUM 4): deleting an encounter or an appointment behind an outcome succeeds (the foreign keys set the link to NULL); the
  -- row and its code stay; a link can be cleared but never re-pointed. (A sent summary cannot be deleted directly by design; it goes only with its patient.)
  f := pg_temp.flow(v_org, v_q, v_c1, 'urgent', 'B50.9'); perform pg_temp.sign(v_c1, (f ->> 'note')::uuid); perform pg_temp.complete(v_c1, (f ->> 'enc')::uuid);
  select id into v_oid from public.symptom_encounter_outcomes where assessment_id = (f ->> 'a')::uuid;
  if v_oid is null then raise exception 'FAIL 5b0: no outcome to delete around'; end if;
  delete from public.encounters where id = (f ->> 'enc')::uuid;
  delete from public.appointments where id = (f ->> 'appt')::uuid;
  select * into v_o from public.symptom_encounter_outcomes where id = v_oid;
  if v_o.id is null or v_o.encounter_id is not null or v_o.appointment_id is not null or v_o.diagnosis_code <> 'B50.9' then raise exception 'FAIL 5b1: deleting the encounter or appointment broke the outcome: %', to_jsonb(v_o); end if;
  if pg_temp.try(format('update public.symptom_encounter_outcomes set encounter_id = (select id from public.encounters limit 1) where id = %L', v_oid)) <> '42501' then raise exception 'FAIL 5b2: a link was re-pointed'; end if;
  -- the same for a RETRACTED row
  f := pg_temp.flow(v_org, v_q, v_c1, 'routine', 'R51'); perform pg_temp.sign(v_c1, (f ->> 'note')::uuid); perform pg_temp.complete(v_c1, (f ->> 'enc')::uuid);
  perform pg_temp.act(v_c1); v_amend := public.create_note_amendment((f ->> 'note')::uuid, 'correction', 'S59d proof: retract then delete the encounter'); perform pg_temp.back();
  perform pg_temp.sign(v_c1, v_amend);
  delete from public.encounters where id = (f ->> 'enc')::uuid;
  if (select encounter_id from public.symptom_encounter_outcomes where assessment_id = (f ->> 'a')::uuid and status = 'retracted') is not null then raise exception 'FAIL 5b3: a retracted row''s link was not cleared'; end if;

  -- 5c (review fix, MEDIUM 5): reproductive_health is never available through break-glass. A pregnancy pathway session, or an outcome with a
  -- pregnancy (chapter O) code, is read under that category: the tie works, an emergency-access grant does not. Other outcomes stay readable through break-glass.
  f := pg_temp.flow(v_org, v_q, v_c1, 'urgent', 'O14.9'); perform pg_temp.sign(v_c1, (f ->> 'note')::uuid); perform pg_temp.complete(v_c1, (f ->> 'enc')::uuid);
  v_aid := (f ->> 'a')::uuid;
  f2 := pg_temp.flow(v_org, v_q, v_c1, 'urgent', 'B50.9'); perform pg_temp.sign(v_c1, (f2 ->> 'note')::uuid); perform pg_temp.complete(v_c1, (f2 ->> 'enc')::uuid);
  v_aidp := (f2 ->> 'a')::uuid;
  insert into public.emergency_record_access_grants (patient_id, patient_org_id, requester_id, requester_org_id, reason, expires_at)
    values (v_q, v_org, v_c2, v_org, 'S59d proof break-glass', now() + interval '1 hour');
  perform pg_temp.act(v_c2);
  v_j := public.read_symptom_outcome_audited(v_aidp, 'break glass on a non-reproductive outcome');
  if v_j ->> 'status' <> 'ok' then raise exception 'FAIL 5c1: break-glass should still reach a non-reproductive outcome, got %', v_j; end if;
  v_j := public.read_symptom_outcome_audited(v_aid, 'break glass on a pregnancy-coded outcome');
  if v_j ->> 'status' <> 'denied' then raise exception 'FAIL 5c2: break-glass reached an O-coded outcome: %', v_j; end if;
  perform pg_temp.back();
  if not exists (select 1 from public.audit_log where actor_id = v_c2 and subject_patient_id = v_q and result = 'denied' and reason = 'break glass on a pregnancy-coded outcome') then raise exception 'FAIL 5c3: the refusal was not audited'; end if;
  perform pg_temp.act(v_c1);
  v_j := public.read_symptom_outcome_audited(v_aid, 'tied clinician on a pregnancy-coded outcome');
  if v_j ->> 'status' <> 'ok' then raise exception 'FAIL 5c4: the tie should reach it: %', v_j; end if;
  v_j := public.read_symptom_outcome_audited(gen_random_uuid(), 'looking for something that is not there');
  if v_j ->> 'status' <> 'not_found' then raise exception 'FAIL 5c5'; end if;
  perform pg_temp.back();
  if not exists (select 1 from public.audit_log where action = 'symptom_outcome.read_not_found' and actor_id = v_c1) then raise exception 'FAIL 5c6: a not_found read was not audited'; end if;
  -- a pregnancy pathway session with no outcome yet is also reproductive
  insert into public.symptom_triage_assessments (organisation_id, patient_id, presenting_complaint_key, protocol_version, initial_capture, questions_asked, red_flag_screen, category, clinician_review_required, safety_net_message_key, rationale)
    values (v_org, v_q, 'pregnancy_danger_signs', (select min(version) from public.triage_protocols), '{}', '[]', '{}', 'urgent', false, 'routine', 'S59d proof') returning id into v_aid;
  perform pg_temp.act(v_c2);
  v_j := public.read_symptom_outcome_audited(v_aid, 'break glass on a pregnancy session');
  perform pg_temp.back();
  if v_j ->> 'status' <> 'denied' then raise exception 'FAIL 5c7: break-glass reached a pregnancy pathway session'; end if;

  -- 5d (review fix, LOW 6): the report says it includes auto-fed rows and why that is a selected group
  if not (select includes_auto_outcomes from public.symptom_accuracy_reports where id = v_rep) or (select caveat from public.symptom_accuracy_reports where id = v_rep) !~ 'selected group' then
    raise exception 'FAIL 5d: a report with auto rows carries no caveat';
  end if;

  -- 5e (review fix, LOW 7): a failing audit insert never blocks signing or completion, and one failing note does not stop the next
  alter table public.audit_log add constraint s59d_no_link_error check (action <> 'symptom_outcome.link_error');
  alter function private.record_symptom_outcomes_for_note(uuid) rename to record_orig;
  create function private.record_symptom_outcomes_for_note(p_note uuid) returns integer language plpgsql as $q$
  begin
    if current_setting('s59d.fail_first', true) = 'on' then perform set_config('s59d.fail_first', 'off', true); raise exception 'sabotaged link'; end if;
    return private.record_orig(p_note);
  end $q$;
  f := pg_temp.flow(v_org, v_q, v_c1, 'urgent', 'A01');
  perform pg_temp.act(v_c1);
  v_amend := public.create_encounter_note(v_q, 'video_consult', 'S59d proof second note', p_video_consultation_id := (f ->> 'vc')::uuid);
  perform public.set_encounter_note_diagnosis_code(v_amend, 'B50.9');
  perform pg_temp.back();
  perform pg_temp.sign(v_c1, (f ->> 'note')::uuid); perform pg_temp.sign(v_c1, v_amend);
  perform set_config('s59d.fail_first', 'on', true);
  perform pg_temp.complete(v_c1, (f ->> 'enc')::uuid);
  if (select status from public.encounters where id = (f ->> 'enc')::uuid) <> 'completed' then raise exception 'FAIL 5e1: a failing link with a failing audit insert blocked the completion'; end if;
  if not exists (select 1 from public.symptom_encounter_outcomes where assessment_id = (f ->> 'a')::uuid) then raise exception 'FAIL 5e2: the first failing note stopped the next one'; end if;
  alter table public.audit_log drop constraint s59d_no_link_error;
  drop function private.record_symptom_outcomes_for_note(uuid);
  alter function private.record_orig(uuid) rename to record_symptom_outcomes_for_note;

  -- 6. the feed never blocks care
  create or replace function private.record_symptom_outcomes_for_note(p_note uuid) returns integer language plpgsql as $q$ begin raise exception 'sabotaged link'; end $q$;
  f := pg_temp.flow(v_org, v_p, v_c1, 'urgent', 'B50.9');
  perform pg_temp.sign(v_c1, (f ->> 'note')::uuid);
  if (select status from public.clinical_encounter_notes where id = (f ->> 'note')::uuid) <> 'finalized' then raise exception 'FAIL 6a: a failing feed blocked the signature'; end if;
  perform pg_temp.complete(v_c1, (f ->> 'enc')::uuid);
  if (select status from public.encounters where id = (f ->> 'enc')::uuid) <> 'completed' then raise exception 'FAIL 6b: a failing feed blocked the completion'; end if;
  if not exists (select 1 from public.audit_log where action = 'symptom_outcome.link_error' and entity_id = (f ->> 'note')::uuid) then raise exception 'FAIL 6c: the failure was not audited'; end if;

  -- SABOTAGE (a): the guard trigger dropped, a delete must now succeed
  drop trigger symptom_encounter_outcomes_00_guard on public.symptom_encounter_outcomes;
  if pg_temp.try(format('delete from public.symptom_encounter_outcomes where id = %L', v_oid)) <> 'ok' then raise exception 'VACUOUS TEST (a): with the guard dropped a delete was still refused'; end if;
  -- SABOTAGE (b): both feed triggers dropped, a fresh flow must write nothing (the part-1 checks would fail)
  drop trigger clinical_encounter_notes_zz_symptom_outcome on public.clinical_encounter_notes;
  drop trigger encounters_zz_symptom_outcome on public.encounters;
  f := pg_temp.flow(v_org, v_q, v_c1, 'urgent', 'B50.9'); perform pg_temp.sign(v_c1, (f ->> 'note')::uuid); perform pg_temp.complete(v_c1, (f ->> 'enc')::uuid);
  if exists (select 1 from public.symptom_encounter_outcomes where assessment_id = (f ->> 'a')::uuid) then raise exception 'VACUOUS TEST (b): with the triggers dropped a row was still written'; end if;
  -- SABOTAGE (c): the tie check always true, the untied clinician must be let in
  create or replace function private.can_staff_read_clinical(p_patient uuid, p_category public.care_access_category) returns boolean language sql as $q$ select true $q$;
  perform pg_temp.act(v_c2);
  v_j := public.read_symptom_outcome_audited(v_aid, 'untied clinician looking after sabotage');
  perform pg_temp.back();
  if v_j ->> 'status' <> 'ok' then raise exception 'VACUOUS TEST (c): with the tie check open the untied clinician was still denied'; end if;
  -- SABOTAGE (d): a select grant and policy added, the patient must read the table
  grant select on public.symptom_encounter_outcomes to authenticated;
  create policy sabotage on public.symptom_encounter_outcomes for select to authenticated using (true);
  perform pg_temp.act(v_p);
  if pg_temp.try('select count(id) from public.symptom_encounter_outcomes') <> 'ok' then raise exception 'VACUOUS TEST (d): with a policy and grant the patient was still refused'; end if;
  perform pg_temp.back();

  raise notice 'PASS: S59d outcome feed: chain in either order, nothing for drafts/no code/untied summary, unmapped not counted, CMO-only map, amendments retract, no staff-wide read, audited tied read, audit source breakdown with suppression, feed never blocks care';
end $$;

rollback;
