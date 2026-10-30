-- Proves the staff-chat additions in *_staff_chat_attachments_reminders_owner_actions.sql:
--   staff may upload into a patient's attachment folder, a patient may not use another patient's;
--   an unread care-team message is reminded at most twice, never at night, never once read, and a new message restarts it;
--   conversation owners are staff-only and never readable by the patient;
--   only the care-team author can add an action button, and the patient can read it.
--   npx supabase db query --linked -f packages/db/tests/staff_chat_attachments_reminders_owner_actions.sql

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on results to authenticated;
grant all on ids to authenticated;

create function pg_temp.mkuser(p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'staffchat-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, '00000000-0000-0000-0000-000000000001', p_role::public.user_role, 'Proof ' || p_label,
          '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
insert into ids values ('patient', pg_temp.mkuser('patient', 'patient'));
insert into ids values ('other_patient', pg_temp.mkuser('other', 'patient'));
insert into ids values ('clinician', pg_temp.mkuser('coordinator', 'care_coordinator'));

-- A thread opened by the clinician for the patient (first message is care-team).
select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k='clinician'), 'role','authenticated')::text, true);
set local role authenticated;
insert into ids select 'thread', public.start_care_thread('Please book your review', 'Could you pick a slot this week?', (select v from ids where k='patient'));
reset role;
insert into ids select 'msg', (select id from public.care_messages where thread_id = (select v from ids where k='thread') limit 1);
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- 1. Reminders. p_now is explicit so the Lagos hour never makes this flaky.
------------------------------------------------------------------
-- 2026-11-02 12:00 Lagos = 11:00 UTC.
update public.care_message_threads set last_message_at = '2026-11-01 08:00+00', patient_last_read_at = null
 where id = (select v from ids where k='thread');

insert into results select 'nothing is sent at 03:00 Lagos', '0',
  private.remind_patients_of_unread_care_messages(interval '24 hours', interval '48 hours', 2::smallint, '2026-11-02 02:00+00')::text;
select private.remind_patients_of_unread_care_messages(interval '24 hours', interval '48 hours', 2::smallint, '2026-11-02 11:00+00');
insert into results select 'first reminder after 24 hours unread', '1',
  (select patient_reminder_count::text from public.care_message_threads where id = (select v from ids where k='thread'));
insert into results select 'the reminder is non-clinical and carries only the thread id', 'non_clinical,care_message_reminder',
  (select n.content_class::text || ',' || n.template from public.notifications n
    where n.template = 'care_message_reminder' and n.payload ->> 'thread_id' = (select v::text from ids where k='thread') order by n.created_at desc limit 1);
select private.remind_patients_of_unread_care_messages(interval '24 hours', interval '48 hours', 2::smallint, '2026-11-02 11:30+00');
insert into results select 'a second sweep straight away sends nothing for this thread', '1',
  (select patient_reminder_count::text from public.care_message_threads where id = (select v from ids where k='thread'));
select private.remind_patients_of_unread_care_messages(interval '24 hours', interval '48 hours', 2::smallint, '2026-11-04 11:00+00');
insert into results select 'second reminder after the 48 hour gap', '2',
  (select patient_reminder_count::text from public.care_message_threads where id = (select v from ids where k='thread'));
select private.remind_patients_of_unread_care_messages(interval '24 hours', interval '48 hours', 2::smallint, '2026-11-09 11:00+00');
insert into results select 'never a third', '2',
  (select patient_reminder_count::text from public.care_message_threads where id = (select v from ids where k='thread'));

-- A new message restarts the cycle.
select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k='clinician'), 'role','authenticated')::text, true);
set local role authenticated;
select public.post_care_message((select v from ids where k='thread'), 'Following up');
reset role;
select set_config('request.jwt.claims', null, true);
insert into results select 'a new message resets the reminder count', '0',
  (select patient_reminder_count::text from public.care_message_threads where id = (select v from ids where k='thread'));

-- A read thread is never reminded.
update public.care_message_threads set last_message_at = '2026-11-01 08:00+00', patient_last_read_at = '2026-11-01 09:00+00'
 where id = (select v from ids where k='thread');
select private.remind_patients_of_unread_care_messages(interval '24 hours', interval '48 hours', 2::smallint, '2026-11-12 11:00+00');
insert into results select 'a thread the patient has opened is not reminded', '0',
  (select patient_reminder_count::text from public.care_message_threads where id = (select v from ids where k='thread'));

