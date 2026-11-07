-- Community moderation desk, Phase A (founder decision COM-31, 2026-11-07).
--
-- 1. Grant-only access. COM-28 (2026-11-03) gave every active internal staff account a global moderator grant automatically, and every
--    working doctor a safety reviewer grant. The founder reversed that: moderation is a role an administrator gives to a named person,
--    not a side effect of having a staff login. The triggers and functions are dropped and every live automatic grant is withdrawn.
--    Counted live before writing this: 9 live grants, 7 automatic (finance 1, analyst 1, admin 1, clinician moderator 2, clinician
--    safety reviewer 2) and 2 given by an admin by hand (both kept). The rows are revoked, never deleted (community_staff_guard), with
--    revoked_by left null because no person withdrew them; a 'staff_revoked' event with reason 'grant_only_com31' records each one.
--    The Chief Medical Officer keeps every safety page regardless (community_alert_staff adds the CMO by doctor tier, not by grant), and
--    now also keeps the means to act on it: private.community_is_safety_reviewer() admits the active CMO by tier (founder, 2026-11-07).
--    Before this, the CMO's only route into the safety queue was the automatic grant this migration withdraws.
-- 2. A Senior Moderator grant ('senior_moderator'). It is always global and always comes WITH a moderator grant (the grant RPC adds the
--    moderator grant if the person has none), so every existing check on scope = 'moderator' keeps working unchanged and the senior grant
--    only ever adds powers. It never confers safety review. No account role is added (CLAUDE.md: never re-split the account role).
-- 3. community_staff_context gains is_senior_moderator and has_desk; community_desk_overview(days) feeds the shared desk's Overview page.
--    The overview returns no member identity (no profile id, no handle, no post text). Safety details are shown only to a safety
--    reviewer, the CMO or an admin; everyone else sees a count and who handles it.
--
-- Every function body below was written from its live definition (pg_get_functiondef on 2026-11-07), not from an older migration.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. Grant-only access
-- ---------------------------------------------------------------------------------------------------------------------------------
drop trigger if exists community_auto_grant_profile on public.profiles;
drop trigger if exists community_auto_grant_clinical_staff on public.clinical_staff;
drop function if exists private.community_auto_grant_on_profile();
drop function if exists private.community_auto_grant_on_clinical_staff();
drop function if exists private.community_auto_grant(uuid);
-- The default all-week shifts were seeded only for automatic grants; nothing creates one any more.
drop trigger if exists community_seed_default_shifts on public.community_staff;
drop function if exists private.community_seed_default_shifts();

do $$
declare r record;
begin
  for r in select id, scope, group_id from public.community_staff where source = 'automatic' and revoked_at is null loop
    update public.community_staff set revoked_at = now() where id = r.id;
    perform private.community_log_event(r.group_id, null, null, 'staff_revoked', null, 'grant_only_com31', '[]'::jsonb);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. Senior Moderator
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.community_staff drop constraint community_staff_scope_check;
alter table public.community_staff add constraint community_staff_scope_check
  check (scope = any (array['moderator'::text, 'safety_reviewer'::text, 'senior_moderator'::text]));

create or replace function private.community_is_senior_moderator()
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1
      from public.community_staff s
      join public.profiles p on p.id = s.profile_id and p.is_active and private.community_internal_staff_role(p.role)
     where s.profile_id = (select auth.uid())
       and s.scope = 'senior_moderator' and s.revoked_at is null and s.group_id is null)
$function$;
-- called only from SECURITY DEFINER functions, like private.community_can_configure()
revoke all on function private.community_is_senior_moderator() from public, anon, authenticated;

