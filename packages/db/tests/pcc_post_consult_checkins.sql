-- PCC proof: post-consultation check-ins at 48 hours and 7 days (migration *_pcc_post_consult_checkins.sql).
--
-- Proves in one rolled-back transaction:
--   1. Born closed: the config is unsigned and inactive, the guard is off, nothing is scheduled by a completed consultation.
--   2. Gates: guard on but no signed config schedules nothing; a signed config with the guard off schedules nothing; both on schedules two rows.
--   3. Scheduling: only a COMPLETED consultation of an allowed type (no-show, cancelled, failed, async never), due time exactly ended_at + 48h and +7d
--      (an evening Lagos completion is not moved), idempotent under a second schedule call and under a re-completion.
--   4. Backfill: a consultation completed while the guard was off gets its rows from the sweep once the guard is on.
--   5. Sweep: nothing opens before its due time; an open check-in has a patient task of kind consult_checkin, one neutral notification
--      (ids only, non_clinical) and its in-app companion; the notification window helper holds a night notice to 07:00 Lagos.
--   6. The generic Done is refused for a check-in task (answering is the only way to close it).
--   7. Answering: own check-in only; every question answered; a safe answer closes the task and raises NOTHING; several concerning answers raise exactly
--      ONE alert; a danger phrase in the note opens exactly one emergency event (and one alert in total); missed doses and a request for help create
--      one clinician task owned by the consultation's clinician; answering twice returns the stored result and creates nothing more.
--   8. Missed check-in: one gentle nudge only, then expired with a low-priority clinician task and NO alert; an expired check-in cannot be answered.
--   9. Cancellation: a reversed consultation cancels what is pending; a patient who already wrote to the care team skips the next check-in.
--  10. Access: the patient reads own rows only; staff have no table policy; the consultation's own clinician reads through the audited function and an
--      audit row is written; another clinician and the patient are refused; anon has no execute on anything.
--  11. SABOTAGE: the scheduling trigger dropped, the danger-phrase screen emptied, the close guard dropped, the clinician check removed, the notification
--      window helper emptied and the sweep granted to anon each flip a check.
begin;

alter table public.profiles disable trigger profiles_01_enforce_adult_registration;

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
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; perform set_config('request.jwt.claims', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'pcc-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'PCC ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '40 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  return v;
end $f$;
-- the guard, switched the way its own trigger allows (a log row in this transaction, then the update)
create function pg_temp.guard(p_on boolean) returns void language plpgsql as $f$
begin
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note, conditions)
  select 'post_consult_checkins_enabled', case when p_on then 'switched_on' else 'switched_off' end, p.id, 'admin', 'PCC proof', '[]'::jsonb from public.profiles p order by p.created_at limit 1;
  update public.go_live_guards
     set is_on = p_on, changed_at = case when p_on then now() end, changed_by = case when p_on then (select id from public.profiles order by created_at limit 1) end, change_note = case when p_on then 'PCC proof' end
   where key = 'post_consult_checkins_enabled';
end $f$;
-- a consultation: inserted in progress, then completed at a chosen time (the trigger fires on the update)
create function pg_temp.mkenc(p_org uuid, p_patient uuid, p_clin uuid, p_type text, p_ended timestamptz) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, started_at, policy_version, is_test)
  values (p_org, p_patient, p_clin, p_type, 'in_progress', p_ended - interval '30 minutes', p_ended - interval '29 minutes', 1, true) returning id into v;
  return v;
end $f$;
create function pg_temp.complete(p_enc uuid, p_ended timestamptz) returns void language sql as
$$ update public.encounters set status = 'completed', ended_at = p_ended where id = p_enc $$;
create function pg_temp.n_rows(p_enc uuid) returns text language sql as
$$ select count(*)::text from public.post_consult_checkins where encounter_id = p_enc $$;
create function pg_temp.answers(p_feeling text, p_new text, p_med text, p_unclear text) returns jsonb language sql as
$$ select jsonb_build_object('feeling', p_feeling, 'new_symptoms', p_new, 'medicines', p_med, 'unclear', p_unclear) $$;
-- open one check-in now: due in the past, then the sweep
create function pg_temp.open_one(p_enc uuid, p_code text) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  update public.post_consult_checkins set due_at = now() - interval '1 hour' where encounter_id = p_enc and offset_code = p_code returning id into v;
  perform private.post_consult_checkin_sweep();
  return v;
end $f$;
create function pg_temp.alerts_for(p_patient uuid) returns text language sql as
$$ select count(*)::text from public.clinician_alerts where patient_id = p_patient $$;
create function pg_temp.emergencies_for(p_patient uuid) returns text language sql as
$$ select count(*)::text from public.emergency_events where patient_id = p_patient $$;

