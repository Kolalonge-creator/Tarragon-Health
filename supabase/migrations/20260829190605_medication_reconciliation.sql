-- Tarragon Health — medication safety pathway 64.3: medication
-- reconciliation as its own distinct event, not just editing the list.
--
-- Current medication list -> Patient confirms -> Clinician reconciles ->
-- Record updated. Before this, the closest thing on the platform was
-- Tier-1's "confirm & continue refill" (medications_confirm_refill,
-- 20260715190000), which only ever touches one medication's refill_date at
-- a time — it has never been a whole-list reconciliation event, and there
-- was no patient-confirmation step at all.
--
-- Modelled as one row per reconciliation episode rather than a status
-- machine with its own enum: medications_snapshot captures the ACTIVE list
-- at the moment the episode opens (server-derived from public.medications,
-- never client-supplied, so it can't be backdated or fabricated), then two
-- independent stamps fill in as the episode progresses. The ordering the
-- spec asks for (confirm, THEN reconcile) is enforced by a trigger, not
-- merely suggested by app flow: reconciled_at can never be set before
-- patient_confirmed_at. reconciled_by/reconciled_at are server-derived from
-- the caller's own clinical_staff row, same null-gated "ReviewedByDoctor"
-- pattern as medication_reviews/annual_reviews, and gated to a clinical
-- tier (private.is_clinical_tier, 20260812003707) so a Care Coordinator can
-- collect the patient's confirmation but cannot be recorded as the
-- clinician who reconciled it — same reasoning as
-- 20260812023543_review_completion_clinical_tier_gate.sql.

create table if not exists public.medication_reconciliations (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  patient_id           uuid not null references public.profiles (id) on delete cascade,
  medications_snapshot jsonb not null default '[]'::jsonb,
  patient_confirmed_at timestamptz,
  patient_note         text,
  reconciled_by        uuid references public.clinical_staff (id) on delete set null,
  reconciled_at        timestamptz,
  reconciliation_note  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index medication_reconciliations_patient_idx on public.medication_reconciliations (patient_id, created_at desc);
create index medication_reconciliations_org_open_idx on public.medication_reconciliations (organisation_id) where reconciled_at is null;

drop trigger if exists medication_reconciliations_set_updated_at on public.medication_reconciliations;
create trigger medication_reconciliations_set_updated_at
  before update on public.medication_reconciliations
  for each row execute function private.set_updated_at();

alter table public.medication_reconciliations enable row level security;

create policy medication_reconciliations_select on public.medication_reconciliations
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy medication_reconciliations_insert on public.medication_reconciliations
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy medication_reconciliations_update on public.medication_reconciliations
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update on public.medication_reconciliations to authenticated;

-- --- snapshot: the active list at the moment the episode opens ---------------
create or replace function private.snapshot_medication_reconciliation_list()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'medication_id', m.id, 'drug_name', m.drug_name, 'dose', m.dose,
           'frequency', m.frequency, 'source', m.source
         )), '[]'::jsonb)
    into new.medications_snapshot
  from public.medications m
  where m.patient_id = new.patient_id and m.is_active;

  return new;
end;
$$;

drop trigger if exists medication_reconciliations_snapshot on public.medication_reconciliations;
create trigger medication_reconciliations_snapshot
  before insert on public.medication_reconciliations
  for each row execute function private.snapshot_medication_reconciliation_list();

-- --- ordering guard + server-derived attribution -----------------------------
create or replace function private.stamp_medication_reconciliation_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  -- Patient confirmation: only stamps forward, patient_note may still be
  -- edited/added after (e.g. remembering a detail), so this only fires once.
  if new.patient_confirmed_at is not null and old.patient_confirmed_at is null then
    new.patient_confirmed_at := coalesce(new.patient_confirmed_at, now());
  elsif old.patient_confirmed_at is not null then
    -- Already confirmed: never let a later write move the confirmation time.
    new.patient_confirmed_at := old.patient_confirmed_at;
  end if;

  if new.reconciled_at is not null and old.reconciled_at is null then
    if new.patient_confirmed_at is null then
      raise exception 'The patient must confirm the medication list before a clinician can reconcile it' using errcode = '23514';
    end if;
    if not private.is_clinical_tier(new.organisation_id) then
      raise exception 'Only a clinical-tier member of the care team can reconcile a medication list. A Care Coordinator can collect the patient''s confirmation, but a doctor must reconcile it.'
        using errcode = '42501';
    end if;

    select id into v_staff_id
    from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = new.organisation_id
      and active;
    new.reconciled_at := now();
    new.reconciled_by := v_staff_id;
  elsif old.reconciled_at is not null then
    new.reconciled_at := old.reconciled_at;
    new.reconciled_by := old.reconciled_by;
  end if;

  return new;
end;
$$;

drop trigger if exists medication_reconciliations_stamp_transition on public.medication_reconciliations;
create trigger medication_reconciliations_stamp_transition
  before update on public.medication_reconciliations
  for each row execute function private.stamp_medication_reconciliation_transition();

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'medication_reconciliations'
  ) then
    raise exception 'medication_reconciliations table was not created';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'medication_reconciliations_snapshot'
      and tgrelid = 'public.medication_reconciliations'::regclass and not tgisinternal
  ) then
    raise exception 'medication_reconciliations_snapshot trigger was not created';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'medication_reconciliations_stamp_transition'
      and tgrelid = 'public.medication_reconciliations'::regclass and not tgisinternal
  ) then
    raise exception 'medication_reconciliations_stamp_transition trigger was not created';
  end if;

  raise notice 'PASS: medication_reconciliations table + snapshot + ordering-guarded stamping installed';
end $$;
