-- Tarragon Health — Home Monitoring Platform: programmes, episodes, adherence.
--
-- Closes the gap the Alert System audit itself flagged: `overdue_monitoring`
-- (20260828013011) has no real generator today because "no source table
-- maps to it without inventing one" (20260828015618's own header) — the only
-- existing sources are two condition-specific, hard-coded sweeps
-- (private.flag_overdue_vitals for BP, private.flag_missing_glucose_logs for
-- diabetes glucose), each of which explicitly invites a proper "expected
-- cadence" model later (see flag_missing_glucose_logs.sql's own header).
-- This migration is that model — a generic Monitoring Episode/Schedule layer
-- so `overdue_monitoring` gets a real, patient/vital-specific event source,
-- and the platform gets the vocabulary the home-monitoring spec uses
-- (programme -> episode -> schedule -> adherence -> missed-reading workflow
-- -> escalation -> review).
--
-- Deliberately additive, not a replacement:
--   - private.flag_overdue_vitals / private.flag_missing_glucose_logs are
--     untouched. They are a blanket safety net over every active
--     hypertension/diabetes care_plan regardless of explicit enrollment;
--     this is a narrower, opt-in model for a clinician-defined measurement
--     schedule with a real start/end/review date. Both can fire for the same
--     patient — the alert system's own dedup (type_code:patient_id within
--     suppress_window_minutes, 20260828014055) already collapses same-day
--     duplicates, so this is not double-alerting in practice.
--   - Readings themselves still live only in vitals_readings — no dual
--     source of truth (same principle CLAUDE.md states for wearables/LPE
--     measurements). A schedule item tracks *expectation* (frequency,
--     acceptable range, escalation threshold, last-reading cache); the
--     actual values are always read from vitals_readings.
--   - Device assignment/return/logistics (spec §51.16-51.18) is intentionally
--     NOT built here — CLAUDE.md's 2026-08-02 founder decision is that
--     Tarragon does not sell/import/bundle/own BP cuffs or glucometers, so
--     there is no Tarragon-owned device fleet to assign, activate, or take
--     back. Patients pair their own BLE device via the existing
--     patient_devices table; that is unaffected by this migration.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'monitoring_episode_status') then
    create type public.monitoring_episode_status as enum ('active', 'completed', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'monitoring_missed_reason') then
    create type public.monitoring_missed_reason as enum
      ('forgot', 'travelling', 'device_problem', 'unwell', 'no_supplies', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'reading_feeling') then
    create type public.reading_feeling as enum ('well', 'slightly_unwell', 'unwell', 'severe_symptoms');
  end if;
end $$;

-- A monitoring episode's own "the window closed" event reuses the existing
-- care-plan review worklist (20260717223000) instead of a new one — see that
-- migration's own precedent in 20260827205255: "a second, parallel concept
-- would just be the same idea with a different name."
alter type public.care_plan_review_trigger_event add value if not exists 'monitoring_episode_review_due';

-- ---------------------------------------------------------------------------
-- monitoring_episodes — spec §51.15. The identifiable instance of a patient
-- being enrolled into a monitoring programme (§51.3): a purpose, a window,
-- a review date, a status. Clinician-authored, like care_plans itself.
-- ---------------------------------------------------------------------------
create table if not exists public.monitoring_episodes (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  care_plan_id    uuid references public.care_plans (id) on delete set null,
  condition       public.care_plan_condition,
  purpose         text not null,
  started_at      date not null default current_date,
  ends_at         date,
  review_date     date,
  status          public.monitoring_episode_status not null default 'active',
  -- §51.3's diabetes/heart-failure examples list "symptoms" alongside
  -- measurements. Symptoms are patient-initiated free text with no
  -- meaningful "expected cadence" (unlike a vital reading) — see the
  -- existing public.symptoms table — so this is a display/nudge flag on the
  -- patient dashboard, never a schedule_items row, and is never counted in
  -- adherence math.
  tracks_symptoms boolean not null default false,
  created_by      uuid references public.clinical_staff (id) on delete set null,
  completed_at    timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint monitoring_episodes_purpose_length check (char_length(purpose) between 1 and 200),
  constraint monitoring_episodes_ends_after_start check (ends_at is null or ends_at >= started_at)
);

create index if not exists monitoring_episodes_patient_idx
  on public.monitoring_episodes (patient_id, status);
