-- Tarragon Health — weekly "your new lesson is ready" nudge for the
-- per-programme education drip (20260723122000).
--
-- The drip engine unlocks content passively — a patient only discovers a new
-- week's lesson by opening the app. Every comparable drip programme (Omada
-- included) pairs the unlock with an active nudge, so this closes that gap
-- using the existing notifications queue (WhatsApp/SMS reminder-only, per
-- the platform's WhatsApp-is-notifications-not-a-transactional-interface
-- rule — the lesson itself is only ever read in-app).
--
-- Idempotency: a small bookkeeping table (patient, track, unlock_week) is
-- the source of truth for "already nudged", not a time-window heuristic —
-- consistent with reminder_sent_at-style columns used elsewhere. A daily
-- cron re-runs safely: on-conflict-do-nothing means a patient is nudged
-- exactly once per track per week, the moment that week's content first
-- becomes visible to them, regardless of which day of the week the cron
-- happens to catch the rollover on.

create table if not exists public.health_education_unlock_notifications (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  -- The condition value, or 'general' for the condition-null track — text,
  -- not the enum, so this table never needs a migration when a new
  -- condition/track is added.
  track_key       text not null,
  unlock_week     integer not null,
  notified_at     timestamptz not null default now(),
  unique (patient_id, track_key, unlock_week)
);
create index if not exists health_education_unlock_notifications_patient_idx
  on public.health_education_unlock_notifications (patient_id);

alter table public.health_education_unlock_notifications enable row level security;

-- Read-only transparency for the patient; all writes happen through the
-- SECURITY DEFINER cron function below (table owner bypasses RLS), so no
-- insert/update/delete grant is needed for authenticated at all.
drop policy if exists health_education_unlock_notifications_select
  on public.health_education_unlock_notifications;
create policy health_education_unlock_notifications_select
  on public.health_education_unlock_notifications
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select on public.health_education_unlock_notifications to authenticated;

-- Same clock as private.health_education_unlock_week (20260723122000), but
-- parameterised on an explicit patient rather than auth.uid() — the cron
-- runs with no session, so there is no caller to key off.
create or replace function private.health_education_unlock_week_for(
  p_patient uuid,
  p_condition public.care_plan_condition
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    1,
    (floor(
      extract(epoch from (now() - coalesce(
        case when p_condition is not null then
          (select min(cp.created_at)
           from public.care_plans cp
           where cp.patient_id = p_patient
             and cp.condition = p_condition
             and cp.status = 'active')
        end,
        (select min(p.created_at) from public.health_education_progress p
          where p.patient_id = p_patient),
        (select pr.onboarding_completed_at from public.profiles pr
          where pr.id = p_patient),
        now()
      ))) / 604800.0
    ))::integer + 1
  );
$$;

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
  -- Drip-gated content that unlocks EXACTLY on the patient's own track clock
  -- this run — i.e. it just became visible, not merely already visible from
  -- an earlier week (which would otherwise re-nudge every day of that week).
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
  -- Skip anything the patient already has a progress row for (e.g. an admin
  -- lowered drip_week after they'd already read it) — the nudge is only for
  -- lessons that are both newly unlocked AND genuinely unseen.
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
    -- Only patients with at least one track this run actually newly marked —
    -- a re-run inserts nothing for an already-notified week, so nobody is
    -- re-nudged. lead_title/item_count summarise every unseen-and-just-
    -- unlocked item for the patient, not just the newly-marked track, so a
    -- patient on two tracks that unlock the same week gets one aggregated
    -- nudge, same shape as care_outreach_checkin.
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
  select organisation_id, patient_id, 'whatsapp', 'pending', 'health_education_unlock',
    jsonb_build_object('lesson_title', lead_title, 'lesson_count', item_count)
  from to_notify;
$$;

select cron.schedule(
  'health-education-unlock-nudge-daily',
  '15 7 * * *',
  $$select private.queue_health_education_unlock_nudges();$$
);
