-- Recovered 2026-09-03 (full-platform audit) from supabase_migrations.schema_migrations:
-- this migration was applied live as version 20260831125450 but existed in no commit on any
-- branch (the session that applied it never committed the file). Committed here verbatim so
-- the applied SQL has a home in git; the release-integrity migration-drift check flags this
-- class as UNTRACED. Do not re-apply.

-- Tarragon Health — notify the patient when engagement declines.
--
-- private.compute_patient_engagement_tiers() (20260830104140_patient_engagement_scoring.sql)
-- already opens a care_outreach_tasks row (trigger_type='engagement_decline') the moment a
-- patient newly crosses into at_risk/disengaged — but that table is staff-only (see its own
-- migration comment: "patients never see these rows"). The general outreach engine,
-- private.queue_care_outreach() (20260723010019_care_outreach_engine.sql), already pairs every
-- one of ITS triggers with "a warm nudge notification instead" — that half was just never wired
-- for this specific trigger. This closes that gap: same insert shape, no other behaviour change.
--
-- Channel is 'in_app', not 'whatsapp' like queue_care_outreach()'s own nudge — two-way/session
-- content is in-app only (CLAUDE.md), and Meta WABA/Termii approval are both still pending
-- platform-wide (see 20260811235133_guarantee_in_app_notification_companions.sql, which fixed the
-- exact same class of gap for 21 other triggers the same way: an in_app companion needs no
-- external provider approval). status='pending' matches every other in_app insert in that
-- migration, not just the whatsapp convention — the bell reads content_class/channel, not status.

create or replace function private.compute_patient_engagement_tiers()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  with thresholds as (
    select
      14 as grace_days,
      3   as highly_days,   8 as highly_count,
      10  as moderate_days, 3 as moderate_count,
      21  as at_risk_days
  ),
  last_event as (
    select e.patient_id, max(e.occurred_at) as last_at
    from private.patient_engagement_events() e
    join private.real_patient_ids() rp on rp.patient_id = e.patient_id
    group by e.patient_id
  ),
  counts as (
    select
      rp.patient_id,
      p.organisation_id,
      p.created_at as enrolled_at,
      le.last_at,
      (
        select count(*) from private.patient_engagement_events() e
        where e.patient_id = rp.patient_id and e.occurred_at >= now() - interval '30 days'
      ) as c30,
      (
        select count(*) from private.patient_engagement_events() e
        where e.patient_id = rp.patient_id
          and e.occurred_at >= now() - interval '60 days'
          and e.occurred_at <  now() - interval '30 days'
      ) as c30_prior
    from private.real_patient_ids() rp
    join public.profiles p on p.id = rp.patient_id
    left join last_event le on le.patient_id = rp.patient_id
    where p.organisation_id is not null
  ),
  scored as (
    select
      c.patient_id,
      c.organisation_id,
      c.c30,
      c.c30_prior,
      case when c.last_at is null then null
           else extract(day from now() - c.last_at)::int
      end as days_since,
      case
        when c.last_at is null and c.enrolled_at > now() - (t.grace_days || ' days')::interval
          then null
        when c.last_at is null
          then 'disengaged'
        when extract(day from now() - c.last_at) <= t.highly_days and c.c30 >= t.highly_count
          then 'highly_engaged'
        when extract(day from now() - c.last_at) <= t.moderate_days and c.c30 >= t.moderate_count
          then 'moderately_engaged'
        when extract(day from now() - c.last_at) <= t.at_risk_days
          then 'at_risk'
        else 'disengaged'
      end::public.patient_engagement_tier as tier
    from counts c, thresholds t
  ),
  inserted as (
    insert into public.patient_engagement_scores
      (organisation_id, patient_id, tier, days_since_last_event, event_count_30d, event_count_prior_30d)
    select organisation_id, patient_id, tier, days_since, c30, c30_prior
    from scored
    where tier is not null
    on conflict (patient_id, ((computed_at at time zone 'Africa/Lagos')::date)) do nothing
    returning organisation_id, patient_id, tier, computed_at
  ),
  prior as (
    select distinct on (s.patient_id) s.patient_id, s.tier
    from public.patient_engagement_scores s
    join inserted i on i.patient_id = s.patient_id
    where s.computed_at < date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'
    order by s.patient_id, s.computed_at desc
  ),
  newly_degraded as (
    select i.organisation_id, i.patient_id, coalesce(pr.tier::text, 'none') as prior_tier, i.tier as new_tier
    from inserted i
    left join prior pr on pr.patient_id = i.patient_id
    where i.tier in ('at_risk', 'disengaged')
      and (pr.tier is null or pr.tier not in ('at_risk', 'disengaged'))
  ),
  declined as (
    insert into public.care_outreach_tasks (organisation_id, patient_id, trigger_type, trigger_detail, priority)
    select
      organisation_id,
      patient_id,
      'engagement_decline',
      jsonb_build_object('prior_tier', prior_tier, 'new_tier', new_tier, 'condition_or_type', 'Care engagement'),
      3
    from newly_degraded
    on conflict (patient_id, trigger_type) where status in ('open', 'in_progress', 'contacted') do nothing
    returning organisation_id, patient_id
  )
  -- Warm nudge companion — only for patients whose outreach task actually landed above (the
  -- on-conflict-do-nothing there already collapses this to "genuinely new" for us).
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select d.organisation_id, d.patient_id, 'in_app', 'pending', 'engagement_reengagement_nudge', '{}'::jsonb
  from declined d;
end;
$$;

revoke execute on function private.compute_patient_engagement_tiers() from public;

do $$
begin
  if has_function_privilege('anon', 'private.compute_patient_engagement_tiers()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.compute_patient_engagement_tiers()';
  end if;
  raise notice 'PASS: compute_patient_engagement_tiers() now also queues an in_app engagement_reengagement_nudge notification on genuine decline';
end $$;

