-- ===========================================================================
-- Proof: MSG-3 care-thread routing, ownership and lifecycle. Runs in its own organisation so the staff roster is known.
--   1. With no Care Coordinator, a patient's first message goes to a doctor, assigned by the system (assigned_by null), and starts
--      the reply clock; a Free patient's thread is in the support queue.
--   2. With a coordinator, a Member's clinical thread is in the clinical queue and goes to the coordinator (coordinator first).
--   3. A second patient message does not reset the reply clock.
--   4. A coordinator's reply stops the clock and does not clear a doctor flag that is not there.
--   5. Flagging for a doctor needs a real reason, then hands the thread to the patient's own doctor with the reason as the note.
--   6. A coordinator cannot close a thread that needs a doctor; the patient cannot clear the flag or the queue (pinned silently) and
--      cannot write an owner row.
--   7. A doctor's reply clears the flag; the coordinator can then close.
--   8. Continuity: the owner keeps the thread on the next message; an owner on leave loses it to the next in line.
--   9. A lapsed Member's clinical thread moves to the support queue on the next message.
--  10. The unread sweep now also raises an alert for a support thread that needs a doctor.
--  11. SABOTAGE: with the routing trigger dropped, a new thread gets no owner and no reply clock.
-- BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================
begin;
create temp table msg3_results (check_name text, observed text, expected text, verdict text);
grant all on msg3_results to public;
create temp table msg3_fx (k text primary key, v uuid);
grant all on msg3_fx to public;

create function pg_temp.mkuser(p_role text, p_name text, p_org uuid) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'msg3-' || replace(v::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, is_active)
  values (v, p_org, p_role::public.user_role, p_name, '+23480' || lpad((floor(random() * 99999999))::integer::text, 8, '0'), date '1970-01-01', false, true)
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name, is_test = false, is_active = true, organisation_id = excluded.organisation_id;
  return v;
end $$;
create function pg_temp.f(p_k text) returns uuid language sql as $$ select v from msg3_fx where k = p_k $$;
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); end $$;
create function pg_temp.back() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v_state text; v_hint text;
begin
  perform pg_temp.as_user(p_uid); execute 'set local role authenticated';
  begin execute p_sql; execute 'reset role'; perform pg_temp.back(); return 'ok';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
    execute 'reset role'; perform pg_temp.back();
    return v_state || coalesce(':' || nullif(v_hint, ''), '');
  end;
end $$;
-- Runs a scalar query as p_uid; returns its text value.
create function pg_temp.val_as(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.as_user(p_uid); execute 'set local role authenticated';
  execute p_sql into r; execute 'reset role'; perform pg_temp.back(); return r;
end $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into msg3_results values (p_name, p_actual, p_expected, case when p_actual is not distinct from p_expected then 'PASS' else 'FAIL' end) $$;
create function pg_temp.owner_of(p_thread uuid) returns uuid language sql as $$ select owner_id from public.care_thread_owners where thread_id = p_thread $$;
create function pg_temp.thread_by_subject(p_patient uuid, p_subject text) returns uuid language sql as
$$ select id from public.care_message_threads where patient_id = p_patient and subject = p_subject $$;

do $$
declare
  v_org uuid; admin uuid; doc1 uuid; doc2 uuid; fp uuid; mp uuid;
begin
  insert into public.organisations (name, type) select 'MSG3 org', type from public.organisations order by created_at limit 1 returning id into v_org;
  admin := pg_temp.mkuser('admin', 'MSG3 Admin', v_org);
  doc1 := pg_temp.mkuser('clinician', 'MSG3 Doctor One', v_org);
  doc2 := pg_temp.mkuser('clinician', 'MSG3 Doctor Two', v_org);
  fp := pg_temp.mkuser('patient', 'MSG3 Free Patient', v_org);
  mp := pg_temp.mkuser('patient', 'MSG3 Member', v_org);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, doctor_tier, active, employment_type, license_verified_at)
  values (v_org, doc1, 'MSG3 Doctor One', 'senior_medical_officer', true, 'employed', now()),
         (v_org, doc2, 'MSG3 Doctor Two', 'senior_medical_officer', true, 'employed', now());
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, mp, doc2);
  insert into public.patient_memberships (organisation_id, patient_id, source, state, granted_by, grant_reason, is_test)
  values (v_org, mp, 'granted', 'active', admin, 'MSG3 proof: a Member', true);
  insert into msg3_fx values ('org', v_org), ('admin', admin), ('doc1', doc1), ('doc2', doc2), ('fp', fp), ('mp', mp);
