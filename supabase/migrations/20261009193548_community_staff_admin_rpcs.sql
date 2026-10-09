-- Community, Phase 1, part 3b of 4: moderator, safety-reviewer, admin and clinician functions.
--
-- Design: docs/COMMUNITY_SPEC.md sections 4.4, 4.5, 5.2 to 5.4. Decisions COM-3 (grants on existing non-clinical staff roles,
-- no new account role) and COM-5/COM-6 (safety hand-off).
--
-- WHAT STAFF NEVER SEE. A moderator or a safety reviewer works from a post and its handle. No function here returns a
-- profile id or a name for a member. The one exception is community_admin_unmask(), which an admin must justify in writing,
-- which is rate-limited, written to audit_log and announced to the Chief Medical Officer.
--
-- private.is_org_staff() is not used anywhere in this feature.

-- ---------------------------------------------------------------------------
-- 0. Who can configure
-- ---------------------------------------------------------------------------
create or replace function private.community_can_configure() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() or private.credential_is_cmo()
$$;

create or replace function public.community_staff_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'is_admin', private.is_admin(),
    'is_cmo', private.credential_is_cmo(),
    'is_moderator', private.community_is_moderator(null),
    'is_safety_reviewer', private.community_is_safety_reviewer(),
    'is_clinician', exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active))
$$;

-- ---------------------------------------------------------------------------
-- 1. Moderation queue
-- ---------------------------------------------------------------------------
create or replace function public.community_mod_queue(p_group_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_premod integer;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.community_is_moderator(p_group_id) then raise exception 'community moderators only' using errcode = '42501'; end if;
  v_premod := private.community_cfg_int('new_member_premoderated_posts');
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'post_id', po.id, 'group_id', po.group_id, 'group_name', g.name, 'author_handle', po.author_handle,
             'is_reply', (po.parent_post_id is not null), 'body', po.body, 'state', po.state,
             'reasons', po.hold_reason_codes, 'created_at', po.created_at,
             'report_count', rc.n, 'report_reasons', rc.reasons,
             'author_is_new', coalesce(m.approved_post_count < v_premod, true))
           order by (rc.n > 0) desc, po.created_at)
      from public.community_posts po
      join public.community_groups g on g.id = po.group_id
      left join public.community_memberships m on m.group_id = po.group_id and m.profile_id = po.author_profile_id
      left join lateral (
        select count(*) as n, coalesce(jsonb_agg(distinct r.reason_code), '[]'::jsonb) as reasons
          from public.community_reports r where r.post_id = po.id and r.status = 'open') rc on true
     where (p_group_id is null or po.group_id = p_group_id)
       and exists (select 1 from public.community_staff s
                    where s.profile_id = v_uid and s.scope = 'moderator' and s.revoked_at is null
                      and (s.group_id is null or s.group_id = po.group_id))
       -- safety posts are for safety reviewers only
       and not exists (select 1 from unnest(po.hold_reason_codes) c where c like 'safety:%')
       and (po.state in ('held', 'auto_hidden') or (po.state = 'visible' and rc.n > 0))), '[]'::jsonb));
end $$;

