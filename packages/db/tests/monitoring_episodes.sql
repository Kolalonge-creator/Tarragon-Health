-- Proves 20260829121743_home_monitoring_programmes.sql: the Home Monitoring
-- Platform's episode/schedule/adherence layer.
--
--   1. RLS: the owning patient and org staff can see a monitoring episode;
--      an unrelated patient cannot.
--   2. monitoring_schedule_adherence computes expected/received/percentage
--      correctly over a real window of vitals_readings.
--   3. A matching reading resets consecutive_misses/last_miss_evaluated_on/
--      escalated_at and bumps last_reading_at (spec §51.11's "resuming
--      monitoring clears the missed state").
--   4. private.flag_overdue_monitoring() escalates once a schedule item
--      crosses its own escalation_missed_threshold (via the shared
--      private.raise_clinician_alert path, category=care_management,
--      type_code=overdue_monitoring), and does not re-fire on a second run.
--   5. An episode whose ends_at has passed is marked completed and enqueues
--      exactly one open care_plan_review_prompts row.
--
--   npx supabase db query --linked -f packages/db/tests/monitoring_episodes.sql

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on results to authenticated;
grant all on ids to authenticated;

insert into ids
select 'patient', id from public.profiles
 where id in (select id from auth.users where email = 'patient.complete.test@tarragon.test');
insert into ids
select 'other_patient', id from public.profiles
 where id in (select id from auth.users where email = 'patient.diaspora.test@tarragon.test');
insert into ids select 'org', organisation_id from public.profiles where id = (select v from ids where k='patient');

-- Throwaway clinician fixture in the same org, same pattern as
-- vitals_red_flag_notification_wiring.sql.
insert into ids values ('clinician', gen_random_uuid());
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ((select v from ids where k='clinician'), 'monitoring-episodes-test-clinician@example.invalid', 'x', now(), '{}', '{}');
update public.profiles
  set organisation_id = (select v from ids where k='org'), role = 'clinician',
      full_name = 'Monitoring Episodes Test Clinician'
  where id = (select v from ids where k='clinician');

------------------------------------------------------------------
-- 1) RLS: create the episode+schedule item as the clinician (patients
--    cannot write these tables), then check who can read it.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='clinician'), 'role','authenticated')::text, true);
set local role authenticated;

insert into public.monitoring_episodes (id, organisation_id, patient_id, purpose, started_at, ends_at, review_date, created_by)
select gen_random_uuid(), (select v from ids where k='org'), (select v from ids where k='patient'),
       'Hypertension review', current_date - 6, null, current_date + 7,
       (select id from public.clinical_staff where profile_id = (select v from ids where k='clinician') limit 1);

insert into ids select 'episode', id from public.monitoring_episodes
 where patient_id = (select v from ids where k='patient') and purpose = 'Hypertension review';

insert into public.monitoring_schedule_items (episode_id, vital_type, times_per_day, frequency_days, escalation_missed_threshold)
values ((select v from ids where k='episode'), 'blood_pressure', 2, 1, 3);

insert into ids select 'item', id from public.monitoring_schedule_items
 where episode_id = (select v from ids where k='episode');

reset role;
select set_config('request.jwt.claims', null, true);

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='clinician'), 'role','authenticated')::text, true);
set local role authenticated;
insert into results select 'clinician (org staff) can read the episode', 'true',
  exists(select 1 from public.monitoring_episodes where id = (select v from ids where k='episode'))::text;
reset role;
select set_config('request.jwt.claims', null, true);

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient'), 'role','authenticated')::text, true);
set local role authenticated;
insert into results select 'the owning patient can read their own episode', 'true',
  exists(select 1 from public.monitoring_episodes where id = (select v from ids where k='episode'))::text;
reset role;
select set_config('request.jwt.claims', null, true);

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='other_patient'), 'role','authenticated')::text, true);
set local role authenticated;
insert into results select 'an unrelated patient cannot read someone else''s episode', 'false',
  exists(select 1 from public.monitoring_episodes where id = (select v from ids where k='episode'))::text;
do $$
begin
  insert into public.monitoring_missed_reasons (schedule_item_id, reason)
  values ((select v from ids where k='item'), 'forgot');
  insert into results values ('an unrelated patient cannot log a missed-reason for someone else''s schedule item', 'blocked', 'allowed');
exception when others then
  insert into results values ('an unrelated patient cannot log a missed-reason for someone else''s schedule item', 'blocked', 'blocked');
end $$;
reset role;
select set_config('request.jwt.claims', null, true);

-- The owning patient CAN log a missed-reason for their own schedule item —
-- organisation_id/patient_id/episode_id are all server-stamped, never
-- client-supplied.
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient'), 'role','authenticated')::text, true);
set local role authenticated;
insert into public.monitoring_missed_reasons (schedule_item_id, reason, note)
values ((select v from ids where k='item'), 'forgot', 'Was travelling for work.');
reset role;
select set_config('request.jwt.claims', null, true);

insert into results select 'the owning patient can log their own missed-reason, server-stamped', 'true',
  exists(
    select 1 from public.monitoring_missed_reasons
    where schedule_item_id = (select v from ids where k='item')
      and patient_id = (select v from ids where k='patient')
      and organisation_id = (select v from ids where k='org')
  )::text;

------------------------------------------------------------------
-- 2) Adherence: 7-day window (today inclusive), twice daily -> expected 14.
--    Insert 12 real readings, 2/day across the first 6 days -> today has
--    none yet -> received 12, adherence_pct ~= 85.7.
------------------------------------------------------------------
insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
select (select v from ids where k='org'), (select v from ids where k='patient'), 'blood_pressure', 120, 80,
       (current_date - 6 + (n / 2)) + (((n % 2) * 12) || ' hours')::interval, 'manual'
