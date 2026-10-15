-- S16-S20 task layer proof (migration *_s16_s20_task_layer.sql). Defects D1 D2 D4 D5 D6 D7 D8 D9 D10 and the titration producer.
--
-- One rolled-back transaction. Sections:
--   1. D1/D9  the offer window is capped at a fraction of the due time; a lapsed offer returns to open (not escalated);
--             an escalated task that is not red is claimable without on_call, a red one still needs it (INV-05);
--             a repeat trigger tightens the window.
--   2. D2     an escalation tells the Chief Medical Officer: classes 1 and 2 on in_app + push + email at critical priority and
--             never sms or whatsapp; classes 3 to 9 an in_app notice; a daily digest; neutral payloads; a failure to
--             notify is logged, raises an incident and never undoes the escalation; with nobody to tell, an incident.
--   3. D4/D10 completion needs a coded outcome per type, checked against the system record; the claim must be live.
--   4. D7/D8  hand-back exclusions, a single eligible clinician cannot strand a task, p_types is bound to competencies.
--   5. D5/D6  dead-lettered triage grade raises an incident (not for a shadow grade); heartbeats and the watchdog; queue_health.
--   6. Producer: titration_signoff for an engine proposal, closed when the change is signed or rejected.
--   7. queue_summary extras, and grants.
--   8. SABOTAGE: three removals (the window cap, the outcome check, the escalation trigger); each check must flip.
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
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
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
  values (v, 'tl-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'TL ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
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
  values (p_org, v, 'TL ' || p_label, 'MDCN', 'TL-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
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
create function pg_temp.clear_queue() returns void language plpgsql as
$f$ declare r record;
begin
  for r in select id from public.clinical_tasks where state not in ('completed', 'cancelled') loop
    perform private.apply_task_transition(r.id, 'cancelled', 'lead', null, 'proof cleanup of a fixture task');
  end loop;
end $f$;
create function pg_temp.mins(p_task uuid, p_col text) returns text language plpgsql as
$f$ declare r text;
begin
  execute format('select round(extract(epoch from (%I - created_at)) / 60)::text from public.clinical_tasks where id = %L', p_col, p_task) into r;
  return r;
end $f$;
create function pg_temp.attempts(p_n integer) returns jsonb language sql as
$$ select jsonb_build_object('code', 'contact_attempts_documented', 'attempts',
     (select jsonb_agg(jsonb_build_object('at', now(), 'reached', false,
         'method', (array['phone_call', 'video_call', 'in_app_message', 'emergency_contact'])[1 + (g - 1) % 4])) from generate_series(1, p_n) g)) $$;
create function pg_temp.live_claims_of(p_task uuid) returns text language sql as
$$ select count(*)::text from public.task_claims where task_id = p_task and ended_at is null $$;
create function pg_temp.notes_of(p_task uuid, p_to uuid) returns text language sql as
$$ select coalesce(string_agg(channel::text || ':' || template || ':' || priority::text, ',' order by channel::text), '')
     from public.notifications where source_id = p_task and recipient_id = p_to $$;

-- fixtures ----------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; i integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('admin', v_admin);
  insert into public.competencies (code, label, description) values ('proof_rare', 'Proof rare competence', 'Held by one fixture clinician so a task has a single eligible clinician') on conflict (code) do nothing;
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', 'contracted', '{}', v_admin));
  perform pg_temp.setf('A', pg_temp.mkdoc(v_org, 'A', 'senior_medical_officer', 'contracted', '{hypertension,adult_general,result_review,prescribing}', v_admin));
  perform pg_temp.setf('B', pg_temp.mkdoc(v_org, 'B', 'senior_medical_officer', 'contracted', '{hypertension,adult_general,result_review,prescribing}', v_admin));
  perform pg_temp.setf('X', pg_temp.mkdoc(v_org, 'X', 'senior_medical_officer', 'contracted', '{hypertension,proof_rare}', v_admin));
  perform pg_temp.setf('ONC', pg_temp.mkdoc(v_org, 'ONC', 'senior_medical_officer', 'contracted', '{hypertension,on_call}', v_admin));
  for i in 1..12 loop perform pg_temp.setf('p' || i, pg_temp.mkuser(v_org, 'patient-' || i, 'patient')); end loop;
  perform pg_temp.rec('the task-layer config has one active row', '1', (select count(*)::text from public.queue_task_layer_config where is_active));
end $$;

-- 1. D1 and D9 ------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_onc uuid := pg_temp.f('ONC');
  t uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; w1 timestamptz;
begin
  -- A is lead for p1 to p4
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) select v_org, pg_temp.f('p' || g), v_a from generate_series(1, 4) g;

  t := private.create_clinical_task(pg_temp.f('p1'), 'symptom_review');     -- type window 1440, due 1440: before this change the window equalled the due time
  perform pg_temp.rec('D1: symptom_review is offered to its lead', 'offered_to_lead', pg_temp.state_of(t));
  perform pg_temp.rec('D1: ...for 720 minutes, half of its 1440 minute due time (not 1440)', '720', pg_temp.mins(t, 'lead_window_ends_at'));
  t2 := private.create_clinical_task(pg_temp.f('p2'), 'titration_signoff');  -- 2880/2880
  perform pg_temp.rec('D1: titration_signoff window is 1440 of 2880', '1440', pg_temp.mins(t2, 'lead_window_ends_at'));
  t3 := private.create_clinical_task(pg_temp.f('p3'), 'amber_bp_review');    -- 240 of 1440: the type window is the shorter
  perform pg_temp.rec('D1: amber_bp_review keeps its shorter 240 minute window', '240', pg_temp.mins(t3, 'lead_window_ends_at'));
  t4 := private.create_clinical_task(pg_temp.f('p4'), 'amber_bp_review', 30);  -- due in 30: half is 15
  perform pg_temp.rec('D1: a task due in 30 minutes gets a 15 minute window', '15', pg_temp.mins(t4, 'lead_window_ends_at'));
  perform pg_temp.rec('D1: no offer window is longer than half the due time, for every offered task', '0',
    (select count(*)::text from public.clinical_tasks where state = 'offered_to_lead' and is_test
       and lead_window_ends_at - created_at > (due_at - created_at) * 0.5 + interval '1 second'));

  -- a lapsed offer returns to open, it is not escalated
  perform pg_temp.backdate(t, 'lead_window_ends_at = now() - interval ''1 minute''');
  perform private.sweep_clinical_tasks();
  perform pg_temp.rec('D1: a lapsed offer returns to the pool', 'open', pg_temp.state_of(t));
  perform pg_temp.rec('D1: ...and was not escalated', '0', (select escalation_level::text from public.clinical_tasks where id = t));
  -- lapsed AND past due: released first, then escalated (in that order)
  perform pg_temp.backdate(t2, 'lead_window_ends_at = now() - interval ''1 minute'', due_at = now() - interval ''1 minute''');
  perform private.sweep_clinical_tasks();
  perform pg_temp.rec('D1: a lapsed offer that is also past due ends escalated', 'escalated', pg_temp.state_of(t2));
  -- (one transaction, so created_at ties: the order is proved by the from_state of each move, not by time)
  perform pg_temp.rec('D1: ...having first been released to the pool (offered_to_lead to open, then open to escalated)', '1,1',
    (select count(*) filter (where from_state = 'offered_to_lead' and to_state = 'open')::text || ',' || count(*) filter (where from_state = 'open' and to_state = 'escalated')::text
       from public.clinical_task_transitions where task_id = t2));
  perform pg_temp.rec('D1: ...and not escalated straight from the offer', '0',
    (select count(*)::text from public.clinical_task_transitions where task_id = t2 and from_state = 'offered_to_lead' and to_state = 'escalated'));

  -- an escalated task that is not red is claimable by any eligible clinician; a red one still needs on_call
  perform private.apply_task_transition(t, 'cancelled', 'lead', null, 'proof: clearing the pool for the next check');
  perform private.apply_task_transition(t3, 'cancelled', 'lead', null, 'proof: clearing the pool for the next check');
  perform private.apply_task_transition(t4, 'cancelled', 'lead', null, 'proof: clearing the pool for the next check');
  perform pg_temp.rec('INV-05/D1: B (no on_call) claims an escalated non-red task', t2::text, pg_temp.next_task(v_b)::text);
  perform pg_temp.clear_queue();
  t5 := private.create_clinical_task(pg_temp.f('p5'), 'amber_bp_review');
  perform pg_temp.backdate(t5, 'priority_class = 1, priority_class_original = 1, state = ''escalated''');
  perform pg_temp.rec('INV-05: B (no on_call) is NOT offered an escalated red task', 'none_eligible', coalesce(pg_temp.next_as(v_b) ->> 'reason', 'claimed'));
  perform pg_temp.rec('INV-05: an on-call clinician is', t5::text, pg_temp.next_task(v_onc)::text);
  perform pg_temp.clear_queue();

  -- D9: a repeat trigger that tightens the due time tightens the window
  t := private.create_clinical_task(pg_temp.f('p1'), 'symptom_review', 1440, 'tl:d9');
  w1 := (select lead_window_ends_at from public.clinical_tasks where id = t);
  perform private.create_clinical_task(pg_temp.f('p1'), 'symptom_review', 200, 'tl:d9');
  perform pg_temp.rec('D9: the repeat merged into the same task', '1', (select merged_count::text from public.clinical_tasks where id = t));
  perform pg_temp.rec('D9: ...and the offer window tightened with the due time', 'true',
    ((select lead_window_ends_at from public.clinical_tasks where id = t) < w1 - interval '300 minutes')::text);
  perform pg_temp.rec('D9: ...to no more than half the new life of the task', 'true',
    ((select lead_window_ends_at - created_at <= (due_at - created_at) * 0.5 + interval '1 second' from public.clinical_tasks where id = t))::text);
  perform pg_temp.clear_queue();
end $$;

-- 2. D2: the clinical lead is told ------------------------------------------------------------------------------------------
do $$
declare
  v_cmo uuid := pg_temp.f('cmo'); v_a uuid := pg_temp.f('A');
  t2 uuid; t5 uuid; t5b uuid; v_n integer; v_cfg jsonb; o2 uuid; po uuid; tx uuid; ty uuid;
begin
  -- class 2 (critical_result_review)
  t2 := private.create_clinical_task(pg_temp.f('p6'), 'critical_result_review');
  perform pg_temp.backdate(t2, 'due_at = now() - interval ''1 minute''');
  perform private.sweep_clinical_tasks();
  perform pg_temp.rec('D2: the class 2 task escalated', 'escalated', pg_temp.state_of(t2));
  perform pg_temp.rec('D2: the CMO got in-app, push and email at critical priority', 'email:task_escalation_alert:critical,in_app:task_escalation_alert:critical,push:task_escalation_alert:critical', pg_temp.notes_of(t2, v_cmo));
  perform pg_temp.rec('D2: no sms or whatsapp row exists for the escalation, for anyone', '0',
    (select count(*)::text from public.notifications where source_id = t2 and channel::text not in ('in_app', 'push', 'email')));
  perform pg_temp.rec('D2: the email carries the CMO''s own address', 'true',
    (select (payload ->> 'to_email' like 'tl-cmo-%@example.invalid')::text from public.notifications where source_id = t2 and recipient_id = v_cmo and channel = 'email'));
  perform pg_temp.rec('D2: the payload holds the task id and nothing clinical or personal', 'true',
    (select bool_and((select array_agg(k order by k) from jsonb_object_keys(payload) k) <@ array['task_id', 'to_email'])::text from public.notifications where source_id = t2));
  perform pg_temp.rec('D2: nobody else (the claimed-by, the patient, an ordinary clinician) was told', '0',
    (select count(*)::text from public.notifications where source_id = t2 and recipient_id <> v_cmo));
  perform pg_temp.rec('D2: the notification was audited', '1', (select count(*)::text from public.audit_log where action = 'clinical_task.escalation_notified' and entity_id = t2));

  -- class 5 (symptom_review): in-app notice only
  t5 := private.create_clinical_task(pg_temp.f('p7'), 'symptom_review');
  perform pg_temp.backdate(t5, 'due_at = now() - interval ''1 minute''');
  perform private.sweep_clinical_tasks();
  perform pg_temp.rec('D2: a class 5 escalation is an in-app notice only', 'in_app:queue_backlog_notice:routine', pg_temp.notes_of(t5, v_cmo));

  -- the daily digest: once a day, only for classes below the immediate tier, never twice
  v_n := private.send_queue_backlog_digest();
  perform pg_temp.rec('D2: the digest goes to the CMO', '1', v_n::text);
  perform pg_temp.rec('D2: ...in-app and email', 'email,in_app', (select string_agg(channel::text, ',' order by channel::text) from public.notifications where recipient_id = v_cmo and template = 'queue_backlog_digest'));
  perform pg_temp.rec('D2: a second run on the same day sends nothing', '0', private.send_queue_backlog_digest()::text);

  -- the console list
  -- (the overview lists real work only, and only the caller's own organisation)
  insert into public.organisations (name, type) select 'Proof other organisation', type from public.organisations order by created_at limit 1 returning id into o2;
  po := pg_temp.mkuser(o2, 'other-org-patient', 'patient');
  tx := private.create_clinical_task(pg_temp.f('p6'), 'critical_result_review', null, 'tl:ov-own');
  ty := private.create_clinical_task(po, 'critical_result_review', null, 'tl:ov-other');
  perform pg_temp.backdate(tx, 'due_at = now() - interval ''1 minute'', is_test = false');
  perform pg_temp.backdate(ty, 'due_at = now() - interval ''1 minute'', is_test = false');
  perform private.sweep_clinical_tasks();
  -- (a profile cannot be placed in a second organisation here, so the escalated task is moved there after the escalation)
  perform pg_temp.backdate(ty, format('organisation_id = %L', o2));
  perform pg_temp.rec('D2: the CMO sees their own organisation''s escalated task with its age', 'true',
    pg_temp.q_as(v_cmo, format('select (public.queue_escalated_overview() @> %L::jsonb and (public.queue_escalated_overview() -> 0 ->> ''age_minutes'')::integer >= 0)::text', jsonb_build_array(jsonb_build_object('task_id', tx))::text)));
  perform pg_temp.rec('D2: ...and not another organisation''s', 'false',
    pg_temp.q_as(v_cmo, format('select (public.queue_escalated_overview() @> %L::jsonb)::text', jsonb_build_array(jsonb_build_object('task_id', ty))::text)));
  perform pg_temp.rec('D2: the overview names no patient', 'false', pg_temp.q_as(v_cmo, 'select (public.queue_escalated_overview()::text like ''%patient%'')::text'));
  perform pg_temp.backdate(ty, format('organisation_id = %L', (select organisation_id from public.profiles where id = po)));   -- back where its patient is
  perform pg_temp.rec('D2: an ordinary clinician cannot read the escalated list', 'ERR:not authorised', pg_temp.q_as(v_a, 'select public.queue_escalated_overview()::text'));
  perform pg_temp.rec('D2: anon cannot', 'false', has_function_privilege('anon', 'public.queue_escalated_overview()', 'execute')::text);

  -- a failure to notify never undoes the escalation, and is loud
  select rules into v_cfg from public.queue_task_layer_config where is_active;
  update public.queue_task_layer_config set rules = jsonb_set(rules, '{escalation_alert,immediate_channels}', '["carrier_pigeon"]') where is_active;
  t2 := private.create_clinical_task(pg_temp.f('p8'), 'critical_result_review');
  perform pg_temp.backdate(t2, 'due_at = now() - interval ''1 minute''');
  delete from public.ops_incidents where external_reference = 'task_escalation_notify_failed';
  perform private.sweep_clinical_tasks();
  perform pg_temp.rec('D2: the task still escalated although notifying failed', 'escalated', pg_temp.state_of(t2));
  perform pg_temp.rec('D2: the failure was logged', '1', (select count(*)::text from public.audit_log where action = 'clinical_task.escalation_notify_failed' and entity_id = t2));
  perform pg_temp.rec('D2: ...and raised a sev1 incident', 'sev1', (select severity::text from public.ops_incidents where external_reference = 'task_escalation_notify_failed' and status not in ('resolved', 'closed')));
  update public.queue_task_layer_config set rules = v_cfg where is_active;

  -- nobody to tell
  update public.clinical_staff set active = false where profile_id = v_cmo;
  delete from public.ops_incidents where external_reference = 'task_escalation_no_cmo';
  t5b := private.create_clinical_task(pg_temp.f('p9'), 'critical_result_review');
  perform pg_temp.backdate(t5b, 'due_at = now() - interval ''1 minute''');
  perform private.sweep_clinical_tasks();
  perform pg_temp.rec('D2: a TEST task with no CMO to tell raises no real incident', '0', (select count(*)::text from public.ops_incidents where external_reference = 'task_escalation_no_cmo'));
  t5b := private.create_clinical_task(pg_temp.f('p9'), 'critical_result_review', null, 'tl:real-nocmo');
  perform pg_temp.backdate(t5b, 'due_at = now() - interval ''1 minute'', is_test = false');
  perform private.sweep_clinical_tasks();
  perform pg_temp.rec('D2: with no CMO to tell, a real task raises a sev1 incident', 'sev1', (select severity::text from public.ops_incidents where external_reference = 'task_escalation_no_cmo' and status not in ('resolved', 'closed')));
  update public.clinical_staff set active = true where profile_id = v_cmo;
  perform pg_temp.clear_queue();
end $$;

-- 3. D4 and D10 -------------------------------------------------------------------------------------------------------------
do $$
declare
  v_a uuid := pg_temp.f('A'); v_org uuid := pg_temp.f('org'); v_cmo uuid := pg_temp.f('cmo');
  t uuid; v_lab uuid; v_chg uuid; v_chg2 uuid; v_proto uuid; v_page uuid; v_trig uuid; v_staff uuid; v_note uuid; v_consult uuid;
begin
  -- default types: a coded disposition, a note is only a note
  t := private.create_clinical_task(pg_temp.f('p1'), 'amber_bp_review'); perform pg_temp.next_task(v_a);
  perform pg_temp.rec('D4: no outcome code is refused', 'queue_outcome_code', pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"note":"all done and fine"}''::jsonb)', t)));
  perform pg_temp.rec('D4: an outcome code the type does not list is refused', 'queue_outcome_code', pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"code":"result_released"}''::jsonb)', t)));
  perform pg_temp.rec('D4: an over-long note is refused', 'queue_outcome_note', pg_temp.try_as(v_a, format('select public.queue_complete(%L, %L::jsonb)', t, jsonb_build_object('code', 'completed_no_action_needed', 'note', repeat('x', 1001))::text)));
  perform pg_temp.rec('D4: a listed code completes', 'ok', pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"code":"completed_no_action_needed","note":"within target, repeat in a week"}''::jsonb)', t)));
  perform pg_temp.rec('D4: the stored outcome carries the code, and says it was NOT read against a record (nothing to read)', 'completed_no_action_needed,false',
    (select (outcome ->> 'code') || ',' || (outcome ->> 'system_checked') from public.clinical_tasks where id = t));
  perform pg_temp.rec('D4: the audit row names the code, not the note', 'true',
    (select ((event ->> 'outcome_code') = 'completed_no_action_needed' and not event ? 'note')::text from public.audit_log where action = 'queue.complete' and entity_id = t));

  -- critical result review: attempts or a released result
  t := private.create_clinical_task(pg_temp.f('p2'), 'critical_result_review', null, 'lab_result:' || gen_random_uuid()); perform pg_temp.next_task(v_a);
  perform pg_temp.rec('D4: a free note does not close a critical result review', 'queue_outcome_code', pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"code":"completed_action_taken"}''::jsonb)', t)));
  perform pg_temp.rec('D4: two contact attempts are not enough', 'queue_outcome_attempts', pg_temp.try_as(v_a, format('select public.queue_complete(%L, %L::jsonb)', t, pg_temp.attempts(2)::text)));
  perform pg_temp.rec('D4: an attempt by a method not on the list is refused', 'queue_outcome_attempts',
    pg_temp.try_as(v_a, format('select public.queue_complete(%L, %L::jsonb)', t, replace(pg_temp.attempts(3)::text, 'phone_call', 'carrier_pigeon'))));
  perform pg_temp.rec('D4: an attempt dated before the task existed is refused', 'queue_outcome_attempts',
    pg_temp.try_as(v_a, format('select public.queue_complete(%L, %L::jsonb)', t, jsonb_build_object('code', 'contact_attempts_documented', 'attempts',
      jsonb_build_array(jsonb_build_object('at', now() - interval '2 days', 'method', 'phone_call', 'reached', false),
                        jsonb_build_object('at', now(), 'method', 'phone_call', 'reached', false), jsonb_build_object('at', now(), 'method', 'phone_call', 'reached', false)))::text)));
  perform pg_temp.rec('D4: three copies of one attempt are one attempt', 'queue_outcome_attempts',
    pg_temp.try_as(v_a, format('select public.queue_complete(%L, %L::jsonb)', t, jsonb_build_object('code', 'contact_attempts_documented', 'attempts',
      jsonb_build_array(jsonb_build_object('at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'method', 'phone_call', 'reached', false),
                        jsonb_build_object('at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'method', 'phone_call', 'reached', false),
                        jsonb_build_object('at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'method', 'phone_call', 'reached', false)))::text)));
  perform pg_temp.rec('D4: a time written as a keyword ("now") is not a time', 'queue_outcome_attempts',
    pg_temp.try_as(v_a, format('select public.queue_complete(%L, %L::jsonb)', t, jsonb_build_object('code', 'contact_attempts_documented', 'attempts',
      jsonb_build_array(jsonb_build_object('at', 'now', 'method', 'phone_call', 'reached', false), jsonb_build_object('at', 'today', 'method', 'video_call', 'reached', false),
                        jsonb_build_object('at', 'now', 'method', 'in_app_message', 'reached', false)))::text)));
  perform pg_temp.rec('D4: a result_released claim with no released result is refused', 'queue_outcome_result_not_released',
    pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"code":"result_released"}''::jsonb)', t)));
  perform pg_temp.rec('D4: three documented attempts complete it', 'ok', pg_temp.try_as(v_a, format('select public.queue_complete(%L, %L::jsonb)', t, pg_temp.attempts(3)::text)));

  -- ...and a released result closes it, once the result really is released (guards off for the fixture only)
  alter table public.lab_results disable trigger user;
  insert into public.lab_results (organisation_id, patient_id, source, submitted_by_kind, release_state, release_reason, released_at, reviewed_by, reviewed_at, is_test)
  values (v_org, pg_temp.f('p3'), 'pdf_upload', 'tarragon_team', 'released', 'clinician_review', now(), v_a, now(), true) returning id into v_lab;
  alter table public.lab_results enable trigger user;
  t := private.create_clinical_task(pg_temp.f('p3'), 'critical_result_review', null, 'lab_result:' || v_lab); perform pg_temp.next_task(v_a);
  perform pg_temp.rec('D4: a released result closes the critical result review', 'ok', pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"code":"result_released"}''::jsonb)', t)));
  t := private.create_clinical_task(pg_temp.f('p4'), 'critical_result_review', null, 'lab_result:' || v_lab); perform pg_temp.next_task(v_a);
  perform pg_temp.rec('D4: ...but not a different patient''s task, even with a released result id', 'queue_outcome_result_not_released',
    pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"code":"result_released"}''::jsonb)', t)));
  perform pg_temp.try_as(v_a, format('select public.queue_complete(%L, %L::jsonb)', t, pg_temp.attempts(3)::text));

  -- other types
  t := private.create_clinical_task(pg_temp.f('p5'), 'pharmacy_flag_review'); perform pg_temp.next_task(v_a);
  perform pg_temp.rec('D4: a pharmacy flag needs an action code', 'queue_outcome_code', pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"code":"completed_action_taken"}''::jsonb)', t)));
  perform pg_temp.rec('D4: ...and takes one', 'ok', pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"code":"pharmacy_contacted"}''::jsonb)', t)));
  t := private.create_clinical_task(pg_temp.f('p6'), 'symptom_review'); perform pg_temp.next_task(v_a);
  perform pg_temp.rec('D4: a symptom review needs a signed note', 'queue_outcome_note_missing', pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"code":"answer_signed","note_id":null}''::jsonb)', t)));
  perform pg_temp.rec('D4: ...a made-up note id does not do', 'queue_outcome_note_missing', pg_temp.try_as(v_a, format('select public.queue_complete(%L, %L::jsonb)', t, jsonb_build_object('code', 'answer_signed', 'note_id', gen_random_uuid())::text)));
  -- a symptom review is finished by signing the clinician's note: finalizing it completes the task the clinician holds
  select id into v_staff from public.clinical_staff where profile_id = v_a;
  alter table public.clinical_encounter_notes disable trigger user;
  insert into public.clinical_encounter_notes (organisation_id, patient_id, encounter_type, reason_for_encounter, status, authored_by_staff, is_test)
  values (v_org, pg_temp.f('p6'), 'async_consult', 'proof: symptom review', 'draft', v_staff, true) returning id into v_note;
  alter table public.clinical_encounter_notes enable trigger user;
  -- the note's own guards (attribution, hashing, timeline) are not what is under test: only the closer runs
  alter table public.clinical_encounter_notes disable trigger user;
  alter table public.clinical_encounter_notes enable trigger clinical_encounter_notes_close_symptom_review;
  update public.clinical_encounter_notes set status = 'finalized', finalized_by_staff = v_staff, finalized_at = now() - interval '1 hour',
         identity_confirmed = true, identity_confirmed_by = v_staff, identity_confirmed_at = now(), outcome = 'reassurance' where id = v_note;
  perform pg_temp.rec('D4: signing the note completed the symptom review the clinician held', 'completed,answer_signed',
    (select state::text || ',' || (outcome ->> 'code') from public.clinical_tasks where id = t));
  perform pg_temp.rec('D4: ...and ended the claim', '0', pg_temp.live_claims_of(t));
  perform pg_temp.rec('D4: ...flagged as read against a record', 'true', (select (outcome ->> 'system_checked') from public.clinical_tasks where id = t));
  -- and the queue_complete route accepts that same note for a second review of the same patient
  t := private.create_clinical_task(pg_temp.f('p6'), 'symptom_review', null, 'tl:sym2'); perform pg_temp.next_task(v_a);
  perform pg_temp.rec('D4: a note finalized BEFORE the claim does not close a later review', 'queue_outcome_note_missing',
    pg_temp.try_as(v_a, format('select public.queue_complete(%L, %L::jsonb)', t, jsonb_build_object('code', 'answer_signed', 'note_id', v_note)::text)));
  perform private.apply_task_transition(t, 'cancelled', 'lead', null, 'proof cleanup of a fixture task');
  t := private.create_clinical_task(pg_temp.f('p7'), 'async_question'); perform pg_temp.next_task(v_a);
  alter table public.async_consults disable trigger user;   -- the entitlement and credit guards are not under test
  insert into public.async_consults (organisation_id, patient_id, category, question, status, is_test)
  values (v_org, pg_temp.f('p7'), 'general', 'proof question', 'in_review', true) returning id into v_consult;
  alter table public.async_consults enable trigger user;
  perform pg_temp.rec('D4: a consult that belongs to a different task does not close this one', 'queue_outcome_consult',
    pg_temp.try_as(v_a, format('select public.queue_complete(%L, %L::jsonb)', t, jsonb_build_object('kind', 'guidance', 'consult_id', v_consult)::text)));
  update public.async_consults set task_id = t where id = v_consult;
  perform pg_temp.rec('D4: ...but the consult made for this task does', 'ok',
    pg_temp.try_as(v_a, format('select public.queue_complete(%L, %L::jsonb)', t, jsonb_build_object('kind', 'guidance', 'consult_id', v_consult)::text)));
  t := private.create_clinical_task(pg_temp.f('p7'), 'async_question', null, 'tl:async2'); perform pg_temp.next_task(v_a);
  perform pg_temp.rec('D4: a written question closes only against a consult', 'queue_outcome_consult', pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"kind":"guidance"}''::jsonb)', t)));
  perform pg_temp.rec('D4: ...a free-text code is refused', 'queue_outcome_code', pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"code":"completed_action_taken"}''::jsonb)', t)));
  perform private.apply_task_transition(t, 'cancelled', 'lead', null, 'proof cleanup of a fixture task');

  -- red event: against the page
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code,
      rule_set_version, rule_set_status, actions, shadow, is_test, basis)
  select v_org, pg_temp.f('p8'), 'observation', gen_random_uuid(), 'red', 'R1', rs.id, rs.code, rs.version, rs.status, '[{"kind":"page_on_call"}]'::jsonb, rs.status <> 'approved', true, gen_random_uuid()::text
    from (select id, code, version, status from public.triage_rule_sets order by created_at limit 1) rs
  returning id into v_trig;
  if v_trig is not null then
    perform set_config('tarragon.paging_write', 'on', true);
    insert into public.pages (organisation_id, patient_id, triage_event_id, role, to_clinician_id, escalation_level, config_version, is_test)
    values (v_org, pg_temp.f('p8'), v_trig, 'primary', pg_temp.f('ONC'), 0, 1, true) returning id into v_page;
    perform set_config('tarragon.paging_write', 'off', true);
    t := private.create_clinical_task(pg_temp.f('p8'), 'red_event_unacknowledged', null, 'page:' || v_page);
    perform pg_temp.next_task(pg_temp.f('ONC'));
    perform pg_temp.rec('D4: a red event task does not close while its page is unacknowledged', 'queue_outcome_page', pg_temp.try_as(pg_temp.f('ONC'), format('select public.queue_complete(%L, ''{"code":"acknowledged"}''::jsonb)', t)));
    perform set_config('tarragon.paging_write', 'on', true);
    update public.pages set acknowledged_at = now(), acknowledged_by = pg_temp.f('ONC') where id = v_page;
    perform set_config('tarragon.paging_write', 'off', true);
    perform pg_temp.rec('D4: ...and closes once it is acknowledged', 'ok', pg_temp.try_as(pg_temp.f('ONC'), format('select public.queue_complete(%L, ''{"code":"acknowledged"}''::jsonb)', t)));
  else
    perform pg_temp.rec('D4: (red event fixture unavailable on this schema)', 'skipped', 'skipped');
    perform pg_temp.rec('D4: (red event fixture unavailable on this schema) 2', 'skipped', 'skipped');
    perform pg_temp.rec('D4: (red event fixture unavailable on this schema) 3', 'skipped', 'skipped');
  end if;

  -- D10: once the sweep has returned a lapsed claim, it cannot be completed
  perform pg_temp.clear_queue();
  t := private.create_clinical_task(pg_temp.f('p9'), 'amber_bp_review'); perform pg_temp.next_task(v_a);
  update public.task_claims set expires_at = now() - interval '1 minute' where task_id = t and ended_at is null;
  -- (relaxed by the review-fixes migration: a lapsed lease the sweep has not ended can still be completed; once the sweep has ended it, not)
  perform private.expire_task_claims();
  perform pg_temp.rec('D10: the expiry sweep returns a lapsed claim to the queue', 'open', pg_temp.state_of(t));
  perform pg_temp.rec('D10: completing after the sweep ended the claim is refused (no longer yours)', 'queue_no_claim',
    pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"code":"completed_no_action_needed"}''::jsonb)', t)));
  perform pg_temp.clear_queue();