create or replace function public.community_mod_decide(p_post_id uuid, p_decision text, p_reason_code text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  po public.community_posts;
  v_parent public.community_posts;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into po from public.community_posts where id = p_post_id for update;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'no_such_post'); end if;
  if not private.community_is_moderator(po.group_id) then raise exception 'community moderators only' using errcode = '42501'; end if;
  if exists (select 1 from unnest(po.hold_reason_codes) c where c like 'safety:%') then
    return jsonb_build_object('status', 'refused', 'reason', 'safety_reviewer_only');
  end if;
  if po.state in ('removed', 'deleted_by_author') then return jsonb_build_object('status', 'refused', 'reason', 'already_closed'); end if;

  if p_decision = 'approve' then
    if po.state = 'held' and po.author_profile_id is not null then
      update public.community_memberships set approved_post_count = approved_post_count + 1
       where group_id = po.group_id and profile_id = po.author_profile_id;
    end if;
    update public.community_posts set state = 'visible', hold_reason_codes = '{}' where id = po.id;
    update public.community_reports set status = 'dismissed', resolved_by = v_uid, resolved_at = now() where post_id = po.id and status = 'open';
    perform private.community_log_event(po.group_id, po.id, po.author_profile_id, 'approved', v_uid, null, '[]'::jsonb);
    perform private.community_maybe_sample(po.id, po.group_id, 'approved', v_uid);
    if po.state = 'held' and po.parent_post_id is not null then
      select * into v_parent from public.community_posts where id = po.parent_post_id;
      if v_parent.author_profile_id is not null and v_parent.author_profile_id is distinct from po.author_profile_id
         and not exists (select 1 from public.community_hidden_authors h where h.viewer_id = v_parent.author_profile_id and h.author_id = po.author_profile_id and h.group_id = po.group_id)
         and exists (select 1 from public.community_memberships m
                      where m.group_id = po.group_id and m.profile_id = v_parent.author_profile_id and m.status = 'active' and not m.notifications_muted) then
        perform private.community_notify(v_parent.author_profile_id, 'community_reply', po.id);
      end if;
    end if;
    return jsonb_build_object('status', 'approved');
  elsif p_decision = 'remove' then
    if p_reason_code is null or length(btrim(p_reason_code)) not between 2 and 40 then
      return jsonb_build_object('status', 'refused', 'reason', 'reason_needed');
    end if;
    update public.community_posts
       set state = 'removed', removed_at = now(), removed_by = v_uid, removed_reason_code = btrim(p_reason_code)
     where id = po.id;
    update public.community_reports set status = 'upheld', resolved_by = v_uid, resolved_at = now() where post_id = po.id and status = 'open';
    perform private.community_log_event(po.group_id, po.id, po.author_profile_id, 'removed', v_uid, btrim(p_reason_code), '[]'::jsonb);
    perform private.community_notify(po.author_profile_id, 'community_post_removed', po.id);
    perform private.community_maybe_sample(po.id, po.group_id, 'removed', v_uid);
    return jsonb_build_object('status', 'removed');
  elsif p_decision = 'send_to_safety' then
    -- A moderator who is worried about a member hands the post to a safety reviewer; from then on only a reviewer sees it.
    if po.state not in ('held', 'visible', 'auto_hidden') then return jsonb_build_object('status', 'refused', 'reason', 'already_closed'); end if;
    update public.community_posts set state = 'held', hold_reason_codes = array['safety:reviewer_concern'] where id = po.id;
    if not exists (select 1 from public.community_safety_signals sg where sg.post_id = po.id and sg.status in ('open', 'in_review')) then
      insert into public.community_safety_signals (group_id, post_id, author_profile_id, kind)
      values (po.group_id, po.id, po.author_profile_id, 'reviewer_concern');
    end if;
    perform private.community_log_event(po.group_id, po.id, po.author_profile_id, 'sent_to_safety', v_uid, 'moderator_concern', '[]'::jsonb);
    return jsonb_build_object('status', 'sent_to_safety');
  end if;
  return jsonb_build_object('status', 'refused', 'reason', 'bad_decision');
end $$;

