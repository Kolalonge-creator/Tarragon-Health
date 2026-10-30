-- Proves *_staff_chat_followups.sql:
--   the patient unread reminder ignores a conversation older than 14 days and still reminds one inside it;
--   a thread with no author role gets one from its latest message (metadata only, nothing notifies);
--   first_care_message_id gives the author the id of the first message they wrote, nobody else anything, anon cannot run it,
--   and it writes no audit row (the audited open it replaces is deduped per 10 minutes but still read the whole thread).
--   A sabotage step removes the 14 day ceiling and must flip the lookback check, so the proof cannot pass vacuously.
--   npx supabase db query --linked -f packages/db/tests/staff_chat_followups.sql

begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on results to authenticated;
grant all on ids to authenticated;

create function pg_temp.mkuser(p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'chatfu-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, '00000000-0000-0000-0000-000000000001', p_role::public.user_role, 'Proof ' || p_label,
          '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
insert into ids values ('patient', pg_temp.mkuser('patient', 'patient'));
insert into ids values ('other_patient', pg_temp.mkuser('other', 'patient'));
insert into ids values ('clinician', pg_temp.mkuser('coordinator', 'care_coordinator'));

select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k='clinician'), 'role','authenticated')::text, true);
set local role authenticated;
insert into ids select 'thread', public.start_care_thread('Follow up', 'Please check in this week', (select v from ids where k='patient'));
reset role;
select set_config('request.jwt.claims', null, true);
insert into ids select 'msg', (select id from public.care_messages where thread_id = (select v from ids where k='thread') order by created_at limit 1);

------------------------------------------------------------------
-- 1. Lookback. p_now is explicit so the Lagos hour never makes this flaky (11:00 UTC = 12:00 Lagos).
------------------------------------------------------------------
update public.care_message_threads set last_message_at = '2026-11-01 08:00+00', patient_last_read_at = null,
       patient_reminder_count = 0, patient_last_reminded_at = null
 where id = (select v from ids where k='thread');

select private.remind_patients_of_unread_care_messages(interval '24 hours', interval '48 hours', 2::smallint, '2026-11-20 11:00+00', true);
insert into results select 'real', 'a message older than 14 days is not reminded', '0',
  (select patient_reminder_count::text from public.care_message_threads where id = (select v from ids where k='thread'));
select private.remind_patients_of_unread_care_messages(interval '24 hours', interval '48 hours', 2::smallint, '2026-11-10 11:00+00', true);
insert into results select 'real', 'the same message inside 14 days is reminded', '1',
  (select patient_reminder_count::text from public.care_message_threads where id = (select v from ids where k='thread'));

------------------------------------------------------------------
-- 2. Backfill of a missing author role (the set-based form of the migration's per-row loop; the loop only adds a skip for under-18 dependant threads)
------------------------------------------------------------------
update public.care_message_threads set last_message_author_role = null where id = (select v from ids where k='thread');
create temp table notif_before(n bigint) on commit drop;
insert into notif_before select count(*) from public.notifications;
update public.care_message_threads t
   set last_message_author_role = m.author_role
  from (
    select distinct on (thread_id) thread_id, author_role
      from public.care_messages
     order by thread_id, created_at desc, id desc
  ) m
 where m.thread_id = t.id and t.last_message_author_role is null;
insert into results select 'real', 'a thread with no role gets the role of its latest message', 'care_team',
  (select last_message_author_role::text from public.care_message_threads where id = (select v from ids where k='thread'));
insert into results select 'real', 'the backfill notifies nobody', 'true',
  ((select count(*) from public.notifications) = (select n from notif_before))::text;

------------------------------------------------------------------
-- 3. first_care_message_id
------------------------------------------------------------------
create temp table audit_before(n bigint) on commit drop;
grant all on audit_before to authenticated;
insert into audit_before select count(*) from public.audit_log;

select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k='clinician'), 'role','authenticated')::text, true);
set local role authenticated;
insert into results select 'real', 'the author gets the id of the first message they wrote', 'true',
  (public.first_care_message_id((select v from ids where k='thread')) = (select v from ids where k='msg'))::text;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k='other_patient'), 'role','authenticated')::text, true);
set local role authenticated;
insert into results select 'real', 'someone who wrote nothing in the thread gets nothing', 'true',
  (public.first_care_message_id((select v from ids where k='thread')) is null)::text;
reset role;
select set_config('request.jwt.claims', null, true);

insert into results select 'real', 'looking up the id writes no audit row', 'true',
  ((select count(*) from public.audit_log) = (select n from audit_before))::text;
insert into results select 'real', 'anon cannot run first_care_message_id', 'false',
  has_function_privilege('anon', 'public.first_care_message_id(uuid)', 'EXECUTE')::text;
insert into results select 'real', 'a client cannot run the reminder sweep', 'false',
  has_function_privilege('authenticated', 'private.remind_patients_of_unread_care_messages(interval,interval,smallint,timestamptz,boolean)', 'EXECUTE')::text;

------------------------------------------------------------------
-- Sabotage: remove the 14 day ceiling from the live function body. The lookback check must flip.
------------------------------------------------------------------
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('private.remind_patients_of_unread_care_messages(interval,interval,smallint,timestamptz,boolean)'::regprocedure);
  if v_def not like '%interval ''14 days''%' then raise exception 'the 14 day ceiling is not in the function body'; end if;
  execute replace(v_def, 'and p_now - t.last_message_at <= interval ''14 days''', '');
end $$;
update public.care_message_threads set last_message_at = '2026-11-01 08:00+00', patient_last_read_at = null,
       patient_reminder_count = 0, patient_last_reminded_at = null, last_message_author_role = 'care_team'
 where id = (select v from ids where k='thread');
select private.remind_patients_of_unread_care_messages(interval '24 hours', interval '48 hours', 2::smallint, '2026-11-20 11:00+00', true);
insert into results select 'sabotaged', 'a message older than 14 days is not reminded', '0',
  (select patient_reminder_count::text from public.care_message_threads where id = (select v from ids where k='thread'));

------------------------------------------------------------------
select * from results order by phase, check_name;

do $$
declare v_failures int; v_caught int;
begin
  select count(*) into v_failures from results where phase = 'real' and expected is distinct from actual;
  if v_failures > 0 then
    raise exception '% of % checks FAILED, see the result rows above', v_failures, (select count(*) from results where phase = 'real');
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotage flipped % of 1 checks', v_caught; end if;
  raise notice 'PASS: % checks passed and the sabotage was caught', (select count(*) from results where phase = 'real');
end $$;

rollback;
