-- ===========================================================================
-- Diabetes Clinical Pathway — Sprint C (part 1): foot-risk classification +
-- metformin B12 monitoring
-- ---------------------------------------------------------------------------
-- §18.1: "a foot assessment at diagnosis and at least annually ... to classify
-- risk (low / increased / high / active problem)." §24 sets a KPI on it
-- (% with an up-to-date foot-risk classification ≥ 95%). This adds the
-- clinician-performed foot exam record. §8.2/§13.5: long-term metformin needs
-- periodic B12 — added as a second monitoring rule for metformin.
-- ===========================================================================

-- --- G13: metformin → vitamin B12 (§8.2, §13.5) ----------------------------
-- drug_monitoring_rules is unique on (match_pattern, monitoring_label), so a
-- second metformin rule (B12) coexists with the existing renal rule.
insert into public.drug_monitoring_rules
  (match_pattern, drug_class, monitoring_label, interval_months, monitor_on_initiation)
values
  ('metformin%', 'Metformin', 'Vitamin B12 (long-term metformin)', 24, false)
on conflict (match_pattern, monitoring_label) do nothing;

-- --- G10: diabetic foot-risk classification (§18.1, §24) --------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'foot_risk_class') then
    create type public.foot_risk_class as enum ('low', 'increased', 'high', 'active');
  end if;
  if not exists (select 1 from pg_type where typname = 'foot_sensation') then
    create type public.foot_sensation as enum ('normal', 'reduced', 'absent');
  end if;
end $$;

create table if not exists public.diabetic_foot_assessments (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  -- server-derived from the acting clinician's clinical_staff row, never trusted
  -- from the client (same rule as reviewed_by elsewhere).
  assessed_by     uuid references public.clinical_staff (id) on delete set null,
  risk_class      public.foot_risk_class not null,
  sensation_left  public.foot_sensation,
  sensation_right public.foot_sensation,
  pulses_present  boolean,
  findings        text,
  assessed_at     timestamptz not null default now(),
  -- when the next foot check is due (annual for low/increased; sooner for
  -- high; an active problem is managed through the escalation path, not a date).
  next_due_at     date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists diabetic_foot_assessments_patient_idx
  on public.diabetic_foot_assessments (patient_id, assessed_at desc);
create index if not exists diabetic_foot_assessments_org_idx
  on public.diabetic_foot_assessments (organisation_id);
create index if not exists diabetic_foot_assessments_due_idx
  on public.diabetic_foot_assessments (next_due_at);

drop trigger if exists diabetic_foot_assessments_set_updated_at on public.diabetic_foot_assessments;
create trigger diabetic_foot_assessments_set_updated_at
  before update on public.diabetic_foot_assessments
  for each row execute function private.set_updated_at();

alter table public.diabetic_foot_assessments enable row level security;

-- Patient reads their own classification; org clinical staff read all and are
-- the only writers (a foot exam is a clinical act — no patient write).
drop policy if exists diabetic_foot_assessments_select on public.diabetic_foot_assessments;
create policy diabetic_foot_assessments_select on public.diabetic_foot_assessments
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists diabetic_foot_assessments_insert on public.diabetic_foot_assessments;
create policy diabetic_foot_assessments_insert on public.diabetic_foot_assessments
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
drop policy if exists diabetic_foot_assessments_update on public.diabetic_foot_assessments;
create policy diabetic_foot_assessments_update on public.diabetic_foot_assessments
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.diabetic_foot_assessments to authenticated;
