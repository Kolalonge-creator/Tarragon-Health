-- Tarragon Health — engagement segmentation (Engagement/Retention gap #2).
--
-- Nothing today flags "drifting" before it becomes a clinical/attendance
-- event: patient_risk_scores is clinical risk, patient_engagement_events()
-- (2026-08-20) is real per-patient behavioural data but only ever consumed
-- in platform-wide aggregate (DAU/MAU etc). This computes a per-patient
-- tier daily and, only for a patient newly crossing into at_risk/disengaged,
-- raises a care_outreach_tasks row — reusing the exact insert/on-conflict
-- pattern private.queue_care_outreach() already uses live, without touching
-- that function.

create type public.patient_engagement_tier as enum (
  'highly_engaged',
  'moderately_engaged',
  'at_risk',
  'disengaged'
);

create table public.patient_engagement_scores (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations(id) on delete restrict,
  patient_id             uuid not null references public.profiles(id) on delete cascade,
  tier                   public.patient_engagement_tier not null,
  days_since_last_event  integer,
  event_count_30d        integer not null default 0,
  event_count_prior_30d  integer not null default 0,
  computed_at            timestamptz not null default now(),
  created_at             timestamptz not null default now()
);

create index patient_engagement_scores_patient_idx
  on public.patient_engagement_scores (patient_id, computed_at desc);
create index patient_engagement_scores_org_idx
  on public.patient_engagement_scores (organisation_id);
-- One row per patient per Lagos calendar day — makes the daily recompute idempotent.
create unique index patient_engagement_scores_daily_uidx
  on public.patient_engagement_scores (patient_id, ((computed_at at time zone 'Africa/Lagos')::date));

alter table public.patient_engagement_scores enable row level security;

create policy patient_engagement_scores_select on public.patient_engagement_scores
  for select to authenticated
  using (private.is_org_staff(organisation_id));

grant select on public.patient_engagement_scores to authenticated;

-- Tiering thresholds live in this one CTE only — tune here, nowhere else.
-- Grace period: a patient with zero engagement events but enrolled under
-- 14 days ago is left unscored ("not yet started" isn't the same signal as
-- "disengaged") rather than immediately branded disengaged.
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
  )
  insert into public.care_outreach_tasks (organisation_id, patient_id, trigger_type, trigger_detail, priority)
  select
    organisation_id,
    patient_id,
    'engagement_decline',
    jsonb_build_object('prior_tier', prior_tier, 'new_tier', new_tier, 'condition_or_type', 'Care engagement'),
    3
  from newly_degraded
  on conflict (patient_id, trigger_type) where status in ('open', 'in_progress', 'contacted') do nothing;
end;
$$;

revoke execute on function private.compute_patient_engagement_tiers() from public, anon;

select cron.schedule(
  'patient-engagement-scoring-daily',
  '15 5 * * *',
  $$select private.compute_patient_engagement_tiers();$$
);

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'patient_engagement_scores') then
    raise exception 'FAIL: patient_engagement_scores table was not created';
  end if;
  if (select count(*) from unnest(enum_range(null::public.patient_engagement_tier)) v) <> 4 then
    raise exception 'FAIL: patient_engagement_tier enum does not have exactly 4 values';
  end if;
  if has_function_privilege('anon', 'private.compute_patient_engagement_tiers()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.compute_patient_engagement_tiers()';
  end if;
  if not exists (select 1 from cron.job where jobname = 'patient-engagement-scoring-daily') then
    raise exception 'FAIL: patient-engagement-scoring-daily cron job was not scheduled';
  end if;
  raise notice 'PASS: patient_engagement_scores + compute_patient_engagement_tiers + daily cron job created';
end $$;
