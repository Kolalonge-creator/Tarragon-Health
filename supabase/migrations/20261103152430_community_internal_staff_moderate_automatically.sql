-- Community: every internal staff account moderates automatically; an admin can withdraw it (founder, in chat, 2026-11-03; decision COM-28).
--
-- Until now a moderator or safety reviewer grant was given one person at a time by an admin, and only to a care coordinator or clinician
-- account. The founder, who is the CMO, was paged about a crisis post but could not approve a held post; the CEO and finance accounts could
-- not help at all. From here:
--   * Internal staff roles (admin, clinician, care_coordinator, analyst, finance) hold a global `moderator` grant automatically; an active
--     doctor (a working clinical_staff row) also holds `safety_reviewer`, because reading a crisis post is clinical work.
--   * The grant is given when the account becomes active internal staff (profile insert or role change, clinical_staff activation) and is
--     backfilled for today's staff. Test accounts (profiles.is_test) never receive one automatically.
--   * An admin withdraws it with the existing community_admin_revoke_staff; a withdrawn grant is never re-given automatically (the admin's
--     decision stands until an admin grants again by hand). `revoked_by` records who withdrew it; `source` records how it was given.
--   * Partner and external roles (hmo_admin, corporate_admin, pharmacist, lab_*, payer_admin, provider_org_staff, ngo_admin) are unchanged:
--     they never moderate.
-- The five functions that carried the old role list (private.community_staff_guard, community_is_moderator, community_is_global_moderator,
-- community_is_safety_reviewer, community_uncovered_hours, community_alert_staff; public.community_coverage, community_get_group) are
-- redefined from their live bodies with one shared helper, private.community_internal_staff_role().

-- (no explicit transaction: the merge-time apply job wraps the file in one itself)

create or replace function private.community_internal_staff_role(p_role public.user_role)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_role in ('admin', 'clinician', 'care_coordinator', 'analyst', 'finance')
$$;
revoke all on function private.community_internal_staff_role(public.user_role) from public, anon, authenticated, service_role;

alter table public.community_staff
  add column if not exists source text not null default 'admin' check (source in ('admin', 'automatic')),
  add column if not exists revoked_by uuid references public.profiles(id) on delete set null;

-- 1. The guard: internal staff roles may hold a grant; an automatic grant has no granting admin; revoked_by may be set with revoked_at.
create or replace function private.community_staff_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a community staff grant is revoked, never deleted' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.profiles where id = new.profile_id and is_active and private.community_internal_staff_role(role)) then
      raise exception 'community moderation is granted to an active internal staff account' using errcode = '42501';
    end if;
    if new.source = 'automatic' then
      if new.granted_by is not null then
        raise exception 'an automatic grant names no granting admin' using errcode = '42501';
      end if;
    elsif not exists (select 1 from public.profiles where id = new.granted_by and is_active and role = 'admin') then
      raise exception 'only an admin grants community moderation' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.profile_id is not null and new.profile_id is distinct from old.profile_id)
     or new.scope is distinct from old.scope
     or new.group_id is distinct from old.group_id
     or new.source is distinct from old.source
     or (new.granted_by is not null and new.granted_by is distinct from old.granted_by)
     or new.granted_at is distinct from old.granted_at
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
     or (old.revoked_by is not null and new.revoked_by is distinct from old.revoked_by) then
    raise exception 'a community staff grant can only be revoked' using errcode = '42501';
  end if;
  if new.profile_id is null and old.profile_id is not null then
    new.revoked_at := coalesce(new.revoked_at, now());
  end if;
  return new;
end $$;

-- 2. Who counts as a moderator or a safety reviewer: the same roles the guard admits.
create or replace function private.community_is_global_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.community_staff s
      join public.profiles p on p.id = s.profile_id and p.is_active and private.community_internal_staff_role(p.role)
     where s.profile_id = (select auth.uid()) and s.scope = 'moderator' and s.revoked_at is null and s.group_id is null)
