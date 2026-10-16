-- Task queue gaps proof (migration *_task_queue_gaps_symptom_producer_prescribing_lead_competency.sql): OQ-432, OQ-433, OQ-435.
--
-- One rolled-back transaction. Sections:
--   A. OQ-435  a lead (or a pushed employed doctor) who lacks a competency the task requires is not offered it; the task goes to the
--              next route or to the pool, the transition says why, and a competent clinician can take it. A lead who holds it is
--              offered it as before; a task with no competency requirement is unaffected.
--   B. OQ-433  pharmacy_flag_review requires prescribing; admin_clinical requires it only for the prescription subtype; no other type
--              changes; only a prescribing clinician can take a pharmacy flag; extras still union without duplicates.
--   C. OQ-432  a symptom check that asks for a clinician review makes ONE symptom_review task for a Member and no alert; a Free patient
--              keeps the alert and gets no task; a repeat merges; a task that cannot be made falls back to the alert with an audit row
--              and an incident; urgent and plain results are untouched.
--   D. SABOTAGE four removals (the lead competency check, the pushed-doctor competency check, the prescribing rule, the task producer);
--              each check must flip, so the proof can fail.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.next_as(p_uid uuid, p_types text[] default null) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.queue_next(p_types); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.next_task(p_uid uuid, p_types text[] default null) returns uuid language sql as
$$ select (pg_temp.next_as(p_uid, p_types) -> 'task' ->> 'id')::uuid $$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'tq-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'TQ ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_emp text, p_comps text[], p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid; c text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'TQ ' || p_label, 'MDCN', 'TQ-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, p_emp::public.staff_employment_type, 2, p_emp = 'contracted', case when p_emp = 'contracted' then p_admin else null end, true)
  returning id into s;
  foreach c in array p_comps loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, true);
  end loop;
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
  values (p_org, v, now() - interval '1 minute', now() + interval '2 hours', 'queue', true);
  return v;
end $f$;
create function pg_temp.backdate(p_task uuid, p_set text) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.task_transition', 'on', true);
  execute format('update public.clinical_tasks set %s where id = %L', p_set, p_task);
  perform set_config('tarragon.task_transition', 'off', true);
end $f$;
create function pg_temp.state_of(p_task uuid) returns text language sql as $$ select state::text from public.clinical_tasks where id = p_task $$;
create function pg_temp.comps_of(p_task uuid) returns text language sql as
$$ select array_to_string(required_competencies, ',') from public.clinical_tasks where id = p_task $$;
create function pg_temp.reasons_of(p_task uuid) returns text language sql as
$$ select coalesce(string_agg(reason, ' | ' order by created_at, to_state::text), '') from public.clinical_task_transitions where task_id = p_task $$;
create function pg_temp.clear_queue() returns void language plpgsql as
$f$ declare r record;
begin
  for r in select id from public.clinical_tasks where state not in ('completed', 'cancelled') loop
    perform private.apply_task_transition(r.id, 'cancelled', 'lead', null, 'proof cleanup of a fixture task');
  end loop;
end $f$;
create function pg_temp.assess(p_org uuid, p_patient uuid, p_category text, p_review boolean, p_complaint text default 'headache') returns uuid language plpgsql as
$f$ declare v uuid; begin
  insert into public.symptom_triage_assessments
    (organisation_id, patient_id, presenting_complaint_key, protocol_version, initial_capture, questions_asked, red_flag_screen,
     category, clinician_review_required, safety_net_message_key, rationale)
  values (p_org, p_patient, p_complaint, (select min(version) from public.triage_protocols), '{}', '[]', '{}',
          p_category::public.triage_category, p_review, 'routine', 'task-queue-gaps proof')
  returning id into v;
  return v;
end $f$;

-- fixtures ----------------------------------------------------------------------------------------------------------------
-- The symptom handler reads the active escalation SLA's symptom_triage entries (the Free fallback raises an alert). The draft that
-- carries them is unsigned, so this rolled-back proof flips it active, as symptom_triage_assessment_engine.sql does.
alter table public.escalation_slas disable trigger refuse_superseded_activation;
update public.escalation_slas set is_active = false where is_active;
update public.escalation_slas set is_active = true
 where id = (select c.id from public.escalation_slas c, jsonb_array_elements(c.config) e
              where e ->> 'pathway' = 'symptom_triage' and e ->> 'tier' = 'clinician_review' order by c.version desc limit 1);