create or replace function public.community_admin_grant_staff(p_profile_id uuid, p_scope text, p_group_id uuid default null::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_id uuid;
begin
  if not private.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  -- Safety reviewers see every group's withheld posts, so a safety reviewer grant is never for one group only.
  if p_scope = 'safety_reviewer' and p_group_id is not null then return jsonb_build_object('status', 'refused', 'reason', 'safety_reviewer_is_global'); end if;
  -- A senior moderator reviews escalations from every group, so the grant is global too.
  if p_scope = 'senior_moderator' and p_group_id is not null then return jsonb_build_object('status', 'refused', 'reason', 'senior_moderator_is_global'); end if;
  if exists (select 1 from public.community_staff s where s.profile_id = p_profile_id and s.scope = p_scope
               and s.group_id is not distinct from p_group_id and s.revoked_at is null) then
    return jsonb_build_object('status', 'refused', 'reason', 'already_granted');
  end if;
  insert into public.community_staff (profile_id, scope, group_id, granted_by)
  values (p_profile_id, p_scope, p_group_id, (select auth.uid()))
  returning id into v_id;
  perform private.community_log_event(p_group_id, null, null, 'staff_granted', (select auth.uid()), p_scope, '[]'::jsonb);
  -- A senior moderator is always a moderator as well, so every moderator check keeps working and the senior grant only adds.
  if p_scope = 'senior_moderator' and not exists (
       select 1 from public.community_staff s where s.profile_id = p_profile_id and s.scope = 'moderator' and s.group_id is null and s.revoked_at is null) then
    insert into public.community_staff (profile_id, scope, group_id, granted_by) values (p_profile_id, 'moderator', null, (select auth.uid()));
    perform private.community_log_event(null, null, null, 'staff_granted', (select auth.uid()), 'moderator', '[]'::jsonb);
  end if;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $function$;
revoke all on function public.community_admin_grant_staff(uuid, text, uuid) from public, anon;
grant execute on function public.community_admin_grant_staff(uuid, text, uuid) to authenticated;

-- Withdrawing the moderator grant from a senior moderator would leave a senior grant that no moderator check honours; withdraw both.
create or replace function public.community_admin_revoke_staff(p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_row public.community_staff;
begin
  if not private.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  update public.community_staff set revoked_at = now(), revoked_by = (select auth.uid()) where id = p_id and revoked_at is null
  returning * into v_row;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'not_active'); end if;
  perform private.community_log_event(null, null, null, 'staff_revoked', (select auth.uid()), null, '[]'::jsonb);
  if v_row.scope = 'moderator' and v_row.group_id is null then
    update public.community_staff set revoked_at = now(), revoked_by = (select auth.uid())
     where profile_id = v_row.profile_id and scope = 'senior_moderator' and revoked_at is null;
    if found then
      perform private.community_log_event(null, null, null, 'staff_revoked', (select auth.uid()), 'senior_moderator', '[]'::jsonb);
    end if;
  end if;
  return jsonb_build_object('status', 'ok');
end $function$;
revoke all on function public.community_admin_revoke_staff(uuid) from public, anon;
grant execute on function public.community_admin_revoke_staff(uuid) to authenticated;

-- The active Chief Medical Officer is paged on every safety signal by tier; they can open and act on the safety queue the same way
-- (one fixed exception to grant-only, decided by the founder 2026-11-07). Body from the live definition plus the CMO clause.
create or replace function private.community_is_safety_reviewer()
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1
      from public.community_staff s
      join public.profiles p on p.id = s.profile_id and p.is_active and private.community_internal_staff_role(p.role)
     where s.profile_id = (select auth.uid())
       and s.scope = 'safety_reviewer' and s.revoked_at is null)
  or exists (
    select 1
      from public.clinical_staff cs
      join public.profiles p on p.id = cs.profile_id and p.is_active and private.community_internal_staff_role(p.role)
     where cs.profile_id = (select auth.uid())
       and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer')
$function$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. Who the caller is, and the desk's Overview
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.community_staff_context()
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select jsonb_build_object(
    'is_admin', private.is_admin(),
    'is_cmo', private.credential_is_cmo(),
    'is_moderator', private.community_is_moderator(null),
    'is_senior_moderator', private.community_is_senior_moderator(),
    'is_safety_reviewer', private.community_is_safety_reviewer(),
    'is_clinician', exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active),
    'has_desk', private.is_admin() or private.credential_is_cmo() or private.community_is_moderator(null) or private.community_is_safety_reviewer())
$function$;
revoke all on function public.community_staff_context() from public, anon;
grant execute on function public.community_staff_context() to authenticated;