end $$;

-- 1. No coordinator: a doctor gets it, assigned by the system.
do $$
declare t1 uuid;
begin
  perform pg_temp.ck('1a free patient starts a thread', 'ok',
    pg_temp.try_as(pg_temp.f('fp'), $q$select public.start_care_thread('MSG3 login', 'I cannot open my results page', null, null, null, 'general')$q$));
  t1 := pg_temp.thread_by_subject(pg_temp.f('fp'), 'MSG3 login');
  insert into msg3_fx values ('t1', t1);
  perform pg_temp.ck('1b queue support', 'support', (select queue::text from public.care_message_threads where id = t1));
  perform pg_temp.ck('1c owner is a doctor', 'true',
    (pg_temp.owner_of(t1) in (pg_temp.f('doc1'), pg_temp.f('doc2')))::text);
  perform pg_temp.ck('1d assigned by the system', 'true',
    ((select assigned_by from public.care_thread_owners where thread_id = t1) is null)::text);
  perform pg_temp.ck('1e reply clock started', 'true',
    ((select awaiting_reply_since from public.care_message_threads where id = t1) is not null)::text);
end $$;

-- 2. Coordinator first for a Member's clinical thread.
do $$
declare co uuid; t2 uuid;
begin
  co := pg_temp.mkuser('care_coordinator', 'MSG3 Coordinator', pg_temp.f('org'));
  insert into msg3_fx values ('co', co);
  perform pg_temp.ck('2a member starts a clinical thread', 'ok',
    pg_temp.try_as(pg_temp.f('mp'), $q$select public.start_care_thread('MSG3 BP', 'My BP is 150 over 95 this week', null, null, null, 'clinical')$q$));
  t2 := pg_temp.thread_by_subject(pg_temp.f('mp'), 'MSG3 BP');
  insert into msg3_fx values ('t2', t2);
  perform pg_temp.ck('2b queue clinical', 'clinical', (select queue::text from public.care_message_threads where id = t2));
  perform pg_temp.ck('2c owner is the coordinator', co::text, pg_temp.owner_of(t2)::text);
  perform pg_temp.ck('2d the coordinator is notified in the app', 'true',
    (exists (select 1 from public.notifications n where n.recipient_id = co and n.template = 'clinician_new_care_message'
              and n.payload->>'thread_id' = t2::text))::text);
end $$;

-- 3. A second patient message keeps the original clock.
do $$
declare t2 uuid := pg_temp.f('t2'); v_before timestamptz := now() - interval '1 hour';
begin
  update public.care_message_threads set awaiting_reply_since = v_before where id = t2;
  perform pg_temp.ck('3a member posts again', 'ok',
    pg_temp.try_as(pg_temp.f('mp'), format($q$select public.post_care_message(%L, 'Also my head aches a little')$q$, t2)));
  perform pg_temp.ck('3b clock not reset', 'true', ((select awaiting_reply_since from public.care_message_threads where id = t2) = v_before)::text);
end $$;

-- 4. Coordinator replies.
do $$
declare t2 uuid := pg_temp.f('t2');
begin
  perform pg_temp.ck('4a coordinator replies', 'ok',
    pg_temp.try_as(pg_temp.f('co'), format($q$select public.post_care_message(%L, 'Thank you, let me check with the doctor')$q$, t2)));
  perform pg_temp.ck('4b clock stopped', 'true',
    ((select awaiting_reply_since is null and last_care_team_reply_at is not null from public.care_message_threads where id = t2))::text);
end $$;

-- 5. Needs a doctor.
do $$
declare t2 uuid := pg_temp.f('t2');
begin
  perform pg_temp.ck('5a a too-short reason is refused', '22023',
    pg_temp.try_as(pg_temp.f('co'), format($q$select public.flag_care_thread_for_doctor(%L, 'BP')$q$, t2)));
  perform pg_temp.ck('5b flag returns the patient''s own doctor', pg_temp.f('doc2')::text,
    pg_temp.val_as(pg_temp.f('co'), format($q$select public.flag_care_thread_for_doctor(%L, 'BP 150/95 all week with headache')$q$, t2)));
  perform pg_temp.ck('5c thread needs a doctor', 'true', (select needs_doctor::text from public.care_message_threads where id = t2));
  perform pg_temp.ck('5d owner is that doctor', pg_temp.f('doc2')::text, pg_temp.owner_of(t2)::text);
  perform pg_temp.ck('5e reason is the hand-over note', 'true',
    ((select handover_note from public.care_thread_owners where thread_id = t2) like 'Needs a doctor: BP 150/95%')::text);
