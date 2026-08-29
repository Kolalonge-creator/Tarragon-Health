-- Tarragon Health — Risk & Prevention Engine enhancement, 6/7
-- Automatic risk reassessment on new information (spec §2.1, §2.14):
-- "Risk should automatically recalculate when relevant information
-- changes" — new diagnosis, abnormal result, pregnancy, hospital discharge,
-- major weight change.
--
-- Scoring itself (computeRiskFromConfig / the legacy computeRiskTiers
-- fallback) is TypeScript, not SQL — it has been since prevention_risk_scores
-- existed, and stays that way; a DB trigger cannot call it directly. So the
-- pattern here is: lightweight, fast DB triggers on the five source events
-- below do nothing but INSERT one row into a new queue table (never
-- computation, never blocking the source transaction), and a daily cron
-- (apps/web/src/app/api/cron/risk-reassessment, see the accompanying app
-- commit) drains the queue by calling the exact same
-- computePreventionRiskScores() function submitRiskAssessment already uses
-- — no new scoring logic, only a new trigger source for the existing one.
--
-- Deliberately does NOT touch private.handle_abnormal_screening_result()
-- or its trigger (screening_results_abnormal_handler) — per CLAUDE.md,
-- "never deprioritise or silently swallow an abnormal screening result
-- event." The abnormal-result reassessment hook below is a BRAND NEW,
-- independent AFTER INSERT trigger on the same table/event, which this
-- codebase already does six times over on screening_results alone
-- (screening_results_timeline, _care_plan_review, _advance_serology,
-- _maybe_result_order, _refresh_schedule, _close_exposure_reports) with no
-- conflicts — a seventh is the same well-trodden pattern, not a risk.
--
-- A patient with no risk_assessment_responses on file yet has nothing to
-- reassess — the cron consumer is a no-op for them (queueing still happens;
-- it's cheap and gives a complete audit trail of what tried to trigger a
-- recalculation, even before the patient's first assessment).

-- Tarragon Health — Risk & Prevention Engine enhancement, 6/7. Committed to
-- git but never actually applied to production — found and fixed alongside
-- my_provider_performance_rpc/note_templates. Content below is
-- byte-identical to the committed 20260827205131_risk_reassessment_queue.sql.

create type public.reassessment_reason as enum (
  'new_diagnosis', 'abnormal_result', 'hospital_discharge', 'pregnancy_life_stage', 'major_weight_change'
);

create table public.risk_reassessment_queue (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  reason            public.reassessment_reason not null,
  source_table      text not null,
  source_id         uuid,
  requested_at      timestamptz not null default now(),
  processed_at      timestamptz,
  created_at        timestamptz not null default now()
);

create index risk_reassessment_queue_unprocessed_idx
  on public.risk_reassessment_queue (patient_id) where processed_at is null;
create index risk_reassessment_queue_org_idx on public.risk_reassessment_queue (organisation_id);

alter table public.risk_reassessment_queue enable row level security;

create policy risk_reassessment_queue_select on public.risk_reassessment_queue
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy risk_reassessment_queue_update on public.risk_reassessment_queue
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));
create policy risk_reassessment_queue_delete on public.risk_reassessment_queue
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, update, delete on public.risk_reassessment_queue to authenticated;

create or replace function private.queue_reassessment_on_new_diagnosis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'active' or (tg_op = 'UPDATE' and old.status = 'active') then
    return new;
  end if;

  insert into public.risk_reassessment_queue
    (organisation_id, patient_id, reason, source_table, source_id)
  values
    (new.organisation_id, new.patient_id, 'new_diagnosis', 'care_plans', new.id);

  return new;
end;
$$;

drop trigger if exists care_plans_queue_reassessment on public.care_plans;
create trigger care_plans_queue_reassessment
  after insert or update of status on public.care_plans
  for each row execute function private.queue_reassessment_on_new_diagnosis();

create or replace function private.queue_reassessment_on_abnormal_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.result_status not in ('abnormal', 'critical') then
    return new;
  end if;

  insert into public.risk_reassessment_queue
    (organisation_id, patient_id, reason, source_table, source_id)
  values
    (new.organisation_id, new.patient_id, 'abnormal_result', 'screening_results', new.id);

  return new;