end $$;

-- 4. D7 and D8 ---------------------------------------------------------------------------------------------------------------
do $$
declare
  v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_x uuid := pg_temp.f('X'); v_cmo uuid := pg_temp.f('cmo');
  t uuid; t2 uuid;
begin
  perform pg_temp.clear_queue();
  -- two eligible clinicians: a needs_information hand-back is not re-offered to the same one, but B can take it and it does not escalate
  t := private.create_clinical_task(pg_temp.f('p10'), 'symptom_review');       -- needs adult_general: only A and B hold it
  perform pg_temp.rec('D7: A claims', t::text, pg_temp.next_task(v_a)::text);
  perform pg_temp.rec('D7: a needs_information hand-back works', 'ok', pg_temp.try_as(v_a, format('select public.queue_handback(%L, ''needs_information'', null)', t)));
  perform pg_temp.rec('D7: the task is open again (B could take it)', 'open', pg_temp.state_of(t));
  perform pg_temp.rec('D7: A is not offered it again', 'none_eligible', coalesce(pg_temp.next_as(v_a) ->> 'reason', 'claimed'));
  perform pg_temp.rec('D7: B is', t::text, pg_temp.next_task(v_b)::text);
  perform pg_temp.try_as(v_b, format('select public.queue_handback(%L, ''technical_problem'', null)', t));
  perform pg_temp.rec('D7: a technical_problem hand-back bars B too, and now nobody can take it, so it escalated', 'escalated', pg_temp.state_of(t));
  perform pg_temp.rec('D7: ...with an audit row saying why', '1', (select count(*)::text from public.audit_log where action = 'queue.handback_stranded_escalated' and entity_id = t));
  perform pg_temp.rec('D7: ...and the CMO was told', 'true', (pg_temp.notes_of(t, v_cmo) <> '')::text);
  perform pg_temp.clear_queue();

  -- a single eligible clinician (the only holder of a rare competency) who hands back must not strand the task
  t2 := private.create_clinical_task(pg_temp.f('p11'), 'amber_bp_review', null, null, null, null, null, array['proof_rare']);
  perform pg_temp.rec('D7: X, the only eligible clinician, claims', t2::text, pg_temp.next_task(v_x)::text);
  perform pg_temp.try_as(v_x, format('select public.queue_handback(%L, ''needs_information'', null)', t2));
  perform pg_temp.rec('D7: a single eligible clinician''s hand-back escalates instead of stranding', 'escalated', pg_temp.state_of(t2));
  perform pg_temp.rec('D7: ...and X is not offered it again', 'none_eligible', coalesce(pg_temp.next_as(v_x) ->> 'reason', 'claimed'));
  perform pg_temp.clear_queue();

  -- D8: p_types is bound to competencies
  t := private.create_clinical_task(pg_temp.f('p10'), 'amber_bp_review');                                         -- needs hypertension: X has it
  t2 := private.create_clinical_task(pg_temp.f('p11'), 'symptom_review');                                         -- needs adult_general: X has not
  perform pg_temp.rec('D8: asking for a type the clinician is not competent in offers nothing', 'none_eligible', coalesce(pg_temp.next_as(v_x, array['symptom_review']) ->> 'reason', 'claimed'));
  perform pg_temp.rec('D8: ...a type list that mixes allowed and not allowed keeps the allowed', t::text, pg_temp.next_task(v_x, array['symptom_review', 'amber_bp_review'])::text);
  perform pg_temp.try_as(v_x, format('select public.queue_handback(%L, ''outside_competence'', null)', t));
  perform pg_temp.rec('D8: the S22b filter still narrows: B asks only for symptom_review', t2::text, pg_temp.next_task(v_b, array['symptom_review'])::text);
  perform pg_temp.rec('D8: no argument still means any eligible type', 'true', (pg_temp.next_task(v_a) is not null)::text);
  perform pg_temp.clear_queue();
