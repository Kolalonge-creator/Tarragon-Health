-- Tarragon Health — Imaging & Diagnostic Services Engine, part 3/3: service
-- quality tracking (15.11).
--
-- Mirrors public.analytics_appointment_capacity() (20260828001916) and
-- public.lab_provider_turnaround_stats() (20260730215234) exactly in shape
-- and posture: analyst-gated (private.is_analyst(), fail-open to '{}'::jsonb
-- rather than raising — same as the appointment capacity RPC), small-cell
-- suppression on the per-facility breakdown (< 5 rows) to match
-- lab_provider_turnaround_stats' own "don't let a tiny sample read as a real
-- performance verdict on a partner" fairness posture. Nothing here is a new
-- analytics mechanism — it is the same tracking discipline applied to the
-- new diagnostic_requests/diagnostic_reports tables.

create or replace function public.analytics_diagnostic_service_quality(p_days integer default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  if p_days is null or p_days < 1 or p_days > 3650 then
    raise exception 'p_days must be between 1 and 3650';
  end if;

  return jsonb_build_object(
    'window_days', p_days,

    'by_modality', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'modality', modality,
        'total', total,
        'booked', booked,
        'attended', attended,
        'reported', reported,
        'reviewed', reviewed,
        'actioned', actioned,
        'cancelled', cancelled,
        'cancellation_rate_pct', case when total > 0 then round(100.0 * cancelled / total, 1) else null end,
        'attendance_rate_pct', case when booked > 0 then round(100.0 * attended_or_further / booked, 1) else null end,
        'avg_booking_time_hours', avg_booking_hours,
        'avg_report_delay_hours', avg_report_delay_hours,
        'avg_total_turnaround_hours', avg_total_turnaround_hours
      ) order by total desc), '[]'::jsonb)
      from (
        select
          modality,
          count(*) as total,
          count(*) filter (where booked_at is not null) as booked,
          count(*) filter (where attended_at is not null) as attended,
          count(*) filter (where status in ('attended', 'reported', 'reviewed', 'actioned')) as attended_or_further,
          count(*) filter (where reported_at is not null) as reported,
          count(*) filter (where reviewed_at is not null) as reviewed,
          count(*) filter (where status = 'actioned') as actioned,
          count(*) filter (where status = 'cancelled') as cancelled,
          round((avg(extract(epoch from (booked_at - created_at))) filter (where booked_at is not null) / 3600)::numeric, 1) as avg_booking_hours,
          round((avg(extract(epoch from (reported_at - attended_at))) filter (where reported_at is not null and attended_at is not null) / 3600)::numeric, 1) as avg_report_delay_hours,
          round((avg(extract(epoch from (reported_at - created_at))) filter (where reported_at is not null) / 3600)::numeric, 1) as avg_total_turnaround_hours
        from public.diagnostic_requests
        where created_at >= now() - (p_days * interval '1 day')
        group by modality
      ) t
    ),

    'repeat_examinations_90d', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'modality', modality,
        'patients_with_repeat', patients_with_repeat
      ) order by patients_with_repeat desc), '[]'::jsonb)
      from (
        select modality, count(*) as patients_with_repeat
        from (
          select patient_id, modality, count(*) as n
          from public.diagnostic_requests
          where created_at >= now() - interval '90 days'
            and status <> 'cancelled'
          group by patient_id, modality
          having count(*) > 1
        ) r
        group by modality
      ) t
    ),

    'facility_capacity', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'facility_id', facility_id,
        'facility_name', facility_name,
        'total_requests', total,
        'suppressed', total < 5
      ) order by total desc), '[]'::jsonb)
      from (
        select
          dr.facility_id,
          f.name as facility_name,
          count(*) as total
        from public.diagnostic_requests dr
        left join public.facilities f on f.id = dr.facility_id
        where dr.created_at >= now() - (p_days * interval '1 day')
          and dr.facility_id is not null
        group by dr.facility_id, f.name
      ) t
    ),

    'abnormal_findings_funnel', (
      select jsonb_build_object(
        'reports_reviewed', count(*) filter (where reviewed_at is not null),
        'flagged_abnormal', count(*) filter (where is_abnormal is true),
        'flagged_critical', count(*) filter (where abnormal_severity = 'critical'),
        'action_completed', count(*) filter (where action_completed_at is not null)
      )
      from public.diagnostic_reports
      where created_at >= now() - (p_days * interval '1 day')
    )
  );
end;
$$;

comment on function public.analytics_diagnostic_service_quality(integer) is
  '15.11: booking time, attendance, turnaround, report delay, repeat examination, cancellation, and provider/facility capacity for the Diagnostic Services Engine, windowed to the last p_days. Analyst-gated, small-cell-suppressed on the per-facility breakdown, same posture as analytics_appointment_capacity()/lab_provider_turnaround_stats().';

revoke execute on function public.analytics_diagnostic_service_quality(integer) from public, anon;
grant execute on function public.analytics_diagnostic_service_quality(integer) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.analytics_diagnostic_service_quality(integer)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute analytics_diagnostic_service_quality';
  end if;
  if not has_function_privilege('authenticated', 'public.analytics_diagnostic_service_quality(integer)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute analytics_diagnostic_service_quality';
  end if;
  raise notice 'PASS: Diagnostic Services Engine quality analytics in place';
end $$;
