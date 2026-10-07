-- S16 proof: clinical_tasks, the state machine, task types and priority classes (migration *_s16_clinical_tasks.sql).
--
-- Proves in one rolled-back transaction:
--   1. Seed: ten task types, one active each, fee fields empty, claim and hand-back tables present.
--   2. Triage wiring: a shadow event creates nothing (OQ-88); an approved event creates the mapped task with the
--      due time the rule asked for; a repeat merges into the live task and is counted; an unmapped key raises.
--   3. Routing: an employed doctor is pushed the task and holds it as an offer; a red-class task is created open
--      with no lead window (INV-05).
--   4. State machine: a direct state update is refused, an illegal move is refused, a legal path works end to end
--      (offer lapses, claim, hand back, claim, complete), every move is logged and emits an event.
--   5. Sweeps: class-3 promotion happens once; an overdue task is escalated with an urgent event.
--   6. Clinical-lead actions: cancel and priority override are CMO only, need a reason, are audited.
--   7. Access (INV-12): the patient and an unrelated clinician see nothing; the holder sees their task and is tied
--      to the patient only while the task is active; admin sees all; anon nothing; no direct writes; execute grants.
--   8. is_test is carried and queue_health ignores test rows.
--   9. SABOTAGE: with the guard trigger dropped, a direct state update must succeed (so the check above would fail).
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
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; end $f$;
-- fixture-only: move the clock fields the sweeps read (the guard allows it inside the queue's own setting)
create function pg_temp.backdate(p_task uuid, p_set text) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.task_transition', 'on', true);
  execute format('update public.clinical_tasks set %s where id = %L', p_set, p_task);
  perform set_config('tarragon.task_transition', 'off', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's16-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S16 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.triage(p_patient uuid, p_set uuid, p_actions jsonb, p_shadow boolean) returns uuid language plpgsql as
$f$ declare v_id uuid; v_rs record;
begin
  select code, version, status into v_rs from public.triage_rule_sets where id = p_set;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code,
      rule_set_version, rule_set_status, actions, shadow, is_test, basis)
  select pr.organisation_id, p_patient, 'observation', gen_random_uuid(), 'amber', 'T1', p_set, v_rs.code, v_rs.version, v_rs.status,
         p_actions, p_shadow, true, gen_random_uuid()::text
    from public.profiles pr where pr.id = p_patient
  returning id into v_id;
  return v_id;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_emp uuid; v_other uuid; v_p1 uuid; v_p2 uuid; v_p3 uuid; v_rs_draft uuid; v_rs_ok uuid;
  v_coord uuid; v_p4 uuid; v_p5 uuid; v_p6 uuid; v_dd1 uuid; v_dd2 uuid; v_dd3 uuid; v_red2 uuid; v_poison uuid; v_ok uuid; v_te uuid; v_te2 uuid; v_t1 uuid; v_t2 uuid; v_t3 uuid; v_red uuid; v_cls uuid; v_n integer; v_sweep jsonb;
  v_acts jsonb := '[{"kind":"create_task","task":"bp_review","dueMinutes":1440}]'::jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_emp := pg_temp.mkuser(v_org, 'employed-doctor', 'clinician');
  v_other := pg_temp.mkuser(v_org, 'other-doctor', 'clinician');
  v_p1 := pg_temp.mkuser(v_org, 'patient-1', 'patient');
  v_p2 := pg_temp.mkuser(v_org, 'patient-2', 'patient');
  v_p3 := pg_temp.mkuser(v_org, 'patient-3', 'patient');
  v_p4 := pg_temp.mkuser(v_org, 'patient-4', 'patient');
  v_p5 := pg_temp.mkuser(v_org, 'patient-5', 'patient');
  v_p6 := pg_temp.mkuser(v_org, 'patient-6', 'patient');
  v_coord := pg_temp.mkuser(v_org, 'coordinator', 'clinician');

  -- only the fixture clinicians may be picked (live rows would make "least loaded" depend on production data)
  update public.clinical_staff set active = false where is_test is not true;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_cmo, 'S16 CMO', 'MDCN', 'S16-CMO-1', true, 'active', now(), v_admin, 'chief_medical_officer', 'contracted', 2, true, v_admin, true);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
    values (v_org, v_emp, 'S16 Employed', 'MDCN', 'S16-EMP-1', true, 'active', now(), v_admin, 'senior_medical_officer', 'employed', 2, true);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_other, 'S16 Other', 'MDCN', 'S16-OTH-1', true, 'active', now(), v_admin, 'senior_medical_officer', 'contracted', 2, true, v_admin, true);

  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
    values (v_org, v_coord, 'S16 Coordinator', 'MDCN', 'S16-COO-1', true, 'active', now(), v_admin, 'care_coordinator', 'employed', 1, true);

  -- rule sets: one draft (shadow) and one approved
  select id into v_rs_draft from public.triage_rule_sets where status = 'draft' order by version desc limit 1;
  insert into public.triage_rule_sets (code, version, status, rules, approved_by, approved_at, note)
    values ('s16test', 1, 'approved', '{"code":"s16test","version":1}'::jsonb, v_cmo, now(), 'S16 proof fixture') returning id into v_rs_ok;

  -- 1. Seed -----------------------------------------------------------------------------------------------
  -- S22 added written_question_call, S27 sensitive_result_disclosure and S36h pharmacy_flag_review, so S16's own ten are counted by excluding later sections' types
  perform pg_temp.rec('ten task types seeded', '10', (select count(*)::text from public.task_types where is_active and code not in ('written_question_call', 'sensitive_result_disclosure', 'pharmacy_flag_review', 'hypo_follow_up', 'amber_glucose_review', 'amber_pathway_review')));
  perform pg_temp.rec('one active version per code', '0', (select count(*)::text from (select code from public.task_types where is_active group by code having count(*) > 1) x));
  perform pg_temp.rec('a red-class type has no lead window', '0', (select lead_window_minutes::text from public.task_types where code = 'red_event_unacknowledged'));
  perform pg_temp.rec('amber review is class 4, 24 hours, 4 hour lead window', '4,1440,240',
    (select priority_class || ',' || default_due_minutes || ',' || lead_window_minutes from public.task_types where code = 'amber_bp_review'));
  perform pg_temp.rec('fee columns exist and default to empty', 'true',
    (select (count(*) = 2)::text from information_schema.columns where table_schema = 'public' and table_name = 'clinical_tasks'
        and column_name in ('fee_kobo_at_completion', 'fee_schedule_version_id') and column_default is null));
  perform pg_temp.rec('fee is integer kobo (bigint)', 'bigint',
    (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'clinical_tasks' and column_name = 'fee_kobo_at_completion'));

  -- 2. Triage wiring --------------------------------------------------------------------------------------
  v_te := pg_temp.triage(v_p1, v_rs_draft, v_acts, true);
  perform pg_temp.rec('a shadow triage event creates no task', '0', public.create_tasks_from_triage_event(v_te)::text);
  perform pg_temp.rec('...and none exists', '0', (select count(*)::text from public.clinical_tasks where patient_id = v_p1));

  v_te2 := pg_temp.triage(v_p1, v_rs_ok, v_acts, false);
  perform pg_temp.rec('an approved event creates one task', '1', public.create_tasks_from_triage_event(v_te2)::text);
  select id into v_t1 from public.clinical_tasks where patient_id = v_p1;
  perform pg_temp.rec('mapped to amber_bp_review, class 4, rule set version recorded (INV-16)', 'amber_bp_review,4,1,1',
    (select type || ',' || priority_class || ',' || rule_set_version || ',' || task_type_version from public.clinical_tasks where id = v_t1));
  perform pg_temp.rec('due time follows the rule (24 hours)', 'true',
    (select (due_at between now() + interval '1439 minutes' and now() + interval '1441 minutes')::text from public.clinical_tasks where id = v_t1));
  perform pg_temp.rec('a test patient makes a test task', 'true', (select is_test::text from public.clinical_tasks where id = v_t1));

  perform public.create_tasks_from_triage_event(pg_temp.triage(v_p1, v_rs_ok, '[{"kind":"create_task","task":"bp_review","dueMinutes":600}]'::jsonb, false));
  perform pg_temp.rec('a repeat trigger merges into the live task', '1,1',
    (select count(*) || ',' || max(merged_count) from public.clinical_tasks where patient_id = v_p1));
  perform pg_temp.rec('...and a tighter due time wins', 'true',
    (select (due_at <= now() + interval '601 minutes')::text from public.clinical_tasks where id = v_t1));
  perform pg_temp.rec('an unmapped task key raises (never silent)', 'P0001',
    pg_temp.try(format('select public.create_tasks_from_triage_event(%L)', pg_temp.triage(v_p2, v_rs_ok, '[{"kind":"create_task","task":"no_such_key"}]'::jsonb, false))));
  perform pg_temp.rec('...and made nothing', '0', (select count(*)::text from public.clinical_tasks where patient_id = v_p2));
  perform pg_temp.rec('a page_on_call action alone makes no task here (S19 pages)', '0',
    public.create_tasks_from_triage_event(pg_temp.triage(v_p2, v_rs_ok, '[{"kind":"page_on_call"}]'::jsonb, false))::text);

  -- 3. Routing --------------------------------------------------------------------------------------------
  perform pg_temp.rec('pushed to the employed doctor as an offer', 'push,offered_to_lead,true',
    (select delivery_path || ',' || state || ',' || (pushed_to = v_emp)::text from public.clinical_tasks where id = v_t1));
  perform pg_temp.rec('the offer has a window that ends by the due time', 'true',
    (select (lead_window_ends_at is not null and lead_window_ends_at <= due_at)::text from public.clinical_tasks where id = v_t1));
  v_red := private.create_clinical_task(v_p3, 'red_event_unacknowledged');
  perform pg_temp.rec('a red-class task is open at once with no window (INV-05)', 'open,true,1',
    (select state || ',' || (lead_window_ends_at is null)::text || ',' || priority_class from public.clinical_tasks where id = v_red));
  perform pg_temp.rec('a task type that is not creatable is refused', '22023', pg_temp.try($q$select private.create_clinical_task(gen_random_uuid(), 'amber_bp_review_due_soon')$q$));

  -- 4. State machine --------------------------------------------------------------------------------------
  perform pg_temp.rec('a direct state update is refused', '42501', pg_temp.try(format('update public.clinical_tasks set state = ''completed'' where id = %L', v_t1)));
  perform pg_temp.rec('a direct insert is refused', '42501',
    pg_temp.try(format($q$insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at)
      values (%L, 'amber_bp_review', 1, 4, 4, %L, 'medical_officer', now())$q$, v_org, v_p3)));
  perform pg_temp.rec('an illegal move is refused (open -> completed)', '23514',
    pg_temp.try(format($q$select private.apply_task_transition(%L, 'completed', 'clinician', %L, null, null, null, '{}'::jsonb)$q$, v_red, v_emp)));
  perform pg_temp.rec('the wrong actor kind is refused (system cannot claim)', '23514',
    pg_temp.try(format($q$select private.apply_task_transition(%L, 'claimed', 'system', null, null, %L, now() + interval '30 minutes')$q$, v_red, v_emp)));
  perform pg_temp.rec('a claim needs an expiry', '22023',
    pg_temp.try(format($q$select private.apply_task_transition(%L, 'claimed', 'clinician', %L, null, %L, null)$q$, v_red, v_emp, v_emp)));

  -- offer lapses -> open
  perform pg_temp.backdate(v_t1, 'lead_window_ends_at = now() - interval ''1 minute''');
  v_sweep := private.sweep_clinical_tasks();
  perform pg_temp.rec('the sweep returns a lapsed offer to the pool', 'open', (select state::text from public.clinical_tasks where id = v_t1));
  -- claim, hand back, claim again, complete
  perform private.apply_task_transition(v_t1, 'claimed', 'clinician', v_emp, null, v_emp, now() + interval '30 minutes');
  perform pg_temp.rec('claimed: holder and expiry set', 'claimed,true,true',
    (select state || ',' || (claimed_by = v_emp)::text || ',' || (claim_expires_at is not null)::text from public.clinical_tasks where id = v_t1));
  perform private.apply_task_transition(v_t1, 'open', 'clinician', v_emp, 'need more information');
  perform pg_temp.rec('handed back: open, claim cleared, count 1', 'open,true,1',
    (select state || ',' || (claimed_by is null and claim_expires_at is null)::text || ',' || handback_count from public.clinical_tasks where id = v_t1));
  perform private.apply_task_transition(v_t1, 'claimed', 'clinician', v_other, null, v_other, now() + interval '30 minutes');
  perform pg_temp.rec('completing needs an outcome', '22023',
    pg_temp.try(format($q$select private.apply_task_transition(%L, 'completed', 'clinician', %L, null, null, null, null)$q$, v_t1, v_other)));
  perform private.apply_task_transition(v_t1, 'completed', 'clinician', v_other, null, null, null, '{"result":"reviewed"}'::jsonb);
  perform pg_temp.rec('completed: time and outcome set, fee still empty', 'completed,true,true',
    (select state || ',' || (completed_at is not null)::text || ',' || (fee_kobo_at_completion is null and fee_schedule_version_id is null)::text from public.clinical_tasks where id = v_t1));
  perform pg_temp.rec('a completed task cannot move again', '23514',
    pg_temp.try(format($q$select private.apply_task_transition(%L, 'open', 'system', null, 'x')$q$, v_t1)));
  perform pg_temp.rec('every move is logged (created, offered, open, claimed, open, claimed, completed)', '7',
    (select count(*)::text from public.clinical_task_transitions where task_id = v_t1));
  perform pg_temp.rec('...and each emitted an event, plus the created event', 'true',
    (select (count(*) >= 7)::text from public.domain_events where aggregate_type = 'clinical_task' and aggregate_id = v_t1));
  perform pg_temp.rec('the log is append only', '23514', pg_temp.try(format('delete from public.clinical_task_transitions where task_id = %L', v_t1)));
  perform pg_temp.rec('events carry only ids, states and the task type and class (INV-07, S10)', '0',
    (select count(*)::text from public.domain_events e, jsonb_object_keys(e.payload) k
      where e.aggregate_type = 'clinical_task' and e.aggregate_id = v_t1
        and k not in ('task_id', 'type', 'priority_class', 'from_state', 'to_state')));

  -- 5. Sweeps ---------------------------------------------------------------------------------------------
  perform private.create_clinical_task(v_p2, 'amber_bp_review', 100, 'proof:p2:amber');
  select id into v_t2 from public.clinical_tasks where patient_id = v_p2 and type = 'amber_bp_review';
  v_sweep := private.sweep_clinical_tasks();
  perform pg_temp.rec('an amber review within 4 hours of due moves to class 3', '3,4', (select priority_class || ',' || priority_class_original from public.clinical_tasks where id = v_t2));
  perform pg_temp.rec('...and is logged', '1', (select count(*)::text from public.clinical_task_transitions where task_id = v_t2 and reason like 'moved to priority class 3%'));
  v_sweep := private.sweep_clinical_tasks();
  perform pg_temp.rec('promotion happens once', '0', (v_sweep ->> 'promoted'));
  perform pg_temp.backdate(v_t2, 'due_at = now() - interval ''1 minute''');
  v_sweep := private.sweep_clinical_tasks();
  perform pg_temp.rec('an overdue task is escalated', 'escalated,1', (select state || ',' || escalation_level from public.clinical_tasks where id = v_t2));
  perform pg_temp.rec('...with an urgent event for S19', '1',
    (select count(*)::text from public.domain_events where event_type = 'clinical_task.escalated' and aggregate_id = v_t2 and priority = 'urgent'));
  perform private.apply_task_transition(v_t2, 'claimed', 'clinician', v_other, null, v_other, now() + interval '30 minutes');
  perform pg_temp.rec('an escalated task can still be claimed', 'claimed', (select state::text from public.clinical_tasks where id = v_t2));

  -- 5b. A repeat never vanishes into a claimed task ------------------------------------------------------
  v_dd1 := private.create_clinical_task(v_p4, 'admin_clinical', null, 'proof:dd');
  perform private.apply_task_transition(v_dd1, 'claimed', 'clinician', v_emp, null, v_emp, now() + interval '30 minutes');
  v_dd2 := private.create_clinical_task(v_p4, 'admin_clinical', null, 'proof:dd');
  perform pg_temp.rec('a repeat after a claim makes a follow-up task, not a merge', 'true,0',
    ((v_dd2 <> v_dd1)::text || ',' || (select merged_count from public.clinical_tasks where id = v_dd1)));
  v_dd3 := private.create_clinical_task(v_p4, 'admin_clinical', null, 'proof:dd');
  perform pg_temp.rec('a further repeat merges into the follow-up', 'true,1', ((v_dd3 = v_dd2)::text || ',' || (select merged_count from public.clinical_tasks where id = v_dd2)));

  -- 5c. Claims are checked in the database ----------------------------------------------------------------
  v_red2 := private.create_clinical_task(v_p5, 'red_event_unacknowledged');
  perform pg_temp.rec('a coordinator cannot claim a senior-tier task', '42501',
    pg_temp.try(format($q$select private.apply_task_transition(%L, 'claimed', 'clinician', %L, null, %L, now() + interval '30 minutes')$q$, v_red2, v_coord, v_coord)));
  perform pg_temp.rec('a claim made on someone else''s behalf is refused', '42501',
    pg_temp.try(format($q$select private.apply_task_transition(%L, 'claimed', 'clinician', %L, null, %L, now() + interval '30 minutes')$q$, v_red2, v_emp, v_other)));
  perform private.apply_task_transition(v_red2, 'claimed', 'clinician', v_other, null, v_other, now() + interval '30 minutes');
  perform pg_temp.rec('only the claimer can complete', '42501',
    pg_temp.try(format($q$select private.apply_task_transition(%L, 'completed', 'clinician', %L, null, null, null, '{}'::jsonb)$q$, v_red2, v_emp)));
  perform pg_temp.rec('only the claimer can hand back', '42501',
    pg_temp.try(format($q$select private.apply_task_transition(%L, 'open', 'clinician', %L, 'not mine')$q$, v_red2, v_emp)));
  perform private.apply_task_transition(v_red2, 'open', 'clinician', v_other, 'need more information');
  perform pg_temp.rec('a hand-back counts', '1', (select handback_count::text from public.clinical_tasks where id = v_red2));
  perform private.apply_task_transition(v_red2, 'claimed', 'clinician', v_other, null, v_other, now() + interval '30 minutes');
  perform private.apply_task_transition(v_red2, 'open', 'system', null, 'claim timed out');
  perform pg_temp.rec('a timeout does not count as a hand-back', '1', (select handback_count::text from public.clinical_tasks where id = v_red2));

  -- 5d. One failing task never stops the sweep ------------------------------------------------------------
  v_poison := private.create_clinical_task(v_p6, 'async_question', 0, 'proof:poison');
  v_ok := private.create_clinical_task(v_p1, 'async_question', 0, 'proof:ok');
  execute format($q$create function public.s16_proof_poison() returns trigger language plpgsql as
    $f$ begin if new.task_id = %L::uuid and new.to_state = 'escalated' then raise exception 'poisoned'; end if; return new; end $f$ $q$, v_poison);
  execute 'create trigger s16_proof_poison before insert on public.clinical_task_transitions for each row execute function public.s16_proof_poison()';
  v_sweep := private.sweep_clinical_tasks();
  perform pg_temp.rec('the sweep reports one error and still escalates the other overdue task', '1,escalated',
    ((v_sweep ->> 'errors') || ',' || (select state::text from public.clinical_tasks where id = v_ok)));
  perform pg_temp.rec('the failure is in the audit log', '1',
    (select count(*)::text from public.audit_log where action = 'clinical_task_sweep.error' and entity_id = v_poison));
  perform pg_temp.rec('and an ops incident is open', '1',
    (select count(*)::text from public.ops_incidents where external_reference = 'clinical_task_sweep' and status not in ('resolved', 'closed')));
  drop trigger s16_proof_poison on public.clinical_task_transitions;

  -- 6. Clinical-lead actions ------------------------------------------------------------------------------
  perform pg_temp.act(v_other);
  perform pg_temp.rec('a non-CMO cannot cancel', '42501', pg_temp.try(format($q$select public.cancel_clinical_task(%L, 'no longer needed here')$q$, v_red)));
  perform pg_temp.rec('a non-CMO cannot override a priority', '42501', pg_temp.try(format($q$select public.override_task_priority(%L, 2::smallint, 'clinical judgement says so')$q$, v_red)));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('cancel needs a reason of 10 characters', '22023', pg_temp.try(format($q$select public.cancel_clinical_task(%L, 'short')$q$, v_red)));
  perform pg_temp.rec('the CMO can override a priority with a reason', 'ok', pg_temp.try(format($q$select public.override_task_priority(%L, 2::smallint, 'worsening trend noted by the lead')$q$, v_red)));
  perform pg_temp.rec('...the original class is kept and the override named', '2,1,true',
    (select priority_class || ',' || priority_class_original || ',' || (priority_override_by = v_cmo)::text from public.clinical_tasks where id = v_red));
  perform pg_temp.rec('the CMO can cancel with a reason', 'ok', pg_temp.try(format($q$select public.cancel_clinical_task(%L, 'raised in error, patient reached')$q$, v_red)));
  perform pg_temp.rec('a cancelled task cannot be cancelled again', '23514', pg_temp.try(format($q$select public.cancel_clinical_task(%L, 'second attempt at cancelling')$q$, v_red)));
  perform pg_temp.back();
  perform pg_temp.rec('both lead actions are in the audit log', '2',
    (select count(*)::text from public.audit_log where entity_id = v_red and action in ('clinical_task.cancelled', 'clinical_task.priority_overridden')));

  -- 7. Access ---------------------------------------------------------------------------------------------
  -- a fresh pushed task for v_emp on patient 3
  perform private.create_clinical_task(v_p3, 'symptom_review', null, 'proof:p3:symptom');
  select id into v_t3 from public.clinical_tasks where patient_id = v_p3 and type = 'symptom_review';
  perform pg_temp.rec('the new task is offered to the employed doctor', 'offered_to_lead',  (select state::text from public.clinical_tasks where id = v_t3));
  perform pg_temp.act(v_p3);
  perform pg_temp.rec('a patient sees no tasks', '0', (select count(*)::text from public.clinical_tasks));
  perform pg_temp.back();
  perform pg_temp.act(v_other);
  perform pg_temp.rec('an unrelated clinician does not see an offer made to someone else', '0', (select count(*)::text from public.clinical_tasks where id = v_t3));
  perform pg_temp.rec('...and is not tied to that patient', 'false', private.clinician_has_patient_access(v_p3)::text);
  perform pg_temp.back();
  perform pg_temp.act(v_emp);
  perform pg_temp.rec('the offered doctor sees their task', '1', (select count(*)::text from public.clinical_tasks where id = v_t3));
  perform pg_temp.rec('...and is tied to the patient while it is offered (INV-12)', 'true', private.clinician_has_patient_access(v_p3)::text);
  perform pg_temp.rec('...and has no write grant on the tables at all', 'false',
    (has_table_privilege('authenticated', 'public.clinical_tasks', 'UPDATE') or has_table_privilege('authenticated', 'public.clinical_tasks', 'INSERT')
      or has_table_privilege('authenticated', 'public.clinical_task_transitions', 'INSERT') or has_table_privilege('authenticated', 'public.task_claims', 'INSERT'))::text);
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('admin sees every task', 'true', (select (count(*) >= 3)::text from public.clinical_tasks));
  perform pg_temp.rec('admin can read the adapter view', 'ok', pg_temp.try('select count(*) from public.legacy_clinical_work_v'));
  perform pg_temp.rec('queue_health counts no test rows', '0', (public.queue_health() ->> 'open'));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot read tasks', '42501', pg_temp.try('select count(*) from public.clinical_tasks'));
  perform pg_temp.back();
  perform pg_temp.rec('inside an offer window only the named clinician may claim', '42501',
    pg_temp.try(format($q$select private.apply_task_transition(%L, 'claimed', 'clinician', %L, null, %L, now() + interval '30 minutes')$q$, v_t3, v_other, v_other)));
  -- the offer lapses: the tie and the read both end
  perform pg_temp.backdate(v_t3, 'lead_window_ends_at = now() - interval ''1 minute''');
  perform private.sweep_clinical_tasks();
  perform pg_temp.act(v_emp);
  perform pg_temp.rec('once it returns to the pool the doctor is no longer tied', 'false', private.clinician_has_patient_access(v_p3)::text);
  perform pg_temp.rec('...and can no longer read the task row (INV-12)', '0', (select count(*)::text from public.clinical_tasks where id = v_t3));
  perform pg_temp.back();

  perform pg_temp.rec('anon and authenticated cannot run the subscriber or the transition function', '0',
    (select count(*)::text from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and p.proname in ('create_tasks_from_triage_event', 'apply_task_transition', 'create_clinical_task', 'sweep_clinical_tasks', 'pick_employed_clinician')
       and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))));
  perform pg_temp.rec('anon cannot run any S16 public function', '0',
    (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('cancel_clinical_task', 'override_task_priority', 'queue_health', 'create_tasks_from_triage_event')
       and has_function_privilege('anon', p.oid, 'EXECUTE')));
  perform pg_temp.rec('the sweep is scheduled', '1', (select count(*)::text from cron.job where jobname = 'sweep-clinical-tasks'));
  perform pg_temp.rec('the triage subscriber is registered', '1', (select count(*)::text from public.event_subscribers where subscriber_key = 'queue.create_from_triage'));
  perform pg_temp.rec('every S16 table has row level security', '0',
    (select count(*)::text from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
       and c.relname in ('task_types', 'queue_config', 'clinical_tasks', 'clinical_task_transition_rules', 'clinical_task_transitions', 'task_claims', 'task_handbacks')
       and not c.relrowsecurity));

  -- 9. SABOTAGE: drop the guard; a direct state update must now succeed ----------------------------------------
  drop trigger clinical_tasks_guard on public.clinical_tasks;
  insert into results values ('sabotaged', 'a direct state update is refused', '42501',
    pg_temp.try(format('update public.clinical_tasks set state = ''escalated'' where id = %L', v_t3)));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S16 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then
    raise exception 'VACUOUS TEST: dropping the state guard did not change the direct-update check';
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged row is asserted to FAIL inside the DO block above. It is deliberately not printed: the runner
-- treats any FAIL verdict in the output as a failed proof.

rollback;
