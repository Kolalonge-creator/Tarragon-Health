-- S08z proof: dose times anchored to daily events (migration 20261021011847_s08z_dose_time_anchors.sql).
--
-- Proves in one rolled-back transaction:
--   1. The shared resolution cases (packages/medicines anchors.fixtures.ts, carried here BY NAME; a Jest test fails if a name goes missing):
--      an anchor with and without a patient time, offsets before and after, a shift that moves an anchor on its dates only and then
--      returns to normal, the newest of two shifts, a dose that crosses midnight forward and backward, shifts carrying an anchor across
--      midnight, every-N-days and weekday schedules, start and end dates, a time change that applies from its own date only, and a
--      shift ended early that leaves the days already lived untouched.
--   2. The schedule validator accepts and refuses the anchored forms exactly as parseScheduleSpec does without a profile, and the
--      column constraint refuses a bad one.
--   3. The server missed-dose job, the weekly adherence figure and the refill estimate all read the RESOLVED time: a missed row is
--      written at the patient's anchor time and never at the default; an anchor change leaves the days already lived alone (no false
--      missed rows for doses logged at the old time); anchored doses count in adherence; an anchored schedule has the same run-out
--      date as the same times written as clock times. The four expansions pass the patient (checked on the live function text).
--   4. The three RPCs: effective dates (never in the past; tomorrow when today already has answers on that anchor), idempotent shift
--      creation, a shift never reaching into the past, ending a shift keeps earlier days shifted; a stranger sees and writes nothing,
--      the owner can, a patient cannot write the tables directly, anon cannot execute anything.
--   5. A flexible window cannot be left overlapping: a medicine with anchored doses closer than its window, and an anchor time that
--      would put an existing medicine's doses closer than its window, are both refused; the control is accepted.
--   6. SABOTAGE: with the date rule dropped from the anchor time, the shift removed, and the "today has answers" rule removed, the
--      matching checks must each FAIL (a vacuous test raises).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create or replace function pg_temp.mkpatient(p_org uuid, p_label text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's08z-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth)
  values (v, p_org, 'patient', 'S08z ' || p_label, (current_date - interval '45 years')::date)
  on conflict (id) do nothing;
  return v;
end $f$;

-- The proposed defaults are placeholders; the shared cases use their own test values, so set those for this transaction only.

update public.dose_anchor_defaults set default_time = '06:30' where anchor = 'waking';
update public.dose_anchor_defaults set default_time = '05:45' where anchor = 'morning_prayer';
update public.dose_anchor_defaults set default_time = '07:30' where anchor = 'breakfast';
update public.dose_anchor_defaults set default_time = '13:15' where anchor = 'midday_prayer';
update public.dose_anchor_defaults set default_time = '13:00' where anchor = 'lunch';
update public.dose_anchor_defaults set default_time = '16:30' where anchor = 'afternoon_prayer';
update public.dose_anchor_defaults set default_time = '19:15' where anchor = 'evening_prayer';
update public.dose_anchor_defaults set default_time = '19:30' where anchor = 'dinner';
update public.dose_anchor_defaults set default_time = '20:45' where anchor = 'night_prayer';
update public.dose_anchor_defaults set default_time = '22:30' where anchor = 'bedtime';

-- 1. The shared resolution cases ------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid; v_p uuid; v_got text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'S08z proof needs one organisation (seed fixture missing)'; end if;

  -- case 1
  v_p := pg_temp.mkpatient(v_org, 'c1');
  v_got := '';
  v_got := v_got || '2026-10-05=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "breakfast", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-05', v_p)), '') || ';';
  insert into results values ('real', $n$with breakfast, the patient never set it: the proposed default$n$, '2026-10-05=07:30;', v_got);
  -- case 2
  v_p := pg_temp.mkpatient(v_org, 'c2');
  insert into public.patient_dose_anchors (patient_id, anchor, effective_from, local_time, organisation_id) values (v_p, 'breakfast', date '2000-01-01', '08:15', v_org);
  v_got := '';
  v_got := v_got || '2026-10-05=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "breakfast", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-05', v_p)), '') || ';';
  insert into results values ('real', $n$with breakfast at the time the patient chose$n$, '2026-10-05=08:15;', v_got);
  -- case 3
  v_p := pg_temp.mkpatient(v_org, 'c3');
  insert into public.patient_dose_anchors (patient_id, anchor, effective_from, local_time, organisation_id) values (v_p, 'morning_prayer', date '2000-01-01', '05:20', v_org);
  v_got := '';
  v_got := v_got || '2026-10-05=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "morning_prayer", "offsetMinutes": 30}, {"anchor": "dinner", "offsetMinutes": -30}]}$s$::jsonb, null, date '2026-10-05', v_p)), '') || ';';
  insert into results values ('real', $n$thirty minutes after the morning prayer, and thirty before dinner$n$, '2026-10-05=05:50,19:00;', v_got);
  -- case 4
  v_p := pg_temp.mkpatient(v_org, 'c4');
  v_got := '';
  v_got := v_got || '2026-10-05=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": ["07:30", "21:00"], "anchored": [{"anchor": "breakfast", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-05', v_p)), '') || ';';
  insert into results values ('real', $n$a fixed clock time beside an anchored one, and a duplicate time is one dose$n$, '2026-10-05=07:30,21:00;', v_got);
  -- case 5
  v_p := pg_temp.mkpatient(v_org, 'c5');
  insert into public.patient_day_shifts (patient_id, organisation_id, starts_on, ends_on, offsets, cancelled_from, created_at) values (v_p, v_org, date '2026-10-05', date '2026-10-07', '{"dinner": 90}'::jsonb, null, now() + interval '0 seconds');
  v_got := '';
  v_got := v_got || '2026-10-04=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "dinner", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-04', v_p)), '') || ';';
  v_got := v_got || '2026-10-05=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "dinner", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-05', v_p)), '') || ';';
  v_got := v_got || '2026-10-07=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "dinner", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-07', v_p)), '') || ';';
  v_got := v_got || '2026-10-08=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "dinner", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-08', v_p)), '') || ';';
  insert into results values ('real', $n$a day shift moves the anchor on its dates only, then returns to normal$n$, '2026-10-04=19:30;2026-10-05=21:00;2026-10-07=21:00;2026-10-08=19:30;', v_got);
  -- case 6
  v_p := pg_temp.mkpatient(v_org, 'c6');
  insert into public.patient_day_shifts (patient_id, organisation_id, starts_on, ends_on, offsets, cancelled_from, created_at) values (v_p, v_org, date '2026-10-05', date '2026-10-06', '{"breakfast": -120}'::jsonb, null, now() + interval '0 seconds');
  v_got := '';
  v_got := v_got || '2026-10-05=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "breakfast", "offsetMinutes": 0}, {"anchor": "dinner", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-05', v_p)), '') || ';';
  insert into results values ('real', $n$a shift moves only the anchors it names$n$, '2026-10-05=05:30,19:30;', v_got);
  -- case 7
  v_p := pg_temp.mkpatient(v_org, 'c7');
  insert into public.patient_day_shifts (patient_id, organisation_id, starts_on, ends_on, offsets, cancelled_from, created_at) values (v_p, v_org, date '2026-10-05', date '2026-10-09', '{"dinner": 60}'::jsonb, null, now() + interval '0 seconds');
  insert into public.patient_day_shifts (patient_id, organisation_id, starts_on, ends_on, offsets, cancelled_from, created_at) values (v_p, v_org, date '2026-10-06', date '2026-10-07', '{"dinner": -30}'::jsonb, null, now() + interval '1 seconds');
  v_got := '';
  v_got := v_got || '2026-10-05=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "dinner", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-05', v_p)), '') || ';';
  v_got := v_got || '2026-10-06=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "dinner", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-06', v_p)), '') || ';';
  v_got := v_got || '2026-10-08=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "dinner", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-08', v_p)), '') || ';';
  insert into results values ('real', $n$when two shifts cover a date the one listed last (the newest) applies$n$, '2026-10-05=20:30;2026-10-06=19:00;2026-10-08=20:30;', v_got);
  -- case 8
  v_p := pg_temp.mkpatient(v_org, 'c8');
  insert into public.patient_dose_anchors (patient_id, anchor, effective_from, local_time, organisation_id) values (v_p, 'bedtime', date '2000-01-01', '23:30', v_org);
  v_got := '';
  v_got := v_got || '2026-10-05=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "bedtime", "offsetMinutes": 60}]}$s$::jsonb, null, date '2026-10-05', v_p)), '') || ';';
  v_got := v_got || '2026-10-06=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "bedtime", "offsetMinutes": 60}]}$s$::jsonb, null, date '2026-10-06', v_p)), '') || ';';
  insert into results values ('real', $n$an hour after a 23:30 bedtime is 00:30 on the NEXT date, not 23:59 on the same one$n$, '2026-10-05=00:30;2026-10-06=00:30;', v_got);
  -- case 9
  v_p := pg_temp.mkpatient(v_org, 'c9');
  insert into public.patient_dose_anchors (patient_id, anchor, effective_from, local_time, organisation_id) values (v_p, 'waking', date '2000-01-01', '00:10', v_org);
  v_got := '';
  v_got := v_got || '2026-10-05=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "waking", "offsetMinutes": -30}]}$s$::jsonb, null, date '2026-10-05', v_p)), '') || ';';
  insert into results values ('real', $n$half an hour before a 00:10 waking is 23:40 on the PREVIOUS date$n$, '2026-10-05=23:40;', v_got);
  -- case 10
  v_p := pg_temp.mkpatient(v_org, 'c10');
  insert into public.patient_dose_anchors (patient_id, anchor, effective_from, local_time, organisation_id) values (v_p, 'bedtime', date '2000-01-01', '23:30', v_org);
  insert into public.patient_day_shifts (patient_id, organisation_id, starts_on, ends_on, offsets, cancelled_from, created_at) values (v_p, v_org, date '2026-10-05', date '2026-10-05', '{"bedtime": 45}'::jsonb, null, now() + interval '0 seconds');
  v_got := '';
  v_got := v_got || '2026-10-04=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "bedtime", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-04', v_p)), '') || ';';
  v_got := v_got || '2026-10-05=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "bedtime", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-05', v_p)), '') || ';';
  v_got := v_got || '2026-10-06=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "bedtime", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-06', v_p)), '') || ';';
  insert into results values ('real', $n$a shift can carry an anchor across midnight, and the day the dose belongs to decides the shift$n$, '2026-10-04=23:30;2026-10-05=;2026-10-06=00:15,23:30;', v_got);
  -- case 11
  v_p := pg_temp.mkpatient(v_org, 'c11');
  insert into public.patient_dose_anchors (patient_id, anchor, effective_from, local_time, organisation_id) values (v_p, 'bedtime', date '2000-01-01', '23:00', v_org);
  v_got := '';
  v_got := v_got || '2026-10-01=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "every_n_days", "intervalDays": 3, "anchorDate": "2026-10-01", "times": [], "anchored": [{"anchor": "bedtime", "offsetMinutes": 90}]}$s$::jsonb, null, date '2026-10-01', v_p)), '') || ';';
  v_got := v_got || '2026-10-02=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "every_n_days", "intervalDays": 3, "anchorDate": "2026-10-01", "times": [], "anchored": [{"anchor": "bedtime", "offsetMinutes": 90}]}$s$::jsonb, null, date '2026-10-02', v_p)), '') || ';';
  v_got := v_got || '2026-10-03=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "every_n_days", "intervalDays": 3, "anchorDate": "2026-10-01", "times": [], "anchored": [{"anchor": "bedtime", "offsetMinutes": 90}]}$s$::jsonb, null, date '2026-10-03', v_p)), '') || ';';
  v_got := v_got || '2026-10-04=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "every_n_days", "intervalDays": 3, "anchorDate": "2026-10-01", "times": [], "anchored": [{"anchor": "bedtime", "offsetMinutes": 90}]}$s$::jsonb, null, date '2026-10-04', v_p)), '') || ';';
  v_got := v_got || '2026-10-05=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "every_n_days", "intervalDays": 3, "anchorDate": "2026-10-01", "times": [], "anchored": [{"anchor": "bedtime", "offsetMinutes": 90}]}$s$::jsonb, null, date '2026-10-05', v_p)), '') || ';';
  insert into results values ('real', $n$every third day: only the occurrence days, and one that crosses midnight lands on the next date$n$, '2026-10-01=;2026-10-02=00:30;2026-10-03=;2026-10-04=;2026-10-05=00:30;', v_got);
  -- case 12
  v_p := pg_temp.mkpatient(v_org, 'c12');
  insert into public.patient_dose_anchors (patient_id, anchor, effective_from, local_time, organisation_id) values (v_p, 'night_prayer', date '2000-01-01', '22:00', v_org);
  v_got := '';
  v_got := v_got || '2026-10-05=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "weekdays", "days": [1], "times": [], "anchored": [{"anchor": "night_prayer", "offsetMinutes": 180}]}$s$::jsonb, null, date '2026-10-05', v_p)), '') || ';';
  v_got := v_got || '2026-10-06=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "weekdays", "days": [1], "times": [], "anchored": [{"anchor": "night_prayer", "offsetMinutes": 180}]}$s$::jsonb, null, date '2026-10-06', v_p)), '') || ';';
  v_got := v_got || '2026-10-07=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "weekdays", "days": [1], "times": [], "anchored": [{"anchor": "night_prayer", "offsetMinutes": 180}]}$s$::jsonb, null, date '2026-10-07', v_p)), '') || ';';
  insert into results values ('real', $n$certain weekdays: an anchored dose on a Monday that crosses midnight lands on Tuesday$n$, '2026-10-05=;2026-10-06=01:00;2026-10-07=;', v_got);
  -- case 13
  v_p := pg_temp.mkpatient(v_org, 'c13');
  insert into public.patient_dose_anchors (patient_id, anchor, effective_from, local_time, organisation_id) values (v_p, 'bedtime', date '2000-01-01', '23:30', v_org);
  v_got := '';
  v_got := v_got || '2026-10-05=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "endDate": "2026-10-05", "anchored": [{"anchor": "bedtime", "offsetMinutes": 60}]}$s$::jsonb, null, date '2026-10-05', v_p)), '') || ';';
  v_got := v_got || '2026-10-06=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "endDate": "2026-10-05", "anchored": [{"anchor": "bedtime", "offsetMinutes": 60}]}$s$::jsonb, null, date '2026-10-06', v_p)), '') || ';';
  v_got := v_got || '2026-10-07=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "endDate": "2026-10-05", "anchored": [{"anchor": "bedtime", "offsetMinutes": 60}]}$s$::jsonb, null, date '2026-10-07', v_p)), '') || ';';
  insert into results values ('real', $n$the end date is the last schedule day: its dose that crosses midnight still lands, the next one does not$n$, '2026-10-05=00:30;2026-10-06=00:30;2026-10-07=;', v_got);
  -- case 14
  v_p := pg_temp.mkpatient(v_org, 'c14');
  insert into public.patient_dose_anchors (patient_id, anchor, effective_from, local_time, organisation_id) values (v_p, 'bedtime', date '2000-01-01', '23:30', v_org);
  v_got := '';
  v_got := v_got || '2026-10-05=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "startDate": "2026-10-05", "anchored": [{"anchor": "bedtime", "offsetMinutes": 60}]}$s$::jsonb, null, date '2026-10-05', v_p)), '') || ';';
  v_got := v_got || '2026-10-06=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "startDate": "2026-10-05", "anchored": [{"anchor": "bedtime", "offsetMinutes": 60}]}$s$::jsonb, null, date '2026-10-06', v_p)), '') || ';';
  insert into results values ('real', $n$the start date: nothing resolves from a schedule day before it$n$, '2026-10-05=;2026-10-06=00:30;', v_got);
  -- case 15
  v_p := pg_temp.mkpatient(v_org, 'c15');
  insert into public.patient_dose_anchors (patient_id, anchor, effective_from, local_time, organisation_id) values (v_p, 'breakfast', date '2026-09-01', '07:00', v_org);
  insert into public.patient_dose_anchors (patient_id, anchor, effective_from, local_time, organisation_id) values (v_p, 'breakfast', date '2026-10-06', '08:30', v_org);
  v_got := '';
  v_got := v_got || '2026-09-15=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "breakfast", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-09-15', v_p)), '') || ';';
  v_got := v_got || '2026-10-05=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "breakfast", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-05', v_p)), '') || ';';
  v_got := v_got || '2026-10-06=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "breakfast", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-06', v_p)), '') || ';';
  v_got := v_got || '2026-10-20=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "breakfast", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-20', v_p)), '') || ';';
  insert into results values ('real', $n$a changed anchor time applies from its own date: earlier days keep the old time$n$, '2026-09-15=07:00;2026-10-05=07:00;2026-10-06=08:30;2026-10-20=08:30;', v_got);
  -- case 16
  v_p := pg_temp.mkpatient(v_org, 'c16');
  insert into public.patient_dose_anchors (patient_id, anchor, effective_from, local_time, organisation_id) values (v_p, 'lunch', date '2026-10-06', '12:00', v_org);
  v_got := '';
  v_got := v_got || '2026-10-05=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "lunch", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-05', v_p)), '') || ';';
  v_got := v_got || '2026-10-06=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "lunch", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-06', v_p)), '') || ';';
  insert into results values ('real', $n$before the patient's first chosen time takes effect the proposed default applies$n$, '2026-10-05=13:00;2026-10-06=12:00;', v_got);
  -- case 17
  v_p := pg_temp.mkpatient(v_org, 'c17');
  insert into public.patient_day_shifts (patient_id, organisation_id, starts_on, ends_on, offsets, cancelled_from, created_at) values (v_p, v_org, date '2026-10-05', date '2026-10-10', '{"dinner": 60}'::jsonb, date '2026-10-07', now() + interval '0 seconds');
  v_got := '';
  v_got := v_got || '2026-10-05=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "dinner", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-05', v_p)), '') || ';';
  v_got := v_got || '2026-10-06=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "dinner", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-06', v_p)), '') || ';';
  v_got := v_got || '2026-10-07=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "dinner", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-07', v_p)), '') || ';';
  v_got := v_got || '2026-10-09=' || coalesce((select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on($s${"kind": "daily", "times": [], "anchored": [{"anchor": "dinner", "offsetMinutes": 0}]}$s$::jsonb, null, date '2026-10-09', v_p)), '') || ';';
  insert into results values ('real', $n$ending a shift early leaves the days already lived as they were$n$, '2026-10-05=20:30;2026-10-06=20:30;2026-10-07=19:30;2026-10-09=19:30;', v_got);