end;
$$;

drop trigger if exists screening_results_queue_reassessment on public.screening_results;
create trigger screening_results_queue_reassessment
  after insert on public.screening_results
  for each row execute function private.queue_reassessment_on_abnormal_result();

create or replace function private.queue_reassessment_on_hospital_discharge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.discharged_on is null then
    return new;
  end if;

  insert into public.risk_reassessment_queue
    (organisation_id, patient_id, reason, source_table, source_id)
  values
    (new.organisation_id, new.patient_id, 'hospital_discharge', 'patient_hospital_admissions', new.id);

  return new;
end;
$$;

drop trigger if exists patient_hospital_admissions_queue_reassessment on public.patient_hospital_admissions;
create trigger patient_hospital_admissions_queue_reassessment
  after update on public.patient_hospital_admissions
  for each row
  when (old.discharged_on is null and new.discharged_on is not null)
  execute function private.queue_reassessment_on_hospital_discharge();

drop trigger if exists patient_hospital_admissions_queue_reassessment_on_insert on public.patient_hospital_admissions;
create trigger patient_hospital_admissions_queue_reassessment_on_insert
  after insert on public.patient_hospital_admissions
  for each row
  when (new.discharged_on is not null)
  execute function private.queue_reassessment_on_hospital_discharge();

create or replace function private.queue_reassessment_on_life_stage_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.life_stage not in ('pregnant', 'postpartum') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.life_stage = new.life_stage then
    return new;
  end if;

  insert into public.risk_reassessment_queue
    (organisation_id, patient_id, reason, source_table, source_id)
  values
    (new.organisation_id, new.patient_id, 'pregnancy_life_stage', 'reproductive_health_profiles', new.id);

  return new;
end;
$$;

drop trigger if exists reproductive_health_profiles_queue_reassessment on public.reproductive_health_profiles;
create trigger reproductive_health_profiles_queue_reassessment
  after insert or update of life_stage on public.reproductive_health_profiles
  for each row execute function private.queue_reassessment_on_life_stage_change();

create or replace function private.queue_reassessment_on_major_weight_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_weight numeric(5, 2);
  v_pct_change numeric;
begin
  if new.vital_type <> 'weight' or new.weight_kg is null then
    return new;
  end if;

  select weight_kg into v_previous_weight
  from public.vitals_readings
  where patient_id = new.patient_id
    and vital_type = 'weight'
    and weight_kg is not null
    and id <> new.id
    and taken_at < new.taken_at
  order by taken_at desc
  limit 1;

  if v_previous_weight is null or v_previous_weight = 0 then
    return new;
  end if;

  v_pct_change := abs(new.weight_kg - v_previous_weight) / v_previous_weight * 100;

  if v_pct_change >= 5 then
    insert into public.risk_reassessment_queue
      (organisation_id, patient_id, reason, source_table, source_id)
    values
      (new.organisation_id, new.patient_id, 'major_weight_change', 'vitals_readings', new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists vitals_readings_queue_reassessment on public.vitals_readings;
create trigger vitals_readings_queue_reassessment
  after insert on public.vitals_readings
  for each row
  when (new.vital_type = 'weight')
  execute function private.queue_reassessment_on_major_weight_change();

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'risk_reassessment_queue'
  ) then
    raise exception 'FAIL: risk_reassessment_queue was not created';
  end if;

  if (select count(*) from pg_trigger where tgname in (
    'care_plans_queue_reassessment',
    'screening_results_queue_reassessment',
    'patient_hospital_admissions_queue_reassessment',
    'patient_hospital_admissions_queue_reassessment_on_insert',
    'reproductive_health_profiles_queue_reassessment',
    'vitals_readings_queue_reassessment'
  )) <> 6 then
    raise exception 'FAIL: not all six reassessment triggers were installed';
  end if;

  raise notice 'PASS: risk_reassessment_queue installed with 6 triggers across 5 event sources';
end $$;