create index if not exists monitoring_episodes_org_idx
  on public.monitoring_episodes (organisation_id);
create index if not exists monitoring_episodes_care_plan_idx
  on public.monitoring_episodes (care_plan_id) where care_plan_id is not null;

drop trigger if exists monitoring_episodes_set_updated_at on public.monitoring_episodes;
create trigger monitoring_episodes_set_updated_at
  before update on public.monitoring_episodes
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- monitoring_schedule_items — spec §51.4. One row per (episode, vital_type):
-- frequency, acceptable range, escalation criteria. The running
-- last_reading_at/consecutive_misses/escalated_at columns are the miss-
-- tracking state machine for §51.11.
-- ---------------------------------------------------------------------------
create table if not exists public.monitoring_schedule_items (
  id                          uuid primary key default gen_random_uuid(),
  episode_id                  uuid not null references public.monitoring_episodes (id) on delete cascade,
  -- Denormalized from the parent episode by the trigger below — never
  -- client-supplied — so RLS can check tenancy/ownership on this table
  -- directly instead of a subquery on every row.
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  patient_id                  uuid not null references public.profiles (id) on delete cascade,
  vital_type                  public.vital_type not null,
  times_per_day               smallint not null default 1,
  frequency_days              smallint not null default 1,
  -- Free-form, matching care_plans.target_ranges' own established style
  -- (e.g. {"systolic_max":135,"diastolic_max":85} or {"min":4,"max":7}) —
  -- shown to the patient/clinician for context; the actual red-flag
  -- classification is untouched and still lives in the vital-specific
  -- trigger engines (bp/spo2/temperature/glucose red-flag), never here.
  acceptable_range            jsonb not null default '{}'::jsonb,
  escalation_missed_threshold smallint not null default 3,
  consecutive_misses          smallint not null default 0,
  last_reading_at             timestamptz,
  last_miss_evaluated_on      date,
  escalated_at                timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (episode_id, vital_type),
  constraint monitoring_schedule_items_times_per_day_range check (times_per_day between 1 and 6),
  constraint monitoring_schedule_items_frequency_days_range check (frequency_days between 1 and 30),
  constraint monitoring_schedule_items_escalation_threshold_range
    check (escalation_missed_threshold between 1 and 14),
  constraint monitoring_schedule_items_consecutive_misses_not_negative check (consecutive_misses >= 0)
);

create index if not exists monitoring_schedule_items_patient_idx
  on public.monitoring_schedule_items (patient_id);
create index if not exists monitoring_schedule_items_org_idx
  on public.monitoring_schedule_items (organisation_id);
create index if not exists monitoring_schedule_items_episode_idx
  on public.monitoring_schedule_items (episode_id);

drop trigger if exists monitoring_schedule_items_set_updated_at on public.monitoring_schedule_items;
create trigger monitoring_schedule_items_set_updated_at
  before update on public.monitoring_schedule_items
  for each row execute function private.set_updated_at();

create or replace function private.stamp_monitoring_schedule_item_episode_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_patient uuid;
begin
  select organisation_id, patient_id into v_org, v_patient
  from public.monitoring_episodes where id = new.episode_id;

  if v_org is null then
    raise exception 'monitoring_episodes % not found', new.episode_id;
  end if;

  new.organisation_id := v_org;
  new.patient_id := v_patient;
  return new;
end;
$$;

comment on function private.stamp_monitoring_schedule_item_episode_fields() is
  'BEFORE INSERT on monitoring_schedule_items — organisation_id/patient_id are always derived from the parent episode, never trusted from the client, matching this codebase''s server-derived-attribution convention.';

drop trigger if exists monitoring_schedule_items_stamp_episode_fields on public.monitoring_schedule_items;
create trigger monitoring_schedule_items_stamp_episode_fields
  before insert on public.monitoring_schedule_items
  for each row execute function private.stamp_monitoring_schedule_item_episode_fields();

