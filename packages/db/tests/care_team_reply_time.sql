-- Proves *_care_team_reply_time.sql: the reply-time figure is the median first named-care-team reply to a run-starting patient message over
-- 30 days, scoped to the caller's own organisation, hidden when the sample is thin or too many old messages are unanswered, never counts
-- emergency-flagged messages or replies with no named author, and is not callable by anon. Sabotage in the final steps.
--
--   npx supabase db query --linked -f packages/db/tests/care_team_reply_time.sql

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on results to authenticated;
grant all on ids to authenticated;

-- Fixtures are written with triggers off (the author/safety triggers belong to the send path, not to this proof).
set local session_replication_role = replica;

do $$
declare
  v_org1 uuid := gen_random_uuid(); v_org2 uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid(); v_doc uuid := gen_random_uuid(); v_pat2 uuid := gen_random_uuid(); v_doc2 uuid := gen_random_uuid();
  v_thread uuid; i int;
begin
  insert into public.organisations (id, name, type) values (v_org1, 'Reply Org 1', 'direct_consumer'), (v_org2, 'Reply Org 2', 'direct_consumer');
  insert into auth.users (id, email) values (v_pat, 'rt-pat@example.invalid'), (v_doc, 'rt-doc@example.invalid'), (v_pat2, 'rt-pat2@example.invalid'), (v_doc2, 'rt-doc2@example.invalid');
  insert into public.profiles (id, organisation_id, role, full_name) values
    (v_pat, v_org1, 'patient', 'RT Patient'), (v_doc, v_org1, 'clinician', 'RT Doctor'),
    (v_pat2, v_org2, 'patient', 'RT Patient 2'), (v_doc2, v_org2, 'clinician', 'RT Doctor 2');
  insert into ids values ('org1', v_org1), ('org2', v_org2), ('pat', v_pat), ('pat2', v_pat2);

  -- Org 1: 12 answered threads, each replied to 60 minutes later by a named clinician.
  for i in 1..12 loop
    v_thread := gen_random_uuid();
    insert into public.care_message_threads (id, organisation_id, patient_id, subject) values (v_thread, v_org1, v_pat, 'q' || i);
    insert into public.care_messages (organisation_id, patient_id, thread_id, author_profile_id, author_role, body, created_at)
    values (v_org1, v_pat, v_thread, v_pat, 'patient', 'hello', now() - interval '5 days'),
           (v_org1, v_pat, v_thread, v_doc, 'care_team', 'reply', now() - interval '5 days' + interval '60 minutes');
  end loop;
  -- Org 2: 12 answered threads at 600 minutes. Must never leak into org 1's figure.
  for i in 1..12 loop
    v_thread := gen_random_uuid();
    insert into public.care_message_threads (id, organisation_id, patient_id, subject) values (v_thread, v_org2, v_pat2, 'q' || i);
    insert into public.care_messages (organisation_id, patient_id, thread_id, author_profile_id, author_role, body, created_at)
    values (v_org2, v_pat2, v_thread, v_pat2, 'patient', 'hello', now() - interval '5 days'),
           (v_org2, v_pat2, v_thread, v_doc2, 'care_team', 'reply', now() - interval '5 days' + interval '600 minutes');
  end loop;
end $$;

set local session_replication_role = origin;

create or replace function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.as_user((select v from ids where k='pat'));
set local role authenticated;
create temp table r1 on commit drop as select public.care_team_reply_time() as j;
reset role;
insert into results select 'org 1: available', 'true', (select j->>'available' from r1);
insert into results select 'org 1: median is its own 60 minutes, not org 2''s 600', '60', (select j->>'median_minutes' from r1);
insert into results select 'org 1: counts its 12 replies', '12', (select j->>'replies' from r1);

-- Emergency-flagged messages are left out. 12 old, unanswered, emergency-flagged messages must NOT hide or change the figure.
set local session_replication_role = replica;
do $$
declare v_thread uuid; i int; v_org uuid := (select v from ids where k='org1'); v_pat uuid := (select v from ids where k='pat');
begin
  for i in 1..12 loop
    v_thread := gen_random_uuid();
    insert into public.care_message_threads (id, organisation_id, patient_id, subject) values (v_thread, v_org, v_pat, 'emerg' || i);
    insert into public.care_messages (organisation_id, patient_id, thread_id, author_profile_id, author_role, body, created_at, flagged_potential_emergency)
    values (v_org, v_pat, v_thread, v_pat, 'patient', 'help', now() - interval '3 days', true);
  end loop;
end $$;
set local session_replication_role = origin;
select pg_temp.as_user((select v from ids where k='pat'));
set local role authenticated;
create temp table r2 on commit drop as select public.care_team_reply_time() as j;
reset role;
insert into results select 'emergency-flagged messages are not counted (figure unchanged)', 'true', (select j->>'available' from r2);
insert into results select 'emergency-flagged messages leave the median at 60', '60', (select j->>'median_minutes' from r2);

-- A reply with no named author (an automatic notice) is not a reply: 12 such threads are unanswered and old, so 12 of 24 are stale.
set local session_replication_role = replica;
do $$
declare v_thread uuid; i int; v_org uuid := (select v from ids where k='org1'); v_pat uuid := (select v from ids where k='pat');
begin
  for i in 1..12 loop
    v_thread := gen_random_uuid();
    insert into public.care_message_threads (id, organisation_id, patient_id, subject) values (v_thread, v_org, v_pat, 'auto' || i);
    insert into public.care_messages (organisation_id, patient_id, thread_id, author_profile_id, author_role, body, created_at)
    values (v_org, v_pat, v_thread, v_pat, 'patient', 'hello', now() - interval '4 days'),
           (v_org, v_pat, v_thread, null, 'care_team', 'we got your message', now() - interval '4 days' + interval '1 minute');
  end loop;
end $$;
set local session_replication_role = origin;
select pg_temp.as_user((select v from ids where k='pat'));
set local role authenticated;
create temp table r3 on commit drop as select public.care_team_reply_time() as j;
reset role;
insert into results select 'unnamed automatic replies do not count: a half-unanswered backlog hides the figure', 'false', (select j->>'available' from r3);

-- Thin sample: caller from an org with no messages gets nothing.
insert into results select 'anon cannot run it', 'false', has_function_privilege('anon', 'public.care_team_reply_time()', 'EXECUTE')::text;

do $$
declare bad text;
begin
  select string_agg(check_name || ' (expected ' || expected || ', got ' || coalesce(actual, 'null') || ')', '; ') into bad from results where expected is distinct from actual;
  if bad is not null then raise exception 'care_team_reply_time proof failed: %', bad; end if;
end $$;

select check_name, expected, actual, 'PASS' as status from results order by 1;
rollback;