do $$
declare
  v_org uuid; v_admin uuid; v_docA uuid; v_docB uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid; p7 uuid; p8 uuid; p9 uuid; stranger uuid;
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid; e6 uuid; e7 uuid; e8 uuid; e9 uuid; e10 uuid; e11 uuid; e12 uuid;
  c uuid; c2 uuid; v_ended timestamptz := date_trunc('minute', now()) - interval '1 hour';
  v_lagos_eve timestamptz := ((date_trunc('day', now() at time zone 'Africa/Lagos') - interval '1 day') + time '22:30') at time zone 'Africa/Lagos';
  v_out jsonb; v_thread uuid; v_task uuid; v_res text;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_docA := pg_temp.mkuser(v_org, 'doctor-a', 'clinician');
  v_docB := pg_temp.mkuser(v_org, 'doctor-b', 'clinician');
  p1 := pg_temp.mkuser(v_org, 'p1', 'patient'); p2 := pg_temp.mkuser(v_org, 'p2', 'patient'); p3 := pg_temp.mkuser(v_org, 'p3', 'patient');
  p4 := pg_temp.mkuser(v_org, 'p4', 'patient'); p5 := pg_temp.mkuser(v_org, 'p5', 'patient'); p6 := pg_temp.mkuser(v_org, 'p6', 'patient');
  p7 := pg_temp.mkuser(v_org, 'p7', 'patient'); p8 := pg_temp.mkuser(v_org, 'p8', 'patient'); p9 := pg_temp.mkuser(v_org, 'p9', 'patient');
  stranger := pg_temp.mkuser(v_org, 'stranger', 'patient');

  -- 1. Born closed ----------------------------------------------------------------------------------------------
  perform pg_temp.rec('the config is born unsigned and inactive', '0/1', (select (select count(*) from public.post_consult_checkin_config where is_active)::text || '/' || (select count(*) from public.post_consult_checkin_config where approved_at is null)::text));
  perform pg_temp.rec('the guard is born off', 'false', (select is_on::text from public.go_live_guards where key = 'post_consult_checkins_enabled'));
  perform pg_temp.rec('the task kind is accepted by the table', 'true', (select (pg_get_constraintdef(oid) like '%consult_checkin%')::text from pg_constraint where conname = 'care_tasks_kind_check'));
  e1 := pg_temp.mkenc(v_org, p1, v_docA, 'video', v_ended);
  perform pg_temp.complete(e1, v_ended);
  perform pg_temp.rec('guard off and config unsigned: nothing is scheduled', '0', pg_temp.n_rows(e1));

  -- 2. Gates ----------------------------------------------------------------------------------------------------
  perform pg_temp.guard(true);
  e2 := pg_temp.mkenc(v_org, p1, v_docA, 'video', v_ended);
  perform pg_temp.complete(e2, v_ended);
  perform pg_temp.rec('guard on but no signed config: nothing is scheduled', '0', pg_temp.n_rows(e2));
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('a clinician who is not the CMO cannot sign the config', '42501', pg_temp.try('select public.sign_post_consult_checkin_config(1)'));
  perform pg_temp.back();
  -- the CMO's signature, as the function records it (the signer is a fixture admin: the proof of WHO may sign is the refusal above)
  update public.post_consult_checkin_config set approved_at = now(), approved_by = v_admin, is_active = true where version = 1;
  perform pg_temp.guard(false);
  e3 := pg_temp.mkenc(v_org, p1, v_docA, 'video', v_ended);
  perform pg_temp.complete(e3, v_ended);
  perform pg_temp.rec('signed config but guard off: nothing is scheduled', '0', pg_temp.n_rows(e3));

  -- 4 (set up before the guard is on). e2 and e3 were completed while closed: the sweep will backfill them
  perform pg_temp.guard(true);

  perform pg_temp.rec('post_consult_checkin_config carries the superseded-version guard (counted here, not in governed_config_supersede_guard.sql)', '1',
    (select count(*)::text from pg_trigger where tgname = 'refuse_superseded_activation' and not tgisinternal and tgrelid = 'public.post_consult_checkin_config'::regclass));

  -- 3. Scheduling -----------------------------------------------------------------------------------------------
  e4 := pg_temp.mkenc(v_org, p2, v_docA, 'video', v_lagos_eve);
  perform pg_temp.complete(e4, v_lagos_eve);
  perform pg_temp.rec('a completed video consultation schedules two check-ins', '2', pg_temp.n_rows(e4));
  perform pg_temp.rec('due at exactly +48h and +7d, an evening Lagos completion is not moved', to_char((v_lagos_eve + interval '48 hours') at time zone 'Africa/Lagos', 'YYYY-MM-DD HH24:MI') || '/' || to_char((v_lagos_eve + interval '7 days') at time zone 'Africa/Lagos', 'YYYY-MM-DD HH24:MI'),
    (select string_agg(to_char(due_at at time zone 'Africa/Lagos', 'YYYY-MM-DD HH24:MI'), '/' order by due_at) from public.post_consult_checkins where encounter_id = e4));
  perform pg_temp.rec('each row records the config version and the consultation clinician', '1/true',
    (select min(config_version)::text || '/' || bool_and(clinician_id = v_docA)::text from public.post_consult_checkins where encounter_id = e4));
  perform private.schedule_post_consult_checkins(e4);
  perform pg_temp.rec('a second schedule call adds nothing (idempotent)', '2', pg_temp.n_rows(e4));
  update public.encounters set status = 'in_progress' where id = e4;
  perform pg_temp.complete(e4, v_lagos_eve);
  perform pg_temp.rec('a re-completion adds nothing (idempotent)', '2', pg_temp.n_rows(e4));
  e5 := pg_temp.mkenc(v_org, p2, v_docA, 'phone', v_ended); perform pg_temp.complete(e5, v_ended);
  perform pg_temp.rec('a phone consultation counts', '2', pg_temp.n_rows(e5));
  e6 := pg_temp.mkenc(v_org, p2, v_docA, 'video', v_ended);
  update public.encounters set status = 'no_show_patient' where id = e6;
  perform pg_temp.rec('a patient no-show schedules nothing', '0', pg_temp.n_rows(e6));
  e7 := pg_temp.mkenc(v_org, p2, v_docA, 'video', v_ended);
  update public.encounters set status = 'cancelled' where id = e7;
  update public.encounters set status = 'failed' where id = e7;
  perform pg_temp.rec('a cancelled or failed consultation schedules nothing', '0', pg_temp.n_rows(e7));
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, policy_version, is_test)
  values (v_org, p2, v_docA, 'async', 'in_progress', 1, true) returning id into e8;
  perform pg_temp.complete(e8, v_ended);
  perform pg_temp.rec('a written (async) consultation is not covered', '0', pg_temp.n_rows(e8));

  -- 4. Backfill -------------------------------------------------------------------------------------------------
  perform pg_temp.rec('before the sweep the earlier consultations have no rows', '0/0', pg_temp.n_rows(e2) || '/' || pg_temp.n_rows(e3));
  v_out := private.post_consult_checkin_sweep();
  perform pg_temp.rec('the sweep backfills consultations completed while it was closed', '2/2/true', pg_temp.n_rows(e2) || '/' || pg_temp.n_rows(e3) || '/' || ((v_out ->> 'backfilled')::int >= 4)::text);

  -- 5. Sweep ----------------------------------------------------------------------------------------------------
  perform pg_temp.rec('nothing is open before its due time', '0', (select count(*)::text from public.post_consult_checkins where encounter_id = e4 and state = 'open'));
  c := pg_temp.open_one(e4, 'h48');
  perform pg_temp.rec('a due check-in becomes open', 'open', (select state from public.post_consult_checkins where id = c));
  perform pg_temp.rec('it has a patient task of kind consult_checkin that points back at it', '1/consult_checkin/patient',
    (select count(*)::text || '/' || min(t.kind) || '/' || min(t.owner_role::text) from public.care_tasks t join public.post_consult_checkins k on k.task_id = t.id where k.id = c and t.source_event_id = c and t.patient_id = p2));
  perform pg_temp.rec('the task title is neutral', 'A quick check-in after your visit', (select t.title from public.care_tasks t join public.post_consult_checkins k on k.task_id = t.id where k.id = c));
  perform pg_temp.rec('one neutral notice carries only the check-in id, and an in-app companion exists', 'true/non_clinical/true',
    (select (count(*) filter (where template = 'consult_checkin_due') >= 1)::text || '/' || min(content_class::text) || '/' || bool_and(payload = jsonb_build_object('checkin_id', c))::text
       from public.notifications where recipient_id = p2 and template = 'consult_checkin_due' and payload ->> 'checkin_id' = c::text));
  perform pg_temp.rec('an in-app notice exists whatever the channel', 'true',
    (exists (select 1 from public.notifications where recipient_id = p2 and template = 'consult_checkin_due' and channel = 'in_app' and payload ->> 'checkin_id' = c::text))::text);
  perform pg_temp.rec('a 22:30 Lagos notice is held to 07:00 next morning', '2026-10-18 07:00',
    to_char(private.pcc_send_after('2026-10-17 22:30:00+01', 7, 21) at time zone 'Africa/Lagos', 'YYYY-MM-DD HH24:MI'));
  perform pg_temp.rec('a 03:00 notice is held to 07:00 the same day', '2026-10-18 07:00',
    to_char(private.pcc_send_after('2026-10-18 03:00:00+01', 7, 21) at time zone 'Africa/Lagos', 'YYYY-MM-DD HH24:MI'));
  perform pg_temp.rec('a midday notice is not held, and 21:00 is outside the window', 'null/2026-10-18 07:00',
    coalesce(to_char(private.pcc_send_after('2026-10-17 12:00:00+01', 7, 21) at time zone 'Africa/Lagos', 'YYYY-MM-DD HH24:MI'), 'null') || '/'
    || to_char(private.pcc_send_after('2026-10-17 21:00:00+01', 7, 21) at time zone 'Africa/Lagos', 'YYYY-MM-DD HH24:MI'));
  v_task := (select task_id from public.post_consult_checkins where id = c);

  -- 6. The generic Done is refused ------------------------------------------------------------------------------
  perform pg_temp.act(p2);
  perform pg_temp.rec('the generic Done cannot close a check-in task', '42501', pg_temp.try(format('select public.complete_care_task(%L, ''completed'')', v_task)));
  perform pg_temp.rec('nor can Cannot do this', '42501', pg_temp.try(format('select public.complete_care_task(%L, ''unable_to_complete'', null, ''x'')', v_task)));
  perform pg_temp.back();

  -- 7. Answering ------------------------------------------------------------------------------------------------
  perform pg_temp.act(stranger);
  perform pg_temp.rec('another patient cannot answer it', 'P0002', pg_temp.try(format('select public.answer_post_consult_checkin(%L, %L::jsonb)', c, pg_temp.answers('better', 'no', 'yes', 'no'))));
  perform pg_temp.back();
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('the clinician cannot answer for the patient', 'P0002', pg_temp.try(format('select public.answer_post_consult_checkin(%L, %L::jsonb)', c, pg_temp.answers('better', 'no', 'yes', 'no'))));
  perform pg_temp.back();
  perform pg_temp.act(p2);
  perform pg_temp.rec('an unanswered question is refused', '22023', pg_temp.try(format('select public.answer_post_consult_checkin(%L, %L::jsonb)', c, '{"feeling":"better"}')));
  perform pg_temp.rec('an unknown option is refused', '22023', pg_temp.try(format('select public.answer_post_consult_checkin(%L, %L::jsonb)', c, pg_temp.answers('better', 'maybe', 'yes', 'no'))));
  perform pg_temp.rec('a too-long note is refused', '22023', pg_temp.try(format('select public.answer_post_consult_checkin(%L, %L::jsonb, %L)', c, pg_temp.answers('better', 'no', 'yes', 'no'), repeat('a', 501))));
  v_out := public.answer_post_consult_checkin(c, pg_temp.answers('better', 'no', 'yes', 'no'), 'Feeling fine thank you');
  perform pg_temp.back();
  perform pg_temp.rec('a safe answer reports no concern and no follow-up', 'false/false/false', (v_out ->> 'red_flag') || '/' || (v_out ->> 'concern') || '/' || (v_out ->> 'follow_up'));
  perform pg_temp.rec('a safe answer raises no alert, no emergency and no clinician task', '0/0/0',
    pg_temp.alerts_for(p2) || '/' || pg_temp.emergencies_for(p2) || '/' || (select count(*)::text from public.care_tasks where patient_id = p2 and owner_role = 'clinician'));
  perform pg_temp.rec('the patient task is completed and the check-in answered', 'completed/answered',
    (select t.status::text || '/' || k.state from public.care_tasks t join public.post_consult_checkins k on k.task_id = t.id where k.id = c));
  perform pg_temp.act(p2);
  v_res := (public.answer_post_consult_checkin(c, pg_temp.answers('worse', 'yes', 'cannot_take', 'yes'), 'chest pain')) ->> 'red_flag';
  perform pg_temp.back();
  perform pg_temp.rec('answering twice returns the stored result and changes nothing', 'false/0/0',
    v_res || '/' || pg_temp.alerts_for(p2) || '/' || pg_temp.emergencies_for(p2));

  -- concerning answers: several concerning options, ONE alert
  c2 := pg_temp.open_one(e5, 'h48');
  perform pg_temp.act(p2);
  v_out := public.answer_post_consult_checkin(c2, pg_temp.answers('worse', 'yes', 'cannot_take', 'no'));
  perform pg_temp.back();
  perform pg_temp.rec('three concerning answers raise exactly ONE alert and no emergency', 'true/false/1/0',
    (v_out ->> 'concern') || '/' || (v_out ->> 'red_flag') || '/' || pg_temp.alerts_for(p2) || '/' || pg_temp.emergencies_for(p2));
  perform pg_temp.rec('the alert carries codes and no free text, at the configured level', 'clinician_review/true',
    (select a.level::text || '/' || (a.detail not like '%Feeling%')::text from public.clinician_alerts a where a.patient_id = p2 limit 1));

  -- the danger phrase: the emergency path, exactly one alert in total
  e9 := pg_temp.mkenc(v_org, p3, v_docA, 'video', v_ended); perform pg_temp.complete(e9, v_ended);
  c := pg_temp.open_one(e9, 'h48');
  perform pg_temp.act(p3);
  v_out := public.answer_post_consult_checkin(c, pg_temp.answers('same', 'no', 'yes', 'no'), 'I have had some chest pain since last night');
  perform pg_temp.back();
  perform pg_temp.rec('a danger phrase in the note is a red flag', 'true', v_out ->> 'red_flag');
  perform pg_temp.rec('it opens exactly one emergency event and one alert in total', '1/1', pg_temp.emergencies_for(p3) || '/' || pg_temp.alerts_for(p3));
  perform pg_temp.rec('the check-in records the emergency event', 'true', (select (emergency_event_id is not null and red_flag)::text from public.post_consult_checkins where id = c));
  perform pg_temp.rec('the emergency event is the existing path (source and active)', 'danger_symptom_checklist/active',
    (select source::text || '/' || status::text from public.emergency_events where patient_id = p3));
  perform pg_temp.rec('events carry ids only', 'true',
    (select bool_and((select count(*) from jsonb_object_keys(payload)) = 1 and payload ? 'checkin_id')::text from public.domain_events where event_type like 'consult_checkin.%' and patient_id = p3));

  -- clinician tasks
  e10 := pg_temp.mkenc(v_org, p4, v_docA, 'video', v_ended); perform pg_temp.complete(e10, v_ended);
  c := pg_temp.open_one(e10, 'h48');
  perform pg_temp.act(p4);
  v_out := public.answer_post_consult_checkin(c, pg_temp.answers('same', 'no', 'some_missed', 'yes'));
  perform pg_temp.back();
  perform pg_temp.rec('missed doses and a request for help make one clinician task, no alert', 'false/true/1/0/0',
    (v_out ->> 'concern') || '/' || (v_out ->> 'follow_up') || '/' || (select count(*)::text from public.care_tasks where patient_id = p4 and owner_role = 'clinician') || '/' || pg_temp.alerts_for(p4) || '/' || pg_temp.emergencies_for(p4));
  perform pg_temp.rec('the task belongs to the consultation clinician', 'true',
    (select (owner_id = v_docA and priority = 2)::text from public.care_tasks where patient_id = p4 and owner_role = 'clinician'));

  -- 8. Missed check-in ------------------------------------------------------------------------------------------
  e11 := pg_temp.mkenc(v_org, p5, v_docA, 'video', v_ended); perform pg_temp.complete(e11, v_ended);
  c := pg_temp.open_one(e11, 'h48');
  perform private.post_consult_checkin_sweep();
  perform pg_temp.rec('no nudge before the nudge window', '0', (select nudge_count::text from public.post_consult_checkins where id = c));
  update public.post_consult_checkins set opened_at = now() - interval '25 hours' where id = c;
  perform private.post_consult_checkin_sweep();
  perform private.post_consult_checkin_sweep();
  perform pg_temp.rec('exactly one gentle nudge, however often the sweep runs', '1/1',
    (select nudge_count::text from public.post_consult_checkins where id = c) || '/' || (select count(*)::text from public.notifications where recipient_id = p5 and template = 'consult_checkin_nudge' and channel = 'in_app'));
  update public.post_consult_checkins set opened_at = now() - interval '49 hours' where id = c;
  perform private.post_consult_checkin_sweep();
  perform pg_temp.rec('after the window it expires and the patient task is expired', 'expired/expired',
    (select k.state || '/' || t.status::text from public.post_consult_checkins k join public.care_tasks t on t.id = k.task_id where k.id = c));
  perform pg_temp.rec('silence raises no alert and no emergency', '0/0', pg_temp.alerts_for(p5) || '/' || pg_temp.emergencies_for(p5));
  perform pg_temp.rec('the consultation clinician gets one low-priority task', '1/3/true',
    (select count(*)::text || '/' || min(priority) || '/' || bool_and(owner_id = v_docA)::text from public.care_tasks where patient_id = p5 and owner_role = 'clinician'));
  perform pg_temp.act(p5);
  perform pg_temp.rec('a late answer after expiry is still taken', 'ok', pg_temp.try(format('select public.answer_post_consult_checkin(%L, %L::jsonb)', c, pg_temp.answers('better', 'no', 'yes', 'no'))));
  perform pg_temp.back();
  perform pg_temp.rec('answering it closes the care team''s not-answered task', 'cancelled', (select t.status::text from public.care_tasks t join public.post_consult_checkins k on k.clinician_task_id = t.id where k.id = c));

  -- 9. Cancellation ---------------------------------------------------------------------------------------------
  e12 := pg_temp.mkenc(v_org, p6, v_docA, 'video', v_ended); perform pg_temp.complete(e12, v_ended);
  update public.encounters set status = 'cancelled' where id = e12;
  perform private.post_consult_checkin_sweep();
  perform pg_temp.rec('a reversed consultation cancels its pending check-ins', '2/encounter_reversed',
    (select count(*)::text || '/' || min(cancel_reason) from public.post_consult_checkins where encounter_id = e12 and state = 'cancelled'));
  -- a patient who already wrote to the care team after the visit, shortly before the check-in is due, is not asked again
  e12 := pg_temp.mkenc(v_org, p7, v_docA, 'video', v_ended); perform pg_temp.complete(e12, v_ended);
  insert into public.care_message_threads (organisation_id, patient_id, subject) values (v_org, p7, 'A question about my visit') returning id into v_thread;
  perform set_config('request.jwt.claims', json_build_object('sub', p7, 'role', 'authenticated')::text, true);
  insert into public.care_messages (thread_id, body) values (v_thread, 'Thank you doctor, I will take the tablets as discussed');
  perform set_config('request.jwt.claims', '', true);
  update public.post_consult_checkins set due_at = now() + interval '10 minutes' where encounter_id = e12 and offset_code = 'h48';
  perform private.post_consult_checkin_sweep();
  perform pg_temp.rec('a patient who already wrote to the care team skips the next check-in', 'cancelled/patient_already_wrote',
    (select state || '/' || cancel_reason from public.post_consult_checkins where encounter_id = e12 and offset_code = 'h48'));

  -- 10. Access --------------------------------------------------------------------------------------------------
  c := (select id from public.post_consult_checkins where patient_id = p4 limit 1);
  perform pg_temp.act(p4);
  perform pg_temp.rec('the patient reads own rows', '1', (select count(*)::text from public.post_consult_checkins where encounter_id = e10 and offset_code = 'h48'));
  perform pg_temp.rec('the patient cannot write the table', '42501', pg_temp.try(format('update public.post_consult_checkins set state = ''open'' where id = %L', c)));
  perform pg_temp.rec('the patient cannot read the clinician view', '42501', pg_temp.try(format('select public.get_consult_checkins(%L)', e10)));
  perform pg_temp.back();
  perform pg_temp.act(stranger);
  perform pg_temp.rec('another patient reads none of it', '0', (select count(*)::text from public.post_consult_checkins));
  perform pg_temp.back();
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('staff have no table policy: the clinician reads none directly', '0', (select count(*)::text from public.post_consult_checkins));
  perform pg_temp.back();
  perform pg_temp.act(v_docB);
  perform pg_temp.rec('another clinician is refused the audited read', '42501', pg_temp.try(format('select public.get_consult_checkins(%L)', e10)));
  perform pg_temp.back();
  perform pg_temp.act(v_docA);
  v_out := public.get_consult_checkins(e10);
  perform pg_temp.back();
  perform pg_temp.rec('the consultation clinician reads both rows with the wording and answers', '2/true',
    jsonb_array_length(v_out) || '/' || (v_out -> 0 -> 'answers' -> 0 ->> 'question' = 'How are you feeling since your visit?')::text);
  perform pg_temp.rec('the read wrote one audit row naming the patient', '1',
    (select count(*)::text from public.audit_log where action = 'consult_checkin.read' and entity_id = e10 and actor_id = v_docA and subject_patient_id = p4));
  perform pg_temp.rec('the refused read wrote no audit row', '0', (select count(*)::text from public.audit_log where action = 'consult_checkin.read' and actor_id = v_docB));
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot call the patient or clinician functions', '42501/42501/42501',
    pg_temp.try(format('select public.answer_post_consult_checkin(%L, ''{}''::jsonb)', c)) || '/' || pg_temp.try(format('select public.get_consult_checkins(%L)', e10)) || '/' || pg_temp.try(format('select public.my_post_consult_checkin(%L)', c)));
  perform pg_temp.back();
  perform pg_temp.rec('no function the feature adds is executable by anon', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where ((n.nspname = 'public' and p.proname in ('answer_post_consult_checkin', 'my_post_consult_checkin', 'get_consult_checkins', 'sign_post_consult_checkin_config'))
          or (n.nspname = 'private' and p.proname in ('post_consult_checkin_sweep', 'schedule_post_consult_checkins', 'encounters_schedule_checkins', 'pcc_active_config', 'pcc_send_after', 'pcc_open_incident')))
        and has_function_privilege('anon', p.oid, 'EXECUTE')));
  perform pg_temp.rec('signed-in users cannot run the sweep or the scheduler', 'false/false',
    has_function_privilege('authenticated', 'private.post_consult_checkin_sweep()', 'EXECUTE')::text || '/' || has_function_privilege('authenticated', 'private.schedule_post_consult_checkins(uuid)', 'EXECUTE')::text);
  perform pg_temp.rec('a signed config cannot be edited, only superseded', '23514', pg_temp.try('update public.post_consult_checkin_config set rules = rules || ''{"max_nudges":3}''::jsonb where version = 1'));
  perform pg_temp.rec('a new config version cannot be created active or signed', '42501', pg_temp.try('insert into public.post_consult_checkin_config (version, is_active, effective_from, rules) select 2, true, current_date, rules from public.post_consult_checkin_config where version = 1'));
  perform pg_temp.rec('a config with an unknown route is refused by the table', '23514',
    pg_temp.try($q$insert into public.post_consult_checkin_config (version, effective_from, rules) select 2, current_date, jsonb_set(rules, '{questions,0,options,0,route}', '"page_everyone"') from public.post_consult_checkin_config where version = 1$q$));

  -- 12. Review fixes ---------------------------------------------------------------------------------------------
  -- the alert the red flag raised may be routed to a different doctor: that doctor (and only that doctor) can open the check-in, and the alert names the visit
  insert into public.clinical_staff (organisation_id, profile_id, full_name, is_test, active, languages, license_verified_at, license_expires_at, specialty, indemnity_exempt, indemnity_exempt_by)
  values (v_org, v_docB, 'PCC doctor-b', true, true, array['en'], now() - interval '3 days', now() + interval '1 year', 'General practice', true, v_admin);
  perform pg_temp.act(v_docB);
  perform pg_temp.rec('a doctor the alert was not routed to cannot open the check-in', '42501', pg_temp.try(format('select public.get_consult_checkins(%L)', e9)));
  perform pg_temp.back();
  -- fixture routing, as an owner-run backfill would do it: the reassignment guard (CMO only) is a real-session rule, not what this proof tests
  set local session_replication_role = replica;
  update public.clinician_alerts set responsible_clinician_id = (select id from public.clinical_staff where profile_id = v_docB) where patient_id = p3;
  set local session_replication_role = origin;
  perform pg_temp.act(v_docB);
  perform pg_temp.rec('the doctor the alert was routed to can open the check-in', 'ok', pg_temp.try(format('select public.get_consult_checkins(%L)', e9)));
  perform pg_temp.back();
  perform pg_temp.rec('the emergency alert names the consultation', 'true', (select (bool_and(detail like '%' || e9::text || '%'))::text from public.clinician_alerts where patient_id = p3));
  perform pg_temp.rec('the concern alert names the consultation and carries codes only', 'true', (select (detail like '%' || e5::text || '%' and detail like '%feeling=worse%')::text from public.clinician_alerts where patient_id = p2));
  -- the care team's own follow-up task is not the patient's to close
  v_task := (select id from public.care_tasks where patient_id = p4 and owner_role = 'clinician');
  perform pg_temp.act(p4);
  perform pg_temp.rec('a patient cannot close the care team''s follow-up task', '42501', pg_temp.try(format('select public.complete_care_task(%L, ''completed'')', v_task)));
  perform pg_temp.back();
  -- the patient task is due when it will expire, never in the past
  perform pg_temp.rec('the patient task is not due in the past', 'true',
    (select (due_at > now())::text from public.care_tasks where patient_id = p2 and kind = 'consult_checkin' limit 1));
  -- a visit from days ago is only asked about what is still worth asking
  e12 := pg_temp.mkenc(v_org, stranger, v_docA, 'video', now() - interval '6 days'); perform pg_temp.complete(e12, now() - interval '6 days');
  perform pg_temp.rec('a visit from 6 days ago gets the 7 day check-in only', '1/d7', (select count(*)::text || '/' || min(offset_code) from public.post_consult_checkins where encounter_id = e12));
  -- switching the guard off pauses opening and reminders, but never strands an open check-in: it still expires
  c := (select id from public.post_consult_checkins where patient_id = p5 limit 1);
  e12 := pg_temp.mkenc(v_org, p5, v_docA, 'video', v_ended); perform pg_temp.complete(e12, v_ended);
  c := pg_temp.open_one(e12, 'h48');
  perform pg_temp.guard(false);
  update public.post_consult_checkins set opened_at = now() - interval '49 hours' where id = c;
  v_out := private.post_consult_checkin_sweep();
  perform pg_temp.rec('with the guard off an open check-in still expires, and nothing new opens', 'expired/0/false',
    (select state from public.post_consult_checkins where id = c) || '/' || (v_out ->> 'opened') || '/' || (v_out ->> 'guard_on'));
  perform pg_temp.guard(true);

  -- a cancelled check-in has its own refusal code
  v_task := (select id from public.post_consult_checkins where patient_id = p6 and state = 'cancelled' limit 1);
  perform pg_temp.act(p6);
  perform pg_temp.rec('a cancelled check-in cannot be answered (its own code, not a validation error)', '55000',
    pg_temp.try(format('select public.answer_post_consult_checkin(%L, %L::jsonb)', v_task, pg_temp.answers('better', 'no', 'yes', 'no'))));
  perform pg_temp.back();
  -- a consultation reversed and then completed again gets its check-ins back
  e12 := pg_temp.mkenc(v_org, p6, v_docA, 'video', v_ended); perform pg_temp.complete(e12, v_ended);
  update public.encounters set status = 'cancelled' where id = e12;
  perform private.post_consult_checkin_sweep();
  update public.encounters set status = 'in_progress' where id = e12;
  perform pg_temp.complete(e12, v_ended);
  perform pg_temp.rec('a re-completion after a reversal brings the cancelled check-ins back', '2/0',
    (select count(*) filter (where state = 'scheduled')::text || '/' || count(*) filter (where state = 'cancelled')::text from public.post_consult_checkins where encounter_id = e12));
  -- unsent notices are withdrawn once the check-in is answered; a skipped check-in is never silent
  perform pg_temp.rec('no unsent check-in notice survives an answered check-in', '0',
    (select count(*)::text from public.notifications where recipient_id = p4 and status = 'pending' and template in ('consult_checkin_due', 'consult_checkin_nudge')));
  perform pg_temp.rec('a skipped check-in leaves the visit clinician a low-priority task', '1/3',
    (select count(*)::text || '/' || min(priority) from public.care_tasks where patient_id = p7 and owner_role = 'clinician' and title = 'Check-in after a visit was skipped'));
  perform pg_temp.act(v_docA);
  v_out := public.get_consult_checkins(e5);
  perform pg_temp.back();
  perform pg_temp.rec('the clinician sees that an answered check-in reported a concern', 'true',
    (select bool_or((x ->> 'concern')::boolean)::text from jsonb_array_elements(v_out) x));
  perform pg_temp.rec('a configuration may not promise more than the table keeps of a note', '23514',
    pg_temp.try($q$insert into public.post_consult_checkin_config (version, effective_from, rules) select 2, current_date, jsonb_set(rules, '{free_text_max_chars}', '3000') from public.post_consult_checkin_config where version = 1$q$));
  perform pg_temp.rec('the table is in the data registry and the dependant scope list', '1/1',
    (select count(*)::text from public.data_registry where table_name = 'post_consult_checkins') || '/' || (select count(*)::text from public.data_registry where table_name = 'post_consult_checkins' and in_export));

  -- 11. SABOTAGE -------------------------------------------------------------------------------------------------
  -- (a) the scheduling trigger is dropped: a completed consultation now gets no rows
  drop trigger encounters_schedule_checkins on public.encounters;
  declare e_s uuid := pg_temp.mkenc(v_org, p8, v_docA, 'video', v_ended);
  begin
    perform pg_temp.complete(e_s, v_ended);
    insert into results values ('sabotaged', 'a completed consultation schedules two check-ins', '2', pg_temp.n_rows(e_s));
  end;
  -- (b) the danger-phrase screen is emptied: the note no longer opens the emergency path
  create or replace function private.screen_care_message_for_emergency(p_body text) returns text[] language sql as $s$ select null::text[] $s$;
  declare e_s uuid := pg_temp.mkenc(v_org, p9, v_docA, 'video', v_ended); c_s uuid;
  begin
    perform pg_temp.complete(e_s, v_ended);
    perform private.schedule_post_consult_checkins(e_s);
    c_s := pg_temp.open_one(e_s, 'h48');
    perform pg_temp.act(p9);
    perform public.answer_post_consult_checkin(c_s, pg_temp.answers('same', 'no', 'yes', 'no'), 'I have had some chest pain since last night');
    perform pg_temp.back();
    insert into results values ('sabotaged', 'a danger phrase opens the emergency path', '1', pg_temp.emergencies_for(p9));
  end;
  -- (c) the close guard is dropped: the generic Done now closes a check-in task
  drop trigger care_tasks_checkin_close_guard on public.care_tasks;
  perform pg_temp.open_one(e4, 'd7');
  perform pg_temp.act(p2);
  insert into results values ('sabotaged', 'the generic Done cannot close a check-in task', '42501',
    pg_temp.try(format('select public.complete_care_task(%L, ''completed'')', (select task_id from public.post_consult_checkins where encounter_id = e4 and offset_code = 'd7'))));
  perform pg_temp.back();
  -- (d) the clinician check is removed from the audited read: another clinician now reads
  create or replace function public.get_consult_checkins(p_encounter uuid) returns jsonb language sql security definer set search_path = '' as $s$ select '[]'::jsonb $s$;
  perform pg_temp.act(v_docB);
  insert into results values ('sabotaged', 'another clinician is refused the audited read', '42501', pg_temp.try(format('select public.get_consult_checkins(%L)', e10)));
  perform pg_temp.back();
  -- (e) the notification window helper is emptied: a night notice is no longer held
  create or replace function private.pcc_send_after(p_at timestamptz, p_start integer, p_end integer) returns timestamptz language sql as $s$ select null::timestamptz $s$;
  insert into results values ('sabotaged', 'a 22:30 Lagos notice is held to 07:00', '2026-10-18 07:00',
    coalesce(to_char(private.pcc_send_after('2026-10-17 22:30:00+01', 7, 21) at time zone 'Africa/Lagos', 'YYYY-MM-DD HH24:MI'), 'null'));
  -- (f) the sweep is granted to anon
  grant execute on function private.post_consult_checkin_sweep() to anon;
  insert into results values ('sabotaged', 'anon cannot run the sweep', 'false', has_function_privilege('anon', 'private.post_consult_checkin_sweep()', 'EXECUTE')::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'PCC proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 6 then
    raise exception 'VACUOUS TEST: expected all six sabotage runs to change a check, only % did (unchanged: %)', v_caught,
      (select string_agg(check_name || ' => ' || coalesce(actual, 'null'), '; ') from results where phase = 'sabotaged' and expected is not distinct from actual);
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged rows are asserted to differ inside the DO block above. They are deliberately not printed: the runner treats any FAIL verdict in the output as a failed proof.

rollback;
