-- Community moderation and safety review may be given to an active clinician account, as well as a care coordinator.
--
-- Why: the founder decision of 2026-10-30 is that Dr Isaac Longe moderates and reviews safety around the clock. His account is a
-- clinician account, and the staff guard only allowed care coordinators (OQ-COM-03: moderators come from an existing staff role).
-- A clinician is an existing staff role too, and a doctor reviewing a safety post is the stronger fit, so the role list widens.
--
-- Every function below is redefined from its LIVE body (read through pg_get_functiondef on 2026-10-30); the only change in each is
-- the role list. community_admin_grant_staff is untouched: it still needs an admin to grant.
-- Count before: 0 community_staff rows exist, so no data step is needed.

create or replace function private.community_staff_guard()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'a community staff grant is revoked, never deleted' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.profiles where id = new.profile_id and is_active and role in ('care_coordinator', 'clinician')) then
      raise exception 'community moderation is granted to an active care coordinator or clinician account' using errcode = '42501';
    end if;
    if not exists (select 1 from public.profiles where id = new.granted_by and is_active and role = 'admin') then
      raise exception 'only an admin grants community moderation' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.profile_id is not null and new.profile_id is distinct from old.profile_id)
     or new.scope is distinct from old.scope
     or new.group_id is distinct from old.group_id
     or (new.granted_by is not null and new.granted_by is distinct from old.granted_by)
     or new.granted_at is distinct from old.granted_at
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'a community staff grant can only be revoked' using errcode = '42501';
  end if;
  if new.profile_id is null and old.profile_id is not null then
    new.revoked_at := coalesce(new.revoked_at, now());
  end if;
  return new;
end $function$;

create or replace function private.community_is_global_moderator()
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select exists (
    select 1
      from public.community_staff s
      join public.profiles p on p.id = s.profile_id and p.is_active and p.role in ('admin', 'care_coordinator', 'clinician')
     where s.profile_id = (select auth.uid()) and s.scope = 'moderator' and s.revoked_at is null and s.group_id is null)
$function$;

create or replace function private.community_is_moderator(p_group uuid default null::uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select exists (
    select 1
      from public.community_staff s
      join public.profiles p on p.id = s.profile_id and p.is_active and p.role in ('admin', 'care_coordinator', 'clinician')
     where s.profile_id = (select auth.uid())
       and s.scope = 'moderator' and s.revoked_at is null
       and (s.group_id is null or p_group is null or s.group_id = p_group))
$function$;

create or replace function private.community_is_safety_reviewer()
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select exists (
    select 1
      from public.community_staff s
      join public.profiles p on p.id = s.profile_id and p.is_active and p.role in ('admin', 'care_coordinator', 'clinician')
     where s.profile_id = (select auth.uid())
       and s.scope = 'safety_reviewer' and s.revoked_at is null)
$function$;

create or replace function private.community_uncovered_hours(p_scope text)
returns integer
language sql
stable security definer
set search_path to ''
as $function$
  select count(*)::int
    from generate_series(0, 6) d, generate_series(0, 23) h
   where not exists (
     select 1 from public.community_shifts sh
       join public.community_staff s on s.id = sh.staff_id and s.revoked_at is null and s.scope = p_scope and s.group_id is null
       join public.profiles p on p.id = s.profile_id and p.is_active and p.role in ('admin', 'care_coordinator', 'clinician')
      where sh.weekday = d and sh.start_hour <= h and sh.end_hour >= h + 1)
$function$;

create or replace function public.community_coverage()
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
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
           join public.profiles p on p.id = s.profile_id and p.is_active and p.role in ('admin', 'care_coordinator', 'clinician')
          where sh.weekday = d and sh.start_hour <= h and sh.end_hour >= h + 1)), '[]'::jsonb));
end $function$;