create or replace function public.community_desk_overview(p_days integer default 7)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean;
  v_cmo boolean;
  v_mod boolean;
  v_safety boolean;
  v_sees_safety boolean;
  v_days integer;
  v_since timestamptz;
  v_prev timestamptz;
  v_local timestamp := now() at time zone 'Africa/Lagos';
  v_today timestamptz := date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  v_wd integer := extract(isodow from (now() at time zone 'Africa/Lagos'))::integer - 1;
  v_hr integer := extract(hour from (now() at time zone 'Africa/Lagos'))::integer;
  v_queue_overdue integer := coalesce(private.community_cfg_int('overdue_queue_minutes'), 60);
  v_safety_overdue integer := coalesce(private.community_cfg_int('overdue_safety_minutes'), 30);
  v_mod_on integer;
  v_safety_on integer;
  v_attention jsonb := '[]'::jsonb;
  v_n integer;
  v_t timestamptz;
  v_last_drill record;
  v_job record;
  v_series jsonb;
  v_response record;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  v_admin := private.is_admin();
  v_cmo := private.credential_is_cmo();
  v_mod := private.community_is_moderator(null);
  v_safety := private.community_is_safety_reviewer();
  if not (v_admin or v_cmo or v_mod or v_safety) then
    raise exception 'community moderation roles only' using errcode = '42501';
  end if;
  v_sees_safety := v_admin or v_cmo or v_safety;
  v_days := case when p_days in (1, 7, 30, 90) then p_days else 7 end;
  v_since := v_today - make_interval(days => v_days - 1);
  v_prev := v_since - make_interval(days => v_days);

  -- who is on duty this hour (whole hours, Africa/Lagos, 0 = Monday)
  select count(distinct s.profile_id) filter (where s.scope = 'moderator'),
         count(distinct s.profile_id) filter (where s.scope = 'safety_reviewer')
    into v_mod_on, v_safety_on
    from public.community_shifts sh
    join public.community_staff s on s.id = sh.staff_id and s.revoked_at is null
    join public.profiles p on p.id = s.profile_id and p.is_active and private.community_internal_staff_role(p.role)
   where sh.weekday = v_wd and sh.start_hour <= v_hr and sh.end_hour > v_hr;

  -- ---- attention: what needs a person, most urgent first --------------------------------------------------------------------------
  if v_sees_safety then
    v_attention := v_attention || coalesce((
      select jsonb_agg(jsonb_build_object(
               'priority', 'critical', 'category', 'safety',
               'label', case sg.kind when 'self_harm_language' then 'Possible self-harm wording'
                                     when 'emergency_language' then 'Possible emergency wording'
                                     else 'A moderator raised a safety concern' end,
               'group_name', g.name, 'received_at', sg.created_at, 'status', sg.status,
               'owner', (select coalesce(st.display_name, hp.full_name) from public.profiles hp
                           left join public.community_staff st on st.profile_id = hp.id and st.scope = 'safety_reviewer' and st.revoked_at is null
                          where hp.id = sg.handled_by limit 1),
               'overdue', sg.created_at < now() - make_interval(mins => v_safety_overdue),
               'next_action', case sg.status when 'open' then 'Assess and decide' else 'Finish the review' end,
               'href', 'queue?tab=safety') order by sg.created_at)
        from public.community_safety_signals sg join public.community_groups g on g.id = sg.group_id
       where sg.status in ('open', 'in_review')), '[]'::jsonb);
  else
    select count(*), min(created_at) into v_n, v_t from public.community_safety_signals where status in ('open', 'in_review');
    if v_n > 0 then
      v_attention := v_attention || jsonb_build_array(jsonb_build_object(
        'priority', 'critical', 'category', 'safety', 'count', v_n,
        'label', 'Safety alerts are open', 'received_at', v_t, 'status', 'open', 'owner', 'Safety reviewers',
        'overdue', v_t < now() - make_interval(mins => v_safety_overdue),
        'next_action', 'Safety reviewers handle these; nothing for you to do unless asked', 'href', null));
    end if;
  end if;

  select count(*), min(p.created_at) into v_n, v_t from public.community_posts p where p.state = 'auto_hidden';
  if v_n > 0 then
    v_attention := v_attention || jsonb_build_array(jsonb_build_object(
      'priority', 'high', 'category', 'reported', 'count', v_n, 'label', 'Posts hidden after reports',
      'received_at', v_t, 'status', 'awaiting_review', 'owner', 'Moderators',
      'overdue', v_t < now() - make_interval(mins => v_queue_overdue), 'next_action', 'Review and decide', 'href', 'queue?tab=moderation'));
  end if;
  select count(*), min(p.created_at) into v_n, v_t from public.community_posts p where p.state = 'held';
  if v_n > 0 then
    v_attention := v_attention || jsonb_build_array(jsonb_build_object(
      'priority', 'medium', 'category', 'held', 'count', v_n, 'label', 'Posts held by the automatic checks',
      'received_at', v_t, 'status', 'awaiting_review', 'owner', 'Moderators',
      'overdue', v_t < now() - make_interval(mins => v_queue_overdue), 'next_action', 'Approve or remove', 'href', 'queue?tab=moderation'));
  end if;
  select count(*), min(r.created_at) into v_n, v_t
    from public.community_reports r join public.community_posts p on p.id = r.post_id
   where r.status = 'open' and p.state = 'visible';
  if v_n > 0 then
    v_attention := v_attention || jsonb_build_array(jsonb_build_object(
      'priority', 'medium', 'category', 'report', 'count', v_n, 'label', 'Reports on posts that are still showing',
      'received_at', v_t, 'status', 'open', 'owner', 'Moderators',
      'overdue', v_t < now() - make_interval(mins => v_queue_overdue), 'next_action', 'Check the reported posts', 'href', 'queue?tab=moderation'));
  end if;
  select count(*), min(created_at) into v_n, v_t from public.community_appeals where status = 'open';
  if v_n > 0 then
    v_attention := v_attention || jsonb_build_array(jsonb_build_object(
      'priority', 'low', 'category', 'appeal', 'count', v_n, 'label', 'Appeals waiting for a decision',
      'received_at', v_t, 'status', 'open', 'owner', 'Moderators', 'overdue', false, 'next_action', 'Uphold or overturn', 'href', 'queue?tab=appeals'));
  end if;
  select count(*), max(created_at) into v_n, v_t from public.notifications
   where template = 'community_staff_alert' and status = 'failed' and created_at > now() - interval '7 days';
  if v_n > 0 then
    v_attention := v_attention || jsonb_build_array(jsonb_build_object(
      'priority', 'high', 'category', 'delivery', 'count', v_n, 'label', 'Staff alerts that failed to send (last 7 days)',
      'received_at', v_t, 'status', 'failed', 'owner', 'Administrator', 'overdue', false,
      'next_action', 'Check the alert recipients can receive push and email', 'href', null));
  end if;
  if v_safety_on = 0 then
    v_attention := v_attention || jsonb_build_array(jsonb_build_object(
      'priority', 'high', 'category', 'coverage', 'label', 'No safety reviewer is on the rota this hour',
      'received_at', null, 'status', 'uncovered', 'owner', 'Administrator', 'overdue', false,
      'next_action', 'Safety alerts still page every safety reviewer and the CMO; add rota cover', 'href', 'rota'));
  end if;
  if v_mod_on = 0 then
    v_attention := v_attention || jsonb_build_array(jsonb_build_object(
      'priority', 'medium', 'category', 'coverage', 'label', 'No moderator is on the rota this hour',
      'received_at', null, 'status', 'uncovered', 'owner', 'Administrator', 'overdue', false, 'next_action', 'Add rota cover', 'href', 'rota'));
  end if;
  select * into v_job from public.community_job_runs where job = 'overdue';
  if not found or v_job.last_run_at < now() - interval '45 minutes' or not v_job.last_ok then
    v_attention := v_attention || jsonb_build_array(jsonb_build_object(
      'priority', 'high', 'category', 'monitor', 'label', 'The overdue-work check has not run in the last 45 minutes',
      'received_at', v_job.last_run_at, 'status', 'failed', 'owner', 'Administrator', 'overdue', false,
      'next_action', 'Overdue items will not page anyone until it runs again', 'href', null));
  end if;
  select run_at, passed into v_last_drill from public.community_tabletop_runs order by run_at desc limit 1;
  if not found or v_last_drill.run_at < now() - interval '90 days' or not v_last_drill.passed then
    v_attention := v_attention || jsonb_build_array(jsonb_build_object(
      'priority', 'medium', 'category', 'drill', 'label',
      case when v_last_drill.run_at is null then 'No safety drill has been recorded' else 'No passed safety drill in the last 90 days' end,
      'received_at', v_last_drill.run_at, 'status', 'due', 'owner', 'Chief Medical Officer', 'overdue', false,
      'next_action', 'Run the safety drill', 'href', 'drills'));
  end if;

  -- Day-by-day activity: one grouped pass per table, bucketed by the Lagos calendar day (a Lagos midnight is 23:00 UTC the day before,
  -- so the label is formatted from the Lagos-local timestamp, never from the timestamptz in the UTC session).
  with days as (select (d at time zone 'Africa/Lagos') as ld from generate_series(v_since, v_today, interval '1 day') d),
  ev as (
    select date_trunc('day', e.created_at at time zone 'Africa/Lagos') as ld,
           count(*) filter (where e.action = 'blocked') as blocked,
           count(*) filter (where e.action = 'held') as held,
           count(*) filter (where e.action = 'auto_hidden') as auto_hidden,
           count(*) filter (where e.action = 'approved' and e.actor_id is not null) as approved,
           count(*) filter (where e.action = 'removed' and e.actor_id is not null) as removed
      from public.community_moderation_events e where e.created_at >= v_since group by 1),
  po as (select date_trunc('day', p.created_at at time zone 'Africa/Lagos') as ld, count(*) as n from public.community_posts p where p.created_at >= v_since group by 1),
  re as (select date_trunc('day', r.created_at at time zone 'Africa/Lagos') as ld, count(*) as n from public.community_reports r where r.created_at >= v_since group by 1),
  sg as (select date_trunc('day', x.created_at at time zone 'Africa/Lagos') as ld, count(*) as n from public.community_safety_signals x where x.created_at >= v_since group by 1)
  select jsonb_agg(jsonb_build_object(
           'day', to_char(days.ld, 'YYYY-MM-DD'),
           'posts', coalesce(po.n, 0), 'blocked', coalesce(ev.blocked, 0), 'held', coalesce(ev.held, 0), 'reported', coalesce(re.n, 0),
           'auto_hidden', coalesce(ev.auto_hidden, 0), 'approved', coalesce(ev.approved, 0), 'removed', coalesce(ev.removed, 0),
           'safety', coalesce(sg.n, 0)) order by days.ld)
    into v_series
    from days
    left join ev on ev.ld = days.ld
    left join po on po.ld = days.ld
    left join re on re.ld = days.ld
    left join sg on sg.ld = days.ld;

  -- Response time: for each post that entered the queue (held or hidden after reports), minutes from entering it to the FIRST person's
  -- approve or remove decision; decisions made in the period. Removing an old visible post is not a queue response and is not counted.
  with queued as (
    select e.subject_id, min(e.created_at) as entered
      from public.community_moderation_events e where e.action in ('held', 'auto_hidden') and e.subject_id is not null group by e.subject_id),
  first_decision as (
    select distinct on (e.subject_id) e.subject_id, e.created_at as decided
      from public.community_moderation_events e
     where e.action in ('approved', 'removed') and e.actor_id is not null and e.subject_id is not null
     order by e.subject_id, e.created_at)
  select round((percentile_cont(0.5) within group (order by extract(epoch from (f.decided - q.entered)) / 60))::numeric, 0) as median, count(*) as n
    into v_response
    from first_decision f join queued q on q.subject_id = f.subject_id
   where f.decided >= v_since and f.decided >= q.entered;

  return jsonb_build_object(
    'days', v_days,
    'generated_at', now(),
    'local_hour', v_hr,
    'sees_safety', v_sees_safety,
    'attention', v_attention,
    'kpis', jsonb_build_object(
      'members_active', (select count(distinct profile_id) from public.community_memberships where status = 'active'),
      'members_new', (select count(*) from public.community_memberships where joined_at >= v_since),
      'members_new_prev', (select count(*) from public.community_memberships where joined_at >= v_prev and joined_at < v_since),
      'groups_active', (select count(*) from public.community_groups where status = 'active'),
      'posts_today', (select count(*) from public.community_posts where created_at >= v_today and state = 'visible'),
      'posts_yesterday', (select count(*) from public.community_posts where created_at >= v_today - interval '1 day' and created_at < v_today and state = 'visible'),
      'awaiting_moderation', (select count(*) from public.community_posts where state in ('held', 'auto_hidden')),
      'open_reports', (select count(*) from public.community_reports where status = 'open'),
      'open_safety', (select count(*) from public.community_safety_signals where status in ('open', 'in_review')),
      'response_minutes_median', v_response.median,
      'response_decisions', coalesce(v_response.n, 0),
      'moderators_on_duty', v_mod_on,
      'safety_on_duty', v_safety_on),
    'series', coalesce(v_series, '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'slug', g.slug, 'name', g.name, 'status', g.status, 'images_allowed', g.images_allowed,
               'members', (select count(*) from public.community_memberships m where m.group_id = g.id and m.status = 'active'),
               'members_new', (select count(*) from public.community_memberships m where m.group_id = g.id and m.joined_at >= v_since),
               'posts', (select count(*) from public.community_posts p where p.group_id = g.id and p.parent_post_id is null and p.created_at >= v_since),
               'replies', (select count(*) from public.community_posts p where p.group_id = g.id and p.parent_post_id is not null and p.created_at >= v_since),
               'reports', (select count(*) from public.community_reports r join public.community_posts p on p.id = r.post_id where p.group_id = g.id and r.created_at >= v_since),
               'outstanding', (select count(*) from public.community_posts p where p.group_id = g.id and p.state in ('held', 'auto_hidden')),
               'safety_open', (select count(*) from public.community_safety_signals sg where sg.group_id = g.id and sg.status in ('open', 'in_review')))
             order by g.name)
        from public.community_groups g where g.status <> 'archived'), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(x order by x ->> 'name')
        from (
          select jsonb_build_object(
                   'name', coalesce(max(s.display_name), max(p.full_name), 'Staff member'),
                   'scopes', array_agg(distinct s.scope order by s.scope),
                   'group_scoped', bool_or(s.group_id is not null),
                   'on_duty', exists (select 1 from public.community_shifts sh join public.community_staff s2 on s2.id = sh.staff_id and s2.revoked_at is null
                                       where s2.profile_id = s.profile_id and sh.weekday = v_wd and sh.start_hour <= v_hr and sh.end_hour > v_hr),
                   'actions', (select count(*) from public.community_moderation_events e where e.actor_id = s.profile_id and e.created_at >= v_since
                                 and e.action not in ('image_viewed')),
                   'last_action_at', (select max(e.created_at) from public.community_moderation_events e where e.actor_id = s.profile_id and e.action not in ('image_viewed'))) x
            from public.community_staff s
            join public.profiles p on p.id = s.profile_id and p.is_active and private.community_internal_staff_role(p.role)
           where s.revoked_at is null
           group by s.profile_id) q), '[]'::jsonb),
    'waiting', jsonb_build_object(
      'queue', (select count(*) from public.community_posts where state in ('held', 'auto_hidden')),
      'queue_overdue', (select count(*) from public.community_posts where state in ('held', 'auto_hidden') and created_at < now() - make_interval(mins => v_queue_overdue)),
      'appeals', (select count(*) from public.community_appeals where status = 'open'),
      'queue_overdue_minutes', v_queue_overdue),
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object(
               'action', e.action, 'at', e.created_at, 'automated', e.actor_id is null,
               'group_name', g.name,
               'actor', case when e.actor_id is null then null
                             else coalesce((select st.display_name from public.community_staff st where st.profile_id = e.actor_id and st.display_name is not null limit 1),
                                           (select ap.full_name from public.profiles ap where ap.id = e.actor_id), 'Staff member') end)
             order by e.created_at desc)
        from (select * from public.community_moderation_events e
               where e.action not in ('image_viewed')
                 and (v_sees_safety or (e.action not like 'safety%' and e.action not in ('withheld_safety', 'sent_to_safety', 'unmasked')))
               order by e.created_at desc limit 25) e
        left join public.community_groups g on g.id = e.group_id), '[]'::jsonb),
    'last_drill', case when v_last_drill.run_at is null then null else jsonb_build_object('at', v_last_drill.run_at, 'passed', v_last_drill.passed) end);
end $function$;
revoke all on function public.community_desk_overview(integer) from public, anon;
grant execute on function public.community_desk_overview(integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_trigger where tgname in ('community_auto_grant_profile', 'community_auto_grant_clinical_staff', 'community_seed_default_shifts')) then
    raise exception 'an automatic community grant trigger is still present';
  end if;
  if exists (select 1 from public.community_staff where source = 'automatic' and revoked_at is null) then
    raise exception 'a live automatic community grant remains';
  end if;
  if has_function_privilege('anon', 'public.community_desk_overview(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.community_staff_context()', 'EXECUTE')
     or has_function_privilege('anon', 'public.community_admin_grant_staff(uuid, text, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.community_admin_revoke_staff(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.community_is_senior_moderator()', 'EXECUTE') then
    raise exception 'anon can execute a community desk function';
  end if;
end $$;
