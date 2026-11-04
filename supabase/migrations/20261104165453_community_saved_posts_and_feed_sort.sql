-- Community: saved posts and a "most discussed" order for a group's feed (founder, in chat, 2026-11-04; docs/COMMUNITY_SPEC.md section 21, decision COM-30).
--
-- 1. public.community_saved_posts: a member's private list of top-level posts they want to find again. RPC-only like every community table
--    (RLS on, no policy, no client grant). Private to the saver: nobody else, staff included, is told who saved what, and the author is never
--    told. Rows go with the account or the post (ON DELETE CASCADE). Cap: 500 per member.
-- 2. public.community_set_saved(post, saved): save a top-level post the member can read today (active member of its group, visible, or
--    their own post waiting for review); unsave always removes the member's own row.
-- 3. public.community_saved_list(before): the member's saved posts, newest save first, paged. A saved post drops out of the list (the row
--    stays) while the member is no longer a reader of that group, the post is not visible, or its author is hidden by the member.
-- 4. public.community_feed gains p_sort: 'latest' (unchanged, paged by created_at) or 'discussed' (top-level posts of the last 30 days with
--    the most visible replies, one page, no paging). Every post carries i_saved. Rebuilt from the LIVE body read on 2026-11-04
--    (pg_get_functiondef), not from an older migration copy. The 3-argument signature is dropped so named calls keep resolving to one function.
--
-- Zero rows exist anywhere for this feature (new table). No go-live guard: Community's own guard already gates every RPC through
-- community_reader_ok (G-01: one gate per feature).

create table public.community_saved_posts (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  post_id    uuid not null references public.community_posts (id) on delete cascade,
  saved_at   timestamptz not null default now(),
  primary key (profile_id, post_id)
);
create index community_saved_posts_post_idx on public.community_saved_posts (post_id);

alter table public.community_saved_posts enable row level security;
revoke all on public.community_saved_posts from public, anon, authenticated, service_role;

comment on table public.community_saved_posts is
  'Community: a member''s private saved posts. RPC-only; never shown to staff, authors or institutions.';

-- ---------------------------------------------------------------------------
-- Save / unsave
-- ---------------------------------------------------------------------------
create or replace function public.community_set_saved(p_post_id uuid, p_saved boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  po public.community_posts;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_saved is null then return jsonb_build_object('ok', false, 'reason', 'bad_request'); end if;
  -- Unsaving removes the member's own row whatever the post's state now (left the group, post removed): the row is theirs.
  if not p_saved then
    delete from public.community_saved_posts where profile_id = v_uid and post_id = p_post_id;
    return jsonb_build_object('ok', true, 'saved', false);
  end if;
  select * into po from public.community_posts where id = p_post_id;
  -- Unknown, a reply, or not readable all give the same answer, so the call cannot be used to probe for posts.
  if not found or po.parent_post_id is not null or not private.community_reader_ok(po.group_id, v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  -- One save at a time per member, so the cap holds under parallel taps.
  perform pg_advisory_xact_lock(hashtextextended('community_saved:' || v_uid::text, 0));
  if not (po.state = 'visible' or (po.author_profile_id = v_uid and po.state in ('held', 'auto_hidden'))) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not exists (select 1 from public.community_saved_posts where profile_id = v_uid and post_id = p_post_id)
     and (select count(*) from public.community_saved_posts where profile_id = v_uid) >= 500 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  insert into public.community_saved_posts (profile_id, post_id) values (v_uid, p_post_id) on conflict do nothing;
  return jsonb_build_object('ok', true, 'saved', true);
end $$;

-- ---------------------------------------------------------------------------
-- The saved list
-- ---------------------------------------------------------------------------
create or replace function public.community_saved_list(p_before timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_limit integer;
  v_posts jsonb;
  v_more boolean;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  v_limit := least(greatest(private.community_cfg_int('feed_page_size'), 1), private.community_cfg_int('max_page_size'));
  with readable as (
    select s.saved_at, po.*, g.slug as group_slug, g.name as group_name, m.avatar_code as author_avatar
      from public.community_saved_posts s
      join public.community_posts po on po.id = s.post_id
      join public.community_groups g on g.id = po.group_id
      left join public.community_memberships m on m.group_id = po.group_id and m.profile_id = po.author_profile_id
     where s.profile_id = v_uid
       and (p_before is null or s.saved_at < p_before)
       and (po.state = 'visible' or (po.author_profile_id = v_uid and po.state in ('held', 'auto_hidden')))
       and private.community_reader_ok(po.group_id, v_uid)
       and not exists (select 1 from public.community_hidden_authors h where h.viewer_id = v_uid and h.author_id = po.author_profile_id and h.group_id = po.group_id)
     order by s.saved_at desc
     limit v_limit + 1)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'group_slug', x.group_slug, 'group_name', x.group_name,
           'author_handle', x.author_handle, 'author_avatar', x.author_avatar, 'is_mine', coalesce(x.author_profile_id = v_uid, false),
           'body', x.body, 'created_at', x.created_at, 'saved_at', x.saved_at,
           'reply_count', (select count(*) from public.community_posts r where r.parent_post_id = x.id and r.state = 'visible'),
           'pending_review', (x.state <> 'visible')) order by x.saved_at desc), '[]'::jsonb),
         (count(*) > v_limit)
    into v_posts, v_more
    from (select * from readable order by saved_at desc limit v_limit + 1) x
;
  -- jsonb_agg above saw up to v_limit + 1 rows; trim the extra one (it only answers "is there more").
  if v_more then v_posts := v_posts - v_limit; end if;
  return jsonb_build_object('ok', true, 'posts', v_posts, 'has_more', coalesce(v_more, false));
end $$;