from generate_series(0, 11) as n;

insert into results select 'adherence view: expected_readings for a 7-day/2x-daily schedule', '14',
  expected_readings::text
  from public.monitoring_schedule_adherence where schedule_item_id = (select v from ids where k='item');

insert into results select 'adherence view: received_readings counts the 12 inserted readings', '12',
  received_readings::text
  from public.monitoring_schedule_adherence where schedule_item_id = (select v from ids where k='item');

insert into results select 'adherence view: adherence_pct = round(12/14*100, 1)', '85.7',
  adherence_pct::text
  from public.monitoring_schedule_adherence where schedule_item_id = (select v from ids where k='item');

------------------------------------------------------------------
-- 3) Reset trigger: simulate a stale miss state, then a fresh matching
--    reading should clear it.
------------------------------------------------------------------
update public.monitoring_schedule_items
set consecutive_misses = 5, last_miss_evaluated_on = current_date, escalated_at = now()
where id = (select v from ids where k='item');

insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
values ((select v from ids where k='org'), (select v from ids where k='patient'), 'blood_pressure', 118, 76, now(), 'manual');

insert into results select 'a fresh matching reading resets consecutive_misses to 0', '0',
  consecutive_misses::text from public.monitoring_schedule_items where id = (select v from ids where k='item');
insert into results select 'a fresh matching reading clears escalated_at', 'true',
  (escalated_at is null)::text from public.monitoring_schedule_items where id = (select v from ids where k='item');
insert into results select 'a fresh matching reading updates last_reading_at', 'true',
  (last_reading_at is not null)::text from public.monitoring_schedule_items where id = (select v from ids where k='item');

------------------------------------------------------------------
-- 4) Escalation: a second, genuinely overdue schedule item (different
--    vital_type so it can't be satisfied by section 2/3's BP readings).
------------------------------------------------------------------
insert into public.monitoring_schedule_items (episode_id, vital_type, times_per_day, frequency_days, escalation_missed_threshold, consecutive_misses, last_miss_evaluated_on)
values ((select v from ids where k='episode'), 'weight', 1, 1, 3, 2, current_date - 1);

insert into ids select 'overdue_item', id from public.monitoring_schedule_items
 where episode_id = (select v from ids where k='episode') and vital_type = 'weight';

select private.flag_overdue_monitoring();

insert into results select 'flag_overdue_monitoring bumps consecutive_misses past the threshold', '3',
  consecutive_misses::text from public.monitoring_schedule_items where id = (select v from ids where k='overdue_item');
insert into results select 'flag_overdue_monitoring marks escalated_at once the threshold is crossed', 'true',
  (escalated_at is not null)::text from public.monitoring_schedule_items where id = (select v from ids where k='overdue_item');
insert into results select 'flag_overdue_monitoring raises a care_management/overdue_monitoring alert', '1',
  count(*)::text from public.clinician_alerts
  where patient_id = (select v from ids where k='patient')
    and category = 'care_management' and type_code = 'overdue_monitoring'
    and title = 'Home monitoring readings overdue';

-- Simulate another full cycle passing with still no reading: the item still
-- qualifies for the miss-increment loop (consecutive_misses keeps rising),
-- but escalated_at must stop a second alert row from ever being raised.
update public.monitoring_schedule_items
set last_miss_evaluated_on = current_date - 1
where id = (select v from ids where k='overdue_item');

select private.flag_overdue_monitoring();

insert into results select 'consecutive_misses keeps rising on a later sweep', '4',
  consecutive_misses::text from public.monitoring_schedule_items where id = (select v from ids where k='overdue_item');
insert into results select 'a later sweep does not re-escalate an already-escalated item', '1',
  count(*)::text from public.clinician_alerts
  where patient_id = (select v from ids where k='patient')
    and category = 'care_management' and type_code = 'overdue_monitoring'
    and title = 'Home monitoring readings overdue';

------------------------------------------------------------------
-- 5) Episode completion: an episode whose ends_at has passed is completed
--    and enqueues exactly one open review prompt.
------------------------------------------------------------------
insert into public.monitoring_episodes (id, organisation_id, patient_id, purpose, started_at, ends_at, status, created_by)
values (gen_random_uuid(), (select v from ids where k='org'), (select v from ids where k='patient'),
        'Finished 7-day HBPM run', current_date - 8, current_date - 1, 'active',
        (select id from public.clinical_staff where profile_id = (select v from ids where k='clinician') limit 1));

insert into ids select 'finished_episode', id from public.monitoring_episodes
 where patient_id = (select v from ids where k='patient') and purpose = 'Finished 7-day HBPM run';

select private.flag_overdue_monitoring();

insert into results select 'a lapsed episode is marked completed', 'completed',
  status::text from public.monitoring_episodes where id = (select v from ids where k='finished_episode');

insert into results select 'a completed episode enqueues one open review prompt', '1',
  count(*)::text from public.care_plan_review_prompts
  where trigger_event_type = 'monitoring_episode_review_due'
    and trigger_source_id = (select v from ids where k='finished_episode')
    and status = 'open';

select check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results
order by result desc, check_name;

do $$
begin
  if exists (select 1 from results where expected <> actual) then
    raise exception 'FAIL: one or more monitoring_episodes checks did not match — see the report above';
  end if;
  raise notice 'ALL MONITORING_EPISODES CHECKS PASSED';
end $$;

rollback;
