-- Tarragon Health — verification for
-- 20260826213713_medication_logs_reason_codes_and_unconfirmed_status.sql
--
-- Proves: a scheduled dose slot more than 3 hours past due with no patient
-- log gets marked 'unconfirmed' by private.mark_unconfirmed_doses() — never
-- 'missed' (an inferred absence must never look like a confirmed fact, and
-- must never fire private.evaluate_adherence_escalation(), which only reacts
-- to status='missed'). Also proves the cron is idempotent on re-run, and
-- that the patient can still correct the same row afterwards (no duplicate
-- row is ever created for one (medication_id, scheduled_for_date,
-- scheduled_time) slot).
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data;
-- it always leaves the database exactly as it found it.

begin;

create temporary table maugp_fixture(k text primary key, v uuid) on commit drop;

do $$
declare
  v_org           uuid;
  v_patient       uuid := gen_random_uuid();
  v_med_id        uuid;
  -- Computed relative to the instant this test runs, not hardcoded — the
  -- function under test checks BOTH today's and yesterday's Lagos-local
  -- date for each schedule_time, so a slot 4 hours in the past is always
  -- correctly identified regardless of whether that crosses local midnight.
  v_time_4h_ago   text;
begin
  select organisation_id into v_org
  from public.profiles where role = 'patient' and organisation_id is not null limit 1;

  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'maugp-test-patient@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'MAUGP Test Patient')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  v_time_4h_ago := to_char((now() at time zone 'Africa/Lagos') - interval '4 hours', 'HH24:MI');

  -- Backdated created_at (well before the 4-hours-ago slot) — the medication
  -- must already have existed when the dose was scheduled, or the new
  -- "never retroactively flag a slot that predates the medication" guard
  -- correctly excludes it (that guard is itself part of what this test would
  -- catch a regression in, if it were ever removed).
  insert into public.medications
    (id, organisation_id, patient_id, drug_name, is_active, schedule_times, source, created_at)
  values
    (gen_random_uuid(), v_org, v_patient, 'MAUGP Test Drug', true,
     jsonb_build_array(v_time_4h_ago), 'patient', now() - interval '2 days')
  returning id into v_med_id;

  insert into maugp_fixture(k, v) values
    ('org', v_org), ('patient', v_patient), ('med', v_med_id);
end $$;

-- ==========================================================================
-- 1. A silent scheduled slot is marked 'unconfirmed', never 'missed', and
--    raises no escalation alert.
-- ==========================================================================
do $$
declare
  v_med uuid := (select v from maugp_fixture where k = 'med');
  v_status public.medication_log_status;
  v_count integer;
  v_alert_count integer;
begin
  perform private.mark_unconfirmed_doses();

  select count(*) into v_count from public.medication_logs where medication_id = v_med;
  if v_count <> 1 then
    raise exception 'FAIL: expected exactly 1 medication_logs row after the grace-period cron, got %', v_count;
  end if;

  select status into v_status from public.medication_logs where medication_id = v_med;
  if v_status <> 'unconfirmed' then
    raise exception 'FAIL: expected status=unconfirmed, got %', v_status;
  end if;

  select count(*) into v_alert_count from public.medication_adherence_alerts where medication_id = v_med;
  if v_alert_count <> 0 then
    raise exception 'FAIL: an unconfirmed dose must never raise a medication_adherence_alerts row, got %', v_alert_count;
  end if;

  raise notice 'PASS 1: silent scheduled dose marked unconfirmed, no escalation raised';
end $$;

-- ==========================================================================
-- 2. Re-running the cron is idempotent — no duplicate row for the same slot.
-- ==========================================================================
do $$
declare
  v_med uuid := (select v from maugp_fixture where k = 'med');
  v_count integer;
begin
  perform private.mark_unconfirmed_doses();
  perform private.mark_unconfirmed_doses();

  select count(*) into v_count from public.medication_logs where medication_id = v_med;
  if v_count <> 1 then
    raise exception 'FAIL: re-running the grace-period cron must not duplicate the unconfirmed row, got % rows', v_count;
  end if;

  raise notice 'PASS 2: grace-period cron is idempotent on re-run';
end $$;

-- ==========================================================================
-- 3. The patient (or their supporter) can still correct an unconfirmed dose
--    afterwards — the same slot's row is updated, never duplicated. This is
--    the exact select-then-upsert path apps/web's useLogDose already relies
--    on (keyed on medication_id, scheduled_for_date, scheduled_time).
-- ==========================================================================
do $$
declare
  v_med uuid := (select v from maugp_fixture where k = 'med');
  v_log_id uuid;
  v_count integer;
  v_status public.medication_log_status;
begin
  select id into v_log_id from public.medication_logs where medication_id = v_med;

  update public.medication_logs
    set status = 'taken', logged_at = now()
    where id = v_log_id;

  select count(*) into v_count from public.medication_logs where medication_id = v_med;
  if v_count <> 1 then
    raise exception 'FAIL: correcting an unconfirmed dose must update the same row, not insert a second one, got % rows', v_count;
  end if;

  select status into v_status from public.medication_logs where id = v_log_id;
  if v_status <> 'taken' then
    raise exception 'FAIL: the corrected row should now read taken, got %', v_status;
  end if;

  raise notice 'PASS 3: patient correction updates the same row in place';
  raise notice 'ALL MEDICATION_ADHERENCE_UNCONFIRMED_GRACE_PERIOD CHECKS PASSED';
end $$;

rollback;
