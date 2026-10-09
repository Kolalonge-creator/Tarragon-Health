-- Community, Phase 1, part 3 of 4: the member-facing functions.
--
-- Design: docs/COMMUNITY_SPEC.md sections 4 and 5. Every function is SECURITY DEFINER with search_path = '' and returns
-- a pseudonymous handle, never a profile id. Every function checks the `community` go-live guard (private.go_live_open_patient:
-- on, or the caller is an is_test account so the safety hand-off can be rehearsed before launch), the caller's age (adults
-- only, COM-4) and an active membership. There is no plan check anywhere (COM-1): Free and paid members are treated alike.
--
-- User-facing outcomes are returned as {status, reason} so the app can show a calm message; only programming and
-- permission errors raise.

-- ---------------------------------------------------------------------------
-- 0. Internal helpers
-- ---------------------------------------------------------------------------
create or replace function private.community_log_event(
  p_group uuid, p_subject uuid, p_member uuid, p_action text, p_actor uuid, p_reason text, p_hits jsonb default '[]'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.community_moderation_events (group_id, subject_id, member_profile_id, action, actor_id, reason_code, filter_hits)
  values (p_group, p_subject, p_member, p_action, p_actor, p_reason, coalesce(p_hits, '[]'::jsonb))
$$;

-- A fresh handle that is unique in the group: adjective-noun-NN, from words in the versioned configuration.
create or replace function private.community_new_handle(p_group uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_adj jsonb := private.community_cfg() #> '{handle_words,adjectives}';
  v_noun jsonb := private.community_cfg() #> '{handle_words,nouns}';
  v_h text;
  i integer := 0;
begin
  if v_adj is null or v_noun is null or jsonb_array_length(v_adj) = 0 or jsonb_array_length(v_noun) = 0 then
    raise exception 'community configuration has no handle words' using errcode = '55000';
  end if;
  loop
    i := i + 1;
    v_h := (v_adj ->> floor(random() * jsonb_array_length(v_adj))::int) || '-' ||
           (v_noun ->> floor(random() * jsonb_array_length(v_noun))::int) || '-' ||
           case when i < 25 then lpad((10 + floor(random() * 90))::int::text, 2, '0') else lpad((100 + floor(random() * 900))::int::text, 3, '0') end;
    exit when not exists (select 1 from public.community_memberships m where m.group_id = p_group and lower(m.handle) = lower(v_h));
    if i >= 60 then raise exception 'could not issue a handle for this group' using errcode = '55000'; end if;
  end loop;
  return v_h;
end $$;

create or replace function private.community_pick_avatar() returns text
language sql volatile security definer set search_path = '' as $$
  select (a.value)
    from jsonb_array_elements_text(private.community_cfg() -> 'avatars') with ordinality as a(value, ord)
   order by random() limit 1
$$;

-- ---------------------------------------------------------------------------
-- 1. Browse and read
-- ---------------------------------------------------------------------------
create or replace function public.community_list_groups() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_open boolean;
  v_adult boolean;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  v_open := private.go_live_open_patient('community', v_uid);
  v_adult := private.community_adult(v_uid);
  if not v_open or not v_adult then
    return jsonb_build_object('open', v_open, 'adult', v_adult, 'groups', '[]'::jsonb);
  end if;
  return jsonb_build_object('open', true, 'adult', true, 'groups', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', g.id, 'slug', g.slug, 'name', g.name, 'description', g.description,
             'topic_code', g.topic_code, 'topic_label', t.label, 'status', g.status,
             'member_count', (select count(*) from public.community_memberships m where m.group_id = g.id and m.status = 'active'),
             'full', (g.member_cap is not null and (select count(*) from public.community_memberships m where m.group_id = g.id and m.status = 'active') >= g.member_cap),
             'my_status', coalesce((select m.status from public.community_memberships m where m.group_id = g.id and m.profile_id = v_uid), 'none'))
           order by t.sort_order, g.name)
      from public.community_groups g
      join public.community_topics t on t.code = g.topic_code and t.is_active
     where g.status in ('active', 'read_only') and g.sensitivity = 'standard'), '[]'::jsonb));
end $$;

create or replace function public.community_get_group(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
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
            join public.profiles p on p.id = s.profile_id and p.is_active and p.role = 'care_coordinator'
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
                     'notifications_muted', m.notifications_muted, 'digest_opt_in', m.digest_opt_in) end,
    'pinned', v_pinned,
    'team', v_team,
    'qa', v_qa,
    'prompts', v_prompts,
    -- The app reads limits from here and never carries a copy: they are PROPOSED values in the versioned configuration.
    'limits', jsonb_build_object('post_max_chars', private.community_cfg_int('post_max_chars'),
                                 'edit_window_minutes', private.community_cfg_int('edit_window_minutes'),
                                 'image_max_bytes', private.community_cfg_int('image_max_bytes')));
end $$;

