-- Tarragon Health — Mental-health screening (AHC pathway §11)
--
-- Structured, validated depression / anxiety / alcohol screens
-- (PHQ-9 / GAD-7 / AUDIT-C) captured in the intake questionnaire. A screen is
-- reviewed by the doctor — never actioned by software alone. A PHQ-9 item-9
-- (self-harm) positive is an emergency red flag (§18.2) routed through the
-- existing emergency_events pathway via a new 'intake_screen' source.
--
-- Scores are engagement/triage telemetry for the doctor, NOT a diagnosis and
-- never fed into risk/escalation scoring — so this is its own table, computed
-- server-side and written by the system (service role), mirroring
-- prevention_risk_scores' staff-only-write model. Sensitive data: patient
-- reads their own; org staff read within the org (heightened-confidentiality
-- data, §22 — same RLS shape as the rest of the record).

alter type public.emergency_source add value if not exists 'intake_screen';

create table if not exists public.mental_health_screens (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  instrument       text not null check (instrument in ('phq9', 'gad7', 'auditc')),
  total_score      integer not null,
  severity_band    text not null,
  hazardous        boolean,              -- AUDIT-C only
  crisis_flagged   boolean not null default false,
  item_responses   jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists mental_health_screens_patient_idx
  on public.mental_health_screens (patient_id, created_at desc);

alter table public.mental_health_screens enable row level security;

-- Read: the patient (their own) or org staff. No insert/update/delete grant —
-- rows are computed server-side and written via the service role, so a client
-- can never post a spoofed score. Append-only history of each submission.
create policy mental_health_screens_select on public.mental_health_screens
  for select using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );
