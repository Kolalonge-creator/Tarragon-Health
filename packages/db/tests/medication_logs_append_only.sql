-- Proves 20260830224528_medication_logs_append_only.sql and
-- 20260830233204_medication_logs_safety_hardening.sql in isolation, as a
-- patient logging her own doses — no acting-for/consent scaffolding, so this
-- test is unaffected by the separate, pre-existing drift in
-- medication_logs_acting_for.sql (that file's profile_access.clinical_access
-- column does not exist on the live project; unrelated to this change,
-- flagged separately rather than fixed here).
--
--   npx supabase db query --linked -f packages/db/tests/medication_logs_append_only.sql

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on results to authenticated;
grant all on ids to authenticated;

insert into ids
select 'mum', id from public.profiles
 where id in (select id from auth.users where email = 'patient.complete.test@tarragon.test');

with inserted as (
  insert into public.medications
    (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, is_active)
  values
    ('00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
     'Test Lisinopril', '10mg', 'once daily', '["09:00"]'::jsonb, true)
  returning id
)
insert into ids select 'med', id from inserted;

------------------------------------------------------------------
-- As the patient: logs a dose, then corrects it twice
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='mum'), 'role','authenticated')::text, true);
set local role authenticated;

insert into public.medication_logs
  (organisation_id, patient_id, medication_id, scheduled_time, scheduled_for_date, status, logged_at)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
   (select v from ids where k='med'), '09:00', current_date, 'missed', now());

-- A correction: append-only means this is a second INSERT, not an UPDATE.
-- No unique index blocks it (medication_logs_scheduled_dose_uidx was
-- dropped) and there is no UPDATE policy left to route this through.
insert into public.medication_logs
  (organisation_id, patient_id, medication_id, scheduled_time, scheduled_for_date, status, logged_at)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
   (select v from ids where k='med'), '09:00', current_date, 'taken', now() + interval '1 minute');

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'both the original and the corrected entry are on file', '2',
       (select count(*)::text from public.medication_logs
          where medication_id = (select v from ids where k='med') and scheduled_time = '09:00');

insert into results
select 'medication_logs_latest_per_slot surfaces only the newer status', 'taken',
       (select status::text from public.medication_logs_latest_per_slot
          where medication_id = (select v from ids where k='med') and scheduled_time = '09:00');

insert into results
select 'the view returns exactly one row for the slot, not one per underlying log', '1',
       (select count(*)::text from public.medication_logs_latest_per_slot
          where medication_id = (select v from ids where k='med') and scheduled_time = '09:00');

------------------------------------------------------------------
-- logged_at is a server fact: a spoofed far-future timestamp (which would
-- otherwise let a fake entry permanently outrank every real future
-- correction in the latest-per-slot ordering) must come back as the real
-- insert time, not the claimed one.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='mum'), 'role','authenticated')::text, true);
set local role authenticated;

insert into public.medication_logs
  (organisation_id, patient_id, medication_id, scheduled_time, scheduled_for_date, status, logged_at)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
   (select v from ids where k='med'), '23:59', current_date, 'taken', now() + interval '10 years');

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'a spoofed far-future logged_at is overridden with the real insert time', 'true',
       (exists(
         select 1 from public.medication_logs
          where medication_id = (select v from ids where k='med') and scheduled_time = '23:59'
            and logged_at < now() + interval '1 hour'
       ))::text;

------------------------------------------------------------------
-- Freeform (as-needed) logs: no slot to dedupe against, so each stands on
-- its own — the view must never collapse two different freeform entries
-- into one (DISTINCT ON treats NULLs in its key as equal, which is exactly
-- the trap the view's extra `case when scheduled_time is null then id end`
-- key column exists to avoid).
------------------------------------------------------------------
insert into public.medication_logs
  (organisation_id, patient_id, medication_id, status, logged_at)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
   (select v from ids where k='med'), 'taken', now()),
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
   (select v from ids where k='med'), 'taken', now());

insert into results
select 'two distinct freeform logs both survive the latest-per-slot view', '2',
       (select count(*)::text from public.medication_logs_latest_per_slot
          where medication_id = (select v from ids where k='med') and scheduled_time is null);

------------------------------------------------------------------
-- Escalation evaluator: distinct slots whose LATEST status is 'missed',
-- not a raw row count — a corrected dose must not double-count.
------------------------------------------------------------------
-- Three more distinct scheduled slots, each logged 'missed' once — pushes
-- the trailing-30-day distinct-missed-slot count to 3, the coach threshold.
-- The correction above (09:00, now 'taken') must NOT be one of the three.
insert into public.medication_logs
  (organisation_id, patient_id, medication_id, scheduled_time, scheduled_for_date, status, logged_at)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
   (select v from ids where k='med'), '09:00', current_date - 1, 'missed', now()),
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
   (select v from ids where k='med'), '09:00', current_date - 2, 'missed', now()),
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
   (select v from ids where k='med'), '09:00', current_date - 3, 'missed', now());

insert into results
select 'coach-level alert raised at 3 distinct missed slots (correction excluded)', 'coach',
       (select level::text from public.medication_adherence_alerts
          where medication_id = (select v from ids where k='med')
          order by created_at desc limit 1);

------------------------------------------------------------------
-- A correction to one of the three missed slots must true up the open
-- alert's missed_count (a clinician should never see a stale, inflated
-- number), but must NOT downgrade its level -- an alert that once escalated
-- stays visible for review even if the raw count later drops; only a
-- clinician resolving it clears it.
------------------------------------------------------------------
insert into public.medication_logs
  (organisation_id, patient_id, medication_id, scheduled_time, scheduled_for_date, status, logged_at)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='mum'),
   (select v from ids where k='med'), '09:00', current_date - 1, 'taken', now());

insert into results
select 'a correction reconciles missed_count down on the open alert', '2',
       (select missed_count::text from public.medication_adherence_alerts
          where medication_id = (select v from ids where k='med')
          order by created_at desc limit 1);

insert into results
select 'the alert level does not downgrade when the count drops', 'coach',
       (select level::text from public.medication_adherence_alerts
          where medication_id = (select v from ids where k='med')
          order by created_at desc limit 1);

select check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results;

rollback;
