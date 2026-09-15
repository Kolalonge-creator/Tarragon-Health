-- Tarragon Health — Predictive Risk & Early Warning Engine, 5/5
-- Model monitoring (spec §39.11): performance, calibration, drift, subgroup,
-- false-positive/false-negative analysis. All plain read-only views over
-- risk_predictions + risk_model_outcomes — no new tables, no dashboard UI
-- built here (that is an admin-page concern, not a schema one); a
-- Clinical Director deciding whether to sign a v2 model, or whether to
-- roll one back, queries these directly or via a thin admin page reading
-- them, the same way cv_risk_config's admin page reads that table.
--
-- "Predicted positive" throughout = risk_level in ('high', 'very_high') —
-- the two bands spec §39.9's intervention diagram actually acts on
-- (private.risk_model_may_influence_care gates 'active' models onto
-- care_outreach_tasks starting at 'high'). moderate is intentionally
-- excluded from the positive/negative split: it is a real, distinct band
-- (spec §39.5) but not one that currently triggers an intervention, so
-- folding it into either side of a TP/FP table would misstate what the
-- model is actually being evaluated for doing.

-- ---------------------------------------------------------------------------
-- 1. Per-model performance: precision/recall/false-positive/false-negative
-- counts and rates over every resolved (has an outcome) prediction.
-- security_invoker so it respects the querying user's own RLS, matching
-- every other view in this codebase (patient_care_gaps, etc).
-- ---------------------------------------------------------------------------

create view public.risk_model_performance
with (security_invoker = true) as
select
  rp.risk_model_id,
  rm.organisation_id,
  rm.domain,
  rm.code,
  rm.version,
  rm.status,
  count(*) as resolved_predictions,
  count(*) filter (where rp.risk_level in ('high', 'very_high') and o.outcome_occurred) as true_positives,
  count(*) filter (where rp.risk_level in ('high', 'very_high') and not o.outcome_occurred) as false_positives,
  count(*) filter (where rp.risk_level not in ('high', 'very_high') and not o.outcome_occurred) as true_negatives,
  count(*) filter (where rp.risk_level not in ('high', 'very_high') and o.outcome_occurred) as false_negatives,
  round(
    count(*) filter (where rp.risk_level in ('high', 'very_high') and o.outcome_occurred)::numeric
    / nullif(count(*) filter (where rp.risk_level in ('high', 'very_high')), 0),
    4
  ) as precision_rate,
  round(
    count(*) filter (where rp.risk_level in ('high', 'very_high') and o.outcome_occurred)::numeric
    / nullif(count(*) filter (where o.outcome_occurred), 0),
    4
  ) as recall,
  round(avg(rp.probability), 4) as mean_predicted_probability,
  round(avg(o.outcome_occurred::int), 4) as observed_event_rate
from public.risk_predictions rp
join public.risk_model_outcomes o on o.risk_prediction_id = rp.id
join public.risk_models rm on rm.id = rp.risk_model_id
group by rp.risk_model_id, rm.organisation_id, rm.domain, rm.code, rm.version, rm.status;

comment on view public.risk_model_performance is
  'Per-model-version precision/recall/TP/FP/TN/FN + calibration gap '
  '(mean_predicted_probability vs observed_event_rate) over resolved '
  'predictions only (spec §39.11). A large gap between the two means '
  'columns is a calibration problem even before enough volume exists for a '
  'reliable precision/recall read.';

-- ---------------------------------------------------------------------------
-- 2. Subgroup breakdown — same shape, split by sex and a coarse age band.
-- Deliberately coarse (three bands) rather than exact age: a fine-grained
-- split fragments an already-small resolved-outcomes sample into cells too
-- thin to say anything, and finer subgroup cuts can be added once volume
-- justifies them.
-- ---------------------------------------------------------------------------

