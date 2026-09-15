-- Tarragon Health — Predictive Risk & Early Warning Engine, 4/5
-- A single, fully-wired reference domain model: 'missed_follow_up' (spec
-- §39.2). Every other domain the spec lists (§39.2's remaining seven) can
-- register against the generic registry/governance/prediction machinery
-- built in migrations 1–3 without any new schema — this migration is the
-- proof that the machinery actually produces a working, explainable,
-- intervenable, evaluable prediction end to end (spec §39.15).
--
-- WHY missed_follow_up FIRST: it is the one domain with a clean, entirely
-- in-database feature source (public.appointments, already the sole
-- source of truth for no-shows per 20260828000123_repeated_no_show_care_gap.sql)
-- and a self-resolving ground truth (did the next scheduled follow-up
-- actually happen) — so the full risk -> explanation -> intervention ->
-- outcome -> model evaluation loop closes without inventing data the
-- platform doesn't have.
--
-- SCORING IS A DETERMINISTIC, DOCUMENTED WEIGHTED FUNCTION, NOT A TRAINED
-- MODEL. Same honesty as services/ml/app/scoring/lifestyle.py's "heuristic
-- v1" disengagement signal and score2.py's population-mismatch disclaimer:
-- there is no labelled outcome data yet to fit real ML against (that is
-- exactly what risk_model_outcomes below starts collecting). Presenting a
-- hand-picked weighted sum as a fitted model would be the opaque-score
-- failure spec §39.7/§39.8 explicitly warns against, so the weights are
-- named, justified, and versioned as v1 — retraining once outcomes accrue
-- is v2, governed the same way as any other model version (spec §39.12).

-- ---------------------------------------------------------------------------
-- 1. Scoring function. Pure, deterministic, no table access — takes the
-- feature values as arguments so it can be unit-tested directly (see
-- packages/db/tests/predictive_risk_engine.sql) independent of the scan
-- that gathers those features from live data.
-- ---------------------------------------------------------------------------

create or replace function private.score_missed_follow_up(
  p_no_shows_180d         integer,
  p_completed_180d        integer,
  p_days_since_last_appt  integer,      -- null = no appointment on record at all
  p_has_upcoming_appt     boolean,
  p_has_active_care_plan  boolean
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  -- Weights are clinically-reasoned starting points (v1), not fitted from
  -- labelled outcomes — see the migration header. Recalibrating these once
  -- risk_model_outcomes has enough rows is what v2 (a NEW risk_models row,
  -- signed the same way as v1) is for.
  c_intercept        constant numeric := -2.0;
  c_w_no_show_rate    constant numeric := 3.0;   -- share of recent appointments missed
  c_w_days_since_norm constant numeric := 2.0;   -- how long since any appointment at all
  c_w_has_upcoming    constant numeric := 1.2;   -- protective: something is already booked
  c_w_has_care_plan   constant numeric := 0.8;   -- protective: under active proactive management
  v_total_180d   integer := p_no_shows_180d + p_completed_180d;
  v_no_show_rate numeric := case when v_total_180d = 0 then 0 else p_no_shows_180d::numeric / v_total_180d end;
  v_days_norm    numeric := least(1.0, coalesce(p_days_since_last_appt, 365)::numeric / 365.0);
  v_logit        numeric;
  v_probability  numeric;
  v_contrib_no_show numeric;
  v_contrib_days    numeric;
  v_contrib_upcoming numeric;
  v_contrib_care_plan numeric;
begin
  v_contrib_no_show   := c_w_no_show_rate * v_no_show_rate;
  v_contrib_days      := c_w_days_since_norm * v_days_norm;
  v_contrib_upcoming  := case when p_has_upcoming_appt then -c_w_has_upcoming else 0 end;
  v_contrib_care_plan := case when p_has_active_care_plan then -c_w_has_care_plan else 0 end;

  v_logit := c_intercept + v_contrib_no_show + v_contrib_days + v_contrib_upcoming + v_contrib_care_plan;
  v_probability := round(1.0 / (1.0 + exp(-v_logit)), 5);

  return jsonb_build_object(
    'probability', v_probability,
    'contributors', jsonb_build_array(
      jsonb_build_object(
        'feature', 'no_show_rate_180d', 'value', round(v_no_show_rate, 3),
        'direction', case when v_contrib_no_show >= 0 then 'increases_risk' else 'decreases_risk' end,
        'magnitude', round(abs(v_contrib_no_show), 3),
        'description', format('%s of %s appointments in the last 180 days were missed',
          p_no_shows_180d, v_total_180d)
      ),
      jsonb_build_object(
        'feature', 'days_since_last_appointment', 'value', p_days_since_last_appt,
        'direction', case when v_contrib_days >= 0 then 'increases_risk' else 'decreases_risk' end,
        'magnitude', round(abs(v_contrib_days), 3),
        'description', case
          when p_days_since_last_appt is null then 'no appointment on record at all'
          else format('%s days since the last appointment of any kind', p_days_since_last_appt)
        end
      ),
      jsonb_build_object(
        'feature', 'has_upcoming_appointment', 'value', p_has_upcoming_appt,
        'direction', case when v_contrib_upcoming >= 0 then 'increases_risk' else 'decreases_risk' end,
        'magnitude', round(abs(v_contrib_upcoming), 3),
        'description', case when p_has_upcoming_appt
          then 'already has a future appointment booked' else 'has nothing booked ahead' end
      ),
      jsonb_build_object(
        'feature', 'has_active_care_plan', 'value', p_has_active_care_plan,
        'direction', case when v_contrib_care_plan >= 0 then 'increases_risk' else 'decreases_risk' end,
        'magnitude', round(abs(v_contrib_care_plan), 3),
        'description', case when p_has_active_care_plan
          then 'under an active care plan with proactive follow-up'
          else 'has no active care plan driving proactive contact' end
      )
    )
  );
end $$;

comment on function private.score_missed_follow_up(integer, integer, integer, boolean, boolean) is
  'Deterministic v1 scoring for the missed_follow_up domain (spec §39.2). '
  'Returns {probability, contributors} — contributors satisfies spec §39.7. '
  'Weights are documented starting points, not a fitted model — see header.';

revoke all on function private.score_missed_follow_up(integer, integer, integer, boolean, boolean) from public;

-- ---------------------------------------------------------------------------
-- 2. Candidate scan — gathers features from live data and calls the scoring
-- function + private.record_risk_prediction() for every eligible patient of
-- every organisation currently running a shadow or active missed_follow_up
-- model. A patient with zero appointment history ever is skipped outright
-- (never scored 'low' by default) — there is nothing to assess yet, and a
-- fabricated low-risk row would be exactly the kind of default spec §39.4/
-- CLAUDE.md's "never infer or default" principle warns against.
-- ---------------------------------------------------------------------------

create or replace function private.run_missed_follow_up_predictions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model record;
  v_patient record;
  v_no_shows integer;
  v_completed integer;
  v_days_since integer;
  v_has_upcoming boolean;
  v_has_care_plan boolean;
  v_scored jsonb;
  v_count integer := 0;
begin
  for v_model in
    select id, organisation_id from public.risk_models
    where domain = 'missed_follow_up' and status in ('shadow', 'active')
  loop
    for v_patient in
      select distinct a.patient_id
      from public.appointments a
      where a.organisation_id = v_model.organisation_id
    loop
      select
        count(*) filter (where a.status = 'no_show' and a.scheduled_for >= now() - interval '180 days'),
        count(*) filter (where a.status = 'completed' and a.scheduled_for >= now() - interval '180 days'),
        -- Only appointments already in the past count toward "days since" —
        -- a patient whose sole appointment record is a future one has no
        -- past appointment at all (null, handled by score_missed_follow_up's
        -- own coalesce-to-365), not a nonsensical negative day count.
        (extract(day from now() - max(a.scheduled_for) filter (where a.scheduled_for <= now())))::integer,
        bool_or(a.status in ('scheduled', 'booked', 'confirmed', 'checked_in') and a.scheduled_for > now())
      into v_no_shows, v_completed, v_days_since, v_has_upcoming
      from public.appointments a
      where a.organisation_id = v_model.organisation_id and a.patient_id = v_patient.patient_id;

      select exists (
        select 1 from public.care_plans cp
        where cp.organisation_id = v_model.organisation_id
          and cp.patient_id = v_patient.patient_id and cp.status = 'active'
      ) into v_has_care_plan;

      v_scored := private.score_missed_follow_up(
        coalesce(v_no_shows, 0), coalesce(v_completed, 0), v_days_since,
        coalesce(v_has_upcoming, false), v_has_care_plan
      );

      perform private.record_risk_prediction(
        v_model.id,
        v_patient.patient_id,
        (v_scored ->> 'probability')::numeric,
        v_scored -> 'contributors',
        jsonb_build_object(
          'no_shows_180d', v_no_shows, 'completed_180d', v_completed,
          'days_since_last_appointment', v_days_since,
          'has_upcoming_appointment', v_has_upcoming, 'has_active_care_plan', v_has_care_plan
        )
      );
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end $$;

comment on function private.run_missed_follow_up_predictions() is
  'Nightly scan (spec §39.3 feature generation -> risk model -> risk '
  'estimate): scores every patient with appointment history, for every org '
  'currently running a shadow or active missed_follow_up model. Returns the '
  'number of predictions written.';

revoke all on function private.run_missed_follow_up_predictions() from public;

-- ---------------------------------------------------------------------------
-- 3. Outcome resolution (spec §39.11 false-positive/false-negative input,
-- §39.15 "outcome"). A prediction resolves once its horizon has elapsed:
-- a no_show inside the window means the predicted event happened; a window
-- with only completed/attended appointments (or none scheduled at all —
-- "no follow-up happened" is itself the missed-follow-up outcome) means it
-- did not. Idempotent via the unique (risk_prediction_id) constraint on
-- risk_model_outcomes — a prediction is resolved exactly once.
-- ---------------------------------------------------------------------------

create or replace function private.resolve_missed_follow_up_outcomes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with due as (
    select rp.id, rp.organisation_id, rp.patient_id, rp.computed_at, rp.horizon_days
    from public.risk_predictions rp
    where rp.domain = 'missed_follow_up'
      and rp.computed_at + (rp.horizon_days || ' days')::interval <= now()
      and not exists (select 1 from public.risk_model_outcomes o where o.risk_prediction_id = rp.id)
  ),
  resolved as (
    select
      d.id as risk_prediction_id, d.organisation_id,
      exists (
        select 1 from public.appointments a
        where a.patient_id = d.patient_id and a.organisation_id = d.organisation_id
          and a.scheduled_for > d.computed_at
          and a.scheduled_for <= d.computed_at + (d.horizon_days || ' days')::interval
          and a.status = 'no_show'
      )
      or not exists (
        select 1 from public.appointments a
        where a.patient_id = d.patient_id and a.organisation_id = d.organisation_id
          and a.scheduled_for > d.computed_at
          and a.scheduled_for <= d.computed_at + (d.horizon_days || ' days')::interval
      ) as outcome_occurred
    from due d
  )
  insert into public.risk_model_outcomes (organisation_id, risk_prediction_id, outcome_occurred, detail)
  select organisation_id, risk_prediction_id, outcome_occurred,
    jsonb_build_object('resolver', 'automatic', 'basis', 'appointments_in_horizon_window')
  from resolved
  on conflict (risk_prediction_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

comment on function private.resolve_missed_follow_up_outcomes() is
  'Resolves risk_predictions rows whose horizon has elapsed against '
  'public.appointments: a no_show inside the window, or nothing scheduled '
  'in it at all, counts as the predicted event occurring. Idempotent.';

revoke all on function private.resolve_missed_follow_up_outcomes() from public;

-- ---------------------------------------------------------------------------
-- 4. Seed — one UNSIGNED draft per existing organisation (same "provisional,
-- review before it does anything" pattern as cv_risk_config's seed). Staff
-- must explicitly call start_risk_model_shadow / activate_risk_model — this
-- migration never activates anything, because only a real, authenticated
-- Clinical Director may sign, and a migration is not one.
-- ---------------------------------------------------------------------------

insert into public.risk_models
  (organisation_id, domain, code, version, status, display_name, horizon_days, thresholds, band_definitions, feature_spec, notes)
select
  o.id, 'missed_follow_up', 'missed_follow_up_appointment_pattern', 1, 'draft',
  'Missed follow-up risk (appointment pattern, v1)', 90,
  jsonb_build_object('moderate', 0.30, 'high', 0.55, 'very_high', 0.75),
  jsonb_build_object(
    'low', 'No meaningful pattern of missed visits detected — routine reminders are enough.',
    'moderate', 'A mild pattern (recent no-shows, or gone quiet with nothing booked) worth a light-touch check-in.',
    'high', 'A visible pattern of missed or unscheduled follow-up — a coordinator outreach task should be opened.',
    'very_high', 'Strong pattern of disengagement from scheduled care — proactive contact and clinical review are warranted before the next scheduled touchpoint is also missed.'
  ),
  jsonb_build_array(
    jsonb_build_object('name', 'no_show_rate_180d', 'source', 'public.appointments', 'justification', 'direct behavioural history of the outcome being predicted'),
    jsonb_build_object('name', 'days_since_last_appointment', 'source', 'public.appointments', 'justification', 'recency of any contact with scheduled care'),
    jsonb_build_object('name', 'has_upcoming_appointment', 'source', 'public.appointments', 'justification', 'whether anything is currently booked to miss'),
    jsonb_build_object('name', 'has_active_care_plan', 'source', 'public.care_plans', 'justification', 'proactive coordinator/clinician contact is protective')
  ),
  'Seeded as an unsigned draft — see cv_risk_config for the same pattern. Requires Clinical Director review and activate_risk_model() before it can influence care; start_risk_model_shadow() first is recommended so its predictions can be evaluated against real outcomes before going live.'
from public.organisations o
on conflict (organisation_id, code, version) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Nightly cron. Predictions run before the existing care-outreach scan
-- (20260723010019_care_outreach_engine.sql, 06:45) so a same-night prediction
-- that mirrors into patient_risk_scores is already visible to that scan —
-- no change to the existing outreach migration was needed for this to work.
-- Outcome resolution runs after both, since it only reads already-elapsed
-- history and has no same-night dependency either way.
-- ---------------------------------------------------------------------------

select cron.schedule(
  'missed-follow-up-predictions-nightly',
  '0 6 * * *',
  $$select private.run_missed_follow_up_predictions();$$
);

select cron.schedule(
  'missed-follow-up-outcomes-nightly',
  '30 6 * * *',
  $$select private.resolve_missed_follow_up_outcomes();$$
);