end
$$;

-- 2. The validator, rule by rule (the same cases as parseScheduleSpec without a profile) -----------------------------------
do $$
declare
  c record; v_org uuid; v_p uuid; v_err text; v_n integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  for c in
    select * from (values
      ('anchored only, daily', '{"kind":"daily","anchored":[{"anchor":"dinner","offsetMinutes":-30}]}', true),
      ('anchored only with empty times', '{"kind":"daily","times":[],"anchored":[{"anchor":"dinner","offsetMinutes":0}]}', true),
      ('no times and no anchors', '{"kind":"daily","times":[]}', false),
      ('no times key and no anchors', '{"kind":"daily"}', false),
      ('unknown anchor', '{"kind":"daily","anchored":[{"anchor":"brunch","offsetMinutes":0}]}', false),
      ('offset 180 is the most after', '{"kind":"daily","anchored":[{"anchor":"bedtime","offsetMinutes":180}]}', true),
      ('offset -120 is the most before', '{"kind":"daily","anchored":[{"anchor":"waking","offsetMinutes":-120}]}', true),
      ('offset 181', '{"kind":"daily","anchored":[{"anchor":"bedtime","offsetMinutes":181}]}', false),
      ('offset -121', '{"kind":"daily","anchored":[{"anchor":"waking","offsetMinutes":-121}]}', false),
      ('offset not whole', '{"kind":"daily","anchored":[{"anchor":"waking","offsetMinutes":1.5}]}', false),
      ('offset a string', '{"kind":"daily","anchored":[{"anchor":"waking","offsetMinutes":"30"}]}', false),
      ('anchored on as_needed', '{"kind":"as_needed","anchored":[{"anchor":"dinner","offsetMinutes":0}]}', false),
      ('anchored on a taper', '{"kind":"taper","startDate":"2026-10-01","steps":[{"days":3,"times":["08:00"],"doseText":"one"}],"anchored":[{"anchor":"dinner","offsetMinutes":0}]}', false),
      ('the same anchor and offset twice', '{"kind":"daily","anchored":[{"anchor":"lunch","offsetMinutes":0},{"anchor":"lunch","offsetMinutes":0}]}', false),
      ('the same anchor at two offsets', '{"kind":"daily","anchored":[{"anchor":"lunch","offsetMinutes":0},{"anchor":"lunch","offsetMinutes":30}]}', true),
      ('anchored is not a list', '{"kind":"daily","times":["08:00"],"anchored":"dinner"}', false),
      ('anchored is null beside clock times', '{"kind":"daily","times":["08:00"],"anchored":null}', true),
      ('anchored entry is not an object', '{"kind":"daily","anchored":[null]}', false),
      ('every N days, anchored', '{"kind":"every_n_days","intervalDays":3,"anchorDate":"2026-10-01","anchored":[{"anchor":"dinner","offsetMinutes":0}]}', true),
      ('weekdays, anchored', '{"kind":"weekdays","days":[1],"anchored":[{"anchor":"dinner","offsetMinutes":0}]}', true),
      ('clock times and anchored doses together: 12', '{"kind":"daily","times":["01:00","02:00","03:00","04:00","05:00","06:00","07:00","08:00","09:00","10:00","11:00"],"anchored":[{"anchor":"dinner","offsetMinutes":0}]}', true),
      ('clock times and anchored doses together: 13', '{"kind":"daily","times":["01:00","02:00","03:00","04:00","05:00","06:00","07:00","08:00","09:00","10:00","11:00"],"anchored":[{"anchor":"dinner","offsetMinutes":0},{"anchor":"lunch","offsetMinutes":0}]}', false),
      ('a window beside overlapping clock times is still refused', '{"kind":"daily","times":["08:00","08:20"],"windowMinutes":30}', false),
      ('a window with anchored doses only passes the profile-free check', '{"kind":"daily","windowMinutes":90,"anchored":[{"anchor":"waking","offsetMinutes":0},{"anchor":"breakfast","offsetMinutes":0}]}', true)
    ) as t(name, spec, ok)
  loop
    insert into results values ('real', 'validator: ' || c.name, c.ok::text, private.is_valid_schedule_spec(c.spec::jsonb)::text);
  end loop;

  -- The column constraint refuses a bad one and accepts a good one.
  v_p := pg_temp.mkpatient(v_org, 'val');
  begin
    insert into public.medications (organisation_id, patient_id, drug_name, schedule_times, schedule_spec, source, is_active)
    values (v_org, v_p, 'S08z bad', '[]', '{"kind":"daily","anchored":[{"anchor":"brunch","offsetMinutes":0}]}', 'patient', true);
    v_err := 'accepted';
  exception when check_violation then v_err := 'refused'; end;
  insert into results values ('real', 'the column constraint refuses an unknown anchor', 'refused', v_err);
  begin
    insert into public.medications (organisation_id, patient_id, drug_name, schedule_times, schedule_spec, source, is_active)
    values (v_org, v_p, 'S08z good', '["07:30"]', '{"kind":"daily","anchored":[{"anchor":"breakfast","offsetMinutes":0}]}', 'patient', true);
    v_err := 'accepted';
  exception when others then v_err := 'refused'; end;
  insert into results values ('real', 'the column constraint accepts an anchored schedule', 'accepted', v_err);

  -- No overload ambiguity: the 3-argument form still resolves with bare literals, and agrees with the 4-argument form with no patient.
  insert into results values ('real', 'the 3-argument form still works and uses the defaults', '07:30',
    (select string_agg(slot_time, ',') from private.medication_slots_on('{"kind":"daily","anchored":[{"anchor":"breakfast","offsetMinutes":0}]}', null, date '2026-10-05')));
  insert into results values ('real', 'the 4-argument form with a null patient agrees', '07:30',
    (select string_agg(slot_time, ',') from private.medication_slots_on('{"kind":"daily","anchored":[{"anchor":"breakfast","offsetMinutes":0}]}', null, date '2026-10-05', null)));
