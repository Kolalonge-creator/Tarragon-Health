-- Tarragon Health — prescription workspace: order-entry fields (5.10).
--
-- Care Team / Provider Workspace spec §5.10 ("Prescription workspace") asks
-- for route / duration / quantity / repeats / indication / instructions
-- alongside the existing drug/dose/frequency fields. All additive + nullable
-- (repeats_allowed defaults to 0), so every existing insert/update path and
-- every existing row is untouched.
--
-- Deliberately NOT building §5.11's literal "Draft -> Signed -> Sent to
-- patient -> Sent to pharmacy -> Dispensed" as a new status enum: Tarragon
-- dropped pharmacy routing entirely on 2026-08-03
-- (20260803132008_medication_collected_anywhere.sql — "keep the record, drop
-- the routing"; pharmacy_partners are all is_active = false). A "sent to
-- pharmacy" step would misrepresent a fulfilment path that no longer exists.
-- The app layer instead composes a status trail from data that already
-- exists, no new schema required for it:
--   Signed          -> medications.created_at / added_by (medications_insert
--                       already requires prescribing authority — see
--                       20260715181500_pharmacy_authority_by_tier.sql — so
--                       the row IS the signed order the moment it exists)
--   Patient notified -> automatic: medications_enqueue_prescribed_notifications
--                       (20260720120004_prescription_lab_order_patient_emails.sql)
--   Collected        -> pharmacy_order_dispenses.medication_id, added by the
--                       self-arranged-fulfilment migration referenced above
--
-- The new columns must be added to enforce_medication_confirm_only's
-- protected-column list. Without this, a Tier 1 doctor's refill-confirm-only
-- path (which legitimately reaches medications_update via
-- can_confirm_medication_refill) could silently rewrite prescribing detail
-- under the guise of "confirming a refill" — the exact class of gap
-- CLAUDE.md's standing lessons call out for any change touching clinical
-- authority. The function body below is otherwise byte-for-byte the live
-- definition from 20260715190000_medications_confirm_refill.sql; only the
-- new-column comparisons are added.

alter table public.medications
  add column if not exists route             text,
  add column if not exists duration_days     integer,
  add column if not exists quantity          text,
  add column if not exists repeats_allowed   integer not null default 0,
  add column if not exists indication        text,
  add column if not exists instructions      text;

alter table public.medications
  add constraint medications_route_length check (char_length(route) <= 100),
  add constraint medications_duration_days_positive check (duration_days is null or duration_days > 0),
  add constraint medications_quantity_length check (char_length(quantity) <= 100),
  add constraint medications_repeats_allowed_non_negative check (repeats_allowed >= 0),
  add constraint medications_indication_length check (char_length(indication) <= 300),
  add constraint medications_instructions_length check (char_length(instructions) <= 1000);

-- The prescription status trail's "Signed by" step needs added_by populated,
-- but the normal prescribe path (useAddMedication) never set it — only the
-- FHIR-import review path did (20260807084925_fhir_interop_import_review.sql,
-- explicitly `added_by = (select auth.uid())`), so every ordinary
-- clinician-prescribed row has always carried a null added_by.
--
-- Unconditionally overwritten, not merely defaulted when null: a "Signed by
-- Dr. X" UI element is exactly the class of trust claim
-- docs/CLINICAL_TRUST_MODEL_SPEC.md requires be "structurally impossible" to
-- falsify, matching how last_confirmed_by is never client-supplied
-- elsewhere in this schema. If added_by were only filled-when-null, nothing
-- would stop a client from posting an arbitrary added_by and having it
-- displayed as if that person had prescribed it. Harmless for the FHIR-import
-- path, which already only ever sets it to the caller's own id.
create or replace function private.stamp_medication_added_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.added_by := (select auth.uid());
  return new;
end;
$$;

drop trigger if exists medications_stamp_added_by on public.medications;
create trigger medications_stamp_added_by
  before insert on public.medications
  for each row execute function private.stamp_medication_added_by();

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
    where table_schema = 'public' and table_name = 'medications' and column_name = 'route'
  ) then
    raise exception 'medications.route was not added';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'medications' and column_name = 'instructions'
  ) then
    raise exception 'medications.instructions was not added';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'medications' and column_name = 'repeats_allowed'
      and is_nullable = 'NO'
  ) then
    raise exception 'medications.repeats_allowed was not added as NOT NULL';
  end if;

  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'enforce_medication_confirm_only' and pronamespace = 'private'::regnamespace;

  if v_def not like '%old.route is distinct from new.route%'
     or v_def not like '%old.instructions is distinct from new.instructions%' then
    raise exception 'enforce_medication_confirm_only is missing the new-column guard';
  end if;
  -- Every pre-existing branch must survive the rewrite.
  if v_def not like '%Confirming a prescription can only update the refill date%'
     or v_def not like '%Only an existing clinician-prescribed medication can be confirmed and continued%'
     or v_def not like '%private.has_prescribing_authority(new.organisation_id)%' then
    raise exception 'enforce_medication_confirm_only lost a pre-existing branch';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'medications_stamp_added_by' and tgrelid = 'public.medications'::regclass
  ) then
    raise exception 'medications_stamp_added_by trigger was not created';
  end if;
end $$;