$$;

create or replace function private.community_is_moderator(p_group uuid default null::uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.community_staff s
      join public.profiles p on p.id = s.profile_id and p.is_active and private.community_internal_staff_role(p.role)
     where s.profile_id = (select auth.uid())
       and s.scope = 'moderator' and s.revoked_at is null
       and (s.group_id is null or p_group is null or s.group_id = p_group))
$$;

create or replace function private.community_is_safety_reviewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.community_staff s
      join public.profiles p on p.id = s.profile_id and p.is_active and private.community_internal_staff_role(p.role)
     where s.profile_id = (select auth.uid())
       and s.scope = 'safety_reviewer' and s.revoked_at is null)
$$;

create or replace function private.community_uncovered_hours(p_scope text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from generate_series(0, 6) d, generate_series(0, 23) h
   where not exists (
     select 1 from public.community_shifts sh
       join public.community_staff s on s.id = sh.staff_id and s.revoked_at is null and s.scope = p_scope and s.group_id is null
       join public.profiles p on p.id = s.profile_id and p.is_active and private.community_internal_staff_role(p.role)
      where sh.weekday = d and sh.start_hour <= h and sh.end_hour >= h + 1)
$$;

create or replace function public.community_coverage()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
           join public.profiles p on p.id = s.profile_id and p.is_active and private.community_internal_staff_role(p.role)
          where sh.weekday = d and sh.start_hour <= h and sh.end_hour >= h + 1)), '[]'::jsonb));
end $$;