end
$$;

-- 3. The four expansions read the resolved time ------------------------------------------------------------------------------
-- The server missed-dose job and the drift scenario live in functions so the sabotage section can run them again.
create or replace function pg_temp.drift_missed_count() returns integer language plpgsql as $f$
declare
  v_org uuid; v_p uuid; v_med uuid; d date;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_p := pg_temp.mkpatient(v_org, 'drift');
  -- Breakfast was 07:00 for a long time and became 09:00 from yesterday. Days before that keep 07:00.
  insert into public.patient_dose_anchors (patient_id, anchor, effective_from, local_time, organisation_id) values
    (v_p, 'breakfast', date '2000-01-01', '07:00', v_org), (v_p, 'breakfast', v_today - 1, '09:00', v_org);
  insert into public.medications (organisation_id, patient_id, drug_name, schedule_times, schedule_spec, source, is_active, created_at)
    values (v_org, v_p, 'S08z drift', '["07:00"]', '{"kind":"daily","anchored":[{"anchor":"breakfast","offsetMinutes":0}]}', 'patient', true, now() - interval '6 days')
    returning id into v_med;
  -- The patient took each day's dose at the time it was on that day.
  for d in select (v_today - g)::date from generate_series(4, 2, -1) g loop
    insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_time, scheduled_for_date, source, client_id)
    values (v_org, v_p, v_med, 'taken', '07:00', d, 'patient', gen_random_uuid());
  end loop;
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_time, scheduled_for_date, source, client_id)
  values (v_org, v_p, v_med, 'taken', '09:00', v_today - 1, 'patient', gen_random_uuid());
  perform private.mark_overdue_doses_missed();
  -- Days already lived must produce no server "missed" row (today is left out: whether today's slot is overdue depends on the hour).
  return (select count(*)::integer from public.medication_logs where medication_id = v_med and source = 'system' and scheduled_for_date < v_today);
end $f$;

create or replace function pg_temp.shift_case() returns text language plpgsql as $f$
declare v_org uuid; v_p uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_p := pg_temp.mkpatient(v_org, 'shiftcase');
  insert into public.patient_day_shifts (patient_id, organisation_id, starts_on, ends_on, offsets)
    values (v_p, v_org, date '2026-10-05', date '2026-10-07', '{"dinner":90}');
  return coalesce((select string_agg(slot_time, ',') from private.medication_slots_on('{"kind":"daily","anchored":[{"anchor":"dinner","offsetMinutes":0}]}', null, date '2026-10-06', v_p)), '');
end $f$;

-- Sets the caller for auth.uid() without switching role (the RPCs are security definer and check auth.uid()).
create or replace function pg_temp.as_user(p_user uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $f$;

create or replace function pg_temp.effective_with_answers() returns text language plpgsql as $f$
declare
  v_org uuid; v_p uuid; v_med uuid; v_eff date;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_p := pg_temp.mkpatient(v_org, 'effans');
  insert into public.medications (organisation_id, patient_id, drug_name, schedule_times, schedule_spec, source, is_active, created_at)
    values (v_org, v_p, 'S08z answered', '["08:45"]', '{"kind":"daily","anchored":[{"anchor":"breakfast","offsetMinutes":0}]}', 'patient', true, now() - interval '3 days')
    returning id into v_med;
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_time, scheduled_for_date, source, client_id)
    values (v_org, v_p, v_med, 'taken', '07:30', v_today, 'patient', gen_random_uuid());
  perform pg_temp.as_user(v_p);
  v_eff := public.save_dose_anchor_times(v_p, '{"breakfast":"09:00"}'::jsonb);
  return (v_eff - v_today)::text;
end $f$;

do $$
declare
  v_org uuid; v_p uuid; v_med uuid; v_med2 uuid; v_adh jsonb; v_n integer; v_n2 integer; d date;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_run1 date; v_run2 date; v_def text; fn text;
begin
  select id into v_org from public.organisations order by created_at limit 1;

  -- 3a. The missed job writes the RESOLVED time, never the default.
  v_p := pg_temp.mkpatient(v_org, 'missed');
  insert into public.patient_dose_anchors (patient_id, anchor, effective_from, local_time, organisation_id) values (v_p, 'breakfast', date '2000-01-01', '08:15', v_org);
  insert into public.medications (organisation_id, patient_id, drug_name, schedule_times, schedule_spec, source, is_active, created_at)
    values (v_org, v_p, 'S08z anchored', '["07:30"]', '{"kind":"daily","anchored":[{"anchor":"breakfast","offsetMinutes":0}]}', 'patient', true, now() - interval '5 days')
    returning id into v_med;
  perform private.mark_overdue_doses_missed();
  select count(*) into v_n from public.medication_logs where medication_id = v_med and source = 'system' and status = 'missed' and scheduled_time = '08:15';
  select count(*) into v_n2 from public.medication_logs where medication_id = v_med and source = 'system' and scheduled_time <> '08:15';
  insert into results values ('real', 'the missed job marks overdue anchored doses at the patient''s anchor time', 'true', (v_n >= 2)::text);
  insert into results values ('real', 'the missed job never writes the default time for an anchored dose', '0', v_n2::text);

  -- 3b. An anchor change leaves days already lived alone (no false missed rows).
  insert into results values ('real', 'a changed anchor time writes no false missed row for doses logged at the old time', '0', pg_temp.drift_missed_count()::text);

  -- 3c. Anchored doses count in the weekly adherence figure at their resolved times.
  v_p := pg_temp.mkpatient(v_org, 'adh');
  insert into public.patient_dose_anchors (patient_id, anchor, effective_from, local_time, organisation_id) values (v_p, 'waking', date '2000-01-01', '00:05', v_org);
  insert into public.medications (organisation_id, patient_id, drug_name, schedule_times, schedule_spec, source, is_active, created_at)
    values (v_org, v_p, 'S08z adh', '["00:05"]', '{"kind":"daily","anchored":[{"anchor":"waking","offsetMinutes":0}]}', 'patient', true, now() - interval '10 days')
    returning id into v_med;
  for d in select (v_today - g)::date from generate_series(0, 6) g loop
    insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_time, scheduled_for_date, source, client_id)
    values (v_org, v_p, v_med, 'taken', '00:05', d, 'patient', gen_random_uuid());
  end loop;
  v_adh := private.weekly_adherence(v_p);
  insert into results values ('real', 'weekly adherence counts doses logged at the resolved anchor time', '100', coalesce(v_adh ->> 'percent', 'null'));

  -- 3d. The refill estimate: anchors that resolve to 08:00 and 20:00 run out on the same day as those clock times.
  v_p := pg_temp.mkpatient(v_org, 'supply');
  insert into public.patient_dose_anchors (patient_id, anchor, effective_from, local_time, organisation_id) values
    (v_p, 'breakfast', date '2000-01-01', '08:00', v_org), (v_p, 'dinner', date '2000-01-01', '20:00', v_org);
  insert into public.medications (organisation_id, patient_id, drug_name, schedule_times, schedule_spec, source, is_active, created_at)
    values (v_org, v_p, 'S08z clock', '["08:00","20:00"]', '{"kind":"daily","times":["08:00","20:00"]}', 'patient', true, now() - interval '1 day')
    returning id into v_med;
  insert into public.medications (organisation_id, patient_id, drug_name, schedule_times, schedule_spec, source, is_active, created_at)
    values (v_org, v_p, 'S08z anch', '["08:00","20:00"]', '{"kind":"daily","anchored":[{"anchor":"breakfast","offsetMinutes":0},{"anchor":"dinner","offsetMinutes":0}]}', 'patient', true, now() - interval '1 day')
    returning id into v_med2;
  insert into public.medication_supply (medication_id, organisation_id, patient_id, pills_on_hand, pills_per_dose) values (v_med, v_org, v_p, 10, 1), (v_med2, v_org, v_p, 10, 1);
  select run_out_date into v_run1 from private.medication_supply_status(v_med);
  select run_out_date into v_run2 from private.medication_supply_status(v_med2);
  insert into results values ('real', 'the refill estimate for an anchored schedule matches the same times as clock times', 'true', (v_run1 is not null and v_run1 = v_run2)::text);

  -- 3e. All four expansions pass the patient (the rewrite from the live definitions took).
  foreach fn in array array['private.queue_medication_dose_reminders()', 'private.medication_supply_status(uuid,timestamp with time zone)',
                             'private.mark_overdue_doses_missed(timestamp with time zone)', 'private.weekly_adherence(uuid,timestamp with time zone)'] loop
    v_def := pg_get_functiondef(fn::regprocedure::oid);
    insert into results values ('real', 'expansion passes the patient: ' || fn, 'true',
      (v_def ~ 'medication_slots_on\(m\.schedule_spec, m\.schedule_times, [A-Za-z0-9_.:]+, m\.patient_id\)')::text);
  end loop;
