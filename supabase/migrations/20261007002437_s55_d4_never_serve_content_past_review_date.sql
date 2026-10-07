-- S55 pre-fix (founder decision D4, spec Module 9 safety rule, acceptance
-- test "content past review_due_at is not served").
--
-- BEFORE: private.health_education_content_sync_is_active keeps `review_due`
-- content is_active = true and every patient read path filtered only on
-- is_active, so a row whose next_review_due had passed was still served until
-- the daily cron flipped its status, and even after the flip (review_due is
-- still "active") it kept being served and retrieved by the AI coach.
--
-- AFTER: a row whose next_review_due is on or before today (Africa/Lagos, the
-- same boundary the daily overdue cron and learning_course use) is never
-- returned to a patient, never retrieved by the AI coach (vector or lexical),
-- and not counted in the category/locked counts, even if the cron has not run.
-- Admins still see every row through the admin queue (RLS admin branch and
-- is_admin() branches), the overdue flag cron is untouched, and is_active is
-- still derived from content_status (a protocol-flagged review_due row with no
-- date still shows, exactly as before: that is a separate, deliberate rule).
--
-- NULL next_review_due: FAIL OPEN, deliberately. A row with no review date has
-- never been given an expiry, so nothing has "passed". Failing closed would
-- remove the whole library on apply. Live counts read-only 2026-10-07 on
-- koiplnmbgnqnbywhpjlf (public.health_education_content):
--     published, clinician_reviewed = true  :   6 rows, 6 with NULL next_review_due
--     published, clinician_reviewed = false : 213 rows, 213 with NULL next_review_due
--     draft (inactive)                      :  30 rows, 30 with NULL next_review_due
--   rows with next_review_due set: 0. rows overdue today: 0.
-- So applying this migration hides ZERO items today. The 219 published rows
-- are not expiry-protected until the CMO gives them a review date: logged as an
-- open question. Course lessons (S33 learning_course) are already fail-closed
-- on NULL and unchanged by this file.
--
-- The single predicate lives in private.health_education_review_in_date() so
-- the CMO decision "fail closed for clinical content" is a one-line change.

create or replace function private.health_education_review_in_date(p_next_review_due date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_next_review_due is null
      or p_next_review_due > (now() at time zone 'Africa/Lagos')::date;
$$;

revoke all on function private.health_education_review_in_date(date) from public;
grant execute on function private.health_education_review_in_date(date) to authenticated, service_role;

comment on function private.health_education_review_in_date(date) is
  'S55 D4: true when a content item may still be served (no review date yet, or the review date is after today in Africa/Lagos). NULL fails open on purpose; see the 2026-10-07 migration header.';

-- ---- RLS: a patient cannot read an out-of-date row directly either ----------
drop policy if exists health_education_content_select on public.health_education_content;
create policy health_education_content_select on public.health_education_content
  for select to authenticated
  using ((is_active and private.health_education_review_in_date(next_review_due)) or private.is_admin());

-- ---- feed ------------------------------------------------------------------
create or replace function public.health_education_feed()
 returns table(content_id uuid, code text, title text, summary text, body text, content_type health_education_content_type, video_url text, audio_url text, reading_level health_education_reading_level, estimated_minutes integer, condition care_plan_condition, category health_education_category, clinician_reviewed boolean, reviewed_by_name text, has_knowledge_check boolean, knowledge_check jsonb, status health_education_status, check_score integer, check_total integer)
 language sql
 stable security definer
 set search_path to ''
as $function$
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
    and private.health_education_review_in_date(c.next_review_due)
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
$function$;

-- ---- library ---------------------------------------------------------------
create or replace function public.health_education_library(p_category health_education_category default null::health_education_category)
 returns table(content_id uuid, code text, title text, summary text, body text, content_type health_education_content_type, video_url text, audio_url text, reading_level health_education_reading_level, estimated_minutes integer, condition care_plan_condition, category health_education_category, clinician_reviewed boolean, reviewed_by_name text, has_knowledge_check boolean, knowledge_check jsonb, status health_education_status, check_score integer, check_total integer)
 language sql
 stable security definer
 set search_path to ''
as $function$
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
    and private.health_education_review_in_date(c.next_review_due)
    and (p_category is null or c.category = p_category)
  order by c.sort_order, c.title;
$function$;

-- ---- detail ----------------------------------------------------------------
create or replace function public.health_education_content_detail(p_code text)
 returns table(content_id uuid, code text, title text, summary text, body text, content_type health_education_content_type, video_url text, audio_url text, reading_level health_education_reading_level, estimated_minutes integer, condition care_plan_condition, category health_education_category, clinician_reviewed boolean, reviewed_by_name text, has_knowledge_check boolean, knowledge_check jsonb, status health_education_status, check_score integer, check_total integer)
 language sql
 stable security definer
 set search_path to ''
as $function$
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
  where c.code = p_code
    and ((c.is_active and private.health_education_review_in_date(c.next_review_due)) or private.is_admin());
$function$;

-- ---- programme detail ------------------------------------------------------
create or replace function public.health_education_programme_detail(p_code text)
 returns table(programme_id uuid, programme_code text, programme_title text, programme_description text, module_id uuid, module_number integer, module_title text, content_id uuid, content_code text, content_title text, content_summary text, content_body text, content_type health_education_content_type, video_url text, audio_url text, estimated_minutes integer, has_knowledge_check boolean, knowledge_check jsonb, status health_education_status, check_score integer, check_total integer)
 language sql
 stable security definer
 set search_path to ''
as $function$
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
    and (private.health_education_review_in_date(c.next_review_due) or private.is_admin())
  order by m.module_number;
$function$;

-- ---- counts ----------------------------------------------------------------
create or replace function public.health_education_category_counts()
 returns table(category health_education_category, item_count integer)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select c.category, count(*)::integer
  from public.health_education_content c
  where c.is_active
    and private.health_education_review_in_date(c.next_review_due)
  group by c.category;
$function$;

create or replace function public.health_education_locked_count()
 returns integer
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
  select count(*)::integer
  from public.health_education_content c
  cross join my_risk
  where c.is_active
    and private.health_education_review_in_date(c.next_review_due)
    and (c.condition is null or c.condition in (select condition from my_conditions))
    and (c.min_risk_level is null or c.min_risk_level <= my_risk.risk_level)
    and c.drip_week is not null
    and c.drip_week > private.health_education_unlock_week(c.condition);
$function$;

-- ---- AI coach retrieval (vector + lexical) ---------------------------------
create or replace function public.match_health_education_content(query_embedding extensions.vector, match_count integer default 3, filter_condition care_plan_condition default null::care_plan_condition)
 returns table(id uuid, code text, title text, summary text, body text, condition care_plan_condition, similarity double precision)
 language sql
 stable
 set search_path to 'public', 'extensions'
as $function$
  select
    c.id, c.code, c.title, c.summary, c.body, c.condition,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.health_education_content c
  where c.clinician_reviewed = true
    and c.is_active = true
    and private.health_education_review_in_date(c.next_review_due)
    and c.embedding is not null
    and (filter_condition is null or c.condition = filter_condition or c.condition is null)
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 0)
$function$;

