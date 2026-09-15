-- Tarragon Health — medication safety pathway 64.20/64.21: "I cannot afford
-- this medicine" / structured access-barrier tracking.
--
-- 64.20: a patient reporting an affordability or access problem must trigger
-- a human pathway (lower-cost options, pharmacy alternatives, clinician
-- review, assistance programmes, insurance options) — Tarragon must NEVER
-- independently substitute the prescribed treatment just because it's
-- cheaper. This migration only ever raises a clinician_alerts row for a
-- human to act on; it has no capability to change a prescription itself.
--
-- 64.21: the reason is a structured enum (not free text), because the whole
-- point per the spec is that this "becomes valuable population-health
-- data" — that only works if reasons are countable/groupable, not prose.
--
-- One row per report (not a single mutable "current barrier" per
-- medication): a patient may report being unable to afford a medicine, then
-- later report a different reason (pharmacy too far) for the same
-- medicine — both are real, both are worth keeping for the population-health
-- signal the spec calls out, so this is an append-only log like
-- medication_logs, not an upsert-style status field.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'medication_access_barrier_reason') then
    create type public.medication_access_barrier_reason as enum (
      'unavailable', 'expensive', 'pharmacy_too_far', 'delivery_unavailable',
      'forgot', 'side_effects', 'didnt_understand_instructions'
    );
  end if;
end $$;

create table if not exists public.medication_access_barriers (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  medication_id     uuid not null references public.medications (id) on delete cascade,
  reason            public.medication_access_barrier_reason not null,
  note              text,
  reported_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index medication_access_barriers_patient_idx on public.medication_access_barriers (patient_id, reported_at desc);
create index medication_access_barriers_medication_idx on public.medication_access_barriers (medication_id);
create index medication_access_barriers_org_reason_idx on public.medication_access_barriers (organisation_id, reason);

alter table public.medication_access_barriers enable row level security;

-- Patient reports and reads their own; org staff read/manage for their org.
-- No update/delete for the patient — a report is a point-in-time fact, like
-- medication_logs; correcting it means reporting again, not editing history.
create policy medication_access_barriers_select on public.medication_access_barriers
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy medication_access_barriers_insert on public.medication_access_barriers
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert on public.medication_access_barriers to authenticated;

-- --- validation: medication_id must actually belong to patient_id -----------
-- The INSERT RLS policy only checks patient_id = auth.uid() (or org staff);
-- nothing stops a client from pairing that with an arbitrary medication_id
-- otherwise. Enforced here rather than trusted to every future caller
-- (patient self-report today, a future staff-entered path tomorrow).
create or replace function private.validate_medication_access_barrier_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.medications
    where id = new.medication_id and patient_id = new.patient_id
  ) then
    raise exception 'medication_id does not belong to patient_id' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists medication_access_barriers_validate_ownership on public.medication_access_barriers;
create trigger medication_access_barriers_validate_ownership
  before insert on public.medication_access_barriers
  for each row execute function private.validate_medication_access_barrier_ownership();

-- --- generator: every report reaches the care team ---------------------------
-- Every report, not just the "severe" ones: 64.20's pathway (lower-cost
-- options, pharmacy alternatives, clinician review, assistance programmes,
-- insurance options) is inherently a human-coordinated response for any of
-- the 7 reasons, not a threshold-triggered escalation like the missed-dose
-- ladder. 'clinician_review' level, matching pharmacy_problem's own
-- precedent for a comparable "medication access gap" concern (not
-- 'urgent_escalation' — this is a logistics/coordination gap, not a safety
-- emergency; not 'routine' — going without a chronic medication is a real
-- risk that deserves more than the lowest tier).
create or replace function private.raise_medication_access_barrier_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_drug text;
begin
  select drug_name into v_drug from public.medications where id = new.medication_id;

  perform private.raise_clinician_alert(
    new.organisation_id, new.patient_id, 'clinician_review',
    format('Medication access barrier: %s', replace(new.reason::text, '_', ' ')),
    format('Patient reported they could not obtain/take %s. Reason: %s.%s Tarragon does not substitute the prescribed treatment automatically — this needs a clinician or care coordinator to review lower-cost/alternative-pharmacy/assistance-programme options with the patient.',
      coalesce(v_drug, 'a medication'), replace(new.reason::text, '_', ' '),
      case when new.note is not null and length(trim(new.note)) > 0 then ' Patient note: ' || new.note || '.' else '' end),
    'medication', 'medication_access_barrier'
  );

  return new;
end;
$$;

drop trigger if exists medication_access_barriers_raise_alert on public.medication_access_barriers;
create trigger medication_access_barriers_raise_alert
  after insert on public.medication_access_barriers
  for each row execute function private.raise_medication_access_barrier_alert();

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from pg_enum where enumtypid = 'public.medication_access_barrier_reason'::regtype) <> 7 then
    raise exception 'medication_access_barrier_reason must have exactly 7 values';
  end if;

  if not exists (select 1 from pg_enum where enumtypid = 'public.alert_type_code'::regtype and enumlabel = 'medication_access_barrier') then
    raise exception 'medication_access_barrier is missing from alert_type_code — run 20260829155516 first';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'medication_access_barriers_raise_alert'
      and tgrelid = 'public.medication_access_barriers'::regclass and not tgisinternal
  ) then
    raise exception 'medication_access_barriers_raise_alert trigger was not created';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'medication_access_barriers_validate_ownership'
      and tgrelid = 'public.medication_access_barriers'::regclass and not tgisinternal
  ) then
    raise exception 'medication_access_barriers_validate_ownership trigger was not created';
  end if;

  raise notice 'PASS: medication_access_barriers table + ownership guard + alert generator installed';
end $$;