-- ---------------------------------------------------------------------------
-- 2. Join and leave
-- ---------------------------------------------------------------------------
create or replace function public.community_join_group(p_group_id uuid, p_rules_version integer, p_consent boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  g public.community_groups;
  m public.community_memberships;
  v_handle text;
  v_avatar text;
  v_consent text;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.go_live_open_patient('community', v_uid) then return jsonb_build_object('status', 'refused', 'reason', 'not_open_yet'); end if;
  if not private.community_adult(v_uid) then return jsonb_build_object('status', 'refused', 'reason', 'adults_only'); end if;
  select * into g from public.community_groups where id = p_group_id for update;
  if not found or g.status <> 'active' or g.sensitivity <> 'standard' then return jsonb_build_object('status', 'refused', 'reason', 'group_closed'); end if;
  if g.join_mode <> 'open' then return jsonb_build_object('status', 'refused', 'reason', 'by_invitation'); end if;
  if p_rules_version is distinct from g.rules_version then return jsonb_build_object('status', 'refused', 'reason', 'rules_changed', 'rules_version', g.rules_version); end if;
  if p_consent is not true then return jsonb_build_object('status', 'refused', 'reason', 'consent_needed'); end if;
  if g.member_cap is not null
     and (select count(*) from public.community_memberships mm where mm.group_id = g.id and mm.status = 'active') >= g.member_cap then
    return jsonb_build_object('status', 'refused', 'reason', 'group_full');
  end if;
  if private.community_active_sanction(v_uid, g.id) in ('ban', 'suspend') then return jsonb_build_object('status', 'refused', 'reason', 'not_allowed'); end if;

  v_consent := private.community_cfg() ->> 'consent_version';
  if v_consent is null then raise exception 'community configuration has no consent_version' using errcode = '55000'; end if;

  select * into m from public.community_memberships where group_id = g.id and profile_id = v_uid for update;
  if found then
    if m.status = 'banned' then return jsonb_build_object('status', 'refused', 'reason', 'not_allowed'); end if;
    update public.community_memberships
       set status = 'active', left_at = null, rules_accepted_version = g.rules_version, rules_accepted_at = now(),
           consent_version = v_consent, consented_at = now()
     where group_id = g.id and profile_id = v_uid
     returning handle, avatar_code into v_handle, v_avatar;
    return jsonb_build_object('status', 'joined', 'handle', v_handle, 'avatar_code', v_avatar);
  end if;

  v_handle := private.community_new_handle(g.id);
  v_avatar := private.community_pick_avatar();
  insert into public.community_memberships (group_id, profile_id, handle, avatar_code, rules_accepted_version, consent_version)
  values (g.id, v_uid, v_handle, v_avatar, g.rules_version, v_consent);
  return jsonb_build_object('status', 'joined', 'handle', v_handle, 'avatar_code', v_avatar);
end $$;

create or replace function public.community_leave_group(p_group_id uuid, p_delete_posts boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  update public.community_memberships set status = 'left', left_at = now()
   where group_id = p_group_id and profile_id = v_uid and status in ('active', 'pending');
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'not_a_member'); end if;
  if p_delete_posts then
    update public.community_posts set state = 'deleted_by_author', removed_at = now()
     where group_id = p_group_id and author_profile_id = v_uid and state in ('visible', 'held', 'auto_hidden');
  end if;
  return jsonb_build_object('status', 'left');
end $$;

create or replace function public.community_set_group_muted(p_group_id uuid, p_muted boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  update public.community_memberships set notifications_muted = coalesce(p_muted, false)
   where group_id = p_group_id and profile_id = v_uid and status = 'active';
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'not_a_member'); end if;
  return jsonb_build_object('status', 'ok', 'notifications_muted', coalesce(p_muted, false));
end $$;

-- ---------------------------------------------------------------------------
-- 3. Reading the feed
-- ---------------------------------------------------------------------------
-- A reader needs an active membership and no ban or suspension. Returns the membership row or raises nothing (caller checks found).
create or replace function private.community_reader_ok(p_group uuid, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.go_live_open_patient('community', p_uid)
     and private.community_adult(p_uid)
     and exists (select 1 from public.community_memberships m where m.group_id = p_group and m.profile_id = p_uid and m.status = 'active')
     and coalesce(private.community_active_sanction(p_uid, p_group), 'none') not in ('ban', 'suspend')
$$;

create or replace function public.community_feed(p_group_id uuid, p_before timestamptz default null, p_limit integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_limit integer;
  v_posts jsonb;
  v_more boolean;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.community_reader_ok(p_group_id, v_uid) then return jsonb_build_object('ok', false, 'reason', 'not_a_member'); end if;
  v_limit := least(greatest(coalesce(p_limit, private.community_cfg_int('feed_page_size')), 1), private.community_cfg_int('max_page_size'));
  with page as (
    select po.*, m.avatar_code as author_avatar
      from public.community_posts po
      left join public.community_memberships m on m.group_id = po.group_id and m.profile_id = po.author_profile_id
     where po.group_id = p_group_id and po.parent_post_id is null
       and (po.state = 'visible' or (po.author_profile_id = v_uid and po.state in ('held', 'auto_hidden')))
       and not exists (select 1 from public.community_hidden_authors h where h.viewer_id = v_uid and h.author_id = po.author_profile_id and h.group_id = po.group_id)
       and (p_before is null or po.created_at < p_before)
     order by po.created_at desc
     limit v_limit + 1)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'author_handle', x.author_handle, 'author_avatar', x.author_avatar, 'is_mine', (x.author_profile_id = v_uid),
           'body', x.body, 'created_at', x.created_at, 'edited_at', x.edited_at, 'support_count', x.support_count,
           'reply_count', (select count(*) from public.community_posts r where r.parent_post_id = x.id and r.state = 'visible'),
           'i_supported', exists (select 1 from public.community_reactions rx where rx.post_id = x.id and rx.profile_id = v_uid),
           'image', (select jsonb_build_object('id', i.id, 'width', i.width, 'height', i.height) from public.community_post_images i where i.post_id = x.id and i.deleted_at is null),
           'qa_session_id', x.qa_session_id,
           'answers', coalesce((select jsonb_agg(jsonb_build_object('id', an.id, 'doctor_name', an.doctor_name, 'body', an.body, 'created_at', an.created_at) order by an.created_at)
                                 from public.community_qa_answers an where an.question_post_id = x.id and an.removed_at is null), '[]'::jsonb),
           'pending_review', (x.state <> 'visible')) order by x.created_at desc), '[]'::jsonb)
    into v_posts
    from (select * from page order by created_at desc limit v_limit) x;
  -- has_more: is there a row beyond this page?
  select (count(*) > v_limit) into v_more from (
    select 1 from public.community_posts po
     where po.group_id = p_group_id and po.parent_post_id is null
       and (po.state = 'visible' or (po.author_profile_id = v_uid and po.state in ('held', 'auto_hidden')))
       and not exists (select 1 from public.community_hidden_authors h where h.viewer_id = v_uid and h.author_id = po.author_profile_id and h.group_id = po.group_id)
       and (p_before is null or po.created_at < p_before)
     limit v_limit + 1) c;
  return jsonb_build_object('ok', true, 'posts', v_posts, 'has_more', v_more);