create view public.risk_model_performance_by_subgroup
with (security_invoker = true) as
select
  rp.risk_model_id,
  rm.organisation_id,
  rm.domain,
  p.sex,
  case
    when p.date_of_birth is null then 'unknown'
    when date_part('year', age(p.date_of_birth)) < 40 then 'under_40'
    when date_part('year', age(p.date_of_birth)) < 65 then '40_to_64'
    else '65_plus'
  end as age_band,
  count(*) as resolved_predictions,
  count(*) filter (where rp.risk_level in ('high', 'very_high') and o.outcome_occurred) as true_positives,
  count(*) filter (where rp.risk_level in ('high', 'very_high') and not o.outcome_occurred) as false_positives,
  count(*) filter (where rp.risk_level not in ('high', 'very_high') and o.outcome_occurred) as false_negatives,
  round(avg(rp.probability), 4) as mean_predicted_probability,
  round(avg(o.outcome_occurred::int), 4) as observed_event_rate
from public.risk_predictions rp
join public.risk_model_outcomes o on o.risk_prediction_id = rp.id
join public.risk_models rm on rm.id = rp.risk_model_id
join public.profiles p on p.id = rp.patient_id
group by rp.risk_model_id, rm.organisation_id, rm.domain, p.sex, age_band;

comment on view public.risk_model_performance_by_subgroup is
  'Same metrics as risk_model_performance, split by sex and a coarse age '
  'band (spec §39.11 subgroup analysis) — a model that performs well '
  'overall but poorly for one subgroup is exactly what this surfaces.';

-- ---------------------------------------------------------------------------
-- 3. Drift signal — compares the trailing 30 days of predictions against the
-- prior 30 days, per model. A model whose input population or output
-- distribution is quietly shifting shows up here before enough new outcomes
-- exist to move the performance view.
-- ---------------------------------------------------------------------------

create view public.risk_model_drift_signal
with (security_invoker = true) as
with windowed as (
  select
    rp.risk_model_id,
    case
      when rp.computed_at >= now() - interval '30 days' then 'current_30d'
      when rp.computed_at >= now() - interval '60 days' then 'prior_30d'
      else null
    end as window_label,
    rp.probability,
    rp.risk_level
  from public.risk_predictions rp
  where rp.computed_at >= now() - interval '60 days'
)
select
  rm.id as risk_model_id,
  rm.organisation_id,
  rm.domain,
  rm.code,
  rm.version,
  count(*) filter (where w.window_label = 'current_30d') as predictions_current_30d,
  count(*) filter (where w.window_label = 'prior_30d') as predictions_prior_30d,
  round(avg(w.probability) filter (where w.window_label = 'current_30d'), 4) as mean_probability_current_30d,
  round(avg(w.probability) filter (where w.window_label = 'prior_30d'), 4) as mean_probability_prior_30d,
  round(
    (count(*) filter (where w.window_label = 'current_30d' and w.risk_level in ('high', 'very_high')))::numeric
    / nullif(count(*) filter (where w.window_label = 'current_30d'), 0), 4
  ) as elevated_share_current_30d,
  round(
    (count(*) filter (where w.window_label = 'prior_30d' and w.risk_level in ('high', 'very_high')))::numeric
    / nullif(count(*) filter (where w.window_label = 'prior_30d'), 0), 4
  ) as elevated_share_prior_30d
from public.risk_models rm
join windowed w on w.risk_model_id = rm.id
group by rm.id, rm.organisation_id, rm.domain, rm.code, rm.version;

comment on view public.risk_model_drift_signal is
  'Trailing-30-day vs prior-30-day mean probability and elevated-band share '
  'per model (spec §39.11 drift monitoring). A widening gap between the two '
  'periods, with no matching change in the underlying patient population, '
  'is the signal to investigate before it shows up as a performance problem.';

-- security_invoker views still need SELECT on themselves; grants on the
-- underlying tables already restrict actual row visibility to org staff
-- (risk_predictions_select/risk_model_outcomes_select) and to profiles the
-- caller can already see (profiles' own existing RLS), so no further
-- filtering is needed here.
grant select on public.risk_model_performance to authenticated;
grant select on public.risk_model_performance_by_subgroup to authenticated;
grant select on public.risk_model_drift_signal to authenticated;
