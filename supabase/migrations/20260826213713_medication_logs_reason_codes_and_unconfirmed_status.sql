-- Tarragon Health — medication adherence: reason codes + grace-period status
-- (medication pathway, adherence tracking rebuild)
--
-- Today a scheduled dose with no patient tap just stays absent from
-- medication_logs forever — the "Today's doses" card shows it as "Pending"
-- client-side (buildTodaysDoseChecklist's `?? "pending"` fallback), but
-- nothing ever resolves it, so a silent non-response is indistinguishable
-- from "haven't gotten to it yet" and never becomes a counted, actionable
-- fact. This migration closes that gap two ways:
--
--   1. reason_code — a fixed, low-effort vocabulary alongside the existing
--      free-text `reason`, so a missed/skipped dose says WHY (ran out, side
--      effects, felt fine, forgot, cost, other) instead of just THAT. This is
--      the single highest-signal, lowest-effort change for a Care
--      Coordinator deciding what to do about a miss — and self-report
--      literature (Morisky/MMAS-8's own design) treats an honest "I chose to
--      skip it" as more useful, not less, than a coerced "taken" — hence
--      'felt_fine' maps to status='skipped' at the UI layer
--      (todays-doses.tsx), not 'missed'.
--
--   2. 'unconfirmed' status + private.mark_unconfirmed_doses() — a grace-
--      period cron that marks a long-silent scheduled slot 'unconfirmed'
--      rather than leaving it in permanent limbo. Deliberately NOT 'missed':
--      this is an inferred absence, not a patient-confirmed fact, and
--      CLAUDE.md's own discipline elsewhere (never infer a doctor_tier, never
--      assume a null attribution) argues against ever auto-writing a
--      certainty-implying clinical status. private.evaluate_adherence_
--      escalation() (20260716175000) already only reacts to status='missed'
--      inserts, so 'unconfirmed' rows are structurally inert to the
--      coach/doctor escalation ladder — they only ever move the adherence-
--      rate denominator (see the companion medication_adherence_rate_rpc.sql
--      migration) and prompt a gentle, once-only nudge. The patient (or their
--      supporter, per 20260809232922) can still correct it at any time — the
--      existing select-then-upsert in useLogDose is keyed on the same
--      (medication_id, scheduled_for_date, scheduled_time) partial unique
--      index, so tapping Taken/Missed on an unconfirmed dose is just a normal
--      update, no new code path needed there.

-- ---------------------------------------------------------------------------
-- 1. Enum value — its own statement/migration per this codebase's own
--    convention (see 20260716170000_medication_source_specialist.sql's
--    header): a newly added enum label cannot be used by value in the same
--    transaction that adds it.
-- ---------------------------------------------------------------------------
alter type public.medication_log_status add value if not exists 'unconfirmed';

-- ---------------------------------------------------------------------------
-- 2. reason_code — nullable, fixed vocabulary, independent of the existing
--    free-text `reason` (which stays for elaboration, e.g. "other: ...").
--    Meaningful on 'missed'/'skipped' rows; left null for 'taken' and for the
--    cron's own 'unconfirmed' inserts (nobody has said why yet).
-- ---------------------------------------------------------------------------
alter table public.medication_logs
  add column reason_code text;

alter table public.medication_logs
  add constraint medication_logs_reason_code_check
  check (reason_code is null or reason_code in
    ('ran_out', 'side_effects', 'felt_fine', 'forgot', 'cost', 'other'));

comment on column public.medication_logs.reason_code is
  'Fixed-vocabulary reason for a missed/skipped dose, picked in the app alongside the existing free-text reason. felt_fine is the one deliberate-skip code — todays-doses.tsx maps it to status=''skipped'', every other code to status=''missed''. Null for taken doses and for the grace-period cron''s own unconfirmed inserts.';

-- ---------------------------------------------------------------------------
-- 3. Grace-period marker — daily-hours cadence (every 2 hours), not once a
--    day, so a slot doesn't sit ambiguous for up to 24h before the patient
--    sees it flip. Checks today's AND yesterday's Lagos-local scheduled slots
--    (CLAUDE.md: timezone always Africa/Lagos) so a late-evening dose isn't
--    missed by a run that lands just after local midnight.
-- ---------------------------------------------------------------------------
create or replace function private.mark_unconfirmed_doses()
returns void
language sql
security definer
set search_path = ''
as $$
  with lagos_today as (
    select (now() at time zone 'Africa/Lagos')::date as d
  ),
  candidate_dates as (
    select d from lagos_today
    union all
    select d - 1 from lagos_today
  ),
  scheduled as (
    select
      m.id as medication_id,
      m.patient_id,
      m.organisation_id,
      m.drug_name,
      m.created_at as medication_created_at,
      cd.d as scheduled_for_date,
      t.time_str as scheduled_time,
      ((cd.d::text || ' ' || t.time_str)::timestamp at time zone 'Africa/Lagos') as scheduled_instant
    from public.medications m
    cross join candidate_dates cd
    cross join lateral jsonb_array_elements_text(m.schedule_times) as t(time_str)
    where m.is_active
  ),
  due as (
    select s.*
    from scheduled s
    where s.scheduled_instant <= now() - interval '3 hours'
      -- Never retroactively flag a slot that predates the medication itself
      -- (e.g. a med added at 23:00 today must not spawn an "unconfirmed"
      -- 20:00-today or any yesterday dose that occurred before it existed).
      and s.scheduled_instant >= s.medication_created_at
      and not exists (
        select 1 from public.medication_logs l
        where l.medication_id = s.medication_id
          and l.scheduled_for_date = s.scheduled_for_date
          and l.scheduled_time = s.scheduled_time
      )
  ),
  inserted as (
    insert into public.medication_logs
      (organisation_id, patient_id, medication_id, status, scheduled_for_date, scheduled_time, logged_at)
    select organisation_id, patient_id, medication_id, 'unconfirmed', scheduled_for_date, scheduled_time, now()
    from due
    -- Race guard against the patient's own upsert landing between the
    -- NOT EXISTS check above and this insert — same partial unique index
    -- useLogDose relies on (20260706024722_medication_schedule_refills.sql).
    on conflict (medication_id, scheduled_for_date, scheduled_time) where scheduled_time is not null do nothing
    returning medication_id, patient_id, organisation_id, scheduled_for_date, scheduled_time
  ),
  -- One aggregated nudge per patient per run (not one per dose) — same
  -- shape as private.queue_care_outreach()'s aggregated nudge, so a patient
  -- with two same-time medications gets one message, not two.
  to_notify as (
    select
      i.organisation_id,
      i.patient_id,
      array_agg(distinct d.drug_name) as drug_names,
      count(*) as dose_count
    from inserted i
    join due d using (medication_id, scheduled_for_date, scheduled_time)
    group by i.organisation_id, i.patient_id
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'whatsapp', 'pending', 'medication_dose_unconfirmed_nudge',
      jsonb_build_object('drug_names', drug_names, 'dose_count', dose_count)
    from to_notify
    returning recipient_id
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select organisation_id, patient_id, 'in_app', 'pending', 'medication_dose_unconfirmed_nudge',
    jsonb_build_object('drug_names', drug_names, 'dose_count', dose_count)
  from to_notify;
$$;

select cron.schedule(
  'medication-unconfirmed-doses-grace-period',
  '15 */2 * * *',
  $$select private.mark_unconfirmed_doses();$$
);

-- ---------------------------------------------------------------------------
-- 4. Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'medication_log_status' and e.enumlabel = 'unconfirmed'
  ) then
    raise exception 'FAIL: medication_log_status is missing the unconfirmed value';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'medication_logs' and column_name = 'reason_code'
  ) then
    raise exception 'FAIL: medication_logs.reason_code was not created';
  end if;

  if not exists (
    select 1 from pg_proc where proname = 'mark_unconfirmed_doses' and pronamespace = 'private'::regnamespace
  ) then
    raise exception 'FAIL: private.mark_unconfirmed_doses was not created';
  end if;

  if not exists (
    select 1 from cron.job where jobname = 'medication-unconfirmed-doses-grace-period'
  ) then
    raise exception 'FAIL: medication-unconfirmed-doses-grace-period cron job was not scheduled';
  end if;

  raise notice 'PASS: reason_code + unconfirmed status + grace-period cron are in place';
end $$;