create or replace function public.search_health_education_content_text(query_text text, match_count integer default 3, filter_condition care_plan_condition default null::care_plan_condition)
 returns table(id uuid, code text, title text, summary text, body text, condition care_plan_condition, similarity double precision)
 language sql
 stable
 set search_path to ''
as $function$
  with q as (
    select nullif(
      (select string_agg(quote_literal(l.lexeme), ' | ')
         from unnest(to_tsvector('pg_catalog.english', coalesce(query_text, ''))) as l),
      ''
    )::tsquery as tsq
  )
  select c.id, c.code, c.title, c.summary, c.body, c.condition,
    ts_rank(
      '{0.1,0.2,0.4,1.0}'::float4[],
      setweight(to_tsvector('pg_catalog.english', coalesce(c.title, '')), 'A') ||
      setweight(to_tsvector('pg_catalog.english', coalesce(c.summary, '')), 'B') ||
      setweight(to_tsvector('pg_catalog.english', coalesce(c.body, '')), 'C'),
      q.tsq
    )::double precision as similarity
  from public.health_education_content c cross join q
  where c.clinician_reviewed = true and c.is_active = true and q.tsq is not null
    and private.health_education_review_in_date(c.next_review_due)
    and to_tsvector('pg_catalog.english', coalesce(c.title, '') || ' ' || coalesce(c.summary, '') || ' ' || coalesce(c.body, '')) @@ q.tsq
    and (filter_condition is null or c.condition = filter_condition or c.condition is null)
  order by similarity desc
  limit greatest(coalesce(match_count, 3), 0)
$function$;

-- create or replace keeps existing grants; assert them anyway.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.health_education_feed()',
    'public.health_education_library(public.health_education_category)',
    'public.health_education_content_detail(text)',
    'public.health_education_programme_detail(text)',
    'public.health_education_category_counts()',
    'public.health_education_locked_count()',
    'public.search_health_education_content_text(text,integer,public.care_plan_condition)'
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') then
      raise exception 'anon can execute %', f;
    end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'authenticated cannot execute %', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'private.health_education_review_in_date(date)', 'EXECUTE') then
    raise exception 'anon can execute the review-date helper';
  end if;
  if not exists (
    select 1 from pg_policies
    where tablename = 'health_education_content' and policyname = 'health_education_content_select'
      and qual ilike '%health_education_review_in_date%'
  ) then
    raise exception 'content select policy was not updated';
  end if;
  if not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'match_health_education_content'
      and pg_get_functiondef(p.oid) ilike '%health_education_review_in_date%'
  ) then
    raise exception 'vector retrieval does not check review date';
  end if;
end $$;
