-- Tarragon Health — one-item lookup for the Learn library, by content code.
--
-- "Recommended for you" opened a topic as an in-place accordion. Opening it
-- wrote health_education_progress.status = 'seen', which invalidated and
-- refetched health_education_feed() — whose ORDER BY ranks unstarted
-- (status is null) items first. The just-opened item lost that ranking on
-- refetch and could fall past the rail's own top-4 slice, unmounting before
-- the reader ever saw the expanded body. A dedicated full-page route sidesteps
-- this (it no longer depends on staying inside the sliced feed), and this RPC
-- is its data source — same shape/translation/progress join as
-- health_education_library(), just keyed by one code instead of a category.
create function public.health_education_content_detail(p_code text)
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
  where c.code = p_code and (c.is_active or private.is_admin());
$$;

-- Same recurring gotcha this project has hit repeatedly: a fresh SECURITY
-- DEFINER function gets an implicit PUBLIC execute grant, which anon
-- inherits unless explicitly revoked.
revoke execute on function public.health_education_content_detail(text) from public;
revoke execute on function public.health_education_content_detail(text) from anon;
grant execute on function public.health_education_content_detail(text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.health_education_content_detail(text)', 'EXECUTE') then
    raise exception 'health_education_content_detail: anon can still execute this function';
  end if;
  if not has_function_privilege('authenticated', 'public.health_education_content_detail(text)', 'EXECUTE') then
    raise exception 'health_education_content_detail: authenticated grant did not take';
  end if;
end $$;