end
$$;

-- 4. The RPCs and who may use them ------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid; v_a uuid; v_b uuid; v_med uuid; v_eff date; v_id uuid; v_id2 uuid; v_err text; v_n integer; v_row record;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_c1 uuid := gen_random_uuid(); v_c2 uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_a := pg_temp.mkpatient(v_org, 'rpc-owner');
  v_b := pg_temp.mkpatient(v_org, 'rpc-stranger');

  -- As the owner.
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_eff := public.save_dose_anchor_times(v_a, '{"dinner":"20:30"}'::jsonb);
  insert into results values ('real', 'a new anchor time with nothing logged takes effect today', '0', (v_eff - v_today)::text);
  v_eff := public.save_dose_anchor_times(v_a, '{"lunch":"13:10"}'::jsonb, v_today - 5);
  insert into results values ('real', 'an effective date in the past is clamped to today, never rewriting a day lived', '0', (v_eff - v_today)::text);
  v_eff := public.save_dose_anchor_times(v_a, '{"lunch":"13:20"}'::jsonb, v_today + 3);
  insert into results values ('real', 'an effective date in the future is kept', '3', (v_eff - v_today)::text);
  begin perform public.save_dose_anchor_times(v_a, '{"brunch":"08:00"}'::jsonb); v_err := 'accepted'; exception when sqlstate '22023' then v_err := 'refused'; end;
  insert into results values ('real', 'an unknown anchor is refused', 'refused', v_err);
  begin perform public.save_dose_anchor_times(v_a, '{"lunch":"25:00"}'::jsonb); v_err := 'accepted'; exception when sqlstate '22023' then v_err := 'refused'; end;
  insert into results values ('real', 'a bad time is refused', 'refused', v_err);
  begin perform public.save_dose_anchor_times(v_a, '{}'::jsonb); v_err := 'accepted'; exception when sqlstate '22023' then v_err := 'refused'; end;
  insert into results values ('real', 'an empty set of times is refused', 'refused', v_err);
  begin perform public.save_dose_anchor_times(v_a, '{"lunch":"13:00"}'::jsonb, v_today + 31); v_err := 'accepted'; exception when sqlstate '22023' then v_err := 'refused'; end;
  insert into results values ('real', 'an effective date more than 30 days ahead is refused', 'refused', v_err);

  v_id := public.create_day_shift(v_a, v_c1, v_today + 2, v_today + 10, '{"dinner":60}'::jsonb);
  v_id2 := public.create_day_shift(v_a, v_c1, v_today + 2, v_today + 10, '{"dinner":60}'::jsonb);
  insert into results values ('real', 'creating the same shift twice (a retry) gives one row', 'true', (v_id is not null and v_id = v_id2)::text);
  v_id2 := public.create_day_shift(v_a, gen_random_uuid(), v_today - 4, v_today + 3, '{"lunch":30}'::jsonb);
  insert into results values ('real', 'a shift never reaches into days already lived: its start is clamped to today', '0',
    (select (starts_on - v_today)::text from public.patient_day_shifts where id = v_id2));
  begin perform public.create_day_shift(v_a, gen_random_uuid(), v_today - 5, v_today - 1, '{"lunch":30}'::jsonb); v_err := 'accepted'; exception when sqlstate '22023' then v_err := 'refused'; end;
  insert into results values ('real', 'a shift that is already over is refused', 'refused', v_err);
  begin perform public.create_day_shift(v_a, gen_random_uuid(), v_today + 1, v_today + 46, '{"lunch":30}'::jsonb); v_err := 'accepted'; exception when check_violation then v_err := 'refused'; end;
  insert into results values ('real', 'a shift longer than 45 days is refused', 'refused', v_err);
  begin perform public.create_day_shift(v_a, gen_random_uuid(), v_today + 1, v_today + 5, '{"lunch":361}'::jsonb); v_err := 'accepted'; exception when sqlstate '22023' then v_err := 'refused'; end;
  insert into results values ('real', 'an offset beyond six hours is refused', 'refused', v_err);
  begin perform public.create_day_shift(v_a, gen_random_uuid(), v_today + 1, v_today + 5, '{"brunch":30}'::jsonb); v_err := 'accepted'; exception when sqlstate '22023' then v_err := 'refused'; end;
  insert into results values ('real', 'a shift naming an unknown anchor is refused', 'refused', v_err);

  -- Ending a shift: one that has not begun is void; one in force ends today and keeps earlier days shifted.
  v_eff := public.cancel_day_shift(v_a, v_id);
  insert into results values ('real', 'ending a shift that has not begun voids it from its own start', '2', (v_eff - v_today)::text);
  v_eff := public.cancel_day_shift(v_a, v_id2);
  insert into results values ('real', 'ending a shift in force takes effect today when nothing is logged on its anchors', '0', (v_eff - v_today)::text);
  v_eff := public.cancel_day_shift(v_a, v_id2);
  insert into results values ('real', 'ending a shift twice never moves its end later', '0', (v_eff - v_today)::text);
  begin perform public.cancel_day_shift(v_a, gen_random_uuid()); v_err := 'accepted'; exception when sqlstate 'P0002' then v_err := 'refused'; end;
  insert into results values ('real', 'ending a shift that does not exist is refused', 'refused', v_err);

  -- The owner reads their own rows (the control: the gate opens).
  select count(*) into v_n from public.patient_dose_anchors where patient_id = v_a;
  insert into results values ('real', 'the owner reads their own anchor times', 'true', (v_n >= 3)::text);
  select count(*) into v_n from public.patient_day_shifts where patient_id = v_a;
  insert into results values ('real', 'the owner reads their own shifts', 'true', (v_n >= 2)::text);
  -- Direct writes are not a way in.
  begin insert into public.patient_dose_anchors (patient_id, anchor, effective_from, local_time, organisation_id) values (v_a, 'waking', v_today, '06:00', v_org); v_err := 'accepted'; exception when insufficient_privilege then v_err := 'refused'; end;
  insert into results values ('real', 'a patient cannot write an anchor time directly', 'refused', v_err);
  begin insert into public.patient_day_shifts (patient_id, organisation_id, starts_on, ends_on, offsets) values (v_a, v_org, v_today, v_today, '{"lunch":30}'); v_err := 'accepted'; exception when insufficient_privilege then v_err := 'refused'; end;
  insert into results values ('real', 'a patient cannot write a shift directly', 'refused', v_err);
  begin update public.patient_day_shifts set offsets = '{"lunch":300}' where patient_id = v_a; v_err := 'accepted'; exception when insufficient_privilege then v_err := 'refused'; end;
  insert into results values ('real', 'a patient cannot edit a shift directly', 'refused', v_err);
  reset role;

  -- A stranger sees nothing and writes nothing.
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.patient_dose_anchors where patient_id = v_a;
  insert into results values ('real', 'a stranger sees none of another patient''s anchor times', '0', v_n::text);
  select count(*) into v_n from public.patient_day_shifts where patient_id = v_a;
  insert into results values ('real', 'a stranger sees none of another patient''s shifts', '0', v_n::text);
  begin perform public.save_dose_anchor_times(v_a, '{"lunch":"13:00"}'::jsonb); v_err := 'accepted'; exception when sqlstate '42501' then v_err := 'refused'; end;
  insert into results values ('real', 'a stranger cannot save another patient''s anchor times', 'refused', v_err);
  begin perform public.create_day_shift(v_a, gen_random_uuid(), v_today + 1, v_today + 3, '{"lunch":30}'::jsonb); v_err := 'accepted'; exception when sqlstate '42501' then v_err := 'refused'; end;
  insert into results values ('real', 'a stranger cannot create a shift for another patient', 'refused', v_err);
  begin perform public.cancel_day_shift(v_a, v_id); v_err := 'accepted'; exception when sqlstate '42501' then v_err := 'refused'; end;
  insert into results values ('real', 'a stranger cannot end another patient''s shift', 'refused', v_err);
  reset role;

  -- No one signed in.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  begin perform public.save_dose_anchor_times(v_a, '{"lunch":"13:00"}'::jsonb); v_err := 'accepted'; exception when sqlstate '42501' then v_err := 'refused'; end;
  insert into results values ('real', 'with no signed-in user the RPC refuses', 'refused', v_err);

  insert into results values ('real', 'anon cannot execute the anchor RPCs', 'false',
    (has_function_privilege('anon', 'public.save_dose_anchor_times(uuid,jsonb,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_day_shift(uuid,uuid,date,date,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cancel_day_shift(uuid,uuid)', 'EXECUTE'))::text);
  insert into results values ('real', 'anon holds no privilege on the anchor tables', 'false',
    (has_table_privilege('anon', 'public.patient_dose_anchors', 'SELECT') or has_table_privilege('anon', 'public.patient_day_shifts', 'SELECT')
     or has_table_privilege('anon', 'public.dose_anchor_defaults', 'SELECT'))::text);

  -- Today already has answers on an anchor: its new time, and a shift on it, start tomorrow so the answers keep their slot.
  insert into results values ('real', 'a new anchor time starts tomorrow when today already has answers on it', '1', pg_temp.effective_with_answers());
  v_a := pg_temp.mkpatient(v_org, 'rpc-answers');
  insert into public.medications (organisation_id, patient_id, drug_name, schedule_times, schedule_spec, source, is_active, created_at)
    values (v_org, v_a, 'S08z answered 2', '["07:30"]', '{"kind":"daily","anchored":[{"anchor":"breakfast","offsetMinutes":0}]}', 'patient', true, now() - interval '3 days')
    returning id into v_med;
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_time, scheduled_for_date, source, client_id)
    values (v_org, v_a, v_med, 'taken', '07:30', v_today, 'patient', gen_random_uuid());
  perform pg_temp.as_user(v_a);
  v_id := public.create_day_shift(v_a, gen_random_uuid(), v_today, v_today + 5, '{"breakfast":60}'::jsonb);
  insert into results values ('real', 'a shift on an anchor with answers today starts tomorrow', '1', (select (starts_on - v_today)::text from public.patient_day_shifts where id = v_id));
  begin perform public.create_day_shift(v_a, gen_random_uuid(), v_today, v_today, '{"breakfast":60}'::jsonb); v_err := 'accepted'; exception when sqlstate '22023' then v_err := 'refused'; end;
  insert into results values ('real', 'a one-day shift today on an anchor with answers is refused (it would move nothing)', 'refused', v_err);
  v_id2 := public.create_day_shift(v_a, gen_random_uuid(), v_today - 1, v_today + 4, '{"breakfast":30}'::jsonb);
  v_eff := public.cancel_day_shift(v_a, v_id2);
  insert into results values ('real', 'ending a shift on an anchor with answers today takes effect tomorrow', '1', (v_eff - v_today)::text);
  insert into results values ('real', 'shifts that begin tomorrow leave today as it was', '07:30',
    (select string_agg(slot_time, ',') from private.medication_slots_on('{"kind":"daily","anchored":[{"anchor":"breakfast","offsetMinutes":0}]}', null, v_today, v_a)));
