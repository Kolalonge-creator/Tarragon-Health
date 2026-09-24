-- Proves 20260924071557_diabetes_self_monitoring_acting_supporter.sql and
-- its 20260924073141_..._followups.sql (the /code-review ultra findings on
-- that same diff: the missing read-back-what-you-wrote SELECT policies, and
-- setPatientReportedDiabetesType's separate, RPC-level misattribution).
--
-- Found during the 2026-09-24 patient-dashboard audit: a supporter with a
-- 'manage' grant over a dependent (e.g. a parent managing a diabetic child's
-- account) could not log insulin, a foot self-check, or a sick-day note on
-- the dependent's behalf at all -- insulin_logs/foot_self_checks/
-- sick_day_logs never got the 20260801110000_acting_for_someone_you_support.sql
-- treatment that vitals_readings/symptoms already have. Worse than a
-- feature gap: the app-layer code (apps/web/.../actions.ts's
-- currentPatientOrg(), before this fix) silently inserted the record under
-- the SUPPORTER's own patient_id instead, so a parent logging a real foot
-- problem for their child produced a same-day urgent clinician_alerts row
-- against the wrong, non-diabetic patient while the child's actual record
-- stayed empty.
--
-- Mirrors packages/db/tests/acting_for_someone.sql's shape and its two load-
-- bearing guarantees, for all three tables: (1) every entry says who
-- actually made it (logged_by_profile_id, server-stamped from auth.uid(),
-- never client-supplied), and (2) a supporter may ADD to the record and
-- never revise or remove it. Adds a sabotage pass: drop the three
-- *_insert_acting_supporter policies within this same transaction and
-- confirm the supporter insert that just succeeded would now be refused --
-- proof this test would actually have caught the pre-fix state.
--
--   npx supabase db query --linked -f packages/db/tests/diabetes_self_monitoring_acting_supporter.sql

begin;

create temp table ids(k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;

do $$
declare
  r     record;
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_id  uuid;
begin
  if not exists (select 1 from public.organisations where id = v_org) then
    insert into public.organisations (id, name, type)
    values (v_org, 'Diabetes Acting-For Test Org', 'direct_consumer');
  end if;
  insert into ids(k, v) values ('org', v_org);

  for r in select * from (values
      ('child', 'patient'),
      ('parent', 'patient'),
      ('stranger', 'patient')
    ) as t(key_name, role_name)
  loop
    v_id := gen_random_uuid();
    insert into ids(k, v) values (r.key_name, v_id);

    insert into auth.users (id, email)
    values (v_id, format('diabetes-actingfor-%s@example.invalid', r.key_name));

    insert into public.profiles (id, organisation_id, role, full_name)
    values (v_id, v_org, r.role_name::public.user_role,
            format('Diabetes Acting-For %s', r.key_name))
    on conflict (id) do update
      set organisation_id = excluded.organisation_id,
          role            = excluded.role,
          full_name       = excluded.full_name;
  end loop;

  -- 'parent' manages 'child'. 'stranger' holds no grant at all.
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values ((select v from ids where k='child'), (select v from ids where k='parent'), 'manage',
          (select v from ids where k='child'))
  on conflict (profile_id, grantee_user_id) do update set permission_level = 'manage';
end $$;

------------------------------------------------------------------
-- As the parent ('manage' over the child): logs all three, deliberately
-- claiming the child entered them.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='parent'), 'role','authenticated')::text, true);
set local role authenticated;

insert into public.insulin_logs
  (organisation_id, patient_id, insulin_type, units, logged_by_profile_id)
select (select v from ids where k='org'), (select v from ids where k='child'),
       'analogue_rapid', 4, (select v from ids where k='child');

insert into public.foot_self_checks
  (organisation_id, patient_id, any_problem, findings, logged_by_profile_id)
select (select v from ids where k='org'), (select v from ids where k='child'),
       true, array['cut']::text[], (select v from ids where k='child');

insert into public.sick_day_logs
  (organisation_id, patient_id, logged_by_profile_id)
select (select v from ids where k='org'), (select v from ids where k='child'),
       (select v from ids where k='child');

-- Cannot revise or remove what is now in the record, including their own entry.
update public.insulin_logs set units = 999
 where patient_id = (select v from ids where k='child');
-- No DELETE grant exists to `authenticated` on any of these three tables at
-- all (confirmed live: org-staff clean-up, if ever needed, goes through the
-- service role) -- a stronger guarantee than RLS alone, so the attempt fails
-- at the grant layer before RLS is even consulted.
do $$
begin
  delete from public.insulin_logs where patient_id = (select v from ids where k='child');
  raise exception 'SABOTAGE CHECK FAILED: a supporter (or the DB role itself) was able to delete a diabetes self-monitoring entry';
exception when insufficient_privilege then
  null; -- expected: no DELETE grant to authenticated at all
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

