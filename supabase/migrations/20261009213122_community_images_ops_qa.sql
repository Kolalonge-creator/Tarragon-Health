-- Community Phase 2b: pre-moderated pictures, the 24/7 moderator rota and coverage check, safety drills, overdue-work alerts,
-- moderator tools to remove posts, and one-off doctor question sessions (text only). docs/COMMUNITY_SPEC.md section 14.
-- RPC-only like the rest of Community; dormant behind the `community` go-live guard.

-- ---------------------------------------------------------------------------
-- 1. The private bucket for pictures (no policy: only the server's service role reads or writes it)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('community-images', 'community-images', false, 10485760, array['image/jpeg', 'image/png'])
    on conflict (id) do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Pictures: who may see one
-- ---------------------------------------------------------------------------
-- The server asks this before it hands out a file. A member sees a picture only on a published post of a group they are in; the author
-- sees their own while it waits; a moderator of the group sees it while it waits and after removal (for appeals); a safety reviewer sees
-- the picture of a post in the safety queue. Staff views are logged.
create or replace function public.community_image_ref(p_image_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  i public.community_post_images;
  po public.community_posts;
  v_safety boolean;
  v_staff boolean := false;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into i from public.community_post_images where id = p_image_id and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into po from public.community_posts where id = i.post_id;
  v_safety := exists (select 1 from unnest(po.hold_reason_codes) c where c like 'safety:%') or exists (select 1 from public.community_safety_signals sg where sg.post_id = po.id);
  if po.state = 'visible' and private.community_reader_ok(po.group_id, v_uid) then
    null;
  elsif po.author_profile_id = v_uid and po.state in ('held', 'auto_hidden', 'visible') then
    null;
  elsif v_safety and private.community_is_safety_reviewer() then
    v_staff := true;
  elsif not v_safety and private.community_is_moderator(po.group_id) and po.state in ('held', 'auto_hidden', 'visible', 'removed') then
    v_staff := true;
  else
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_staff then
    perform private.community_log_event(po.group_id, po.id, null, 'image_viewed', v_uid, null, '[]'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'path', i.storage_path, 'mime', i.mime);
end $$;

-- Files to remove from storage: pictures of posts the author deleted (after a day), or a moderator removed (after the retention period),
-- and pictures whose post is gone. Called by the daily job (service role).
create or replace function public.community_images_due() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_days integer := private.community_cfg_int('removed_body_retention_days');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'path', x.storage_path))
      from (select i.id, i.storage_path
              from public.community_post_images i join public.community_posts po on po.id = i.post_id
             where i.deleted_at is null
               and (po.author_profile_id is null
                 or (po.state = 'deleted_by_author' and po.removed_at < now() - interval '1 day')
                 or (po.state = 'removed' and po.removed_at < now() - make_interval(days => v_days)))
             order by i.created_at limit 200) x), '[]'::jsonb);
end $$;

create or replace function public.community_images_mark_deleted(p_ids uuid[]) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_n integer;
begin
  update public.community_post_images set deleted_at = now() where id = any(p_ids) and deleted_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Pictures can be turned on per group by an admin or the CMO. Never for a topic whose rules need the CMO's approval (weight loss):
-- before-and-after photographs are a known harm there.
create or replace function public.community_admin_set_group_images(p_id uuid, p_on boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  if coalesce(p_on, false) and exists (
       select 1 from public.community_groups g join public.community_topics t on t.code = g.topic_code
        where g.id = p_id and t.requires_cmo_rules) then
    return jsonb_build_object('status', 'refused', 'reason', 'not_for_this_topic');
  end if;
  update public.community_groups set images_allowed = coalesce(p_on, false) where id = p_id;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'no_such_group'); end if;
  perform private.community_log_event(p_id, null, null, case when coalesce(p_on, false) then 'images_enabled' else 'images_disabled' end, (select auth.uid()), null, '[]'::jsonb);
  return jsonb_build_object('status', 'ok', 'images_allowed', coalesce(p_on, false));
end $$;

