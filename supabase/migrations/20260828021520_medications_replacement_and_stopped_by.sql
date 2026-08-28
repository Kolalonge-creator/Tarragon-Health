-- Tarragon Health — medication change/discontinuation linkage (13.12/13.13)
--
-- docs/Tarragon_Health_Master_Operating_Plan_v4.md §8's "medication change"
-- flow (line 224) already works end-to-end at the data level — stop the old
-- row (stopped_at/stopped_reason, 20260716171000), insert the new one — but
-- the old<->new relationship today is only implicit (same patient, adjacent
-- dates). This adds the missing structural link plus who actually stopped a
-- medication (today only captured for the narrow Tier-1-refill-confirm path
-- via last_confirmed_by; a patient stopping their own row, or a Tier 2+
-- prescriber stopping a clinician row, left no stopper on file at all).
--
-- replaces_medication_id: set at prescribe time by whoever is creating the
-- replacement (a self-reference within the SAME patient's record only — a
-- trigger enforces that, since a plain FK can't). Nullable/optional: most
-- medications replace nothing. Reverse lookups ("what replaced this?") are a
-- plain query on this column, no new column needed on the old row.
--
-- stopped_by_profile_id: server-derived from auth.uid() the moment is_active
-- flips to false, same non-negotiable "never client-supplied attribution"
-- rule as added_by/last_confirmed_by/reviewed_by elsewhere in this schema.

alter table public.medications
  add column if not exists replaces_medication_id uuid references public.medications (id) on delete set null,
  add column if not exists stopped_by_profile_id  uuid references public.profiles (id) on delete set null;

create index if not exists medications_replaces_medication_idx on public.medications (replaces_medication_id);

-- --- same-patient guard (a plain FK can't express "same patient's record") ---
create or replace function private.enforce_medication_replacement_same_patient()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_patient uuid;
begin
  if new.replaces_medication_id is null then
    return new;
  end if;

  if new.replaces_medication_id = new.id then
    raise exception 'A medication cannot replace itself';
  end if;

  select patient_id into v_old_patient
  from public.medications
  where id = new.replaces_medication_id;

  if v_old_patient is null then
    raise exception 'replaces_medication_id does not reference an existing medication';
  end if;

  if v_old_patient <> new.patient_id then
    raise exception 'A medication can only replace another medication belonging to the same patient';
  end if;

  return new;
end;
$$;

drop trigger if exists medications_enforce_replacement_same_patient on public.medications;
create trigger medications_enforce_replacement_same_patient
  before insert or update of replaces_medication_id on public.medications
  for each row execute function private.enforce_medication_replacement_same_patient();

-- --- stopped_by_profile_id (server-derived) -----------------------------------
create or replace function private.stamp_medication_stopped_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active = false and old.is_active is distinct from false then
    new.stopped_by_profile_id := (select auth.uid());
  end if;
  return new;
end;
$$;

-- Named to sort after medications_enforce_confirm_only (BEFORE UPDATE
-- triggers on one table fire in alphabetical order by trigger name): if a
-- Tier 1 confirm-only write illegitimately tried to flip is_active, that
-- trigger has already raised and aborted the statement before this one runs.
drop trigger if exists medications_stamp_stopped_by on public.medications;
create trigger medications_stamp_stopped_by
  before update on public.medications
  for each row execute function private.stamp_medication_stopped_by();

-- --- extend the confirm-only protected-column list ----------------------------
-- Byte-for-byte the live definition from 20260827200208_prescription_workspace_
-- fields.sql, plus one more guarded column (see that migration's own header on
-- why every new medications column must join this list: without it, a Tier 1
-- refill-confirm write could silently attach/detach a replacement link under
-- the guise of "confirming a refill").
create or replace function private.enforce_medication_confirm_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_staff_id uuid;
begin
  -- Patient editing their own row: unrestricted, unchanged from prior behavior.
  if new.patient_id = (select auth.uid()) then
    return new;
  end if;

  -- Full prescribing authority (Tier 2+/Director): unrestricted, unchanged from prior behavior.
  if private.has_prescribing_authority(new.organisation_id) then
    return new;
  end if;

  -- Anyone else reaching this trigger passed medications_update's USING
  -- clause only via can_confirm_medication_refill — an active Tier 1
  -- doctor confirming/continuing an existing prescription. Restrict to
  -- refill confirmation: no drug, dose, frequency, schedule, active-status,
  -- prescription order-entry detail, or ownership changes.
  if old.source is distinct from 'clinician' then
    raise exception 'Only an existing clinician-prescribed medication can be confirmed and continued' using errcode = '42501';
  end if;

  if old.drug_name is distinct from new.drug_name
    or old.dose is distinct from new.dose
    or old.frequency is distinct from new.frequency
    or old.schedule_times is distinct from new.schedule_times
    or old.is_active is distinct from new.is_active
    or old.care_plan_id is distinct from new.care_plan_id
    or old.source is distinct from new.source
    or old.added_by is distinct from new.added_by
    or old.patient_id is distinct from new.patient_id
    or old.organisation_id is distinct from new.organisation_id
    or old.route is distinct from new.route
    or old.duration_days is distinct from new.duration_days
    or old.quantity is distinct from new.quantity
    or old.repeats_allowed is distinct from new.repeats_allowed
    or old.indication is distinct from new.indication
    or old.instructions is distinct from new.instructions
    or old.replaces_medication_id is distinct from new.replaces_medication_id
  then
    raise exception 'Confirming a prescription can only update the refill date — changing drug, dose, frequency, or status needs Tier 2 or above' using errcode = '42501';
  end if;

  select id into v_caller_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active;

  new.last_confirmed_at := now();
  new.last_confirmed_by := v_caller_staff_id;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'medications' and column_name = 'replaces_medication_id'
  ) then
    raise exception 'medications.replaces_medication_id was not added';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'medications' and column_name = 'stopped_by_profile_id'
  ) then
    raise exception 'medications.stopped_by_profile_id was not added';
  end if;

  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'enforce_medication_confirm_only' and pronamespace = 'private'::regnamespace;

  if v_def not like '%old.replaces_medication_id is distinct from new.replaces_medication_id%' then
    raise exception 'enforce_medication_confirm_only is missing the replaces_medication_id guard';
  end if;
  if v_def not like '%Confirming a prescription can only update the refill date%'
     or v_def not like '%Only an existing clinician-prescribed medication can be confirmed and continued%'
     or v_def not like '%private.has_prescribing_authority(new.organisation_id)%' then
    raise exception 'enforce_medication_confirm_only lost a pre-existing branch';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'medications_enforce_replacement_same_patient' and tgrelid = 'public.medications'::regclass
  ) then
    raise exception 'medications_enforce_replacement_same_patient trigger was not created';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'medications_stamp_stopped_by' and tgrelid = 'public.medications'::regclass
  ) then
    raise exception 'medications_stamp_stopped_by trigger was not created';
  end if;

  raise notice 'PASS: medications replacement linkage + stopped_by attribution installed';
end $$;
