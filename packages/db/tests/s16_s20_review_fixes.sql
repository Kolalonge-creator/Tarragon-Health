-- S16-S20 review fixes proof (migration *_s16_s20_task_layer_review_fixes.sql).
--   1. D10 relaxed: a lapsed but still-live claim can be completed (late if past due); a claim the sweep ended or that was reassigned cannot.
--   2. The two new cron jobs share no schedule with any other job.
--   3. The watchdog is watched: a watchdog with no finished run in 25 minutes is reported by queue_stale_jobs and queue_health.
--   4. Cancelling a claimed task tells the claimant (neutral, in app) and my_task_outcome says "withdrawn".
--   5. Contact attempts may be dated up to 24 hours before the task was created.
--   6. Escalation flood: one push and one email, then one follow-up with a count; every task still has its in-app row and is still escalated.
--   7. SABOTAGE: the lease check put back, the coalescing window set to zero, the look-back set to zero; each check must flip.
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
create function pg_temp.next_task(p_uid uuid) returns uuid language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.queue_next(); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return (r -> 'task' ->> 'id')::uuid;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'rf-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'RF ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_comps text[], p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid; c text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'RF ' || p_label, 'MDCN', 'RF-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true)
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
create function pg_temp.escalate(p_task uuid) returns void language plpgsql as
$f$ begin
  perform pg_temp.backdate(p_task, 'due_at = now() - interval ''1 minute''');
  perform private.sweep_clinical_tasks();
