-- Tarragon Health — weekly drip pacing for the health-education curriculum.
--
-- The Omada/Noom borrow: instead of dumping the whole library on day one,
-- content can be assigned a curriculum week (drip_week 1 = available from the
-- patient's first week). Null keeps today's behaviour (always available), so
-- every existing row is untouched and drip is opt-in per item. The patient's
-- clock starts at their first engagement with education content (first
-- progress row) or, failing that, onboarding completion — no new state table,
-- both anchors already exist.
--
-- health_education_feed keeps its exact return signature (CREATE OR REPLACE,
-- no drop) — it just additionally filters not-yet-unlocked drip items. A tiny
-- companion RPC reports how many items are still locked so the patient card
-- can say "N more unlock in the coming weeks" instead of content silently
-- not existing.

alter table public.health_education_content
  add column if not exists drip_week integer check (drip_week is null or drip_week >= 1);

create or replace function private.health_education_current_week()
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
        (select min(p.created_at) from public.health_education_progress p
          where p.patient_id = (select auth.uid())),
        (select pr.onboarding_completed_at from public.profiles pr
          where pr.id = (select auth.uid())),
        now()
      ))) / 604800.0
    ))::integer + 1
  );
$$;

create or replace function public.health_education_feed()
 returns table(content_id uuid, code text, title text, summary text, body text, content_type health_education_content_type, video_url text, estimated_minutes integer, condition care_plan_condition, clinician_reviewed boolean, reviewed_by_name text, has_knowledge_check boolean, knowledge_check jsonb, status health_education_status, check_score integer, check_total integer)
 language sql
 stable security definer
 set search_path to ''
as $function$
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
    c.estimated_minutes,
    c.condition,
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
    and (c.drip_week is null or c.drip_week <= private.health_education_current_week())
  order by
    case coalesce(p.status, 'seen')
      when 'needs_review' then 0
      else 1
    end,
    case when p.status is null then 0 else 1 end,
    case when p.status = 'understood' then 1 else 0 end,
    c.sort_order,
    c.title;
$function$;

-- How many otherwise-eligible items are still drip-locked for the caller.
create or replace function public.health_education_locked_count()
returns integer
language sql
stable
security definer
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
  select count(*)::integer
  from public.health_education_content c
  cross join my_risk
  where c.is_active
    and (c.condition is null or c.condition in (select condition from my_conditions))
    and (c.min_risk_level is null or c.min_risk_level <= my_risk.risk_level)
    and c.drip_week is not null
    and c.drip_week > private.health_education_current_week();
$$;

revoke execute on function public.health_education_locked_count() from public, anon;
grant execute on function public.health_education_locked_count() to authenticated;
