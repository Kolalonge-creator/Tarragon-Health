-- Tarragon Health — drug-class lab monitoring (medication pathway, Phase 7)
--
-- Medication management is linked to investigation schedules: starting certain
-- drugs mandates specific lab monitoring (pathway):
--   • Metformin        → kidney function, every ~12 months
--   • ACE inhibitor    → kidney function + potassium, after initiation/dose change
--   • Statin           → liver function, when clinically indicated
--   • Warfarin         → INR, ongoing / clinically managed
--
-- This is a DIFFERENT driver from the condition-based screening_schedules
-- (age/sex/risk): it is triggered by a specific medication. So it gets its own
-- schedule table rather than overloading screening_schedules — the two answer
-- different questions and neither is the other's source of truth.
--
--   • drug_monitoring_rules — reference: drug_name ILIKE pattern → what to
--     monitor + cadence. `interval_months` null + monitor_on_initiation drives a
--     post-start baseline check; both null means "as clinically indicated" (a
--     flagged item with no fixed date, e.g. statin LFTs / warfarin INR).
--   • medication_lab_monitoring — the per-medication scheduled monitoring,
--     auto-created when a clinician/specialist medication is added.
-- All idempotent-guarded.

-- --- reference rules ---------------------------------------------------------
create table if not exists public.drug_monitoring_rules (
  id                    uuid primary key default gen_random_uuid(),
  match_pattern         text not null,      -- ILIKE against medications.drug_name
  drug_class            text not null,
  monitoring_label      text not null,
  interval_months       integer,            -- null → not on a fixed cadence
  monitor_on_initiation boolean not null default false,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  unique (match_pattern, monitoring_label)
);

insert into public.drug_monitoring_rules
  (match_pattern, drug_class, monitoring_label, interval_months, monitor_on_initiation)
values
  ('metformin%',     'Metformin',     'Kidney function (U&E, eGFR)',            12,   false),
  ('ramipril%',      'ACE inhibitor', 'Kidney function & potassium (U&E)',      null, true),
  ('lisinopril%',    'ACE inhibitor', 'Kidney function & potassium (U&E)',      null, true),
  ('enalapril%',     'ACE inhibitor', 'Kidney function & potassium (U&E)',      null, true),
  ('perindopril%',   'ACE inhibitor', 'Kidney function & potassium (U&E)',      null, true),
  ('captopril%',     'ACE inhibitor', 'Kidney function & potassium (U&E)',      null, true),
  ('atorvastatin%',  'Statin',        'Liver function (LFTs)',                  null, false),
  ('simvastatin%',   'Statin',        'Liver function (LFTs)',                  null, false),
  ('rosuvastatin%',  'Statin',        'Liver function (LFTs)',                  null, false),
  ('warfarin%',      'Warfarin',      'INR monitoring',                         null, false)
on conflict (match_pattern, monitoring_label) do nothing;

-- --- per-medication monitoring schedule --------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'lab_monitoring_status') then
    create type public.lab_monitoring_status as enum ('pending', 'completed', 'cancelled');
  end if;
end $$;

create table if not exists public.medication_lab_monitoring (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  medication_id     uuid not null references public.medications (id) on delete cascade,
  drug_class        text not null,
  monitoring_label  text not null,
  status            public.lab_monitoring_status not null default 'pending',
  due_date          date,               -- null → as clinically indicated
  completed_at      timestamptz,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (medication_id, monitoring_label)
);

create index if not exists medication_lab_monitoring_patient_idx on public.medication_lab_monitoring (patient_id);
create index if not exists medication_lab_monitoring_org_status_idx on public.medication_lab_monitoring (organisation_id, status, due_date);

drop trigger if exists medication_lab_monitoring_set_updated_at on public.medication_lab_monitoring;
create trigger medication_lab_monitoring_set_updated_at
  before update on public.medication_lab_monitoring
  for each row execute function private.set_updated_at();

alter table public.medication_lab_monitoring enable row level security;

drop policy if exists medication_lab_monitoring_select on public.medication_lab_monitoring;
create policy medication_lab_monitoring_select on public.medication_lab_monitoring
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists medication_lab_monitoring_insert on public.medication_lab_monitoring;
create policy medication_lab_monitoring_insert on public.medication_lab_monitoring
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
drop policy if exists medication_lab_monitoring_update on public.medication_lab_monitoring;
create policy medication_lab_monitoring_update on public.medication_lab_monitoring
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.medication_lab_monitoring to authenticated;

-- --- scheduler: a clinician/specialist medication auto-schedules monitoring ---
create or replace function private.schedule_medication_lab_monitoring()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_due date;
begin
  -- Patient self-added medications don't drive clinical monitoring.
  if new.source not in ('clinician', 'specialist') or not new.is_active then
    return new;
  end if;

  for r in
    select * from public.drug_monitoring_rules
    where is_active and new.drug_name ilike match_pattern
  loop
    -- Fixed cadence → due in interval_months; else post-initiation baseline
    -- (~14 days); else no fixed date ("as clinically indicated").
    v_due := case
      when r.interval_months is not null then current_date + (r.interval_months || ' months')::interval
      when r.monitor_on_initiation then current_date + interval '14 days'
      else null
    end;

    insert into public.medication_lab_monitoring
      (organisation_id, patient_id, medication_id, drug_class, monitoring_label, due_date)
    values
      (new.organisation_id, new.patient_id, new.id, r.drug_class, r.monitoring_label, v_due)
    on conflict (medication_id, monitoring_label) do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists medications_schedule_lab_monitoring on public.medications;
create trigger medications_schedule_lab_monitoring
  after insert on public.medications
  for each row execute function private.schedule_medication_lab_monitoring();
