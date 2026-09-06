-- Surfaces the new content-model columns (reading_level, audio_url, and — for the feed,
-- which never returned it — category) through the two existing read RPCs. Logic is
-- otherwise byte-for-byte the same as the live functions (confirmed via
-- pg_get_functiondef before writing this migration, per the CLAUDE.md lesson on not
-- trusting migration-file history for a function's current shape).
--
-- DROP + CREATE rather than CREATE OR REPLACE: Postgres does not allow changing a
-- RETURNS TABLE(...) function's output columns via OR REPLACE.

drop function if exists public.health_education_feed();

create function public.health_education_feed()
returns table (
  content_id uuid,
  code text,
  title text,
  summary text,
  body text,
  content_type public.health_education_content_type,
  video_url text,
  audio_url text,
  reading_level public.health_education_reading_level,
  estimated_minutes integer,
  condition public.care_plan_condition,
  category public.health_education_category,
  clinician_reviewed boolean,
  reviewed_by_name text,
  has_knowledge_check boolean,
  knowledge_check jsonb,
  status public.health_education_status,
  check_score integer,
  check_total integer
)
language sql
stable security definer
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as uid
  ),
  my_conditions as (
    select distinct cp.condition
    from public.care_plans cp, me
    where cp.patient_id = me.uid and cp.status = 'active'
  ),
  my_risk as (
    select coalesce(max(prs.risk_level), 'low'::public.risk_level) as risk_level
    from public.patient_risk_scores prs, me
    where prs.patient_id = me.uid
  )
  select
    c.id,
    c.code,
    c.title,
    c.summary,
    c.body,
    c.content_type,
    c.video_url,
    c.audio_url,
    c.reading_level,
    c.estimated_minutes,
    c.condition,
    c.category,
    c.clinician_reviewed,
    c.reviewed_by_name,
    (c.knowledge_check is not null and jsonb_array_length(c.knowledge_check) > 0) as has_knowledge_check,
    c.knowledge_check,
    p.status,
    p.check_score,
    p.check_total
  from public.health_education_content c
  cross join my_risk
  left join public.health_education_progress p
    on p.content_id = c.id and p.patient_id = (select auth.uid())
  where c.is_active
    and (c.condition is null or c.condition in (select condition from my_conditions))
    and (c.min_risk_level is null or c.min_risk_level <= my_risk.risk_level)
    and (c.drip_week is null or c.drip_week <= private.health_education_unlock_week(c.condition))
  order by
    case coalesce(p.status, 'seen')
      when 'needs_review' then 0
      else 1
    end,
    case when p.status is null then 0 else 1 end,
    case when p.status = 'understood' then 1 else 0 end,
    -- Programme-specific lessons before general ones; curriculum order within.
    case when c.condition is null then 1 else 0 end,
    coalesce(c.drip_week, 0),
    c.sort_order,
    c.title;
$$;

revoke all on function public.health_education_feed() from public;
revoke all on function public.health_education_feed() from anon;
grant execute on function public.health_education_feed() to authenticated;

drop function if exists public.health_education_library(public.health_education_category);

create function public.health_education_library(p_category public.health_education_category default null)
returns table (
  content_id uuid,
  code text,
  title text,
  summary text,
  body text,
  content_type public.health_education_content_type,
  video_url text,
  audio_url text,
  reading_level public.health_education_reading_level,
  estimated_minutes integer,
  condition public.care_plan_condition,
  category public.health_education_category,
  clinician_reviewed boolean,
  reviewed_by_name text,
  has_knowledge_check boolean,
  knowledge_check jsonb,
  status public.health_education_status,
  check_score integer,
  check_total integer
)
language sql
stable security definer
set search_path = ''
as $$
  select
    c.id,
    c.code,
    c.title,
    c.summary,
    c.body,
    c.content_type,
    c.video_url,
    c.audio_url,
    c.reading_level,
    c.estimated_minutes,
    c.condition,
    c.category,
    c.clinician_reviewed,
    c.reviewed_by_name,
    (c.knowledge_check is not null and jsonb_array_length(c.knowledge_check) > 0) as has_knowledge_check,
    c.knowledge_check,
    p.status,
    p.check_score,
    p.check_total
  from public.health_education_content c
  left join public.health_education_progress p
    on p.content_id = c.id and p.patient_id = (select auth.uid())
  where c.is_active
    and (p_category is null or c.category = p_category)
  order by c.sort_order, c.title;
$$;

revoke all on function public.health_education_library(public.health_education_category) from public;
revoke all on function public.health_education_library(public.health_education_category) from anon;
grant execute on function public.health_education_library(public.health_education_category) to authenticated;