end $$;

create or replace function public.community_replies(p_post_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_group uuid;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select group_id into v_group from public.community_posts where id = p_post_id and state = 'visible';
  if v_group is null or not private.community_reader_ok(v_group, v_uid) then return jsonb_build_object('ok', false, 'reason', 'not_a_member'); end if;
  return jsonb_build_object('ok', true, 'replies', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'author_handle', r.author_handle, 'author_avatar', m.avatar_code, 'is_mine', (r.author_profile_id = v_uid),
             'body', r.body, 'created_at', r.created_at, 'edited_at', r.edited_at, 'support_count', r.support_count,
             'i_supported', exists (select 1 from public.community_reactions rx where rx.post_id = r.id and rx.profile_id = v_uid),
             'image', (select jsonb_build_object('id', i.id, 'width', i.width, 'height', i.height) from public.community_post_images i where i.post_id = r.id and i.deleted_at is null),
             'qa_session_id', r.qa_session_id,
             'answers', coalesce((select jsonb_agg(jsonb_build_object('id', an.id, 'doctor_name', an.doctor_name, 'body', an.body, 'created_at', an.created_at) order by an.created_at)
                                   from public.community_qa_answers an where an.question_post_id = r.id and an.removed_at is null), '[]'::jsonb),
             'pending_review', (r.state <> 'visible')) order by r.created_at)
      from public.community_posts r
      left join public.community_memberships m on m.group_id = r.group_id and m.profile_id = r.author_profile_id
     where r.parent_post_id = p_post_id
       and not exists (select 1 from public.community_hidden_authors h where h.viewer_id = v_uid and h.author_id = r.author_profile_id and h.group_id = r.group_id)
       and (r.state = 'visible' or (r.author_profile_id = v_uid and r.state in ('held', 'auto_hidden')))), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Posting
