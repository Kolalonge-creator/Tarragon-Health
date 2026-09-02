-- Tarragon Health
-- Clinical Governance gap-closure, item 1 of 6 (§88.12 "clinical audit" of
-- the 2026-08-29 governance/safety spec audit — completing a PARTIAL item,
-- not just closing a NOT-BUILT one, per explicit founder instruction on
-- this pass). Confirmed live before writing this: diabetes_quality_metrics
-- (20260720170000, extended 20260810032858) is the only condition-quality
-- view that exists; hypertension and obesity, both core wedge/chronic
-- pathways per CLAUDE.md, had none. Same CTE-per-metric shape, same
-- security_invoker view, same organisation-level aggregate grain, same
-- grant -- copied deliberately rather than inventing a new pattern.
--
-- Metrics are NOT diabetes' metrics relabelled -- each condition uses its
-- own real tables and its own genuinely relevant measures (HTN has no
-- retinal/renal complication-check cadence; obesity has no target-BP
-- concept). Nothing here invents a clinical threshold: "at target" reads
-- whatever patient_bp_targets/patient_weight_goals already say, the same
-- deference to signed clinical config diabetes_quality_metrics itself
-- shows toward patient_glucose_targets.

create view public.hypertension_quality_metrics
with (security_invoker = true) as
with hm as (
  select distinct care_plans.patient_id, care_plans.organisation_id
  from public.care_plans
  where care_plans.condition = 'hypertension' and care_plans.status = 'active'
),
-- One row per patient: their most recently set BP target.
target as (
  select distinct on (patient_bp_targets.patient_id)
    patient_bp_targets.patient_id, patient_bp_targets.home_systolic, patient_bp_targets.home_diastolic
  from public.patient_bp_targets
  order by patient_bp_targets.patient_id, patient_bp_targets.created_at desc
),
-- One row per patient: their most recent home BP reading.
latest_bp as (
  select distinct on (vitals_readings.patient_id)
    vitals_readings.patient_id, vitals_readings.systolic, vitals_readings.diastolic, vitals_readings.taken_at
  from public.vitals_readings
  where vitals_readings.vital_type = 'blood_pressure'
  order by vitals_readings.patient_id, vitals_readings.taken_at desc
),
at_target as (
  select latest_bp.patient_id
  from latest_bp
  join target on target.patient_id = latest_bp.patient_id
  where latest_bp.systolic is not null and latest_bp.diastolic is not null
    and latest_bp.systolic <= target.home_systolic and latest_bp.diastolic <= target.home_diastolic
),
recent_reading as (
  select latest_bp.patient_id
  from latest_bp
  where latest_bp.taken_at >= now() - interval '30 days'
),
severe_events as (
  select emergency_events.patient_id, count(*) as n
  from public.emergency_events
  where emergency_events.source = 'bp_reading' and emergency_events.created_at >= now() - interval '90 days'
  group by emergency_events.patient_id
),
-- Every title private.handle_bp_reading_red_flag() can raise, per its own
-- live definition -- queried, not assumed, before writing this.
flag_titles(title) as (
  values
    ('Priority 1: high blood pressure reading'),
    ('Priority 1: raised BP in pregnancy'),
    ('Blood pressure above target'),
    ('Missing expected blood-pressure readings')
),
flag_contact as (
  select clinician_alerts.organisation_id,
    avg(extract(epoch from (clinician_alerts.acknowledged_at - clinician_alerts.created_at)) / 3600.0) as hrs
  from public.clinician_alerts
  join flag_titles on flag_titles.title = clinician_alerts.title
  where clinician_alerts.acknowledged_at is not null and clinician_alerts.created_at >= now() - interval '90 days'
  group by clinician_alerts.organisation_id
)
select
  hm.organisation_id,
  count(*)::int as hypertensive_patients,
  count(*) filter (where target.patient_id is not null)::int as target_set,
  count(*) filter (where at_target.patient_id is not null)::int as at_target,
  count(*) filter (where recent_reading.patient_id is not null)::int as reading_within_30d,
  coalesce(sum(severe_events.n), 0)::int as severe_events_90d,
  round(coalesce(sum(severe_events.n), 0) * 100.0 / nullif(count(*), 0), 1) as severe_events_per_100_patients,
  round(max(flag_contact.hrs), 1) as avg_bp_flag_to_contact_hours
from hm
left join target on target.patient_id = hm.patient_id
left join at_target on at_target.patient_id = hm.patient_id
left join recent_reading on recent_reading.patient_id = hm.patient_id
left join severe_events on severe_events.patient_id = hm.patient_id
left join flag_contact on flag_contact.organisation_id = hm.organisation_id
group by hm.organisation_id;