do $$
declare v_org uuid; v_admin uuid; i integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', 'contracted', '{}', v_admin));
  -- P holds prescribing; N does not. Both contracted (leads and pool takers, never pushed to).
  perform pg_temp.setf('P', pg_temp.mkdoc(v_org, 'P', 'senior_medical_officer', 'contracted', '{hypertension,adult_general,prescribing}', v_admin));
  perform pg_temp.setf('N', pg_temp.mkdoc(v_org, 'N', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_admin));
  for i in 1..14 loop perform pg_temp.setf('p' || i, pg_temp.mkuser(v_org, 'patient-' || i, 'patient')); end loop;
  perform pg_temp.setf('member', pg_temp.mkuser(v_org, 'member', 'patient'));
  perform pg_temp.setf('free', pg_temp.mkuser(v_org, 'free', 'patient'));
  insert into public.patient_memberships (organisation_id, patient_id, source, state, is_test)
  values (v_org, pg_temp.f('member'), 'purchase', 'active', true);
  perform pg_temp.rec('fixture: the Member can page a doctor, the Free patient cannot', 'true,false',
    private.patient_may_page_doctor(pg_temp.f('member'))::text || ',' || private.patient_may_page_doctor(pg_temp.f('free'))::text);
  perform pg_temp.rec('fixture: no task type awaits confirmation among the three this change touches', '0',
    (select count(*)::text from public.task_types where code in ('symptom_review', 'pharmacy_flag_review', 'admin_clinical') and needs_confirmation));
end $$;

-- A. OQ-435: the lead -----------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_p uuid := pg_temp.f('P'); v_n uuid := pg_temp.f('N');
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; v_cc uuid;
begin
  -- N is lead for p1, p3, p4; P is lead for p2
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values
    (v_org, pg_temp.f('p1'), v_n), (v_org, pg_temp.f('p2'), v_p), (v_org, pg_temp.f('p3'), v_n), (v_org, pg_temp.f('p4'), v_n);

  t1 := private.create_clinical_task(pg_temp.f('p1'), 'titration_signoff');   -- requires prescribing + hypertension; the lead N lacks prescribing
  perform pg_temp.rec('435: a lead who lacks a required competency is NOT offered the task', 'open', pg_temp.state_of(t1));
  perform pg_temp.rec('435: ...no lead is recorded on it', 'null', coalesce((select lead_clinician_id::text from public.clinical_tasks where id = t1), 'null'));
  perform pg_temp.rec('435: ...and the transition says why', 'true',
    (pg_temp.reasons_of(t1) like '%to the pool (lead not offered: lacks prescribing)%')::text);
  perform pg_temp.rec('435: the pooled task is takeable by a clinician who holds the competency', t1::text, pg_temp.next_task(v_p)::text);
  perform pg_temp.clear_queue();

  -- control: the lead holds everything the task needs
  t2 := private.create_clinical_task(pg_temp.f('p2'), 'titration_signoff');
  perform pg_temp.rec('435 control: a lead who holds the competencies is offered the task', 'offered_to_lead', pg_temp.state_of(t2));
  perform pg_temp.rec('435 control: ...and it is that lead', v_p::text, (select lead_clinician_id::text from public.clinical_tasks where id = t2));
  perform pg_temp.rec('435 control: ...with the ordinary reason, no skip note', 'false', (pg_temp.reasons_of(t2) like '%not offered%')::text);
  perform pg_temp.clear_queue();

  -- control: a type whose requirement the lead meets is untouched even though the lead lacks prescribing
  t3 := private.create_clinical_task(pg_temp.f('p3'), 'symptom_review');
  perform pg_temp.rec('435 control: N (no prescribing) is still offered a symptom_review it can take', 'offered_to_lead', pg_temp.state_of(t3));
  perform pg_temp.clear_queue();

  -- a revoked grant is a missing competency
  select cs.id into v_cc from public.clinical_staff cs where cs.profile_id = v_n;
  update public.clinician_competencies set revoked_at = now() where clinical_staff_id = v_cc and competency_code = 'adult_general';
  t4 := private.create_clinical_task(pg_temp.f('p4'), 'symptom_review');
  perform pg_temp.rec('435: a REVOKED competency counts as missing', 'open', pg_temp.state_of(t4));
  perform pg_temp.rec('435: ...and the reason names it', 'true', (pg_temp.reasons_of(t4) like '%lacks adult_general%')::text);
  update public.clinician_competencies set revoked_at = null where clinical_staff_id = v_cc and competency_code = 'adult_general';
  perform pg_temp.clear_queue();