end
$$;

-- 5. No write path can leave a window overlapping ---------------------------------------------------------------------------------
do $$
declare
  v_org uuid; v_g uuid; v_err text; v_med uuid;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_g := pg_temp.mkpatient(v_org, 'guard');
  -- Test defaults: waking 06:30 and breakfast 07:30 are an hour apart.
  begin
    insert into public.medications (organisation_id, patient_id, drug_name, schedule_times, schedule_spec, source, is_active)
    values (v_org, v_g, 'S08z overlap', '["06:30","07:30"]', '{"kind":"daily","windowMinutes":90,"anchored":[{"anchor":"waking","offsetMinutes":0},{"anchor":"breakfast","offsetMinutes":0}]}', 'patient', true);
    v_err := 'accepted';
  exception when check_violation then v_err := 'refused'; end;
  insert into results values ('real', 'a window longer than the gap between two anchored doses is refused', 'refused', v_err);
  insert into public.medications (organisation_id, patient_id, drug_name, schedule_times, schedule_spec, source, is_active)
  values (v_org, v_g, 'S08z fits', '["06:30","07:30"]', '{"kind":"daily","windowMinutes":30,"anchored":[{"anchor":"waking","offsetMinutes":0},{"anchor":"breakfast","offsetMinutes":0}]}', 'patient', true)
  returning id into v_med;
  insert into results values ('real', 'the same doses with a window that fits are accepted (control)', 'true', (v_med is not null)::text);
  begin
    insert into public.patient_dose_anchors (patient_id, anchor, effective_from, local_time, organisation_id) values (v_g, 'breakfast', v_today, '06:45', v_org);
    v_err := 'accepted';
  exception when check_violation then v_err := 'refused'; end;
  insert into results values ('real', 'moving an anchor so an existing window would overlap is refused', 'refused', v_err);
  insert into public.patient_dose_anchors (patient_id, anchor, effective_from, local_time, organisation_id) values (v_g, 'breakfast', v_today, '08:30', v_org);
  insert into results values ('real', 'moving it somewhere the window still fits is accepted (control)', '1',
    (select count(*)::text from public.patient_dose_anchors where patient_id = v_g and anchor = 'breakfast' and local_time = '08:30'));
