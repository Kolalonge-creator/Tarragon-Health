-- ===========================================================================
-- Diabetes Clinical Pathway — Sprint D (G19): clinical-audit KPIs (§24)
-- ---------------------------------------------------------------------------
-- §24 KPIs are "the evidence engine — they prove clinical quality to the
-- Clinical Director and outcomes to HMOs/corporates". A security_invoker view
-- so each caller only ever sees their own org's aggregate (the underlying
-- tables' is_org_staff RLS scopes it). Covers the complication-surveillance
-- KPIs; HbA1c-at-target and event rates track separately as those pipelines
-- mature.
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
tgt as (select patient_id from public.patient_glucose_targets)
select
  dm.organisation_id,
  count(*)::int as diabetic_patients,
  count(*) filter (where foot.due >= current_date)::int as foot_uptodate,
  count(*) filter (where ret.due >= current_date)::int as retinal_uptodate,
  count(*) filter (where ren.due >= current_date)::int as renal_uptodate,
  count(*) filter (where tgt.patient_id is not null)::int as target_set
from dm
left join foot on foot.patient_id = dm.patient_id
left join ret on ret.patient_id = dm.patient_id
left join ren on ren.patient_id = dm.patient_id
left join tgt on tgt.patient_id = dm.patient_id
group by dm.organisation_id;

grant select on public.diabetes_quality_metrics to authenticated;