-- ---------------------------------------------------------------------------
-- 3. Moderators: see what is live and remove what does not belong
-- ---------------------------------------------------------------------------
create or replace function public.community_mod_recent(p_group_id uuid default null, p_before timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.community_is_moderator(p_group_id) then raise exception 'community moderators only' using errcode = '42501'; end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'post_id', x.id, 'group_id', x.group_id, 'group_name', x.group_name, 'author_handle', x.author_handle,
             'is_reply', (x.parent_post_id is not null), 'body', x.body, 'state', x.state, 'created_at', x.created_at,
             'image_id', x.image_id) order by x.created_at desc)
      from (select po.id, po.group_id, g.name as group_name, po.author_handle, po.parent_post_id, po.body, po.state, po.created_at,
                   (select i.id from public.community_post_images i where i.post_id = po.id and i.deleted_at is null) as image_id
              from public.community_posts po join public.community_groups g on g.id = po.group_id
             where (p_group_id is null or po.group_id = p_group_id)
               and po.state in ('visible', 'held', 'auto_hidden')
               and (p_before is null or po.created_at < p_before)
               and not exists (select 1 from unnest(po.hold_reason_codes) c where c like 'safety:%')
               and not exists (select 1 from public.community_safety_signals sg where sg.post_id = po.id)
               and exists (select 1 from public.community_staff s
                            where s.profile_id = v_uid and s.scope = 'moderator' and s.revoked_at is null and (s.group_id is null or s.group_id = po.group_id))
             order by po.created_at desc limit 30) x), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 4. The rota and the coverage check (Africa/Lagos, 0 = Monday)
-- ---------------------------------------------------------------------------

create or replace function public.community_coverage() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'moderator_uncovered_hours', private.community_uncovered_hours('moderator'),
    'safety_uncovered_hours', private.community_uncovered_hours('safety_reviewer'),
    'gaps', coalesce((
      select jsonb_agg(jsonb_build_object('scope', sc.scope, 'weekday', d, 'hour', h) order by sc.scope, d, h)
        from (values ('moderator'), ('safety_reviewer')) sc(scope), generate_series(0, 6) d, generate_series(0, 23) h
       where not exists (
         select 1 from public.community_shifts sh
           join public.community_staff s on s.id = sh.staff_id and s.revoked_at is null and s.scope = sc.scope and s.group_id is null
           join public.profiles p on p.id = s.profile_id and p.is_active and p.role in ('admin', 'care_coordinator')
          where sh.weekday = d and sh.start_hour <= h and sh.end_hour >= h + 1)), '[]'::jsonb));
end $$;

create or replace function public.community_admin_shifts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  return jsonb_build_object('staff', coalesce((
    select jsonb_agg(jsonb_build_object(
             'staff_id', s.id, 'name', p.full_name, 'scope', s.scope, 'all_groups', (s.group_id is null),
             'shifts', coalesce((select jsonb_agg(jsonb_build_object('weekday', sh.weekday, 'start_hour', sh.start_hour, 'end_hour', sh.end_hour) order by sh.weekday, sh.start_hour)
                                   from public.community_shifts sh where sh.staff_id = s.id), '[]'::jsonb))
           order by s.scope, p.full_name)
      from public.community_staff s join public.profiles p on p.id = s.profile_id and p.is_active
     where s.revoked_at is null), '[]'::jsonb));
end $$;

