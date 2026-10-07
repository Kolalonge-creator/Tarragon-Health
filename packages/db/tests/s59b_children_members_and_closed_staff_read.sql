-- Proof (S59b): children and date of birth, Members only, and the closed org-wide staff read of symptom assessments.
--   1. under 18 and no date of birth are refused by the database (trigger) and by eligibility; a signed paediatric pathway opens it for a child only
--   2. request_symptom_review needs Membership (TM001); an existing review is still returned; entitlement is visible only to the person or a grantee
--   3. symptom_triage_assessments: only the patient and a current grantee read; tied/untied clinician, coordinator, admin, outsider and anon do not;
--      the audited read keeps the tie; the staff UPDATE is gone (override goes through a tied function); monitoring aggregates are admin/CMO only
-- Each protection has a sabotage step that removes it and shows the test would have failed. Wrapped in BEGIN/ROLLBACK.
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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true, p_dob date default (current_date - interval '45 years')::date) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's59b-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language, sex, state)
  values (v, p_org, p_role::public.user_role, 'S59b ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), p_dob, p_test, 'en', 'female', 'Lagos')
  on conflict (id) do update set role = excluded.role, is_test = excluded.is_test, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name, sex = excluded.sex, state = excluded.state;
  return v;
end $f$;
create function pg_temp.mkstaff(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, case when p_tier = 'care_coordinator' then 'care_coordinator' else 'clinician' end);
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'S59b ' || p_label, 'MDCN', 'S59b-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true, array['en'], 'General practice');
  return v;
end $f$;
create function pg_temp.assess(p_org uuid, p_patient uuid, p_category text default 'urgent') returns uuid language plpgsql as
$f$ declare v uuid; begin
  insert into public.symptom_triage_assessments
    (organisation_id, patient_id, presenting_complaint_key, protocol_version, initial_capture, questions_asked, red_flag_screen,
     category, clinician_review_required, safety_net_message_key, rationale)
  values (p_org, p_patient, 'headache', (select min(version) from public.triage_protocols), '{}', '[]', '{}',
          p_category::public.triage_category, false, 'routine', 'S59b proof')
  returning id into v;
  return v;
end $f$;


do $$
declare
  v_org uuid; v_admin uuid; v_p uuid; v_child uuid; v_nodob uuid; v_other uuid; v_cg uuid; v_tied uuid; v_untied uuid; v_cc uuid; v_pa uuid;
  v_a uuid; v_a_child uuid; v_r text; v_n text; v_def text; v_trig text; v_pol text; v_j jsonb; v_ver integer; v_cfg jsonb; v_old_active integer;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_p := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_other := pg_temp.mkuser(v_org, 'outsider', 'patient');
  v_cg := pg_temp.mkuser(v_org, 'carer', 'patient');
  v_child := pg_temp.mkuser(v_org, 'child', 'patient', true, (current_date - interval '10 years')::date);
  v_nodob := pg_temp.mkuser(v_org, 'nodob', 'patient');
  update public.profiles set date_of_birth = null where id = v_nodob;
  v_tied := pg_temp.mkstaff(v_org, v_admin, 'tied', 'medical_officer');
  v_untied := pg_temp.mkstaff(v_org, v_admin, 'untied', 'senior_medical_officer');
  v_cc := pg_temp.mkstaff(v_org, v_admin, 'coordinator', 'care_coordinator');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, v_p, v_tied);
  v_a := pg_temp.assess(v_org, v_p, 'urgent');
  -- the carer holds a current medical_history grant for the patient AND for the child (fixture, triggers off)
  set local session_replication_role = replica;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_p, v_cg, 'view', v_p) returning id into v_pa;
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'medical_history');
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_child, v_cg, 'view', v_child) returning id into v_pa;
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'medical_history');
  set local session_replication_role = origin;

  -- ===== 1. children and date of birth =====
  select tgname into v_trig from pg_trigger where tgrelid = 'public.symptom_triage_assessments'::regclass and tgname = 'symptom_triage_assessments_01_age_gate';
  if v_trig is null then raise exception 'FAIL 1x: the age gate trigger does not exist'; end if;
  v_r := pg_temp.try(format($q$insert into public.symptom_triage_assessments (organisation_id, patient_id, presenting_complaint_key, protocol_version, initial_capture, questions_asked, red_flag_screen, category, clinician_review_required, safety_net_message_key, rationale) values (%L, %L, 'headache', (select min(version) from public.triage_protocols), '{}', '[]', '{}', 'routine', false, 'routine', 'proof')$q$, v_org, v_child));
  if v_r <> '42501' then raise exception 'FAIL 1a: a 10 year old was recorded (%)', v_r; end if;
  v_r := pg_temp.try(format($q$insert into public.symptom_triage_assessments (organisation_id, patient_id, presenting_complaint_key, protocol_version, initial_capture, questions_asked, red_flag_screen, category, clinician_review_required, safety_net_message_key, rationale) values (%L, %L, 'headache', (select min(version) from public.triage_protocols), '{}', '[]', '{}', 'routine', false, 'routine', 'proof')$q$, v_org, v_nodob));
  if v_r <> '42501' then raise exception 'FAIL 1b: a person with no date of birth was recorded (%)', v_r; end if;
  -- control: an adult is recorded (v_a above)
  -- eligibility answers
  perform pg_temp.act(v_p);
  if pg_temp.scalar('select public.symptom_checker_eligibility()::text') <> '{"status": "ok"}' then raise exception 'FAIL 1c: an adult is not ok'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_child);
  if pg_temp.scalar('select public.symptom_checker_eligibility()::text') <> '{"status": "under_18"}' then raise exception 'FAIL 1d: a child is not under_18'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_nodob);
  if pg_temp.scalar('select public.symptom_checker_eligibility()::text') <> '{"status": "dob_required"}' then raise exception 'FAIL 1e: no date of birth is not dob_required'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_cg);
  if pg_temp.scalar(format('select public.symptom_checker_eligibility(%L)::text', v_child)) <> '{"status": "under_18"}' then raise exception 'FAIL 1f: a carer is not told the child is under_18'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_other);
  if pg_temp.try(format('select public.symptom_checker_eligibility(%L)', v_p)) <> '42501' then raise exception 'FAIL 1g: a stranger can ask about someone else'; end if;
  perform pg_temp.back();
  perform pg_temp.act_anon();
  if pg_temp.try('select public.symptom_checker_eligibility()') <> '42501' then raise exception 'FAIL 1h: anon can call eligibility'; end if;
  perform pg_temp.back();
  -- a signed paediatric pathway opens the door for a child (and only then)
  select version into v_old_active from public.triage_protocols where is_active limit 1;
  set local session_replication_role = replica;
  update public.triage_protocols set is_active = false where is_active;
  insert into public.triage_protocols (version, config, notes, is_active)
    values ((select max(version) + 1 from public.triage_protocols), '{"version": 0, "pathways": [{"key": "paediatric_fever"}]}', 'S59b proof only', true);
  set local session_replication_role = origin;
  if private.symptom_checker_age_status(v_child) <> 'ok' then raise exception 'FAIL 1i: a signed paediatric pathway does not open the checker for a child'; end if;
  if private.symptom_checker_age_status(v_nodob) <> 'dob_required' then raise exception 'FAIL 1j: a signed paediatric pathway lets a missing date of birth through'; end if;
  set local session_replication_role = replica;
  delete from public.triage_protocols where notes = 'S59b proof only';
  if v_old_active is not null then update public.triage_protocols set is_active = true where version = v_old_active; end if;
  set local session_replication_role = origin;
  if private.symptom_checker_age_status(v_child) <> 'under_18' then raise exception 'FAIL 1k: the child is not refused again after the proof protocol is removed'; end if;
  -- SABOTAGE: drop the trigger; the child must then be recorded, or the test above is vacuous
  v_def := pg_get_triggerdef((select oid from pg_trigger where tgrelid = 'public.symptom_triage_assessments'::regclass and tgname = 'symptom_triage_assessments_01_age_gate'));
  drop trigger symptom_triage_assessments_01_age_gate on public.symptom_triage_assessments;
  v_a_child := pg_temp.assess(v_org, v_child, 'routine');
  if v_a_child is null then raise exception 'VACUOUS TEST (1): without the trigger the child was still refused'; end if;
  delete from public.symptom_triage_assessments where id = v_a_child;
  execute v_def;

  -- ===== 2. members only =====
  perform pg_temp.act(v_p);
  v_r := pg_temp.try(format('select public.request_symptom_review(%L)', v_a));
  perform pg_temp.back();
  if v_r <> 'TM001' then raise exception 'FAIL 2a: a non-member could ask for a review (%)', v_r; end if;
  if exists (select 1 from public.symptom_reviews where assessment_id = v_a) then raise exception 'FAIL 2b: a refused request created a review'; end if;
  perform pg_temp.act(v_p);
  if pg_temp.scalar('select public.symptom_review_entitled()::text') <> 'false' then raise exception 'FAIL 2c: a non-member reads as entitled'; end if;
  perform pg_temp.back();
  insert into public.patient_memberships (organisation_id, patient_id, source, is_test, granted_by, grant_reason) values (v_org, v_p, 'granted', true, v_admin, 'S59b proof membership');
  perform pg_temp.act(v_p);
  if pg_temp.scalar('select public.symptom_review_entitled()::text') <> 'true' then raise exception 'FAIL 2d: a member does not read as entitled'; end if;
  v_r := pg_temp.try(format('select public.request_symptom_review(%L)', v_a));
  perform pg_temp.back();
  if v_r <> 'ok' then raise exception 'FAIL 2e: a member could not ask for a review (%)', v_r; end if;
  perform pg_temp.act(v_cg);
  if pg_temp.scalar(format('select public.symptom_review_entitled(%L)::text', v_p)) <> 'true' then raise exception 'FAIL 2f: a carer with a grant cannot see the patient is a member'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_other);
  if pg_temp.try(format('select public.symptom_review_entitled(%L)', v_p)) <> '42501' then raise exception 'FAIL 2g: a stranger can ask whether someone is a member'; end if;
  perform pg_temp.back();
  -- a Free person who ends up with a request already on file still sees it (an existing review is returned, not refused)
  update public.patient_memberships set state = 'ended', ended_at = now(), ended_by = v_admin, end_reason = 'S59b proof ended' where patient_id = v_p;
  perform pg_temp.act(v_p);
  v_r := pg_temp.try(format('select public.request_symptom_review(%L)', v_a));
  perform pg_temp.back();
  if v_r <> 'ok' then raise exception 'FAIL 2h: an existing review was refused after the membership ended (%)', v_r; end if;
  -- SABOTAGE: remove the membership gate; a non-member must then get in
  set local session_replication_role = replica;
  delete from public.symptom_reviews where assessment_id = v_a;
  set local session_replication_role = origin;
  v_def := pg_get_functiondef('public.request_symptom_review(uuid)'::regprocedure);
  execute replace(v_def, 'if not found and not private.patient_is_member(a.patient_id) then', 'if false then');
  perform pg_temp.act(v_p);
  v_r := pg_temp.try(format('select public.request_symptom_review(%L)', v_a));
  perform pg_temp.back();
  if v_r <> 'ok' then raise exception 'VACUOUS TEST (2): without the gate a non-member was still refused (%)', v_r; end if;
  execute v_def;
  set local session_replication_role = replica;
  delete from public.symptom_reviews where assessment_id = v_a;
  set local session_replication_role = origin;

  -- ===== 3. the org-wide staff read is closed =====
  foreach v_n in array array['patient', 'carer'] loop
    perform pg_temp.act(case v_n when 'patient' then v_p else v_cg end);
    if pg_temp.scalar('select count(id) from public.symptom_triage_assessments') <> '1' then raise exception 'FAIL 3a: % cannot read the assessment they may read', v_n; end if;
    perform pg_temp.back();
  end loop;
  foreach v_n in array array['tied', 'untied', 'coordinator', 'admin', 'outsider'] loop
    perform pg_temp.act(case v_n when 'tied' then v_tied when 'untied' then v_untied when 'coordinator' then v_cc when 'admin' then v_admin else v_other end);
    if pg_temp.scalar('select count(id) from public.symptom_triage_assessments') <> '0' then raise exception 'FAIL 3b: % reads symptom assessments directly (INV-12)', v_n; end if;
    perform pg_temp.back();
  end loop;
  perform pg_temp.act_anon();
  if pg_temp.try('select count(id) from public.symptom_triage_assessments') <> '42501' then raise exception 'FAIL 3c: anon reads assessments'; end if;
  perform pg_temp.back();
  -- the audited read keeps working, with the tie
  perform pg_temp.act(v_tied);
  v_j := public.read_symptom_session_audited(v_a, 'reviewing a symptom session (proof)');
  perform pg_temp.back();
  if v_j ->> 'status' <> 'ok' then raise exception 'FAIL 3d: the tied clinician cannot read through the audited function'; end if;
  perform pg_temp.act(v_untied);
  v_j := public.read_symptom_session_audited(v_a, 'looking without a tie (proof)');
  perform pg_temp.back();
  if v_j ->> 'status' <> 'denied' then raise exception 'FAIL 3e: an untied clinician read through the audited function'; end if;
  perform pg_temp.act(v_cc);
  if pg_temp.try(format('select public.read_symptom_session_audited(%L, %L)', v_a, 'coordinator reading (proof)')) <> '42501' then raise exception 'FAIL 3f: a coordinator reads'; end if;
  perform pg_temp.back();
  -- the staff UPDATE is gone; the override goes through a tied, audited function
  perform pg_temp.act(v_tied);
  if pg_temp.try(format($q$update public.symptom_triage_assessments set override_category = 'emergency' where id = %L$q$, v_a)) <> '42501' then raise exception 'FAIL 3g: a clinician can update an assessment directly'; end if;
  v_j := public.override_symptom_assessment(v_a, 'emergency', 'raising it after a phone call (proof)');
  perform pg_temp.back();
  if v_j ->> 'status' <> 'ok' or (select override_category from public.symptom_triage_assessments where id = v_a) is distinct from 'emergency' then raise exception 'FAIL 3h: the tied clinician override did not land'; end if;
  perform pg_temp.act(v_untied);
  v_j := public.override_symptom_assessment(v_a, 'routine', 'untied tries to lower it (proof)');
  perform pg_temp.back();
  if v_j ->> 'status' <> 'denied' or (select override_category from public.symptom_triage_assessments where id = v_a) is distinct from 'emergency' then raise exception 'FAIL 3i: an untied clinician changed an assessment'; end if;
  perform pg_temp.act(v_cc);
  if pg_temp.try(format('select public.override_symptom_assessment(%L, ''routine'', %L)', v_a, 'coordinator trying it (proof)')) <> '42501' then raise exception 'FAIL 3j: a coordinator can override'; end if;
  perform pg_temp.back();
  -- the monitoring aggregates: every signed-in person used to read every organisation's counts
  perform pg_temp.act(v_p);
  if pg_temp.try('select count(*) from public.triage_safety_monitoring') <> '42501' then raise exception 'FAIL 3k: a patient reads the safety monitoring view'; end if;
  if pg_temp.try('select public.symptom_safety_monitoring()') <> '42501' then raise exception 'FAIL 3l: a patient calls the monitoring function'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_tied);
  if pg_temp.try('select public.symptom_safety_monitoring()') <> '42501' then raise exception 'FAIL 3m: an ordinary clinician calls the monitoring function'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  if pg_temp.try('select public.symptom_safety_monitoring()') <> 'ok' then raise exception 'FAIL 3n: an admin cannot read the monitoring aggregates'; end if;
  perform pg_temp.back();
  -- SABOTAGE: put the old org-wide staff policy back; the tied AND untied clinician must then read directly, or 3b is vacuous
  v_pol := 'create policy symptom_triage_assessments_select on public.symptom_triage_assessments for select to authenticated using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))';
  drop policy symptom_triage_assessments_select on public.symptom_triage_assessments;
  execute v_pol;
  perform pg_temp.act(v_untied);
  v_n := pg_temp.scalar('select count(id) from public.symptom_triage_assessments');
  perform pg_temp.back();
  if v_n <> '1' then raise exception 'VACUOUS TEST (3): with the old policy an untied clinician still could not read (%)', v_n; end if;

  raise notice 'S59b proof: all checks passed';
end $$;

select 'PASS: S59b children, members only and the closed staff read' as result;
rollback;
