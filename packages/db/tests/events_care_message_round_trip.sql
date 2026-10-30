-- Tarragon Health: E5, a care message makes the full round trip (2026-10-30)
--
-- Companion to events_reach_clinician_queue_end_to_end.sql and
-- events_escalation_routing_and_page_ladder.sql. Existing proofs cover the message safety
-- screen and communication gaps; none follows one message from the patient's send to the
-- clinician's screen and back, read through RLS the way each dashboard reads it.
--
--   1  patient sends        thread + message through post_care_message as the patient:
--                           author fields are derived (role patient, name from the profile).
--   2  clinician receives   the assigned clinician is notified in app, and can read the thread
--                           and the message through RLS.
--   3  clinician replies    author is care_team with a real clinical_staff behind the name,
--                           the patient is notified in app, the patient reads the reply, the
--                           thread's last author flips.
--   4  safety net           a clinical message nobody on the care team has opened for 120
--                           minutes raises an alert once, tells the responsible clinician or
--                           (if none) the org's admins; an opened thread never does.
--   5  boundaries           another patient and a clinician in another organisation read
--                           nothing; a closed thread rejects a new message.
--
-- Fixtures built here; BEGIN/ROLLBACK; raises on failure.
-- Run: psql "$DATABASE_URL" -f packages/db/tests/events_care_message_round_trip.sql

begin;

create temp table fx (k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
grant execute on function pg_temp.f(text), pg_temp.act(uuid), pg_temp.back() to public;

do $$
declare
  v_org uuid;
  v_org2 uuid := gen_random_uuid();
  v_doc uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid();
  v_pat2 uuid := gen_random_uuid();
  v_odoc uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation exists, the core migrations did not run'; end if;
  insert into public.organisations (id, name, type) values (v_org2, 'EV5 Other Org', 'direct_consumer');

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_doc, 'ev5-doc@example.invalid', 'x', now(), '{}', '{}'),
    (v_pat, 'ev5-pat@example.invalid', 'x', now(), '{}', '{}'),
    (v_pat2, 'ev5-pat2@example.invalid', 'x', now(), '{}', '{}'),
    (v_odoc, 'ev5-odoc@example.invalid', 'x', now(), '{}', '{}'),
    (v_admin, 'ev5-admin@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth)
  values
    (v_doc, v_org, 'clinician', 'EV5 Doctor', null),
    (v_pat, v_org, 'patient', 'EV5 Patient', date '1980-01-01'),
    (v_pat2, v_org, 'patient', 'EV5 Patient Two', date '1982-02-02'),
    (v_odoc, v_org2, 'clinician', 'EV5 Doctor Elsewhere', null),
    (v_admin, v_org, 'admin', 'EV5 Admin', null)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role,
    full_name = excluded.full_name, date_of_birth = excluded.date_of_birth;

  insert into public.clinical_staff (organisation_id, profile_id, full_name, doctor_tier, active, employment_type, license_verified_at)
  values (v_org, v_doc, 'EV5 Doctor', 'senior_medical_officer', true, 'employed', now());

  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id)
  values (v_org, v_pat, v_doc);

  insert into fx values ('org', v_org), ('doc', v_doc), ('pat', v_pat), ('pat2', v_pat2), ('odoc', v_odoc), ('admin', v_admin);
end $$;

-- ================================================================ 1 patient sends
create function pg_temp.patient_sends() returns void language plpgsql as
$f$
declare v_thread uuid; v_msg uuid;
begin
  perform pg_temp.act(pg_temp.f('pat'));
  v_thread := public.start_care_thread('EV5 clinical question', '  My blood pressure has been high this week  ',
                                       null, null, null, 'clinical');
  perform pg_temp.back();
  select id into v_msg from public.care_messages where thread_id = v_thread;
  insert into fx values ('thread', v_thread), ('msg1', v_msg);
end $f$;
select pg_temp.patient_sends();

do $$
declare m record;
begin
  select * into m from public.care_messages where id = pg_temp.f('msg1');
  if m.author_role::text <> 'patient' then raise exception 'FAIL 1: author_role is %, expected patient', m.author_role; end if;
  if m.author_profile_id <> pg_temp.f('pat') then raise exception 'FAIL 1: author is not the patient''s own profile'; end if;
  if m.author_display <> 'EV5 Patient' then raise exception 'FAIL 1: display name is %, expected the profile name', m.author_display; end if;
  if m.actor_clinical_staff_id is not null then raise exception 'FAIL 1: a patient message carries a clinician id'; end if;
  if m.body <> 'My blood pressure has been high this week' then raise exception 'FAIL 1: body was not trimmed'; end if;
  if (select last_message_author_role::text from public.care_message_threads where id = pg_temp.f('thread')) <> 'patient' then
    raise exception 'FAIL 1: the thread does not show the patient as last author';
  end if;
end $$;

-- ================================================================ 2 clinician receives
do $$
begin
  if (select count(*) from public.notifications
       where recipient_id = pg_temp.f('doc') and template = 'clinician_new_care_message' and channel = 'in_app'
         and payload->>'thread_id' = pg_temp.f('thread')::text) <> 1 then
    raise exception 'FAIL 2: the assigned clinician was not notified in app of the new message';
  end if;
  if exists (select 1 from public.notifications
              where recipient_id = pg_temp.f('pat') and template = 'new_care_message') then
    raise exception 'FAIL 2: the patient was notified of their own message';
  end if;