-- ---------------------------------------------------------------------------
-- Everything the submit and edit paths share, so the two cannot drift: who may post, and in what state a clean post lands.
create or replace function private.community_posting_gate(p_group_id uuid, p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  g public.community_groups;
  m public.community_memberships;
  v_s text;
begin
  if not private.go_live_open_patient('community', p_uid) then return jsonb_build_object('status', 'refused', 'reason', 'not_open_yet'); end if;
  if not private.community_adult(p_uid) then return jsonb_build_object('status', 'refused', 'reason', 'adults_only'); end if;
  select * into g from public.community_groups where id = p_group_id;
  if not found or g.status = 'draft' or g.status = 'archived' then return jsonb_build_object('status', 'refused', 'reason', 'group_closed'); end if;
  if g.status = 'read_only' then return jsonb_build_object('status', 'refused', 'reason', 'group_read_only'); end if;
  select * into m from public.community_memberships where group_id = p_group_id and profile_id = p_uid;
  if not found or m.status <> 'active' then return jsonb_build_object('status', 'refused', 'reason', 'not_a_member'); end if;
  if m.rules_accepted_version <> g.rules_version then return jsonb_build_object('status', 'refused', 'reason', 'accept_rules', 'rules_version', g.rules_version); end if;
  v_s := private.community_active_sanction(p_uid, p_group_id);
  if v_s is not null then return jsonb_build_object('status', 'refused', 'reason', case v_s when 'ban' then 'banned' when 'suspend' then 'suspended' else 'muted' end); end if;
  if m.muted_until is not null and m.muted_until > now() then return jsonb_build_object('status', 'refused', 'reason', 'muted'); end if;
  return jsonb_build_object('status', 'ok', 'approved_post_count', m.approved_post_count);
end $$;

-- Turns a scan into what happens to the text: { action: block|safety|hold|publish, codes[], class }.
create or replace function private.community_scan_outcome(p_scan jsonb, p_approved_post_count integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dec text := p_scan ->> 'decision';
  v_class text;
  v_codes text[];
begin
  if v_dec = 'block' then
    select h ->> 'class' into v_class from jsonb_array_elements(p_scan -> 'hits') h where h ->> 'action' = 'block' order by (h ->> 'rule_id')::bigint limit 1;
    return jsonb_build_object('action', 'block', 'class', v_class, 'codes', '[]'::jsonb);
  elsif v_dec = 'safety' then
    -- self-harm outranks emergency when both match
    select case when bool_or(h ->> 'class' = 'self_harm') then 'self_harm' else 'emergency' end into v_class
      from jsonb_array_elements(p_scan -> 'hits') h where h ->> 'action' = 'safety';
    return jsonb_build_object('action', 'safety', 'class', v_class, 'codes', jsonb_build_array('safety:' || v_class));
  elsif v_dec = 'hold' then
    select array_agg(distinct h ->> 'class') into v_codes from jsonb_array_elements(p_scan -> 'hits') h where h ->> 'action' = 'hold';
    return jsonb_build_object('action', 'hold', 'class', v_codes[1], 'codes', to_jsonb(v_codes));
  end if;
  if p_approved_post_count < private.community_cfg_int('new_member_premoderated_posts') then
    return jsonb_build_object('action', 'hold', 'class', 'new_member', 'codes', jsonb_build_array('new_member'));
  end if;
  return jsonb_build_object('action', 'publish', 'class', null, 'codes', '[]'::jsonb);
end $$;

create or replace function private.community_submit_core(p_group_id uuid, p_parent_id uuid, p_body text, p_client_request_id uuid, p_image jsonb, p_qa_session uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_gate jsonb;
  v_body text;
  v_existing public.community_posts;
  v_parent public.community_posts;
  v_handle text;
  v_scan jsonb;
  v_out jsonb;
  v_action text;
  v_class text;
  v_codes text[];
  v_post_id uuid;
  v_state text;
  v_n integer;
  v_h integer;
  v_d integer;
  v_img_ok boolean;
  qs public.community_qa_sessions;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  v_gate := private.community_posting_gate(p_group_id, v_uid);
  if v_gate ->> 'status' <> 'ok' then return v_gate; end if;

  -- Serialise this member's posting so the rate limits below cannot be raced.
  perform 1 from public.community_memberships where group_id = p_group_id and profile_id = v_uid for update;

  if p_client_request_id is not null then
    select * into v_existing from public.community_posts where author_profile_id = v_uid and client_request_id = p_client_request_id;
    if found then
      return private.community_replay_result(v_existing);
    end if;
  end if;

  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' then return jsonb_build_object('status', 'refused', 'reason', 'empty'); end if;
  if length(v_body) > private.community_cfg_int('post_max_chars') then return jsonb_build_object('status', 'refused', 'reason', 'too_long'); end if;

  if p_image is not null then
    select images_allowed into v_img_ok from public.community_groups where id = p_group_id;
    if not coalesce(v_img_ok, false) then return jsonb_build_object('status', 'refused', 'reason', 'images_off'); end if;
    if p_qa_session is not null then return jsonb_build_object('status', 'refused', 'reason', 'images_off'); end if;
    if (p_image ->> 'mime') not in ('image/jpeg', 'image/png')
       or coalesce((p_image ->> 'size')::int, 0) not between 1 and private.community_cfg_int('image_max_bytes')
       or coalesce((p_image ->> 'width')::int, 0) not between 1 and 20000 or coalesce((p_image ->> 'height')::int, 0) not between 1 and 20000
       or coalesce(p_image ->> 'path', '') !~ ('^' || p_group_id::text || '/' || v_uid::text || '/[0-9a-f-]{36}[.](jpg|png)$') then
      return jsonb_build_object('status', 'refused', 'reason', 'bad_image');
    end if;
    -- the file must really be there, in the caller's own folder (where storage exists; the test database has none)
    if to_regclass('storage.objects') is not null then
      execute 'select exists (select 1 from storage.objects where bucket_id = ''community-images'' and name = $1)' into v_img_ok using (p_image ->> 'path');
      if not coalesce(v_img_ok, false) then return jsonb_build_object('status', 'refused', 'reason', 'bad_image'); end if;
    end if;
  end if;

  -- A question for the doctors: only while the session is open, only as a top-level post, a few per member.
  if p_qa_session is not null then
    select * into qs from public.community_qa_sessions where id = p_qa_session and group_id = p_group_id and cancelled_at is null;
    if not found or p_parent_id is not null or now() < qs.opens_at or now() >= qs.closes_at then
      return jsonb_build_object('status', 'refused', 'reason', 'qa_closed');
    end if;
    if (select count(*) from public.community_posts q where q.qa_session_id = qs.id and q.author_profile_id = v_uid and q.state not in ('removed', 'deleted_by_author'))
         >= private.community_cfg_int('qa_questions_per_member') then
      return jsonb_build_object('status', 'refused', 'reason', 'qa_limit');
    end if;
  end if;

  if p_parent_id is not null then
    select * into v_parent from public.community_posts where id = p_parent_id;
    if not found or v_parent.group_id <> p_group_id or v_parent.state <> 'visible' or v_parent.parent_post_id is not null then
      return jsonb_build_object('status', 'refused', 'reason', 'reply_target_gone');
    end if;
  end if;

  -- cool-down after repeated blocked attempts
  if exists (select 1 from public.community_moderation_events e
              where e.member_profile_id = v_uid and e.action = 'cooldown_started'
                and e.created_at > now() - make_interval(mins => (private.community_cfg() #>> '{block_cooldown,cooldown_minutes}')::int)) then
    return jsonb_build_object('status', 'refused', 'reason', 'cooling_down');
  end if;

  select count(*) filter (where created_at > now() - interval '1 hour'), count(*) filter (where created_at > now() - interval '1 day')
    into v_h, v_d from public.community_posts where author_profile_id = v_uid and created_at > now() - interval '1 day';
  if v_h >= private.community_cfg_int('rate_posts_per_hour') or v_d >= private.community_cfg_int('rate_posts_per_day') then
    return jsonb_build_object('status', 'refused', 'reason', 'rate_limited');
  end if;

  v_scan := private.community_scan(v_body);
  if v_scan ->> 'decision' = 'unavailable' then return jsonb_build_object('status', 'refused', 'reason', 'not_ready'); end if;
  v_out := private.community_scan_outcome(v_scan, (v_gate ->> 'approved_post_count')::int);
  v_action := v_out ->> 'action';
  v_class := v_out ->> 'class';

  if v_action = 'block' then
    perform private.community_log_event(p_group_id, null, v_uid, 'blocked', v_uid, v_class, v_scan -> 'hits');
    select count(*) into v_n from public.community_moderation_events e
     where e.member_profile_id = v_uid and e.action = 'blocked'
       and e.created_at > now() - make_interval(mins => (private.community_cfg() #>> '{block_cooldown,window_minutes}')::int);
    if v_n >= (private.community_cfg() #>> '{block_cooldown,max_blocks}')::int then
      perform private.community_log_event(p_group_id, null, v_uid, 'cooldown_started', null, 'repeated_blocks', '[]'::jsonb);
    end if;
    return jsonb_build_object('status', 'blocked', 'reason', v_class);
  end if;

  select array_agg(c) into v_codes from jsonb_array_elements_text(v_out -> 'codes') c;
  -- A post with a picture is always seen by a moderator first, whatever its words say.
  if p_image is not null then
    if v_action = 'publish' then
      v_action := 'hold'; v_class := 'image'; v_codes := array['image'];
    elsif v_action = 'hold' then
      v_codes := array_append(coalesce(v_codes, '{}'), 'image');
    end if;
  end if;
  v_state := case when v_action = 'publish' then 'visible' else 'held' end;
  select handle into v_handle from public.community_memberships where group_id = p_group_id and profile_id = v_uid;

  begin
    insert into public.community_posts (group_id, author_profile_id, author_handle, parent_post_id, body, state, hold_reason_codes, rule_set_version, client_request_id, qa_session_id)
    values (p_group_id, v_uid, v_handle, p_parent_id, v_body, v_state, coalesce(v_codes, '{}'), (v_scan ->> 'version')::int, p_client_request_id, p_qa_session)
    returning id into v_post_id;
  exception when unique_violation then
    select * into v_existing from public.community_posts where author_profile_id = v_uid and client_request_id = p_client_request_id;
    return private.community_replay_result(v_existing);
  end;

  if p_image is not null then
    insert into public.community_post_images (post_id, group_id, storage_path, mime, size_bytes, width, height)
    values (v_post_id, p_group_id, p_image ->> 'path', p_image ->> 'mime', (p_image ->> 'size')::int, (p_image ->> 'width')::int, (p_image ->> 'height')::int);
  end if;

  if v_action = 'safety' then
    insert into public.community_safety_signals (group_id, post_id, author_profile_id, kind, rule_set_version)
    values (p_group_id, v_post_id, v_uid, case v_class when 'self_harm' then 'self_harm_language' else 'emergency_language' end, (v_scan ->> 'version')::int);
    perform private.community_log_event(p_group_id, v_post_id, v_uid, 'withheld_safety', v_uid, v_class, v_scan -> 'hits');
    return jsonb_build_object('status', 'withheld', 'safety_kind', v_class, 'post_id', v_post_id);
  elsif v_action = 'hold' then
    perform private.community_log_event(p_group_id, v_post_id, v_uid, 'held', v_uid, v_class, v_scan -> 'hits');
    return jsonb_build_object('status', 'held', 'reason', v_class, 'post_id', v_post_id);
  end if;

  if p_parent_id is not null and v_parent.author_profile_id is not null and v_parent.author_profile_id <> v_uid
     and not exists (select 1 from public.community_hidden_authors h where h.viewer_id = v_parent.author_profile_id and h.author_id = v_uid and h.group_id = p_group_id)
     and exists (select 1 from public.community_memberships m
                  where m.group_id = p_group_id and m.profile_id = v_parent.author_profile_id and m.status = 'active' and not m.notifications_muted) then
    perform private.community_notify(v_parent.author_profile_id, 'community_reply', v_post_id);
  end if;
  return jsonb_build_object('status', 'published', 'post_id', v_post_id);
end $$;

create or replace function public.community_submit_post(p_group_id uuid, p_parent_id uuid, p_body text, p_client_request_id uuid default null)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select private.community_submit_core(p_group_id, p_parent_id, p_body, p_client_request_id, null, null)
$$;

-- A post with one picture. The file has already been checked and stored by the server; the picture waits for a moderator.
create or replace function public.community_submit_post_with_image(
  p_group_id uuid, p_parent_id uuid, p_body text, p_client_request_id uuid,
  p_storage_path text, p_mime text, p_size integer, p_width integer, p_height integer)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select private.community_submit_core(p_group_id, p_parent_id, p_body, p_client_request_id,
    jsonb_build_object('path', p_storage_path, 'mime', p_mime, 'size', p_size, 'width', p_width, 'height', p_height), null)
$$;

-- A question for the doctors in an open session.
create or replace function public.community_ask_question(p_group_id uuid, p_session_id uuid, p_body text, p_client_request_id uuid default null)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select private.community_submit_core(p_group_id, null, p_body, p_client_request_id, null, p_session_id)
$$;

-- What a retried request is told: the same answer the first attempt got, including the safety card for a withheld post.
create or replace function private.community_replay_result(po public.community_posts) returns jsonb
language sql immutable set search_path = '' as $$
  select case
    when po.state = 'visible' then jsonb_build_object('status', 'published', 'post_id', po.id, 'repeat', true)
    when exists (select 1 from unnest(po.hold_reason_codes) c where c like 'safety:%')
      then jsonb_build_object('status', 'withheld',
             'safety_kind', (select substr(c, 8) from unnest(po.hold_reason_codes) c where c like 'safety:%' limit 1),
             'post_id', po.id, 'repeat', true)
    else jsonb_build_object('status', 'held', 'post_id', po.id, 'repeat', true) end
$$;

create or replace function public.community_edit_post(p_post_id uuid, p_body text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  po public.community_posts;
  v_gate jsonb;
  v_body text;
  v_scan jsonb;
  v_out jsonb;
  v_action text;
  v_class text;
  v_codes text[];
  v_apc integer;
  v_nb integer;
  v_has_img boolean;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into po from public.community_posts where id = p_post_id for update;
  if not found or po.author_profile_id is distinct from v_uid then return jsonb_build_object('status', 'refused', 'reason', 'not_yours'); end if;
  if po.state not in ('visible', 'held') then return jsonb_build_object('status', 'refused', 'reason', 'not_editable'); end if;
  -- a post withheld for safety is the reviewer's to decide; editing it would wipe the safety marker
  if exists (select 1 from unnest(po.hold_reason_codes) c where c like 'safety:%') then return jsonb_build_object('status', 'refused', 'reason', 'not_editable'); end if;
  if po.created_at < now() - make_interval(mins => private.community_cfg_int('edit_window_minutes')) then
    return jsonb_build_object('status', 'refused', 'reason', 'edit_window_over');
  end if;
  v_gate := private.community_posting_gate(po.group_id, v_uid);
  if v_gate ->> 'status' <> 'ok' then return v_gate; end if;
  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' then return jsonb_build_object('status', 'refused', 'reason', 'empty'); end if;
  if length(v_body) > private.community_cfg_int('post_max_chars') then return jsonb_build_object('status', 'refused', 'reason', 'too_long'); end if;
  -- the same cool-down as a new post: editing is not a way to keep probing the filter
  if exists (select 1 from public.community_moderation_events e
              where e.member_profile_id = v_uid and e.action = 'cooldown_started'
                and e.created_at > now() - make_interval(mins => (private.community_cfg() #>> '{block_cooldown,cooldown_minutes}')::int)) then
    return jsonb_build_object('status', 'refused', 'reason', 'cooling_down');
  end if;

  v_scan := private.community_scan(v_body);
  if v_scan ->> 'decision' = 'unavailable' then return jsonb_build_object('status', 'refused', 'reason', 'not_ready'); end if;
  v_apc := (v_gate ->> 'approved_post_count')::int;
  -- An edit is checked as strictly as a new post, but a post that is already visible is not sent back to pre-moderation just
  -- because its author is new: only the rules decide.
  v_out := private.community_scan_outcome(v_scan, case when po.state = 'visible' then 1000000 else v_apc end);
  v_action := v_out ->> 'action';
  v_class := v_out ->> 'class';
  v_has_img := exists (select 1 from public.community_post_images pi where pi.post_id = po.id and pi.deleted_at is null);

  if v_action = 'block' then
    perform private.community_log_event(po.group_id, po.id, v_uid, 'blocked', v_uid, v_class, v_scan -> 'hits');
    select count(*) into v_nb from public.community_moderation_events e
     where e.member_profile_id = v_uid and e.action = 'blocked'
       and e.created_at > now() - make_interval(mins => (private.community_cfg() #>> '{block_cooldown,window_minutes}')::int);
    if v_nb >= (private.community_cfg() #>> '{block_cooldown,max_blocks}')::int then
      perform private.community_log_event(po.group_id, null, v_uid, 'cooldown_started', null, 'repeated_blocks', '[]'::jsonb);
    end if;
    return jsonb_build_object('status', 'blocked', 'reason', v_class);
  end if;

  select array_agg(c) into v_codes from jsonb_array_elements_text(v_out -> 'codes') c;
  if v_action = 'safety' then
    update public.community_posts set body = v_body, edited_at = now(), state = 'held', hold_reason_codes = coalesce(v_codes, '{}'), rule_set_version = (v_scan ->> 'version')::int where id = po.id;
    insert into public.community_safety_signals (group_id, post_id, author_profile_id, kind, rule_set_version)
    values (po.group_id, po.id, v_uid, case v_class when 'self_harm' then 'self_harm_language' else 'emergency_language' end, (v_scan ->> 'version')::int);
    perform private.community_log_event(po.group_id, po.id, v_uid, 'withheld_safety', v_uid, v_class, v_scan -> 'hits');
    return jsonb_build_object('status', 'withheld', 'safety_kind', v_class, 'post_id', po.id);
  elsif v_action = 'hold' then
    update public.community_posts set body = v_body, edited_at = now(), state = 'held', hold_reason_codes = case when v_has_img then array_append(coalesce(v_codes, '{}'), 'image') else coalesce(v_codes, '{}') end, rule_set_version = (v_scan ->> 'version')::int where id = po.id;
    perform private.community_log_event(po.group_id, po.id, v_uid, 'held', v_uid, v_class, v_scan -> 'hits');
    return jsonb_build_object('status', 'held', 'reason', v_class, 'post_id', po.id);
  end if;
  -- a post with a picture goes back to a moderator whenever its words change: the picture was approved with those words
  if v_has_img and po.state = 'visible' then
    update public.community_posts set body = v_body, edited_at = now(), state = 'held', hold_reason_codes = array['image'], rule_set_version = (v_scan ->> 'version')::int where id = po.id;
    return jsonb_build_object('status', 'held', 'reason', 'image', 'post_id', po.id);
  end if;
  update public.community_posts set body = v_body, edited_at = now(), rule_set_version = (v_scan ->> 'version')::int where id = po.id;
  return jsonb_build_object('status', case po.state when 'visible' then 'published' else 'held' end, 'post_id', po.id);
end $$;

create or replace function public.community_delete_own_post(p_post_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  update public.community_posts set state = 'deleted_by_author', removed_at = now()
   where id = p_post_id and author_profile_id = v_uid and state in ('visible', 'held', 'auto_hidden');
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'not_yours'); end if;
  return jsonb_build_object('status', 'deleted');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Reactions and reports
-- ---------------------------------------------------------------------------
create or replace function public.community_react(p_post_id uuid, p_on boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  po public.community_posts;
  v_count integer;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into po from public.community_posts where id = p_post_id;
  if not found or po.state <> 'visible' or not private.community_reader_ok(po.group_id, v_uid) then
    return jsonb_build_object('status', 'refused', 'reason', 'not_available');
  end if;
  if p_on then
    insert into public.community_reactions (post_id, profile_id) values (p_post_id, v_uid) on conflict do nothing;
  else
    delete from public.community_reactions where post_id = p_post_id and profile_id = v_uid;
  end if;
  select count(*) into v_count from public.community_reactions where post_id = p_post_id;
  update public.community_posts set support_count = v_count where id = p_post_id;
  return jsonb_build_object('status', 'ok', 'support_count', v_count, 'i_supported', coalesce(p_on, false));
end $$;

create or replace function public.community_report_post(p_post_id uuid, p_reason_code text, p_detail text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  po public.community_posts;
  v_n integer;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into po from public.community_posts where id = p_post_id;
  if not found or po.state not in ('visible', 'auto_hidden') or not private.community_reader_ok(po.group_id, v_uid) then
    return jsonb_build_object('status', 'refused', 'reason', 'not_available');
  end if;
  if po.author_profile_id = v_uid then return jsonb_build_object('status', 'refused', 'reason', 'own_post'); end if;
  if p_reason_code is null or p_reason_code not in ('contact_details', 'selling_or_promotion', 'medical_misinformation', 'harassment', 'self_harm_or_danger', 'privacy', 'other') then
    return jsonb_build_object('status', 'refused', 'reason', 'bad_reason');
  end if;
  insert into public.community_reports (post_id, reporter_profile_id, reason_code, detail)
  values (p_post_id, v_uid, p_reason_code, nullif(left(btrim(coalesce(p_detail, '')), 500), ''))
  on conflict (post_id, reporter_profile_id) do nothing;
  if not found then return jsonb_build_object('status', 'already_reported'); end if;
  select count(distinct reporter_profile_id) into v_n from public.community_reports where post_id = p_post_id and status = 'open';
  if v_n >= private.community_cfg_int('auto_hide_report_threshold') and po.state = 'visible' then
    update public.community_posts set state = 'auto_hidden', hold_reason_codes = array_append(hold_reason_codes, 'reported') where id = p_post_id;
    perform private.community_log_event(po.group_id, p_post_id, po.author_profile_id, 'auto_hidden', null, 'report_threshold', '[]'::jsonb);
  end if;
  -- a report that says someone may be in danger is also a safety signal for a reviewer
  if p_reason_code = 'self_harm_or_danger' and not exists (
       select 1 from public.community_safety_signals s where s.post_id = p_post_id and s.status in ('open', 'in_review')) then
    insert into public.community_safety_signals (group_id, post_id, author_profile_id, kind)
    values (po.group_id, p_post_id, po.author_profile_id, 'reviewer_concern');
  end if;
  return jsonb_build_object('status', 'reported');
end $$;

-- ---------------------------------------------------------------------------
-- 6. Retention: purge removed and deleted bodies after the configured window (scheduled by an operator or cron, service role only)
-- ---------------------------------------------------------------------------
create or replace function public.community_purge_expired() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_days integer := private.community_cfg_int('removed_body_retention_days');
  v_n integer;
begin
  update public.community_posts set body = '[removed]'
   where state in ('removed', 'deleted_by_author') and body <> '[removed]' and removed_at < now() - make_interval(days => v_days);
  get diagnostics v_n = row_count;
  -- what a member wrote in an appeal is kept for the same window after it is decided
  update public.community_appeals set reason = '[removed after retention]'
   where status <> 'open' and decided_at < now() - make_interval(days => v_days) and reason <> '[removed after retention]';
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  private.community_log_event(uuid, uuid, uuid, text, uuid, text, jsonb), private.community_new_handle(uuid), private.community_pick_avatar(),
  private.community_reader_ok(uuid, uuid), private.community_posting_gate(uuid, uuid), private.community_scan_outcome(jsonb, integer), private.community_replay_result(public.community_posts),
  private.community_submit_core(uuid, uuid, text, uuid, jsonb, uuid)
from public, anon, authenticated, service_role;

revoke all on function
  public.community_list_groups(), public.community_get_group(text), public.community_join_group(uuid, integer, boolean),
  public.community_leave_group(uuid, boolean), public.community_set_group_muted(uuid, boolean), public.community_feed(uuid, timestamptz, integer),
  public.community_replies(uuid), public.community_submit_post(uuid, uuid, text, uuid), public.community_edit_post(uuid, text),
  public.community_delete_own_post(uuid), public.community_react(uuid, boolean), public.community_report_post(uuid, text, text),
  public.community_submit_post_with_image(uuid, uuid, text, uuid, text, text, integer, integer, integer), public.community_ask_question(uuid, uuid, text, uuid),
  public.community_purge_expired()
from public, anon, authenticated, service_role;

grant execute on function
  public.community_list_groups(), public.community_get_group(text), public.community_join_group(uuid, integer, boolean),
  public.community_leave_group(uuid, boolean), public.community_set_group_muted(uuid, boolean), public.community_feed(uuid, timestamptz, integer),
  public.community_replies(uuid), public.community_submit_post(uuid, uuid, text, uuid), public.community_edit_post(uuid, text),
  public.community_delete_own_post(uuid), public.community_react(uuid, boolean), public.community_report_post(uuid, text, text),
  public.community_submit_post_with_image(uuid, uuid, text, uuid, text, text, integer, integer, integer), public.community_ask_question(uuid, uuid, text, uuid)
to authenticated;

grant execute on function public.community_purge_expired() to service_role;