-- ---------------------------------------------------------------------------
-- monitoring_missed_reasons — spec §51.11's "reason requested" step. A
-- patient-writable, immutable log: at most one reason per (schedule item,
-- day). Staff can read it (context for the clinician_alerts row that a
-- repeated miss eventually raises); nobody updates or deletes it.
-- ---------------------------------------------------------------------------
create table if not exists public.monitoring_missed_reasons (
  id               uuid primary key default gen_random_uuid(),
  schedule_item_id uuid not null references public.monitoring_schedule_items (id) on delete cascade,
  episode_id       uuid not null references public.monitoring_episodes (id) on delete cascade,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  occurred_on      date not null default current_date,
  reason           public.monitoring_missed_reason not null,
  note             text,
  created_at       timestamptz not null default now(),
  unique (schedule_item_id, occurred_on),
  constraint monitoring_missed_reasons_note_length check (note is null or char_length(note) <= 500)
);

create index if not exists monitoring_missed_reasons_patient_idx
  on public.monitoring_missed_reasons (patient_id);
create index if not exists monitoring_missed_reasons_episode_idx
  on public.monitoring_missed_reasons (episode_id);

create or replace function private.stamp_monitoring_missed_reason_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_episode uuid;
  v_patient uuid;
  v_org     uuid;
begin
  select episode_id, patient_id, organisation_id into v_episode, v_patient, v_org
  from public.monitoring_schedule_items where id = new.schedule_item_id;

  if v_episode is null then
    raise exception 'monitoring_schedule_items % not found', new.schedule_item_id;
  end if;

  new.episode_id := v_episode;
  new.patient_id := v_patient;
  new.organisation_id := v_org;
  return new;
end;
$$;

drop trigger if exists monitoring_missed_reasons_stamp_fields on public.monitoring_missed_reasons;
create trigger monitoring_missed_reasons_stamp_fields
  before insert on public.monitoring_missed_reasons
  for each row execute function private.stamp_monitoring_missed_reason_fields();

-- ---------------------------------------------------------------------------
-- vitals_readings.feeling — spec §51.9, "How are you feeling?" captured
-- alongside the measurement itself. Deliberately a lightweight column here
-- rather than a merge with the separate `symptoms` table: symptoms are a
-- distinct, clinically-actionable red-flag pathway (severity 1-10, its own
-- red-flag trigger) and stay exactly as they are; this is only the four-
-- option, non-clinical context the patient sees right after logging.
-- ---------------------------------------------------------------------------
alter table public.vitals_readings
  add column if not exists feeling public.reading_feeling;

comment on column public.vitals_readings.feeling is
  'Optional "how are you feeling?" captured alongside the reading (spec §51.9) — well/slightly_unwell/unwell/severe_symptoms. Purely contextual; a red-flag symptom is still logged separately via public.symptoms so the existing severity-based escalation trigger fires.';

-- ---------------------------------------------------------------------------
-- Reset miss-tracking the moment a matching reading lands (spec §51.11:
-- resuming monitoring should clear the missed state, same auto-resolve
-- behaviour private.flag_overdue_vitals already has for its own alert).
-- ---------------------------------------------------------------------------
create or replace function private.reset_monitoring_schedule_on_reading()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.monitoring_schedule_items msi
  set last_reading_at = new.taken_at,
      consecutive_misses = 0,
      last_miss_evaluated_on = null,
      escalated_at = null,
      updated_at = now()
  from public.monitoring_episodes me
  where msi.episode_id = me.id
    and me.status = 'active'
    and msi.patient_id = new.patient_id
    and msi.vital_type = new.vital_type
    and (msi.last_reading_at is null or new.taken_at > msi.last_reading_at);
  return new;
end;
$$;

drop trigger if exists vitals_readings_reset_monitoring_schedule on public.vitals_readings;
create trigger vitals_readings_reset_monitoring_schedule
  after insert on public.vitals_readings
  for each row execute function private.reset_monitoring_schedule_on_reading();

-- ---------------------------------------------------------------------------
-- Adherence — spec §51.10 (expected / received / completion %). A
-- security_invoker view (same pattern as care_gap_view/patient_timeline_view)
-- so it carries no access of its own — the underlying tables' RLS decides
-- what a caller can see.
-- ---------------------------------------------------------------------------
create or replace view public.monitoring_schedule_adherence
with (security_invoker = true) as
select
  msi.id as schedule_item_id,
  msi.episode_id,
  msi.patient_id,
  msi.organisation_id,
  msi.vital_type,
  msi.times_per_day,
  msi.frequency_days,
  msi.consecutive_misses,
  msi.escalation_missed_threshold,
  msi.last_reading_at,
  me.purpose,
  me.started_at,
  me.status as episode_status,
  we.window_end,
  -- greatest(...,0): a schedule item created for a not-yet-started episode
  -- (started_at in the future) would otherwise divide by a negative count.
  greatest(ceil((we.window_end - me.started_at + 1)::numeric / msi.frequency_days), 0)::int * msi.times_per_day
    as expected_readings,
  vr.received_readings,
  round(
    least(
      100,
      vr.received_readings::numeric
        / nullif(greatest(ceil((we.window_end - me.started_at + 1)::numeric / msi.frequency_days), 0)::int * msi.times_per_day, 0)
        * 100
    ),
    1
  ) as adherence_pct
