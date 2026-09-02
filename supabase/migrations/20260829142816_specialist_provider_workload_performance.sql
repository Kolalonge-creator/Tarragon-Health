-- Tarragon Health
-- Specialist Network & Provider Platform — workload (66.8) and performance
-- (66.9) reporting for a single specialist_providers row. Complements
-- analytics_provider_capacity() (an aggregate, cross-specialty ops rollup)
-- with a per-provider drill-down for the admin specialists manager, same
-- split as analytics_doctor_performance() (org-wide) vs my_provider_
-- performance() (self-scoped) on the employed-staff side — except neither
-- specialist_providers half is self-scoped, since these rows have no login.
--
-- Both RPCs compute strictly from what specialist_referrals actually
-- records. Per 66.9's own caution ("avoid reducing clinical quality to
-- ratings alone"), metrics with no real underlying data are reported as
-- explicit false/null flags, never fabricated: consultation_feedback (the
-- only patient-rating table in the codebase) has no link to
-- specialist_referrals/specialist_providers at all (its clinician_id/
-- appointment_id/video_consultation_id columns are all Appointment-Engine/
-- employed-staff-shaped), and there is no check-in timestamp on
-- specialist_referrals to measure punctuality from — both gaps are
-- surfaced, not hidden, matching my_provider_performance's own
-- revenue_applicable: false precedent.
create or replace function public.analytics_specialist_provider_workload(p_specialist_provider_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not (private.is_admin() or private.is_analyst() or private.has_permission('partners.specialists.manage')) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'consultations_today', count(*) filter (
      where sr.appointment_date::date = current_date and sr.status in ('confirmed', 'completed')
    ),
    'consultations_telemedicine_today', count(*) filter (
      where sr.appointment_date::date = current_date and sr.status in ('confirmed', 'completed')
        and sr.preferred_consultation_type = 'telemedicine'
    ),
    'consultations_physical_today', count(*) filter (
      where sr.appointment_date::date = current_date and sr.status in ('confirmed', 'completed')
        and sr.preferred_consultation_type = 'in_person'
    ),
    'avg_waiting_days_90d', round(
      (avg(extract(epoch from (sr.booking_confirmed_at - sr.created_at)) / 86400.0)
        filter (where sr.booking_confirmed_at is not null and sr.created_at > now() - interval '90 days'))::numeric,
      1
    ),
    'cancellation_rate_90d', round(
      (count(*) filter (where sr.status = 'declined' and sr.created_at > now() - interval '90 days'))::numeric
        / nullif(count(*) filter (where sr.created_at > now() - interval '90 days'), 0),
      3
    ),
    'referrals_90d', count(*) filter (where sr.created_at > now() - interval '90 days')
  ) into v_result
  from public.specialist_referrals sr
  where sr.specialist_provider_id = p_specialist_provider_id;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

revoke all on function public.analytics_specialist_provider_workload(uuid) from public;
revoke all on function public.analytics_specialist_provider_workload(uuid) from anon;
grant execute on function public.analytics_specialist_provider_workload(uuid) to authenticated;

create or replace function public.analytics_specialist_provider_performance(p_specialist_provider_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not (private.is_admin() or private.is_analyst() or private.has_permission('partners.specialists.manage')) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'referrals_total', count(*),
    'referrals_completed', count(*) filter (where sr.status in ('completed', 'closed')),
    'referrals_declined', count(*) filter (where sr.status = 'declined'),
    'referral_completion_rate', round(
      (count(*) filter (where sr.status in ('completed', 'closed')))::numeric / nullif(count(*), 0),
      3
    ),
    'avg_report_turnaround_days', round(
      (avg(extract(epoch from (sr.treatment_plan_received_at - sr.booking_confirmed_at)) / 86400.0)
        filter (where sr.treatment_plan_received_at is not null and sr.booking_confirmed_at is not null))::numeric,
      1
    ),
    'patient_feedback_available', false,
    'punctuality_tracked', false
  ) into v_result
  from public.specialist_referrals sr
  where sr.specialist_provider_id = p_specialist_provider_id;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

revoke all on function public.analytics_specialist_provider_performance(uuid) from public;
revoke all on function public.analytics_specialist_provider_performance(uuid) from anon;
grant execute on function public.analytics_specialist_provider_performance(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.analytics_specialist_provider_workload(uuid)', 'EXECUTE') then
    raise exception 'anon must not be able to execute analytics_specialist_provider_workload';
  end if;
  if has_function_privilege('anon', 'public.analytics_specialist_provider_performance(uuid)', 'EXECUTE') then
    raise exception 'anon must not be able to execute analytics_specialist_provider_performance';
  end if;
end $$;
