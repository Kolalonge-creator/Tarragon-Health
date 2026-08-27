-- Tarragon Health — self-scoped provider performance (Care Team / Provider
-- Workspace §5.21). Nothing like this existed for an individual clinician to
-- see their own dashboard: analytics_doctor_performance (20260718205129) is
-- gated to private.is_analyst() and de-identifies every patient down to
-- patient_number for a cross-org console — the right shape for an analyst,
-- wrong for a doctor looking at their own real caseload.
--
-- Reuses that RPC's exact metric formulas (escalations_reviewed,
-- alerts_acknowledged, meds_confirmed, reviews_completed, avg_ack_minutes,
-- avg_resolution_hours, sla_met_pct) so the two views can never silently
-- diverge on what "an escalation reviewed" means, just re-scoped to
-- auth.uid() instead of iterating every doctor, and free to return real
-- names/detail since RLS-equivalent scoping here is "your own data only."
--
-- Deliberately excluded rather than half-built:
--   * Revenue — Tarragon employs its doctors on salary/per-caseload terms
--     (CLAUDE.md's Clinical Tier Ladder staffing table), not fee-per-service;
--     there is no per-consultation revenue figure for an individual doctor
--     anywhere in this schema. Returning revenue_applicable=false rather
--     than a fabricated ₦0 or an invented number.
--   * Patient feedback — confirmed by a full-repo grep (feedback/rating/nps/
--     csat) that no patient-satisfaction data exists anywhere in this
--     platform. Returning patient_feedback_available=false rather than a
--     tile with nothing behind it.
--   * "Outstanding documentation" — no first-class flag exists for this
--     (checked: no escalation status means "notes owed"). Not returned; the
--     open-alerts count already covers the closest real thing ("pending
--     results").
-- referrals_made undercounts by design — specialist_referrals.set_by is
-- nullable and unset on system/abnormal-result-triggered referrals, so
-- referrals_partial_attribution=true is returned alongside the count as an
-- honest flag, not a footnote the UI can silently drop.

create or replace function public.my_provider_performance(
  p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid      uuid := (select auth.uid());
  v_staff_id uuid;
begin
  select id into v_staff_id
  from public.clinical_staff
  where profile_id = v_uid and active;

  if v_staff_id is null then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'patients_assigned', (
      select count(*) from public.care_team_assignment where clinician_id = v_uid
    ),
    'escalations_reviewed', (
      select count(*) from public.escalations
      where reviewed_by = v_uid and reviewed_at is not null
        and (p_from is null or reviewed_at >= p_from) and (p_to is null or reviewed_at <= p_to)
    ),
    'alerts_acknowledged', (
      select count(*) from public.clinician_alerts
      where acknowledged_by = v_uid and acknowledged_at is not null
        and (p_from is null or acknowledged_at >= p_from) and (p_to is null or acknowledged_at <= p_to)
    ),
    'meds_confirmed', (
      select count(*) from public.medications where last_confirmed_by = v_staff_id
    ),
    'reviews_completed', (
      select count(*) from public.medication_reviews
      where reviewed_by = v_staff_id and completed_at is not null
    ),
    'avg_ack_minutes', (
      select coalesce(round(avg(extract(epoch from (acknowledged_at - created_at)) / 60.0)::numeric, 1), 0)
      from public.clinician_alerts
      where acknowledged_by = v_uid and acknowledged_at is not null
    ),
    'avg_resolution_hours', (
      select coalesce(round(avg(extract(epoch from (reviewed_at - created_at)) / 3600.0)::numeric, 1), 0)
      from public.escalations
      where reviewed_by = v_uid and reviewed_at is not null
    ),
    'sla_met_pct', (
      select case when count(*) filter (where sla_due_at is not null) = 0 then null
        else round(100.0 * count(*) filter (
               where sla_due_at is not null and acknowledged_at is not null and acknowledged_at <= sla_due_at
             ) / count(*) filter (where sla_due_at is not null), 1) end
      from public.clinician_alerts
      where acknowledged_by = v_uid
    ),
    'pending_results', (
      select count(*) from public.clinician_alerts a
      join public.care_team_assignment cta on cta.patient_id = a.patient_id
      where cta.clinician_id = v_uid and a.status = 'open'
    ),
    'consultations_completed', (
      select count(*) from public.appointments
      where clinician_id = v_uid and status = 'completed'
        and (p_from is null or scheduled_for >= p_from) and (p_to is null or scheduled_for <= p_to)
    ),
    'consultations_cancelled', (
      select count(*) from public.appointments
      where clinician_id = v_uid and status in ('cancelled', 'no_show')
        and (p_from is null or scheduled_for >= p_from) and (p_to is null or scheduled_for <= p_to)
    ),
    'referrals_made', (
      select count(*) from public.specialist_referrals
      where set_by = v_uid
        and (p_from is null or created_at >= p_from) and (p_to is null or created_at <= p_to)
    ),
    'referrals_partial_attribution', true,
    'revenue_applicable', false,
    'patient_feedback_available', false
  );
end; $$;

comment on function public.my_provider_performance(timestamptz, timestamptz) is
  'Self-scoped clinician performance dashboard (Care Team / Provider Workspace §5.21). '
  'Returns {} for a caller with no active clinical_staff row. Reuses '
  'analytics_doctor_performance''s metric formulas — see that migration for the '
  'de-identified, is_analyst()-gated, cross-org console version this is NOT a replacement for.';

revoke execute on function public.my_provider_performance(timestamptz, timestamptz) from public, anon;
grant execute on function public.my_provider_performance(timestamptz, timestamptz) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.my_provider_performance(timestamptz, timestamptz)', 'EXECUTE') then
    raise exception 'my_provider_performance is EXECUTE-able by anon — ACL did not land as intended';
  end if;
  if not has_function_privilege('authenticated', 'public.my_provider_performance(timestamptz, timestamptz)', 'EXECUTE') then
    raise exception 'my_provider_performance is NOT EXECUTE-able by authenticated — grant failed';
  end if;
end $$;
