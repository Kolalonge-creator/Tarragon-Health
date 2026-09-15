-- Tarragon Health — Predictive Risk & Early Warning Engine, 1/5
-- Model registry, governance, configurable thresholds, shadow deployment,
-- and rollback (spec §39.10 – §39.14).
--
-- WHY THIS TABLE EXISTS AT ALL
-- ---------------------------------------------------------------------------
-- The platform already computes risk in at least four places
-- (lib/rules/cv-risk.ts, lib/rules/bp-control-risk.ts, the SCORE2 endpoint in
-- services/ml, and computePreventionRiskScores). Every one of them writes a
-- model_version string that nothing validates, nothing governs, and nothing
-- can roll back. That is fine for a deterministic guideline calculator — it is
-- not fine for a PREDICTIVE model, where §39.11–§39.14 require performance
-- monitoring, calibration, drift, versioned retraining, governance approval,
-- shadow deployment and rollback. A free-text version string supports none of
-- those. This registry is the governed object those requirements attach to.
--
-- It deliberately does NOT retrofit the four existing rule engines. They are
-- diagnostic/current-state calculators, they are already signed where they
-- carry clinical parameters (cv_risk_config), and rewriting them to route
-- through a registry would be a large behaviour-change to shipped clinical
-- code for no §39 requirement. New predictive models register here; existing
-- rule engines keep writing patient_risk_scores exactly as they do today.
--
-- GOVERNANCE SPLIT (mirrors cv_risk_config / protocol_versions / escalation_slas):
--   draft   — registered, scores nothing, no signature needed.
--   shadow  — runs and stores predictions, but MUST NOT influence care
--             (§39.13). No signature needed: shadowing is what you do BEFORE
--             asking for approval, so requiring a signature first would
--             invert the review it exists to support.
--   active  — influences care. Requires an active Clinical Director's
--             signature (§39.12 "governance approval" before deployment).
--   retired — superseded by a later version, kept for provenance.
--   rolled_back — withdrawn because performance deteriorated (§39.14). A
--             terminal state: a rolled-back version can never go active
--             again, a fixed model is a NEW version.

-- ---------------------------------------------------------------------------
-- 1. Risk domains (spec §39.2).
--
-- Every domain §39.2 lists is enumerated here, including the three the
-- platform already scores by other means (cardiovascular, diabetes
-- progression, uncontrolled hypertension). Cataloguing a domain is free;
-- actually scoring it for a patient requires a registered, signed model, so
-- enumerating all eight commits the platform to nothing — same
-- catalogue-vs-activate split as prevention_condition's ckd/asthma_copd/
-- mental_wellbeing members (20260827200100) and preventive_programmes.
-- ---------------------------------------------------------------------------

create type public.risk_domain as enum (
  'cardiovascular',
  'diabetes_progression',
  'uncontrolled_hypertension',
  'medication_non_adherence',
  'care_disengagement',
  'hospitalisation',
  'missed_follow_up',
  'chronic_deterioration'
);

comment on type public.risk_domain is
  'The predictive risk domains of spec §39.2. Enumerating a domain does not '
  'mean the platform scores it — that needs a signed public.risk_models row.';

create type public.risk_model_status as enum (
  'draft', 'shadow', 'active', 'retired', 'rolled_back'
);

comment on type public.risk_model_status is
  'Lifecycle of a registered predictive model. Only "active" may influence '
  'care; "shadow" runs silently (§39.13); "rolled_back" is terminal (§39.14).';

-- ---------------------------------------------------------------------------
-- 2. Threshold + band-definition validation (spec §39.5, §39.10).
--
-- §39.5 says the risk categories "must have defined meaning" and §39.7 says
-- not to present opaque scores. Both are enforced structurally rather than
-- left to reviewer discipline: a model cannot be registered at all unless it
-- ships (a) ordered numeric cutoffs for moderate/high/very_high and (b) a
-- written clinical meaning for all four bands. A model with no stated meaning
-- for "high" is exactly the opaque score §39.7 forbids, so it is rejected at
-- the CHECK rather than discovered on a dashboard.
-- ---------------------------------------------------------------------------

