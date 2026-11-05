-- Proves 20261105102455_video_consultation_host_link_staff_only.sql (master architecture assessment finding S3).
--
-- 1. A host start link written to video_consultations (as every server action that creates a Zoom meeting does) is stored only in
--    video_consultation_host_links, and the consultation row keeps NULL.
-- 2. The patient whose consultation it is cannot read the link, through either table.
-- 3. Care-team staff in the organisation can read it.
-- 4. Clearing the meeting (zoom_meeting_id changed with no new link, as reschedule_lab_result_consult_request does) deletes the
--    stale link; supplying a new link replaces it.
-- 5. A patient cannot write the side table.
-- Sabotage: with the trigger disabled and the CHECK dropped, the patient CAN read the host link again, so check 2 discriminates.
--
-- Role switches are top-level statements (see acting_for_someone.sql for why). Wrapped in BEGIN/ROLLBACK.

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on results to authenticated;
grant all on ids to authenticated;

insert into ids values
  ('org', (select id from public.organisations order by created_at limit 1)),
  ('patient', 'a5e10000-0000-4000-8000-000000000001'),
  ('doctor', 'a5e10000-0000-4000-8000-000000000002'),
  ('consult', 'a5e10000-0000-4000-8000-000000000003');

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ((select v from ids where k='patient'), 'hostlink-patient@example.invalid', 'x', now(), '{}', '{}'),
       ((select v from ids where k='doctor'), 'hostlink-doctor@example.invalid', 'x', now(), '{}', '{}')
on conflict (id) do nothing;

insert into public.profiles (id, organisation_id, role, full_name)
values ((select v from ids where k='patient'), (select v from ids where k='org'), 'patient', 'Hostlink Patient'),
       ((select v from ids where k='doctor'), (select v from ids where k='org'), 'clinician', 'Hostlink Doctor')
on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id;

-- A meeting created the way the app creates one: the host link is written to video_consultations.
insert into public.video_consultations (id, organisation_id, patient_id, context, zoom_meeting_id, join_url, host_start_url)
values ((select v from ids where k='consult'), (select v from ids where k='org'), (select v from ids where k='patient'),
        'general_checkin', '81000000001', 'https://zoom.example/j/1?pwd=x', 'https://zoom.example/s/1?zak=SECRET1');

insert into results select '1. consultation row keeps NULL', 'true',
  ((select host_start_url from public.video_consultations where id = (select v from ids where k='consult')) is null)::text;
insert into results select '1. side table holds the link', 'https://zoom.example/s/1?zak=SECRET1',
  (select host_start_url from public.video_consultation_host_links where video_consultation_id = (select v from ids where k='consult'));

---------------------------------------------------------------------- as the patient
select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k='patient'), 'role', 'authenticated')::text, true);
set local role authenticated;

insert into results select '2. patient sees own consultation', '1',
  (select count(*) from public.video_consultations where id = (select v from ids where k='consult'))::text;
insert into results select '2. patient reads no host link on the consultation', 'true',
  ((select host_start_url from public.video_consultations where id = (select v from ids where k='consult')) is null)::text;
insert into results select '2. patient sees no side-table row', '0',
  (select count(*) from public.video_consultation_host_links)::text;

reset role;
select set_config('request.jwt.claims', null, true);

-- 5. a patient cannot write the side table (no grant).
do $$
declare v_denied boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'a5e10000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    execute $q$insert into public.video_consultation_host_links (video_consultation_id, organisation_id, host_start_url)
               values ('a5e10000-0000-4000-8000-000000000003', (select organisation_id from public.profiles where id = 'a5e10000-0000-4000-8000-000000000001'), 'x')$q$;
  exception when insufficient_privilege then v_denied := true;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  insert into results values ('5. patient cannot write the side table', 'true', v_denied::text);
end;
$$;

---------------------------------------------------------------------- as the doctor
select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k='doctor'), 'role', 'authenticated')::text, true);
set local role authenticated;

