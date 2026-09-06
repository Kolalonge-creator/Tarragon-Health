-- Tarragon Health — Symptom Assessment & Triage Engine, part 4: safety
-- monitoring (platform brief §37.11).
--
-- §37.11 asks the platform to measure: emergency escalation rate, clinician
-- override rate, false reassurance, inappropriate escalation, missed red
-- flags. The first two are computable directly from
-- symptom_triage_assessments; the last three are inherently a clinical
-- judgement call on a SPECIFIC assessment (whether it should have fired a
-- red flag but didn't, whether a reassuring outcome was actually wrong, and
-- so on) — they cannot be inferred automatically, so they are recorded as
-- reviewing-clinician flags on the assessment row itself (part 3's
-- clinician_flagged_* columns) and simply aggregated here, not computed.
--
-- security_invoker view (mirrors diabetes_quality_metrics) so each caller
-- only ever sees the rates their own RLS grants let them see — an org
-- staff member sees their org's real numbers; a patient querying it
-- directly only ever sees a rate computed over their own row(s), since the
-- underlying table's RLS has already scoped what feeds the aggregate.
create or replace view public.triage_safety_monitoring with (security_invoker = true) as
select
  organisation_id,
  count(*)::int as total_assessments,
  count(*) filter (where category = 'emergency')::int as emergency_count,
  count(*) filter (where category = 'urgent')::int as urgent_count,
  count(*) filter (where category = 'routine')::int as routine_count,
  count(*) filter (where category = 'self_management')::int as self_management_count,
  round(count(*) filter (where category = 'emergency')::numeric / nullif(count(*), 0), 4) as emergency_escalation_rate,
  round(count(*) filter (where category in ('emergency', 'urgent'))::numeric / nullif(count(*), 0), 4) as any_escalation_rate,
  count(*) filter (where clinician_review_required)::int as clinician_review_required_count,
  round(count(*) filter (where clinician_review_required)::numeric / nullif(count(*), 0), 4) as clinician_review_required_rate,
  count(*) filter (where override_category is not null)::int as clinician_override_count,
  round(count(*) filter (where override_category is not null)::numeric / nullif(count(*), 0), 4) as clinician_override_rate,
  count(*) filter (where override_category is not null and override_category != category)::int as override_changed_category_count,
  count(*) filter (where clinician_flagged_missed_red_flag)::int as flagged_missed_red_flag_count,
  count(*) filter (where clinician_flagged_false_reassurance)::int as flagged_false_reassurance_count,
  count(*) filter (where clinician_flagged_inappropriate_escalation)::int as flagged_inappropriate_escalation_count,
  min(created_at) as earliest_assessment_at,
  max(created_at) as latest_assessment_at
from public.symptom_triage_assessments
group by organisation_id;

comment on view public.triage_safety_monitoring is
  'Symptom Assessment & Triage Engine safety monitoring (§37.11). All-time, per-organisation rates — filter symptom_triage_assessments directly for a specific period. missed-red-flag/false-reassurance/inappropriate-escalation counts reflect clinician review findings recorded on individual assessments (see symptom_triage_assessments.clinician_flagged_*), not an automatic computation.';

grant select on public.triage_safety_monitoring to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.views where table_schema = 'public' and table_name = 'triage_safety_monitoring') then
    raise exception 'FAIL: triage_safety_monitoring view was not created';
  end if;
  raise notice 'PASS: triage_safety_monitoring view created';
end $$;
