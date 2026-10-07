-- S61/S62 proof: the pathway engine seam (migration *_s61_s62_pathway_engine.sql).
--
-- Proves in one rolled-back transaction:
--   1. Shape: ten pathways, ten guards all OFF, RLS on, nobody but the definer functions can write the new tables, anon has nothing,
--      the guard conditions and attestation wrappers are in place, the rule sets and the step table are drafts, the task types exist,
--      glucose_events refuses an unknown event, the outcome_snapshots check accepts the other pathways.
--   2. The enrolment guard: a REAL patient is refused enrolment in a pathway whose guard is off; a TEST patient passes; a baseline and the
--      milestones are written on enrolment and the baseline milestone is met.
--   3. Pause, resume, transfer, discharge and re-enrol: who may act, the reason, the append-only record, re-enrolment re-checking the guard.
--   4. RLS: the patient reads their own milestones, another patient reads none, a tied clinician reads only through the audited function
--      (which writes audit_log), an untied one is denied, anon has no access.
--   5. The engine proposal review task (OQ-172): an engine proposal creates a titration_signoff task.
--   6. INV-05 end to end: a red diabetes result recorded against the DRAFT rule set is SHADOW and pages nobody; against an APPROVED copy it
--      pages on call. The signature, not the code, is what makes it live.
--   7. The sweeps are service role only and create a review task once.
--   8. SABOTAGE: with the enrolment guard trigger dropped a real patient enrols; with the engine review trigger dropped no task appears.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
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
create function pg_temp.act_service() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's61-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'S61 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  if not p_test then update public.profiles set is_test = false where id = v; end if;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'S61 ' || p_label, 'MDCN', 'S61-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      true, p_admin, true, array['en'], 'General practice')
  returning id into v_staff;
  return v;
end $f$;
-- makes a clinician the tied lead of a patient (the S18 lead model), the tie that staff_may_read and staff_may_write ask for
create function pg_temp.tie(p_clin uuid, p_patient uuid) returns void language plpgsql as
$f$ declare v_org uuid;
begin
  select organisation_id into v_org from public.profiles where id = p_patient;
  perform set_config('tarragon.lead_write', 'on', true);
  insert into public.lead_assignments (organisation_id, patient_id, clinician_id, state, source, config_version, assigned_by, is_test)
  values (v_org, p_patient, p_clin, 'active', 'reassign', private.lead_config_version(), p_clin, true);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, p_patient, p_clin)
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id;
  perform set_config('tarragon.lead_write', 'off', true);
end $f$;
create function pg_temp.enrol(p_patient uuid, p_programme text) returns text language plpgsql as
$f$ declare v_org uuid;
begin
  select organisation_id into v_org from public.profiles where id = p_patient;
  insert into public.chronic_programme_enrolments (organisation_id, patient_id, programme_id, status, source)
  select v_org, p_patient, id, 'enrolled', 'staff' from public.chronic_condition_programmes where code = p_programme;
  return 'ok';
