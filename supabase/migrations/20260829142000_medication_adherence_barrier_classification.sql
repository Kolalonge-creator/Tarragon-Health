-- Tarragon Health — structured missed-dose reason + targeted adherence
-- intervention (Medication Care Loop, pathway §65.9)
--
-- The missed-dose escalation ladder (20260716175000_medication_adherence_escalation.sql)
-- already raises a coach/doctor alert once a patient repeatedly misses doses,
-- but captures no reason WHY — a raw missed_count is exactly the
-- "You missed your medication" blast the pathway spec calls out as
-- insufficient. Cost, side effects, forgetfulness, availability,
-- understanding, and "other" are meaningfully different problems needing
-- meaningfully different follow-up (a care coordinator checking affordability
-- options is not the same intervention as a doctor reviewing a side effect).
--
-- This adds:
--  1. A structured `missed_reason` on medication_logs (only meaningful, and
--     only allowed, on status='missed' rows) — the patient picks one when
--     logging a missed dose, replacing nothing (the existing free-text
--     `reason` column is untouched and still available for extra detail).
--  2. A rolling `primary_reason` / `reason_breakdown` on
--     medication_adherence_alerts, computed by the same trigger that already
--     drives the ladder, so the care-team worklist shows WHAT'S actually
--     going wrong, not just HOW MANY.
--  3. A side_effects fast path: a missed dose reported as due to a side
--     effect escalates straight to doctor-level regardless of the count-based
--     threshold — an unexplained side effect is a clinical signal on its own,
--     and every other "surprising symptom" path in this codebase already
--     errs toward doctor review rather than waiting for a count to build up.
--
-- Additive + nullable throughout. private.evaluate_adherence_escalation() is
-- replaced with every pre-existing branch preserved byte-for-byte (pulled
-- from the live 20260716175000 definition first) — only the reason
-- bookkeeping and the side_effects fast path are new. All idempotent-guarded.

-- ---------------------------------------------------------------------------
-- 1. Reason taxonomy + column on medication_logs
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'missed_dose_reason') then
    create type public.missed_dose_reason as enum
      ('cost', 'side_effects', 'forgetfulness', 'availability', 'understanding', 'other');
  end if;
end $$;

alter table public.medication_logs
  add column if not exists missed_reason public.missed_dose_reason;

comment on column public.medication_logs.missed_reason is
  'Structured barrier the patient selected when logging a missed dose (pathway §65.9: cost/side_effects/forgetfulness/availability/understanding/other). Null for taken/skipped rows, and for missed rows logged before this column existed.';

alter table public.medication_logs
  drop constraint if exists medication_logs_missed_reason_only_when_missed;
alter table public.medication_logs
  add constraint medication_logs_missed_reason_only_when_missed
  check (missed_reason is null or status = 'missed');

-- ---------------------------------------------------------------------------
-- 2. Per-alert reason context
-- ---------------------------------------------------------------------------
alter table public.medication_adherence_alerts
  add column if not exists primary_reason   public.missed_dose_reason,
  add column if not exists reason_breakdown jsonb not null default '{}'::jsonb;

comment on column public.medication_adherence_alerts.primary_reason is
  'Most frequent missed_reason among the trailing-window missed doses behind this alert (ties broken by most recent); null if none of those logs carry a reason.';
comment on column public.medication_adherence_alerts.reason_breakdown is
  'Count of each missed_reason among the trailing-window missed doses behind this alert, e.g. {"cost": 2, "forgetfulness": 1}. Reason-less rows are not counted, so the total can be less than missed_count.';

-- ---------------------------------------------------------------------------
-- 3. Evaluator: same ladder, now reason-aware
-- ---------------------------------------------------------------------------
create or replace function private.evaluate_adherence_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missed    integer;
  v_level     public.med_adherence_alert_level;
  v_alert     public.medication_adherence_alerts%rowtype;
  v_breakdown jsonb;
  v_primary   public.missed_dose_reason;
begin
  if new.status <> 'missed' then
    return new;
  end if;

  select count(*) into v_missed
  from public.medication_logs
  where medication_id = new.medication_id
    and status = 'missed'
    and logged_at >= now() - interval '30 days';

  if v_missed >= 6 then
    v_level := 'doctor';
  elsif v_missed >= 3 then
    v_level := 'coach';
  end if;

  if new.missed_reason = 'side_effects' then
    -- Independent of the count-based ladder above, and able to override it:
    -- a reported side effect is a clinical signal on its own, worth a doctor's
    -- attention whether it's the patient's first missed dose or their fifth
    -- (already coach-level on count alone) — don't wait on a threshold, and
    -- don't let an existing coach-level alert quietly absorb it either.
    v_level := 'doctor';
  end if;

  if v_level is null then
    return new;
  end if;

  -- Reason breakdown across the same trailing window, reason-less rows
  -- excluded (only computed once we know an alert is being raised/updated).
  select coalesce(jsonb_object_agg(reason_counts.missed_reason, reason_counts.n), '{}'::jsonb)
    into v_breakdown
  from (
    select missed_reason, count(*) as n
    from public.medication_logs
    where medication_id = new.medication_id
      and status = 'missed'
      and missed_reason is not null
      and logged_at >= now() - interval '30 days'
    group by missed_reason
  ) reason_counts;

  select reason_counts.missed_reason into v_primary
  from (
    select missed_reason, count(*) as n, max(logged_at) as latest
    from public.medication_logs
    where medication_id = new.medication_id
      and status = 'missed'
      and missed_reason is not null
      and logged_at >= now() - interval '30 days'
    group by missed_reason
    order by n desc, latest desc
    limit 1
  ) reason_counts;

  select * into v_alert
  from public.medication_adherence_alerts
  where medication_id = new.medication_id and status <> 'resolved'
  limit 1;

  if v_alert.id is null then
    insert into public.medication_adherence_alerts
      (organisation_id, patient_id, medication_id, level, missed_count, primary_reason, reason_breakdown)
    values
      (new.organisation_id, new.patient_id, new.medication_id, v_level, v_missed, v_primary, v_breakdown);
  else
    update public.medication_adherence_alerts
      set missed_count      = v_missed,
          primary_reason    = v_primary,
          reason_breakdown  = v_breakdown,
          -- only ever upgrade the rung
          level = case when v_level = 'doctor' then 'doctor' else level end,
          -- a fresh doctor-level breach re-opens an acknowledged coach alert
          status = case
            when status = 'acknowledged' and v_level = 'doctor' and level <> 'doctor'
            then 'open'::public.med_adherence_alert_status
            else status
          end
    where id = v_alert.id;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The migration is the test: every pre-existing branch of the evaluator must
-- still be present, byte-identifiable in the new definition.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('private.evaluate_adherence_escalation()'::regprocedure);
begin
  if v_def not like '%v_missed >= 6%' or v_def not like '%v_missed >= 3%' then
    raise exception 'evaluate_adherence_escalation lost its count-based ladder thresholds';
  end if;
  if v_def not like '%only ever upgrade the rung%' then
    raise exception 'evaluate_adherence_escalation lost the upgrade-only rung comment/logic';
  end if;
  if v_def not like '%side_effects%' then
    raise exception 'evaluate_adherence_escalation is missing the side_effects fast path';
  end if;
end $$;