end $$;

-- A2. OQ-435: the pushed employed doctor ------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin');
  e1 uuid; e2 uuid; t uuid; t2 uuid; i integer; f uuid;
begin
  e1 := pg_temp.mkdoc(v_org, 'E1', 'senior_medical_officer', 'employed', '{hypertension,adult_general}', v_admin);            -- no prescribing
  e2 := pg_temp.mkdoc(v_org, 'E2', 'senior_medical_officer', 'employed', '{hypertension,adult_general,prescribing}', v_admin);
  perform pg_temp.setf('E1', e1); perform pg_temp.setf('E2', e2);
  -- make E2 the busier of the two, so only the competency check (not load) can send the task to E2
  for i in 1..3 loop
    f := private.create_clinical_task(pg_temp.f('p' || (4 + i)), 'symptom_review');
    perform pg_temp.backdate(f, format('pushed_to = %L, delivery_path = ''push'', state = ''offered_to_lead'', lead_window_ends_at = now() + interval ''10 hours''', e2));
  end loop;
  t := private.create_clinical_task(pg_temp.f('p8'), 'titration_signoff');   -- no lead; pushable; needs prescribing
  perform pg_temp.rec('435: an employed doctor without the competency is not pushed the task, although less loaded', e2::text,
    coalesce((select pushed_to::text from public.clinical_tasks where id = t), 'null'));
  perform pg_temp.rec('435: ...it is offered (pushed) to the one who can take it', 'offered_to_lead', pg_temp.state_of(t));
  perform pg_temp.clear_queue();

  -- control: a task with no prescribing need still goes to the least loaded employed doctor
  t2 := private.create_clinical_task(pg_temp.f('p9'), 'symptom_review');
  perform pg_temp.rec('435 control: a symptom_review (no prescribing need) is pushed to the less loaded E1', e1::text,
    coalesce((select pushed_to::text from public.clinical_tasks where id = t2), 'null'));
  perform pg_temp.clear_queue();

  -- nobody employed can take it: it goes to the pool, with no lead-skip note (there was no lead)
  update public.clinical_staff set active = false where profile_id = e2;
  t := private.create_clinical_task(pg_temp.f('p10'), 'titration_signoff');
  perform pg_temp.rec('435: no employed doctor can take it: the task goes to the pool', 'open', pg_temp.state_of(t));
  perform pg_temp.rec('435: ...pushed to nobody', 'null', coalesce((select pushed_to::text from public.clinical_tasks where id = t), 'null'));
  update public.clinical_staff set active = true where profile_id = e2;
  perform pg_temp.clear_queue();
end $$;

-- B. OQ-433 ---------------------------------------------------------------------------------------------------------------
do $$
declare
  v_p uuid := pg_temp.f('P'); v_n uuid := pg_temp.f('N');
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid; t7 uuid; t8 uuid;
begin
  t1 := private.create_clinical_task(pg_temp.f('p11'), 'pharmacy_flag_review', null, 'pharmacy_flag:' || gen_random_uuid());
  perform pg_temp.rec('433: a pharmacy flag task requires prescribing', 'prescribing', pg_temp.comps_of(t1));
  perform pg_temp.rec('433: ...a clinician without it is offered nothing', 'none_eligible', coalesce(pg_temp.next_as(v_n, array['pharmacy_flag_review']) ->> 'reason', 'claimed'));
  perform pg_temp.rec('433: ...a prescribing clinician takes it', t1::text, pg_temp.next_task(v_p, array['pharmacy_flag_review'])::text);
  perform pg_temp.clear_queue();

  t2 := private.create_clinical_task(pg_temp.f('p12'), 'admin_clinical', null, 'mh_handoff:' || gen_random_uuid());
  t3 := private.create_clinical_task(pg_temp.f('p12'), 'admin_clinical', null, 'sleep_apnoea:' || gen_random_uuid());
  t4 := private.create_clinical_task(pg_temp.f('p12'), 'admin_clinical', null, 'prescription:' || gen_random_uuid());
  t5 := private.create_clinical_task(pg_temp.f('p12'), 'admin_clinical', null, 'repeat_prescription:' || gen_random_uuid());
  t6 := private.create_clinical_task(pg_temp.f('p12'), 'admin_clinical', null, null);
  perform pg_temp.rec('433: an admin task that is a hand-off or referral needs no prescribing', ',', pg_temp.comps_of(t2) || ',' || pg_temp.comps_of(t3));
  perform pg_temp.rec('433: ...a task with no key needs none', '', pg_temp.comps_of(t6));
  perform pg_temp.rec('433: an admin task that is a prescription requires prescribing', 'prescribing,prescribing', pg_temp.comps_of(t4) || ',' || pg_temp.comps_of(t5));
  perform pg_temp.clear_queue();

  perform pg_temp.rec('433: other types are unchanged: titration_signoff', 'hypertension,prescribing',
    pg_temp.comps_of(private.create_clinical_task(pg_temp.f('p13'), 'titration_signoff')));
  perform pg_temp.rec('433: other types are unchanged: symptom_review', 'adult_general', pg_temp.comps_of(private.create_clinical_task(pg_temp.f('p14'), 'symptom_review')));
  perform pg_temp.clear_queue();

  t7 := private.create_clinical_task(pg_temp.f('p11'), 'pharmacy_flag_review', null, 'pharmacy_flag:' || gen_random_uuid(), null, null, null, array['prescribing', 'extra_one']);
  perform pg_temp.rec('433: an explicit extra unions with the rule, without a duplicate', 'extra_one,prescribing', pg_temp.comps_of(t7));
  perform pg_temp.clear_queue();

  -- a task made before the rule that is still waiting in the pool gains the requirement when a repeat merges into it
  t8 := private.create_clinical_task(pg_temp.f('p11'), 'pharmacy_flag_review', null, 'pharmacy_flag:widen');
  perform pg_temp.backdate(t8, 'required_competencies = ''{}''');
  perform private.create_clinical_task(pg_temp.f('p11'), 'pharmacy_flag_review', null, 'pharmacy_flag:widen');
  perform pg_temp.rec('433: a repeat merging into an older pooled task widens it to prescribing', 'prescribing,1',
    pg_temp.comps_of(t8) || ',' || (select merged_count::text from public.clinical_tasks where id = t8));
  perform pg_temp.clear_queue();
