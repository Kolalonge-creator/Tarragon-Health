-- Tarragon Health — Chronic Disease Case Management (Module 74), part 5/5:
-- 74.11/74.12 post-discharge monitoring + deterioration detection, and
-- 74.16 case analytics.
--
-- 74.11 ("depending on condition: BP / glucose / weight / symptoms / other
-- clinically appropriate parameters") is NOT new schema — it is the
-- platform's existing vitals_readings logging + BP/SpO2/temperature
-- red-flag engines, which already run for every patient regardless of case
-- management. Module 74 does not need its own monitoring-parameter config
-- to satisfy this; a patient in an active case is simply still using the
-- same app/web logging every other patient uses (CLAUDE.md: "app/web manual
-- entry is never removed... no dual source of truth").
--
-- 74.12 ("Post-discharge → Monitoring → Abnormal trend → Clinical review")
-- reuses that same existing signal instead of re-deriving vitals thresholds
-- a second time: private.classify_bp_level() and the SpO2/temperature
-- engines already turn a single abnormal reading into a clinician_alerts
-- row (type_code abnormal_monitoring/abnormal_result/symptom_escalation).
-- A TREND, for a patient in active case management, is simply a repeat of
-- that same signal — 2 or more such alerts since the case opened (or since
-- the last trend flag) — so this sweep counts existing alerts rather than
-- re-reading vitals_readings and re-implementing BP/glucose/weight bands
-- that already live in the red-flag engines.

create or replace function private.detect_case_deterioration_trends()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_since timestamptz;
  v_count integer;
  v_alert_id uuid;
begin
  for r in
    select id, organisation_id, patient_id, opened_at
    from public.care_management_cases
    where status = 'active'
  loop
    -- Cooldown: count only since the last time this case was already
    -- flagged (or since it opened, if never flagged) — each trend is
    -- reported once, not re-reported every sweep while it persists.
    select coalesce(max(created_at), r.opened_at) into v_since
    from public.care_management_case_events
    where case_id = r.id and event_type = 'deterioration_detected';

    -- Genuinely abnormal-reading signals only — checked via the linkage
    -- columns the 8 real generators set (vital_reading_id/screening_result_id),
    -- not via type_code/category alone: classify_and_assign_clinician_alert's
    -- own fallback classifier defaults an alert with no matching title
    -- pattern to 'abnormal_result' (see that function, part 2 of the
    -- 2026-08-28 alert series) — which the discharge/admission review
    -- alerts inserted by this same migration series would otherwise fall
    -- into, spuriously counting a hospital admission itself as an
    -- "abnormal result" trend signal. symptom_escalation is safe to keep
    -- by type_code: its own title patterns (emergency/diabetic-foot/
    -- eating-disorder screens) don't collide with anything Module 74 raises.
    select count(*) into v_count
    from public.clinician_alerts
    where patient_id = r.patient_id
      and (vital_reading_id is not null or screening_result_id is not null or type_code = 'symptom_escalation')
      and created_at > v_since;

    if v_count >= 2 then
      insert into public.clinician_alerts
        (organisation_id, patient_id, level, status, title, detail, type_code, category, case_id, escalation_level)
      values (
        r.organisation_id, r.patient_id, 'clinician_review', 'open',
        'Deterioration trend flagged for an active case',
        format('%s abnormal clinical alert(s) recorded since %s for a patient in active case management (Module 74.12) — review the trend and the case plan.', v_count, v_since),
        'deterioration', 'clinical', r.id, 2
      )
      returning id into v_alert_id;

      insert into public.care_management_case_events
        (case_id, organisation_id, patient_id, event_type, reason, clinician_alert_id)
      values (
        r.id, r.organisation_id, r.patient_id, 'deterioration_detected',
        format('%s abnormal clinical alerts recorded since %s', v_count, v_since), v_alert_id
      );
    end if;
  end loop;
end;
$$;

comment on function private.detect_case_deterioration_trends() is
  '74.12 sweep: for every active care_management_cases row, counts genuinely abnormal-reading clinician_alerts for that patient (vital_reading_id or screening_result_id set, or type_code=symptom_escalation) raised since the case last had a trend flagged (or since it opened). 2+ raises a deterioration-typed, case-linked clinician_alerts row and logs a deterioration_detected case event, which also sets the cooldown for the next sweep. Reuses the existing red-flag engines'' own thresholds rather than re-deriving them.';

revoke all on function private.detect_case_deterioration_trends() from public, anon;

select cron.schedule(
  'care-management-deterioration-sweep',
  '*/30 * * * *',
  $$select private.detect_case_deterioration_trends()$$
);

-- ---------------------------------------------------------------------------
-- 74.16 case analytics — same analyst-gated, SECURITY DEFINER, fail-closed
-- posture as public.analytics_alert_burden() (20260828020801).
-- ---------------------------------------------------------------------------
create or replace function public.case_management_analytics()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  select jsonb_build_object(
    'active_cases', (select count(*) from public.care_management_cases where status = 'active'),
    'closed_cases', (select count(*) from public.care_management_cases where status = 'closed'),
    'avg_case_duration_days', (
      select round(avg(extract(epoch from (closed_at - opened_at)) / 86400)::numeric, 1)
      from public.care_management_cases where status = 'closed'
    ),
    'cases_by_entry_reason', (
      select coalesce(jsonb_object_agg(entry_reason, n), '{}'::jsonb)
      from (select entry_reason, count(*) as n from public.care_management_cases group by entry_reason) t
    ),
    'intervention_completion', (
      select jsonb_build_object(
        'total', count(*),
        'completed', count(*) filter (where outcome is not null),
        'completion_rate', round(
          (count(*) filter (where outcome is not null))::numeric / nullif(count(*), 0) * 100, 1
        )
      )
      from public.care_plan_interventions where case_id is not null
    ),
    -- EXISTS, not a join, so an admission is counted once even if the
    -- patient has more than one case whose window it could fall into.
    'hospitalisations_during_cases', (
      select count(*)
      from public.patient_hospital_admissions pha
      where exists (
        select 1 from public.care_management_cases cc
        where cc.patient_id = pha.patient_id
          and pha.admitted_on >= cc.opened_at::date
          and pha.admitted_on <= coalesce(cc.closed_at::date, current_date)
      )
    ),
    'unresolved_barriers', (select count(*) from public.care_management_barriers where status = 'open'),
    'cases_with_deterioration_flagged', (
      select count(distinct case_id) from public.care_management_case_events where event_type = 'deterioration_detected'
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.case_management_analytics() is
  '74.16: active/closed case counts, average closed-case duration, cases by entry reason, case-plan-item completion rate, hospitalisations recorded during any case''s open window, unresolved barriers, and how many cases have ever had a deterioration trend flagged. Analyst-gated, same posture as analytics_alert_burden().';

revoke all on function public.case_management_analytics() from public, anon;
grant execute on function public.case_management_analytics() to authenticated;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'care-management-deterioration-sweep') then
    raise exception 'care-management-deterioration-sweep cron job was not scheduled';
  end if;
  if has_function_privilege('anon', 'private.detect_case_deterioration_trends()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.detect_case_deterioration_trends';
  end if;
  if has_function_privilege('anon', 'public.case_management_analytics()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.case_management_analytics';
  end if;
  raise notice 'PASS: deterioration-detection sweep scheduled + case_management_analytics present, anon denied';
end $$;