-- A moderator sanctions through a post, so they never learn who the member is.
create or replace function public.community_mod_sanction(
  p_post_id uuid, p_kind text, p_reason_code text, p_hours integer default null, p_platform_wide boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  po public.community_posts;
  v_ends timestamptz;
  v_id uuid;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into po from public.community_posts where id = p_post_id;
  if not found or po.author_profile_id is null then return jsonb_build_object('status', 'refused', 'reason', 'no_such_member'); end if;
  -- A sanction in one group needs a moderator grant for that group; a sanction across every group is an admin's alone.
  if coalesce(p_platform_wide, false) then
    if not private.is_admin() then raise exception 'only an admin sanctions across every group' using errcode = '42501'; end if;
  elsif not private.community_is_moderator(po.group_id) then
    raise exception 'community moderators only' using errcode = '42501';
  end if;
  if p_kind not in ('warning', 'mute', 'suspend', 'ban') then return jsonb_build_object('status', 'refused', 'reason', 'bad_kind'); end if;
  if p_reason_code is null or length(btrim(p_reason_code)) not between 2 and 40 then return jsonb_build_object('status', 'refused', 'reason', 'reason_needed'); end if;
  if p_kind in ('mute', 'suspend') then
    if p_hours is null or p_hours < 1 or p_hours > 8760 then return jsonb_build_object('status', 'refused', 'reason', 'hours_needed'); end if;
    v_ends := now() + make_interval(hours => p_hours);
  end if;
  insert into public.community_sanctions (profile_id, group_id, kind, ends_at, reason_code, issued_by, source_post_id)
  values (po.author_profile_id, case when coalesce(p_platform_wide, false) then null else po.group_id end, p_kind, v_ends, btrim(p_reason_code), v_uid, po.id)
  returning id into v_id;
  perform private.community_log_event(po.group_id, po.id, po.author_profile_id, 'sanction_' || p_kind, v_uid, btrim(p_reason_code), '[]'::jsonb);
  perform private.community_notify(po.author_profile_id, 'community_sanction_notice', v_id, 'community_sanctions');
  return jsonb_build_object('status', 'ok', 'sanction', p_kind);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Safety review (COM-5)
-- ---------------------------------------------------------------------------
create or replace function public.community_safety_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.community_is_safety_reviewer() then raise exception 'community safety reviewers only' using errcode = '42501'; end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'signal_id', s.id, 'kind', s.kind, 'status', s.status, 'created_at', s.created_at,
             'group_name', g.name, 'post_id', po.id, 'post_state', po.state, 'author_handle', po.author_handle, 'body', po.body)
           order by case s.kind when 'self_harm_language' then 0 when 'emergency_language' then 1 else 2 end, s.created_at)
      from public.community_safety_signals s
      join public.community_posts po on po.id = s.post_id
      join public.community_groups g on g.id = s.group_id
     where s.status in ('open', 'in_review')), '[]'::jsonb));
end $$;

create or replace function public.community_safety_decide(p_signal_id uuid, p_decision text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  s public.community_safety_signals;
  v_status text;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.community_is_safety_reviewer() then raise exception 'community safety reviewers only' using errcode = '42501'; end if;
  select * into s from public.community_safety_signals where id = p_signal_id for update;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'no_such_signal'); end if;
  if s.status not in ('open', 'in_review') then return jsonb_build_object('status', 'refused', 'reason', 'already_handled'); end if;
  v_status := case p_decision when 'release' then 'released' when 'keep_withheld' then 'kept_withheld' when 'close' then 'closed' else null end;
  if v_status is null then return jsonb_build_object('status', 'refused', 'reason', 'bad_decision'); end if;
  if p_decision = 'release' then
    -- The post was stored because of its safety language; it may also hold contact details, which are never published.
    -- (the scan's overall decision is "safety" for such a post, so look for any blocking rule among the hits)
    if exists (select 1 from jsonb_array_elements(private.community_scan((select po.body from public.community_posts po where po.id = s.post_id)) -> 'hits') h where h ->> 'action' = 'block')
       or private.community_scan((select po.body from public.community_posts po where po.id = s.post_id)) ->> 'decision' = 'unavailable' then
      return jsonb_build_object('status', 'refused', 'reason', 'still_blocked');
    end if;
    update public.community_posts set state = 'visible', hold_reason_codes = '{}' where id = s.post_id and state in ('held', 'auto_hidden');
  end if;
  update public.community_safety_signals set status = v_status, handled_by = v_uid, handled_at = now() where id = s.id;
  perform private.community_log_event(s.group_id, s.post_id, s.author_profile_id, 'safety_' || v_status, v_uid, s.kind, '[]'::jsonb);
  return jsonb_build_object('status', v_status);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Groups and topics (admin)
-- ---------------------------------------------------------------------------
create or replace function public.community_admin_topics() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  return jsonb_build_object('topics', coalesce((
    select jsonb_agg(jsonb_build_object('code', t.code, 'label', t.label, 'description', t.description, 'sort_order', t.sort_order,
                                        'is_active', t.is_active, 'requires_cmo_rules', t.requires_cmo_rules) order by t.sort_order, t.label)
      from public.community_topics t), '[]'::jsonb));
end $$;

create or replace function public.community_admin_save_topic(
  p_code text, p_label text, p_description text default null, p_sort_order integer default 100,
  p_is_active boolean default true, p_requires_cmo_rules boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_old boolean;
begin
  if not private.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  select requires_cmo_rules into v_old from public.community_topics where code = p_code;
  -- Admins may ask for the CMO's approval on a topic; only the CMO may waive it.
  if coalesce(v_old, false) and not coalesce(p_requires_cmo_rules, false) and not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can remove the rules approval from a topic' using errcode = '42501';
  end if;
  insert into public.community_topics (code, label, description, sort_order, is_active, requires_cmo_rules)
  values (p_code, btrim(p_label), p_description, coalesce(p_sort_order, 100), coalesce(p_is_active, true), coalesce(p_requires_cmo_rules, false))
  on conflict (code) do update
     set label = excluded.label, description = excluded.description, sort_order = excluded.sort_order,
         is_active = excluded.is_active, requires_cmo_rules = excluded.requires_cmo_rules;
  return jsonb_build_object('status', 'ok', 'code', p_code);
end $$;

create or replace function public.community_admin_groups() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  return jsonb_build_object('groups', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', g.id, 'slug', g.slug, 'name', g.name, 'description', g.description, 'topic_code', g.topic_code, 'topic_label', t.label,
             'requires_cmo_rules', t.requires_cmo_rules, 'rules_text', g.rules_text, 'rules_version', g.rules_version,
             'rules_approved', (g.rules_approved_version is not null and g.rules_approved_version = g.rules_version),
             'rules_approved_at', g.rules_approved_at, 'join_mode', g.join_mode, 'member_cap', g.member_cap, 'status', g.status, 'created_at', g.created_at,
             'member_count', (select count(*) from public.community_memberships m where m.group_id = g.id and m.status = 'active'),
             'held_posts', (select count(*) from public.community_posts po where po.group_id = g.id and po.state in ('held', 'auto_hidden')),
             'open_reports', (select count(*) from public.community_reports r join public.community_posts po on po.id = r.post_id where po.group_id = g.id and r.status = 'open'),
             'open_signals', (select count(*) from public.community_safety_signals s where s.group_id = g.id and s.status in ('open', 'in_review')))
           order by t.sort_order, g.name)
      from public.community_groups g join public.community_topics t on t.code = g.topic_code), '[]'::jsonb));
