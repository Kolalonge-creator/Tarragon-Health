-- S33 follow-up: the blood pressure course is English only (founder decision D-14, 2026-10-07; see docs/DECISIONS.md).
--
-- Why a new migration: 20261006193149_s33_course_columns_review_gate_events.sql was already applied to production (2026-10-07,
-- pinned version), so it is not edited. It added Pidgin plumbing that D-14 makes dead: three columns on
-- health_education_translations (knowledge_check, next_action, review_state), a trigger that sends an edited translation back to
-- native review, and a translation join with a language switch inside learning_course().
--
-- Counts read before writing this (2026-10-07, from the migrations on main-dev): health_education_translations holds 0 rows
-- (the remove-Pidgin migration 20261006222924 asserts that and narrowed its language CHECK to 'en'), and the S33 seed inserts no
-- translation row. So there is no data to convert; this migration asserts the zero and aborts if a row has appeared.
--
-- What it does
--   * drops trigger health_education_translations_requeue_on_edit and its function;
--   * drops the three S33 columns from health_education_translations (the table itself stays: four older SQL functions still
--     join it, see the remove-Pidgin migration);
--   * restates public.learning_course(text) with the same signature and the same gate, minus the translation join; language_served
--     is always 'en' (the column stays so the two apps that read it keep working).
-- Anon execute stays revoked (re-checked at the end).

begin;

do $$
declare v_n bigint;
begin
  select count(*) into v_n from public.health_education_translations;
  if v_n <> 0 then raise exception 'health_education_translations has % rows; refusing to drop its S33 columns', v_n; end if;
end $$;

drop trigger if exists health_education_translations_requeue_on_edit on public.health_education_translations;
drop function if exists private.learning_translation_requeue_on_edit();

alter table public.health_education_translations
  drop column if exists knowledge_check,
  drop column if exists next_action,
  drop column if exists review_state;

create or replace function public.learning_course(p_programme_code text)
returns table (
  module_number       integer,
  content_id          uuid,
  content_code        text,
  title               text,
  summary             text,
  body                text,
  next_action         text,
  audio_clip_id       text,
  estimated_minutes   integer,
  knowledge_check     jsonb,
  language_served     text,
  reviewed_by_name    text,
  reviewed_at         timestamptz,
  next_review_due     date,
  status              public.health_education_status,
  check_score         integer,
  check_total         integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as uid
  )
  select
    m.module_number,
    c.id,
    c.code,
    c.title,
    c.summary,
    c.body,
    c.next_action,
    c.audio_clip_id,
    c.estimated_minutes,
    c.knowledge_check,
    'en'::text,
    -- A reviewer credit exists only if a real review record does (never a hard-coded or implied credit).
    case when c.clinician_reviewed and c.reviewed_by_name is not null and c.reviewed_at is not null then c.reviewed_by_name end,
    case when c.clinician_reviewed and c.reviewed_by_name is not null and c.reviewed_at is not null then c.reviewed_at end,
    c.next_review_due,
    p.status,
    p.check_score,
    p.check_total
  from public.health_education_programmes g
  join public.health_education_programme_modules m on m.programme_id = g.id
  join public.health_education_content c on c.id = m.content_id
  cross join me
  left join public.health_education_progress p
    on p.content_id = c.id and p.patient_id = me.uid
  where g.code = p_programme_code
    and me.uid is not null
    -- Only reviewed, in-date content is served (spec 9, "Safety rules"). The Lagos date, never UTC.
    and c.content_status = 'published'
    and c.next_review_due is not null
    and c.next_review_due > (now() at time zone 'Africa/Lagos')::date
  order by m.module_number;
$$;
revoke execute on function public.learning_course(text) from public, anon;
grant execute on function public.learning_course(text) to authenticated;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'health_education_translations'
               and column_name in ('knowledge_check', 'next_action', 'review_state')) then
    raise exception 'FAIL: an S33 Pidgin column is still on health_education_translations';
  end if;
  if exists (select 1 from pg_trigger where tgname = 'health_education_translations_requeue_on_edit' and not tgisinternal) then
    raise exception 'FAIL: the translation requeue trigger is still present';
  end if;
  if to_regprocedure('private.learning_translation_requeue_on_edit()') is not null then
    raise exception 'FAIL: the translation requeue function is still present';
  end if;
  if has_function_privilege('anon', 'public.learning_course(text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute learning_course';
  end if;
  if not has_function_privilege('authenticated', 'public.learning_course(text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute learning_course';
  end if;
  if pg_get_functiondef('public.learning_course(text)'::regprocedure) ~* 'health_education_translations' then
    raise exception 'FAIL: learning_course still reads translations';
  end if;
end $$;

commit;
