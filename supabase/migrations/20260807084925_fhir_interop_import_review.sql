-- Tarragon Health — FHIR interoperability, part 2: partner import review.
--
-- WHY THIS EXISTS. An HMO or hospital that already holds a Tarragon partner
-- API key can now POST a FHIR R4 Bundle for one of our patients
-- (apps/web/src/app/api/integrations/fhir/import). This is the "ingest"
-- half of the interoperability promise ("export any patient's record as
-- FHIR; ingest from an HMO or hospital that can emit it").
--
-- THE SAFETY LINE, and it is the same one case_review_actions and the lab
-- pipeline already draw, applied to a new source of unreviewed data:
--
--   * NOTHING A PARTNER SENDS IS EVER AUTHORITATIVE ON ARRIVAL.
--     fhir_import_batches stores the raw Bundle for audit/replay.
--     fhir_import_proposed_resources stores one row per recognised Bundle
--     entry, born 'proposed' and clinically inert. Only a named, tiered
--     clinician confirming a row ever writes to vitals_readings /
--     patient_allergies / medications / vaccination_records — see the
--     attribution trigger below, which performs that write itself so
--     "check authority, then write" is one atomic step.
--
--   * THE IMPORT SURFACE IS STRUCTURALLY NARROWER THAN THE EXPORT SURFACE.
--     fhir_import_resource_type only has 4 values (Observation,
--     AllergyIntolerance, MedicationStatement, MedicationRequest,
--     Immunization) — deliberately fewer than what export can produce.
--     A Bundle entry of any other resourceType never reaches this table;
--     the import route tallies it in fhir_import_batches.skip_reasons
--     instead, so it is recorded, never silently dropped, but also never
--     an insertable "resource_type" here. Widening this list later is a
--     migration, not a config flag, on purpose.
--
--   * ATTRIBUTION IS STRUCTURAL. A confirmed/modified row cannot exist
--     without a named, active clinical_staff signer — the CHECK below plus
--     enforce_fhir_import_resource_attribution derive the signer
--     server-side from the caller's own session, never from client input.
--     Same "RLS admits, trigger narrows" split as case_review_actions:
--     the UPDATE policy is deliberately broad (any org staff), and the
--     trigger is what actually excludes care_coordinator and requires an
--     assigned tier.
--
--   * TERMINAL MEANS TERMINAL. Once confirmed/modified/dismissed a row is
--     immutable — changing your mind means a corrected re-send from the
--     partner (which supersedes the still-proposed row, see the unique
--     index below), not an edited history.
--
--   * AUTHORITY FOR v1: any active, tiered, non-care_coordinator clinical
--     staff member may confirm any of the 4 resource types. Recording an
--     externally-reported reading/allergy/medication/immunization is
--     documentation, not a new clinical order — medications.source already
--     allows a bare patient-reported entry with no prescribing authority
--     today, so requiring more for a clinician-reviewed import would be
--     inconsistent. There is deliberately no generic "required_authority"
--     enum here (unlike case_review_actions, which has 5 heterogeneous
--     action types needing different gates) — if a future resource type
--     needs a narrower authority, add a check keyed on resource_type, not
--     a column every other caller has to fill in with the same value.
--
--   * vaccination_records CARRIES NO PROVENANCE COLUMN OF ITS OWN (only
--     verification_status). Confirming an imported Immunization reuses the
--     EXISTING verification workflow — verification_status='verified',
--     verified_by/verified_at set to the confirming clinician — rather than
--     inventing a parallel provenance marker. "Came from a FHIR import" is
--     recoverable only via fhir_import_proposed_resources.result_table/
--     result_id, which is fine: this table is the one place that fact
--     needs to live.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.fhir_import_resource_type as enum (
  'Observation', 'AllergyIntolerance', 'MedicationStatement', 'MedicationRequest', 'Immunization'
);

create type public.fhir_import_resource_status as enum (
  'proposed', 'confirmed', 'modified', 'dismissed', 'superseded'
);

-- ---------------------------------------------------------------------------
-- fhir_import_batches — one immutable row per partner POST
-- ---------------------------------------------------------------------------

create table public.fhir_import_batches (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  api_key_id              uuid not null references public.api_keys (id) on delete restrict,
  patient_id              uuid not null references public.profiles (id) on delete restrict,

  source_system           text,
  fhir_bundle_identifier  text,

  raw_bundle              jsonb not null,
  resource_counts         jsonb not null default '{}'::jsonb,
  skip_reasons            jsonb not null default '[]'::jsonb,

  received_at             timestamptz not null default now()
);

comment on table public.fhir_import_batches is
  'One row per partner FHIR Bundle POST. Evidence, never authoritative -- the actual clinical facts it may contain only reach the record via fhir_import_proposed_resources after a named clinician confirms each one.';
comment on column public.fhir_import_batches.raw_bundle is
  'The Bundle exactly as received, for audit and reprocessing. Never read by anything downstream of the import route itself.';
comment on column public.fhir_import_batches.skip_reasons is
  'Bundle entries whose resourceType is out of the v1 import allow-list, or that otherwise failed to parse -- recorded here so nothing is silently dropped, without needing a resource_type value this table does not support.';

-- Org-scoped, not key-scoped: a key rotation must not reopen the dedupe
-- window for a partner's legitimate retry of the same Bundle.
create unique index fhir_import_batches_org_bundle_idx
  on public.fhir_import_batches (organisation_id, fhir_bundle_identifier)
  where fhir_bundle_identifier is not null;

create index fhir_import_batches_patient_idx
  on public.fhir_import_batches (patient_id, received_at desc);

alter table public.fhir_import_batches enable row level security;

create policy fhir_import_batches_select on public.fhir_import_batches
  for select to authenticated
  using (private.is_org_staff(organisation_id));

-- No INSERT/UPDATE/DELETE policy: written only by the service-role import
-- route, and never updated after insert -- stricter than
-- fhir_import_proposed_resources below, which a clinician does act on.

-- A freshly created table gets `authenticated=arwd` from this project's own
-- ALTER DEFAULT PRIVILEGES fix (the "new table needs its own grant" lesson
-- in CLAUDE.md) -- that default grants ALL FOUR verbs, not just SELECT.
-- RLS with no INSERT/UPDATE/DELETE policy already blocks those operations
-- in practice, but the table's actual privilege set should say what it
-- means rather than rely on RLS as the only barrier -- explicit revoke,
-- then grant back exactly what's intended.
revoke insert, update, delete on public.fhir_import_batches from authenticated;
grant select on public.fhir_import_batches to authenticated;

-- ---------------------------------------------------------------------------
-- fhir_import_proposed_resources — one row per recognised Bundle entry
-- ---------------------------------------------------------------------------

create table public.fhir_import_proposed_resources (
  id                    uuid primary key default gen_random_uuid(),
  batch_id              uuid not null references public.fhir_import_batches (id) on delete cascade,
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete restrict,

  resource_type         public.fhir_import_resource_type not null,
  status                public.fhir_import_resource_status not null default 'proposed',

  -- Pinned to the one legal value -- only the import route may ever insert
  -- a proposal. Same structural guarantee as case_review_actions.source.
  source text not null default 'fhir_partner_import',
  constraint fhir_import_proposed_resources_source_is_partner_import
    check (source = 'fhir_partner_import'),

  fhir_resource_id      text,
  raw_resource          jsonb not null,
  normalized_payload    jsonb not null,
  confirmed_payload     jsonb,
  parse_warnings        jsonb not null default '[]'::jsonb,

  confirmed_by          uuid references public.profiles (id) on delete restrict,
  confirmed_by_staff    uuid references public.clinical_staff (id) on delete restrict,
  confirmed_at          timestamptz,
  -- Denormalised on purpose: doctor_tier is mutable (people get promoted),
  -- and an audit of "who was allowed to do this, then" must not silently
  -- re-answer itself when it later changes. Same reasoning as
  -- case_review_actions.confirmed_at_tier.
  confirmed_at_tier     public.doctor_tier,

  -- Every v1 resource_type maps to exactly one destination table by
  -- construction (unlike case_review_actions' 5 heterogeneous action
  -- types), so both are required at CHECK level for an accepted row, not
  -- just informational.
  result_table          text,
  result_id             uuid,

  dismissed_by_staff    uuid references public.clinical_staff (id) on delete restrict,
  dismissed_at          timestamptz,
  dismissal_reason      text,

  proposed_at           timestamptz not null default now(),
  parser_version        integer not null,

  constraint fhir_import_proposed_resources_accepted_requires_attribution check (
    status not in ('confirmed', 'modified')
    or (
      confirmed_by is not null
      and confirmed_by_staff is not null
      and confirmed_at is not null
      and confirmed_payload is not null
      and result_table is not null
      and result_id is not null
    )
  ),
  constraint fhir_import_proposed_resources_dismissed_requires_reason check (
    status <> 'dismissed'
    or (
      dismissed_by_staff is not null
      and dismissed_at is not null
      and dismissal_reason is not null
      and length(btrim(dismissal_reason)) > 0
    )
  ),
  constraint fhir_import_proposed_resources_proposed_is_clean check (
    status <> 'proposed'
    or (
      confirmed_by is null
      and confirmed_by_staff is null
      and confirmed_at is null
      and confirmed_at_tier is null
      and confirmed_payload is null
      and result_table is null
      and result_id is null
      and dismissed_by_staff is null
      and dismissed_at is null
    )
  )
);

comment on table public.fhir_import_proposed_resources is
  'One row per recognised FHIR Bundle entry. Clinically inert until a named, tier-eligible clinician confirms it -- see private.enforce_fhir_import_resource_attribution, which performs the destination-table write itself on confirm/modify.';
comment on column public.fhir_import_proposed_resources.normalized_payload is
  'Parser output, already shaped for the destination table insert. What confirmed_payload defaults to on a plain confirm.';
comment on column public.fhir_import_proposed_resources.confirmed_payload is
  'What was actually used to write the record. Equal to normalized_payload for confirmed; differs for modified -- that difference is the only signal a parser mapping is wrong in practice.';

-- A corrected re-send of the same partner-side resource supersedes an
-- unreviewed proposal instead of duplicating it in the worklist.
create unique index fhir_import_proposed_resources_one_live_per_source
  on public.fhir_import_proposed_resources (patient_id, resource_type, fhir_resource_id)
  where status = 'proposed' and fhir_resource_id is not null;

create index fhir_import_proposed_resources_batch_idx
  on public.fhir_import_proposed_resources (batch_id, status);
create index fhir_import_proposed_resources_org_pending_idx
  on public.fhir_import_proposed_resources (organisation_id, proposed_at)
  where status = 'proposed';
create index fhir_import_proposed_resources_patient_idx
  on public.fhir_import_proposed_resources (patient_id, proposed_at desc);
create index fhir_import_proposed_resources_confirmed_by_staff_idx
  on public.fhir_import_proposed_resources (confirmed_by_staff)
  where confirmed_by_staff is not null;

-- ---------------------------------------------------------------------------
-- Trigger: derive attribution server-side, gate authority, write once
-- ---------------------------------------------------------------------------

create or replace function private.enforce_fhir_import_resource_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_tier public.doctor_tier;
  v_is_director boolean;
  v_result_id uuid;
begin
  if tg_op = 'INSERT' then
    new.status := 'proposed';
    new.confirmed_by := null;
    new.confirmed_by_staff := null;
    new.confirmed_at := null;
    new.confirmed_at_tier := null;
    new.confirmed_payload := null;
    new.result_table := null;
    new.result_id := null;
    new.dismissed_by_staff := null;
    new.dismissed_at := null;
    new.dismissal_reason := null;
    return new;
  end if;

  -- 'superseded' is bookkeeping by the import route (service role) when a
  -- corrected re-send arrives, not a clinical act -- it needs no signer.
  if new.status = 'superseded' then
    if old.status <> 'proposed' then
      raise exception 'Only a still-proposed resource can be superseded (this one is already %).', old.status;
    end if;
    return new;
  end if;

  if old.status <> 'proposed' then
    raise exception 'This resource was already % and cannot be changed. A corrected re-send from the partner supersedes it instead.', old.status;
  end if;

  if new.status = 'proposed' then
    raise exception 'A proposed resource may only move to confirmed, modified, dismissed, or superseded.';
  end if;

  -- The signer is always the caller's own active clinical_staff row in THIS
  -- organisation -- nothing the client sent is trusted.
  select id, doctor_tier, is_clinical_director
    into v_staff_id, v_tier, v_is_director
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active
  limit 1;

  if v_staff_id is null then
    raise exception 'Only an active clinical staff member in this organisation can act on an imported resource.';
  end if;

  -- Care Coordinator is a doctor_tier value but is explicitly non-clinical
  -- (CLAUDE.md, Clinical Tier Ladder) -- excluded by name, same as
  -- enforce_case_review_action_attribution.
  if v_tier = 'care_coordinator' then
    raise exception 'A Care Coordinator can see an imported resource but cannot confirm it into the clinical record.';
  end if;

  if v_tier is null and not coalesce(v_is_director, false) then
    raise exception 'Your clinical record has no tier assigned yet, so confirming imported data is unavailable. Ask an administrator to set your tier.';
  end if;

  -- Proposal-authored fields are never rewritten by the act of deciding.
  new.resource_type := old.resource_type;
  new.batch_id := old.batch_id;
  new.patient_id := old.patient_id;
  new.organisation_id := old.organisation_id;
  new.source := old.source;
  new.fhir_resource_id := old.fhir_resource_id;
  new.raw_resource := old.raw_resource;
  new.normalized_payload := old.normalized_payload;
  new.parse_warnings := old.parse_warnings;
  new.parser_version := old.parser_version;
  new.proposed_at := old.proposed_at;

  if new.status = 'dismissed' then
    if new.dismissal_reason is null or length(btrim(new.dismissal_reason)) = 0 then
      raise exception 'A dismissal needs a reason.';
    end if;
    new.dismissed_by_staff := v_staff_id;
    new.dismissed_at := now();
    new.confirmed_by := null;
    new.confirmed_by_staff := null;
    new.confirmed_at := null;
    new.confirmed_at_tier := null;
    new.confirmed_payload := null;
    new.result_table := null;
    new.result_id := null;
    return new;
  end if;

  -- --- confirmed / modified: any active, tiered, non-care_coordinator
  -- clinical staff member may confirm any v1 resource type -- see the
  -- header for why there is no per-type authority gate yet.

  if new.status = 'confirmed' then
    new.confirmed_payload := old.normalized_payload;
  elsif new.confirmed_payload is null then
    raise exception 'A modified resource must carry the payload that was actually used.';
  end if;

  new.confirmed_by := (select auth.uid());
  new.confirmed_by_staff := v_staff_id;
  new.confirmed_at := now();
  new.confirmed_at_tier := v_tier;
  new.dismissed_by_staff := null;
  new.dismissed_at := null;
  new.dismissal_reason := null;

  -- --- the one write: land the confirmed payload in its destination table.
  -- Every branch is a single-row insert of already-tier-authorised data --
  -- doing it here keeps "check authority, then write" atomic and avoids a
  -- second UPDATE that the now-terminal status would otherwise refuse.
  case new.resource_type
    when 'Observation' then
      insert into public.vitals_readings (
        organisation_id, patient_id, source, vital_type, taken_at,
        systolic, diastolic, pulse_bpm,
        glucose_context, glucose_mmol_l,
        weight_kg, temperature_c, spo2_pct, waist_cm, ketones_mmol_l,
        external_reading_id
      ) values (
        new.organisation_id, new.patient_id, 'fhir_import',
        (new.confirmed_payload->>'vital_type')::public.vital_type,
        (new.confirmed_payload->>'taken_at')::timestamptz,
        (new.confirmed_payload->>'systolic')::integer,
        (new.confirmed_payload->>'diastolic')::integer,
        (new.confirmed_payload->>'pulse_bpm')::integer,
        (new.confirmed_payload->>'glucose_context')::public.glucose_context,
        (new.confirmed_payload->>'glucose_mmol_l')::numeric,
        (new.confirmed_payload->>'weight_kg')::numeric,
        (new.confirmed_payload->>'temperature_c')::numeric,
        (new.confirmed_payload->>'spo2_pct')::numeric,
        (new.confirmed_payload->>'waist_cm')::numeric,
        (new.confirmed_payload->>'ketones_mmol_l')::numeric,
        new.fhir_resource_id
      )
      returning id into v_result_id;
      new.result_table := 'vitals_readings';

    when 'AllergyIntolerance' then
      insert into public.patient_allergies (
        organisation_id, patient_id, allergen, reaction, severity, source, noted_at, recorded_by
      ) values (
        new.organisation_id, new.patient_id,
        new.confirmed_payload->>'allergen',
        new.confirmed_payload->>'reaction',
        (new.confirmed_payload->>'severity')::public.allergy_severity,
        'fhir_import',
        coalesce((new.confirmed_payload->>'noted_at')::timestamptz, now()),
        (select auth.uid())
      )
      returning id into v_result_id;
      new.result_table := 'patient_allergies';

    when 'MedicationStatement', 'MedicationRequest' then
      insert into public.medications (
        organisation_id, patient_id, drug_name, dose, frequency, is_active, source, added_by
      ) values (
        new.organisation_id, new.patient_id,
        new.confirmed_payload->>'drug_name',
        new.confirmed_payload->>'dose',
        new.confirmed_payload->>'frequency',
        coalesce((new.confirmed_payload->>'is_active')::boolean, true),
        'fhir_import',
        (select auth.uid())
      )
      returning id into v_result_id;
      new.result_table := 'medications';

    when 'Immunization' then
      insert into public.vaccination_records (
        organisation_id, profile_id, vaccination_catalog_id, dose_number,
        date_administered, provider, verification_status, verified_by, verified_at
      ) values (
        new.organisation_id, new.patient_id,
        (new.confirmed_payload->>'vaccination_catalog_id')::uuid,
        coalesce((new.confirmed_payload->>'dose_number')::integer, 1),
        (new.confirmed_payload->>'date_administered')::date,
        new.confirmed_payload->>'provider',
        'verified',
        (select auth.uid()),
        now()
      )
      returning id into v_result_id;
      new.result_table := 'vaccination_records';
  end case;

  new.result_id := v_result_id;

  return new;
end;
$$;

comment on function private.enforce_fhir_import_resource_attribution() is
  'Derives fhir_import_proposed_resources attribution from the caller''s own active clinical_staff row, refuses care_coordinator and unset tiers, freezes decided rows, and performs the single destination-table write atomically with the confirm/modify itself.';

create trigger fhir_import_proposed_resources_enforce_attribution
  before insert or update on public.fhir_import_proposed_resources
  for each row execute function private.enforce_fhir_import_resource_attribution();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.fhir_import_proposed_resources enable row level security;

create policy fhir_import_proposed_resources_select on public.fhir_import_proposed_resources
  for select to authenticated
  using (private.is_org_staff(organisation_id));

-- Deliberately broad here, narrowed by the trigger above -- same
-- "RLS admits, trigger narrows" split as case_review_actions_update.
create policy fhir_import_proposed_resources_update on public.fhir_import_proposed_resources
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

-- No INSERT or DELETE policy: proposals come only from the service-role
-- import route, and nothing is ever deleted (dismissal is a status).

-- Same default-privileges correction as fhir_import_batches above.
revoke insert, delete on public.fhir_import_proposed_resources from authenticated;
grant select, update on public.fhir_import_proposed_resources to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_count integer;
  v_org uuid;
  v_patient uuid;
  v_api_key uuid;
  v_batch uuid;
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'vital_source' and e.enumlabel = 'fhir_import'
  ) then
    raise exception 'vital_source.fhir_import missing -- provenance-enum migration did not run first';
  end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'medication_source' and e.enumlabel = 'fhir_import'
  ) then
    raise exception 'medication_source.fhir_import missing -- provenance-enum migration did not run first';
  end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'allergy_source' and e.enumlabel = 'fhir_import'
  ) then
    raise exception 'allergy_source.fhir_import missing -- provenance-enum migration did not run first';
  end if;

  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'fhir_import_batches') then
    raise exception 'fhir_import_batches missing after migration';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'fhir_import_proposed_resources') then
    raise exception 'fhir_import_proposed_resources missing after migration';
  end if;

  select count(*) into v_count from pg_policies
    where schemaname = 'public' and tablename = 'fhir_import_batches';
  if v_count <> 1 then
    raise exception 'fhir_import_batches expected exactly 1 policy (SELECT only), found %', v_count;
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fhir_import_batches' and cmd <> 'SELECT'
  ) then
    raise exception 'fhir_import_batches must have no write policy -- batches are service-role only and immutable';
  end if;

  select count(*) into v_count from pg_policies
    where schemaname = 'public' and tablename = 'fhir_import_proposed_resources' and cmd in ('SELECT', 'UPDATE');
  if v_count <> 2 then
    raise exception 'fhir_import_proposed_resources expected exactly one SELECT and one UPDATE policy, found %', v_count;
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fhir_import_proposed_resources' and cmd in ('INSERT', 'DELETE')
  ) then
    raise exception 'fhir_import_proposed_resources must have no INSERT/DELETE policy -- proposals are service-role only';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.fhir_import_proposed_resources'::regclass
      and tgname = 'fhir_import_proposed_resources_enforce_attribution'
      and not tgisinternal
  ) then
    raise exception 'fhir_import_proposed_resources attribution trigger missing';
  end if;

  if not has_table_privilege('authenticated', 'public.fhir_import_batches', 'SELECT') then
    raise exception 'authenticated lacks SELECT on fhir_import_batches';
  end if;
  if has_table_privilege('authenticated', 'public.fhir_import_batches', 'INSERT') then
    raise exception 'authenticated must not hold INSERT on fhir_import_batches';
  end if;
  if not has_table_privilege('authenticated', 'public.fhir_import_proposed_resources', 'SELECT') then
    raise exception 'authenticated lacks SELECT on fhir_import_proposed_resources';
  end if;
  if not has_table_privilege('authenticated', 'public.fhir_import_proposed_resources', 'UPDATE') then
    raise exception 'authenticated lacks UPDATE on fhir_import_proposed_resources';
  end if;
  if has_table_privilege('authenticated', 'public.fhir_import_proposed_resources', 'INSERT') then
    raise exception 'authenticated must not hold INSERT on fhir_import_proposed_resources';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fhir_import_proposed_resources'::regclass
      and conname = 'fhir_import_proposed_resources_source_is_partner_import'
  ) then
    raise exception 'fhir_import_proposed_resources source CHECK missing -- the partner-only-insert guarantee is gone';
  end if;

  -- The source CHECK must actually reject a bad value, not just exist.
  -- Needs a valid batch row (itself needing an org/api_key/patient) so the
  -- attempt fails on the CHECK alone, not ambiguously on a FK too. Skipped
  -- on a database with none of these yet -- same "skip with a warning"
  -- convention care_access_events' own migration test uses.
  select id into v_org from public.organisations limit 1;
  select id into v_patient from public.profiles where organisation_id = v_org and role = 'patient' limit 1;
  select id into v_api_key from public.api_keys where organisation_id = v_org limit 1;

  if v_org is null or v_patient is null or v_api_key is null then
    raise warning 'skipping the source-CHECK behavioural assertion: need an org, a patient profile, and an api_key already on file';
  else
    insert into public.fhir_import_batches (organisation_id, api_key_id, patient_id, raw_bundle)
    values (v_org, v_api_key, v_patient, '{}'::jsonb)
    returning id into v_batch;

    begin
      insert into public.fhir_import_proposed_resources
        (batch_id, organisation_id, patient_id, resource_type, source, raw_resource, normalized_payload, parser_version)
      values (v_batch, v_org, v_patient, 'Observation', 'not_the_partner_engine', '{}'::jsonb, '{}'::jsonb, 1);
      raise exception 'the source CHECK did not reject a non-partner-import value';
    exception
      when check_violation then null;
    end;

    -- Leave the database as we found it.
    delete from public.fhir_import_batches where id = v_batch;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fhir_import_proposed_resources'::regclass
      and conname = 'fhir_import_proposed_resources_accepted_requires_attribution'
  ) then
    raise exception 'fhir_import_proposed_resources attribution CHECK missing';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fhir_import_proposed_resources'::regclass
      and conname = 'fhir_import_proposed_resources_dismissed_requires_reason'
  ) then
    raise exception 'fhir_import_proposed_resources dismissal-reason CHECK missing';
  end if;
end $$;