do $$
begin
  if not exists (select 1 from public.insulin_logs
                  where patient_id = (select v from ids where k='child') and units = 4) then
    raise exception 'FAIL: a manage supporter could not log insulin for the child they support';
  end if;
  if (select logged_by_profile_id from public.insulin_logs
       where patient_id = (select v from ids where k='child') and units = 4)
     is distinct from (select v from ids where k='parent') then
    raise exception 'FAIL: the spoofed insulin-log author was not overwritten with the real one (server-stamped)';
  end if;
  if (select units from public.insulin_logs
       where patient_id = (select v from ids where k='child')) = 999 then
    raise exception 'FAIL: a supporter revised their own insulin-log entry -- must never be possible';
  end if;

  if not exists (select 1 from public.foot_self_checks
                  where patient_id = (select v from ids where k='child') and any_problem) then
    raise exception 'FAIL: a manage supporter could not log a foot self-check for the child they support';
  end if;
  if (select logged_by_profile_id from public.foot_self_checks
       where patient_id = (select v from ids where k='child'))
     is distinct from (select v from ids where k='parent') then
    raise exception 'FAIL: the spoofed foot-self-check author was not overwritten with the real one (server-stamped)';
  end if;

  if not exists (select 1 from public.sick_day_logs
                  where patient_id = (select v from ids where k='child')) then
    raise exception 'FAIL: a manage supporter could not log a sick-day note for the child they support';
  end if;
  if (select logged_by_profile_id from public.sick_day_logs
       where patient_id = (select v from ids where k='child'))
     is distinct from (select v from ids where k='parent') then
    raise exception 'FAIL: the spoofed sick-day-log author was not overwritten with the real one (server-stamped)';
  end if;
end $$;

-- The foot-self-check trigger must have raised a clinician alert against the
-- CHILD's org/patient, not the parent's -- the exact clinical-safety failure
-- this migration closes.
do $$
begin
  if not exists (
    select 1 from public.clinician_alerts
     where patient_id = (select v from ids where k='child')
       and title = 'Priority: diabetic foot problem reported'
  ) then
    raise exception 'FAIL: the foot self-check did not raise a clinician alert against the child';
  end if;
  if exists (
    select 1 from public.clinician_alerts
     where patient_id = (select v from ids where k='parent')
       and title = 'Priority: diabetic foot problem reported'
  ) then
    raise exception 'FAIL: the foot self-check raised a clinician alert against the PARENT instead of the child -- exactly the misattribution this migration fixes';
  end if;
end $$;

------------------------------------------------------------------
-- The read-back-what-you-wrote trap: a supporter must be able to SELECT the
-- entry they just inserted (insert(...).select(...) is checked against the
-- SELECT policy too), without gaining any wider visibility.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='parent'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  if not exists (select 1 from public.insulin_logs
                   where patient_id = (select v from ids where k='child') and units = 4) then
    raise exception 'FAIL: the parent could not read back the insulin-log entry they just wrote for the child';
  end if;
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- setPatientReportedDiabetesType: a manage supporter sets the CHILD's
-- reported type, never their own.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='parent'), 'role','authenticated')::text, true);
set local role authenticated;

select public.set_patient_reported_diabetes_type('type_1'::public.diabetes_type,
  (select v from ids where k='child'));

reset role;
select set_config('request.jwt.claims', null, true);

do $$
begin
  if not exists (select 1 from public.patient_diabetes_profile
                   where patient_id = (select v from ids where k='child')
                     and patient_reported_type = 'type_1') then
    raise exception 'FAIL: a manage supporter could not set the diabetes type for the child they support';
  end if;
  if exists (select 1 from public.patient_diabetes_profile
              where patient_id = (select v from ids where k='parent')) then
    raise exception 'FAIL: setting the child''s diabetes type created/touched the PARENT''s own patient_diabetes_profile row instead -- exactly the misattribution the followups migration fixes';
  end if;
end $$;

-- A stranger with no grant at all must be refused, same as every other
-- acting-for write on this platform.
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='stranger'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  perform public.set_patient_reported_diabetes_type('type_2'::public.diabetes_type,
    (select v from ids where k='child'));
  raise exception 'FAIL: a stranger with no grant was able to set the diabetes type for the child';
exception when others then
  if sqlstate != '42501' then
    raise;
  end if;
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- As the child herself: her own entry is not falsely attributed.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='child'), 'role','authenticated')::text, true);
set local role authenticated;

insert into public.sick_day_logs (organisation_id, patient_id)
select (select v from ids where k='org'), (select v from ids where k='child');

reset role;
select set_config('request.jwt.claims', null, true);

do $$
begin
  if not exists (select 1 from public.sick_day_logs
                   where patient_id = (select v from ids where k='child')
                     and logged_by_profile_id is null) then
    raise exception 'FAIL: a sick-day note the patient logged herself must stay unattributed (logged_by_profile_id null)';
  end if;
end $$;

------------------------------------------------------------------
-- As a stranger with no grant at all: must be refused outright.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='stranger'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  insert into public.insulin_logs (organisation_id, patient_id, insulin_type, units)
  select (select v from ids where k='org'), (select v from ids where k='child'), 'analogue_rapid', 999;
  raise exception 'FAIL: a stranger with no grant was able to log insulin for the child';
exception when insufficient_privilege then
  null; -- expected: RLS refused the insert
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Sabotage: without the three *_insert_acting_supporter policies, the very
-- insert that just succeeded above must fail. Proves this test would have
-- caught the pre-fix state, not just exercised a policy that happens to
-- always pass.
------------------------------------------------------------------
drop policy if exists insulin_logs_insert_acting_supporter on public.insulin_logs;
drop policy if exists foot_self_checks_insert_acting_supporter on public.foot_self_checks;
drop policy if exists sick_day_logs_insert_acting_supporter on public.sick_day_logs;

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='parent'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  insert into public.insulin_logs (organisation_id, patient_id, insulin_type, units)
  select (select v from ids where k='org'), (select v from ids where k='child'), 'analogue_rapid', 5;
  raise exception 'SABOTAGE CHECK FAILED: dropping insulin_logs_insert_acting_supporter should have refused this insert -- the policy is not what is actually protecting this path';
exception when insufficient_privilege then
  null; -- expected once the policy is gone
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

rollback;
