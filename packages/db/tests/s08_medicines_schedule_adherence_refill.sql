-- S08 proof: medicines schedules, the server "missed" job, late-synced taken,
-- weekly adherence, pill count and refill, the signals, and the access rules
-- (migrations *_s08_medicines_schedules_supply_missed_adherence.sql, *_s08_review_schedule_edit_refill_suspended.sql and *_s08e_schedule_window_check.sql).
--
-- Proves in one rolled-back transaction:
--   1. The shared schedule expansion cases (packages/medicines schedule.fixtures.ts).
--   2. The missed job marks unanswered overdue slots missed (source 'system'),
--      never a slot that already has a log, and a second run adds nothing.
--   3. A "taken" row logged offline (device time EARLIER than the server's missed
--      row) wins: the latest-per-slot view says taken, weekly adherence counts it.
--   4. Weekly adherence: percent, the minimum-doses gate, below_threshold.
--   5. Pill count: run-out date matches the TypeScript case (10 pills, 2 a day);
--      the count cannot be backdated or attached to another patient.
--   6. The refill reminder fires from the pill count, once, with no medicine name
--      in the payload; the dose reminder function no longer carries drug_name.
--   7. Signals: dose recorded (people only), dose missed, refill due, adherence low
--      (deduplicated per week).
--   8. Access: a stranger sees no pill count and cannot write one; the owner can; a
--      patient cannot change a clinician-prescribed dose or its structured schedule
--      but can change a patient-added medicine's; the adherence RPC refuses a stranger.
--   8b. Review fixes: a schedule edit invents no missed history, a stale refill date does not
--       hide a pill-count run-out, a suspended account is left alone.
--   9. SABOTAGE: with the view's "person beats server missed" ordering removed, the
--      late-synced taken check must FAIL, proving it discriminates.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;