end $$;

create or replace function public.community_admin_save_group(
  p_id uuid, p_name text, p_slug text, p_description text, p_topic_code text, p_rules_text text,
  p_join_mode text default 'open', p_status text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_id uuid;
  g public.community_groups;
begin
  if not private.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if p_id is null then
    select organisation_id into v_org from public.profiles where id = v_uid;
    insert into public.community_groups (organisation_id, slug, name, description, topic_code, rules_text, join_mode, created_by)
    values (v_org, lower(btrim(p_slug)), btrim(p_name), coalesce(p_description, ''), p_topic_code, p_rules_text, coalesce(p_join_mode, 'open'), v_uid)
    returning id into v_id;
  else
    update public.community_groups
       set name = coalesce(nullif(btrim(p_name), ''), name),
           description = coalesce(p_description, description),
           topic_code = coalesce(p_topic_code, topic_code),
           rules_text = coalesce(p_rules_text, rules_text),
           join_mode = coalesce(p_join_mode, join_mode),
           status = coalesce(p_status, status)
     where id = p_id
     returning id into v_id;
    if v_id is null then return jsonb_build_object('status', 'refused', 'reason', 'no_such_group'); end if;
  end if;
  select * into g from public.community_groups where id = v_id;
  perform private.community_log_event(v_id, null, null, case when p_id is null then 'group_created' else 'group_updated' end, v_uid, g.status, '[]'::jsonb);
  return jsonb_build_object('status', 'ok', 'id', g.id, 'group_status', g.status, 'rules_version', g.rules_version);
end $$;

create or replace function public.community_cmo_approve_group_rules(p_group_id uuid, p_rules_version integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  g public.community_groups;
begin
  if not private.credential_is_cmo() then raise exception 'only the Chief Medical Officer approves group rules' using errcode = '42501'; end if;
  select * into g from public.community_groups where id = p_group_id for update;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'no_such_group'); end if;
  if g.rules_version <> p_rules_version then return jsonb_build_object('status', 'refused', 'reason', 'rules_changed', 'rules_version', g.rules_version); end if;
  update public.community_groups
     set rules_approved_by = v_uid, rules_approved_at = now(), rules_approved_version = g.rules_version
   where id = g.id;
  perform private.community_log_event(g.id, null, null, 'rules_approved', v_uid, 'v' || g.rules_version, '[]'::jsonb);
  return jsonb_build_object('status', 'approved', 'rules_version', g.rules_version);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Staff grants (COM-3)
-- ---------------------------------------------------------------------------
create or replace function public.community_admin_staff() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  return jsonb_build_object('staff', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'scope', s.scope, 'group_id', s.group_id, 'group_name', g.name, 'profile_role', p.role,
             'staff_name', p.full_name, 'granted_at', s.granted_at, 'revoked_at', s.revoked_at) order by s.revoked_at nulls first, s.granted_at desc)
      from public.community_staff s
      join public.profiles p on p.id = s.profile_id
      left join public.community_groups g on g.id = s.group_id), '[]'::jsonb));