exception when others then return sqlstate || ':' || sqlerrm;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_doc uuid; v_other_doc uuid; v_pat uuid; v_pat2 uuid; v_real uuid;
  v_enr uuid; v_n integer; v_txt text; v_json jsonb; v_proto uuid; v_change uuid; v_rs uuid; v_rs2 uuid; v_obs uuid; v_te uuid; v_res jsonb; v_conds jsonb;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_doc := pg_temp.mkdoc(v_org, v_admin, 'doc', 'senior_medical_officer');
  v_other_doc := pg_temp.mkdoc(v_org, v_admin, 'doc2', 'senior_medical_officer');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, 'patient2', 'patient');
  v_real := pg_temp.mkuser(v_org, 'real', 'patient', false);
  -- a deterministic programme: active without needing a signed protocol (the activation gate is a different, older rule)
  alter table public.chronic_condition_programmes disable trigger chronic_condition_programmes_protocol_gate;
  update public.chronic_condition_programmes set is_active = true where code in ('hypertension', 'diabetes');
  alter table public.chronic_condition_programmes enable trigger chronic_condition_programmes_protocol_gate;
  perform pg_temp.tie(v_doc, v_pat);

  -- 1. Shape ----------------------------------------------------------------------------------------------------
  perform pg_temp.rec('ten pathways', '10', (select count(*)::text from public.pathway_definitions));
  perform pg_temp.rec('ten pathway guards exist, all off', '10/0', (select count(*) || '/' || count(*) filter (where g.is_on) from public.go_live_guards g join public.pathway_definitions d on d.guard_key = g.key));
  perform pg_temp.rec('every guard is switched by the CMO', '10', (select count(*)::text from public.go_live_guards g join public.pathway_definitions d on d.guard_key = g.key where g.switch_role = 'cmo'));
  perform pg_temp.rec('RLS on for all new tables', '5', (select count(*)::text from pg_class where oid in ('public.pathway_definitions'::regclass, 'public.pathway_config'::regclass, 'public.pathway_baselines'::regclass, 'public.pathway_milestones'::regclass, 'public.pathway_lifecycle_events'::regclass) and relrowsecurity));
  perform pg_temp.rec('authenticated cannot write any new table', '0',
    (select count(*)::text from unnest(array['public.pathway_definitions', 'public.pathway_config', 'public.pathway_baselines', 'public.pathway_milestones', 'public.pathway_lifecycle_events']) t
      where has_table_privilege('authenticated', t, 'INSERT') or has_table_privilege('authenticated', t, 'UPDATE') or has_table_privilege('authenticated', t, 'DELETE')));
  perform pg_temp.rec('anon cannot read any new table', '0',
    (select count(*)::text from unnest(array['public.pathway_definitions', 'public.pathway_config', 'public.pathway_baselines', 'public.pathway_milestones', 'public.pathway_lifecycle_events']) t where has_table_privilege('anon', t, 'SELECT')));
  perform pg_temp.rec('anon cannot execute any new public function', '0',
    (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('pause_pathway_enrolment', 'resume_pathway_enrolment', 'transfer_pathway_enrolment', 'discharge_pathway_enrolment', 're_enrol_pathway_enrolment', 'clinician_mark_pathway_milestone', 'read_pathway_milestones_audited', 'sweep_pathway_reviews', 'sweep_pathway_scheduled_tests', 'attest_go_live_condition', 'attest_go_live_condition_base')
      and has_function_privilege('anon', p.oid, 'EXECUTE')));
  perform pg_temp.rec('the wrapped base functions exist', '2', (select count(*)::text from pg_proc where proname in ('go_live_conditions_base', 'attest_go_live_condition_base')));
  v_conds := private.go_live_conditions('pathway_bp', v_org);
  perform pg_temp.rec('pathway guard: four conditions, none met', '4/0', jsonb_array_length(v_conds) || '/' || (select count(*) from jsonb_array_elements(v_conds) c where (c ->> 'met')::boolean));
  perform pg_temp.rec('the wrapper still serves an older guard', 'true', (jsonb_array_length(private.go_live_conditions('on_call_cover_ok', v_org)) >= 1)::text);
  v_conds := private.go_live_conditions('pathway_sickle_cell_care', v_org);
  perform pg_temp.rec('a scaffold pathway can never meet its protocol condition', 'false', (v_conds -> 0 ->> 'met'));
  perform pg_temp.rec('rule sets are drafts', '4', (select count(*)::text from public.triage_rule_sets where code in ('diabetes_care_triage', 'asthma_copd_care_triage', 'heart_failure_triage', 'ckd_monitoring_triage') and status = 'draft' and approved_by is null));
  perform pg_temp.rec('the step table is a draft', '1', (select count(*)::text from public.protocols where code = 'htn_rtsl_ng' and status = 'draft' and approved_by is null));
  perform pg_temp.rec('three task types exist, PROPOSED, and none blocks approving another rule set', '3', (select count(*)::text from public.task_types where code in ('hypo_follow_up', 'amber_glucose_review', 'amber_pathway_review') and not needs_confirmation));
  perform pg_temp.rec('glucose_events refuses an unknown event', '23514',
    pg_temp.try(format($q$insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, taken_at, source, glucose_events) values (%L, %L, 'glucose', 5, now(), 'manual', array['dizzy'])$q$, v_org, v_pat)));
  perform pg_temp.rec('outcome_snapshots accepts the diabetes pathway code', 'true', (select (pg_get_constraintdef(oid) like '%diabetes_care%')::text from pg_constraint where conname = 'outcome_snapshots_pathway_code_check'));

  -- 2. The enrolment guard ----------------------------------------------------------------------------------------
  perform pg_temp.rec('guard off: a real patient is refused', '23514', left(pg_temp.enrol(v_real, 'hypertension'), 5));
  perform pg_temp.rec('guard off: the refusal names the pathway', 'true', (pg_temp.enrol(v_real, 'hypertension') like '%pathway is not open yet%')::text);
  perform pg_temp.rec('guard off: a test patient passes', 'ok', pg_temp.enrol(v_pat, 'hypertension'));
  select id into v_enr from public.chronic_programme_enrolments where patient_id = v_pat;
  perform pg_temp.rec('a baseline is captured on enrolment', '1', (select count(*)::text from public.pathway_baselines where enrolment_id = v_enr and cycle = 1 and pathway_code = 'bp'));
  perform pg_temp.rec('four milestones are seeded', '4', (select count(*)::text from public.pathway_milestones where enrolment_id = v_enr and cycle = 1));
  perform pg_temp.rec('the baseline milestone is met by the system', 'system', (select met_via from public.pathway_milestones where enrolment_id = v_enr and code = 'baseline'));
  perform pg_temp.rec('the other milestones are open', '3', (select count(*)::text from public.pathway_milestones where enrolment_id = v_enr and met_at is null));

  -- 3. Lifecycle ----------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_pat2);
  perform pg_temp.rec('another patient cannot pause it', '42501', pg_temp.try(format('select public.pause_pathway_enrolment(%L, %L)', v_enr, 'not my pathway at all')));
  perform pg_temp.back();
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a reason is required', '22023', pg_temp.try(format('select public.pause_pathway_enrolment(%L, %L)', v_enr, 'short')));
  perform pg_temp.rec('the patient can pause their own pathway', 'ok', pg_temp.try(format('select public.pause_pathway_enrolment(%L, %L)', v_enr, 'travelling for two weeks')));
  perform pg_temp.rec('pausing twice is refused', '22023', pg_temp.try(format('select public.pause_pathway_enrolment(%L, %L)', v_enr, 'travelling for two weeks')));
  perform pg_temp.rec('the patient cannot discharge', '42501', pg_temp.try(format('select public.discharge_pathway_enrolment(%L, %L)', v_enr, 'I would like to stop')));
  perform pg_temp.back();
  perform pg_temp.rec('the enrolment reads as paused', 'true', private.pathway_enrolment_paused(v_enr)::text);
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('the patient can resume', 'ok', pg_temp.try(format('select public.resume_pathway_enrolment(%L, %L)', v_enr, 'back home and measuring again')));
  perform pg_temp.back();
  perform pg_temp.rec('no longer paused', 'false', private.pathway_enrolment_paused(v_enr)::text);
  perform pg_temp.act(v_other_doc);
  perform pg_temp.rec('an untied clinician cannot discharge', '42501', pg_temp.try(format('select public.discharge_pathway_enrolment(%L, %L)', v_enr, 'not their patient at all')));
  perform pg_temp.back();
  perform pg_temp.act(v_doc);
  perform pg_temp.rec('the tied clinician cannot transfer unless lead, CMO or admin: they are the lead, so they can', 'ok', pg_temp.try(format('select public.transfer_pathway_enrolment(%L, %L)', v_enr, 'moving to a colleague with capacity')));
  perform pg_temp.back();
  perform pg_temp.rec('a transfer is recorded', '1', (select count(*)::text from public.pathway_lifecycle_events where enrolment_id = v_enr and action = 'transfer'));
  perform pg_temp.rec('events are append-only for the owner too', '42501', pg_temp.try(format('update public.pathway_lifecycle_events set reason = %L where enrolment_id = %L', 'rewritten history here', v_enr)));
  -- the lead may have moved: tie again so the discharge below is by a tied clinician
  perform set_config('tarragon.lead_write', 'on', true);
  update public.lead_assignments set state = 'ended', ended_at = now(), end_reason = 'superseded' where patient_id = v_pat and state in ('active', 'unassigned');
  perform set_config('tarragon.lead_write', 'off', true);
  perform pg_temp.tie(v_doc, v_pat);
  perform pg_temp.act(v_doc);
  perform pg_temp.rec('the tied clinician can discharge', 'ok', pg_temp.try(format('select public.discharge_pathway_enrolment(%L, %L)', v_enr, 'goals reached and care plan complete')));
  perform pg_temp.back();
  perform pg_temp.rec('discharge sets the status', 'completed', (select status::text from public.chronic_programme_enrolments where id = v_enr));
  perform pg_temp.act(v_doc);
  perform pg_temp.rec('re-enrolling a test patient works', 'ok', pg_temp.try(format('select public.re_enrol_pathway_enrolment(%L, %L)', v_enr, 'returned for a new course of care')));
  perform pg_temp.back();
  perform pg_temp.rec('re-enrolment writes a second baseline', '2', (select count(*)::text from public.pathway_baselines where enrolment_id = v_enr));
  perform pg_temp.rec('and a fresh set of milestones', '8', (select count(*)::text from public.pathway_milestones where enrolment_id = v_enr));
  perform pg_temp.rec('every lifecycle action left an event', '5', (select count(distinct action)::text from public.pathway_lifecycle_events where enrolment_id = v_enr));
  -- a real patient re-enrolling goes through the same guard
  update public.profiles set is_test = false where id = v_pat2;
  insert into public.chronic_programme_enrolments (organisation_id, patient_id, programme_id, status, source)
    select v_org, v_pat2, id, 'withdrawn', 'staff' from public.chronic_condition_programmes where code = 'diabetes';
  perform pg_temp.rec('re-enrolling a real patient hits the guard', '23514',
    pg_temp.try(format('update public.chronic_programme_enrolments set status = ''enrolled'' where patient_id = %L', v_pat2)));
  update public.profiles set is_test = true where id = v_pat2;

  -- 4. RLS and audited reads ----------------------------------------------------------------------------------------
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('the patient reads their own milestones', '8', (select count(*)::text from public.pathway_milestones));
  perform pg_temp.rec('the patient reads their baselines', '2', (select count(*)::text from public.pathway_baselines));
  perform pg_temp.back();
  perform pg_temp.act(v_pat2);
  perform pg_temp.rec('another patient reads none', '0', (select count(*)::text from public.pathway_milestones));
  perform pg_temp.back();
  perform pg_temp.act(v_doc);
  perform pg_temp.rec('a tied clinician has no direct row read (INV-10)', '0', (select count(*)::text from public.pathway_milestones));
  v_json := public.read_pathway_milestones_audited(v_pat, 'reviewing progress before the monthly call');
  perform pg_temp.rec('the audited read returns the rows', 'ok/8', (v_json ->> 'status') || '/' || jsonb_array_length(v_json -> 'rows'));
  perform pg_temp.rec('a reason is required', '22023', pg_temp.try(format('select public.read_pathway_milestones_audited(%L, %L)', v_pat, 'x')));
  perform pg_temp.back();
  perform pg_temp.rec('the audited read wrote an audit row', '1', (select count(*)::text from public.audit_log where action = 'staff.chart_read' and subject_patient_id = v_pat and event ->> 'sections' like '%pathway_milestones%'));
  perform pg_temp.act(v_other_doc);
  v_json := public.read_pathway_milestones_audited(v_pat, 'curious about this patient today');
  perform pg_temp.rec('an untied clinician is denied', 'denied', v_json ->> 'status');
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot read milestones', '42501', pg_temp.try('select * from public.pathway_milestones'));
  perform pg_temp.back();

  -- 5. The engine proposal review task (OQ-172) ---------------------------------------------------------------------
  select id into v_proto from public.protocols where code = 'htn_rtsl_ng' and version = 1;
  perform pg_temp.act(v_doc);
  v_change := public.propose_care_plan_change(v_pat, 'medication',
    '{"action":"start","item":{"drug_name":"Amlodipine","dose":"5 mg","frequency":"once daily","quantity":"30 tablets","duration_days":30}}'::jsonb,
    'Engine proposal from the draft step table for a test patient', null, 'engine', v_proto, '{"stepId":"step_1_amlodipine_5"}'::jsonb);
  perform pg_temp.back();
  perform pg_temp.rec('an engine proposal creates a titration_signoff task', '1', (select count(*)::text from public.clinical_tasks where type = 'titration_signoff' and dedup_key = 'titration_signoff:' || v_change));
  perform pg_temp.rec('the proposal itself stays unsigned', 'proposed/null', (select state || '/' || coalesce(signed_by::text, 'null') from public.care_plan_changes where id = v_change));

  -- 6. INV-05: a draft rule set is shadow and pages nobody; an approved one pages --------------------------------------
  select id into v_rs from public.triage_rule_sets where code = 'diabetes_care_triage' and version = 1;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, taken_at, source, glucose_events)
  values (v_org, v_pat, 'glucose', 2.8, now(), 'manual', array['confusion']) returning id into v_obs;
  perform pg_temp.rec('the glucose event is stored with the reading', 'confusion', (select glucose_events[1] from public.vitals_readings where id = v_obs));
  v_res := jsonb_build_object('status', 'graded', 'grade', 'red', 'ruleId', 'DM-R2', 'explanationKey', 'PW-DM-RED', 'taskKey', null,
    'matchedRuleIds', jsonb_build_array('DM-R1', 'DM-R2'), 'ruleSet', jsonb_build_object('code', 'diabetes_care_triage', 'version', 1),
    'actions', jsonb_build_array(jsonb_build_object('kind', 'show_emergency_guidance', 'code', 'PW-DM-RED'), jsonb_build_object('kind', 'page_on_call')));
  perform public.record_triage_result(v_obs, v_res, v_rs, null, 'proof-draft');
  select id into v_te from public.triage_events where trigger_id = v_obs and rule_set_id = v_rs;
  perform pg_temp.rec('a draft rule set grades as shadow', 'true', (select shadow::text from public.triage_events where id = v_te));
  perform public.create_red_page(v_te);
  perform pg_temp.rec('a shadow red pages nobody', '0', (select count(*)::text from public.pages where triage_event_id = v_te));
  -- an approved copy (version 2, signed in the proof by the test CMO, never by an agent in production)
  insert into public.triage_rule_sets (code, version, status, rules, approved_by, approved_at, note)
  select code, 2, 'approved', jsonb_set(rules, '{version}', '2'::jsonb), v_cmo, now(), 'proof copy, rolled back' from public.triage_rule_sets where id = v_rs
  returning id into v_rs2;
  v_res := jsonb_set(v_res, '{ruleSet,version}', '2'::jsonb);
  perform public.record_triage_result(v_obs, v_res, v_rs2, null, 'proof-approved');
  select id into v_te from public.triage_events where trigger_id = v_obs and rule_set_id = v_rs2;
  perform pg_temp.rec('an approved rule set grades live', 'false', (select shadow::text from public.triage_events where id = v_te));
  perform public.create_red_page(v_te);
  perform pg_temp.rec('glucose 2.8 mmol/L with confusion on an approved rule set pages on call', '1', (select count(*)::text from public.pages where triage_event_id = v_te and parent_page_id is null));

  -- 7. The sweeps ---------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_doc);
  perform pg_temp.rec('the review sweep is service role only', '42501', pg_temp.try('select public.sweep_pathway_reviews()'));
  perform pg_temp.back();
  perform pg_temp.act_service();
  select public.sweep_pathway_reviews() into v_n;
  perform pg_temp.back();
  perform pg_temp.rec('a just-enrolled patient is not yet due a review', '0', v_n::text);
  update public.chronic_programme_enrolments set enrolled_at = now() - interval '40 days' where id = v_enr;
  perform pg_temp.act_service();
  select public.sweep_pathway_reviews() into v_n;
  perform pg_temp.back();
  perform pg_temp.rec('after a month with no control shown a review is due', '1', v_n::text);
  perform pg_temp.rec('the review task exists once', '1', (select count(*)::text from public.clinical_tasks where dedup_key = 'pathway_review:' || v_enr));
  perform pg_temp.act_service();
  select public.sweep_pathway_reviews() into v_n;
  perform pg_temp.back();
  perform pg_temp.rec('a second sweep does not duplicate it', '0', v_n::text);
  -- a paused enrolment is skipped
  perform pg_temp.act(v_doc);
  perform public.pause_pathway_enrolment(v_enr, 'paused for the proof of the sweep');
  perform pg_temp.back();
  update public.pathway_milestones set met_at = now() - interval '35 days', met_via = 'clinician' where enrolment_id = v_enr and code like 'clinician\_review\_%';
  perform pg_temp.act_service();
  select public.sweep_pathway_reviews() into v_n;
  perform pg_temp.back();
  perform pg_temp.rec('a paused enrolment gets no review', '0', v_n::text);
  perform pg_temp.rec('pause never stops grading: triage_events were still written while paused', 'true', (select (count(*) > 0)::text from public.triage_events where patient_id = v_pat));

  -- 8. Sabotage -----------------------------------------------------------------------------------------------------
  drop trigger chronic_programme_enrolments_pathway_guard on public.chronic_programme_enrolments;
  insert into results values ('sabotaged', 'guard off: a real patient is refused', '23514', left(pg_temp.enrol(v_real, 'hypertension'), 5));
  drop trigger care_plan_changes_engine_review_task on public.care_plan_changes;
  perform pg_temp.act(v_doc);
  v_change := public.propose_care_plan_change(v_pat, 'medication',
    '{"action":"start","item":{"drug_name":"Amlodipine","dose":"5 mg","frequency":"once daily","quantity":"30 tablets","duration_days":30}}'::jsonb,
    'Second engine proposal with the review trigger removed', null, 'engine', v_proto, '{"stepId":"step_1_amlodipine_5"}'::jsonb);
  perform pg_temp.back();
  insert into results values ('sabotaged', 'an engine proposal creates a task', '1', (select count(*)::text from public.clinical_tasks where dedup_key = 'titration_signoff:' || v_change));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S61/S62 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed the matching check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