from public.monitoring_schedule_items msi
join public.monitoring_episodes me on me.id = msi.episode_id
cross join lateral (
  select least(coalesce(me.ends_at, current_date), current_date) as window_end
) we
cross join lateral (
  select count(*)::int as received_readings
  from public.vitals_readings v
  where v.patient_id = msi.patient_id
    and v.vital_type = msi.vital_type
    and v.taken_at::date between me.started_at and we.window_end
) vr;

comment on view public.monitoring_schedule_adherence is
  'Expected-vs-received reading counts per monitoring_schedule_items row (spec §51.10). Derived read-model over monitoring_schedule_items/monitoring_episodes/vitals_readings — no independent access control, relies on security_invoker + those tables'' own RLS.';

-- ---------------------------------------------------------------------------
-- Missed-monitoring sweep + escalation (spec §51.11) and episode completion
-- + review handoff (spec §51.4's review date / §51.15's episode lifecycle).
-- Reuses private.raise_clinician_alert (20260828015618) so this generator
-- goes through the exact same taxonomy/dedup/SLA machinery as every other
-- alert type, and reuses care_plan_review_prompts (20260717223000) for the
-- "review after completion" step instead of a new worklist.
-- ---------------------------------------------------------------------------
create or replace function private.flag_overdue_monitoring()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select
      msi.id, msi.patient_id, msi.organisation_id, msi.vital_type,
      msi.frequency_days, msi.escalation_missed_threshold, msi.consecutive_misses,
      msi.last_miss_evaluated_on, msi.last_reading_at, msi.escalated_at,
      me.started_at, me.purpose
    from public.monitoring_schedule_items msi
    join public.monitoring_episodes me on me.id = msi.episode_id
    where me.status = 'active'
      and current_date
        >= coalesce(msi.last_miss_evaluated_on, coalesce(msi.last_reading_at::date, me.started_at))
           + msi.frequency_days
  loop
    update public.monitoring_schedule_items
    set consecutive_misses = r.consecutive_misses + 1,
        last_miss_evaluated_on = current_date,
        updated_at = now()
    where id = r.id;

    if r.consecutive_misses + 1 >= r.escalation_missed_threshold and r.escalated_at is null then
      perform private.raise_clinician_alert(
        r.organisation_id,
        r.patient_id,
        'clinician_review'::public.alert_level,
        'Home monitoring readings overdue',
        format(
          '%s readings for "%s" have not been logged — %s expected reading(s) missed in a row. Check in: confirm the patient is well and help them resume monitoring.',
          r.vital_type::text, r.purpose, r.consecutive_misses + 1
        ),
        'care_management'::public.alert_category,
        'overdue_monitoring'::public.alert_type_code
      );

      update public.monitoring_schedule_items set escalated_at = now() where id = r.id;
    end if;
  end loop;

  -- Episode window closed -> completed, and enqueue a "review after
  -- completion" prompt on the existing care-plan review worklist (§51.4).
  update public.monitoring_episodes
  set status = 'completed', completed_at = now(), updated_at = now()
  where status = 'active'
    and ends_at is not null
    and ends_at < current_date;

  insert into public.care_plan_review_prompts
    (organisation_id, patient_id, care_plan_id, trigger_event_type, trigger_source_id, reason)
  select
    me.organisation_id, me.patient_id, me.care_plan_id,
    'monitoring_episode_review_due'::public.care_plan_review_trigger_event,
    me.id,
    format('Monitoring episode "%s" finished on %s — review the readings and confirm next steps.', me.purpose, me.ends_at)
  from public.monitoring_episodes me
  where me.status = 'completed'
    and me.completed_at >= now() - interval '1 day'
  on conflict (patient_id, trigger_event_type) where status = 'open'
  do update set trigger_source_id = excluded.trigger_source_id, reason = excluded.reason, created_at = now();
