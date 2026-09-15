-- Tarragon Health — Electronic Prescription & Prescription Management Engine.
--
-- 20260827200208_prescription_workspace_fields.sql already closed most of the
-- prescription-lifecycle spec (order-entry detail, a composed status trail —
-- see medications-list.tsx's PrescriptionStatusTrail — deliberately without a
-- literal "sent to pharmacy" step, because pharmacy order-routing was
-- dropped 2026-08-03, 20260803132008_medication_collected_anywhere.sql,
-- "keep the record, drop the routing"). This migration closes what's left of
-- the schema gap, still without resurrecting that routing:
--   §62.8 tamper protection  -> rx_number + verification_code
--   §62.9 expiry             -> expires_at
--   §62.14 amendments        -> version / previous_version_id / superseded_at
--     (private.amend_medication(), next migration, is what actually creates
--     a new version — this migration only adds the columns it writes to)
--
-- Clinician-sourced prescriptions only (source = 'clinician'): a patient's
-- self-logged medication or a specialist-attributed row the patient typed in
-- is not a Tarragon-issued prescription in the tamper-protection/
-- verification sense — those already carry their own "Started by
-- {prescriber_name}" attribution instead of a signed-prescription trail.

create sequence private.medication_rx_number_seq;

alter table public.medications
  add column if not exists rx_number          text unique,
  add column if not exists verification_code  text,
  add column if not exists expires_at         timestamptz,
  add column if not exists version            integer not null default 1,
  add column if not exists previous_version_id uuid references public.medications (id) on delete set null,
  add column if not exists superseded_at      timestamptz,
  add column if not exists amendment_reason   text;

alter table public.medications
  add constraint medications_version_positive check (version > 0),
  add constraint medications_amendment_reason_length check (char_length(amendment_reason) <= 300);

create index if not exists medications_rx_number_idx
  on public.medications (rx_number) where rx_number is not null;
create index if not exists medications_previous_version_idx
  on public.medications (previous_version_id) where previous_version_id is not null;

comment on column public.medications.rx_number is
  'Tamper-evident prescription identifier, spec §62.8 (e.g. TRG-RX-2026-000123). Assigned once, at insert, for clinician-sourced prescriptions only — never reassigned on amendment; see version/previous_version_id for lineage instead.';
comment on column public.medications.verification_code is
  'Short random code a pharmacy must present alongside rx_number to public.verify_prescription() — stops rx_number (a predictable sequence) alone from being enough to look up an arbitrary patient''s prescription.';
comment on column public.medications.expires_at is
  'Prescription validity window, spec §62.9. A policy default, not a legal citation — see private.stamp_prescription_lifecycle() below. MDCN/NAFDAC-specific validity periods remain an open founder item, same standing caveat as the tier-authority model (CLAUDE.md).';
comment on column public.medications.version is
  'Amendment lineage, spec §62.14. 1 for an original prescription; private.amend_medication() (next migration) increments this on the new row it creates and points previous_version_id back at the row it replaces.';
comment on column public.medications.previous_version_id is
  'The prescription this row amends, if any. Set only by private.amend_medication() — never client-writable (protected by enforce_medication_confirm_only below, same as every other order-entry column).';
comment on column public.medications.superseded_at is
  'When this row stopped being the operative version because private.amend_medication() created a newer version. NULL for the current version. Distinct from stopped_at (the medication was discontinued outright) — a superseded row''s replacement may still be active.';
comment on column public.medications.amendment_reason is
  'Why this version replaced its predecessor (required by private.amend_medication()). NULL on an original (version 1) prescription.';

-- ---------------------------------------------------------------------------
-- Assignment: rx_number / verification_code / expires_at — clinician-sourced
-- prescriptions only, set once at insert, never reassigned.
-- ---------------------------------------------------------------------------

create or replace function private.stamp_prescription_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source = 'clinician' then
    if new.rx_number is null then
      new.rx_number := 'TRG-RX-' || extract(year from now())::text || '-'
        || lpad(nextval('private.medication_rx_number_seq')::text, 6, '0');
    end if;
    if new.verification_code is null then
      new.verification_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    end if;
    if new.expires_at is null then
      -- A repeat prescription (repeats_allowed > 0) is chronic-therapy
      -- intent — 6 months, matching this platform's own chronic-condition
      -- review cadence (medication_review_cadences: HTN 6mo). A one-off
      -- course validates for its stated duration plus a 30-day collection
      -- grace period. With neither signal, a conservative 90-day default
      -- applies. All three are policy defaults, not legal citations (see the
      -- column comment) — nothing in the UI overrides expires_at explicitly
      -- yet, but the column supports it.
      if coalesce(new.repeats_allowed, 0) > 0 then
        new.expires_at := now() + interval '6 months';
      elsif new.duration_days is not null then
        new.expires_at := now() + make_interval(days => new.duration_days) + interval '30 days';
      else
        new.expires_at := now() + interval '90 days';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists medications_stamp_prescription_lifecycle on public.medications;
create trigger medications_stamp_prescription_lifecycle
  before insert on public.medications
  for each row execute function private.stamp_prescription_lifecycle();

-- ---------------------------------------------------------------------------
-- Extend the Tier 1 refill-confirm-only guard to the new columns — the same
-- obligation 20260827200208_prescription_workspace_fields.sql documented: a
-- column left out of enforce_medication_confirm_only's comparison list is
-- open by default to a Tier 1 "just confirming the refill" write. Function
-- body is otherwise byte-for-byte the live definition; only the new-column
-- comparisons are added.
-- ---------------------------------------------------------------------------

create or replace function private.enforce_medication_confirm_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_staff_id uuid;
begin
  if new.patient_id = (select auth.uid()) then
    return new;
  end if;

  if private.has_prescribing_authority(new.organisation_id) then
    return new;
  end if;

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
    or old.rx_number is distinct from new.rx_number
    or old.verification_code is distinct from new.verification_code
    or old.expires_at is distinct from new.expires_at
    or old.version is distinct from new.version
    or old.previous_version_id is distinct from new.previous_version_id
    or old.superseded_at is distinct from new.superseded_at
    or old.amendment_reason is distinct from new.amendment_reason
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
    where table_schema = 'public' and table_name = 'medications' and column_name = 'rx_number'
  ) then
    raise exception 'medications.rx_number was not added';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'medications' and column_name = 'version'
      and is_nullable = 'NO'
  ) then
    raise exception 'medications.version was not added as NOT NULL';
  end if;

  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'enforce_medication_confirm_only' and pronamespace = 'private'::regnamespace;

  if v_def not like '%old.rx_number is distinct from new.rx_number%'
     or v_def not like '%old.previous_version_id is distinct from new.previous_version_id%'
     or v_def not like '%old.expires_at is distinct from new.expires_at%' then
    raise exception 'enforce_medication_confirm_only is missing the new-column guard';
  end if;
  -- Every pre-existing branch must survive the rewrite.
  if v_def not like '%Confirming a prescription can only update the refill date%'
     or v_def not like '%private.has_prescribing_authority(new.organisation_id)%'
     or v_def not like '%old.route is distinct from new.route%' then
    raise exception 'enforce_medication_confirm_only lost a pre-existing branch';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'medications_stamp_prescription_lifecycle' and tgrelid = 'public.medications'::regclass
  ) then
    raise exception 'medications_stamp_prescription_lifecycle trigger was not created';
  end if;
end $$;