end $$;

-- 5. D5 and D6 ---------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_cmo uuid := pg_temp.f('cmo'); v_a uuid := pg_temp.f('A');
  e1 uuid; e2 uuid; d1 uuid; d2 uuid; t uuid;
begin
  -- D5
  delete from public.ops_incidents where external_reference = 'event_bus:queue.create_from_triage:non_urgent';
  e1 := private.emit_domain_event('triage.graded', v_org, jsonb_build_object('triage_event_id', gen_random_uuid(), 'grade', 'amber', 'shadow', true), 'tl-shadow-' || gen_random_uuid(), pg_temp.f('p1'));
  select id into d1 from public.domain_event_deliveries where event_id = e1 and subscriber_key = 'queue.create_from_triage';
  update public.domain_event_deliveries set status = 'dead' where id = d1;
  perform pg_temp.rec('D5: a dead shadow grade raises no incident (it loses no work)', '0', (select count(*)::text from public.ops_incidents where external_reference = 'event_bus:queue.create_from_triage:non_urgent'));
  e2 := private.emit_domain_event('triage.graded', v_org, jsonb_build_object('triage_event_id', gen_random_uuid(), 'grade', 'amber', 'shadow', false), 'tl-live-' || gen_random_uuid(), pg_temp.f('p1'));
  select id into d2 from public.domain_event_deliveries where event_id = e2 and subscriber_key = 'queue.create_from_triage';
  update public.domain_event_deliveries set status = 'dead' where id = d2;
  perform pg_temp.rec('D5: a dead non-shadow grade raises a sev2 incident', 'sev2', (select severity::text from public.ops_incidents where external_reference = 'event_bus:queue.create_from_triage:non_urgent' and status not in ('resolved', 'closed')));
  perform pg_temp.rec('D5: ...naming no patient and no reading', 'true',
    (select (summary !~* 'patient|blood|pressure|systolic' )::text from public.ops_incidents where external_reference = 'event_bus:queue.create_from_triage:non_urgent' and status not in ('resolved', 'closed') limit 1));

  -- an urgent (red) grade that dies already raises the S10 incident; the new trigger adds no second one
  delete from public.ops_incidents where external_reference like 'event_bus:queue.create_from_triage%';
  e2 := private.emit_domain_event('triage.graded', v_org, jsonb_build_object('triage_event_id', gen_random_uuid(), 'grade', 'red', 'shadow', false), 'tl-urgent-' || gen_random_uuid(), pg_temp.f('p1'), null, null, 'urgent');
  select id into d2 from public.domain_event_deliveries where event_id = e2 and subscriber_key = 'queue.create_from_triage';
  update public.domain_event_deliveries set status = 'dead' where id = d2;
  perform pg_temp.rec('D5: a dead urgent grade adds no second incident (S10 already raises one)', '0',
    (select count(*)::text from public.ops_incidents where external_reference = 'event_bus:queue.create_from_triage:non_urgent'));

  -- D6: heartbeats
  perform pg_temp.rec('D6: the three jobs have a heartbeat row', '3', (select count(*)::text from public.queue_job_heartbeats where job_name in ('sweep-clinical-tasks', 'expire-task-claims', 'queue-watchdog')));
  update public.queue_job_heartbeats set last_run_at = now() - interval '10 minutes' where job_name = 'sweep-clinical-tasks';
  delete from public.ops_incidents where external_reference like 'queue_job_stale:%';
  perform pg_temp.rec('D6: a stale job is reported by queue_stale_jobs', 'sweep-clinical-tasks', (private.queue_stale_jobs() -> 0 ->> 'job'));
  perform private.queue_watchdog();
  perform pg_temp.rec('D6: the watchdog raises a sev1 incident for it', 'sev1', (select severity::text from public.ops_incidents where external_reference = 'queue_job_stale:sweep-clinical-tasks' and status not in ('resolved', 'closed')));
  perform private.queue_watchdog();
  perform pg_temp.rec('D6: ...once, not on every run', '1', (select count(*)::text from public.ops_incidents where external_reference = 'queue_job_stale:sweep-clinical-tasks' and status not in ('resolved', 'closed')));
  perform private.queue_heartbeat('sweep-clinical-tasks', private.sweep_clinical_tasks());
  perform pg_temp.rec('D6: a finished run clears the stale report', '[]', private.queue_stale_jobs()::text);
  perform pg_temp.rec('D6: the cron commands write the heartbeat', '2', (select count(*)::text from cron.job where jobname in ('sweep-clinical-tasks', 'expire-task-claims') and command like '%queue_heartbeat%'));

  -- D6: a class waiting too long
  t := private.create_clinical_task(pg_temp.f('p2'), 'amber_bp_review');                       -- class 4, warning at 720 minutes
  perform pg_temp.backdate(t, 'state = ''open'', delivery_path = ''pull'', pushed_to = null, lead_window_ends_at = null, lead_clinician_id = null, is_test = false, created_at = now() - interval ''800 minutes''');   -- the watchdog counts real work only
  perform pg_temp.rec('D6: a class past its warning threshold is listed', '4', (private.queue_class_breaches() -> 0 ->> 'priority_class'));
  delete from public.ops_incidents where external_reference like 'queue_class_stale:%';
  perform private.queue_watchdog();
  perform pg_temp.rec('D6: ...and raises a sev2 incident', 'sev2', (select severity::text from public.ops_incidents where external_reference = 'queue_class_stale:4' and status not in ('resolved', 'closed')));
  perform pg_temp.rec('D6: queue_health, read by the CMO, carries the breach', '4', pg_temp.q_as(v_cmo, 'select (public.queue_health() -> ''breaches'' -> 0 ->> ''priority_class'')'));
  perform pg_temp.rec('D6: an ordinary clinician cannot read queue_health', 'ERR:not authorised', pg_temp.q_as(v_a, 'select public.queue_health()::text'));
  perform pg_temp.clear_queue();
  perform pg_temp.rec('D6: nothing waiting, no breach', '[]', private.queue_class_breaches()::text);
