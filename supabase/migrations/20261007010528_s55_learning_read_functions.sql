-- S55: Learning Centre read functions, part 2 of 2 (see 20261007010525_s55_learning_governance_aliases_creators.sql).
--
-- One private function, private.health_education_items(), derives every patient-facing column once (reviewer credit, Members
-- lock, in-date test, next step, creator byline), and feed / library / detail / programme detail / search / this-week /
-- offline re-check all read from it, so the review-date rule (S55 D4) and the lock rule cannot drift between read paths.
-- English only: the translations join is gone (D-14). The AI coach retrieval functions already carry the D4 date rule.
--
-- Reviewer credit (9.6) is null-gated: a name comes back only when clinician_reviewed AND reviewed_at are both set. The name is
-- the linked verified clinician (clinical_owner_id) when there is one, else the legacy free-text reviewed_by_name.
-- Members lock (9.7): a creator item shows to a non-member as locked, with no body, audio, video or check.
-- The patient read functions change their return columns, so each is dropped and recreated and its grants are re-asserted.

drop function if exists public.health_education_feed();
drop function if exists public.health_education_library(public.health_education_category);
drop function if exists public.health_education_content_detail(text);
drop function if exists public.health_education_programme_detail(text);

create or replace function private.health_education_items(p_codes text[] default null)
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
  check_total integer,
  audio_clip_id text,
  reviewed_at timestamptz,
  source_reference text,
  next_review_due date,
  next_action text,
  next_step_kind text,
  next_step_target_code text,
  next_step_target_title text,
  series_tag text,
  members_only boolean,
  locked boolean,
  creator_name text,
  is_public boolean,
  servable boolean,
  is_active boolean,
  drip_week integer,
  min_risk_level public.risk_level,
  min_age integer,
  max_age integer,
  sort_order integer,
  raw_title text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as uid
  ),
  perk as (
    select (private.is_admin() or private.patient_is_member((select uid from me))) as is_member
  )
  select
    c.id,
    c.code,
    c.title,
    c.summary,
    case when c.members_only and not perk.is_member then null else c.body end,
    c.content_type,
    case when c.members_only and not perk.is_member then null else c.video_url end,
    case when c.members_only and not perk.is_member then null else c.audio_url end,
    c.reading_level,
    c.estimated_minutes,
    c.condition,
    c.category,
    c.clinician_reviewed,
    case when c.clinician_reviewed and c.reviewed_at is not null then coalesce(rs.full_name, c.reviewed_by_name) end,
    (c.knowledge_check is not null and jsonb_array_length(c.knowledge_check) > 0 and not (c.members_only and not perk.is_member)),
    case when c.members_only and not perk.is_member then null else c.knowledge_check end,
    p.status,
    p.check_score,
    p.check_total,
    case when c.members_only and not perk.is_member then null else c.audio_clip_id end,
    case when c.clinician_reviewed then c.reviewed_at end,
    c.source_reference,
    c.next_review_due,
    c.next_action,
    c.next_step_kind,
    c.next_step_target_code,
    case when nt.id is not null and nt.is_active and private.health_education_review_in_date(nt.next_review_due) then nt.title end,
    c.series_tag,
    c.members_only,
    (c.members_only and not perk.is_member),
    case when c.creator_id is not null then crs.full_name end,
    c.is_public,
    (c.is_active
       and private.health_education_review_in_date(c.next_review_due)
       and (c.creator_id is null or private.learning_creator_in_good_standing(c.creator_id))),
    c.is_active,
    c.drip_week,
    c.min_risk_level,
    c.min_age,
    c.max_age,
    c.sort_order,
    c.title
  from public.health_education_content c
  cross join perk
  left join public.health_education_progress p
    on p.content_id = c.id and p.patient_id = (select uid from me)
  left join public.clinical_staff rs on rs.id = c.clinical_owner_id
  left join public.creators cr on cr.id = c.creator_id
  left join public.clinical_staff crs on crs.id = cr.clinical_staff_id
  left join public.health_education_content nt on nt.code = c.next_step_target_code
  where p_codes is null or c.code = any (p_codes);
