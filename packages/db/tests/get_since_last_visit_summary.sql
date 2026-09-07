-- Tarragon Health — "since you were last here" summary verification
--
-- Proves public.get_since_last_visit_summary(): returns show:false for a
-- patient active within the last 20h, show:false for one with no recorded
-- app_last_active_at, show:false when nothing happened during the gap even
-- though it's long enough, and show:true with correct counts when a
-- message/points/timeline event landed inside the window. Also proves the
-- self-view guard (a caller cannot read another patient's summary).
--
-- Note on shape: the role is switched with top-level `set local role`
-- statements rather than inside a DO block — the first statement after the
-- switch is planned before the new role is in effect and fails spuriously
-- inside plpgsql, per acting_for_someone.sql's own note; every RLS/
-- security-definer test in this directory that simulates a caller switches
-- at statement level for the same reason.
--
-- Run inside a transaction that is always rolled back — nothing here should
-- ever be committed.
--
-- Every party is MINTED here rather than selected from an existing org/
-- patient/clinician — on a fresh `supabase db reset`, supabase/seed/seed.sql
-- carries only reference catalogues (screen_types, vaccination_catalog, lab/
-- pharmacy partners), no tenant/patient/clinical_staff data at all, so a
-- lookup-based fixture would return NULL and every check below would run
-- against NULL and report a confident pass (see fertility_assessment_
-- requests_staff_gate.sql's own note on this exact failure mode). No
-- clinical_staff row is needed for the staff-authored message: private.
-- is_org_staff() (which private.enforce_care_message_author() calls) only
-- checks profiles.role <> 'patient' in the same org, not a clinical_staff row.
--
--   npx supabase db query --linked -f packages/db/tests/get_since_last_visit_summary.sql

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on results to authenticated;
grant all on ids to authenticated;

do $$
declare
  r     record;
  v_org uuid := gen_random_uuid();
begin
  insert into public.organisations (id, name, type)
  values (v_org, 'Since Last Visit Test Org', 'direct_consumer');
  insert into ids(k, v) values ('org', v_org);

  for r in select * from (values
      ('patient', 'patient'),
      ('other', 'patient'),
      ('staff', 'clinician')
    ) as t(key_name, role_name)
  loop
    declare
      v_id uuid := gen_random_uuid();
    begin
      insert into ids(k, v) values (r.key_name, v_id);
      insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values (v_id, format('since-last-visit-%s@example.invalid', r.key_name), 'x', now(), '{}', '{}');
      update public.profiles
        set organisation_id = v_org, role = r.role_name::public.user_role,
            full_name = format('Since Last Visit %s', r.key_name),
            app_last_active_at = case when r.key_name = 'patient' then now() - interval '30 hours' else null end
        where id = v_id;
    end;
  end loop;
end $$;

------------------------------------------------------------------
-- Case 1: gap is long enough (30h), but nothing happened — self-hides.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient'), 'role', 'authenticated')::text, true);
set local role authenticated;

insert into results select 'case1: nothing happened during a long-enough gap -> show', 'false',
  (public.get_since_last_visit_summary((select v from ids where k='patient')) ->> 'show');

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Case 2: a care-team message and wellness points land inside the window.
-- private.enforce_care_message_author() derives author_role/author_profile_id
-- itself from auth.uid() + private.is_org_staff() — it ignores whatever the
-- insert supplies for those columns — so the message must actually be
-- inserted as a real staff member's simulated session, not just labelled
-- 'care_team'. care_message_threads/wellness_points_ledger have no such
-- derivation and insert fine under the default (service) role.
------------------------------------------------------------------
do $$
declare
  v_org uuid := (select v from ids where k='org');
  v_patient uuid := (select v from ids where k='patient');
  v_thread uuid;
begin
  insert into public.care_message_threads (id, organisation_id, patient_id, subject, status)
  values (gen_random_uuid(), v_org, v_patient, 'Weekly check-in', 'open')
  returning id into v_thread;
  insert into ids values ('thread', v_thread);
  insert into public.wellness_points_ledger (organisation_id, patient_id, points, balance_after, reason)
  values (v_org, v_patient, 15, 15, 'test fixture');
end $$;

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='staff'), 'role', 'authenticated')::text, true);
set local role authenticated;

insert into public.care_messages (thread_id, body)
values ((select v from ids where k='thread'), 'Checking in on your reading this week.');

reset role;
select set_config('request.jwt.claims', null, true);

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient'), 'role', 'authenticated')::text, true);
set local role authenticated;

insert into results select 'case2: message + points land in window -> show', 'true',
  (public.get_since_last_visit_summary((select v from ids where k='patient')) ->> 'show');
insert into results select 'case2: messages_count', '1',
  (public.get_since_last_visit_summary((select v from ids where k='patient')) ->> 'messages_count');
insert into results select 'case2: points_earned', '15',
  (public.get_since_last_visit_summary((select v from ids where k='patient')) ->> 'points_earned');

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Case 3: last-active moved to 2h ago (under the 20h threshold) -> show:false
-- regardless of the content fixtured in case 2.
------------------------------------------------------------------
update public.profiles set app_last_active_at = now() - interval '2 hours'
where id = (select v from ids where k='patient');

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient'), 'role', 'authenticated')::text, true);
set local role authenticated;

insert into results select 'case3: active 2h ago -> show', 'false',
  (public.get_since_last_visit_summary((select v from ids where k='patient')) ->> 'show');

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Case 4: app_last_active_at never recorded -> show:false.
------------------------------------------------------------------
update public.profiles set app_last_active_at = null
where id = (select v from ids where k='patient');

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient'), 'role', 'authenticated')::text, true);
set local role authenticated;

insert into results select 'case4: app_last_active_at null -> show', 'false',
  (public.get_since_last_visit_summary((select v from ids where k='patient')) ->> 'show');

------------------------------------------------------------------
-- Case 5: self-view guard — patient cannot read another patient's summary
-- (still authenticated as 'patient' from case 4's role switch above).
------------------------------------------------------------------
insert into results select 'case5: requesting another patient''s summary -> show', 'false',
  (public.get_since_last_visit_summary((select v from ids where k='other')) ->> 'show');

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Verdict
------------------------------------------------------------------
do $$
declare
  v_row record;
  v_failures int := 0;
begin
  for v_row in select * from results loop
    if v_row.expected is distinct from v_row.actual then
      v_failures := v_failures + 1;
      raise notice 'FAIL: % — expected %, got %', v_row.check_name, v_row.expected, v_row.actual;
    else
      raise notice 'PASS: %', v_row.check_name;
    end if;
  end loop;

  if v_failures > 0 then
    raise exception 'FAIL: % of % GET_SINCE_LAST_VISIT_SUMMARY checks failed', v_failures, (select count(*) from results);
  end if;

  raise notice 'ALL GET_SINCE_LAST_VISIT_SUMMARY CHECKS PASSED';
end $$;

rollback;