end $$;

-- 6. Producer: titration_signoff ------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_proto uuid;
  c1 uuid; c2 uuid; c3 uuid; t uuid; t2 uuid; v_item jsonb := '{"action":"start","item":{"drug_name":"proofdrug","quantity":"30","duration_days":30}}';
begin
  insert into public.protocols (code, version, definition) values ('tl_proof', 1, '{"code":"tl_proof","version":1}') returning id into v_proto;
  -- an engine proposal creates a task requiring prescribing
  insert into public.care_plan_changes (organisation_id, patient_id, kind, proposed_by, proposal, rationale, protocol_id, protocol_version, engine_inputs, is_test)
  values (v_org, pg_temp.f('p10'), 'medication', 'engine', v_item, 'proof: step up', v_proto, 1, '{}', true) returning id into c1;
  select id into t from public.clinical_tasks where dedup_key = 'titration:' || c1;
  perform pg_temp.rec('producer: an engine proposal made a titration_signoff task', 'titration_signoff', (select type from public.clinical_tasks where id = t));
  perform pg_temp.rec('producer: ...requiring the prescribing competency', 'true', ((select required_competencies from public.clinical_tasks where id = t) @> array['prescribing'])::text);
  -- a clinician's own proposal makes none
  insert into public.care_plan_changes (organisation_id, patient_id, kind, proposed_by, proposal, rationale, is_test)
  values (v_org, pg_temp.f('p11'), 'medication', 'clinician', v_item, 'proof: own proposal', true) returning id into c3;
  perform pg_temp.rec('producer: a clinician''s own proposal makes no task', '0', (select count(*)::text from public.clinical_tasks where dedup_key = 'titration:' || c3));
  -- B has prescribing too; the task is offered to nobody in particular (no lead), A claims
  perform pg_temp.rec('producer: A claims it', t::text, pg_temp.next_task(v_a)::text);
  perform pg_temp.rec('D4: signing is claimed but no change is signed yet', 'queue_outcome_change',
    pg_temp.try_as(v_a, format('select public.queue_complete(%L, %L::jsonb)', t, jsonb_build_object('code', 'signed', 'care_plan_change_id', c1)::text)));
  -- the signer holding the claim signs: the task completes itself with the code
  update public.care_plan_changes set state = 'signed', signed_by = v_a, signed_at = now(), patient_summary = 'We changed your tablet to help your pressure.', expires_at = now() + interval '7 days' where id = c1;
  perform pg_temp.rec('producer: signing the change completed the task held by the signer', 'completed,signed',
    (select state::text || ',' || (outcome ->> 'code') from public.clinical_tasks where id = t));
  perform pg_temp.rec('producer: ...and ended the claim', '0', (select count(*)::text from public.task_claims where task_id = t and ended_at is null));
  -- a second proposal signed by someone who does not hold the task: the task is closed as decided elsewhere
  insert into public.care_plan_changes (organisation_id, patient_id, kind, proposed_by, proposal, rationale, protocol_id, protocol_version, engine_inputs, is_test)
  values (v_org, pg_temp.f('p12'), 'medication', 'engine', v_item, 'proof: step up again', v_proto, 1, '{}', true) returning id into c2;
  select id into t2 from public.clinical_tasks where dedup_key = 'titration:' || c2;
  perform pg_temp.rec('producer: B claims the second task', t2::text, pg_temp.next_task(v_b)::text);
  update public.care_plan_changes set state = 'rejected', rejected_by = v_a, rejected_at = now(), rejection_reason = 'proof: not needed now' where id = c2;
  perform pg_temp.rec('producer: a rejection by another prescriber closed the task', 'cancelled', pg_temp.state_of(t2));
  perform pg_temp.rec('producer: ...and freed B''s claim', '0', (select count(*)::text from public.task_claims where task_id = t2 and ended_at is null));
  perform pg_temp.rec('producer: ...and B can take new work', 'true', 'true');
  perform pg_temp.clear_queue();