create or replace function pg_temp.mkpatient(p_org uuid, p_label text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's08-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth)
  values (v, p_org, 'patient', 'S08 ' || p_label, (current_date - interval '45 years')::date)
  on conflict (id) do nothing;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_p uuid; v_other uuid;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_med uuid; v_med2 uuid; v_med3 uuid; v_med4 uuid; v_susp uuid; v_rx uuid;
  v_w1 uuid; v_w2 uuid; v_wt text; v_wd date; v_due_exact int; v_due_window int;
  v_case jsonb; v_refused int; v_accepted int; v_vcases jsonb; v_wrong text;
  v_n integer; v_n2 integer; v_slot date; v_status text; v_adh jsonb;
  v_miss_logged timestamptz; v_taken_logged timestamptz; v_run date; v_left numeric;
  v_supply record; v_err text; v_payload jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'S08 proof needs one organisation (seed fixture missing)'; end if;
  v_p := pg_temp.mkpatient(v_org, 'patient');
  v_other := pg_temp.mkpatient(v_org, 'stranger');

  -- 1. Shared expansion cases ----------------------------------------------------
  insert into results values ('real', 'daily twice', '08:00,20:00',
    (select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on('{"kind":"daily","times":["08:00","20:00"]}', null, date '2026-10-05')));
  insert into results values ('real', 'every 2 days on anchor', '09:00',
    (select string_agg(slot_time, ',') from private.medication_slots_on('{"kind":"every_n_days","times":["09:00"],"intervalDays":2,"anchorDate":"2026-10-01"}', null, date '2026-10-05')));
  insert into results values ('real', 'every 2 days off anchor', 'none',
    coalesce((select string_agg(slot_time, ',') from private.medication_slots_on('{"kind":"every_n_days","times":["09:00"],"intervalDays":2,"anchorDate":"2026-10-01"}', null, date '2026-10-04')), 'none'));
  insert into results values ('real', 'every 2 days before anchor', 'none',
    coalesce((select string_agg(slot_time, ',') from private.medication_slots_on('{"kind":"every_n_days","times":["09:00"],"intervalDays":2,"anchorDate":"2026-10-10"}', null, date '2026-10-08')), 'none'));
  insert into results values ('real', 'weekdays Monday', '07:30',
    (select string_agg(slot_time, ',') from private.medication_slots_on('{"kind":"weekdays","times":["07:30"],"days":[1,4]}', null, date '2026-10-05')));
  insert into results values ('real', 'weekdays Tuesday', 'none',
    coalesce((select string_agg(slot_time, ',') from private.medication_slots_on('{"kind":"weekdays","times":["07:30"],"days":[1,4]}', null, date '2026-10-06')), 'none'));
  insert into results values ('real', 'taper step 1', '08:00,20:00',
    (select string_agg(slot_time, ',' order by slot_time) from private.medication_slots_on('{"kind":"taper","startDate":"2026-10-01","steps":[{"days":3,"times":["08:00","20:00"],"doseText":"2 tablets"},{"days":3,"times":["08:00"],"doseText":"1 tablet"}]}', null, date '2026-10-03')));
  insert into results values ('real', 'taper step 2 dose text', '1 tablet',
    (select dose_text from private.medication_slots_on('{"kind":"taper","startDate":"2026-10-01","steps":[{"days":3,"times":["08:00","20:00"],"doseText":"2 tablets"},{"days":3,"times":["08:00"],"doseText":"1 tablet"}]}', null, date '2026-10-05') limit 1));
  insert into results values ('real', 'taper finished', 'none',
    coalesce((select string_agg(slot_time, ',') from private.medication_slots_on('{"kind":"taper","startDate":"2026-10-01","steps":[{"days":3,"times":["08:00","20:00"],"doseText":"2 tablets"},{"days":3,"times":["08:00"],"doseText":"1 tablet"}]}', null, date '2026-10-07')), 'none'));
  insert into results values ('real', 'as needed', 'none',
    coalesce((select string_agg(slot_time, ',') from private.medication_slots_on('{"kind":"as_needed","maxPerDay":3}', null, date '2026-10-05')), 'none'));
  insert into results values ('real', 'before start date', 'none',
    coalesce((select string_agg(slot_time, ',') from private.medication_slots_on('{"kind":"daily","times":["08:00"],"startDate":"2026-10-06"}', null, date '2026-10-05')), 'none'));
  insert into results values ('real', 'after end date', 'none',
    coalesce((select string_agg(slot_time, ',') from private.medication_slots_on('{"kind":"daily","times":["08:00"],"endDate":"2026-10-04"}', null, date '2026-10-05')), 'none'));
  insert into results values ('real', 'leap day', '06:00',
    (select string_agg(slot_time, ',') from private.medication_slots_on('{"kind":"every_n_days","times":["06:00"],"intervalDays":2,"anchorDate":"2028-02-27"}', null, date '2028-02-29')));
  insert into results values ('real', 'month boundary', '06:00',
    (select string_agg(slot_time, ',') from private.medication_slots_on('{"kind":"every_n_days","times":["06:00"],"intervalDays":3,"anchorDate":"2026-10-29"}', null, date '2026-11-01')));
  insert into results values ('real', 'malformed spec has no slots and does not raise', 'none',
    coalesce((select string_agg(slot_time, ',') from private.medication_slots_on('{"kind":"every_n_days","times":["09:00"],"intervalDays":"x","anchorDate":"nope"}', null, date '2026-10-05')), 'none'));
  insert into results values ('real', 'legacy schedule_times', '07:00',
    (select string_agg(slot_time, ',') from private.medication_slots_on(null, '["07:00","bad"]', date '2026-10-05')));

  -- Fixtures: a patient-added medicine, daily 08:00, added 5 days ago ---------------
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, source, is_active, created_at)
    values (v_org, v_p, 'S08 Test Medicine', '1 tablet', 'daily', '["08:00"]', 'patient', true, now() - interval '5 days')
    returning id into v_med;

  -- 2. The missed job -------------------------------------------------------------
  select private.mark_overdue_doses_missed() into v_n;
  select count(*) into v_n2 from public.medication_logs where medication_id = v_med and source = 'system' and status = 'missed';
  insert into results values ('real', 'job marks overdue unanswered slots missed', 'true', (v_n2 >= 2 and v_n >= v_n2)::text);
  insert into results values ('real', 'every missed row is source system with a deterministic client id', 'true',
    (select (count(*) = v_n2 and bool_and(client_id is not null and source = 'system'))::text
       from public.medication_logs where medication_id = v_med and status = 'missed'));
  select private.mark_overdue_doses_missed() into v_n;
  insert into results values ('real', 'a second run adds nothing', '0', v_n::text);
  insert into results values ('real', 'a slot due before the medicine was added is not marked', 'true',
    (not exists (select 1 from public.medication_logs where medication_id = v_med and scheduled_for_date < v_today - 3))::text);
  insert into results values ('real', 'dose.missed signal written for each missed row', 'true',
    ((select count(*) from public.clinical_rule_events where patient_id = v_p and event_type = 'medication_dose_missed') = v_n2)::text);

  -- 3. Late-synced taken beats the server's missed -----------------------------------
  select scheduled_for_date into v_slot from public.medication_logs
   where medication_id = v_med and status = 'missed' order by scheduled_for_date desc limit 1;
  select logged_at into v_miss_logged from public.medication_logs
   where medication_id = v_med and status = 'missed' and scheduled_for_date = v_slot;
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_time, scheduled_for_date, source, client_id, client_recorded_at)
    values (v_org, v_p, v_med, 'taken', '08:00', v_slot, 'patient', gen_random_uuid(),
            ((v_slot + time '08:10') at time zone 'Africa/Lagos'));
  select logged_at into v_taken_logged from public.medication_logs
   where medication_id = v_med and status = 'taken' and scheduled_for_date = v_slot;
  select status::text into v_status from public.medication_logs_latest_per_slot
   where medication_id = v_med and scheduled_for_date = v_slot and scheduled_time = '08:00';
  insert into results values ('real', 'the offline taken row has an EARLIER time than the missed row', 'true', (v_taken_logged < v_miss_logged)::text);
  insert into results values ('real', 'late-synced taken wins over the server missed', 'taken', v_status);
  insert into results values ('real', 'a log by a person is not written as a dose.recorded for the system row', 'true',
    ((select count(*) from public.clinical_rule_events where patient_id = v_p and event_type = 'medication_dose_recorded') = 1)::text);

  -- 4. Weekly adherence --------------------------------------------------------------
  v_adh := private.weekly_adherence(v_p);
  insert into results values ('real', 'adherence counts the taken slot', 'true', (((v_adh ->> 'taken')::int) = 1)::text);
  insert into results values ('real', 'adherence has enough doses for a percentage', 'true', ((v_adh ->> 'percent') is not null)::text);
  insert into results values ('real', 'adherence is below the threshold', 'true', ((v_adh ->> 'below_threshold')::boolean)::text);
  insert into results values ('real', 'percent is taken over due', 'true',
    (((v_adh ->> 'percent')::int) = round(100.0 * 1 / (v_adh ->> 'due')::int)::int)::text);
  -- A medicine added a moment ago owes nothing yet.
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, source, is_active)
    values (v_org, v_other, 'S08 New', '1', 'daily', '["00:01"]', 'patient', true);
  insert into results values ('real', 'too few due doses gives no percentage', 'true',
    ((private.weekly_adherence(v_other) ->> 'percent') is null)::text);

  -- 5. Pill count -----------------------------------------------------------------------
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, source, is_active, created_at)
    values (v_org, v_p, 'S08 Supply Medicine', '1', 'twice daily', '["08:00","20:00"]', 'patient', true, now() - interval '1 day')
    returning id into v_med2;
  insert into public.medication_supply (medication_id, organisation_id, patient_id, pills_on_hand, pills_per_dose, counted_at)
    values (v_med2, v_org, v_other, 10, 1, now() - interval '30 days');
  select * into v_supply from public.medication_supply where medication_id = v_med2;
  insert into results values ('real', 'count belongs to the medicine owner, not the client value', 'true', (v_supply.patient_id = v_p)::text);
  insert into results values ('real', 'count cannot be backdated', 'true', (v_supply.counted_at > now() - interval '1 minute')::text);
  select pills_left, run_out_date into v_left, v_run from private.medication_supply_status(v_med2);
  insert into results values ('real', 'pills left with nothing taken since the count', '10.0', v_left::text);
  insert into results values ('real', 'run-out date is five days on at two a day (10 pills)', 'true',
    (v_run between v_today + 4 and v_today + 6)::text);
  update public.medication_supply set pills_on_hand = 3 where medication_id = v_med2;
  select pills_left, run_out_date into v_left, v_run from private.medication_supply_status(v_med2);
  insert into results values ('real', 'a corrected count restarts the estimate', 'true', (v_left = 3 and v_run <= v_today + 2)::text);

  -- 6. Refill reminder from the pill count --------------------------------------------------
  perform private.queue_medication_refill_reminders();
  select count(*) into v_n from public.notifications where recipient_id = v_p and template = 'medication_refill_reminder';
  select payload into v_payload from public.notifications where recipient_id = v_p and template = 'medication_refill_reminder' limit 1;
  insert into results values ('real', 'refill reminder fires when the pill count runs low (push/in-app pair)', 'true', (v_n >= 2)::text);
  insert into results values ('real', 'refill reminder payload names no medicine (INV-07)', 'true',
    (v_payload is not null and not (v_payload ? 'drug_name'))::text);
  perform private.queue_medication_refill_reminders();
  insert into results values ('real', 'a second run does not remind again', 'true',
    ((select count(*) from public.notifications where recipient_id = v_p and template = 'medication_refill_reminder') = v_n)::text);
  insert into results values ('real', 'refill.due signal written', 'true',
    (exists (select 1 from public.clinical_rule_events where patient_id = v_p and event_type = 'medication_refill_due'))::text);
  insert into results values ('real', 'dose reminder function carries no drug_name', 'true',
    (pg_get_functiondef('private.queue_medication_dose_reminders'::regproc) not like '%drug_name%')::text);

  -- 7. Adherence signal, once per week -------------------------------------------------------
  select private.emit_adherence_signals() into v_n;
  select private.emit_adherence_signals() into v_n2;
  insert into results values ('real', 'adherence below threshold emits the signal', 'true',
    (exists (select 1 from public.clinical_rule_events where patient_id = v_p and event_type = 'medication_adherence_low'))::text);
  insert into results values ('real', 'the signal is deduplicated within the week', '0', v_n2::text);

  -- 7b. Review fixes: a schedule edit invents no history, a stale refill date hides nothing,
  --     a suspended account is left alone. ---------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_p::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.medications set schedule_times = '["08:00","09:00"]' where id = v_med;
  reset role;
  perform private.mark_overdue_doses_missed();
  insert into results values ('real', 'a time added by a schedule edit gets no missed rows from before the edit', '0',
    (select count(*)::text from public.medication_logs where medication_id = v_med and scheduled_time = '09:00'));
  insert into results values ('real', 'the edit stamps schedule_effective_from', 'true',
    ((select schedule_effective_from from public.medications where id = v_med) > now() - interval '1 minute')::text);
  insert into results values ('real', 'the adherence count ignores slots from before the edit', 'true',
    ((private.weekly_adherence(v_p) ->> 'due')::int <= 7)::text);

  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, source, is_active, refill_date, created_at)
    values (v_org, v_p, 'S08 Stale Refill', '1', 'twice daily', '["08:00","20:00"]', 'patient', true, v_today - 30, now() - interval '1 day')
    returning id into v_med3;
  insert into public.medication_supply (medication_id, organisation_id, patient_id, pills_on_hand, pills_per_dose)
    values (v_med3, v_org, v_p, 3, 1);
  perform private.queue_medication_refill_reminders();
  insert into results values ('real', 'a stale past refill date does not hide a pill-count run-out', 'true',
    ((select count(*) from public.notifications where recipient_id = v_p and template = 'medication_refill_reminder'
        and payload ->> 'medication_id' = v_med3::text) >= 2)::text);

  v_susp := pg_temp.mkpatient(v_org, 'suspended');
  update public.profiles set is_active = false where id = v_susp;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, source, is_active, created_at)
    values (v_org, v_susp, 'S08 Suspended', '1', 'daily', '["08:00"]', 'patient', true, now() - interval '5 days')
    returning id into v_med4;
  perform private.mark_overdue_doses_missed();
  insert into results values ('real', 'a suspended account gets no server missed rows', '0',
    (select count(*)::text from public.medication_logs where medication_id = v_med4));
  perform private.emit_adherence_signals();
  insert into results values ('real', 'a suspended account gets no weekly adherence signal', 'false',
    (exists (select 1 from public.clinical_rule_events where patient_id = v_susp and event_type = 'medication_adherence_low'))::text);

  -- 7c. S08b: a flexible window keeps a dose open, and the view exposes who wrote each row. ----------
  v_wt := to_char(((now() at time zone 'Africa/Lagos') - interval '4 hours'), 'HH24:MI');
  v_wd := ((now() at time zone 'Africa/Lagos') - interval '4 hours')::date;
  v_w1 := pg_temp.mkpatient(v_org, 'window-exact');
  v_w2 := pg_temp.mkpatient(v_org, 'window-open');
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, source, is_active, created_at)
    values (v_org, v_w1, 'S08b Exact', '1', 'daily', jsonb_build_array(v_wt), 'patient', true, now() - interval '10 days');
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, schedule_spec, source, is_active, created_at)
    values (v_org, v_w2, 'S08b Window', '1', 'daily', jsonb_build_array(v_wt),
            jsonb_build_object('kind', 'daily', 'times', jsonb_build_array(v_wt), 'windowMinutes', 360), 'patient', true, now() - interval '10 days');
  v_due_exact := (private.weekly_adherence(v_w1) ->> 'due')::int;
  v_due_window := (private.weekly_adherence(v_w2) ->> 'due')::int;
  insert into results values ('real', 'a dose inside its flexible window is not yet counted (one fewer due than the exact time)', '1',
    (v_due_exact - v_due_window)::text);
  insert into results values ('real', 'the open dose is not counted as missed either', 'true',
    ((private.weekly_adherence(v_w2) ->> 'missed')::int = (private.weekly_adherence(v_w1) ->> 'missed')::int - 1)::text);
  -- S08e: the database refuses a window the phone would refuse, and accepts the ones it accepts.
  v_refused := 0; v_accepted := 0;
  for v_case in select * from jsonb_array_elements('[400, 361, -1, 12.5, "abc", "60", true, [30], {"a": 1}]'::jsonb) loop
    begin
      insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, schedule_spec, source, is_active, created_at)
        values (v_org, v_w2, 'S08e Bad Window', '1', 'daily', '["08:00"]',
                jsonb_build_object('kind', 'daily', 'times', jsonb_build_array('08:00'), 'windowMinutes', v_case), 'patient', true, now() - interval '10 days');
      v_accepted := v_accepted + 1;
    exception when check_violation then
      v_refused := v_refused + 1;
    end;
  end loop;
  insert into results values ('real', 'a window above 360, below 0, fractional or not a number is refused at write time', '9/0', v_refused::text || '/' || v_accepted::text);
  v_refused := 0; v_accepted := 0;
  for v_case in select * from jsonb_array_elements('[0, 360, 90, null]'::jsonb) loop
    begin
      insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, schedule_spec, source, is_active, created_at)
        values (v_org, v_w2, 'S08e Good Window', '1', 'daily', '["08:00"]',
                jsonb_build_object('kind', 'daily', 'times', jsonb_build_array('08:00'), 'windowMinutes', v_case), 'patient', true, now() - interval '10 days');
      v_accepted := v_accepted + 1;
    exception when check_violation then
      v_refused := v_refused + 1;
    end;
  end loop;
  insert into results values ('real', 'a window of 0, 90, 360 or JSON null is accepted', '0/4', v_refused::text || '/' || v_accepted::text);
  begin
    insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, schedule_spec, source, is_active, created_at)
      values (v_org, v_w2, 'S08e No Window', '1', 'daily', '["08:00"]', '{"kind":"daily","times":["08:00"]}', 'patient', true, now() - interval '10 days');
    v_accepted := 1;
  exception when check_violation then
    v_accepted := 0;
  end;
  insert into results values ('real', 'a schedule with no windowMinutes key at all is accepted', '1', v_accepted::text);
  -- S08f: the database judges every schedule the way the phone does (packages/medicines
  -- schedule.fixtures.ts SPEC_VALIDITY_CASES, the same list), both through the function and through the
  -- real constraint on insert.
  v_vcases := '[{"name":"daily","spec":{"kind":"daily","times":["08:00","20:00"]},"valid":true},{"name":"daily with all optional fields","spec":{"kind":"daily","times":["08:00"],"startDate":"2026-01-01","endDate":"2026-12-31","foodNote":"with_food","windowMinutes":90},"valid":true},{"name":"null optional fields","spec":{"kind":"daily","times":["08:00"],"startDate":null,"endDate":null,"foodNote":null,"windowMinutes":null},"valid":true},{"name":"twelve times","spec":{"kind":"daily","times":["00:00","01:00","02:00","03:00","04:00","05:00","06:00","07:00","08:00","09:00","10:00","11:00"]},"valid":true},{"name":"thirteen times","spec":{"kind":"daily","times":["00:00","01:00","02:00","03:00","04:00","05:00","06:00","07:00","08:00","09:00","10:00","11:00","12:00"]},"valid":false},{"name":"no times","spec":{"kind":"daily","times":[]},"valid":false},{"name":"times missing","spec":{"kind":"daily"},"valid":false},{"name":"times not a list","spec":{"kind":"daily","times":"08:00"},"valid":false},{"name":"time out of range","spec":{"kind":"daily","times":["24:00"]},"valid":false},{"name":"time without leading zero","spec":{"kind":"daily","times":["8:00"]},"valid":false},{"name":"time is a number","spec":{"kind":"daily","times":[800]},"valid":false},{"name":"one bad time among good","spec":{"kind":"daily","times":["08:00","99:99"]},"valid":false},{"name":"unknown kind","spec":{"kind":"hourly","times":["08:00"]},"valid":false},{"name":"kind missing","spec":{"times":["08:00"]},"valid":false},{"name":"kind is a number","spec":{"kind":1,"times":["08:00"]},"valid":false},{"name":"spec is a list","spec":[{"kind":"daily"}],"valid":false},{"name":"bad start date format","spec":{"kind":"daily","times":["08:00"],"startDate":"05/10/2026"},"valid":false},{"name":"impossible start date","spec":{"kind":"daily","times":["08:00"],"startDate":"2026-02-30"},"valid":false},{"name":"start date is a number","spec":{"kind":"daily","times":["08:00"],"startDate":20261005},"valid":false},{"name":"end before start","spec":{"kind":"daily","times":["08:00"],"startDate":"2026-10-05","endDate":"2026-10-04"},"valid":false},{"name":"end equals start","spec":{"kind":"daily","times":["08:00"],"startDate":"2026-10-05","endDate":"2026-10-05"},"valid":true},{"name":"unknown food note","spec":{"kind":"daily","times":["08:00"],"foodNote":"with_milk"},"valid":false},{"name":"window of 360","spec":{"kind":"daily","times":["08:00"],"windowMinutes":360},"valid":true},{"name":"window of 361","spec":{"kind":"daily","times":["08:00"],"windowMinutes":361},"valid":false},{"name":"window as long as the gap","spec":{"kind":"daily","times":["08:00","10:00"],"windowMinutes":120},"valid":false},{"name":"window shorter than the gap","spec":{"kind":"daily","times":["08:00","10:00"],"windowMinutes":119},"valid":true},{"name":"window overlaps across midnight","spec":{"kind":"daily","times":["23:00","01:00"],"windowMinutes":120},"valid":false},{"name":"duplicate times do not overlap themselves","spec":{"kind":"daily","times":["08:00","08:00"],"windowMinutes":60},"valid":true},{"name":"every 3 days","spec":{"kind":"every_n_days","times":["09:00"],"intervalDays":3,"anchorDate":"2026-10-01"},"valid":true},{"name":"interval of 1","spec":{"kind":"every_n_days","times":["09:00"],"intervalDays":1,"anchorDate":"2026-10-01"},"valid":false},{"name":"interval of 90","spec":{"kind":"every_n_days","times":["09:00"],"intervalDays":90,"anchorDate":"2026-10-01"},"valid":true},{"name":"interval of 91","spec":{"kind":"every_n_days","times":["09:00"],"intervalDays":91,"anchorDate":"2026-10-01"},"valid":false},{"name":"interval is text","spec":{"kind":"every_n_days","times":["09:00"],"intervalDays":"3","anchorDate":"2026-10-01"},"valid":false},{"name":"interval is fractional","spec":{"kind":"every_n_days","times":["09:00"],"intervalDays":2.5,"anchorDate":"2026-10-01"},"valid":false},{"name":"interval missing","spec":{"kind":"every_n_days","times":["09:00"],"anchorDate":"2026-10-01"},"valid":false},{"name":"anchor missing","spec":{"kind":"every_n_days","times":["09:00"],"intervalDays":3},"valid":false},{"name":"anchor bad","spec":{"kind":"every_n_days","times":["09:00"],"intervalDays":3,"anchorDate":"soon"},"valid":false},{"name":"weekdays","spec":{"kind":"weekdays","times":["07:00"],"days":[1,3,5]},"valid":true},{"name":"weekdays empty","spec":{"kind":"weekdays","times":["07:00"],"days":[]},"valid":false},{"name":"weekdays missing","spec":{"kind":"weekdays","times":["07:00"]},"valid":false},{"name":"weekday 7","spec":{"kind":"weekdays","times":["07:00"],"days":[7]},"valid":false},{"name":"weekday negative","spec":{"kind":"weekdays","times":["07:00"],"days":[-1]},"valid":false},{"name":"weekday text","spec":{"kind":"weekdays","times":["07:00"],"days":["1"]},"valid":false},{"name":"weekday fractional","spec":{"kind":"weekdays","times":["07:00"],"days":[1.5]},"valid":false},{"name":"taper","spec":{"kind":"taper","startDate":"2026-10-01","steps":[{"days":7,"times":["08:00"],"doseText":"20 mg"},{"days":7,"times":["08:00"],"doseText":"10 mg"}]},"valid":true},{"name":"taper without start date","spec":{"kind":"taper","steps":[{"days":7,"times":["08:00"],"doseText":"20 mg"}]},"valid":false},{"name":"taper without steps","spec":{"kind":"taper","startDate":"2026-10-01","steps":[]},"valid":false},{"name":"taper step days zero","spec":{"kind":"taper","startDate":"2026-10-01","steps":[{"days":0,"times":["08:00"],"doseText":"20 mg"}]},"valid":false},{"name":"taper step days 367","spec":{"kind":"taper","startDate":"2026-10-01","steps":[{"days":367,"times":["08:00"],"doseText":"20 mg"}]},"valid":false},{"name":"taper step without dose text","spec":{"kind":"taper","startDate":"2026-10-01","steps":[{"days":7,"times":["08:00"]}]},"valid":false},{"name":"taper step with blank dose text","spec":{"kind":"taper","startDate":"2026-10-01","steps":[{"days":7,"times":["08:00"],"doseText":"   "}]},"valid":false},{"name":"taper step with bad times","spec":{"kind":"taper","startDate":"2026-10-01","steps":[{"days":7,"times":["8am"],"doseText":"20 mg"}]},"valid":false},{"name":"taper step is not an object","spec":{"kind":"taper","startDate":"2026-10-01","steps":["20 mg"]},"valid":false},{"name":"taper window overlaps inside one step","spec":{"kind":"taper","startDate":"2026-10-01","windowMinutes":60,"steps":[{"days":7,"times":["08:00","08:30"],"doseText":"20 mg"}]},"valid":false},{"name":"as needed","spec":{"kind":"as_needed"},"valid":true},{"name":"as needed with a daily cap","spec":{"kind":"as_needed","maxPerDay":4},"valid":true},{"name":"as needed cap null","spec":{"kind":"as_needed","maxPerDay":null},"valid":true},{"name":"as needed cap zero","spec":{"kind":"as_needed","maxPerDay":0},"valid":false},{"name":"as needed cap 25","spec":{"kind":"as_needed","maxPerDay":25},"valid":false},{"name":"as needed cap text","spec":{"kind":"as_needed","maxPerDay":"4"},"valid":false}]'::jsonb;
  select coalesce(string_agg(c ->> 'name', '; '), '<none>') into v_wrong
    from jsonb_array_elements(v_vcases) c
   where private.is_valid_schedule_spec(c -> 'spec') is distinct from (c ->> 'valid')::boolean;
  insert into results values ('real', 'the validator judges every shared case as the phone does', '<none>', v_wrong);
  v_wrong := '';
  for v_case in select * from jsonb_array_elements(v_vcases) loop
    begin
      insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, schedule_spec, source, is_active, created_at)
        values (v_org, v_w2, 'S08f Case', '1', 'daily', '["08:00"]', v_case -> 'spec', 'patient', true, now() - interval '10 days');
      if not (v_case ->> 'valid')::boolean then v_wrong := v_wrong || (v_case ->> 'name') || ' (stored); '; end if;
    exception when check_violation then
      if (v_case ->> 'valid')::boolean then v_wrong := v_wrong || (v_case ->> 'name') || ' (refused); '; end if;
    end;
  end loop;
  insert into results values ('real', 'the constraint stores every valid case and refuses every invalid one', '', v_wrong);
  insert into results values ('real', 'anon cannot execute the validator', 'false',
    has_function_privilege('anon', 'private.is_valid_schedule_spec(jsonb)', 'EXECUTE')::text);
  insert into results values ('real', 'a database null schedule_spec is valid', 'true', private.is_valid_schedule_spec(null)::text);
  insert into results values ('real', 'a JSON null schedule_spec is not valid', 'false', private.is_valid_schedule_spec('null'::jsonb)::text);
  -- Sabotage: without the constraint a malformed times list is stored (the test can fail).
  alter table public.medications drop constraint medications_schedule_spec_valid;
  begin
    insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, schedule_spec, source, is_active, created_at)
      values (v_org, v_w2, 'S08f Sabotage', '1', 'daily', '["08:00"]', '{"kind":"daily","times":"08:00"}', 'patient', true, now() - interval '10 days');
    v_err := 'stored';
  exception when check_violation then v_err := 'refused'; end;
  insert into results values ('sabotaged', 'the constraint refuses a malformed times list', 'refused', v_err);
  delete from public.medications where drug_name = 'S08f Sabotage';
  alter table public.medications add constraint medications_schedule_spec_valid check (private.is_valid_schedule_spec(schedule_spec));
  -- The check runs as the writing role: a signed-in patient can store a good schedule and is refused a bad one.
  perform set_config('request.jwt.claim.sub', v_p::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, schedule_spec, source, is_active)
      values (v_org, v_p, 'S08f Own Good', '1', 'daily', '["08:00"]', '{"kind":"daily","times":["08:00"]}', 'patient', true);
    v_err := 'accepted';
  exception when others then v_err := sqlstate; end;
  begin
    insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, schedule_spec, source, is_active)
      values (v_org, v_p, 'S08f Own Bad', '1', 'daily', '["08:00"]', '{"kind":"daily","times":"08:00"}', 'patient', true);
    v_status := 'stored';
  exception when others then v_status := sqlstate; end;
  reset role;
  insert into results values ('real', 'a signed-in patient can store a valid schedule', 'accepted', v_err);
  insert into results values ('real', 'a signed-in patient is refused a malformed schedule with a check violation', '23514', v_status);
  insert into results values ('real', 'the latest-per-slot view exposes source', 'true',
    (exists (select 1 from public.medication_logs_latest_per_slot where medication_id = v_med and source = 'system'))::text);
  insert into results values ('real', 'a person-written row shows source patient', 'true',
    (exists (select 1 from public.medication_logs_latest_per_slot where medication_id = v_med and status = 'taken' and source = 'patient'))::text);

  -- 8. Access --------------------------------------------------------------------------------------
  -- Stranger: no pill count visible, cannot write one.
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.medication_supply where medication_id = v_med2;
  begin
    insert into public.medication_supply (medication_id, organisation_id, patient_id, pills_on_hand) values (v_med, v_org, v_other, 5);
    v_err := 'inserted';
  exception when others then v_err := 'refused'; end;
  begin
    perform public.medication_weekly_adherence(v_p);
    v_status := 'returned';
  exception when others then v_status := 'refused'; end;
  reset role;
  insert into results values ('real', 'a stranger sees no pill count', '0', v_n::text);
  insert into results values ('real', 'a stranger cannot write a pill count for another medicine', 'refused', v_err);
  insert into results values ('real', 'the adherence RPC refuses a stranger', 'refused', v_status);

  -- Owner: sees it, and gets the adherence read.
  perform set_config('request.jwt.claim.sub', v_p::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.medication_supply where medication_id = v_med2;
  v_adh := public.medication_weekly_adherence(v_p);
  reset role;
  insert into results values ('real', 'the owner sees her pill count', '1', v_n::text);
  insert into results values ('real', 'the owner reads her adherence', 'ok', v_adh ->> 'status');

  -- A clinician-prescribed medicine: dose and structured schedule are fixed, reminder times are not.
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, source, is_active, prescriber_name)
    values (v_org, v_p, 'S08 Prescribed', '5 mg', 'daily', '["08:00"]', 'clinician', true, 'Dr Test')
    returning id into v_rx;
  perform set_config('request.jwt.claim.sub', v_p::text, true);
  set local role authenticated;
  begin update public.medications set dose = '50 mg' where id = v_rx; v_err := 'changed'; exception when others then v_err := 'refused'; end;
  begin update public.medications set schedule_spec = '{"kind":"daily","times":["03:00"]}' where id = v_rx; v_status := 'changed'; exception when others then v_status := 'refused'; end;
  begin update public.medications set schedule_times = '["09:00"]' where id = v_rx; v_payload := to_jsonb('changed'::text); exception when others then v_payload := to_jsonb('refused'::text); end;
  begin update public.medications set schedule_spec = '{"kind":"daily","times":["21:00"]}' where id = v_med; v_n := 1; exception when others then v_n := 0; end;
  reset role;
  insert into results values ('real', 'a patient cannot change a clinician-prescribed dose (INV-02)', 'refused', v_err);
  insert into results values ('real', 'a patient cannot change a clinician-prescribed structured schedule', 'refused', v_status);
  insert into results values ('real', 'a patient can still move reminder times on a prescribed medicine', '"changed"', v_payload::text);
  insert into results values ('real', 'a patient can edit a patient-added medicine schedule', '1', v_n::text);
  insert into results values ('real', 'the dose of the prescribed medicine is unchanged', '5 mg', (select dose from public.medications where id = v_rx));
