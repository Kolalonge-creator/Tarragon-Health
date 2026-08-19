-- ===========================================================================
-- Diabetes Clinical Pathway — G19: extend diabetes_quality_metrics with the
-- KPIs §24 actually names that the first pass (20260720170000) left out:
-- % at individual HbA1c target, severe-hypo/DKA events per 100 patients, and
-- average time from a glucose red flag to doctor contact. Also adds a
-- combined "complete annual complication screen" (foot + retinal + renal all
-- up to date at once) since §24 names that as its own KPI, not just the three
-- individual ones the first pass already covered.
-- ===========================================================================

create or replace view public.diabetes_quality_metrics with (security_invoker = true) as
with dm as (
  select distinct patient_id, organisation_id
  from public.care_plans
  where condition = 'diabetes' and status = 'active'
),
foot as (
  select patient_id, max(next_due_at) as due
  from public.diabetic_foot_assessments group by patient_id
),
ret as (
  select patient_id, max(next_due_at) as due
  from public.diabetes_complication_checks where check_type = 'retinal' group by patient_id
),
ren as (
  select patient_id, max(next_due_at) as due
  from public.diabetes_complication_checks where check_type = 'renal' group by patient_id
),
tgt as (
  select patient_id from public.patient_glucose_targets
),
hba1c_latest as (
  select distinct on (l.patient_id) l.patient_id, l.value
  from public.lab_analyte_readings l
  where l.code = 'hba1c'
  order by l.patient_id, l.taken_at desc
),
hba1c_at_target as (
  select h.patient_id
  from hba1c_latest h
  join public.patient_glucose_targets t on t.patient_id = h.patient_id
  where t.hba1c_target_percent is not null and h.value <= t.hba1c_target_percent
),
severe_events as (
  select e.patient_id, count(*) as n
  from public.emergency_events e
  where e.source = 'glucose_red_flag'
    and e.created_at >= now() - interval '90 days'
  group by e.patient_id
),
-- The exact clinician_alerts titles assess-glucose.ts's ALERT_TITLE map
-- raises (raiseGlucoseAlert) — the urgent/amber tier of the glucose
-- red-flag engine, not the emergency tier (which goes to emergency_events
-- above, and has no clinician_alerts "contact" step of its own to time).
flag_titles (title) as (
  values
    ('Priority: hypoglycaemia flagged'),
    ('Priority: very high glucose flagged'),
    ('Priority: raised ketones flagged'),
    ('Persistent high glucose flagged for review'),
    ('Recurrent hypoglycaemia flagged for review'),
    ('Moderate ketones flagged for review')
),
flag_contact as (
  select a.organisation_id, avg(extract(epoch from (a.acknowledged_at - a.created_at)) / 3600.0) as hrs
  from public.clinician_alerts a
  join flag_titles ft on ft.title = a.title
  where a.acknowledged_at is not null
    and a.created_at >= now() - interval '90 days'
  group by a.organisation_id
)
select
  dm.organisation_id,
  count(*)::int as diabetic_patients,
  count(*) filter (where foot.due >= current_date)::int as foot_uptodate,
  count(*) filter (where ret.due >= current_date)::int as retinal_uptodate,
  count(*) filter (where ren.due >= current_date)::int as renal_uptodate,
  count(*) filter (
    where foot.due >= current_date and ret.due >= current_date and ren.due >= current_date
  )::int as complete_complication_screen,
  count(*) filter (where tgt.patient_id is not null)::int as target_set,
  count(*) filter (where hat.patient_id is not null)::int as hba1c_at_target,
  coalesce(sum(sev.n), 0)::int as severe_hypo_dka_events_90d,
  round(coalesce(sum(sev.n), 0) * 100.0 / nullif(count(*), 0), 1) as severe_hypo_dka_per_100_patients,
  round(max(fc.hrs)::numeric, 1) as avg_glucose_flag_to_contact_hours
from dm
left join foot on foot.patient_id = dm.patient_id
left join ret on ret.patient_id = dm.patient_id
left join ren on ren.patient_id = dm.patient_id
left join tgt on tgt.patient_id = dm.patient_id
left join hba1c_at_target hat on hat.patient_id = dm.patient_id
left join severe_events sev on sev.patient_id = dm.patient_id
left join flag_contact fc on fc.organisation_id = dm.organisation_id
group by dm.organisation_id;

grant select on public.diabetes_quality_metrics to authenticated;

do $$
begin
  perform * from public.diabetes_quality_metrics limit 1;
exception when others then
  raise exception 'diabetes_quality_metrics view failed to execute: %', sqlerrm;
end $$;