end $$;

create or replace function public.community_admin_grant_staff(p_profile_id uuid, p_scope text, p_group_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not private.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  insert into public.community_staff (profile_id, scope, group_id, granted_by)
  values (p_profile_id, p_scope, p_group_id, (select auth.uid()))
  returning id into v_id;
  perform private.community_log_event(p_group_id, null, null, 'staff_granted', (select auth.uid()), p_scope, '[]'::jsonb);
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

create or replace function public.community_admin_revoke_staff(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  update public.community_staff set revoked_at = now() where id = p_id and revoked_at is null;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'not_active'); end if;
  perform private.community_log_event(null, null, null, 'staff_revoked', (select auth.uid()), null, '[]'::jsonb);
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------------------------------------------------------------------------
-- 5. The one place a pseudonym is resolved (COM-6)
-- ---------------------------------------------------------------------------
-- Admin only, a written reason, limited per day, written to audit_log, and announced to the Chief Medical Officer.
create or replace function public.community_admin_unmask(p_group_id uuid, p_handle text, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  m public.community_memberships;
  v_name text;
  r record;
begin
  if not private.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < (private.community_cfg() #>> '{unmask,min_reason_chars}')::int then
    return jsonb_build_object('status', 'refused', 'reason', 'reason_too_short');
  end if;
  if (select count(*) from public.community_moderation_events e
       where e.action = 'unmasked' and e.actor_id = v_uid and e.created_at > now() - interval '1 day') >= (private.community_cfg() #>> '{unmask,max_per_day}')::int then
    return jsonb_build_object('status', 'refused', 'reason', 'daily_limit');
  end if;
  select * into m from public.community_memberships where group_id = p_group_id and lower(handle) = lower(btrim(p_handle));
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'no_such_member'); end if;
  select full_name into v_name from public.profiles where id = m.profile_id;
  -- WHO was looked up is recorded ONLY in the private moderation log (no client role can read it). audit_log is readable by every staff member
  -- of the organisation (audit_log_select uses is_org_staff) and by the analytics and finance audit screens, so it gets the handle, the
  -- group and the reason and NEVER the member's id: otherwise any clinician could turn a handle back into a person.
  perform private.community_log_event(p_group_id, null, m.profile_id, 'unmasked', v_uid, 'admin_unmask', '[]'::jsonb);
  perform private.log_audit('community_unmask', 'community_group', p_group_id, jsonb_build_object('handle', m.handle, 'reason', btrim(p_reason)));
  for r in select cs.profile_id as pid, p.organisation_id as org from public.clinical_staff cs join public.profiles p on p.id = cs.profile_id
            where cs.active and cs.doctor_tier = 'chief_medical_officer' and p.is_active loop
    insert into public.notifications (organisation_id, recipient_id, channel, template, payload, content_class, source_table, source_id)
    values (r.org, r.pid, 'in_app', 'community_unmask_notice', '{}'::jsonb, 'non_clinical', 'community_groups', p_group_id);
  end loop;
  return jsonb_build_object('status', 'ok', 'profile_id', m.profile_id, 'full_name', v_name);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Filter rule sets (INV-16): draft, edit, activate. Safety classes need the CMO.
-- ---------------------------------------------------------------------------
create or replace function public.community_admin_rule_sets() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  return jsonb_build_object('rule_sets', coalesce((
    select jsonb_agg(jsonb_build_object(
             'version', rs.version, 'status', rs.status, 'params', rs.params, 'notes', rs.notes, 'approved_at', rs.approved_at,
             'approved_by_name', (select p.full_name from public.profiles p where p.id = rs.approved_by),
             'rule_count', (select count(*) from public.community_filter_rules r where r.rule_set_version = rs.version),
             'safety_rule_count', (select count(*) from public.community_filter_rules r where r.rule_set_version = rs.version and r.action = 'safety'))
           order by rs.version desc)
      from public.community_filter_rule_sets rs), '[]'::jsonb));
end $$;

create or replace function public.community_admin_rules(p_version integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  return jsonb_build_object('rules', coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'class', r.class, 'kind', r.kind, 'pattern', r.pattern, 'action', r.action, 'note', r.note) order by r.class, r.id)
      from public.community_filter_rules r where r.rule_set_version = p_version), '[]'::jsonb));