-- community_get_group: the "who looks after this group" list; only the role test changes.
create or replace function public.community_get_group(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
            join public.profiles p on p.id = s.profile_id and p.is_active and private.community_internal_staff_role(p.role)
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
end $$;

-- 3. Staff alerts reach every internal staff role; the console area now knows the analyst and finance consoles too.
create or replace function private.community_staff_area(p_profile uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p.role
           when 'clinician' then 'clinician'
           when 'care_coordinator' then 'coordinator'
           when 'analyst' then 'analyst'
           when 'finance' then 'finance'
           else 'admin' end
    from public.profiles p where p.id = p_profile
$$;

create or replace function private.community_alert_staff(p_kind text, p_group uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
  v_channels text[];
  c text;
  v_priority text;
begin
  if p_kind not in ('safety', 'queue') then raise exception 'unknown community alert kind %', p_kind using errcode = '22023'; end if;
  if p_kind = 'safety' then
    v_channels := array['push', 'email', 'in_app'];
    v_priority := 'critical';
  else
    v_channels := array['push', 'in_app'];
    v_priority := 'routine';
  end if;

  for r in
    select distinct x.profile_id, p.organisation_id
      from (
        -- a safety signal reaches every safety reviewer and the Chief Medical Officer; a queue item reaches the group's moderators
        select s.profile_id
          from public.community_staff s
         where s.revoked_at is null
           and ((p_kind = 'safety' and s.scope = 'safety_reviewer')
             or (p_kind = 'queue' and s.scope = 'moderator' and (s.group_id is null or s.group_id = p_group)))
        union
        select cs.profile_id
          from public.clinical_staff cs
         where p_kind = 'safety' and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer'
      ) x
      join public.profiles p on p.id = x.profile_id and p.is_active and private.community_internal_staff_role(p.role)
  loop
    -- queue notices are throttled: one unread per person per ten minutes; a safety page never is
    if p_kind = 'queue' and exists (
      select 1 from public.notifications n
       where n.recipient_id = r.profile_id and n.template = 'community_staff_alert' and n.channel = 'in_app'
         and n.payload ->> 'kind' = 'queue' and n.opened_at is null and n.created_at > now() - interval '10 minutes') then
      continue;
    end if;
    foreach c in array v_channels loop
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority)
      values (r.profile_id, r.organisation_id, c::public.notification_channel, 'community_staff_alert',
              jsonb_build_object('kind', p_kind, 'area', private.community_staff_area(r.profile_id)), 'pending', 'non_clinical', v_priority::public.notification_priority);
    end loop;
    v_n := v_n + 1;
  end loop;
  if p_kind = 'safety' and v_n > 0 then perform private.nudge_send_pending(); end if;
  return v_n;
end $$;

-- 4. The automatic grant, and the triggers that give it.
create or replace function private.community_auto_grant(p_profile uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles;
  v_scopes text[] := array['moderator'];
  v_scope text;
  v_n integer := 0;
begin
  select * into p from public.profiles where id = p_profile;
  if not found or not p.is_active or coalesce(p.is_test, false) or p.merged_into_profile_id is not null
     or not private.community_internal_staff_role(p.role) then
    return 0;
  end if;
  -- a working doctor also reviews safety signals
  if exists (select 1 from public.clinical_staff cs where cs.profile_id = p.id and cs.active and cs.status = 'active') then
    v_scopes := array_append(v_scopes, 'safety_reviewer');
  end if;
  foreach v_scope in array v_scopes loop
    -- never twice, and never again after an admin withdrew it
    if exists (select 1 from public.community_staff s where s.profile_id = p.id and s.scope = v_scope and s.group_id is null) then
      continue;
    end if;
    insert into public.community_staff (profile_id, scope, group_id, granted_by, source) values (p.id, v_scope, null, null, 'automatic');
    perform private.community_log_event(null, null, null, 'staff_granted_automatically', null, v_scope, '[]'::jsonb);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function private.community_auto_grant(uuid) from public, anon, authenticated, service_role;

create or replace function private.community_auto_grant_on_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.community_auto_grant(new.id);
  return null;
end $$;

create or replace function private.community_auto_grant_on_clinical_staff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.community_auto_grant(new.profile_id);
  return null;
end $$;

revoke all on function private.community_auto_grant_on_profile() from public, anon, authenticated, service_role;
revoke all on function private.community_auto_grant_on_clinical_staff() from public, anon, authenticated, service_role;

drop trigger if exists community_auto_grant_profile on public.profiles;
create trigger community_auto_grant_profile
  after insert or update of role, is_active, is_test on public.profiles
  for each row execute function private.community_auto_grant_on_profile();

drop trigger if exists community_auto_grant_clinical_staff on public.clinical_staff;
create trigger community_auto_grant_clinical_staff
  after insert or update of active, status on public.clinical_staff
  for each row execute function private.community_auto_grant_on_clinical_staff();

-- 5. Withdrawing records who did it.
create or replace function public.community_admin_revoke_staff(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  update public.community_staff set revoked_at = now(), revoked_by = (select auth.uid()) where id = p_id and revoked_at is null;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'not_active'); end if;
  perform private.community_log_event(null, null, null, 'staff_revoked', (select auth.uid()), null, '[]'::jsonb);
  return jsonb_build_object('status', 'ok');
end $$;

-- 6. Backfill today's internal staff.
select private.community_auto_grant(p.id) from public.profiles p where p.is_active and private.community_internal_staff_role(p.role) and not coalesce(p.is_test, false);

do $$
declare v_missing integer;
begin
  select count(*) into v_missing
    from public.profiles p
   where p.is_active and not coalesce(p.is_test, false) and p.merged_into_profile_id is null and private.community_internal_staff_role(p.role)
     and not exists (select 1 from public.community_staff s where s.profile_id = p.id and s.scope = 'moderator' and s.group_id is null);
  if v_missing > 0 then raise exception '% internal staff account(s) still hold no moderator grant', v_missing; end if;
  if exists (select 1 from public.community_staff s join public.profiles p on p.id = s.profile_id
              where s.revoked_at is null and not private.community_internal_staff_role(p.role)) then
    raise exception 'an external role holds a community grant';
  end if;
end $$;