comment on view public.hypertension_quality_metrics is
  'Hypertension complication-prevention/quality KPIs, mirroring diabetes_quality_metrics'' shape (§88.12) -- target-set/at-target rate, monitoring currency, severe (hypertensive-crisis) events per 90 days, average flag-to-contact time.';

grant select on public.hypertension_quality_metrics to authenticated;

-- ---------------------------------------------------------------------------

create view public.obesity_quality_metrics
with (security_invoker = true) as
with om as (
  select distinct patient_id, organisation_id
  from (
    select patient_id, organisation_id from public.care_plans where condition = 'obesity' and status = 'active'
    union
    select patient_id, organisation_id from public.lpe_enrollments where condition = 'obesity' and status in ('active', 'maintenance')
  ) combined
),
goal as (
  select distinct on (patient_weight_goals.patient_id)
    patient_weight_goals.patient_id
  from public.patient_weight_goals
  order by patient_weight_goals.patient_id, patient_weight_goals.created_at desc
),
active_engagement as (
  select distinct patient_id from public.lpe_enrollments where condition = 'obesity' and status = 'active'
),
-- ED/mental-health screening currency (§16.3/§18.2 gate): most recent
-- screen, and whether it's both recent and negative.
latest_screen as (
  select distinct on (obesity_ed_screens.patient_id)
    obesity_ed_screens.patient_id, obesity_ed_screens.positive, obesity_ed_screens.screened_at
  from public.obesity_ed_screens
  order by obesity_ed_screens.patient_id, obesity_ed_screens.screened_at desc
),
screen_current_clear as (
  select patient_id from latest_screen
  where screened_at >= now() - interval '180 days' and positive = false
),
red_flags as (
  select lpe_red_flag_events.patient_id, count(*) as n
  from public.lpe_red_flag_events
  where lpe_red_flag_events.created_at >= now() - interval '90 days'
  group by lpe_red_flag_events.patient_id
),
flag_contact as (
  select clinician_alerts.organisation_id,
    avg(extract(epoch from (clinician_alerts.acknowledged_at - clinician_alerts.created_at)) / 3600.0) as hrs
  from public.clinician_alerts
  join public.lpe_red_flag_events on lpe_red_flag_events.clinician_alert_id = clinician_alerts.id
  where clinician_alerts.acknowledged_at is not null and lpe_red_flag_events.created_at >= now() - interval '90 days'
  group by clinician_alerts.organisation_id
)
select
  om.organisation_id,
  count(*)::int as obesity_patients,
  count(*) filter (where goal.patient_id is not null)::int as weight_goal_set,
  count(*) filter (where active_engagement.patient_id is not null)::int as actively_engaged,
  count(*) filter (where screen_current_clear.patient_id is not null)::int as ed_screen_current_and_clear,
  coalesce(sum(red_flags.n), 0)::int as red_flag_events_90d,
  round(coalesce(sum(red_flags.n), 0) * 100.0 / nullif(count(*), 0), 1) as red_flag_events_per_100_patients,
  round(max(flag_contact.hrs), 1) as avg_red_flag_to_contact_hours
from om
left join goal on goal.patient_id = om.patient_id
left join active_engagement on active_engagement.patient_id = om.patient_id
left join screen_current_clear on screen_current_clear.patient_id = om.patient_id
left join red_flags on red_flags.patient_id = om.patient_id
left join flag_contact on flag_contact.organisation_id = om.organisation_id
group by om.organisation_id;

comment on view public.obesity_quality_metrics is
  'Obesity/lifestyle-programme quality KPIs, mirroring diabetes_quality_metrics'' shape (§88.12) -- weight-goal-set rate, active engagement, ED/mental-health screening currency (the §16.3/§18.2 weight-loss safety gate), red-flag events per 90 days, average flag-to-contact time.';

grant select on public.obesity_quality_metrics to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.views where table_schema='public' and table_name='hypertension_quality_metrics') then
    raise exception 'hypertension_quality_metrics was not created';
  end if;
  if not exists (select 1 from information_schema.views where table_schema='public' and table_name='obesity_quality_metrics') then
    raise exception 'obesity_quality_metrics was not created';
  end if;
  if not has_table_privilege('authenticated', 'public.hypertension_quality_metrics', 'SELECT') then
    raise exception 'authenticated lacks SELECT on hypertension_quality_metrics';
  end if;
  if not has_table_privilege('authenticated', 'public.obesity_quality_metrics', 'SELECT') then
    raise exception 'authenticated lacks SELECT on obesity_quality_metrics';
  end if;
  raise notice 'PASS: hypertension_quality_metrics + obesity_quality_metrics created, grants present';
end $$;