$$;
revoke all on function private.health_education_items(text[]) from public, anon, authenticated;

-- ---- library --------------------------------------------------------------------------------------------------------
create or replace function public.health_education_library(p_category public.health_education_category default null)
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
  check_total integer,
  audio_clip_id text,
  reviewed_at timestamptz,
  source_reference text,
  next_review_due date,
  next_action text,
  next_step_kind text,
  next_step_target_code text,
  next_step_target_title text,
  series_tag text,
  members_only boolean,
  locked boolean,
  creator_name text,
  is_public boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.content_id,
    i.code,
    i.title,
    i.summary,
    i.body,
    i.content_type,
    i.video_url,
    i.audio_url,
    i.reading_level,
    i.estimated_minutes,
    i.condition,
    i.category,
    i.clinician_reviewed,
    i.reviewed_by_name,
    i.has_knowledge_check,
    i.knowledge_check,
    i.status,
    i.check_score,
    i.check_total,
    i.audio_clip_id,
    i.reviewed_at,
    i.source_reference,
    i.next_review_due,
    i.next_action,
    i.next_step_kind,
    i.next_step_target_code,
    i.next_step_target_title,
    i.series_tag,
    i.members_only,
    i.locked,
    i.creator_name,
    i.is_public
  from private.health_education_items() i
  where i.servable
    and (p_category is null or i.category = p_category)
  order by i.sort_order, i.raw_title;
$$;

-- ---- feed (personalised and paced) ----------------------------------------------------------------------------------
create or replace function public.health_education_feed()
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
  check_total integer,
  audio_clip_id text,
  reviewed_at timestamptz,
  source_reference text,
  next_review_due date,
  next_action text,
  next_step_kind text,
  next_step_target_code text,
  next_step_target_title text,
  series_tag text,
  members_only boolean,
  locked boolean,
  creator_name text,
  is_public boolean
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
    select extract(year from age(pr.date_of_birth))::int as age
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
    i.content_id,
    i.code,
    i.title,
    i.summary,
    i.body,
    i.content_type,
    i.video_url,
    i.audio_url,
    i.reading_level,
    i.estimated_minutes,
    i.condition,
    i.category,
    i.clinician_reviewed,
    i.reviewed_by_name,
    i.has_knowledge_check,
    i.knowledge_check,
    i.status,
    i.check_score,
    i.check_total,
    i.audio_clip_id,
    i.reviewed_at,
    i.source_reference,
    i.next_review_due,
    i.next_action,
    i.next_step_kind,
    i.next_step_target_code,
    i.next_step_target_title,
    i.series_tag,
    i.members_only,
    i.locked,
    i.creator_name,
    i.is_public
  from private.health_education_items() i
  cross join my_risk
  cross join my_low_confidence
  left join my_profile on true
  where i.servable
    and (i.condition is null or i.condition in (select condition from my_conditions))
    and (i.min_risk_level is null or i.min_risk_level <= my_risk.risk_level)
    and (i.drip_week is null or i.drip_week <= private.health_education_unlock_week(i.condition))
    and (my_profile.age is null or i.min_age is null or my_profile.age >= i.min_age)
    and (my_profile.age is null or i.max_age is null or my_profile.age <= i.max_age)
  order by
    case coalesce(i.status::text, 'seen') when 'needs_review' then 0 else 1 end,
    case when i.status is null then 0 else 1 end,
    case when my_low_confidence.is_low and i.category = 'getting_started' then 0 else 1 end,
    case when i.status = 'understood' then 1 else 0 end,
    case when i.condition is null then 1 else 0 end,
    coalesce(i.drip_week, 0),
    i.sort_order,
    i.raw_title;
$$;

