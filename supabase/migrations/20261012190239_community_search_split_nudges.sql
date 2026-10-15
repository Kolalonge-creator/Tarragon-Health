-- Community: search inside a member's own groups, moderators turning a reply into its own post, an automatic picture check hook that can only
-- add a flag, and a gentle once-in-a-while reminder that a reply is waiting. Decisions: docs/DECISIONS.md COM-22 to COM-25.

-- ---------------------------------------------------------------------------
-- 1. Search post text, only inside groups the member has joined (COM-22). Never across groups they have not joined, never public.
--    The same visibility rules as the feed: visible posts only, people the member hid are left out, and nothing about the search is stored.
-- ---------------------------------------------------------------------------
create or replace function public.community_search_posts(p_query text, p_group_id uuid default null, p_before timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_q text;
  v_items jsonb;
  v_more boolean;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.go_live_open_patient('community', v_uid) then return jsonb_build_object('ok', false, 'reason', 'not_open_yet'); end if;
  v_q := lower(btrim(coalesce(p_query, '')));
  if length(v_q) < 3 or length(v_q) > 80 then return jsonb_build_object('ok', false, 'reason', 'bad_query'); end if;

  with hits as (
    select po.id, po.group_id, po.author_handle, po.author_profile_id, po.body, po.created_at, po.parent_post_id,
           g.name as group_name, g.slug as group_slug, am.avatar_code
      from public.community_posts po
      join public.community_groups g on g.id = po.group_id
      left join public.community_memberships am on am.group_id = po.group_id and am.profile_id = po.author_profile_id
     where po.state = 'visible'
       and (p_group_id is null or po.group_id = p_group_id)
       and private.community_reader_ok(po.group_id, v_uid)
       and position(v_q in lower(po.body)) > 0
       and not exists (select 1 from public.community_hidden_authors h where h.viewer_id = v_uid and h.author_id = po.author_profile_id and h.group_id = po.group_id)
       and (p_before is null or po.created_at < p_before)
     order by po.created_at desc
     limit 21)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'group_id', x.group_id, 'group_name', x.group_name, 'group_slug', x.group_slug,
           'author_handle', x.author_handle, 'author_avatar', x.avatar_code, 'is_mine', (x.author_profile_id = v_uid),
           'body', left(x.body, 600), 'created_at', x.created_at, 'is_reply', (x.parent_post_id is not null)) order by x.created_at desc), '[]'::jsonb),
         (select count(*) from hits) > 20
    into v_items, v_more
    from (select * from hits order by created_at desc limit 20) x;
  return jsonb_build_object('ok', true, 'items', v_items, 'has_more', v_more);
end $$;

-- ---------------------------------------------------------------------------
-- 2. A moderator turns a reply into its own post (COM-23). Same group, same author, same words and time; only the link to the post it
--    answered goes. The author is not told. Never for a safety post, and a picture stays with the post.
-- ---------------------------------------------------------------------------
create or replace function public.community_mod_split_reply(p_post_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  po public.community_posts;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into po from public.community_posts where id = p_post_id for update;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'no_such_post'); end if;
  if not private.community_is_moderator(po.group_id) then raise exception 'community moderators only' using errcode = '42501'; end if;
  if po.parent_post_id is null then return jsonb_build_object('status', 'refused', 'reason', 'not_a_reply'); end if;
  if po.state <> 'visible' then return jsonb_build_object('status', 'refused', 'reason', 'not_showing'); end if;
  if exists (select 1 from unnest(po.hold_reason_codes) c where c like 'safety:%') then
    return jsonb_build_object('status', 'refused', 'reason', 'safety_reviewer_only');
  end if;
  perform set_config('community.split_reply', 'on', true);
  update public.community_posts set parent_post_id = null where id = po.id;
  perform set_config('community.split_reply', 'off', true);
  perform private.community_log_event(po.group_id, po.id, po.author_profile_id, 'split_to_post', v_uid, null, '[]'::jsonb);
  return jsonb_build_object('status', 'split');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Automatic picture check hook (COM-24). Off until a vendor is connected and the CMO signs the safety case. It can ONLY add a flag for
--    the moderator: every picture still waits for a person, and nothing is ever released or removed by the check.
-- ---------------------------------------------------------------------------
create or replace function public.community_mark_image_flagged(p_post_id uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_n integer;
begin
  update public.community_posts set hold_reason_codes = array_append(hold_reason_codes, 'image_flagged')
   where id = p_post_id and state = 'held' and not ('image_flagged' = any (hold_reason_codes))
     and exists (select 1 from public.community_post_images i where i.post_id = p_post_id and i.deleted_at is null);
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform private.community_log_event((select group_id from public.community_posts where id = p_post_id), p_post_id, null, 'image_flagged', null, 'auto_check', '[]'::jsonb);
  end if;
  return v_n > 0;
end $$;

-- ---------------------------------------------------------------------------
-- 4. A gentle reminder that a reply is waiting (COM-25). Only for members who chose the weekly note, only when the reply notice has sat
--    unread for return_nudge_days, and at most once every 14 days. Fixed text, no group, no handle, no words.
-- ---------------------------------------------------------------------------
create or replace function public.community_send_return_nudges() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_days integer := private.community_cfg_int('return_nudge_days');
  r record;
  v_n integer := 0;
begin
  for r in
    select distinct n.recipient_id as pid
      from public.notifications n
     where n.template = 'community_reply' and n.opened_at is null and n.created_at < now() - make_interval(days => v_days)
       and exists (select 1 from public.community_memberships m
                    where m.profile_id = n.recipient_id and m.status = 'active' and m.digest_opt_in and not m.notifications_muted)
       and not exists (select 1 from public.notifications w
                        where w.recipient_id = n.recipient_id and w.template = 'community_reply_waiting' and w.created_at > now() - interval '14 days')
     limit 500
  loop
    perform private.community_notify(r.pid, 'community_reply_waiting', r.pid, 'profiles');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Privileges
-- ---------------------------------------------------------------------------
revoke all on function public.community_search_posts(text, uuid, timestamptz), public.community_mod_split_reply(uuid),
  public.community_mark_image_flagged(uuid), public.community_send_return_nudges() from public, anon, authenticated, service_role;
grant execute on function public.community_search_posts(text, uuid, timestamptz), public.community_mod_split_reply(uuid) to authenticated;
grant execute on function public.community_mark_image_flagged(uuid), public.community_send_return_nudges() to service_role;
