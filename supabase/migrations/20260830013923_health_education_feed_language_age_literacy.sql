-- Tarragon Health — Health Education: wire language/age/health-literacy into
-- the recommendation engine (§79.5, §79.9).
--
-- NOTE — reconciliation: `pg_get_functiondef` on the live project showed
-- `health_education_feed()`/`health_education_library()` already carry
-- `audio_url`/`reading_level`/`category` columns and a condition-parameterised
-- `private.health_education_unlock_week(condition)` drip clock — none of
-- which exist in this worktree's local migration files. That work was done
-- by a concurrent session/worktree and applied directly to the shared
-- remote project; it is NOT duplicated here. This migration is written
-- against the actual live function bodies (fetched via pg_get_functiondef
-- immediately before writing this file), preserving every existing column
-- and the existing drip/ordering logic verbatim, and adding only:
--   • language  — coalesce to health_education_translations for the
--     caller's profiles.language, falling back to English.
--   • age       — profiles.date_of_birth vs. content.min_age/max_age
--     (added in 20260830013215_health_education_governance_lifecycle.sql).
--   • health literacy — health_literacy_assessments-driven reordering
--     (added in 20260830014733_health_literacy_assessments.sql), surfacing
--     'getting_started' content first for a patient who self-rated low
--     confidence on one of their active conditions. Still never touches
--     patient_risk_scores or escalation.
-- CORRECTION — a clean/local migration replay starts from the narrower
-- 16-column signature this repo's own migration history left behind
-- (20260717150000/20260723010123/20260723122000), not from live's already-
-- reconciled 19-column shape. Postgres refuses to CREATE OR REPLACE a
-- function whose OUT-parameter row type differs at all (SQLSTATE 42P13),
-- so both changed functions below must be dropped first. DROP FUNCTION also
-- wipes the authenticated-only EXECUTE grant set up when each was first
-- created, so both are re-applied after the recreate — see the recurring
-- anon-EXECUTE gotcha this project has hit multiple times.

drop function if exists public.health_education_feed();

drop function if exists public.health_education_feed();

create function public.health_education_feed()
returns table (
  content_id        uuid,
  code              text,
  title             text,
  summary           text,
  body              text,
  content_type      public.health_education_content_type,
  video_url         text,
  audio_url         text,
  reading_level     public.health_education_reading_level,
  estimated_minutes integer,
  condition         public.care_plan_condition,
  category          public.health_education_category,
  clinician_reviewed boolean,
  reviewed_by_name  text,
  has_knowledge_check boolean,
  knowledge_check   jsonb,
  status            public.health_education_status,
  check_score       integer,
  check_total       integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as uid
  ),
  my_profile as (
    select pr.language, extract(year from age(pr.date_of_birth))::int as age
    from public.profiles pr, me
    where pr.id = me.uid
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
  ),
  my_low_confidence as (
    select exists (
      select 1
      from my_conditions mc
      where private.health_education_latest_literacy((select uid from me), mc.condition) <= 2
    ) as is_low
  )
  select
    c.id,
    c.code,
    coalesce(t.title, c.title),
    coalesce(t.summary, c.summary),
    coalesce(t.body, c.body),
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
  cross join my_profile
  cross join my_low_confidence
  left join public.health_education_progress p
    on p.content_id = c.id and p.patient_id = (select auth.uid())
  left join public.health_education_translations t
    on t.content_id = c.id and t.language = my_profile.language and my_profile.language <> 'en'
  where c.is_active
    and (c.condition is null or c.condition in (select condition from my_conditions))
    and (c.min_risk_level is null or c.min_risk_level <= my_risk.risk_level)
    and (c.drip_week is null or c.drip_week <= private.health_education_unlock_week(c.condition))
    and (my_profile.age is null or c.min_age is null or my_profile.age >= c.min_age)
    and (my_profile.age is null or c.max_age is null or my_profile.age <= c.max_age)
  order by
    case coalesce(p.status, 'seen')
      when 'needs_review' then 0
      else 1
    end,
    case when p.status is null then 0 else 1 end,
    case when my_low_confidence.is_low and c.category = 'getting_started' then 0 else 1 end,
    case when p.status = 'understood' then 1 else 0 end,
    case when c.condition is null then 1 else 0 end,
    coalesce(c.drip_week, 0),
    c.sort_order,
    c.title;