end $f$;
create function pg_temp.attempts_at(p_hours_ago numeric) returns jsonb language sql as
$$ select jsonb_build_object('code', 'contact_attempts_documented', 'attempts', jsonb_build_array(
     jsonb_build_object('at', to_char(now() - make_interval(hours => p_hours_ago::int), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'method', 'phone_call', 'reached', false),
     jsonb_build_object('at', to_char(now() - make_interval(hours => p_hours_ago::int), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'method', 'video_call', 'reached', false),
     jsonb_build_object('at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'method', 'in_app_message', 'reached', false))) $$;
create function pg_temp.sent_to(p_to uuid, p_template text, p_channel text) returns text language sql as
$$ select count(*)::text from public.notifications where recipient_id = p_to and template = p_template and channel::text = p_channel $$;

do $$
declare v_org uuid; v_admin uuid; i integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  perform pg_temp.setf('org', v_org);
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', '{}', v_admin));
  perform pg_temp.setf('A', pg_temp.mkdoc(v_org, 'A', 'senior_medical_officer', '{hypertension,adult_general,result_review}', v_admin));
  perform pg_temp.setf('B', pg_temp.mkdoc(v_org, 'B', 'senior_medical_officer', '{hypertension,adult_general,result_review}', v_admin));
  for i in 1..6 loop perform pg_temp.setf('p' || i, pg_temp.mkuser(v_org, 'patient-' || i, 'patient')); end loop;
end $$;

-- 1. D10 relaxed ---------------------------------------------------------------------------------------------------------------
do $$
declare v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); t uuid; t2 uuid;
  v_done text := 'select public.queue_complete(%L, ''{"code":"completed_no_action_needed"}''::jsonb)';
begin
  t := private.create_clinical_task(pg_temp.f('p1'), 'amber_bp_review'); perform pg_temp.next_task(v_a);
  update public.task_claims set expires_at = now() - interval '1 minute' where task_id = t and ended_at is null;
  perform pg_temp.rec('D10: a lapsed claim the sweep has not ended can be completed', 'ok', pg_temp.try_as(v_a, format(v_done, t)));
  perform pg_temp.rec('D10: ...the task is completed', 'completed', pg_temp.state_of(t));
  perform pg_temp.rec('D10: ...on time, because it was not yet due', '1',
    (select count(*)::text from public.clinician_reliability_events where task_id = t and kind = 'completed_on_time'));
  -- past due and lapsed: completed late, not refused
  t := private.create_clinical_task(pg_temp.f('p2'), 'amber_bp_review'); perform pg_temp.next_task(v_a);
  perform pg_temp.backdate(t, 'due_at = now() - interval ''5 minutes''');
  update public.task_claims set expires_at = now() - interval '1 minute' where task_id = t and ended_at is null;
  perform pg_temp.rec('D10: a lapsed claim on a task past its due time completes', 'ok', pg_temp.try_as(v_a, format(v_done, t)));
  perform pg_temp.rec('D10: ...and counts as completed late', '1', (select count(*)::text from public.clinician_reliability_events where task_id = t and kind = 'completed_late'));
  -- once the sweep has ended the claim, or another clinician holds the task, it is no longer theirs
  t := private.create_clinical_task(pg_temp.f('p3'), 'amber_bp_review'); perform pg_temp.next_task(v_a);
  update public.task_claims set expires_at = now() - interval '1 minute' where task_id = t and ended_at is null;
  perform private.expire_task_claims();
  perform pg_temp.rec('D10: after the sweep ended the claim, completing is refused', 'queue_no_claim', pg_temp.try_as(v_a, format(v_done, t)));
  perform pg_temp.rec('D10: ...B takes the task', t::text, pg_temp.next_task(v_b)::text);
  perform pg_temp.rec('D10: ...and A, who held it before, is still refused', 'queue_no_claim', pg_temp.try_as(v_a, format(v_done, t)));
  perform pg_temp.clear_queue();
end $$;

-- 2. cron --------------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.rec('cron: the watchdog runs at its own minutes', '14-59/10 * * * *', (select schedule from cron.job where jobname = 'queue-watchdog'));
  perform pg_temp.rec('cron: the digest runs at 06:27 UTC (07:27 Lagos)', '27 6 * * *', (select schedule from cron.job where jobname = 'queue-backlog-digest'));
  perform pg_temp.rec('cron: no other job shares either schedule', '0',
    (select count(*)::text from cron.job j where j.jobname not in ('queue-watchdog', 'queue-backlog-digest')
        and j.schedule in ('14-59/10 * * * *', '27 6 * * *')));
end $$;

-- 3. the watchdog is watched ---------------------------------------------------------------------------------------------------------
do $$
declare v_cmo uuid := pg_temp.f('cmo');
begin
  update public.queue_job_heartbeats set last_run_at = now() - interval '20 minutes' where job_name = 'queue-watchdog';
  perform pg_temp.rec('watchdog: 20 minutes without a run is still fine (it runs every 10)', '[]', private.queue_stale_jobs()::text);
  update public.queue_job_heartbeats set last_run_at = now() - interval '30 minutes' where job_name = 'queue-watchdog';
  perform pg_temp.rec('watchdog: 30 minutes without a run is reported', 'queue-watchdog', private.queue_stale_jobs() -> 0 ->> 'job');
  perform pg_temp.rec('watchdog: ...and the clinical lead sees it in queue_health', 'queue-watchdog', pg_temp.q_as(v_cmo, 'select public.queue_health() -> ''stale_jobs'' -> 0 ->> ''job'''));
  update public.queue_job_heartbeats set last_run_at = now() where job_name = 'queue-watchdog';
  perform pg_temp.rec('watchdog: a finished run clears it', '[]', private.queue_stale_jobs()::text);
  perform pg_temp.rec('watchdog: the sweep and expiry job allowances still apply', 'true',
    (select (private.queue_stale_jobs() = '[]'::jsonb)::text from (select 1) x where
       (select count(*) from public.queue_job_heartbeats where job_name in ('sweep-clinical-tasks', 'expire-task-claims')) = 2));
end $$;

-- 4. a withdrawn task ------------------------------------------------------------------------------------------------------------------
do $$
declare v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_cmo uuid := pg_temp.f('cmo'); t uuid; t2 uuid; t3 uuid;
begin
  t := private.create_clinical_task(pg_temp.f('p1'), 'amber_bp_review'); perform pg_temp.next_task(v_a);
  perform pg_temp.rec('withdrawn: the lead cancels a task A is working on', 'ok', pg_temp.try_as(v_cmo, format('select public.cancel_clinical_task(%L, %L)', t, 'Proof: withdrawn while claimed')));
  perform pg_temp.rec('withdrawn: A is told, in app, once', '1', pg_temp.sent_to(v_a, 'task_withdrawn_notice', 'in_app'));
  perform pg_temp.rec('withdrawn: ...and the notice carries only the task id', 'task_id',
    (select string_agg(k, ',') from public.notifications n, jsonb_object_keys(n.payload) k where n.recipient_id = v_a and n.template = 'task_withdrawn_notice'));
  perform pg_temp.rec('withdrawn: nobody else is told', '0', pg_temp.sent_to(v_b, 'task_withdrawn_notice', 'in_app'));
  perform pg_temp.rec('withdrawn: the task page can say so', 'withdrawn', pg_temp.q_as(v_a, format('select public.my_task_outcome(%L)', t)));
  perform pg_temp.rec('withdrawn: for a clinician who never held it, nothing', 'null', coalesce(pg_temp.q_as(v_b, format('select public.my_task_outcome(%L)', t)), 'null'));
  -- an unclaimed task: no notice
  t2 := private.create_clinical_task(pg_temp.f('p2'), 'amber_bp_review');
  perform pg_temp.try_as(v_cmo, format('select public.cancel_clinical_task(%L, %L)', t2, 'Proof: withdrawn while open'));
  perform pg_temp.rec('withdrawn: cancelling an unclaimed task sends no notice', '1', pg_temp.sent_to(v_a, 'task_withdrawn_notice', 'in_app'));
  -- the other answers
  t3 := private.create_clinical_task(pg_temp.f('p3'), 'amber_bp_review'); perform pg_temp.next_task(v_a);
  perform pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"code":"referred_on"}''::jsonb)', t3));
  perform pg_temp.rec('withdrawn: a finished task reads as completed', 'completed', pg_temp.q_as(v_a, format('select public.my_task_outcome(%L)', t3)));
  perform pg_temp.rec('withdrawn: anon cannot ask', 'false', has_function_privilege('anon', 'public.my_task_outcome(uuid)', 'execute')::text);
  perform pg_temp.clear_queue();
end $$;

-- 5. contact attempts dated before the task existed -----------------------------------------------------------------------------------
do $$
declare v_a uuid := pg_temp.f('A'); t uuid;
begin
  t := private.create_clinical_task(pg_temp.f('p4'), 'critical_result_review', null, 'lab_result:' || gen_random_uuid()); perform pg_temp.next_task(v_a);
  perform pg_temp.rec('attempts: 25 hours before the task existed is refused', 'queue_outcome_attempts',
    pg_temp.try_as(v_a, format('select public.queue_complete(%L, %L::jsonb)', t, pg_temp.attempts_at(25)::text)));
  perform pg_temp.rec('attempts: 12 hours before the task existed is accepted', 'ok',
    pg_temp.try_as(v_a, format('select public.queue_complete(%L, %L::jsonb)', t, pg_temp.attempts_at(12)::text)));
  perform pg_temp.clear_queue();
end $$;

-- 6. escalation flood ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_cmo uuid := pg_temp.f('cmo'); t1 uuid; t2 uuid; t3 uuid; t4 uuid;
begin
  t1 := private.create_clinical_task(pg_temp.f('p1'), 'critical_result_review', null, 'tl:f1');
  t2 := private.create_clinical_task(pg_temp.f('p2'), 'critical_result_review', null, 'tl:f2');
  t3 := private.create_clinical_task(pg_temp.f('p3'), 'critical_result_review', null, 'tl:f3');
  perform pg_temp.escalate(t1);
  perform pg_temp.rec('flood: the first escalation alerts by in-app, push and email', 'email:task_escalation_alert:critical,in_app:task_escalation_alert:critical,push:task_escalation_alert:critical',
    (select coalesce(string_agg(channel::text || ':' || template || ':' || priority::text, ',' order by channel::text), '') from public.notifications where source_id = t1 and recipient_id = v_cmo));
  perform pg_temp.escalate(t2);
  perform pg_temp.escalate(t3);
  perform pg_temp.rec('flood: all three tasks are escalated, none dropped', '3', (select count(*)::text from public.clinical_tasks where id in (t1, t2, t3) and state = 'escalated'));
  perform pg_temp.rec('flood: every task has its own in-app alert', '3', pg_temp.sent_to(v_cmo, 'task_escalation_alert', 'in_app'));
  perform pg_temp.rec('flood: but only one push alert', '1', pg_temp.sent_to(v_cmo, 'task_escalation_alert', 'push'));
  perform pg_temp.rec('flood: and only one email alert', '1', pg_temp.sent_to(v_cmo, 'task_escalation_alert', 'email'));
  perform pg_temp.rec('flood: the other two are one follow-up by push, with the count', '1,2',
    (select count(*)::text || ',' || max((payload ->> 'count')) from public.notifications where recipient_id = v_cmo and template = 'task_escalation_more' and channel = 'push'));
  perform pg_temp.rec('flood: ...and one by email, with the count', '1,2',
    (select count(*)::text || ',' || max((payload ->> 'count')) from public.notifications where recipient_id = v_cmo and template = 'task_escalation_more' and channel = 'email'));
  perform pg_temp.rec('flood: the follow-up carries a count and the lead''s own address, nothing else', 'true',
    (select bool_and((select array_agg(k order by k) from jsonb_object_keys(payload) k) <@ array['count', 'to_email'])::text from public.notifications where template = 'task_escalation_more'));
  perform pg_temp.rec('flood: every escalation is still audited', '3', (select count(*)::text from public.audit_log where action = 'clinical_task.escalation_notified' and entity_id in (t1, t2, t3)));
  perform pg_temp.rec('flood: no sms or whatsapp anywhere', '0', (select count(*)::text from public.notifications where template like 'task_escalation%' and channel::text not in ('in_app', 'push', 'email')));
  -- after the window a new escalation alerts in full again
  update public.notifications set created_at = created_at - interval '11 minutes' where recipient_id = v_cmo and template in ('task_escalation_alert', 'task_escalation_more');
  t4 := private.create_clinical_task(pg_temp.f('p4'), 'critical_result_review', null, 'tl:f4');
  perform pg_temp.escalate(t4);
  perform pg_temp.rec('flood: past the window, a new escalation gets its own push and email again', 'email:task_escalation_alert:critical,in_app:task_escalation_alert:critical,push:task_escalation_alert:critical',
    (select coalesce(string_agg(channel::text || ':' || template || ':' || priority::text, ',' order by channel::text), '') from public.notifications where source_id = t4 and recipient_id = v_cmo));
  perform pg_temp.clear_queue();
end $$;

-- 7. SABOTAGE -------------------------------------------------------------------------------------------------------------------------------
-- (a) the lease check back in queue_complete
do $$
declare v_def text; v_a uuid := pg_temp.f('A'); t uuid;
begin
  v_def := pg_get_functiondef('public.queue_complete(uuid,jsonb)'::regprocedure);
  execute replace(v_def, E'  select * into t from public.clinical_tasks where id = p_task;',
                  E'  if c.expires_at <= now() then raise exception ''queue_claim_expired'' using errcode = ''42501''; end if;\n  select * into t from public.clinical_tasks where id = p_task;');
  t := private.create_clinical_task(pg_temp.f('p5'), 'amber_bp_review'); perform pg_temp.next_task(v_a);
  update public.task_claims set expires_at = now() - interval '1 minute' where task_id = t and ended_at is null;
  insert into results values ('sabotaged', 'D10 sabotage: a lapsed live claim completes', 'ok',
    pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"code":"completed_no_action_needed"}''::jsonb)', t)));
  perform pg_temp.clear_queue();
end $$;
-- (b) no coalescing window
create or replace function private.escalation_coalesce_window() returns interval language sql immutable set search_path = '' as $$ select interval '0 minutes'; $$;
do $$
declare v_cmo uuid := pg_temp.f('cmo'); t1 uuid; t2 uuid;
begin
  delete from public.notifications where recipient_id = v_cmo;
  t1 := private.create_clinical_task(pg_temp.f('p1'), 'critical_result_review', null, 'tl:s1');
  t2 := private.create_clinical_task(pg_temp.f('p2'), 'critical_result_review', null, 'tl:s2');
  perform pg_temp.escalate(t1);
  perform pg_temp.escalate(t2);
  insert into results values ('sabotaged', 'flood sabotage: two escalations make one push alert', '1', pg_temp.sent_to(v_cmo, 'task_escalation_alert', 'push'));
  perform pg_temp.clear_queue();
end $$;
-- (c) no look-back for contact attempts
create or replace function private.contact_attempt_lookback() returns interval language sql immutable set search_path = '' as $$ select interval '0 hours'; $$;
do $$
declare v_a uuid := pg_temp.f('A'); t uuid;
begin
  t := private.create_clinical_task(pg_temp.f('p6'), 'critical_result_review', null, 'lab_result:' || gen_random_uuid()); perform pg_temp.next_task(v_a);
  insert into results values ('sabotaged', 'attempts sabotage: an attempt 12 hours before the task is accepted', 'ok',
    pg_temp.try_as(v_a, format('select public.queue_complete(%L, %L::jsonb)', t, pg_temp.attempts_at(12)::text)));
  perform pg_temp.clear_queue();
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'review-fixes proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: only % of the 3 sabotages flipped a check', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged rows are asserted to differ above and are not printed: the runner treats any FAIL verdict as a failed proof.

rollback;