end $$;

-- C. OQ-432 ---------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); m uuid := pg_temp.f('member'); fr uuid := pg_temp.f('free');
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; a5 uuid; a6 uuid; a7 uuid;
  t uuid; r record;
begin
  a1 := pg_temp.assess(v_org, m, 'routine', true);
  select clinician_review_task_id, clinician_review_alert_id into r from public.symptom_triage_assessments where id = a1;
  t := r.clinician_review_task_id;
  perform pg_temp.rec('432: a Member whose check asked for a clinician review gets a task on the assessment', 'true', (t is not null)::text);
  perform pg_temp.rec('432: ...and no review alert beside it', 'null', coalesce(r.clinician_review_alert_id::text, 'null'));
  perform pg_temp.rec('432: ...no clinician_review alert row exists for the patient', '0', (select count(*)::text from public.clinician_alerts where patient_id = m and level = 'clinician_review'));
  perform pg_temp.rec('432: ...the task is a symptom_review for that patient, live, for the test account', 'symptom_review,true,true',
    (select ty.type || ',' || (ty.patient_id = m)::text || ',' || (ty.state in ('open', 'offered_to_lead') and ty.is_test)::text from public.clinical_tasks ty where ty.id = t));
  perform pg_temp.rec('432: ...with the type''s own due time (24 hours) and the adult_general competency', '1440,adult_general',
    (select round(extract(epoch from (due_at - created_at)) / 60)::text || ',' || array_to_string(required_competencies, ',') from public.clinical_tasks where id = t));
  perform pg_temp.rec('432: ...and the dedup key names the patient and the complaint', 'symptom_triage:' || m || ':headache', (select dedup_key from public.clinical_tasks where id = t));

  -- a repeat for the same complaint merges into the live task instead of piling up
  a2 := pg_temp.assess(v_org, m, 'self_management', true);
  perform pg_temp.rec('432: a repeat check for the same complaint merges into the same task', t::text || ',1,1',
    (select clinician_review_task_id::text from public.symptom_triage_assessments where id = a2) || ',' ||
    (select merged_count::text from public.clinical_tasks where id = t) || ',' ||
    (select count(*)::text from public.clinical_tasks where patient_id = m and type = 'symptom_review' and state not in ('completed', 'cancelled')));
  -- a different complaint is its own task
  a3 := pg_temp.assess(v_org, m, 'routine', true, 'cough');
  perform pg_temp.rec('432: a different complaint is a different task', '2',
    (select count(*)::text from public.clinical_tasks where patient_id = m and type = 'symptom_review' and state not in ('completed', 'cancelled')));

  -- Free: unchanged, the alert and no task
  a4 := pg_temp.assess(v_org, fr, 'routine', true);
  select clinician_review_task_id, clinician_review_alert_id into r from public.symptom_triage_assessments where id = a4;
  perform pg_temp.rec('432: a Free patient still gets the review alert (behaviour unchanged)', 'true,true',
    (r.clinician_review_alert_id is not null)::text || ',' || (select (count(*) = 1)::text from public.clinician_alerts where id = r.clinician_review_alert_id and level = 'clinician_review'));
  perform pg_temp.rec('432: ...and no doctor task (Free consumes no doctor time)', 'null,0',
    coalesce(r.clinician_review_task_id::text, 'null') || ',' || (select count(*)::text from public.clinical_tasks where patient_id = fr));

  -- no review requested: nothing; urgent: the urgent alert only, no task
  a5 := pg_temp.assess(v_org, pg_temp.f('p1'), 'routine', false);
  perform pg_temp.rec('432: a plain result with no review asked makes no task and no alert', '0,0',
    (select count(*)::text from public.clinical_tasks where patient_id = pg_temp.f('p1') and type = 'symptom_review') || ',' || (select count(*)::text from public.clinician_alerts where patient_id = pg_temp.f('p1')));
  a6 := pg_temp.assess(v_org, m, 'urgent', false);
  perform pg_temp.rec('432: an urgent result keeps its urgent alert and makes no new symptom_review task', '1,2',
    (select count(*)::text from public.clinician_alerts where patient_id = m and level = 'urgent_escalation') || ',' ||
    (select count(*)::text from public.clinical_tasks where patient_id = m and type = 'symptom_review' and state not in ('completed', 'cancelled')));

  -- the task cannot be made: the review is not dropped
  insert into public.patient_memberships (organisation_id, patient_id, source, state, is_test) values (v_org, pg_temp.f('p3'), 'purchase', 'active', true);
  update public.task_types set is_active = false where code = 'symptom_review';
  a7 := pg_temp.assess(v_org, pg_temp.f('p3'), 'routine', true);
  select clinician_review_task_id, clinician_review_alert_id into r from public.symptom_triage_assessments where id = a7;
  perform pg_temp.rec('432: when the task cannot be made, the review alert is raised instead', 'null,true',
    coalesce(r.clinician_review_task_id::text, 'null') || ',' || (r.clinician_review_alert_id is not null)::text);
  perform pg_temp.rec('432: ...the failure is audited', '1',
    (select count(*)::text from public.audit_log where action = 'symptom_triage.task_error' and entity_id = a7));
  perform pg_temp.rec('432: ...and an incident is raised (sev2)', '1,sev2',
    (select count(*)::text || ',' || coalesce(max(severity::text), '') from public.ops_incidents where external_reference = 'symptom_triage_task_failed:' || a7));
  update public.task_types set is_active = true where code = 'symptom_review';
  perform pg_temp.rec('432: the symptom_review type is active again after the proof step', '1', (select count(*)::text from public.task_types where code = 'symptom_review' and is_active));
  perform pg_temp.clear_queue();
