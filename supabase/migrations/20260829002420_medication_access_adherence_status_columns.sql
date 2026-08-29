-- Tarragon Health — Module 21: Medication Access & Adherence Engine, part 1/7.
--
-- Module 13 (medications, medication_logs, refill reminders, adherence
-- check-ins/alerts, reviews, drug-class lab monitoring) answers "what is the
-- patient prescribed and are they logging doses." Module 21 is broader: can
-- the patient actually OBTAIN, AFFORD, understand, and consistently TAKE the
-- medication? That needs three independent status dimensions tracked per
-- active medication, not folded into the existing boolean is_active:
--   * clinical_status  — prescribed / changed / discontinued
--   * access_status    — can the patient physically/financially get it
--   * adherence_status — are they actually taking it (derived, not self-claimed)
--
-- clinical_status is additive and purely informational — it does not change
-- is_active's existing meaning or any existing RLS/trigger behaviour. It is
-- kept in sync by a new BEFORE UPDATE trigger that only ever fires after
-- private.enforce_medication_confirm_only (20260715181500) has already
-- decided whether the update is even allowed, so this trigger only needs to
-- look at what actually changed in NEW vs OLD, not re-derive authority.
--
-- access_status and adherence_status start at safe, honest defaults
-- ('available' / 'unknown') and are only ever written by later migrations'
-- SECURITY DEFINER triggers (part 2 for access_status, part 3 for
-- adherence_status) — never directly by a client update — so no new RLS
-- policy is needed on public.medications for either column.

create type public.medication_clinical_status as enum ('prescribed', 'changed', 'discontinued');

create type public.medication_access_status as enum (
  'available', 'out_of_stock', 'too_expensive', 'awaiting_payment', 'awaiting_delivery', 'unable_to_collect'
);

create type public.medication_adherence_status as enum ('taking', 'frequently_missed', 'not_taking', 'unknown');

alter table public.medications
  add column clinical_status public.medication_clinical_status not null default 'prescribed',
  add column access_status public.medication_access_status not null default 'available',
  add column adherence_status public.medication_adherence_status not null default 'unknown',
  add column adherence_pct_30d numeric(5, 1);

comment on column public.medications.clinical_status is
  'Module 21 §21.2. Kept in sync by private.sync_medication_clinical_status() — never client-settable. discontinued once stopped_at/is_active=false is set (matching the existing deactivation signal); changed when a real prescribing edit (dose/frequency/route/duration/quantity/repeats/instructions/indication/schedule_times) lands on an already-prescribed row; prescribed otherwise. A refill-only confirmation (private.enforce_medication_confirm_only''s whole reason for existing) never triggers "changed" — it deliberately touches none of those columns.';
comment on column public.medications.access_status is
  'Module 21 §21.2/21.3. Defaults to available; updated only by private.handle_medication_access_checkin() (part 2) reacting to a patient/staff-reported affordability check-in — never directly client-writable.';
comment on column public.medications.adherence_status is
  'Module 21 §21.2/21.9. Defaults to unknown; updated only by the adherence engine (part 3) from dose-log history, never claimed from dispensing/collection data alone (§21.9: "do not claim perfect adherence based solely on pharmacy dispensing").';
comment on column public.medications.adherence_pct_30d is
  'Trailing-window adherence percentage backing adherence_status, stored alongside it so the Module 21 dashboard view (part 7) never needs to recompute it live. Null when there is not enough data to estimate (adherence_status = unknown).';

-- Backfill existing rows: a medication already stopped is discontinued;
-- everything else starts prescribed (nobody has a "changed" history to infer
-- retroactively, and inventing one would misrepresent a change that was
-- never actually reviewed as such).
update public.medications
set clinical_status = 'discontinued'
where stopped_at is not null or not is_active;

-- ---------------------------------------------------------------------------
-- private.sync_medication_clinical_status() — BEFORE UPDATE
-- ---------------------------------------------------------------------------

create or replace function private.sync_medication_clinical_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.stopped_at is not null and old.stopped_at is null)
     or (new.is_active is false and old.is_active is true) then
    new.clinical_status := 'discontinued';
    return new;
  end if;

  -- A discontinued medication does not un-discontinue itself through this
  -- trigger; nothing in the app currently reactivates is_active, and if that
  -- ever changes it should be a deliberate, reviewed decision, not a side
  -- effect of an unrelated field edit.
  if old.clinical_status = 'discontinued' then
    return new;
  end if;

  if old.dose is distinct from new.dose
    or old.frequency is distinct from new.frequency
    or old.route is distinct from new.route
    or old.duration_days is distinct from new.duration_days
    or old.quantity is distinct from new.quantity
    or old.repeats_allowed is distinct from new.repeats_allowed
    or old.instructions is distinct from new.instructions
    or old.indication is distinct from new.indication
    or old.schedule_times is distinct from new.schedule_times
  then
    new.clinical_status := 'changed';
  end if;

  return new;
end;
$$;

comment on function private.sync_medication_clinical_status() is
  'BEFORE UPDATE on medications. Server-derives clinical_status from what actually changed — never client-settable. Runs alongside (order-independent of) private.enforce_medication_confirm_only, which already rejects any of these column changes from a caller without prescribing authority, so by the time this trigger sees a real change it is always a legitimate one.';

create trigger medications_sync_clinical_status
  before update on public.medications
  for each row execute function private.sync_medication_clinical_status();

do $$
begin
  if not exists (select 1 from pg_type where typname = 'medication_clinical_status') then
    raise exception 'medication_clinical_status enum was not created';
  end if;
  if not exists (select 1 from pg_type where typname = 'medication_access_status') then
    raise exception 'medication_access_status enum was not created';
  end if;
  if not exists (select 1 from pg_type where typname = 'medication_adherence_status') then
    raise exception 'medication_adherence_status enum was not created';
  end if;
  if exists (
    select 1 from public.medications
    where (stopped_at is not null or not is_active) and clinical_status <> 'discontinued'
  ) then
    raise exception 'backfill missed a stopped/inactive medication';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'medications_sync_clinical_status' and tgrelid = 'public.medications'::regclass and not tgisinternal
  ) then
    raise exception 'medications_sync_clinical_status trigger was not created';
  end if;
  raise notice 'PASS: medication_access_status/adherence_status/clinical_status columns + sync trigger installed';
end $$;