end $$;

create or replace function public.community_admin_rule_set_create(p_from_version integer default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_from integer;
  v_new integer;
  v_params jsonb;
begin
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  v_from := coalesce(p_from_version, (select version from public.community_filter_rule_sets where status = 'active'));
  select params into v_params from public.community_filter_rule_sets where version = v_from;
  v_new := coalesce((select max(version) from public.community_filter_rule_sets), 0) + 1;
  insert into public.community_filter_rule_sets (version, status, params, created_by, notes)
  values (v_new, 'draft', coalesce(v_params, '{"allowed_hosts": []}'::jsonb), (select auth.uid()), case when v_from is null then null else 'copied from version ' || v_from end);
  if v_from is not null then
    insert into public.community_filter_rules (rule_set_version, class, kind, pattern, action, note)
    select v_new, class, kind, pattern, action, note from public.community_filter_rules where rule_set_version = v_from;
  end if;
  return jsonb_build_object('status', 'ok', 'version', v_new);
end $$;

create or replace function public.community_admin_rule_save(
  p_version integer, p_class text, p_kind text, p_pattern text, p_action text, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  -- The emergency and self-harm lists and their handling are clinical governance: only the CMO writes them.
  if (p_class in ('self_harm', 'emergency') or p_action = 'safety') and not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer writes emergency and self-harm rules' using errcode = '42501';
  end if;
  insert into public.community_filter_rules (rule_set_version, class, kind, pattern, action, note)
  values (p_version, p_class, p_kind, btrim(p_pattern), p_action, p_note)
  on conflict (rule_set_version, class, kind, pattern) do update set action = excluded.action, note = excluded.note
  returning id into v_id;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

create or replace function public.community_admin_rule_delete(p_rule_id bigint)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.community_filter_rules;
begin
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  select * into r from public.community_filter_rules where id = p_rule_id;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'no_such_rule'); end if;
  if r.action = 'safety' and not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer removes emergency and self-harm rules' using errcode = '42501';
  end if;
  delete from public.community_filter_rules where id = p_rule_id;
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.community_admin_rule_set_params(p_version integer, p_allowed_hosts jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  h jsonb;
begin
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  if jsonb_typeof(p_allowed_hosts) <> 'array' then return jsonb_build_object('status', 'refused', 'reason', 'not_a_list'); end if;
  for h in select * from jsonb_array_elements(p_allowed_hosts) loop
    if jsonb_typeof(h) <> 'string' or (h #>> '{}') !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
      return jsonb_build_object('status', 'refused', 'reason', 'bad_hostname');
    end if;
  end loop;
  update public.community_filter_rule_sets set params = jsonb_build_object('allowed_hosts', p_allowed_hosts) where version = p_version and status = 'draft';
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'not_a_draft'); end if;
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.community_admin_rule_set_activate(p_version integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  -- The guard trigger decides who may approve (the CMO whenever the set carries safety rules) and refuses a set that does not
  -- block phone numbers, email addresses, links and handles. If anything below raises, the retirement is rolled back with it.
  update public.community_filter_rule_sets set status = 'retired' where status = 'active' and version <> p_version;
  update public.community_filter_rule_sets set status = 'active', approved_by = v_uid, approved_at = now() where version = p_version and status = 'draft';
  if not found then raise exception 'only a draft rule set can be activated' using errcode = '22023'; end if;
  perform private.community_log_event(null, null, null, 'rule_set_activated', v_uid, 'v' || p_version, '[]'::jsonb);
  return jsonb_build_object('status', 'ok', 'version', p_version);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Doctor-reviewed pinned content (null-gated attribution)
-- ---------------------------------------------------------------------------
create or replace function public.community_clinician_pin(p_group_id uuid, p_title text, p_body text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'sign in required' using errcode = '28000'; end if;
  insert into public.community_pinned_content (group_id, title, body, authored_by)
  values (p_group_id, btrim(p_title), btrim(p_body), (select auth.uid()))
  returning id into v_id;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

create or replace function public.community_clinician_review_pin(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'sign in required' using errcode = '28000'; end if;
  -- Only an active clinician other than the author can review (a refusal, not a database error, for anyone else).
  update public.community_pinned_content set reviewed_by = (select auth.uid()), reviewed_at = now()
   where id = p_id and unpinned_at is null and reviewed_by is null
     and authored_by <> (select auth.uid())
     and exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active);
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'not_reviewable'); end if;
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.community_admin_unpin(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  update public.community_pinned_content set unpinned_at = now() where id = p_id and unpinned_at is null;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'not_pinned'); end if;
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.community_admin_pinned(p_group_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.community_can_configure() or exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active)) then
    raise exception 'admins, the Chief Medical Officer and clinicians only' using errcode = '42501';
  end if;
  return jsonb_build_object('pinned', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', pc.id, 'title', pc.title, 'body', pc.body, 'pinned_at', pc.pinned_at, 'unpinned_at', pc.unpinned_at,
             'authored_by_name', (select p.full_name from public.profiles p where p.id = pc.authored_by),
             'authored_by_me', (pc.authored_by = (select auth.uid())),
             'reviewed_by_name', (select p.full_name from public.profiles p where p.id = pc.reviewed_by), 'reviewed_at', pc.reviewed_at)
           order by pc.pinned_at desc)
      from public.community_pinned_content pc where pc.group_id = p_group_id), '[]'::jsonb));
