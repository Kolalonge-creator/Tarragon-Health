-- S33: BP care course plumbing (spec 8.7, Module 9). Design: docs/design/S33.md. Research: docs/research/S33.md.
--
-- What this adds (all additive; no existing function is rewritten)
--   * health_education_content: audio_clip_id (a manifest clip id such as BPC-04) and next_action (the one thing to do today).
--   * health_education_translations: knowledge_check, next_action and review_state (needs_native_review | native_reviewed).
--     A Pidgin row is served only when native_reviewed (OQ-19, OQ-87: clinical Pidgin is held as English until a native speaker
--     and the CMO have signed it). Otherwise the learner gets English.
--   * public.learning_course(programme_code): the one call the mobile and web course screens make. Strict at read time: only a
--     published lesson with a review date that has not passed is returned, and a reviewer credit is returned only from a real
--     review record (clinician_reviewed, reviewed_by_name and reviewed_at all set).
--   * private.learning_hide_overdue_course_lessons(): hourly, moves a course lesson whose review date has passed back to
--     clinical_review (logged), so the older feed, library and AI Coach retrieval stop serving it too. Course lessons only: the
--     rest of the library keeps its existing review_due behaviour (OQ filed).
--   * A trigger that returns a course lesson (or its Pidgin) to review when its clinical text is edited.
--   * Events lesson.completed and course.completed, emitted from health_education_progress for course lessons.
--
-- Counts before this migration (live, 2026-10-06): 235 content rows (219 active), 6 clinician reviewed, 0 translations, 0 progress
-- rows, 0 rows with a review date, 2 programmes. A review-date rule therefore changes nothing that is live today.
--
-- INV-07: events carry codes and counts only, never a reading or a condition. INV-13: emit_domain_event marks the event is_test from
-- the patient's profile, so test accounts stay out of metrics.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.health_education_content
  add column audio_clip_id text,
  add column next_action text;
alter table public.health_education_content
  add constraint health_education_content_audio_clip_id_format check (audio_clip_id is null or audio_clip_id ~ '^[A-Z]{3}-[A-Z0-9]+$'),
  add constraint health_education_content_next_action_length check (next_action is null or length(next_action) between 5 and 400);
comment on column public.health_education_content.audio_clip_id is
  'Audio manifest clip id (audio/manifest.json). The app plays the clip only when the manifest says it is recorded and signed; otherwise it shows the text.';
comment on column public.health_education_content.next_action is
  'One concrete thing to do today ("what can I do next", spec 9.4). Shown at the end of the lesson.';

alter table public.health_education_translations
  add column knowledge_check jsonb,
  add column next_action text,
  add column review_state text not null default 'needs_native_review'
    check (review_state in ('needs_native_review', 'native_reviewed'));
comment on column public.health_education_translations.review_state is
  'native_reviewed once a native speaker and the CMO have signed this wording. learning_course serves a Pidgin row only in that state.';

-- ---------------------------------------------------------------------------
-- 2. Events
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('lesson.completed', 'A patient finished a course lesson and its teach-back question', 'S33', false),
  ('course.completed', 'A patient finished every lesson of a course', 'S33', false);
insert into public.event_type_versions (event_type, version, required_keys) values
  ('lesson.completed', 1, array['course_code', 'lesson_code']),
  ('course.completed', 1, array['course_code', 'lesson_count']);

-- ---------------------------------------------------------------------------
-- 3. Which content belongs to a course
-- ---------------------------------------------------------------------------
create or replace function private.is_course_lesson(p_content_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.health_education_programme_modules m where m.content_id = p_content_id);
$$;
revoke all on function private.is_course_lesson(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. learning_course(): the course as the patient sees it
-- ---------------------------------------------------------------------------
create function public.learning_course(p_programme_code text)
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
    select (select auth.uid()) as uid, coalesce((select pr.language from public.profiles pr where pr.id = (select auth.uid())), 'en') as lang
  )
  select
    m.module_number,
    c.id,
    c.code,
    coalesce(t.title, c.title),
    coalesce(t.summary, c.summary),
    coalesce(t.body, c.body),
    coalesce(t.next_action, c.next_action),
    c.audio_clip_id,
    c.estimated_minutes,
    coalesce(t.knowledge_check, c.knowledge_check),
    case when t.id is not null then t.language else 'en' end,
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
  left join public.health_education_translations t
    on t.content_id = c.id and t.language = me.lang and me.lang <> 'en' and t.review_state = 'native_reviewed'
  left join public.health_education_progress p
    on p.content_id = c.id and p.patient_id = me.uid
  where g.code = p_programme_code
    and g.is_active
    and me.uid is not null
    -- Only reviewed, in-date content is served (spec 9, "Safety rules"). The Lagos date, never UTC.
    and c.content_status = 'published'
    and c.next_review_due is not null
    and c.next_review_due > (now() at time zone 'Africa/Lagos')::date
  order by m.module_number;