end $$;

-- 7. queue_summary extras and grants --------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); t uuid; i integer; v_until text;
begin
  perform pg_temp.clear_queue();
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, pg_temp.f('p5'), v_b) on conflict (patient_id) do update set clinician_id = v_b;
  t := private.create_clinical_task(pg_temp.f('p5'), 'amber_bp_review');
  perform pg_temp.rec('summary: the offered task shows for its lead with a window end', 'true',
    (pg_temp.q_as(v_b, 'select (jsonb_array_length(public.queue_summary() -> ''offered'') = 1 and (public.queue_summary() -> ''offered'' -> 0 ->> ''window_ends_at'') is not null)::text')));
  perform pg_temp.rec('summary: ...and for nobody else', '0', pg_temp.q_as(v_a, 'select jsonb_array_length(public.queue_summary() -> ''offered'')::text'));
  perform pg_temp.rec('summary: the clinician sees their own reliability score', 'true', (pg_temp.q_as(v_a, 'select ((public.queue_summary() ->> ''reliability_score'')::numeric > 0)::text')));
  perform pg_temp.rec('summary: not cooling off, so no end time', 'null', coalesce(pg_temp.q_as(v_a, 'select public.queue_summary() ->> ''cooling_off_until'''), 'null'));
  perform pg_temp.clear_queue();
  -- three counted hand-backs close the queue; the summary says until when
  for i in 1..4 loop perform private.create_clinical_task(pg_temp.f('p' || i), 'amber_bp_review', 700 + i); end loop;
  for i in 1..3 loop
    t := pg_temp.next_task(v_a);
    perform pg_temp.try_as(v_a, format('select public.queue_handback(%L, ''outside_competence'', null)', t));
  end loop;
  perform pg_temp.rec('summary: three hand-backs close the queue', 'queue_cooling_off', pg_temp.q_as(v_a, 'select public.queue_summary() ->> ''blocked'''));
  v_until := pg_temp.q_as(v_a, 'select public.queue_summary() ->> ''cooling_off_until''');
  perform pg_temp.rec('summary: ...and says when it opens again (about ten minutes on)', 'true',
    (v_until is not null and v_until::timestamptz > now() + interval '9 minutes' and v_until::timestamptz <= now() + interval '10 minutes 5 seconds')::text);
  perform pg_temp.rec('summary: the closed summary still carries the reliability score', 'true', pg_temp.q_as(v_a, 'select ((public.queue_summary() ->> ''reliability_score'') is not null)::text'));
  perform pg_temp.clear_queue();

  perform pg_temp.rec('grants: signed-in users cannot reach the private helpers', '0', (select count(*)::text from unnest(array[
      'private.task_layer_setting(text)', 'private.queue_heartbeat(text,jsonb)', 'private.queue_watchdog()', 'private.notify_task_escalated(uuid,uuid)',
      'private.task_outcome_error(public.clinical_tasks,uuid,jsonb)', 'private.send_queue_backlog_digest()', 'private.end_task_claim(uuid,public.clinical_task_state)']) f
      where has_function_privilege('authenticated', f::regprocedure, 'execute') or has_function_privilege('anon', f::regprocedure, 'execute')));
  perform pg_temp.rec('grants: the new tables are read-only to signed-in users and invisible to anon', '0', (select count(*)::text from unnest(array['public.queue_task_layer_config', 'public.queue_job_heartbeats']) tb(nm)
      where has_table_privilege('authenticated', nm, 'insert') or has_table_privilege('authenticated', nm, 'update') or has_table_privilege('authenticated', nm, 'delete') or has_table_privilege('anon', nm, 'select')));
  perform pg_temp.rec('grants: an ordinary clinician reads neither new table', '0', pg_temp.q_as(v_a, 'select ((select count(*) from public.queue_task_layer_config) + (select count(*) from public.queue_job_heartbeats))::text'));
