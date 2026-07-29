-- Tarragon Health — the education-drip unlock nudge is in-app only.
--
-- Founder correction: the lesson content was always in-app-only, but the
-- NUDGE that a new week unlocked was queued on the 'whatsapp' channel
-- (20260723225124), which would have sent an external WhatsApp/SMS message
-- for a purely educational, non-urgent event. WhatsApp/SMS stays reserved
-- for reminders, alerts and confirmations (Non-Negotiable Business Rules) —
-- an engagement nudge like "your next lesson unlocked" belongs in-app only.
--
-- 'in_app' is an existing notification_channel value with RLS already
-- written for exactly this ("recipient sees own, may mark read" —
-- 20260705211409) but no UI ever read it before the NotificationBell
-- (apps/web/src/components/shell/notification-bell.tsx). send-pending-
-- notifications only ever queries channel IN (whatsapp, sms, email), so an
-- in_app row is never picked up by that function — it is read directly by
-- the client, never sent externally. No edge-function change or Meta
-- template approval needed for this notification at all.

create or replace function private.queue_health_education_unlock_nudges()
returns void
language sql
security definer
set search_path = ''
as $$
  with patients as (
    select p.id as patient_id, p.organisation_id
    from public.profiles p
    where p.role = 'patient' and p.organisation_id is not null
  ),
  patient_conditions as (
    select distinct cp.patient_id, cp.condition
    from public.care_plans cp
    where cp.status = 'active'
  ),
  patient_risk as (
    select prs.patient_id, max(prs.risk_level) as risk_level
    from public.patient_risk_scores prs
    group by prs.patient_id
  ),
  candidates as (
    select
      pt.patient_id,
      pt.organisation_id,
      c.id as content_id,
      c.title,
      c.sort_order,
      coalesce(c.condition::text, 'general') as track_key,
      c.drip_week as unlock_week
    from public.health_education_content c
    join patients pt on true
    left join patient_conditions pc
      on pc.patient_id = pt.patient_id and pc.condition = c.condition
    left join patient_risk pr on pr.patient_id = pt.patient_id
    where c.is_active
      and c.drip_week is not null
      and (c.condition is null or pc.condition is not null)
      and (c.min_risk_level is null
           or c.min_risk_level <= coalesce(pr.risk_level, 'low'::public.risk_level))
      and c.drip_week = private.health_education_unlock_week_for(pt.patient_id, c.condition)
  ),
  unseen as (
    select cand.*
    from candidates cand
    where not exists (
      select 1 from public.health_education_progress hep
      where hep.patient_id = cand.patient_id and hep.content_id = cand.content_id
    )
  ),
  newly_marked as (
    insert into public.health_education_unlock_notifications
      (patient_id, organisation_id, track_key, unlock_week)
    select distinct patient_id, organisation_id, track_key, unlock_week
    from unseen
    on conflict (patient_id, track_key, unlock_week) do nothing
    returning patient_id
  ),
  to_notify as (
    select distinct
      nm.patient_id,
      (select organisation_id from unseen u where u.patient_id = nm.patient_id limit 1)
        as organisation_id,
      (select u.title from unseen u where u.patient_id = nm.patient_id
        order by u.sort_order limit 1) as lead_title,
      (select count(distinct u.content_id) from unseen u where u.patient_id = nm.patient_id)
        as item_count
    from newly_marked nm
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select organisation_id, patient_id, 'in_app', 'pending', 'health_education_unlock',
    jsonb_build_object('lesson_title', lead_title, 'lesson_count', item_count)
  from to_notify;
$$;