$$;
revoke execute on function public.learning_course(text) from public, anon;
grant execute on function public.learning_course(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Hide an overdue course lesson (hourly), log it
-- ---------------------------------------------------------------------------
create or replace function private.learning_hide_overdue_course_lessons()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_row record;
begin
  for v_row in
    select c.id, c.content_status
    from public.health_education_content c
    where c.content_status in ('published', 'review_due')
      and c.next_review_due is not null
      and c.next_review_due <= (now() at time zone 'Africa/Lagos')::date
      and private.is_course_lesson(c.id)
    for update of c
  loop
    update public.health_education_content
      set content_status = 'clinical_review', is_active = false, clinician_reviewed = false
      where id = v_row.id;
    insert into public.health_education_content_status_history (content_id, from_status, to_status, actor_id, note)
      values (v_row.id, v_row.content_status, 'clinical_review', null, 'Review date passed: hidden until the CMO reviews it again (S33).');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.learning_hide_overdue_course_lessons() from public, anon, authenticated;

select cron.schedule('learning-hide-overdue-course-lessons', '7 * * * *', $$ select private.learning_hide_overdue_course_lessons(); $$);

-- ---------------------------------------------------------------------------
-- 6. An edit to clinical text takes the lesson (and its Pidgin) back to review
-- ---------------------------------------------------------------------------
create or replace function private.learning_requeue_on_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.title, new.summary, new.body, new.knowledge_check, new.next_action)
       is distinct from (old.title, old.summary, old.body, old.knowledge_check, old.next_action)
     and old.content_status in ('approved', 'published', 'review_due', 'updated')
     and private.is_course_lesson(new.id)
  then
    new.content_status := 'clinical_review';
    new.is_active := false;
    new.clinician_reviewed := false;
    insert into public.health_education_content_status_history (content_id, from_status, to_status, actor_id, note)
      values (new.id, old.content_status, 'clinical_review', (select auth.uid()), 'Clinical text edited: back to review (S33).');
  end if;
  return new;
end;
$$;
revoke all on function private.learning_requeue_on_edit() from public, anon, authenticated;
create trigger health_education_content_requeue_on_edit
  before update on public.health_education_content
  for each row execute function private.learning_requeue_on_edit();

create or replace function private.learning_translation_requeue_on_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.title, new.summary, new.body, new.knowledge_check, new.next_action)
       is distinct from (old.title, old.summary, old.body, old.knowledge_check, old.next_action)
     and private.is_course_lesson(new.content_id)
  then
    new.review_state := 'needs_native_review';
  end if;
  return new;
end;
$$;
revoke all on function private.learning_translation_requeue_on_edit() from public, anon, authenticated;
create trigger health_education_translations_requeue_on_edit
  before update on public.health_education_translations
  for each row execute function private.learning_translation_requeue_on_edit();

-- ---------------------------------------------------------------------------
-- 7. Events: a lesson finished, a course finished
-- ---------------------------------------------------------------------------
create or replace function private.learning_progress_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson_code text;
  v_course record;
  v_total integer;
  v_done integer;
begin
  -- Completed means the teach-back question was answered ('understood' or 'needs_review'); merely opening ('seen') is not.
  if new.status not in ('understood', 'needs_review') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status in ('understood', 'needs_review') then
    return new;
  end if;

  select c.code into v_lesson_code from public.health_education_content c where c.id = new.content_id;
  for v_course in
    select g.id, g.code
    from public.health_education_programme_modules m
    join public.health_education_programmes g on g.id = m.programme_id
    where m.content_id = new.content_id
  loop
    perform private.emit_domain_event(
      'lesson.completed', new.organisation_id,
      jsonb_build_object('course_code', v_course.code, 'lesson_code', v_lesson_code),
      'lesson:' || new.patient_id::text || ':' || new.content_id::text,
      new.patient_id, 'health_education_content', new.content_id);

    select count(*) into v_total from public.health_education_programme_modules m where m.programme_id = v_course.id;
    select count(*) into v_done
      from public.health_education_programme_modules m
      join public.health_education_progress p on p.content_id = m.content_id and p.patient_id = new.patient_id
      where m.programme_id = v_course.id and p.status in ('understood', 'needs_review');
    if v_total > 0 and v_done = v_total then
      perform private.emit_domain_event(
        'course.completed', new.organisation_id,
        jsonb_build_object('course_code', v_course.code, 'lesson_count', v_total),
        'course:' || new.patient_id::text || ':' || v_course.id::text,
        new.patient_id, 'health_education_programmes', v_course.id);
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.learning_progress_events() from public, anon, authenticated;
create trigger health_education_progress_events
  after insert or update of status on public.health_education_progress
  for each row execute function private.learning_progress_events();

-- ---------------------------------------------------------------------------
-- 8. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.learning_course(text)', 'EXECUTE') then
    raise exception 'learning_course: anon can still execute this function';
  end if;
  if not has_function_privilege('authenticated', 'public.learning_course(text)', 'EXECUTE') then
    raise exception 'learning_course: authenticated grant did not take';
  end if;
  if has_function_privilege('authenticated', 'private.learning_hide_overdue_course_lessons()', 'EXECUTE') then
    raise exception 'learning_hide_overdue_course_lessons: callable by authenticated';
  end if;
  if (select count(*) from cron.job where jobname = 'learning-hide-overdue-course-lessons') <> 1 then
    raise exception 'learning-hide-overdue-course-lessons is not scheduled exactly once';
  end if;
end $$;
