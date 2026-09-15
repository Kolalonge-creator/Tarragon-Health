-- Tarragon Health — Predictive Risk & Early Warning Engine, 3/5
-- risk_predictions (spec §39.3, §39.6, §39.7, §39.8) and risk_model_outcomes
-- (spec §39.11, §39.15) — the two tables that close the
-- risk -> explanation -> intervention -> outcome -> model evaluation loop.

-- ---------------------------------------------------------------------------
-- 1. risk_predictions.
--
-- domain, horizon_days, thresholds and band_definitions are all DENORMALIZED
-- from risk_models at insert time rather than joined live. risk_models rows
-- are immutable once they leave 'draft' (risk_models_update's policy), so
-- this is not a staleness risk — it is what makes a trajectory (§39.6)
-- correct across a model version upgrade: a January prediction scored under
-- v1's thresholds must always re-render as whatever band v1's thresholds
-- gave it, even after v2 replaces v1 in June with different cutoffs.
-- ---------------------------------------------------------------------------

create table public.risk_predictions (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  risk_model_id     uuid not null references public.risk_models (id) on delete restrict,

  -- Denormalized from risk_models (see header note).
  domain            public.risk_domain not null,
  horizon_days      integer not null check (horizon_days > 0),

  probability       numeric(6, 5) not null check (probability >= 0 and probability <= 1),
  risk_level        public.risk_level not null,

  -- Spec §39.7: "Clinician should be able to see the major contributors."
  -- Array of {feature, value, direction, magnitude, description}. magnitude
  -- is this feature's share of the score move, so contributors can be shown
  -- ranked without a clinician needing to understand the underlying model.
  contributors      jsonb not null default '[]'::jsonb
    check (jsonb_typeof(contributors) = 'array'),

  -- Raw feature values behind this prediction (spec §39.4 provenance) — lets
  -- a clinician or a later audit see exactly what the model saw, distinct
  -- from contributors (which is the model's own explanation of that data).
  features_snapshot jsonb not null default '{}'::jsonb,

  -- Did THIS prediction's model status permit it to influence care at the
  -- moment it was written (private.risk_model_may_influence_care). Snapshotted
  -- because a shadow prediction stays a shadow prediction forever, even after
  -- its model is later activated — activation governs predictions made AFTER
  -- signing, not retroactively.
  influenced_care   boolean not null,

  computed_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),

  -- Spec §39.7 "do not present opaque scores without context": a non-low
  -- band must carry at least one contributor, or reading it must be
  -- self-evidently backed by nothing.
  constraint risk_predictions_contributors_required_above_low
    check (risk_level = 'low' or risk_level = 'unknown' or jsonb_array_length(contributors) > 0)
);

create index risk_predictions_patient_domain_idx
  on public.risk_predictions (patient_id, domain, computed_at desc);
create index risk_predictions_model_idx
  on public.risk_predictions (risk_model_id, computed_at desc);
create index risk_predictions_org_idx on public.risk_predictions (organisation_id);

comment on table public.risk_predictions is
  'One row per model run per patient (spec §39.3). Ordered by (patient_id, '
  'domain, computed_at) this IS the trajectory of §39.6 — no separate table.';
comment on column public.risk_predictions.influenced_care is
  'Snapshot of whether this specific prediction was allowed to drive care '
  '(model was active, not shadow, at compute time) — never re-derived from '
  'the model''s CURRENT status, which may have changed since.';

alter table public.risk_predictions enable row level security;

-- Patient reads own predictions — spec §39.7/§39.8 are as much a
-- patient-transparency requirement as a clinician one; the plain-language
-- gloss they see is a UI concern (mirrors risk-signals-card.tsx's existing
-- pattern for patient_risk_scores), not an RLS one.
create policy risk_predictions_select on public.risk_predictions
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- No INSERT/UPDATE/DELETE policy at all: every row is written by
-- private.record_risk_prediction() below (SECURITY DEFINER), which is the
-- only place risk_level gets computed from private.risk_band() and
-- influenced_care gets stamped from the model's live status — a direct
-- insert could otherwise forge either. Predictions are also never edited or
-- deleted: an audit trail of what the model actually said stays intact even
-- after the model is retired or rolled back.
grant select on public.risk_predictions to authenticated;

-- ---------------------------------------------------------------------------
-- 2. risk_model_outcomes (spec §39.11 false-positive/false-negative
-- analysis, §39.15 "outcome"). One row per prediction that has reached a
-- resolvable point — did the predicted event happen or not. A prediction
-- with no matching row is simply not yet resolved (still inside its horizon,
-- or nothing in the record yet lets it be judged either way).
-- ---------------------------------------------------------------------------

create table public.risk_model_outcomes (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  risk_prediction_id uuid not null references public.risk_predictions (id) on delete cascade,
  outcome_occurred   boolean not null,
  observed_at        timestamptz not null default now(),
  detail             jsonb not null default '{}'::jsonb,
  -- Nullable, ON DELETE RESTRICT: an automated resolver (see migration 4/5)
  -- writes most rows with no human recorder at all — same
  -- deliberately-nullable provenance pattern as every other
  -- legitimately-null-until-actioned attribution column on the platform
  -- (CLAUDE.md "Where things actually stand" — recorded_by NOT NULL was
  -- rejected platform-wide for exactly this reason). A clinician can also
  -- record one by hand (e.g. closing the loop on a domain with no automated
  -- resolver yet), which is when this is populated.
  recorded_by        uuid references public.profiles (id) on delete restrict,
  created_at         timestamptz not null default now(),

  unique (risk_prediction_id)
);

create index risk_model_outcomes_org_idx on public.risk_model_outcomes (organisation_id);

comment on table public.risk_model_outcomes is
  'Ground truth for a resolved risk_predictions row — did the predicted '
  'event actually happen. Feeds calibration/false-positive/false-negative '
  'analysis (spec §39.11) via the views in migration 5/5.';

alter table public.risk_model_outcomes enable row level security;

create policy risk_model_outcomes_select on public.risk_model_outcomes
  for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.risk_predictions rp
      where rp.id = risk_model_outcomes.risk_prediction_id and rp.patient_id = (select auth.uid())
    )
  );

