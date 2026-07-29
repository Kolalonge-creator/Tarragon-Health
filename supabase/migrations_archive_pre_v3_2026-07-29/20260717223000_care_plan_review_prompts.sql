-- Tarragon Health — care-plan review prompts
--
-- Closes the "care plan updated" node of the care-coordination pathway
-- WITHOUT ever writing to care_plans itself — per
-- docs/CLINICAL_TRUST_MODEL_SPEC.md a doctor authors every care-plan change.
-- Instead this is a clinician-facing worklist: whenever an upstream clinical
-- event suggests a patient's plan may be stale, a structural trigger enqueues
-- a prompt here. A clinician reviews the patient's context, makes whatever
-- change is warranted through the existing patient page, then marks the
-- prompt reviewed/dismissed — that status transition, and only that, is what
-- this table records.
--
-- Upstream sources (four AFTER INSERT/UPDATE triggers, mirroring the
-- structural-trigger pattern already used for e.g.
-- private.evaluate_adherence_escalation / private.handle_abnormal_screening_result):
--   1. screening_results  — abnormal/critical result (the Cat 2->1 pipeline).
--      This is a SEPARATE, additive trigger from
--      private.handle_abnormal_screening_result — that pipeline's doctor
--      WhatsApp alert + 4h SLA is untouched; this only adds a "review the
--      plan too" prompt to a different worklist.
--   2. medication_adherence_alerts — reaching the doctor rung (level='doctor').
--   3. care_plan_recommendations — a new proposed programme (new diagnosis /
--      risk-tier signal already computed by the onboarding risk engine).
--   4. patient_risk_scores — a risk_level that changed to high/very_high
--      relative to that patient+score_type's own previous reading (guarded
--      so a repeat computation at the same tier doesn't re-spam).
--   5. patient_hospital_admissions — discharge. NOTE: a discharge already
--      raises a 'Review care plan after hospital discharge' clinician_alerts
--      row via private.handle_hospital_discharge (escalations worklist,
--      unmodified here) — this trigger is additive and surfaces the SAME
--      event on the dedicated care-plan-review worklist a doctor actually
--      works from when deciding on plan changes.
--
-- Dedup: at most one OPEN prompt per (patient, trigger_event_type) — a
-- partial unique index backs an upsert, so a second event of the same kind
-- refreshes the existing open prompt's context instead of piling up.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'care_plan_review_trigger_event') then
    create type public.care_plan_review_trigger_event as enum (
      'abnormal_lab_result',
      'missed_medication',
      'new_diagnosis',
      'risk_tier_change',
      'hospital_discharge'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'care_plan_review_prompt_status') then
    create type public.care_plan_review_prompt_status as enum ('open', 'actioned', 'dismissed');
  end if;
end;
$$;