-- ---- detail ---------------------------------------------------------------------------------------------------------
create or replace function public.health_education_content_detail(p_code text)
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
  check_total integer,
  audio_clip_id text,
  reviewed_at timestamptz,
  source_reference text,
  next_review_due date,
  next_action text,
  next_step_kind text,
  next_step_target_code text,
  next_step_target_title text,
  series_tag text,
  members_only boolean,
  locked boolean,
  creator_name text,
  is_public boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.content_id,
    i.code,
    i.title,
    i.summary,
    i.body,
    i.content_type,
    i.video_url,
    i.audio_url,
    i.reading_level,
    i.estimated_minutes,
    i.condition,
    i.category,
    i.clinician_reviewed,
    i.reviewed_by_name,
    i.has_knowledge_check,
    i.knowledge_check,
    i.status,
    i.check_score,
    i.check_total,
    i.audio_clip_id,
    i.reviewed_at,
    i.source_reference,
    i.next_review_due,
    i.next_action,
    i.next_step_kind,
    i.next_step_target_code,
    i.next_step_target_title,
    i.series_tag,
    i.members_only,
    i.locked,
    i.creator_name,
    i.is_public
  from private.health_education_items(array[p_code]) i
  where i.code = p_code
    and (i.servable or private.is_admin());
$$;