end;
$$;

comment on function private.flag_overdue_monitoring() is
  'Daily sweep: increments consecutive_misses on any monitoring_schedule_items row whose expected cadence has lapsed with no matching vitals_readings row, raises a care_management/overdue_monitoring clinician_alerts row via private.raise_clinician_alert once a schedule item''s own escalation_missed_threshold is crossed (reset by private.reset_monitoring_schedule_on_reading the moment a reading lands), and completes any monitoring_episodes whose ends_at has passed, enqueuing a care_plan_review_prompts row for it.';

do $$ begin
  perform cron.unschedule('monitoring-overdue-daily');
exception when others then null;
end $$;

select cron.schedule(
  'monitoring-overdue-daily',
  '15 7 * * *',
  $$select private.flag_overdue_monitoring();$$
);

-- ---------------------------------------------------------------------------
-- RLS — same three-clause read as care_plans/care_plan_goals (own / org
-- staff / consented sponsor); writes restricted to org staff for the
-- clinician-authored tables, and to the owning patient for the missed-reason
-- log (insert only — it is an immutable log, nobody updates or deletes it).
-- ---------------------------------------------------------------------------
alter table public.monitoring_episodes enable row level security;
alter table public.monitoring_schedule_items enable row level security;
alter table public.monitoring_missed_reasons enable row level security;

drop policy if exists monitoring_episodes_select on public.monitoring_episodes;
create policy monitoring_episodes_select on public.monitoring_episodes
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );
drop policy if exists monitoring_episodes_write on public.monitoring_episodes;
create policy monitoring_episodes_write on public.monitoring_episodes
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

drop policy if exists monitoring_schedule_items_select on public.monitoring_schedule_items;
create policy monitoring_schedule_items_select on public.monitoring_schedule_items
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );
drop policy if exists monitoring_schedule_items_write on public.monitoring_schedule_items;
create policy monitoring_schedule_items_write on public.monitoring_schedule_items
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

drop policy if exists monitoring_missed_reasons_select on public.monitoring_missed_reasons;
create policy monitoring_missed_reasons_select on public.monitoring_missed_reasons
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );
drop policy if exists monitoring_missed_reasons_insert on public.monitoring_missed_reasons;
create policy monitoring_missed_reasons_insert on public.monitoring_missed_reasons
  for insert to authenticated
  with check (
    exists (
      select 1 from public.monitoring_schedule_items msi
      where msi.id = schedule_item_id and msi.patient_id = (select auth.uid())
    )
  );

-- New tables need their own grant regardless of RLS — see CLAUDE.md's
-- standing "a freshly created table needs its own grant" lesson.
grant select, insert, update, delete on public.monitoring_episodes to authenticated;
grant select, insert, update, delete on public.monitoring_schedule_items to authenticated;
grant select, insert on public.monitoring_missed_reasons to authenticated;
grant select on public.monitoring_schedule_adherence to authenticated;

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'monitoring_episodes') then
    raise exception 'monitoring_episodes was not created';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'monitoring_schedule_items') then
    raise exception 'monitoring_schedule_items was not created';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'monitoring_missed_reasons') then
    raise exception 'monitoring_missed_reasons was not created';
  end if;
  if not exists (select 1 from information_schema.views where table_schema = 'public' and table_name = 'monitoring_schedule_adherence') then
    raise exception 'monitoring_schedule_adherence view was not created';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vitals_readings' and column_name = 'feeling') then
    raise exception 'vitals_readings.feeling was not added';
  end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'care_plan_review_trigger_event' and e.enumlabel = 'monitoring_episode_review_due'
  ) then
    raise exception 'care_plan_review_trigger_event.monitoring_episode_review_due was not added';
  end if;
  if not has_table_privilege('authenticated', 'public.monitoring_episodes', 'INSERT') then
    raise exception 'authenticated is missing INSERT on monitoring_episodes';
  end if;
  if not has_table_privilege('authenticated', 'public.monitoring_missed_reasons', 'INSERT') then
    raise exception 'authenticated is missing INSERT on monitoring_missed_reasons';
  end if;
end $$;