create table if not exists public.care_plan_review_prompts (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  -- Left null at creation — the prompt surfaces context for a clinician to go
  -- decide which plan (if any) needs a change; it never resolves that link
  -- itself. Not an FK to a specific care_plans row on purpose.
  care_plan_id       uuid references public.care_plans (id) on delete set null,
  trigger_event_type public.care_plan_review_trigger_event not null,
  -- No FK: the source row lives in a different table per event type
  -- (screening_results / medication_adherence_alerts /
  -- care_plan_recommendations / patient_risk_scores / patient_hospital_admissions).
  trigger_source_id  uuid not null,
  reason             text not null,
  status             public.care_plan_review_prompt_status not null default 'open',
  actioned_by        uuid references public.clinical_staff (id) on delete set null,
  actioned_at        timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists care_plan_review_prompts_org_idx
  on public.care_plan_review_prompts (organisation_id, status);
create index if not exists care_plan_review_prompts_patient_idx
  on public.care_plan_review_prompts (patient_id);

-- One open prompt per (patient, trigger_event_type) — the enqueue upsert
-- targets this exact index.
create unique index if not exists care_plan_review_prompts_one_open
  on public.care_plan_review_prompts (patient_id, trigger_event_type)
  where status = 'open';

alter table public.care_plan_review_prompts enable row level security;

-- Internal care-team worklist only — patient sees nothing here (no patient
-- select policy at all, same as medication_adherence_alerts).
drop policy if exists care_plan_review_prompts_select on public.care_plan_review_prompts;
create policy care_plan_review_prompts_select on public.care_plan_review_prompts
  for select to authenticated
  using (private.is_org_staff(organisation_id));

drop policy if exists care_plan_review_prompts_update on public.care_plan_review_prompts;
create policy care_plan_review_prompts_update on public.care_plan_review_prompts
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

-- No insert grant: rows are only ever created by the SECURITY DEFINER
-- trigger functions below, never directly by a client.
grant select, update on public.care_plan_review_prompts to authenticated;

-- --- actioned_by/actioned_at attribution (server-derived, never client-supplied) ---
create or replace function private.stamp_care_plan_review_prompt_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  if new.status <> 'open' and old.status = 'open' then
    select id into v_staff_id
    from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = new.organisation_id
      and active;
    new.actioned_by := v_staff_id;
    new.actioned_at := coalesce(new.actioned_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists care_plan_review_prompts_stamp_action on public.care_plan_review_prompts;
create trigger care_plan_review_prompts_stamp_action
  before update on public.care_plan_review_prompts
  for each row execute function private.stamp_care_plan_review_prompt_action();

-- --- shared enqueue helper (upsert, dedupe on the partial unique index) ------
create or replace function private.enqueue_care_plan_review_prompt(
  p_organisation_id uuid,
  p_patient_id uuid,
  p_event public.care_plan_review_trigger_event,
  p_source_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.care_plan_review_prompts
    (organisation_id, patient_id, trigger_event_type, trigger_source_id, reason)
  values
    (p_organisation_id, p_patient_id, p_event, p_source_id, p_reason)
  on conflict (patient_id, trigger_event_type) where status = 'open'
  do update set
    trigger_source_id = excluded.trigger_source_id,
    reason = excluded.reason,
    created_at = now();
end;
$$;

-- --- 1. abnormal lab / screening result ---------------------------------------
create or replace function private.care_plan_review_from_abnormal_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.result_status not in ('abnormal', 'critical') then
    return new;
  end if;

  perform private.enqueue_care_plan_review_prompt(
    new.organisation_id,
    new.patient_id,
    'abnormal_lab_result',
    new.id,
    format(
      'Abnormal screening result (%s) on %s.%s',
      new.result_status,
      to_char(new.created_at, 'YYYY-MM-DD'),
      case when new.result_summary is not null then ' ' || new.result_summary else '' end
    )
  );
  return new;
end;
$$;

drop trigger if exists screening_results_care_plan_review on public.screening_results;
create trigger screening_results_care_plan_review
  after insert on public.screening_results
  for each row execute function private.care_plan_review_from_abnormal_result();

-- --- 2. repeated missed medication reaching the doctor rung -------------------
create or replace function private.care_plan_review_from_missed_medication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.level <> 'doctor' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.level = 'doctor' then
    -- Already at the doctor rung — don't refresh on every unrelated update.
    return new;
  end if;

  perform private.enqueue_care_plan_review_prompt(
    new.organisation_id,
    new.patient_id,
    'missed_medication',
    new.id,
    format(
      'Repeated missed doses (%s in %s days) escalated to doctor review.',
      new.missed_count, new.window_days
    )
  );
  return new;
end;
$$;

drop trigger if exists medication_adherence_alerts_care_plan_review_insert
  on public.medication_adherence_alerts;
create trigger medication_adherence_alerts_care_plan_review_insert
  after insert on public.medication_adherence_alerts
  for each row execute function private.care_plan_review_from_missed_medication();

drop trigger if exists medication_adherence_alerts_care_plan_review_update
  on public.medication_adherence_alerts;
create trigger medication_adherence_alerts_care_plan_review_update
  after update on public.medication_adherence_alerts
  for each row execute function private.care_plan_review_from_missed_medication();

-- --- 3. new diagnosis / suggested programme (care_plan_recommendations) ------
create or replace function private.care_plan_review_from_new_diagnosis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'proposed' then
    return new;
  end if;

  perform private.enqueue_care_plan_review_prompt(
    new.organisation_id,
    new.patient_id,
    'new_diagnosis',
    new.id,
    format('New care-programme recommendation (%s): %s', new.condition, new.rationale)
  );
  return new;
end;
$$;

drop trigger if exists care_plan_recommendations_care_plan_review
  on public.care_plan_recommendations;
create trigger care_plan_recommendations_care_plan_review
  after insert on public.care_plan_recommendations
  for each row execute function private.care_plan_review_from_new_diagnosis();

-- --- 4. risk-tier change (patient_risk_scores) --------------------------------
create or replace function private.care_plan_review_from_risk_tier_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_level public.risk_level;
begin
  if new.risk_level is null or new.risk_level not in ('high', 'very_high') then
    return new;
  end if;

  select risk_level into v_previous_level
  from public.patient_risk_scores
  where patient_id = new.patient_id
    and score_type = new.score_type
    and id <> new.id
    and computed_at <= new.computed_at
  order by computed_at desc
  limit 1;

  if v_previous_level is not distinct from new.risk_level then
    -- Same tier as the patient's last reading of this score type — nothing
    -- new for a clinician to act on, don't re-spam an already-actioned prompt.
    return new;
  end if;

  perform private.enqueue_care_plan_review_prompt(
    new.organisation_id,
    new.patient_id,
    'risk_tier_change',
    new.id,
    format('%s risk score moved to %s.', new.score_type, new.risk_level)
  );
  return new;
end;
$$;

drop trigger if exists patient_risk_scores_care_plan_review on public.patient_risk_scores;
create trigger patient_risk_scores_care_plan_review
  after insert on public.patient_risk_scores
  for each row execute function private.care_plan_review_from_risk_tier_change();

-- --- 5. hospital discharge -----------------------------------------------------
create or replace function private.care_plan_review_from_hospital_discharge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.discharged_on is null then
    return new;
  end if;

  perform private.enqueue_care_plan_review_prompt(
    new.organisation_id,
    new.patient_id,
    'hospital_discharge',
    new.id,
    format(
      'Discharged on %s (admitted %s). Review whether the care plan needs updating.',
      new.discharged_on, new.admitted_on
    )
  );
  return new;
end;
$$;

drop trigger if exists patient_hospital_admissions_care_plan_review_update
  on public.patient_hospital_admissions;
create trigger patient_hospital_admissions_care_plan_review_update
  after update on public.patient_hospital_admissions
  for each row
  when (old.discharged_on is null and new.discharged_on is not null)
  execute function private.care_plan_review_from_hospital_discharge();

drop trigger if exists patient_hospital_admissions_care_plan_review_insert
  on public.patient_hospital_admissions;
create trigger patient_hospital_admissions_care_plan_review_insert
  after insert on public.patient_hospital_admissions
  for each row
  when (new.discharged_on is not null)
  execute function private.care_plan_review_from_hospital_discharge();