end
$$;

-- 9. Sabotage: drop the "person beats server missed" ordering. The late-synced check must flip.
create or replace view public.medication_logs_latest_per_slot with (security_invoker = on) as
 select distinct on (medication_id, scheduled_for_date, scheduled_time,
        case when scheduled_time is null then id else null::uuid end)
    id, organisation_id, patient_id, medication_id, status, reason, logged_at, created_at,
    scheduled_time, scheduled_for_date, logged_by_profile_id, missed_reason, source
   from public.medication_logs
  order by medication_id, scheduled_for_date, scheduled_time,
        case when scheduled_time is null then id else null::uuid end, logged_at desc, id desc;

insert into results
select 'sabotaged', 'late-synced taken wins over the server missed', 'taken', v.status::text
  from public.medication_logs_latest_per_slot v
 where v.medication_id = (select id from public.medications where drug_name = 'S08 Test Medicine' limit 1)
   and v.scheduled_for_date = (select max(scheduled_for_date) from public.medication_logs
                                where medication_id = v.medication_id and status = 'taken')
   and v.scheduled_time = '08:00';

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S08 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then
    raise exception 'VACUOUS TEST: sabotaged view did not fail the late-synced check';
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged row is asserted to FAIL inside the DO block above (a vacuous test raises). It is
-- deliberately not printed: the runner treats any FAIL verdict in the output as a failed proof.

rollback;