end $$;

-- D. SABOTAGE ---------------------------------------------------------------------------------------------------------------------
create temp table saved(k text primary key, def text) on commit drop;
grant all on saved to public;
insert into saved
select 'cct', pg_get_functiondef('private.create_clinical_task(uuid,text,integer,text,uuid,integer,uuid,text[])'::regprocedure)
union all select 'pick', pg_get_functiondef('private.pick_employed_clinician_competent(uuid,public.doctor_tier,uuid,text[])'::regprocedure)
union all select 'extra', pg_get_functiondef('private.task_extra_competencies(text,text)'::regprocedure)
union all select 'handler', pg_get_functiondef('private.handle_symptom_triage_assessment()'::regprocedure);

-- (a) the lead check removed
do $$
declare d text := (select def from saved where k = 'cct');
begin
  if position('coalesce(array_length(v_missing, 1), 0) > 0' in d) = 0 then raise exception 'sabotage (a): marker not found'; end if;
  execute replace(d, 'coalesce(array_length(v_missing, 1), 0) > 0', 'false');
end $$;
do $$
declare t uuid;
begin
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id)
  values (pg_temp.f('org'), pg_temp.f('p5'), pg_temp.f('N')) on conflict (patient_id) do update set clinician_id = pg_temp.f('N');
  t := private.create_clinical_task(pg_temp.f('p5'), 'titration_signoff', null, 'sab:a');
  insert into results values ('sabotaged', '435 sabotage: a lead without prescribing is not recorded as the offered lead of a prescribing task', 'null',
    coalesce((select lead_clinician_id::text from public.clinical_tasks where id = t), 'null'));
  perform pg_temp.clear_queue();
