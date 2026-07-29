-- Tarragon Health — Analytics Console: staff (Tarragon team) login activity.
-- Sessionizes each internal team member's web_events by 30-minute inactivity
-- gaps into login sessions (start / end / duration), so an analyst can see who
-- logged in, when, and for how long. Reuses the existing capture pipeline — no
-- IP, no PHI; internal-employee roles only. security definer, is_analyst-gated.
create or replace function public.analytics_staff_activity(
  p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return (
    with staff_events as (
      select w.profile_id, w.occurred_at, p.full_name, p.role::text role
      from public.web_events w
      join public.profiles p on p.id = w.profile_id
      where w.profile_id is not null
        and p.role in ('admin','clinician','doctor','care_coordinator','analyst')
        and (p_from is null or w.occurred_at >= p_from)
        and (p_to is null or w.occurred_at <= p_to)
    ),
    marked as (
      select *,
        case when lag(occurred_at) over (partition by profile_id order by occurred_at) is null
               or occurred_at - lag(occurred_at) over (partition by profile_id order by occurred_at) > interval '30 minutes'
             then 1 else 0 end new_session
      from staff_events
    ),
    numbered as (
      select *, sum(new_session) over (partition by profile_id order by occurred_at rows unbounded preceding) session_num
      from marked
    ),
    sessions as (
      select profile_id, coalesce(full_name,'(unnamed)') full_name, role, session_num,
        min(occurred_at) started, max(occurred_at) ended, count(*) pageviews,
        round(extract(epoch from (max(occurred_at) - min(occurred_at)))/60.0)::int duration_min
      from numbered group by profile_id, full_name, role, session_num
    )
    select jsonb_build_object(
      'staff_total', (select count(*) from public.profiles where role in ('admin','clinician','doctor','care_coordinator','analyst')),
      'active_today', (select count(distinct profile_id) from staff_events where occurred_at >= date_trunc('day', now())),
      'active_7d', (select count(distinct profile_id) from staff_events where occurred_at >= now() - interval '7 days'),
      'sessions_total', (select count(*) from sessions),
      'by_staff', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'staff', full_name, 'role', role, 'sessions', sessions,
          'active_minutes', active_minutes, 'pageviews', pageviews, 'last_seen', last_seen) order by last_seen desc), '[]'::jsonb)
        from (
          select full_name, role, count(*) sessions, sum(duration_min) active_minutes,
                 sum(pageviews) pageviews, max(ended) last_seen
          from sessions group by profile_id, full_name, role
        ) t
      ),
      'recent_sessions', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'staff', full_name, 'role', role, 'started', started, 'ended', ended,
          'duration_min', duration_min, 'pageviews', pageviews) order by started desc), '[]'::jsonb)
        from (select * from sessions order by started desc limit 100) t
      )
    )
  );
end; $$;

revoke execute on function public.analytics_staff_activity(timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_staff_activity(timestamptz, timestamptz) to authenticated;
