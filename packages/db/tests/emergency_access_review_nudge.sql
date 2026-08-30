-- ===========================================================================
-- Verification: private.notify_unapproved_emergency_access_grants(), after
-- 20260830122512_emergency_access_review_nudge_cron.sql.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — leaves the database exactly as it found it.
-- Simulated-session pattern per packages/db/tests/scoped_access_roles_rls.sql
-- is not needed here: the function under test is a cron job, always run as
-- an internal/superuser context, never via a user session.
-- ===========================================================================

begin;

create temporary table nudge_result(check_name text, observed text, expected text, verdict text) on commit drop;

do $$
declare
  v_org_a       uuid;
  v_org_b       uuid := gen_random_uuid();
  v_patient     uuid;
  v_requester   uuid := gen_random_uuid();
  v_director    uuid := gen_random_uuid();
  v_grant_id    uuid;
  v_notif_count bigint;
  v_nudge_count bigint;
begin
  select organisation_id into v_org_a from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;

  if v_org_a is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  insert into public.organisations (id, name, type) values (v_org_b, 'Nudge Test Org B', 'direct_consumer');

  select id into v_patient from public.profiles where role = 'patient' and organisation_id = v_org_a limit 1;

  insert into auth.users (id, email) values
    (v_requester, 'nudgetest.requester@example.com'),
    (v_director, 'nudgetest.director@example.com');

  -- handle_new_user may already have created the profile from the auth.users
  -- insert; upsert so this works either way.
  insert into public.profiles (id, organisation_id, role, full_name) values
    (v_requester, v_org_b, 'clinician', 'Nudge Test Requester'),
    (v_director, v_org_a, 'clinician', 'Nudge Test Director')
  on conflict (id) do update set organisation_id = excluded.organisation_id, full_name = excluded.full_name;

  insert into public.clinical_staff (organisation_id, profile_id, full_name, doctor_tier, active, is_clinical_director, license_verified_at)
  values (v_org_a, v_director, 'Nudge Test Director', 'tier_4_senior_registrar', true, true, now());

  -- Expires in 10 minutes -- inside the 1-hour nudge window, still technically
  -- valid access, and still unreviewed.
  insert into public.emergency_record_access_grants
    (requester_id, requester_org_id, patient_id, patient_org_id, reason, expires_at)
  values (v_requester, v_org_b, v_patient, v_org_a, 'nudge test fixture', now() + interval '10 minutes')
  returning id into v_grant_id;

  -- 1. First run notifies the home-org director and records a dedup row.
  perform private.notify_unapproved_emergency_access_grants();

  select count(*) into v_notif_count from public.notifications
    where recipient_id = v_director and template = 'emergency_access_review_due'
      and (payload->>'grant_id')::uuid = v_grant_id;
  insert into nudge_result values ('first run notifies the home-org director', v_notif_count::text, '1', case when v_notif_count = 1 then 'PASS' else 'FAIL' end);

  select count(*) into v_nudge_count from public.emergency_record_access_nudges where grant_id = v_grant_id;
  insert into nudge_result values ('first run records a dedup row', v_nudge_count::text, '1', case when v_nudge_count = 1 then 'PASS' else 'FAIL' end);

  -- 2. A second run the same day must not send a duplicate notification.
  perform private.notify_unapproved_emergency_access_grants();

  select count(*) into v_notif_count from public.notifications
    where recipient_id = v_director and template = 'emergency_access_review_due'
      and (payload->>'grant_id')::uuid = v_grant_id;
  insert into nudge_result values ('second same-day run does not duplicate', v_notif_count::text, '1', case when v_notif_count = 1 then 'PASS' else 'FAIL' end);

  if exists (select 1 from nudge_result where verdict = 'FAIL') then
    raise exception 'one or more checks failed — see nudge_result';
  end if;
end $$;

select * from nudge_result order by check_name;

rollback;
