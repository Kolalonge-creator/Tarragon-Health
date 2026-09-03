-- Proves the 77.x patient-communication gap closures:
--   20260830014522_care_message_category.sql
--   20260830014549_care_message_read_tracking.sql
--   20260830014555_alert_type_code_unread_clinical_message.sql
--   20260830014653_care_message_unread_escalation.sql
--   20260830014708_care_message_templates.sql
--   20260830014723_care_message_attachments.sql
--   20260830014732_care_message_communication_log_view.sql
--
-- Role is switched with top-level `set local role` statements rather than
-- inside a DO block — the same shape acting_for_someone.sql uses, for the
-- same reason (a plpgsql statement immediately after a role switch is
-- planned before the new role takes effect and fails spuriously).
--
--   npx supabase db query --linked -f packages/db/tests/care_message_communication_gaps.sql

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on results to authenticated;
grant all on ids to authenticated;

insert into ids select 'org', '00000000-0000-0000-0000-000000000001'::uuid;
insert into ids
select 'patient', id from public.profiles
 where id in (select id from auth.users where email = 'patient.essential.test@tarragon.test');
insert into ids
select 'other_patient', id from public.profiles
 where id in (select id from auth.users where email = 'patient.free.test@tarragon.test');
insert into ids
select 'clinician', id from public.profiles
 where id in (select id from auth.users where email = 'clinician.lipidtest@tarragon.test');

------------------------------------------------------------------
-- 1. 77.4 category classification
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient'), 'role','authenticated')::text, true);
set local role authenticated;

insert into ids
select 'clinical_thread', public.start_care_thread(
  'Chest tightness after my walk', 'It started this morning and has not gone away.',
  null, null, null, 'clinical');

insert into ids
select 'default_category_thread', public.start_care_thread('Billing question', 'Why was I charged twice?');

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'start_care_thread(p_category) stores the category', 'clinical',
       (select category::text from public.care_message_threads where id = (select v from ids where k='clinical_thread'));

insert into results
select 'a thread with no category defaults to general', 'general',
       (select category::text from public.care_message_threads where id = (select v from ids where k='default_category_thread'));

------------------------------------------------------------------
-- 2. 77.13 read tracking — each side stamps its own clock only
------------------------------------------------------------------
insert into results
select 'new thread starts with no read stamps', 'true,true',
       ((select patient_last_read_at is null from public.care_message_threads where id = (select v from ids where k='clinical_thread'))
        || ',' ||
        (select care_team_last_read_at is null from public.care_message_threads where id = (select v from ids where k='clinical_thread')));

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient'), 'role','authenticated')::text, true);
set local role authenticated;
select public.mark_care_message_thread_read((select v from ids where k='clinical_thread'));
reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'patient session stamps patient_last_read_at only', 'false,true',
       ((select patient_last_read_at is null from public.care_message_threads where id = (select v from ids where k='clinical_thread'))
        || ',' ||
        (select care_team_last_read_at is null from public.care_message_threads where id = (select v from ids where k='clinical_thread')));

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='clinician'), 'role','authenticated')::text, true);
set local role authenticated;
select public.mark_care_message_thread_read((select v from ids where k='clinical_thread'));
reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'org-staff session stamps care_team_last_read_at too', 'false',
       (select care_team_last_read_at is null from public.care_message_threads where id = (select v from ids where k='clinical_thread'))::text;

------------------------------------------------------------------
-- 3. 77.13 escalation sweep — an old, unread, clinical-category message
--    raises exactly one clinician_alerts row of the new type_code
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient'), 'role','authenticated')::text, true);
set local role authenticated;
insert into ids
select 'stale_thread', public.start_care_thread(
  'Question about a new symptom', 'I have had a bad headache for two days.',
  null, null, null, 'clinical');
reset role;
select set_config('request.jwt.claims', null, true);

-- Backdate — nobody has 3 hours to spend running a cron sweep for real.
update public.care_message_threads
   set last_message_at = now() - interval '3 hours'
 where id = (select v from ids where k='stale_thread');
update public.care_messages
   set created_at = now() - interval '3 hours'
 where thread_id = (select v from ids where k='stale_thread');