end $$;

-- 6. Guards.
do $$
declare t2 uuid := pg_temp.f('t2');
begin
  perform pg_temp.ck('6a coordinator cannot close a thread that needs a doctor', '42501:needs_doctor',
    pg_temp.try_as(pg_temp.f('co'), format($q$update public.care_message_threads set status = 'closed' where id = %L$q$, t2)));
  perform pg_temp.ck('6a2 coordinator''s direct update of the flag runs', 'ok',
    pg_temp.try_as(pg_temp.f('co'), format($q$update public.care_message_threads set needs_doctor = false where id = %L$q$, t2)));
  perform pg_temp.ck('6a3 but the flag is untouched, so closing is still refused', 'true/42501:needs_doctor',
    (select needs_doctor::text from public.care_message_threads where id = t2) || '/' ||
    pg_temp.try_as(pg_temp.f('co'), format($q$update public.care_message_threads set status = 'closed' where id = %L$q$, t2)));
  perform pg_temp.ck('6b patient update runs', 'ok',
    pg_temp.try_as(pg_temp.f('mp'), format($q$update public.care_message_threads set needs_doctor = false, queue = 'support' where id = %L$q$, t2)));
  perform pg_temp.ck('6c but the routing fields are pinned', 'true/clinical',
    (select needs_doctor::text || '/' || queue::text from public.care_message_threads where id = t2));
  perform pg_temp.ck('6d patient cannot write an owner row', '42501',
    pg_temp.try_as(pg_temp.f('mp'), format(
      $q$insert into public.care_thread_owners (thread_id, organisation_id, owner_id) values (%L, %L, %L)$q$, t2, pg_temp.f('org'), pg_temp.f('doc1'))));
  perform pg_temp.ck('6e patient cannot read the staff hand-over note', '0',
    pg_temp.val_as(pg_temp.f('mp'), format($q$select count(*)::text from public.care_thread_owners where thread_id = %L$q$, t2)));
  perform pg_temp.ck('6f the thread row carries no staff reason', 'false',
    (select (count(*) > 0)::text from information_schema.columns
      where table_schema = 'public' and table_name = 'care_message_threads' and column_name like '%reason%'));
end $$;

-- 7. Doctor replies, then the coordinator may close.
do $$
declare t2 uuid := pg_temp.f('t2');
begin
  perform pg_temp.ck('7a doctor replies', 'ok',
    pg_temp.try_as(pg_temp.f('doc2'), format($q$select public.post_care_message(%L, 'Please recheck tomorrow morning and log it')$q$, t2)));
  perform pg_temp.ck('7b flag cleared', 'false', (select needs_doctor::text from public.care_message_threads where id = t2));
  perform pg_temp.ck('7c coordinator can now close', 'ok',
    pg_temp.try_as(pg_temp.f('co'), format($q$update public.care_message_threads set status = 'closed' where id = %L$q$, t2)));
end $$;