end $$;

create function pg_temp.clinician_reads() returns void language plpgsql as
$f$
declare v_t integer; v_direct integer; v_rows jsonb; v_rows2 jsonb; v_audit integer;
begin
  perform pg_temp.act(pg_temp.f('doc'));
  select count(*) into v_t from public.care_message_threads where id = pg_temp.f('thread');
  -- Staff read message bodies only through the audited function (S39c); the table policy deliberately
  -- gives them none, so every read leaves an audit row. This is the path the clinician inbox uses.
  select count(*) into v_direct from public.care_messages where thread_id = pg_temp.f('thread');
  v_rows := public.open_care_thread_audited(pg_temp.f('thread'));
  v_rows2 := public.open_care_thread_audited(pg_temp.f('thread'));
  perform pg_temp.back();
  select count(*) into v_audit from public.audit_log
   where actor_id = pg_temp.f('doc') and action = 'care_thread.open' and entity_id = pg_temp.f('thread')
     and subject_patient_id = pg_temp.f('pat');
  if v_t <> 1 then raise exception 'FAIL 2: the assigned clinician cannot see the thread'; end if;
  if jsonb_array_length(v_rows) <> 1 then
    raise exception 'FAIL 2: the audited open returned % messages, expected 1', jsonb_array_length(v_rows);
  end if;
  if v_rows->0->>'body' is distinct from 'My blood pressure has been high this week' then
    raise exception 'FAIL 2: the clinician does not receive the patient''s words';
  end if;
  if v_direct <> 0 then
    raise exception 'FAIL 2: staff read % message rows straight from the table, bypassing the audited path', v_direct;
  end if;
  if v_audit <> 1 then
    raise exception 'FAIL 2: % audit rows for two opens within 10 minutes, expected exactly 1', v_audit;
  end if;
end $f$;
select pg_temp.clinician_reads();

-- ================================================================ 3 clinician replies
create function pg_temp.clinician_replies() returns void language plpgsql as
$f$
declare v_msg uuid;
begin
  perform pg_temp.act(pg_temp.f('doc'));
  perform public.mark_care_message_thread_read(pg_temp.f('thread'));
  v_msg := public.post_care_message(pg_temp.f('thread'), 'Thank you, please recheck tomorrow morning and tell us the reading.');
  perform pg_temp.back();
  insert into fx values ('msg2', v_msg);
end $f$;
select pg_temp.clinician_replies();

do $$
declare m record;
begin
  select * into m from public.care_messages where id = pg_temp.f('msg2');
  if m.author_role::text <> 'care_team' then raise exception 'FAIL 3: reply author_role is %, expected care_team', m.author_role; end if;
  if m.actor_clinical_staff_id is null or not exists (
       select 1 from public.clinical_staff cs where cs.id = m.actor_clinical_staff_id and cs.profile_id = pg_temp.f('doc')) then
    raise exception 'FAIL 3: the reply has no real clinical_staff row behind the name';
  end if;
  if m.author_display <> 'EV5 Doctor' then raise exception 'FAIL 3: reply display is %, expected the clinician name', m.author_display; end if;
  if (select count(*) from public.notifications
       where recipient_id = pg_temp.f('pat') and template = 'new_care_message' and channel = 'in_app'
         and payload->>'thread_id' = pg_temp.f('thread')::text) <> 1 then
    raise exception 'FAIL 3: the patient was not notified in app of the reply';
  end if;
  if (select last_message_author_role::text from public.care_message_threads where id = pg_temp.f('thread')) <> 'care_team' then
    raise exception 'FAIL 3: the thread does not show the care team as last author';
  end if;
end $$;

create function pg_temp.patient_reads_reply() returns void language plpgsql as
$f$
declare v_n integer;
begin
  perform pg_temp.act(pg_temp.f('pat'));
  select count(*) into v_n from public.care_messages where thread_id = pg_temp.f('thread');
  perform pg_temp.back();
  if v_n <> 2 then raise exception 'FAIL 3: the patient sees % messages, expected 2 (own message and the reply)', v_n; end if;
end $f$;
select pg_temp.patient_reads_reply();

-- ================================================================ 4 safety net
-- an opened thread never alerts; an unopened clinical one raises exactly one alert after 120 minutes
create function pg_temp.second_thread() returns void language plpgsql as
$f$
declare v_thread uuid;
begin
  perform pg_temp.act(pg_temp.f('pat2'));
  v_thread := public.start_care_thread('EV5 unread clinical', 'I have had chest tightness since morning',
                                       null, null, null, 'clinical');
  perform pg_temp.back();
  insert into fx values ('thread2', v_thread);
end $f$;
select pg_temp.second_thread();