-- ---------------------------------------------------------------------------
-- The feed, with an order and i_saved
-- ---------------------------------------------------------------------------
drop function public.community_feed(uuid, timestamptz, integer);

create function public.community_feed(p_group_id uuid, p_before timestamptz default null, p_limit integer default null, p_sort text default 'latest')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_limit integer;
  v_posts jsonb;
  v_more boolean;
  v_sort text := coalesce(p_sort, 'latest');
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if v_sort not in ('latest', 'discussed') then return jsonb_build_object('ok', false, 'reason', 'bad_sort'); end if;
  if not private.community_reader_ok(p_group_id, v_uid) then return jsonb_build_object('ok', false, 'reason', 'not_a_member'); end if;
  v_limit := least(greatest(coalesce(p_limit, private.community_cfg_int('feed_page_size')), 1), private.community_cfg_int('max_page_size'));
  with candidates as (
    select po.*, m.avatar_code as author_avatar,
           -- counted for every candidate only when it decides the order; 'latest' counts the page rows below
           case when v_sort = 'discussed'
                then (select count(*) from public.community_posts r where r.parent_post_id = po.id and r.state = 'visible') end as visible_replies
      from public.community_posts po
      left join public.community_memberships m on m.group_id = po.group_id and m.profile_id = po.author_profile_id
     where po.group_id = p_group_id and po.parent_post_id is null
       and (po.state = 'visible' or (po.author_profile_id = v_uid and po.state in ('held', 'auto_hidden')))
       and not exists (select 1 from public.community_hidden_authors h where h.viewer_id = v_uid and h.author_id = po.author_profile_id and h.group_id = po.group_id)
       -- 'latest' pages by time; 'discussed' looks at the last 30 days only (one page, no cursor), so an old thread cannot sit on top forever.
       and (v_sort = 'discussed' or p_before is null or po.created_at < p_before)
       and (v_sort = 'latest' or (po.state = 'visible' and po.created_at > now() - interval '30 days'))),
  page as (
    select * from candidates
     order by case when v_sort = 'discussed' then visible_replies end desc nulls last, created_at desc
     limit v_limit + 1)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'author_handle', x.author_handle, 'author_avatar', x.author_avatar, 'is_mine', coalesce(x.author_profile_id = v_uid, false),
           'body', x.body, 'created_at', x.created_at, 'edited_at', x.edited_at, 'support_count', x.support_count,
           'reply_count', coalesce(x.visible_replies, (select count(*) from public.community_posts r where r.parent_post_id = x.id and r.state = 'visible')),
           'i_supported', exists (select 1 from public.community_reactions rx where rx.post_id = x.id and rx.profile_id = v_uid),
           'i_saved', exists (select 1 from public.community_saved_posts sv where sv.post_id = x.id and sv.profile_id = v_uid),
           'image', (select jsonb_build_object('id', i.id, 'width', i.width, 'height', i.height) from public.community_post_images i where i.post_id = x.id and i.deleted_at is null),
           'qa_session_id', x.qa_session_id,
           'answers', coalesce((select jsonb_agg(jsonb_build_object('id', an.id, 'doctor_name', an.doctor_name, 'body', an.body, 'created_at', an.created_at) order by an.created_at)
                                 from public.community_qa_answers an where an.question_post_id = x.id and an.removed_at is null), '[]'::jsonb),
           'pending_review', (x.state <> 'visible'))
           order by case when v_sort = 'discussed' then x.visible_replies end desc nulls last, x.created_at desc), '[]'::jsonb),
         -- has_more: is there a row beyond this page? Only 'latest' pages; 'discussed' is one page by design.
         (v_sort = 'latest' and (select count(*) from page) > v_limit)
    into v_posts, v_more
    from (select * from page order by case when v_sort = 'discussed' then visible_replies end desc nulls last, created_at desc limit v_limit) x;
  return jsonb_build_object('ok', true, 'posts', v_posts, 'has_more', v_more);
end $$;

-- ---------------------------------------------------------------------------
-- Access: members call these through their own session; nobody else.
-- anon inherits EXECUTE through PUBLIC, so it is revoked from PUBLIC (CLAUDE.md, the anon-execute lesson).
-- ---------------------------------------------------------------------------
revoke all on function public.community_set_saved(uuid, boolean) from public, anon;
revoke all on function public.community_saved_list(timestamptz) from public, anon;
revoke all on function public.community_feed(uuid, timestamptz, integer, text) from public, anon;
grant execute on function public.community_set_saved(uuid, boolean) to authenticated;
grant execute on function public.community_saved_list(timestamptz) to authenticated;
grant execute on function public.community_feed(uuid, timestamptz, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.community_saved_posts'::regclass) then
    raise exception 'community_saved_posts: RLS is off';
  end if;
  if has_table_privilege('anon', 'public.community_saved_posts', 'SELECT')
     or has_table_privilege('authenticated', 'public.community_saved_posts', 'SELECT')
     or has_table_privilege('authenticated', 'public.community_saved_posts', 'INSERT')
     or has_table_privilege('authenticated', 'public.community_saved_posts', 'DELETE') then
    raise exception 'community_saved_posts is reachable by a client role';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'community_saved_posts') then
    raise exception 'community_saved_posts has a policy, but community tables are RPC-only';
  end if;
  if has_function_privilege('anon', 'public.community_set_saved(uuid, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.community_saved_list(timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.community_feed(uuid, timestamptz, integer, text)', 'EXECUTE') then
    raise exception 'a community saved/feed function is callable by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.community_feed(uuid, timestamptz, integer, text)', 'EXECUTE') then
    raise exception 'community_feed is not callable by members';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'community_feed') <> 1 then
    raise exception 'community_feed must have exactly one signature';
  end if;
end $$;