-- ---- programme detail: ordered modules with the caller's progress ------------------------------------------------------
create or replace function public.health_education_programme_detail(p_code text)
returns table (programme_id uuid, programme_code text, programme_title text, programme_description text, module_id uuid,
  module_number integer, module_title text, content_id uuid, content_code text, content_title text, content_summary text,
  content_body text, content_type public.health_education_content_type, video_url text, audio_url text, estimated_minutes integer,
  has_knowledge_check boolean, knowledge_check jsonb, status public.health_education_status, check_score integer, check_total integer,
  clinician_reviewed boolean, reviewed_by_name text, reviewed_at timestamptz, source_reference text, next_review_due date, next_action text,
  next_step_kind text, next_step_target_code text, next_step_target_title text, series_tag text, audio_clip_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id, p.code, p.title, p.description, m.id, m.module_number, m.title,
    i.content_id, i.code, i.title, i.summary, i.body, i.content_type, i.video_url, i.audio_url, i.estimated_minutes,
    i.has_knowledge_check, i.knowledge_check, i.status, i.check_score, i.check_total,
    i.clinician_reviewed, i.reviewed_by_name, i.reviewed_at, i.source_reference, i.next_review_due, i.next_action,
    i.next_step_kind, i.next_step_target_code, i.next_step_target_title, i.series_tag, i.audio_clip_id
  from public.health_education_programmes p
  join public.health_education_programme_modules m on m.programme_id = p.id
  join private.health_education_items() i on i.content_id = m.content_id
  where p.code = p_code
    and (p.is_active or private.is_admin())
    and ((i.servable and not i.locked) or private.is_admin())
  order by m.module_number;
$$;

-- ---- counts (same rule as the library) ----------------------------------------------------------------------------------
create or replace function public.health_education_category_counts()
returns table (category public.health_education_category, item_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select i.category, count(*)::integer
  from private.health_education_items() i
  where i.servable
  group by i.category;
$$;

-- ---- search in everyday terms (9.3), no model call --------------------------------------------------------------------------
-- Matches title, summary and body across every category. Everyday words that a CMO has reviewed in
-- health_education_search_aliases ("BP", "sugar", "high blood") add their plain expansion to the query. Only in-date, published
-- items are returned (a Members item comes back locked, with no body). matched_alias says which alias fired.
create or replace function public.health_education_search(p_query text, p_limit integer default 20)
returns table (
  content_id uuid, code text, title text, summary text, category public.health_education_category,
  content_type public.health_education_content_type, estimated_minutes integer, locked boolean,
  matched_alias text, expanded_to text, rank real
)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select left(btrim(coalesce(p_query, '')), 200) as raw,
           private.normalise_term(left(coalesce(p_query, ''), 200)) as norm
  ),
  hit as (
    select a.alias, a.expands_to
    from public.health_education_search_aliases a, q
    where a.review_state = 'clinician_reviewed'
      and q.norm is not null
      and (' ' || q.norm || ' ') like ('% ' || a.alias_normalised || ' %')
  ),
  extra as (
    select string_agg(h.expands_to, ' ') as words, (array_agg(h.alias order by length(h.alias) desc))[1] as first_alias
    from hit h
  ),
  tsq as (
    select nullif(
      (select string_agg(quote_literal(l.lexeme), ' | ')
         from unnest(to_tsvector('pg_catalog.english', q.raw || ' ' || coalesce(extra.words, ''))) as l),
      ''
    )::tsquery as query
    from q cross join extra
  )
  select
    i.content_id, i.code, i.title, i.summary, i.category, i.content_type, i.estimated_minutes, i.locked,
    extra.first_alias, extra.words,
    ts_rank(
      '{0.1,0.2,0.4,1.0}'::float4[],
      setweight(to_tsvector('pg_catalog.english', coalesce(i.title, '')), 'A') ||
      setweight(to_tsvector('pg_catalog.english', coalesce(i.summary, '')), 'B') ||
      setweight(to_tsvector('pg_catalog.english', coalesce(i.body, '')), 'C'),
      tsq.query
    ) as rank
  from private.health_education_items() i
  cross join tsq
  cross join extra
  where i.servable
    and tsq.query is not null
    and to_tsvector('pg_catalog.english', coalesce(i.title, '') || ' ' || coalesce(i.summary, '') || ' ' || coalesce(i.body, '')) @@ tsq.query
  order by rank desc, i.raw_title
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

-- ---- this week's lesson for Today (9.2) --------------------------------------------------------------------------------------
-- One short lesson, weekly pacing: the item a patient is eligible for under the same rules as the feed, with drip_week at or
-- before their current week, not yet finished (understood or needs_review), no longer than the lesson limit. The lesson for the
-- current week comes first; an earlier unfinished one is next. Nothing is returned when there is nothing to do.
create or replace function public.learning_this_week()
returns table (
  content_id uuid, code text, title text, summary text, estimated_minutes integer, category public.health_education_category,
  drip_week integer, is_current_week boolean, audio_clip_id text
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
    select extract(year from age(pr.date_of_birth))::int as age
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
  )
  select
    i.content_id, i.code, i.title, i.summary, i.estimated_minutes, i.category, i.drip_week,
    (i.drip_week = private.health_education_unlock_week(i.condition)),
    i.audio_clip_id
  from private.health_education_items() i
  cross join my_risk
  left join my_profile on true
  where i.servable
    and not i.locked
    and i.drip_week is not null
    and i.drip_week <= private.health_education_unlock_week(i.condition)
    and i.estimated_minutes between 1 and private.learning_max_lesson_minutes()
    and coalesce(i.status::text, 'seen') not in ('understood', 'needs_review')
    and (i.condition is null or i.condition in (select condition from my_conditions))
    and (i.min_risk_level is null or i.min_risk_level <= my_risk.risk_level)
    and (my_profile.age is null or i.min_age is null or my_profile.age >= i.min_age)
    and (my_profile.age is null or i.max_age is null or my_profile.age <= i.max_age)
  order by (i.drip_week = private.health_education_unlock_week(i.condition)) desc, i.drip_week, i.sort_order
  limit 1;
$$;

-- ---- offline re-check (9.6) -----------------------------------------------------------------------------------------------
-- The phone sends the codes it has downloaded; it gets back only the ones that may still be served (active, in date, not locked
-- for this caller) with the review date and version, so an expired or withdrawn item is removed from the phone on the next sync.
create or replace function public.health_education_servable_codes(p_codes text[])
returns table (code text, next_review_due date, content_version integer)
language sql
stable
security definer
set search_path = ''
as $$
  select i.code, i.next_review_due, c.content_version
  from private.health_education_items(p_codes) i
  join public.health_education_content c on c.id = i.content_id
  where i.code = any (coalesce(p_codes, '{}'::text[]))
    and i.servable
    and not i.locked
  limit 200;
$$;

-- ---- public share page (9.8) ------------------------------------------------------------------------------------------------
-- The ONLY function in this module that anon can call, on purpose. Returns an item only when it is flagged public, published,
-- in date, clinician reviewed with a review date, and not a Members item. No patient data of any kind is involved.
create or replace function public.public_health_education_item(p_code text)
returns table (
  code text, title text, summary text, body text, category public.health_education_category, estimated_minutes integer,
  reviewed_by_name text, reviewed_at timestamptz, source_reference text, next_review_due date, next_action text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.code, c.title, c.summary, c.body, c.category, c.estimated_minutes,
         coalesce(rs.full_name, c.reviewed_by_name), c.reviewed_at, c.source_reference, c.next_review_due, c.next_action
  from public.health_education_content c
  left join public.clinical_staff rs on rs.id = c.clinical_owner_id
  where c.code = p_code
    and c.is_public
    and not c.members_only
    and c.creator_id is null
    and c.is_active
    and c.content_status in ('published', 'review_due')
    and c.clinician_reviewed
    and c.reviewed_at is not null
    and private.health_education_review_in_date(c.next_review_due);
$$;

-- ---- grants ---------------------------------------------------------------------------------------------------------------------
revoke all on function public.health_education_library(public.health_education_category) from public, anon;
revoke all on function public.health_education_feed() from public, anon;
revoke all on function public.health_education_content_detail(text) from public, anon;
revoke all on function public.health_education_programme_detail(text) from public, anon;
revoke all on function public.health_education_category_counts() from public, anon;
revoke all on function public.health_education_search(text, integer) from public, anon;
revoke all on function public.learning_this_week() from public, anon;
revoke all on function public.health_education_servable_codes(text[]) from public, anon;
revoke all on function public.public_health_education_item(text) from public;
grant execute on function public.health_education_library(public.health_education_category) to authenticated;
grant execute on function public.health_education_feed() to authenticated;
grant execute on function public.health_education_content_detail(text) to authenticated;
grant execute on function public.health_education_programme_detail(text) to authenticated;
grant execute on function public.health_education_category_counts() to authenticated;
grant execute on function public.health_education_search(text, integer) to authenticated;
grant execute on function public.learning_this_week() to authenticated;
grant execute on function public.health_education_servable_codes(text[]) to authenticated;
grant execute on function public.public_health_education_item(text) to anon, authenticated;

-- ---- RLS: direct table reads follow the same rule; Members items are read through the functions only -------------------
drop policy if exists health_education_content_select on public.health_education_content;
create policy health_education_content_select on public.health_education_content
  for select to authenticated
  using (
    (is_active and not members_only and private.health_education_review_in_date(next_review_due))
    or private.is_admin()
  );

-- ---- assertions -----------------------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.health_education_library(public.health_education_category)', 'public.health_education_feed()',
    'public.health_education_content_detail(text)', 'public.health_education_programme_detail(text)',
    'public.health_education_category_counts()', 'public.health_education_search(text,integer)',
    'public.learning_this_week()', 'public.health_education_servable_codes(text[])'
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon can execute %', f; end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated cannot execute %', f; end if;
  end loop;
  if not has_function_privilege('anon', 'public.public_health_education_item(text)', 'EXECUTE') then
    raise exception 'the public share function must be callable by anon';
  end if;
  if has_function_privilege('anon', 'private.health_education_items(text[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.health_education_items(text[])', 'EXECUTE') then
    raise exception 'the items function must not be callable directly';
  end if;
end $$;
