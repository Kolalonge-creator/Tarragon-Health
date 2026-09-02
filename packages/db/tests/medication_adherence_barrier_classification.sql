-- Proves 20260829142000_medication_adherence_barrier_classification.sql.
--
-- Each missed dose is its OWN insert statement, deliberately not batched
-- into one multi-row INSERT: AFTER ROW triggers on a multi-row statement are
-- all queued and only fire once every row in that statement has already been
-- written, so a batched insert would let row 1's trigger see rows 2 and 3
-- too and jump straight to a 3-missed-dose count instead of building up
-- sequentially. One statement per dose also matches how the app actually
-- logs a dose — each tap is its own insert, never a batch.
--
-- medication_adherence_alerts is staff-only readable (see
-- 20260716175000_medication_adherence_escalation.sql — patient sessions get
-- no select policy at all), so every assertion against it below runs after
-- `reset role` back to the connection's own (RLS-bypassing) privilege, never
-- while still impersonating the patient. Getting this wrong doesn't fail
-- loudly — an `insert into results select ... from medication_adherence_alerts`
-- run as the patient would just silently insert zero rows into `results`
-- (RLS filters the source to nothing), so the check would vanish from the
-- output instead of failing. That's exactly the vacuous-pass failure mode
-- medication_logs_acting_for.sql's own note warns about, so it's worth
-- spelling out here too.
--
-- What's checked, in order:
--   1. Two reasoned-but-below-threshold misses raise no alert.
--   2. A third miss crosses the count-based coach threshold (>=3); the alert
--      it raises carries the right missed_count AND the right reason
--      breakdown/primary (frequency-ranked, cost 2 vs forgetfulness 1).
--   3. A fourth miss, reasoned side_effects, arrives while the alert is
--      already coach-level on count alone (4 < 6, so the count ladder by
--      itself would stay at coach) — this is the sabotage-relevant check:
--      a version of the trigger that only applied the side_effects fast
--      path on a *fresh* alert (an earlier draft of this migration, before
--      it was corrected to check missed_reason independently of the count
--      branches) would leave this alert sitting at coach and pass every
--      other assertion here. The reason breakdown must also pick up the new
--      side_effects entry.
--
--   npx supabase db query --linked -f packages/db/tests/medication_adherence_barrier_classification.sql

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on results to authenticated;
grant all on ids to authenticated;

insert into ids
select 'patient', id from public.profiles
 where id in (select id from auth.users where email = 'patient.complete.test@tarragon.test');

with inserted as (
  insert into public.medications
    (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, is_active)
  values
    ('00000000-0000-0000-0000-000000000001', (select v from ids where k='patient'),
     'Test Losartan', '50mg', 'once daily', '["08:00"]'::jsonb, true)
  returning id
)
insert into ids select 'med', id from inserted;

------------------------------------------------------------------
-- Misses 1 and 2, logged as the patient: below the count threshold, no
-- side effect reported.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient'), 'role','authenticated')::text, true);
set local role authenticated;

insert into public.medication_logs
  (organisation_id, patient_id, medication_id, status, missed_reason, logged_at)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='patient'),
   (select v from ids where k='med'), 'missed', 'cost', now() - interval '6 days');

insert into public.medication_logs
  (organisation_id, patient_id, medication_id, status, missed_reason, logged_at)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='patient'),
   (select v from ids where k='med'), 'missed', 'forgetfulness', now() - interval '5 days');

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'below the count threshold, no side effect: no alert raised', 'false',
       exists(
         select 1 from public.medication_adherence_alerts
          where medication_id = (select v from ids where k='med')
       )::text;

------------------------------------------------------------------
-- Miss 3, as the patient again: crosses the coach threshold (missed_count = 3).
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient'), 'role','authenticated')::text, true);
set local role authenticated;

insert into public.medication_logs
  (organisation_id, patient_id, medication_id, status, missed_reason, logged_at)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='patient'),
   (select v from ids where k='med'), 'missed', 'cost', now() - interval '4 days');

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'crossing the count threshold raises a coach-level alert', 'coach', level::text
  from public.medication_adherence_alerts
 where medication_id = (select v from ids where k='med');

insert into results
select 'missed_count reflects all 3 misses so far', '3', missed_count::text
  from public.medication_adherence_alerts
 where medication_id = (select v from ids where k='med');

insert into results
select 'primary_reason is the most frequent barrier (cost, 2 of 3)', 'cost', primary_reason::text
  from public.medication_adherence_alerts
 where medication_id = (select v from ids where k='med');

insert into results
select 'reason_breakdown counts every reasoned miss so far', 'true',
       (reason_breakdown = jsonb_build_object('cost', 2, 'forgetfulness', 1))::text
  from public.medication_adherence_alerts
 where medication_id = (select v from ids where k='med');

------------------------------------------------------------------
-- Miss 4, as the patient again, side_effects — arrives while the alert is
-- already coach-level on count alone (4 missed doses is still under the
-- count-based doctor threshold of 6) — the fast path must override it anyway.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient'), 'role','authenticated')::text, true);
set local role authenticated;

insert into public.medication_logs
  (organisation_id, patient_id, medication_id, status, missed_reason, logged_at)
values
  ('00000000-0000-0000-0000-000000000001', (select v from ids where k='patient'),
   (select v from ids where k='med'), 'missed', 'side_effects', now());

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'a side_effects miss escalates an existing coach alert to doctor, even under the count-based doctor threshold',
       'doctor', level::text
  from public.medication_adherence_alerts
 where medication_id = (select v from ids where k='med');

insert into results
select 'missed_count now reflects all 4 misses', '4', missed_count::text
  from public.medication_adherence_alerts
 where medication_id = (select v from ids where k='med');

insert into results
select 'reason_breakdown picks up the new side_effects entry alongside the earlier ones', 'true',
       (reason_breakdown = jsonb_build_object('cost', 2, 'forgetfulness', 1, 'side_effects', 1))::text
  from public.medication_adherence_alerts
 where medication_id = (select v from ids where k='med');

insert into results
select 'still exactly one alert row for this medication (upgraded in place, not duplicated)', '1',
       (select count(*) from public.medication_adherence_alerts
         where medication_id = (select v from ids where k='med'))::text;

select check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results;

rollback;