insert into results select '3. staff reads the host link', 'https://zoom.example/s/1?zak=SECRET1',
  (select host_start_url from public.video_consultation_host_links where video_consultation_id = (select v from ids where k='consult'));

reset role;
select set_config('request.jwt.claims', null, true);

---------------------------------------------------------------------- 4. replace and clear
update public.video_consultations
   set zoom_meeting_id = '81000000002', join_url = 'https://zoom.example/j/2', host_start_url = 'https://zoom.example/s/2?zak=SECRET2'
 where id = (select v from ids where k='consult');
insert into results select '4. a new link replaces the old one', 'https://zoom.example/s/2?zak=SECRET2',
  (select host_start_url from public.video_consultation_host_links where video_consultation_id = (select v from ids where k='consult'));

update public.video_consultations set zoom_meeting_id = null, join_url = null, host_start_url = null
 where id = (select v from ids where k='consult');
insert into results select '4. clearing the meeting deletes the stale link', '0',
  (select count(*) from public.video_consultation_host_links where video_consultation_id = (select v from ids where k='consult'))::text;

update public.video_consultations set scheduled_at = now() + interval '1 day' where id = (select v from ids where k='consult');
insert into results select '4. an unrelated update leaves the consultation row NULL', 'true',
  ((select host_start_url from public.video_consultations where id = (select v from ids where k='consult')) is null)::text;

-- 6. a cancelled call loses its host link
update public.video_consultations
   set zoom_meeting_id = '81000000004', join_url = 'https://zoom.example/j/4', host_start_url = 'https://zoom.example/s/4?zak=SECRET4'
 where id = (select v from ids where k='consult');
update public.video_consultations set status = 'cancelled' where id = (select v from ids where k='consult');
insert into results select '6. cancelling the call deletes its host link', '0',
  (select count(*) from public.video_consultation_host_links where video_consultation_id = (select v from ids where k='consult'))::text;

-- 7. INSERT ... ON CONFLICT DO NOTHING on an existing id with a new link: no orphan, no failure, the row's link is unchanged.
insert into public.video_consultations (id, organisation_id, patient_id, context, zoom_meeting_id, host_start_url)
values ((select v from ids where k='consult'), (select v from ids where k='org'), (select v from ids where k='patient'),
        'general_checkin', '81000000009', 'https://zoom.example/s/9?zak=ORPHAN')
on conflict (id) do nothing;
insert into results select '7. a conflicting insert writes no side row', '0',
  (select count(*) from public.video_consultation_host_links where host_start_url like '%ORPHAN')::text;
update public.video_consultations set scheduled_at = now() + interval '2 days' where id = (select v from ids where k='consult');
insert into results select '7. nor does a later unrelated update pick up the parked link', '0',
  (select count(*) from public.video_consultation_host_links where host_start_url like '%ORPHAN')::text;

---------------------------------------------------------------------- sabotage: remove the fix, the patient can read the link
alter table public.video_consultations disable trigger "000_move_host_link";
alter table public.video_consultations disable trigger "zzz_store_host_link";
alter table public.video_consultations drop constraint video_consultations_host_start_url_moved;
update public.video_consultations set host_start_url = 'https://zoom.example/s/3?zak=SECRET3'
 where id = (select v from ids where k='consult');

select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k='patient'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into results select 'SABOTAGE: without the fix the patient reads the host link (check 2 would fail)', 'false',
  ((select host_start_url from public.video_consultations where id = (select v from ids where k='consult')) is null)::text;
reset role;
select set_config('request.jwt.claims', null, true);

-- Report and assert.
select check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as verdict from results order by check_name;

do $$
declare v_fail int;
begin
  select count(*) into v_fail from results where expected is distinct from actual;
  if v_fail > 0 then
    raise exception 'video_consultation_host_link_staff_only: % check(s) failed', v_fail;
  end if;
  if (select count(*) from results) <> 14 then
    raise exception 'video_consultation_host_link_staff_only: expected 14 checks, got %', (select count(*) from results);
  end if;
end;
$$;

rollback;