-- Staff may record an outcome by hand; the automated resolver (migration
-- 4/5) runs as a SECURITY DEFINER function and writes regardless of policy.
create policy risk_model_outcomes_insert on public.risk_model_outcomes
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

grant select, insert on public.risk_model_outcomes to authenticated;

-- ---------------------------------------------------------------------------
-- 3. private.record_risk_prediction() — the only writer of risk_predictions.
-- Generic across every domain: today's caller is the missed-follow-up
-- scorer (migration 4/5), but any future domain model calls this same
-- function rather than each domain reimplementing the influenced_care /
-- risk_level / mirror-to-patient_risk_scores logic separately.
--
-- SHADOW VS ACTIVE (spec §39.13) is enforced HERE, structurally, not by
-- caller discipline: a shadow model's prediction is written to
-- risk_predictions (so its accuracy can still be evaluated once outcomes
-- land — that is the entire point of shadowing) but is NEVER mirrored into
-- patient_risk_scores, so it can never reach the care_outreach_tasks
-- pipeline, the clinician worklist, or risk-signals-card.tsx. Only an
-- ACTIVE model's prediction is mirrored — which is what wires §39.9
-- (risk -> care management task -> ... -> intervention) onto the outreach
-- engine that already exists (20260723010019_care_outreach_engine.sql)
-- rather than building a second, parallel task pipeline.
-- ---------------------------------------------------------------------------

create or replace function private.record_risk_prediction(
  p_model_id           uuid,
  p_patient_id         uuid,
  p_probability        numeric,
  p_contributors       jsonb,
  p_features_snapshot  jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org         uuid;
  v_domain      public.risk_domain;
  v_status      public.risk_model_status;
  v_thresholds  jsonb;
  v_horizon     integer;
  v_code        text;
  v_version     integer;
  v_level       public.risk_level;
  v_influences  boolean;
  v_prediction_id uuid;
begin
  select organisation_id, domain, status, thresholds, horizon_days, code, version
    into v_org, v_domain, v_status, v_thresholds, v_horizon, v_code, v_version
  from public.risk_models where id = p_model_id;

  if v_org is null then
    raise exception 'risk model not found';
  end if;
  if v_status not in ('shadow', 'active') then
    raise exception 'model must be shadow or active to score patients (currently %)', v_status;
  end if;

  v_level := private.risk_band(v_thresholds, p_probability);
  v_influences := private.risk_model_may_influence_care(v_status);

  insert into public.risk_predictions
    (organisation_id, patient_id, risk_model_id, domain, horizon_days,
     probability, risk_level, contributors, features_snapshot, influenced_care)
  values
    (v_org, p_patient_id, p_model_id, v_domain, v_horizon,
     p_probability, v_level, coalesce(p_contributors, '[]'::jsonb),
     coalesce(p_features_snapshot, '{}'::jsonb), v_influences)
  returning id into v_prediction_id;

  if v_influences then
    -- Mirror onto the existing, already-wired risk pipeline (spec §39.9).
    -- score_type is prefixed 'predictive_' so it can never collide with a
    -- diagnostic/current-state score_type (cvd_10yr, bp_control, ...) —
    -- risk-signals-card.tsx and care_outreach_tasks both key off risk_level,
    -- not score_type, so no change to either was needed for this to work.
    insert into public.patient_risk_scores
      (organisation_id, patient_id, score_type, score, risk_level, model_version, inputs, computed_at)
    values
      (v_org, p_patient_id, 'predictive_' || v_domain::text, p_probability * 100, v_level,
       v_code || '@' || v_version::text,
       jsonb_build_object('prediction_id', v_prediction_id, 'contributors', p_contributors,
         'features', p_features_snapshot, 'horizon_days', v_horizon),
       now());
  end if;

  return v_prediction_id;
end $$;

comment on function private.record_risk_prediction(uuid, uuid, numeric, jsonb, jsonb) is
  'Single writer of risk_predictions for every domain model. Bands the '
  'probability, stamps influenced_care from the model''s live status, and — '
  'only when influenced_care is true — mirrors onto patient_risk_scores so '
  'the existing outreach/worklist/patient-facing pipeline picks it up '
  'unchanged (spec §39.9). A shadow prediction never reaches that mirror.';

revoke all on function private.record_risk_prediction(uuid, uuid, numeric, jsonb, jsonb) from public;