end $$;

-- Groups a clinician can write or review a note for, drafts included (a clinician cannot call community_admin_groups, which is for admins and the CMO).
create or replace function public.community_note_groups() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.community_can_configure() or exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active)) then
    raise exception 'admins, the Chief Medical Officer and clinicians only' using errcode = '42501';
  end if;
  return jsonb_build_object('groups', coalesce((
    select jsonb_agg(jsonb_build_object('id', g.id, 'slug', g.slug, 'name', g.name, 'status', g.status, 'topic_label', t.label) order by t.sort_order, g.name)
      from public.community_groups g join public.community_topics t on t.code = g.topic_code
     where g.status <> 'archived'), '[]'::jsonb));
end $$;

create or replace function public.community_admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'groups_active', (select count(*) from public.community_groups where status = 'active'),
    'groups_draft', (select count(*) from public.community_groups where status = 'draft'),
    'members_active', (select count(*) from public.community_memberships where status = 'active'),
    'posts_awaiting_review', (select count(*) from public.community_posts where state in ('held', 'auto_hidden')),
    'open_reports', (select count(*) from public.community_reports where status = 'open'),
    'open_safety_signals', (select count(*) from public.community_safety_signals where status in ('open', 'in_review')),
    'moderators', (select count(distinct profile_id) from public.community_staff where scope = 'moderator' and revoked_at is null),
    'safety_reviewers', (select count(distinct profile_id) from public.community_staff where scope = 'safety_reviewer' and revoked_at is null),
    'active_rule_set', (select version from public.community_filter_rule_sets where status = 'active'));
end $$;

-- ---------------------------------------------------------------------------
-- 8. Privileges: every public community function is callable by signed-in users only (each checks its own authority);
--    anon and PUBLIC are revoked (anon inherits execute through PUBLIC, so the revoke names public).
-- ---------------------------------------------------------------------------
revoke all on function private.community_can_configure() from public, anon, authenticated, service_role;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'community_staff_context', 'community_mod_queue', 'community_mod_decide', 'community_mod_sanction',
       'community_safety_queue', 'community_safety_decide', 'community_admin_topics', 'community_admin_save_topic',
       'community_admin_groups', 'community_admin_save_group', 'community_cmo_approve_group_rules',
       'community_admin_staff', 'community_admin_grant_staff', 'community_admin_revoke_staff', 'community_admin_unmask',
       'community_admin_rule_sets', 'community_admin_rules', 'community_admin_rule_set_create', 'community_admin_rule_save',
       'community_admin_rule_delete', 'community_admin_rule_set_params', 'community_admin_rule_set_activate',
       'community_clinician_pin', 'community_clinician_review_pin', 'community_admin_unpin', 'community_admin_pinned', 'community_note_groups',
       'community_admin_overview')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