-- 8. Continuity and leave.
do $$
declare t1 uuid := pg_temp.f('t1'); t3 uuid; t7 uuid;
begin
  -- t1 is a support thread the system gave a doctor while no coordinator existed; with a coordinator free it moves to them.
  perform pg_temp.try_as(pg_temp.f('fp'), format($q$select public.post_care_message(%L, 'Still cannot open it')$q$, t1));
  perform pg_temp.ck('8a system-assigned doctor hands a support thread to the free coordinator', pg_temp.f('co')::text, pg_temp.owner_of(t1)::text);
  -- A doctor who starts a conversation owns it, and the patient's reply stays with them even with a coordinator free.
  perform pg_temp.ck('8a2 doctor starts a thread to the patient', 'ok',
    pg_temp.try_as(pg_temp.f('doc1'), format($q$select public.start_care_thread('MSG3 your result', 'Please call us about your result', %L, null, null, 'general')$q$, pg_temp.f('fp'))));
  t7 := pg_temp.thread_by_subject(pg_temp.f('fp'), 'MSG3 your result');
  perform pg_temp.ck('8a3 starter owns it, attributed to themselves', pg_temp.f('doc1')::text || '/' || pg_temp.f('doc1')::text,
    (select owner_id::text || '/' || assigned_by::text from public.care_thread_owners where thread_id = t7));
  perform pg_temp.try_as(pg_temp.f('fp'), format($q$select public.post_care_message(%L, 'What does the result mean?')$q$, t7));
  perform pg_temp.ck('8a4 patient reply stays with the starting doctor', pg_temp.f('doc1')::text, pg_temp.owner_of(t7)::text);
  -- A doctor flag on a thread whose owner does not change still records the reason.
  perform pg_temp.val_as(pg_temp.f('admin'), format($q$select public.flag_care_thread_for_doctor(%L, 'Patient asks about an abnormal result')::text$q$, t7));
  perform pg_temp.ck('8a5 reason recorded although the owner is unchanged', 'true',
    ((select owner_id = pg_temp.f('doc1') and handover_note like 'Needs a doctor: Patient asks%' from public.care_thread_owners where thread_id = t7))::text);
  perform pg_temp.try_as(pg_temp.f('fp'), $q$select public.start_care_thread('MSG3 payment', 'My card was charged twice', null, null, null, 'billing')$q$);
  t3 := pg_temp.thread_by_subject(pg_temp.f('fp'), 'MSG3 payment');
  insert into msg3_fx values ('t3', t3);
  perform pg_temp.ck('8b new support thread goes to the coordinator', pg_temp.f('co')::text, pg_temp.owner_of(t3)::text);
  insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at, reason)
  values (pg_temp.f('org'), pg_temp.f('co'), 'leave', now() - interval '1 hour', now() + interval '1 day', 'MSG3 proof');
  perform pg_temp.try_as(pg_temp.f('fp'), format($q$select public.post_care_message(%L, 'Any update on the refund?')$q$, t3));
  perform pg_temp.ck('8c coordinator on leave loses it to a doctor', 'true',
    (pg_temp.owner_of(t3) in (pg_temp.f('doc1'), pg_temp.f('doc2')))::text);
end $$;

-- 9. Lapsed Member.
do $$
declare t4 uuid;
begin
  perform pg_temp.try_as(pg_temp.f('mp'), $q$select public.start_care_thread('MSG3 sugar', 'Is a fasting sugar of 7 high?', null, null, null, 'clinical')$q$);
  t4 := pg_temp.thread_by_subject(pg_temp.f('mp'), 'MSG3 sugar');
  perform pg_temp.ck('9a clinical while a Member', 'clinical', (select queue::text from public.care_message_threads where id = t4));
  delete from public.patient_memberships where patient_id = pg_temp.f('mp');
  perform pg_temp.try_as(pg_temp.f('mp'), format($q$select public.post_care_message(%L, 'And what about after meals?')$q$, t4));
  perform pg_temp.ck('9b support after the Membership ends', 'support', (select queue::text from public.care_message_threads where id = t4));
end $$;

-- 10. The unread sweep covers a support thread that needs a doctor.
do $$
declare t3 uuid := pg_temp.f('t3');
begin
  perform pg_temp.val_as(pg_temp.f('co'), format($q$select public.flag_care_thread_for_doctor(%L, 'Patient sounds unwell in the second message')::text$q$, t3));
  update public.care_message_threads
    set last_message_at = now() - interval '3 hours', care_team_last_read_at = null, unread_alert_id = null
    where id = t3;
  perform private.raise_unread_clinical_message_alerts();
  perform pg_temp.ck('10 unread alert raised for a support thread that needs a doctor', 'true',
    ((select unread_alert_id from public.care_message_threads where id = t3) is not null)::text);
end $$;

-- 11. Sabotage.
do $$
declare t6 uuid;
begin
  drop trigger care_messages_route_thread on public.care_messages;
  perform pg_temp.try_as(pg_temp.f('fp'), $q$select public.start_care_thread('MSG3 sabotage', 'Hello there', null, null, null, 'general')$q$);
  t6 := pg_temp.thread_by_subject(pg_temp.f('fp'), 'MSG3 sabotage');
  perform pg_temp.ck('11 SABOTAGE routing trigger dropped: no owner, no clock', 'true',
    (pg_temp.owner_of(t6) is null and (select awaiting_reply_since from public.care_message_threads where id = t6) is null)::text);
end $$;

select * from msg3_results order by check_name;

do $$
declare v_fail text;
begin
  select string_agg(check_name || ' (expected ' || coalesce(expected, 'null') || ', got ' || coalesce(observed, 'null') || ')', '; ')
    into v_fail from msg3_results where verdict <> 'PASS';
  if v_fail is not null then raise exception 'MSG-3 proof FAILED: %', v_fail; end if;
  if (select count(*) from msg3_results) < 30 then raise exception 'MSG-3 proof FAILED: only % checks ran', (select count(*) from msg3_results); end if;
end $$;

rollback;