end $$;
do $$ begin execute (select def from saved where k = 'cct'); end $$;

-- (b) the pushed-doctor competency check removed
do $$
declare d text := (select def from saved where k = 'pick');
begin
  if position('coalesce(array_length(private.clinician_missing_competencies(cs.profile_id, p_required), 1), 0) = 0' in d) = 0 then raise exception 'sabotage (b): marker not found'; end if;
  execute replace(d, 'coalesce(array_length(private.clinician_missing_competencies(cs.profile_id, p_required), 1), 0) = 0', 'true');
end $$;
do $$
declare t uuid; f uuid; i integer;
begin
  -- E2 (prescribing) is busier; without the check the task goes to the less loaded E1
  for i in 1..3 loop
    f := private.create_clinical_task(pg_temp.f('p' || (5 + i)), 'symptom_review', null, 'sab:b:' || i);
    perform pg_temp.backdate(f, format('pushed_to = %L, delivery_path = ''push'', state = ''offered_to_lead'', lead_window_ends_at = now() + interval ''10 hours''', pg_temp.f('E2')));
  end loop;
  t := private.create_clinical_task(pg_temp.f('p9'), 'titration_signoff', null, 'sab:b');
  insert into results values ('sabotaged', '435 sabotage: the pushed doctor holds prescribing', pg_temp.f('E2')::text, coalesce((select pushed_to::text from public.clinical_tasks where id = t), 'null'));
  perform pg_temp.clear_queue();
end $$;
do $$ begin execute (select def from saved where k = 'pick'); end $$;

-- (c) the prescribing rule removed from the pharmacy flag
do $$
declare d text := (select def from saved where k = 'extra');
begin
  if position('then array[''prescribing'']::text[]' in d) = 0 then raise exception 'sabotage (c): marker not found'; end if;
  execute replace(d, 'when p_type = ''pharmacy_flag_review'' then array[''prescribing'']::text[]', 'when p_type = ''pharmacy_flag_review'' then ''{}''::text[]');
end $$;
do $$
declare t uuid;
begin
  t := private.create_clinical_task(pg_temp.f('p11'), 'pharmacy_flag_review', null, 'pharmacy_flag:sab-c');
  insert into results values ('sabotaged', '433 sabotage: a pharmacy flag task requires prescribing', 'prescribing', pg_temp.comps_of(t));
  perform pg_temp.clear_queue();
end $$;
do $$ begin execute (select def from saved where k = 'extra'); end $$;

-- (d) the producer removed (the review type name is broken, so the handler falls back to the alert)
do $$
declare d text := (select def from saved where k = 'handler');
begin
  if position('''symptom_review'', null,' in d) = 0 then raise exception 'sabotage (d): marker not found'; end if;
  execute replace(d, '''symptom_review'', null,', '''no_such_task_type'', null,');
end $$;
do $$
declare a uuid; r record;
begin
  a := pg_temp.assess(pg_temp.f('org'), pg_temp.f('member'), 'routine', true, 'sab_d');
  select clinician_review_task_id into r from public.symptom_triage_assessments where id = a;
  insert into results values ('sabotaged', '432 sabotage: a Member''s review is a task', 'true', (r.clinician_review_task_id is not null)::text);
  perform pg_temp.clear_queue();
end $$;
do $$ begin execute (select def from saved where k = 'handler'); end $$;

-- restored: the real checks must pass again after every sabotage step
do $$
declare t uuid; a uuid;
begin
  t := private.create_clinical_task(pg_temp.f('p12'), 'pharmacy_flag_review', null, 'pharmacy_flag:after');
  perform pg_temp.rec('restored: the prescribing rule is back', 'prescribing', pg_temp.comps_of(t));
  a := pg_temp.assess(pg_temp.f('org'), pg_temp.f('member'), 'routine', true, 'after');
  perform pg_temp.rec('restored: the Member''s review is a task again', 'true', ((select clinician_review_task_id from public.symptom_triage_assessments where id = a) is not null)::text);
  perform pg_temp.clear_queue();
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'task-queue-gaps proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then
    raise exception 'VACUOUS TEST: only % of the 4 sabotages flipped a check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged rows are asserted to differ inside the DO block above and are not printed: the runner treats any FAIL verdict as a failed proof.

rollback;