create or replace function private.risk_thresholds_valid(p_thresholds jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_thresholds ?& array['moderate', 'high', 'very_high']
     and jsonb_typeof(p_thresholds -> 'moderate')  = 'number'
     and jsonb_typeof(p_thresholds -> 'high')      = 'number'
     and jsonb_typeof(p_thresholds -> 'very_high') = 'number'
     and (p_thresholds ->> 'moderate')::numeric > 0
     and (p_thresholds ->> 'moderate')::numeric < (p_thresholds ->> 'high')::numeric
     and (p_thresholds ->> 'high')::numeric      < (p_thresholds ->> 'very_high')::numeric
     and (p_thresholds ->> 'very_high')::numeric <= 1;
$$;

comment on function private.risk_thresholds_valid(jsonb) is
  'Thresholds are the probability at or above which each band STARTS; below '
  'the moderate cutoff is "low". Strictly ordered and bounded by (0, 1] so a '
  'band can never be unreachable or overlap its neighbour (spec §39.10).';

create or replace function private.risk_band_definitions_valid(p_defs jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_defs ?& array['low', 'moderate', 'high', 'very_high']
     and length(coalesce(p_defs ->> 'low', ''))       >= 10
     and length(coalesce(p_defs ->> 'moderate', ''))  >= 10
     and length(coalesce(p_defs ->> 'high', ''))      >= 10
     and length(coalesce(p_defs ->> 'very_high', '')) >= 10;
$$;

comment on function private.risk_band_definitions_valid(jsonb) is
  'Spec §39.5: "The categories must have defined meaning." Every band needs a '
  'written clinical interpretation before the model can be registered. The '
  'length floor rejects a placeholder like "high" or "-" without pretending '
  'to judge clinical quality — that is the Clinical Director''s job at signing.';

-- ---------------------------------------------------------------------------
-- 3. risk_models.
-- ---------------------------------------------------------------------------

create table public.risk_models (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  domain            public.risk_domain not null,
  -- Stable identifier of the scoring logic, e.g. 'medication_non_adherence'.
  -- (code, version) is the pair a prediction records as its provenance.
  code              text not null check (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  version           integer not null check (version > 0),
  status            public.risk_model_status not null default 'draft',
  display_name      text not null check (length(trim(display_name)) > 0),

  -- Spec §39.8: predictive is not diagnostic. A prediction is a probability
  -- over a STATED TIME HORIZON; strip the horizon and "0.4" starts reading as
  -- a statement about what the patient has. Non-null with a positive CHECK
  -- means no registered model can produce a horizonless number, so the UI
  -- always has a horizon to render alongside the score.
  horizon_days      integer not null check (horizon_days > 0),

  thresholds        jsonb not null
    constraint risk_models_thresholds_valid check (private.risk_thresholds_valid(thresholds)),
  band_definitions  jsonb not null
    constraint risk_models_band_definitions_valid
      check (private.risk_band_definitions_valid(band_definitions)),

  -- Spec §39.4: "Only use variables that are clinically justified and
  -- appropriately governed." The feature list is declared up front and signed
  -- along with everything else, so a reviewer approves the INPUTS as well as
  -- the cutoffs — and a model that silently starts reading a new variable is
  -- a new version, not an undocumented change.
  feature_spec      jsonb not null default '[]'::jsonb
    check (jsonb_typeof(feature_spec) = 'array'),

  -- Retraining lineage (§39.12): v2 points at the v1 it replaces.
  supersedes_id     uuid references public.risk_models (id) on delete restrict,

  -- Governance (§39.12). clinical_staff, not profiles — same provenance rule
  -- as cv_risk_config/protocol_versions: a signature belongs to a named,
  -- credentialed clinical record.
  approved_by       uuid references public.clinical_staff (id) on delete restrict,
  approved_at       timestamptz,

  -- Rollback (§39.14).
  rolled_back_at    timestamptz,
  rollback_reason   text,

  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (organisation_id, code, version),

  -- Only a signed model may influence care. 'shadow' is deliberately absent:
  -- see the governance-split note in this file's header.
  constraint risk_models_active_requires_signature
    check (status <> 'active' or (approved_by is not null and approved_at is not null)),

  -- A rollback must say when and why, or "we rolled it back" is unauditable.
  constraint risk_models_rollback_requires_reason
    check (
      status <> 'rolled_back'
      or (rolled_back_at is not null and length(trim(coalesce(rollback_reason, ''))) > 0)
    ),

  -- A model cannot supersede itself.
  constraint risk_models_no_self_supersede check (supersedes_id is null or supersedes_id <> id)
);

-- Spec §39.13/§39.14 depend on this: exactly one model may be live per
-- (organisation, domain) at a time, so "the active model" is never ambiguous
-- and a rollback has a single, well-defined thing to restore.
create unique index risk_models_one_active_per_domain
  on public.risk_models (organisation_id, domain) where status = 'active';

create index risk_models_org_domain_idx on public.risk_models (organisation_id, domain, status);
create index risk_models_supersedes_idx on public.risk_models (supersedes_id) where supersedes_id is not null;

create trigger risk_models_set_updated_at
  before update on public.risk_models
  for each row execute function private.set_updated_at();

comment on table public.risk_models is
  'Registry of governed predictive risk models (spec §39.10–§39.14). One '
  'active model per (organisation, domain); shadow models run silently and '
  'may never influence care; rolled_back is terminal.';
comment on column public.risk_models.horizon_days is
  'Prediction window in days. Non-null by design — spec §39.8: a probability '
  'without a horizon reads as a diagnosis.';
comment on column public.risk_models.thresholds is
  'Configurable band cutoffs (§39.10). Probability at or above which each '
  'band starts; below "moderate" is low.';
comment on column public.risk_models.supersedes_id is
  'Retraining lineage (§39.12): the model version this one replaces.';

alter table public.risk_models enable row level security;

-- Read is org-staff-wide: a clinician looking at a prediction needs the band
-- definitions and horizon to interpret it, and the ML/prediction runner reads
-- thresholds. Not world-readable like cv_risk_config — nothing patient-facing
-- renders a model's internals, only its band definition via a joined view.
create policy risk_models_select on public.risk_models
  for select to authenticated
  using (private.is_org_staff(organisation_id));

-- Staff may register DRAFTS only. Signing, activation, shadowing and rollback
-- all go through the SECURITY DEFINER RPCs below, so a direct insert can
-- never forge a signature or self-activate — same shape as cv_risk_config.
create policy risk_models_insert on public.risk_models
  for insert to authenticated
  with check (
    private.is_org_staff(organisation_id)
    and status = 'draft'
    and approved_by is null
    and approved_at is null
    and rolled_back_at is null
  );

-- Update is limited to the descriptive fields of a DRAFT. Once a model has
-- ever scored a patient it is immutable — a change is a new version, so that
-- a stored prediction's (code, version) always resolves to the exact
-- thresholds and features that produced it.
create policy risk_models_update on public.risk_models
  for update to authenticated
  using (private.is_org_staff(organisation_id) and status = 'draft')
  with check (private.is_org_staff(organisation_id) and status = 'draft');

grant select, insert, update on public.risk_models to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Deterministic banding (spec §39.5).
--
-- One function, used by the prediction writer and by every read path, so a
-- band shown on a dashboard can always be re-derived from the stored
-- probability and the model's stored thresholds. Nothing bands by hand.
-- ---------------------------------------------------------------------------

create or replace function private.risk_band(p_thresholds jsonb, p_probability numeric)
returns public.risk_level
language sql
immutable
set search_path = ''
as $$
  select case
    when p_probability is null then 'unknown'::public.risk_level
    when p_probability >= (p_thresholds ->> 'very_high')::numeric then 'very_high'::public.risk_level
    when p_probability >= (p_thresholds ->> 'high')::numeric      then 'high'::public.risk_level
    when p_probability >= (p_thresholds ->> 'moderate')::numeric  then 'moderate'::public.risk_level
    else 'low'::public.risk_level
  end;
$$;

comment on function private.risk_band(jsonb, numeric) is
  'Single source of truth for probability -> risk_level banding. A null '
  'probability bands as "unknown", never as "low" — an absent prediction and '
  'a confidently-low one are different clinical facts.';

revoke all on function private.risk_thresholds_valid(jsonb) from public;
revoke all on function private.risk_band_definitions_valid(jsonb) from public;
revoke all on function private.risk_band(jsonb, numeric) from public;