end
$$;

-- 6. Sabotage: each rule removed must flip its check ------------------------------------------------------------------------------
-- The real answer to (b), taken before anything is sabotaged: dinner 19:30 moved 90 minutes.
insert into results values ('real', 'a day shift moves the anchor on its dates', '21:00', pg_temp.shift_case());
-- (a) the date rule dropped from the anchor time: a changed time rewrites the days already lived.
create or replace function private.dose_anchor_minutes(p_patient uuid, p_anchor text, p_date date)
returns integer language sql stable security definer set search_path = '' as $$
  select (substr(t, 1, 2)::integer * 60 + substr(t, 4, 2)::integer)
    from (select coalesce(
                   (select a.local_time from public.patient_dose_anchors a where a.patient_id = p_patient and a.anchor = p_anchor order by a.effective_from desc limit 1),
                   (select d.default_time from public.dose_anchor_defaults d where d.anchor = p_anchor)) as t) q;
$$;
insert into results values ('sabotaged', 'a changed anchor time writes no false missed row for doses logged at the old time', '0', pg_temp.drift_missed_count()::text);

-- (b) the shift removed.
create or replace function private.dose_anchor_shift(p_patient uuid, p_anchor text, p_date date)
returns integer language sql stable security definer set search_path = '' as $$ select 0; $$;
insert into results values ('sabotaged', 'a day shift moves the anchor on its dates', '21:00', pg_temp.shift_case());

-- (c) "today has answers" dropped.
create or replace function private.anchor_day_has_answers(p_patient uuid, p_anchors text[], p_date date)
returns boolean language sql stable security definer set search_path = '' as $$ select false; $$;
insert into results values ('sabotaged', 'a new anchor time starts tomorrow when today already has answers on it', '1', pg_temp.effective_with_answers());

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S08z proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 3 then
    raise exception 'VACUOUS TEST: only % of 3 sabotaged rules failed their check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged rows are asserted to FAIL inside the DO block above (a vacuous test raises). They are
-- deliberately not printed: the runner treats any FAIL verdict in the output as a failed proof.

rollback;