-- community_get_group: only the "who moderates" role filter changes (line marked below); the rest is the live body.
create or replace function public.community_get_group(p_slug text)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  g public.community_groups;
  m public.community_memberships;
  v_topic text;
  v_pinned jsonb;
  v_team jsonb;
  v_prompts jsonb;
  v_full boolean;
  v_qa jsonb;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.go_live_open_patient('community', v_uid) then return jsonb_build_object('found', false, 'reason', 'not_open_yet'); end if;
  if not private.community_adult(v_uid) then return jsonb_build_object('found', false, 'reason', 'adults_only'); end if;
  select * into g from public.community_groups where slug = p_slug and status in ('active', 'read_only');
  if not found then return jsonb_build_object('found', false, 'reason', 'no_such_group'); end if;
  select * into m from public.community_memberships where group_id = g.id and profile_id = v_uid;
  if g.sensitivity <> 'standard' and (not found or m.status <> 'active') then
    return jsonb_build_object('found', false, 'reason', 'no_such_group');
  end if;
  select label into v_topic from public.community_topics where code = g.topic_code;
  -- Pinned content shows only once a second clinician has reviewed it, with their real name: null-gated attribution.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pc.id, 'title', pc.title, 'body', pc.body, 'reviewed_at', pc.reviewed_at,
           'reviewed_by_name', (select p.full_name from public.profiles p where p.id = pc.reviewed_by)) order by pc.pinned_at desc), '[]'::jsonb)
    into v_pinned
    from public.community_pinned_content pc
   where pc.group_id = g.id and pc.unpinned_at is null and pc.reviewed_by is not null and pc.reviewed_at is not null;
  -- Who moderates: only staff who chose to show a name (their opt-in), and only those whose grant covers this group.
  select coalesce(jsonb_agg(jsonb_build_object('display_name', x.display_name, 'scope', x.scope) order by x.scope, x.display_name), '[]'::jsonb)
    into v_team
    from (select distinct s.display_name, s.scope
            from public.community_staff s
            join public.profiles p on p.id = s.profile_id and p.is_active and p.role in ('care_coordinator', 'clinician')
           where s.revoked_at is null and s.scope = 'moderator' and s.display_name is not null and (s.group_id is null or s.group_id = g.id)) x;
  select coalesce(jsonb_agg(jsonb_build_object('id', gp.id, 'body', gp.body) order by gp.show_from desc), '[]'::jsonb)
    into v_prompts
    from (select * from public.community_group_prompts q
           where q.group_id = g.id and q.show_from <= now() and (q.show_until is null or q.show_until > now())
           order by q.show_from desc limit 3) gp;
  -- The doctor question session to show: one open now, else the next one starting within a week, else the latest that ended within a week.
  select jsonb_build_object('session_id', q.id, 'title', q.title, 'intro', q.intro, 'opens_at', q.opens_at, 'closes_at', q.closes_at,
           'status', case when now() < q.opens_at then 'upcoming' when now() < q.closes_at then 'open' else 'closed' end,
           'doctors', coalesce((select jsonb_agg(cs.full_name order by cs.full_name) from public.community_qa_doctors d join public.clinical_staff cs on cs.profile_id = d.profile_id where d.series_id = q.series_id), '[]'::jsonb),
           'my_questions', (select count(*) from public.community_posts qp where qp.qa_session_id = q.id and qp.author_profile_id = v_uid and qp.state not in ('removed', 'deleted_by_author')),
           'question_limit', private.community_cfg_int('qa_questions_per_member'))
    into v_qa
    from public.community_qa_sessions q
   where q.group_id = g.id and q.cancelled_at is null and q.opens_at < now() + interval '7 days' and q.closes_at > now() - interval '7 days'
   order by case when now() >= q.opens_at and now() < q.closes_at then 0 when now() < q.opens_at then 1 else 2 end, q.opens_at
   limit 1;
  v_full := g.member_cap is not null and (select count(*) from public.community_memberships mm where mm.group_id = g.id and mm.status = 'active') >= g.member_cap;
  return jsonb_build_object(
    'found', true,
    'group', jsonb_build_object('id', g.id, 'slug', g.slug, 'name', g.name, 'description', g.description, 'topic_code', g.topic_code,
                                'topic_label', v_topic, 'status', g.status, 'rules_text', g.rules_text, 'rules_version', g.rules_version,
                                'join_mode', g.join_mode, 'full', v_full, 'images_allowed', g.images_allowed),
    'membership', case when m.group_id is null then jsonb_build_object('status', 'none') else jsonb_build_object(
                     'status', m.status, 'handle', m.handle, 'avatar_code', m.avatar_code,
                     'rules_current', (m.rules_accepted_version = g.rules_version),
                     'notifications_muted', m.notifications_muted, 'digest_opt_in', m.digest_opt_in,
                     -- joined recently: the screen shows a short welcome note (days come from the versioned configuration)
                     'new_member', (m.joined_at > now() - make_interval(days => private.community_cfg_int('welcome_days')))) end,
    'pinned', v_pinned,
    'team', v_team,
    'qa', v_qa,
    'prompts', v_prompts,
    -- The app reads limits from here and never carries a copy: they are PROPOSED values in the versioned configuration.
    'limits', jsonb_build_object('post_max_chars', private.community_cfg_int('post_max_chars'),
                                 'edit_window_minutes', private.community_cfg_int('edit_window_minutes'),
                                 'image_max_bytes', private.community_cfg_int('image_max_bytes')));
end $function$;

-- Self-check: no community function still names care_coordinator as the only moderating role, and the grant rule now admits clinicians.
do $$
declare v_left text;
begin
  select string_agg(p.proname, ', ') into v_left
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.proname like 'community\_%'
     and pg_get_functiondef(p.oid) like '%care_coordinator%'
     and pg_get_functiondef(p.oid) not like '%clinician%'
     and p.proname not in ('community_admin_set_dpo', 'community_dpo_candidates');
  if v_left is not null then raise exception 'still care-coordinator-only: %', v_left; end if;
  if pg_get_functiondef('private.community_staff_guard'::regproc) not like '%role in (''care_coordinator'', ''clinician'')%' then
    raise exception 'staff guard does not admit clinicians';
  end if;
end $$;