-- Replaces all the shifts of one grant. p_shifts: [{"weekday":0,"start_hour":8,"end_hour":16}, ...]
create or replace function public.community_admin_set_shifts(p_staff_id uuid, p_shifts jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r jsonb;
  v_n integer := 0;
begin
  if (select auth.uid()) is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  if not exists (select 1 from public.community_staff where id = p_staff_id and revoked_at is null) then
    return jsonb_build_object('status', 'refused', 'reason', 'not_found');
  end if;
  if p_shifts is null or coalesce(jsonb_typeof(p_shifts), '') <> 'array' or jsonb_array_length(p_shifts) > 100 then return jsonb_build_object('status', 'refused', 'reason', 'bad_shifts'); end if;
  for r in select * from jsonb_array_elements(p_shifts) loop
    if coalesce(jsonb_typeof(r -> 'weekday'), '') <> 'number' or coalesce(jsonb_typeof(r -> 'start_hour'), '') <> 'number' or coalesce(jsonb_typeof(r -> 'end_hour'), '') <> 'number'
       or (r ->> 'weekday')::numeric not between 0 and 6 or (r ->> 'weekday')::numeric <> trunc((r ->> 'weekday')::numeric)
       or (r ->> 'start_hour')::numeric not between 0 and 23 or (r ->> 'start_hour')::numeric <> trunc((r ->> 'start_hour')::numeric)
       or (r ->> 'end_hour')::numeric not between 1 and 24 or (r ->> 'end_hour')::numeric <> trunc((r ->> 'end_hour')::numeric)
       or (r ->> 'end_hour')::int <= (r ->> 'start_hour')::int then
      return jsonb_build_object('status', 'refused', 'reason', 'bad_shifts');
    end if;
  end loop;
  delete from public.community_shifts where staff_id = p_staff_id;
  for r in select * from jsonb_array_elements(p_shifts) loop
    insert into public.community_shifts (staff_id, weekday, start_hour, end_hour)
    values (p_staff_id, (r ->> 'weekday')::int, (r ->> 'start_hour')::int, (r ->> 'end_hour')::int);
    v_n := v_n + 1;
  end loop;
  perform private.community_log_event(null, null, null, 'rota_changed', (select auth.uid()), null, '[]'::jsonb);
  return jsonb_build_object('status', 'ok', 'shifts', v_n);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Safety drills (the CMO records a rehearsal of the hand-off)
-- ---------------------------------------------------------------------------
create or replace function public.community_record_tabletop(p_passed boolean, p_notes text default null, p_steps jsonb default '[]'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.credential_is_cmo() then raise exception 'the Chief Medical Officer only' using errcode = '42501'; end if;
  if p_passed is null then return jsonb_build_object('status', 'refused', 'reason', 'choose_one'); end if;
  if length(coalesce(p_notes, '')) > 2000 then return jsonb_build_object('status', 'refused', 'reason', 'note_too_long'); end if;
  if jsonb_typeof(coalesce(p_steps, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_steps, '[]'::jsonb)) > 50 then
    return jsonb_build_object('status', 'refused', 'reason', 'bad_steps');
  end if;
  -- a pass needs the five core steps ticked
  if p_passed and (select count(*) from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) e where e ->> 'ok' = 'true') < 5 then
    return jsonb_build_object('status', 'refused', 'reason', 'bad_steps');
  end if;
  insert into public.community_tabletop_runs (run_by, passed, notes, steps) values ((select auth.uid()), p_passed, nullif(btrim(coalesce(p_notes, '')), ''), coalesce(p_steps, '[]'::jsonb));
  perform private.community_log_event(null, null, null, case when p_passed then 'tabletop_passed' else 'tabletop_failed' end, (select auth.uid()), null, '[]'::jsonb);
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.community_tabletop_runs() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  return jsonb_build_object('runs', coalesce((
    select jsonb_agg(jsonb_build_object('id', t.id, 'run_at', t.run_at, 'passed', t.passed, 'notes', t.notes, 'steps', t.steps,
                                        'run_by_name', (select p.full_name from public.profiles p where p.id = t.run_by)) order by t.run_at desc)
      from (select * from public.community_tabletop_runs order by run_at desc limit 20) t), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Overdue work (the 10-minute job, service role)
-- ---------------------------------------------------------------------------
create or replace function public.community_overdue_work() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_s integer := private.community_cfg_int('overdue_safety_minutes');
  v_q integer := private.community_cfg_int('overdue_queue_minutes');
begin
  return jsonb_build_object(
    'safety_overdue', (select count(*) from public.community_safety_signals where status in ('open', 'in_review') and created_at < now() - make_interval(mins => v_s)),
    'queue_overdue', (select count(*) from public.community_posts po
                       where po.state in ('held', 'auto_hidden') and po.created_at < now() - make_interval(mins => v_q)
                         and not exists (select 1 from unnest(po.hold_reason_codes) c where c like 'safety:%')),
    'appeals_overdue', (select count(*) from public.community_appeals where status = 'open' and created_at < now() - interval '3 days'));
end $$;

-- One fixed notice per recipient per ten minutes. Safety goes to the safety reviewers and the CMO; the queue to moderators and the CMO.
create or replace function public.community_notify_overdue() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  w jsonb := public.community_overdue_work();
  r record;
  v_n integer := 0;
begin
  for r in
    select distinct x.profile_id from (
      select s.profile_id from public.community_staff s where s.revoked_at is null and (
        (s.scope = 'safety_reviewer' and (w ->> 'safety_overdue')::int > 0) or (s.scope = 'moderator' and ((w ->> 'queue_overdue')::int > 0 or (w ->> 'appeals_overdue')::int > 0)))
      union
      select cs.profile_id from public.clinical_staff cs
       where cs.active and cs.doctor_tier = 'chief_medical_officer' and ((w ->> 'safety_overdue')::int > 0 or (w ->> 'queue_overdue')::int > 0 or (w ->> 'appeals_overdue')::int > 0)) x
     where x.profile_id is not null
  loop
    perform private.community_notify(r.profile_id, 'community_overdue', r.profile_id, 'profiles');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Doctor question sessions (text only, one-off, answered by named doctors)
-- ---------------------------------------------------------------------------
create or replace function public.community_admin_create_qa(
  p_title text, p_intro text, p_opens_at timestamptz, p_closes_at timestamptz, p_doctor_ids uuid[], p_group_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_series uuid := gen_random_uuid();
  v_group uuid;
  d uuid;
begin
  if (select auth.uid()) is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_title, ''))) not between 3 and 80 or length(coalesce(p_intro, '')) > 300 then return jsonb_build_object('status', 'refused', 'reason', 'bad_text'); end if;
  if p_opens_at is null or p_closes_at is null or p_closes_at <= p_opens_at or p_closes_at > p_opens_at + interval '12 hours' or p_opens_at < now() - interval '5 minutes' then
    return jsonb_build_object('status', 'refused', 'reason', 'bad_window');
  end if;
  if coalesce(cardinality(p_doctor_ids), 0) not between 1 and 20 or coalesce(cardinality(p_group_ids), 0) not between 1 and 50 then
    return jsonb_build_object('status', 'refused', 'reason', 'bad_people');
  end if;
  foreach d in array p_doctor_ids loop
    if not exists (select 1 from public.clinical_staff cs where cs.profile_id = d and cs.active and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer')) then
      return jsonb_build_object('status', 'refused', 'reason', 'not_a_doctor');
    end if;
  end loop;
  foreach v_group in array p_group_ids loop
    if not exists (select 1 from public.community_groups where id = v_group and status = 'active') then
      return jsonb_build_object('status', 'refused', 'reason', 'no_such_group');
    end if;
  end loop;
  foreach v_group in array p_group_ids loop
    insert into public.community_qa_sessions (series_id, group_id, title, intro, opens_at, closes_at, created_by)
    values (v_series, v_group, btrim(p_title), coalesce(p_intro, ''), p_opens_at, p_closes_at, (select auth.uid()))
    on conflict (series_id, group_id) do nothing;
  end loop;
  foreach d in array p_doctor_ids loop
    insert into public.community_qa_doctors (series_id, profile_id) values (v_series, d) on conflict do nothing;
  end loop;
  perform private.community_log_event(null, v_series, null, 'qa_created', (select auth.uid()), null, '[]'::jsonb);
  return jsonb_build_object('status', 'ok', 'series_id', v_series);
end $$;

create or replace function public.community_admin_cancel_qa(p_series_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  update public.community_qa_sessions set cancelled_at = now() where series_id = p_series_id and cancelled_at is null;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'not_found'); end if;
  perform private.community_log_event(null, p_series_id, null, 'qa_cancelled', (select auth.uid()), null, '[]'::jsonb);
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.community_admin_qa_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  return jsonb_build_object('sessions', coalesce((
    select jsonb_agg(jsonb_build_object(
             'series_id', x.series_id, 'title', x.title, 'opens_at', x.opens_at, 'closes_at', x.closes_at, 'cancelled', x.cancelled,
             'groups', x.groups, 'doctors', x.doctors, 'questions', x.questions, 'answers', x.answers) order by x.opens_at desc)
      from (select q.series_id, min(q.title) as title, min(q.opens_at) as opens_at, min(q.closes_at) as closes_at, bool_and(q.cancelled_at is not null) as cancelled,
                   jsonb_agg(distinct g.name) as groups,
                   coalesce((select jsonb_agg(cs.full_name order by cs.full_name) from public.community_qa_doctors d join public.clinical_staff cs on cs.profile_id = d.profile_id where d.series_id = q.series_id), '[]'::jsonb) as doctors,
                   (select count(*) from public.community_posts po where po.qa_session_id in (select id from public.community_qa_sessions where series_id = q.series_id) and po.state = 'visible') as questions,
                   (select count(*) from public.community_qa_answers an where an.session_id in (select id from public.community_qa_sessions where series_id = q.series_id) and an.removed_at is null) as answers
              from public.community_qa_sessions q join public.community_groups g on g.id = q.group_id
             group by q.series_id order by min(q.opens_at) desc limit 50) x), '[]'::jsonb));
end $$;

create or replace function public.community_admin_remove_answer(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  update public.community_qa_answers set removed_at = now() where id = p_id and removed_at is null;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'not_found'); end if;
  perform private.community_log_event(null, p_id, null, 'qa_answer_removed', (select auth.uid()), null, '[]'::jsonb);
  return jsonb_build_object('status', 'ok');
end $$;

-- The doctors' side. A doctor sees the sessions they are named on, and the published questions (a handle and the text, never a person).
create or replace function public.community_qa_doctor_sessions() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_grace integer := private.community_cfg_int('qa_answer_grace_minutes');
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  return jsonb_build_object('sessions', coalesce((
    select jsonb_agg(jsonb_build_object(
             'series_id', x.series_id, 'title', x.title, 'intro', x.intro, 'opens_at', x.opens_at, 'closes_at', x.closes_at,
             'answer_until', x.closes_at + make_interval(mins => v_grace),
             'can_answer', (now() >= x.opens_at and now() < x.closes_at + make_interval(mins => v_grace)),
             'questions', x.questions, 'unanswered', x.unanswered) order by x.opens_at desc)
      from (select q.series_id, min(q.title) as title, min(q.intro) as intro, min(q.opens_at) as opens_at, min(q.closes_at) as closes_at,
                   (select count(*) from public.community_posts po where po.qa_session_id in (select id from public.community_qa_sessions where series_id = q.series_id) and po.state = 'visible') as questions,
                   (select count(*) from public.community_posts po where po.qa_session_id in (select id from public.community_qa_sessions where series_id = q.series_id) and po.state = 'visible'
                       and not exists (select 1 from public.community_qa_answers an where an.question_post_id = po.id and an.removed_at is null)) as unanswered
              from public.community_qa_sessions q
              join public.community_qa_doctors d on d.series_id = q.series_id and d.profile_id = v_uid
             where q.cancelled_at is null and q.closes_at > now() - interval '30 days'
             group by q.series_id) x), '[]'::jsonb));
end $$;

create or replace function public.community_qa_doctor_questions(p_series_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not exists (select 1 from public.community_qa_doctors d where d.series_id = p_series_id and d.profile_id = v_uid)
     or not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer'))
     or not exists (select 1 from public.community_qa_sessions q where q.series_id = p_series_id and q.cancelled_at is null and q.closes_at > now() - interval '30 days') then
    raise exception 'named doctors only' using errcode = '42501';
  end if;
  return jsonb_build_object('questions', coalesce((
    select jsonb_agg(jsonb_build_object(
             'post_id', po.id, 'group_name', g.name, 'author_handle', po.author_handle, 'body', po.body, 'created_at', po.created_at,
             'answers', coalesce((select jsonb_agg(jsonb_build_object('doctor_name', an.doctor_name, 'body', an.body, 'created_at', an.created_at, 'mine', (an.doctor_profile_id = v_uid)) order by an.created_at)
                                    from public.community_qa_answers an where an.question_post_id = po.id and an.removed_at is null), '[]'::jsonb))
           order by (not exists (select 1 from public.community_qa_answers an where an.question_post_id = po.id and an.removed_at is null)) desc, po.created_at)
      from public.community_posts po
      join public.community_qa_sessions q on q.id = po.qa_session_id and q.series_id = p_series_id
      join public.community_groups g on g.id = po.group_id
     where po.state = 'visible'), '[]'::jsonb));
end $$;

create or replace function public.community_qa_answer(p_post_id uuid, p_body text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_grace integer := private.community_cfg_int('qa_answer_grace_minutes');
  v_body text := btrim(coalesce(p_body, ''));
  po public.community_posts;
  q public.community_qa_sessions;
  v_name text;
  v_scan jsonb;
  v_id uuid;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into po from public.community_posts where id = p_post_id and state = 'visible' and qa_session_id is not null;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'not_found'); end if;
  select * into q from public.community_qa_sessions where id = po.qa_session_id and cancelled_at is null;
  if not found or not exists (select 1 from public.community_qa_doctors where series_id = q.series_id and profile_id = v_uid) then
    raise exception 'named doctors only' using errcode = '42501';
  end if;
  select cs.full_name into v_name from public.clinical_staff cs where cs.profile_id = v_uid and cs.active and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer');
  if v_name is null then raise exception 'named doctors only' using errcode = '42501'; end if;
  if now() < q.opens_at or now() >= q.closes_at + make_interval(mins => v_grace) then return jsonb_build_object('status', 'refused', 'reason', 'qa_closed'); end if;
  if length(v_body) not between 5 and 1500 then return jsonb_build_object('status', 'refused', 'reason', 'bad_length'); end if;
  -- A doctor's answer may talk about medicines and about danger signs; what it may never carry is a way to contact someone outside the group.
  v_scan := private.community_scan(v_body);
  if v_scan ->> 'decision' = 'unavailable' then return jsonb_build_object('status', 'refused', 'reason', 'not_ready'); end if;
  if exists (select 1 from jsonb_array_elements(v_scan -> 'hits') h where h ->> 'action' = 'block') then
    return jsonb_build_object('status', 'refused', 'reason', 'text_not_allowed');
  end if;
  insert into public.community_qa_answers (session_id, question_post_id, doctor_profile_id, doctor_name, body)
  values (q.id, po.id, v_uid, v_name, v_body) returning id into v_id;
  perform private.community_log_event(po.group_id, po.id, po.author_profile_id, 'qa_answered', v_uid, null, '[]'::jsonb);
  perform private.community_notify(po.author_profile_id, 'community_qa_answer', v_id, 'community_qa_answers');
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

-- Asked by the upload route BEFORE it writes a file: may this person post a picture to this group right now?
create or replace function public.community_image_precheck(p_group_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_gate jsonb;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  v_gate := private.community_posting_gate(p_group_id, v_uid);
  if v_gate ->> 'status' <> 'ok' then return jsonb_build_object('ok', false, 'reason', v_gate ->> 'reason'); end if;
  if not exists (select 1 from public.community_groups where id = p_group_id and images_allowed) then return jsonb_build_object('ok', false, 'reason', 'images_off'); end if;
  if exists (select 1 from public.community_moderation_events e where e.member_profile_id = v_uid and e.action = 'cooldown_started'
              and e.created_at > now() - make_interval(mins => (private.community_cfg() #>> '{block_cooldown,cooldown_minutes}')::int)) then
    return jsonb_build_object('ok', false, 'reason', 'cooling_down');
  end if;
  if (select count(*) from public.community_posts where author_profile_id = v_uid and created_at > now() - interval '1 hour') >= private.community_cfg_int('rate_posts_per_hour') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Privileges
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'community_image_ref', 'community_image_precheck', 'community_images_due', 'community_images_mark_deleted', 'community_admin_set_group_images', 'community_mod_recent',
       'community_coverage', 'community_admin_shifts', 'community_admin_set_shifts', 'community_record_tabletop', 'community_tabletop_runs',
       'community_overdue_work', 'community_notify_overdue', 'community_admin_create_qa', 'community_admin_cancel_qa', 'community_admin_qa_list',
       'community_admin_remove_answer', 'community_qa_doctor_sessions', 'community_qa_doctor_questions', 'community_qa_answer')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname in ('community_images_due', 'community_images_mark_deleted', 'community_overdue_work', 'community_notify_overdue') then
      execute format('grant execute on function %s to service_role', r.sig);
    else
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;