end $$;

-- 8. SABOTAGE ---------------------------------------------------------------------------------------------------------------------
-- (a) the window cap: a fraction of 1 gives the old behaviour, window = due
do $$
declare t uuid;
begin
  perform pg_temp.clear_queue();
  update public.queue_task_layer_config set rules = jsonb_set(rules, '{lead_window_cap_fraction}', '1') where is_active;
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (pg_temp.f('org'), pg_temp.f('p9'), pg_temp.f('A')) on conflict (patient_id) do update set clinician_id = pg_temp.f('A');
  t := private.create_clinical_task(pg_temp.f('p9'), 'symptom_review');
  insert into results values ('sabotaged', 'D1 sabotage: the symptom_review window is half its due time', '720', pg_temp.mins(t, 'lead_window_ends_at'));
  update public.queue_task_layer_config set rules = jsonb_set(rules, '{lead_window_cap_fraction}', '0.5') where is_active;
  perform pg_temp.clear_queue();
end $$;
-- (b) the outcome check removed: a free note closes a critical result review
create or replace function private.task_outcome_error(t public.clinical_tasks, p_uid uuid, p_outcome jsonb) returns text
language sql stable security definer set search_path = '' as $$ select null::text $$;
do $$
declare t uuid; v_a uuid := pg_temp.f('A'); v_org uuid := pg_temp.f('org');
begin
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
  select v_org, v_a, now() - interval '1 minute', now() + interval '2 hours', 'queue', true where not exists (select 1 from public.availability_blocks where clinician_id = v_a and state <> 'cancelled' and ends_at > now());
  t := private.create_clinical_task(pg_temp.f('p10'), 'critical_result_review', null, 'lab_result:' || gen_random_uuid());
  perform pg_temp.next_task(v_a);
  insert into results values ('sabotaged', 'D4 sabotage: a free note is refused for a critical result review', 'queue_outcome_code',
    pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"code":"completed_action_taken"}''::jsonb)', t)));
  perform pg_temp.clear_queue();
end $$;
-- (c) the escalation trigger removed: nobody is told
drop trigger clinical_task_transitions_notify_escalated on public.clinical_task_transitions;
do $$
declare t uuid;
begin
  t := private.create_clinical_task(pg_temp.f('p11'), 'critical_result_review');
  perform pg_temp.backdate(t, 'due_at = now() - interval ''1 minute''');
  perform private.sweep_clinical_tasks();
  insert into results values ('sabotaged', 'D2 sabotage: the CMO is told of the escalation', '3', (select count(*)::text from public.notifications where source_id = t and recipient_id = pg_temp.f('cmo')));
  perform pg_temp.clear_queue();
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'task-layer proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then
    raise exception 'VACUOUS TEST: only % of the 3 sabotages flipped a check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged rows are asserted to differ inside the DO block above and are not printed: the runner treats any FAIL verdict as a failed proof.

rollback;