do $$
declare v_n integer; v_alert uuid; v_notified integer;
begin
  update public.care_message_threads set last_message_at = now() - interval '121 minutes'
   where id in (pg_temp.f('thread'), pg_temp.f('thread2'));
  -- thread 1: the clinician replied, so the care team is the last author; thread 2: unopened patient message

  perform private.raise_unread_clinical_message_alerts();

  -- counted per patient, so unrelated stale threads in the database cannot change the answer
  select count(*) into v_n from public.clinician_alerts
   where patient_id = pg_temp.f('pat2') and type_code = 'unread_clinical_care_message';
  if v_n <> 1 then
    raise exception 'FAIL 4: % unread-message alerts for the patient with the unopened thread, expected exactly 1', v_n;
  end if;
  select count(*) into v_n from public.clinician_alerts
   where patient_id = pg_temp.f('pat') and type_code = 'unread_clinical_care_message';
  if v_n <> 0 then
    raise exception 'FAIL 4: % unread-message alerts for the patient whose message was answered, expected 0', v_n;
  end if;

  select unread_alert_id into v_alert from public.care_message_threads where id = pg_temp.f('thread2');
  if v_alert is null then raise exception 'FAIL 4: the thread is not linked to its alert, the sweep would re-alert it every run'; end if;
  if (select unread_alert_id from public.care_message_threads where id = pg_temp.f('thread')) is not null then
    raise exception 'FAIL 4: an answered thread was alerted';
  end if;

  select count(*) into v_notified from public.notifications
   where source_table = 'clinician_alerts' and source_id = v_alert
     and template = 'clinician_unread_care_message_alert';
  if v_notified < 1 then raise exception 'FAIL 4: the alert was raised but nobody was told'; end if;

  -- once only
  perform private.raise_unread_clinical_message_alerts();
  perform private.raise_unread_clinical_message_alerts();
  select count(*) into v_n from public.clinician_alerts
   where patient_id = pg_temp.f('pat2') and type_code = 'unread_clinical_care_message';
  if v_n <> 1 then
    raise exception 'FAIL 4: re-running the sweep left % alerts for the same thread, expected 1', v_n;
  end if;
  if (select unread_alert_id from public.care_message_threads where id = pg_temp.f('thread2')) is distinct from v_alert then
    raise exception 'FAIL 4: re-running the sweep replaced the thread''s alert';
  end if;
end $$;

-- a thread the care team has opened before the 120 minutes never alerts (control for the sweep's read filter)
create function pg_temp.third_thread_opened() returns void language plpgsql as
$f$
declare v_thread uuid;
begin
  perform pg_temp.act(pg_temp.f('pat2'));
  v_thread := public.start_care_thread('EV5 opened clinical', 'Question about my tablets',
                                       null, null, null, 'clinical');
  perform pg_temp.back();
  insert into fx values ('thread3', v_thread);
end $f$;
select pg_temp.third_thread_opened();

do $$
begin
  update public.care_message_threads set last_message_at = now() - interval '200 minutes' where id = pg_temp.f('thread3');
  -- opened by the care team after the message arrived (read time later than the last message)
  update public.care_message_threads set care_team_last_read_at = now() - interval '150 minutes' where id = pg_temp.f('thread3');
  perform private.raise_unread_clinical_message_alerts();
  if (select unread_alert_id from public.care_message_threads where id = pg_temp.f('thread3')) is not null then
    raise exception 'FAIL 4: a thread the care team had opened was alerted as unread';
  end if;
end $$;

-- ================================================================ 5 boundaries and closed thread
create function pg_temp.boundaries() returns void language plpgsql as
$f$
declare v_other_patient integer; v_other_org_code text; v_other_patient_code text; v_closed_blocked boolean := false;
begin
  perform pg_temp.act(pg_temp.f('pat2'));
  select count(*) into v_other_patient from public.care_messages where thread_id = pg_temp.f('thread');
  begin perform public.open_care_thread_audited(pg_temp.f('thread'));
  exception when others then v_other_patient_code := sqlstate; end;
  perform pg_temp.back();
  perform pg_temp.act(pg_temp.f('odoc'));
  begin perform public.open_care_thread_audited(pg_temp.f('thread'));
  exception when others then v_other_org_code := sqlstate; end;
  perform pg_temp.back();
  if v_other_patient <> 0 then raise exception 'FAIL 5: another patient reads % messages of this thread', v_other_patient; end if;
  if v_other_patient_code is distinct from '42501' then
    raise exception 'FAIL 5: another patient opening the thread got sqlstate %, expected 42501', v_other_patient_code;
  end if;
  if v_other_org_code is distinct from '42501' then
    raise exception 'FAIL 5: a clinician in another organisation opening the thread got sqlstate %, expected 42501', v_other_org_code;
  end if;

  update public.care_message_threads set status = 'closed' where id = pg_temp.f('thread');
  perform pg_temp.act(pg_temp.f('pat'));
  begin
    perform public.post_care_message(pg_temp.f('thread'), 'Can I still write here?');
  exception when others then v_closed_blocked := true;
  end;
  perform pg_temp.back();
  if not v_closed_blocked then raise exception 'FAIL 5: a message was accepted on a closed thread'; end if;
end $f$;
select pg_temp.boundaries();

select 'events_care_message_round_trip: all checks passed' as result;

rollback;