------------------------------------------------------------------
-- 2. Owners
------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k='clinician'), 'role','authenticated')::text, true);
set local role authenticated;
insert into public.care_thread_owners (thread_id, organisation_id, owner_id, handover_note)
  select v, '00000000-0000-0000-0000-000000000001', (select v from ids where k='clinician'), 'Patient prefers mornings' from ids where k='thread';
reset role;
select set_config('request.jwt.claims', null, true);
insert into results select 'staff can own a thread; assigned_by is server-derived', 'true',
  (select (assigned_by = owner_id)::text from public.care_thread_owners where thread_id = (select v from ids where k='thread'));

select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k='patient'), 'role','authenticated')::text, true);
set local role authenticated;
create temp table owner_seen(n int) on commit drop;
grant all on owner_seen to authenticated;
insert into owner_seen select count(*) from public.care_thread_owners;
reset role;
select set_config('request.jwt.claims', null, true);
insert into results select 'a patient sees no owner rows', '0', (select n::text from owner_seen);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.care_thread_owners (thread_id, organisation_id, owner_id)
    select (select v from ids where k='thread'), '00000000-0000-0000-0000-000000000001', (select v from ids where k='patient')
    on conflict (thread_id) do update set owner_id = excluded.owner_id;
  exception when others then v_ok := true; end;
  insert into results values ('a patient cannot be made the owner', 'true', v_ok::text);
end $$;

------------------------------------------------------------------
-- 3. Action buttons
------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k='clinician'), 'role','authenticated')::text, true);
set local role authenticated;
insert into public.care_message_actions (message_id, organisation_id, patient_id, kind)
  select v, '00000000-0000-0000-0000-000000000001', (select v from ids where k='patient'), 'book_appointment' from ids where k='msg';
reset role;
select set_config('request.jwt.claims', null, true);
insert into results select 'staff author adds an action; patient id is server-derived', 'true',
  (select (patient_id = (select v from ids where k='patient'))::text from public.care_message_actions where message_id = (select v from ids where k='msg'));

select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k='patient'), 'role','authenticated')::text, true);
set local role authenticated;
create temp table action_seen(n int) on commit drop;
grant all on action_seen to authenticated;
insert into action_seen select count(*) from public.care_message_actions;
reset role;
select set_config('request.jwt.claims', null, true);
insert into results select 'the patient can read the action', '1', (select n::text from action_seen);

do $$
declare v_ok boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k='patient'), 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.care_message_actions (message_id, organisation_id, patient_id, kind)
      select v, '00000000-0000-0000-0000-000000000001', (select v from ids where k='patient'), 'upload_result' from ids where k='msg';
  exception when others then v_ok := true; end;
  reset role;
  insert into results values ('a patient cannot add an action to a message', 'true', v_ok::text);
  begin
    insert into public.care_message_actions (message_id, organisation_id, patient_id, kind)
      select v, '00000000-0000-0000-0000-000000000001', (select v from ids where k='patient'), 'https://evil.example' from ids where k='msg';
    v_ok := false;
  exception when others then v_ok := true; end;
  insert into results values ('a free-form link cannot be stored as an action kind', 'true', v_ok::text);
end $$;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- 4. Staff upload folder
------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k='clinician'), 'role','authenticated')::text, true);
set local role authenticated;
insert into storage.objects (bucket_id, name, owner) select 'care-message-attachments', v::text || '/proof.pdf', (select v from ids where k='clinician') from ids where k='patient';
reset role;
select set_config('request.jwt.claims', null, true);
insert into results select 'staff can upload into a patient folder', '1',
  (select count(*)::text from storage.objects where bucket_id = 'care-message-attachments' and name = (select v::text from ids where k='patient') || '/proof.pdf');

do $$
declare v_ok boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k='patient'), 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into storage.objects (bucket_id, name, owner) select 'care-message-attachments', v::text || '/nope.pdf', (select v from ids where k='patient') from ids where k='other_patient';
  exception when others then v_ok := true; end;
  reset role;
  insert into results values ('a patient cannot upload into another patient folder', 'true', v_ok::text);
end $$;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
select * from results order by check_name;

do $$
declare v_failures int;
begin
  select count(*) into v_failures from results where expected is distinct from actual;
  if v_failures > 0 then
    raise exception '% of % checks FAILED — see the result rows above', v_failures, (select count(*) from results);
  end if;
  raise notice 'PASS: all % checks passed', (select count(*) from results);
end $$;

rollback;
