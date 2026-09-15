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


-- --------------------------------------------------------------------------
-- Fixtures. Every party below is MINTED here rather than selected out of the
-- @tarragon.test QA accounts this file used to borrow. Those accounts exist
-- only on the populated project: on a fresh `supabase db reset` the lookups
-- returned nothing, `ids` came back empty, and every check below ran against
-- NULL and reported a confident pass. On the populated project they carry
-- months of accumulated rows of their own, which is the other half of the
-- problem -- an assertion phrased as "no row like this exists" can be failed
-- by somebody else's data rather than by the code under test.
--
-- Each key gets its own distinct account: sharing one profile between two
-- roles in a script like this makes a later count fold in an earlier,
-- legitimate action and reads exactly like the behaviour under test breaking.
-- --------------------------------------------------------------------------
do $$
declare
  r     record;
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_id  uuid;
begin
  -- The direct-consumer org is seeded by migration 20260706084837, and is the
  -- same org id this file's own INSERTs name further down.
  if not exists (select 1 from public.organisations where id = v_org) then
    insert into public.organisations (id, name, type)
    values (v_org, 'Med-Log Append-Only Test Org', 'direct_consumer');
  end if;
  insert into ids(k, v) values ('org', v_org);

  for r in select * from (values
      ('mum', 'patient')
    ) as t(key_name, role_name)
  loop
    v_id := gen_random_uuid();
    insert into ids(k, v) values (r.key_name, v_id);

    insert into auth.users (id, email)
    values (v_id, format('medlogappend-%s@example.invalid', r.key_name));

    insert into public.profiles (id, organisation_id, role, full_name)
    values (v_id, v_org, r.role_name::public.user_role,
            format('Med-Log Append-Only %s', r.key_name))
    on conflict (id) do update
      set organisation_id = excluded.organisation_id,
          role            = excluded.role,
          full_name       = excluded.full_name;
  end loop;
end $$;

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