$$;

revoke execute on function public.health_education_feed() from public;
revoke execute on function public.health_education_feed() from anon;
grant execute on function public.health_education_feed() to authenticated;

drop function if exists public.health_education_library(public.health_education_category);

create or replace function public.health_education_library(p_category public.health_education_category default null)
returns table (
  content_id        uuid,
  code              text,
  title             text,
  summary           text,
  body              text,
  content_type      public.health_education_content_type,
  video_url         text,
  audio_url         text,
  reading_level     public.health_education_reading_level,
  estimated_minutes integer,
  condition         public.care_plan_condition,
  category          public.health_education_category,
  clinician_reviewed boolean,
  reviewed_by_name  text,
  has_knowledge_check boolean,
  knowledge_check   jsonb,
  status            public.health_education_status,
  check_score       integer,
  check_total       integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with my_language as (
    select pr.language
    from public.profiles pr
    where pr.id = (select auth.uid())
  )
  select
    c.id,
    c.code,
    coalesce(t.title, c.title),
    coalesce(t.summary, c.summary),
    coalesce(t.body, c.body),
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
  cross join my_language
  left join public.health_education_progress p
    on p.content_id = c.id and p.patient_id = (select auth.uid())
  left join public.health_education_translations t
    on t.content_id = c.id and t.language = my_language.language and my_language.language <> 'en'
  where c.is_active
    and (p_category is null or c.category = p_category)
  order by c.sort_order, c.title;
$$;

revoke execute on function public.health_education_library(public.health_education_category) from public;
revoke execute on function public.health_education_library(public.health_education_category) from anon;
grant execute on function public.health_education_library(public.health_education_category) to authenticated;

-- Named pathways ("Hypertension 101" etc, health_education_programmes/
-- _programme_modules, built by a concurrent session) get the same language
-- coalescing so a translated lesson body shows inside a pathway too, not
-- only in the free-browse library.
create or replace function public.health_education_programme_detail(p_code text)
returns table (
  programme_id uuid,
  programme_code text,
  programme_title text,
  programme_description text,
  module_id uuid,
  module_number integer,
  module_title text,
  content_id uuid,
  content_code text,
  content_title text,
  content_summary text,
  content_body text,
  content_type public.health_education_content_type,
  video_url text,
  audio_url text,
  estimated_minutes integer,
  has_knowledge_check boolean,
  knowledge_check jsonb,
  status public.health_education_status,
  check_score integer,
  check_total integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with my_language as (
    select pr.language
    from public.profiles pr
    where pr.id = (select auth.uid())
  )
  select
    p.id,
    p.code,
    p.title,
    p.description,
    m.id,
    m.module_number,
    m.title,
    c.id,
    c.code,
    coalesce(t.title, c.title),
    coalesce(t.summary, c.summary),
    coalesce(t.body, c.body),
    c.content_type,
    c.video_url,
    c.audio_url,
    c.estimated_minutes,
    (c.knowledge_check is not null and jsonb_array_length(c.knowledge_check) > 0),
    c.knowledge_check,
    prog.status,
    prog.check_score,
    prog.check_total
  from public.health_education_programmes p
  cross join my_language
  join public.health_education_programme_modules m on m.programme_id = p.id
  join public.health_education_content c on c.id = m.content_id
  left join public.health_education_progress prog
    on prog.content_id = c.id and prog.patient_id = (select auth.uid())
  left join public.health_education_translations t
    on t.content_id = c.id and t.language = my_language.language and my_language.language <> 'en'
  where p.code = p_code and (p.is_active or private.is_admin())
  order by m.module_number;
$$;

-- New function, never previously granted — closes the same anon-EXECUTE
-- gotcha (default PUBLIC execute on a fresh SECURITY DEFINER function).
revoke execute on function public.health_education_programme_detail(text) from public;
revoke execute on function public.health_education_programme_detail(text) from anon;
grant execute on function public.health_education_programme_detail(text) to authenticated;
