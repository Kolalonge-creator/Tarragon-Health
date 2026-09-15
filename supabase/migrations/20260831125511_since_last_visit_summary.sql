-- Recovered 2026-09-03 (full-platform audit) from supabase_migrations.schema_migrations:
-- this migration was applied live as version 20260831125511 but existed in no commit on any
-- branch (the session that applied it never committed the file). Committed here verbatim so
-- the applied SQL has a home in git; the release-integrity migration-drift check flags this
-- class as UNTRACED. Do not re-apply.

-- Tarragon Health — "since you were last here" session-delta summary.
--
-- Engagement/retention gap #6 (2026-08-29 audit): next-best-action.tsx is
-- always-current logic, not framed around an absence. This gives a
-- returning patient a short, honest "while you were away" highlight reel
-- instead of a static dashboard, built from tables the patient already
-- owns under RLS (public.care_messages, public.wellness_points_ledger,
-- public.patient_timeline) plus the session-recency primitive added
-- 2026-07-30 for the escalation engine, profiles.app_last_active_at, which
-- has never been read anywhere until now (see 20260730153221_device_
-- heartbeat.sql's own comment).
--
-- Deliberately does NOT touch patient_engagement_scores/care_outreach_tasks
-- (both staff-only RLS, no need to open that boundary) and does NOT write
-- app_last_active_at — read-only. Ordering already works in our favour:
-- the Overview page resolves this during server-side render, before
-- DeviceHeartbeat's client-side effect gets a chance to touch the
-- timestamp, so this reliably reads the *previous* session's value.
--
-- p_patient_id must equal auth.uid() — self-view only for v1. Session
-- recency is a property of who is browsing, not of the patient record on
-- screen, so a caregiver "acting" for a dependent renders nothing here
-- (apps/web gates this client-side too; this is the belt to that braces).

create or replace function public.get_since_last_visit_summary(p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_since         timestamptz;
  v_window_start  timestamptz;
  v_days_since    integer;
  v_messages      integer;
  v_points        integer;
  v_highlights    jsonb;
begin
  if p_patient_id is null or p_patient_id <> (select auth.uid()) then
    return jsonb_build_object('show', false);
  end if;

  select app_last_active_at into v_since from public.profiles where id = p_patient_id;

  if v_since is null or now() - v_since < interval '20 hours' then
    return jsonb_build_object('show', false);
  end if;

  v_days_since := greatest(1, floor(extract(epoch from now() - v_since) / 86400)::int);
  -- Clamp the query window (not the days-since figure shown) so a dormant
  -- account returning after months doesn't dump a huge stale list.
  v_window_start := greatest(v_since, now() - interval '60 days');

  select count(*) into v_messages
  from public.care_messages
  where patient_id = p_patient_id
    and author_role = 'care_team'
    and created_at > v_window_start;

  select coalesce(sum(points), 0) into v_points
  from public.wellness_points_ledger
  where patient_id = p_patient_id
    and points > 0
    and created_at > v_window_start;

  select coalesce(jsonb_agg(jsonb_build_object('event_type', event_type, 'title', title) order by occurred_at desc), '[]'::jsonb)
  into v_highlights
  from (
    select event_type, title, occurred_at
    from public.patient_timeline
    where patient_id = p_patient_id
      and occurred_at > v_window_start
      -- Positive/notable only — "something came back, finished, or
      -- changed" — not routine logging noise (medication_started,
      -- referral_created, message_posted, etc; messages get their own
      -- count above).
      and event_type in (
        'lab_completed', 'screening_completed', 'vaccination_recorded',
        'care_plan_updated', 'escalation_resolved', 'discharge_recorded',
        'referral_status_changed'
      )
    order by occurred_at desc
    limit 3
  ) h;

  if v_messages = 0 and v_points = 0 and v_highlights = '[]'::jsonb then
    return jsonb_build_object('show', false);
  end if;

  return jsonb_build_object(
    'show', true,
    'days_since', v_days_since,
    'messages_count', v_messages,
    'points_earned', v_points,
    'highlights', v_highlights
  );
end;
$$;

revoke all on function public.get_since_last_visit_summary(uuid) from public;
revoke all on function public.get_since_last_visit_summary(uuid) from anon;
grant execute on function public.get_since_last_visit_summary(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.get_since_last_visit_summary(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.get_since_last_visit_summary(uuid)';
  end if;
  raise notice 'PASS: get_since_last_visit_summary(uuid) created, anon-execute confirmed revoked';
end $$;

