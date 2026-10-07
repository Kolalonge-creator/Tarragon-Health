-- Proof (S60, spec 12.10, INV-10, INV-12, INV-14): doctor review of a symptom check.
--
--   1. The guard closes the review path: for a real patient with symptom_checker_enabled off, request_symptom_review refuses (42501).
--   2. A recorded assessment writes one symptom_check.completed event (ids only).
--   3. A patient asks for a review: idempotent, one review per assessment, a clinical task `symptom_review` is created, and with the
--      active escalation SLA lacking symptom_triage NO review time is stated or invented. After a (fixture) signed SLA it is stated.
--   4. Access by role. Patient: own row only, only the patient columns (not the diagnosis code or the internal note). Another patient,
--      a clinician with no tie, an admin, a care coordinator and anon: no row, and no write by anyone through the table.
--   5. Staff go through audited functions: a clinician WITHOUT a tie is denied and the denial is audited; a care coordinator is refused
--      outright; a tied clinician reads, and every read leaves an audit row with the reason.
--   6. Completion: agreement must be consistent, the event symptom_review.completed is written (ids only), the patient then sees the
--      clinician's plain message, and a completed review can never be changed or deleted.
--   SABOTAGE: (a) the completed-row guard trigger dropped, the edit must succeed; (b) the select policy widened to true, another patient
--   must then see the row. Each sabotage must flip its check, or the test is vacuous.
-- Wrapped in BEGIN/ROLLBACK; fails loudly with raise exception.
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
  values (v, 's60-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language, sex, state)
  values (v, p_org, p_role::public.user_role, 'S60 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test, 'en', 'female', 'Lagos')
  on conflict (id) do update set role = excluded.role, is_test = excluded.is_test, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name, sex = excluded.sex, state = excluded.state;
  return v;
end $f$;
create function pg_temp.mkstaff(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, case when p_tier = 'care_coordinator' then 'care_coordinator' else 'clinician' end);
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'S60 ' || p_label, 'MDCN', 'S60-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
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
  v_org uuid; v_admin uuid; v_p1 uuid; v_p2 uuid; v_c1 uuid; v_c2 uuid; v_cc uuid;
  v_a1 uuid; v_a2 uuid; v_task uuid; v_task2 uuid; v_rid2 uuid; v_rev jsonb; v_rev2 jsonb; v_rid uuid; v_r text; v_n integer; v_j jsonb; v_ver integer;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  if not exists (select 1 from public.triage_protocols) then raise exception 'fixture: need a triage_protocols row'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_p1 := pg_temp.mkuser(v_org, 'patient1', 'patient');
  v_p2 := pg_temp.mkuser(v_org, 'patient2', 'patient');
  v_c1 := pg_temp.mkstaff(v_org, v_admin, 'tied', 'medical_officer');
  v_c2 := pg_temp.mkstaff(v_org, v_admin, 'untied', 'medical_officer');
  v_cc := pg_temp.mkstaff(v_org, v_admin, 'coordinator', 'care_coordinator');
  -- the tie (INV-12): c1 is on p1's care team. c2 and the coordinator are not tied to anyone.
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, v_p1, v_c1);

  v_a1 := pg_temp.assess(v_org, v_p1, 'urgent');

  -- 1. the guard closes the path for a REAL patient (the assessment above exists only because the patient is a test account)
  update public.profiles set is_test = false where id = v_p1;
  perform pg_temp.act(v_p1);
  v_r := pg_temp.try(format('select public.request_symptom_review(%L)', v_a1));
  perform pg_temp.back();
  if v_r <> '42501' then raise exception 'FAIL 1: with the guard off a real patient got % (expected 42501)', v_r; end if;
  update public.profiles set is_test = true where id = v_p1;

  -- 2. the assessment wrote exactly one symptom_check.completed event, ids only
  select count(*) into v_n from public.domain_events where event_type = 'symptom_check.completed' and aggregate_id = v_a1;
  if v_n <> 1 then raise exception 'FAIL 2a: expected one symptom_check.completed event, got %', v_n; end if;
  if exists (select 1 from public.domain_events where event_type = 'symptom_check.completed' and aggregate_id = v_a1
              and (payload - 'assessment_id') <> '{}'::jsonb) then
    raise exception 'FAIL 2b: the event payload carries more than the assessment id (INV-07)';
  end if;

  -- 3. ask for a review: idempotent, task made, NO invented time while the active SLA lacks symptom_triage
  perform pg_temp.act(v_p1);
  v_rev := public.request_symptom_review(v_a1);
  v_rev2 := public.request_symptom_review(v_a1);
  perform pg_temp.back();
  v_rid := (v_rev ->> 'review_id')::uuid;
  if (v_rev2 ->> 'review_id')::uuid <> v_rid then raise exception 'FAIL 3a: a second request made a second review'; end if;
  if (select count(*) from public.symptom_reviews where assessment_id = v_a1) <> 1 then raise exception 'FAIL 3b: more than one review for one assessment'; end if;
  if (v_rev ->> 'stated_minutes') is not null or (v_rev ->> 'due_at') is not null then
    raise exception 'FAIL 3c: a review time was stated although no signed SLA carries symptom_triage: %', v_rev;
  end if;
  if (public.symptom_review_stated_time() ->> 'stated')::boolean then raise exception 'FAIL 3d: the stated-time function invented a time'; end if;
  if not exists (select 1 from public.clinical_tasks t join public.symptom_reviews r on r.task_id = t.id where r.id = v_rid and t.type = 'symptom_review' and t.patient_id = v_p1) then
    raise exception 'FAIL 3e: no symptom_review clinical task was created';
  end if;

  -- 4. access by role
  perform pg_temp.act(v_p1);
  if pg_temp.scalar('select count(id) from public.symptom_reviews') <> '1' then raise exception 'FAIL 4a: the patient cannot see their own review row'; end if;
  v_r := pg_temp.try('select final_diagnosis_code from public.symptom_reviews');
  if v_r <> '42501' then raise exception 'FAIL 4b: a patient can select the diagnosis code (%)', v_r; end if;
  v_r := pg_temp.try('select internal_note from public.symptom_reviews');
  if v_r <> '42501' then raise exception 'FAIL 4c: a patient can select the internal note (%)', v_r; end if;
  if pg_temp.try('update public.symptom_reviews set status = ''completed''') <> '42501' then raise exception 'FAIL 4d: a patient can update a review'; end if;
  if pg_temp.try('delete from public.symptom_reviews') <> '42501' then raise exception 'FAIL 4e: a patient can delete a review'; end if;
  perform pg_temp.back();
  foreach v_r in array array['p2', 'c1', 'c2', 'admin', 'cc'] loop
    perform pg_temp.act(case v_r when 'p2' then v_p2 when 'c1' then v_c1 when 'c2' then v_c2 when 'admin' then v_admin else v_cc end);
    if pg_temp.scalar('select count(id) from public.symptom_reviews') <> '0' then
      raise exception 'FAIL 4f: role % can read the review table directly (INV-12)', v_r;
    end if;
    perform pg_temp.back();
  end loop;
  perform pg_temp.act_anon();
  if pg_temp.try('select count(id) from public.symptom_reviews') <> '42501' then raise exception 'FAIL 4g: anon can read symptom_reviews'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_p2);
  if pg_temp.try(format('select public.request_symptom_review(%L)', v_a1)) <> '42501' then raise exception 'FAIL 4h: another patient could ask for a review of this assessment'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_c1);
  if pg_temp.try(format('select public.request_symptom_review(%L)', v_a1)) <> '42501' then raise exception 'FAIL 4i: a clinician could request a review as if the patient'; end if;
  perform pg_temp.back();
  if has_function_privilege('anon', 'public.request_symptom_review(uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.read_symptom_review_audited(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_symptom_review(uuid,text,text,public.triage_category,boolean,text,text)', 'EXECUTE') then
    raise exception 'FAIL 4j: anon can execute a review function';
  end if;

  -- 5. staff: audited reads
  perform pg_temp.act(v_c2);
  v_j := public.list_my_symptom_reviews();
  if jsonb_array_length(v_j) <> 0 then raise exception 'FAIL 5a: an untied clinician sees a review in the queue list'; end if;
  v_j := public.read_symptom_review_audited(v_rid, 'checking without a task (proof)');
  perform pg_temp.back();
  if v_j ->> 'status' <> 'denied' then raise exception 'FAIL 5b: an untied clinician read the review: %', v_j; end if;
  if not exists (select 1 from public.audit_log where actor_id = v_c2 and action = 'staff.chart_read' and subject_patient_id = v_p1 and result = 'denied') then
    raise exception 'FAIL 5c: the denied read was not audited';
  end if;
  perform pg_temp.act(v_cc);
  if pg_temp.try(format('select public.read_symptom_review_audited(%L, %L)', v_rid, 'coordinator reading (proof)')) <> '42501' then raise exception 'FAIL 5d: a care coordinator can read a review'; end if;
  if pg_temp.try(format('select public.complete_symptom_review(%L, %L, %L, %L, false, %L)', v_rid, 'G43.9', 'x', 'urgent', 'A message long enough to pass.')) <> '42501' then
    raise exception 'FAIL 5e: a care coordinator can complete a review';
  end if;
  perform pg_temp.back();
  perform pg_temp.act(v_p1);
  if pg_temp.try('select public.list_my_symptom_reviews()') <> '42501' then raise exception 'FAIL 5f: a patient can list the clinician queue'; end if;
  if pg_temp.try(format('select public.read_symptom_review_audited(%L, %L)', v_rid, 'patient reading via staff function')) <> '42501' then raise exception 'FAIL 5g: a patient can use the staff read'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_c1);
  v_j := public.list_my_symptom_reviews();
  if jsonb_array_length(v_j) <> 1 then raise exception 'FAIL 5h: the tied clinician does not see the review in the queue list'; end if;
  if (v_j -> 0) ? 'category' or (v_j -> 0) ? 'complaint' or (v_j -> 0) ? 'name' then raise exception 'FAIL 5i: the queue list leaks symptom or identity'; end if;
  if pg_temp.try(format('select public.read_symptom_review_audited(%L, %L)', v_rid, 'short')) <> '22023' then raise exception 'FAIL 5j: a reason under 10 characters was accepted'; end if;
  v_j := public.read_symptom_review_audited(v_rid, 'reviewing the symptom check (proof)');
  perform pg_temp.back();
  if v_j ->> 'status' <> 'ok' or v_j #>> '{assessment,category}' <> 'urgent' then raise exception 'FAIL 5k: the tied clinician could not read the review: %', v_j; end if;
  if not exists (select 1 from public.audit_log where actor_id = v_c1 and action = 'staff.chart_read' and subject_patient_id = v_p1 and result = 'success'
                  and reason = 'reviewing the symptom check (proof)') then
    raise exception 'FAIL 5l: the allowed read was not audited with its reason';
  end if;

  -- 5m. completing WITHOUT a tie is returned as 'denied' (not raised: a raise would roll the audit row back) and the attempt is recorded
  perform pg_temp.act(v_c2);
  v_j := public.complete_symptom_review(v_rid, 'G43.9', 'Migraine', 'urgent', false, 'A message long enough to pass.');
  perform pg_temp.back();
  if v_j ->> 'status' <> 'denied' or (v_j ->> 'ok')::boolean then raise exception 'FAIL 5m: an untied clinician completing was not returned as denied: %', v_j; end if;
  if not exists (select 1 from public.audit_log where actor_id = v_c2 and action = 'staff.chart_read' and subject_patient_id = v_p1 and result = 'denied'
                  and reason like 'attempted to complete%') then
    raise exception 'FAIL 5n: the denied completion attempt was not recorded';
  end if;
  if (select status from public.symptom_reviews where id = v_rid) <> 'requested' then raise exception 'FAIL 5o: a denied completion changed the review'; end if;

  -- 6. completion. The clinician also holds the claim on the task (as queue_next would have made it), so completing the review finishes it.
  select task_id into v_task from public.symptom_reviews where id = v_rid;
  perform private.apply_task_transition(v_task, 'claimed', 'clinician', v_c1, 'claimed', v_c1, now() + interval '30 minutes');
  insert into public.task_claims (organisation_id, task_id, clinician_id, expires_at, is_test) values (v_org, v_task, v_c1, now() + interval '30 minutes', true);
  perform pg_temp.act(v_c1);
  if pg_temp.try(format('select public.complete_symptom_review(%L, %L, %L, %L, true, %L)', v_rid, 'G43.9', 'x', 'emergency', 'A message long enough to pass.')) <> '22023' then
    raise exception 'FAIL 6a: agreeing with the checker while giving a different category was accepted';
  end if;
  if pg_temp.try(format('select public.complete_symptom_review(%L, %L, %L, %L, false, %L)', v_rid, 'not a code', 'x', 'urgent', 'A message long enough to pass.')) <> '23514' then
    raise exception 'FAIL 6b: a malformed diagnosis code was accepted';
  end if;
  v_j := public.complete_symptom_review(v_rid, 'g43.9', 'Migraine without aura', 'routine', false, 'Your care team looked at this and suggests an appointment this week.', 'proof note');
  perform pg_temp.back();
  if v_j ->> 'ok' <> 'true' then raise exception 'FAIL 6c: completion failed: %', v_j; end if;
  if not exists (select 1 from public.symptom_reviews where id = v_rid and status = 'completed' and clinician_id = v_c1 and final_diagnosis_code = 'G43.9' and not agrees) then
    raise exception 'FAIL 6d: the completed row is wrong';
  end if;
  if (select state::text from public.clinical_tasks where id = v_task) <> 'completed' then raise exception 'FAIL 6c2: completing the review did not finish the clinician''s task'; end if;
  if exists (select 1 from public.audit_log where action = 'symptom_review.task_complete_error' and entity_id = v_rid) then raise exception 'FAIL 6c3: closing the task reported an error'; end if;
  if (select count(*) from public.domain_events where event_type = 'symptom_review.completed' and aggregate_id = v_rid and (payload - 'review_id' - 'assessment_id') = '{}'::jsonb) <> 1 then
    raise exception 'FAIL 6e: expected exactly one ids-only symptom_review.completed event';
  end if;
  perform pg_temp.act(v_p1);
  if pg_temp.scalar('select patient_message from public.symptom_reviews') is null then raise exception 'FAIL 6f: the patient cannot see the clinician message'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_c1);
  if pg_temp.try(format('select public.complete_symptom_review(%L, %L, %L, %L, false, %L)', v_rid, 'G43.9', 'x', 'urgent', 'A message long enough to pass.')) <> '22023' then
    raise exception 'FAIL 6g: a completed review was completed again';
  end if;
  perform pg_temp.back();
  if pg_temp.try(format('update public.symptom_reviews set final_diagnosis_code = ''A00'' where id = %L', v_rid)) <> '42501' then raise exception 'FAIL 6h: a completed review could be edited'; end if;
  if pg_temp.try(format('delete from public.symptom_reviews where id = %L', v_rid)) <> '42501' then raise exception 'FAIL 6i: a completed review could be deleted'; end if;

  -- 3 (continued): once a signed SLA carries symptom_triage the time IS stated, from that config. (Fixture only, inside this rollback.)
  select version into v_ver from public.escalation_slas where notes like 'DRAFT, UNSIGNED (F1%' limit 1;
  if v_ver is null then raise exception 'fixture: the F1 draft SLA is missing'; end if;
  update public.escalation_slas s set config = d.config, approved_at = now() from (select config from public.escalation_slas where version = v_ver) d where s.is_active;
  if (public.symptom_review_stated_time() ->> 'minutes')::integer <> 1440 then raise exception 'FAIL 3f: the stated time is not read from the signed config: %', public.symptom_review_stated_time(); end if;
  v_a2 := pg_temp.assess(v_org, v_p1, 'routine');
  perform pg_temp.act(v_p1);
  v_rev := public.request_symptom_review(v_a2);
  perform pg_temp.back();
  if (v_rev ->> 'stated_minutes')::integer <> 1440 or (v_rev ->> 'due_at') is null then raise exception 'FAIL 3g: the stated time was not stored from the SLA: %', v_rev; end if;

  -- 6j. completed by a DIFFERENT clinician than the one holding the claim: the task is cancelled with a reason, the live claim is ended, no error is recorded
  select r.id, r.task_id into v_rid2, v_task2 from public.symptom_reviews r where r.assessment_id = v_a2;
  if v_task2 is null then raise exception 'FAIL 6j0: the second review has no task'; end if;
  perform private.apply_task_transition(v_task2, 'claimed', 'clinician', v_c2, 'claimed', v_c2, now() + interval '30 minutes');
  insert into public.task_claims (organisation_id, task_id, clinician_id, expires_at, is_test) values (v_org, v_task2, v_c2, now() + interval '30 minutes', true);
  perform pg_temp.act(v_c1);
  v_j := public.complete_symptom_review(v_rid2, 'G43.9', 'Tension headache', 'routine', true, 'Your care team looked at this and suggests an appointment.');
  perform pg_temp.back();
  if v_j ->> 'ok' <> 'true' then raise exception 'FAIL 6j: completion failed: %', v_j; end if;
  if (select state::text from public.clinical_tasks where id = v_task2) <> 'cancelled' then raise exception 'FAIL 6k: the other clinician''s task was left open after the review was done'; end if;
  if exists (select 1 from public.task_claims where task_id = v_task2 and ended_at is null) then raise exception 'FAIL 6l: the other clinician''s claim is still live'; end if;
  if exists (select 1 from public.audit_log where action = 'symptom_review.task_complete_error' and entity_id = v_rid2) then raise exception 'FAIL 6m: closing the task reported an error'; end if;

  -- SABOTAGE (a): drop the completed-row guard; the same edit must now succeed
  drop trigger symptom_reviews_00_guard on public.symptom_reviews;
  if pg_temp.try(format('update public.symptom_reviews set final_diagnosis_code = ''A00'' where id = %L', v_rid)) <> 'ok' then
    raise exception 'VACUOUS TEST (a): with the guard trigger dropped a completed review was still refused';
  end if;
  -- SABOTAGE (b): widen the select policy; another patient must now see the row
  drop policy symptom_reviews_select_own on public.symptom_reviews;
  create policy symptom_reviews_select_own on public.symptom_reviews for select to authenticated using (true);
  perform pg_temp.act(v_p2);
  v_n := pg_temp.scalar('select count(id) from public.symptom_reviews')::integer;
  perform pg_temp.back();
  if v_n = 0 then raise exception 'VACUOUS TEST (b): with the policy widened another patient still saw no row'; end if;

  raise notice 'PASS: symptom reviews: guard-closed, events ids-only, no invented time, role matrix, audited reads and denials, immutable once completed';
end $$;

rollback;