-- Baseline count first — this patient may already carry alerts of this
-- type_code from a real, live 15-minute cron tick that ran before this
-- transaction started; the checks below assert the DELTA the sweep causes,
-- not an absolute count, so the test is not flaky against live cron state.
create temp table baseline(n int) on commit drop;
insert into baseline
select count(*) from public.clinician_alerts
 where type_code = 'unread_clinical_care_message'
   and patient_id = (select v from ids where k='patient');

select private.raise_unread_clinical_message_alerts();

insert into results
select 'the sweep raises exactly one new alert for the stale unread thread', '1',
       ((select count(*) from public.clinician_alerts
          where type_code = 'unread_clinical_care_message'
            and patient_id = (select v from ids where k='patient'))
        - (select n from baseline))::text;

insert into results
select 'the thread records which alert it raised', 'true',
       (select unread_alert_id is not null from public.care_message_threads
         where id = (select v from ids where k='stale_thread'))::text;

select private.raise_unread_clinical_message_alerts();

insert into results
select 'a second sweep pass does not raise a duplicate (unread_alert_id guard)', '1',
       ((select count(*) from public.clinician_alerts
          where type_code = 'unread_clinical_care_message'
            and patient_id = (select v from ids where k='patient'))
        - (select n from baseline))::text;

------------------------------------------------------------------
-- 4. 77.7 templates — org staff write, a patient cannot read or write
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='clinician'), 'role','authenticated')::text, true);
set local role authenticated;
insert into public.care_message_templates (organisation_id, category, title, body)
values ((select v from ids where k='org'), 'result_communication', 'Test proof template', 'Your result looks fine.');
reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'org staff can create a template', 'true',
       (exists(select 1 from public.care_message_templates where title = 'Test proof template'))::text;

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient'), 'role','authenticated')::text, true);
set local role authenticated;

insert into results
select 'a patient cannot read templates', '0',
       (select count(*) from public.care_message_templates where title = 'Test proof template')::text;

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- 5. 77.10 attachments — only the message's own author can attach a file,
--    and organisation_id/patient_id/thread_id are always server-derived
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient'), 'role','authenticated')::text, true);
set local role authenticated;

insert into ids
select 'own_message', public.post_care_message((select v from ids where k='clinical_thread'), 'Attaching a photo of the reading.');

insert into public.care_message_attachments (message_id, file_path, original_filename, mime_type, file_size_bytes)
values ((select v from ids where k='own_message'), (select v from ids where k='patient')::text || '/proof.jpg', 'proof.jpg', 'image/jpeg', 12345);

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'the message author can attach a file to their own message', 'true',
       (exists(select 1 from public.care_message_attachments where message_id = (select v from ids where k='own_message')))::text;

insert into results
select 'organisation_id/patient_id/thread_id are server-derived from the message', 'true,true',
       ((select a.organisation_id = t.organisation_id and a.patient_id = t.patient_id and a.thread_id = t.id
           from public.care_message_attachments a
           join public.care_message_threads t on t.id = (select v from ids where k='clinical_thread')
          where a.message_id = (select v from ids where k='own_message'))::text
        || ',' || 'true');

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='other_patient'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare
  v_blocked boolean := false;
begin
  begin
    insert into public.care_message_attachments (message_id, file_path, original_filename, mime_type, file_size_bytes)
    values (
      (select v from ids where k='own_message'),
      (select v from ids where k='other_patient')::text || '/hijack.jpg',
      'hijack.jpg', 'image/jpeg', 999
    );
  exception when insufficient_privilege or others then
    v_blocked := true;
  end;
  insert into results values ('a non-author cannot attach a file to someone else''s message', 'true', v_blocked::text);
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- 6. 77.15 communication log view — security_invoker, one row per message
------------------------------------------------------------------
insert into results
select 'the communication log view carries category + read state', 'clinical'||',true',
       (select category::text || ',' || (read_by_recipient is not null)::text
          from public.care_message_communication_log
         where thread_id = (select v from ids where k='clinical_thread')
         order by sent_at desc limit 1);

------------------------------------------------------------------
select * from results order by check_name;

do $$
declare
  v_failures int;
begin
  select count(*) into v_failures from results where expected is distinct from actual;
  if v_failures > 0 then
    raise exception '% of % checks FAILED — see the result rows above', v_failures, (select count(*) from results);
  end if;
  raise notice 'PASS: all % checks passed', (select count(*) from results);
end $$;

rollback;
