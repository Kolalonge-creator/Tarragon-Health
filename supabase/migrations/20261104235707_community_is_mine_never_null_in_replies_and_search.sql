-- Community: is_mine is always true or false, never null, in replies and post search.
--
-- An erased member's posts keep their text but lose author_profile_id (null). `author_profile_id = v_uid` is then NULL, not false, so
-- community_replies and community_search_posts sent `"is_mine": null`. The feed and the saved list already coalesce this
-- (20261104165453). Effect before this fix: the web treated the post as "not mine" by accident, but the phone app's strict parser
-- (`is_mine: boolean`) rejected the WHOLE reply list or search result, so one erased author blanked a thread or a search on mobile.
--
-- Both bodies are rebuilt from their live definitions (pg_get_functiondef, 2026-11-04); the only change is the coalesce. Same
-- signatures, so CREATE OR REPLACE keeps the existing grants (authenticated only; anon has none, checked below).

create or replace function public.community_replies(p_post_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_group uuid;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select group_id into v_group from public.community_posts where id = p_post_id and state = 'visible';
  if v_group is null or not private.community_reader_ok(v_group, v_uid) then return jsonb_build_object('ok', false, 'reason', 'not_a_member'); end if;
  return jsonb_build_object('ok', true, 'replies', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'author_handle', r.author_handle, 'author_avatar', m.avatar_code, 'is_mine', coalesce(r.author_profile_id = v_uid, false),
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
end $function$;

create or replace function public.community_search_posts(p_query text, p_group_id uuid default null::uuid, p_before timestamp with time zone default null::timestamp with time zone)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
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
           'author_handle', x.author_handle, 'author_avatar', x.avatar_code, 'is_mine', coalesce(x.author_profile_id = v_uid, false),
           'body', left(x.body, 600), 'created_at', x.created_at, 'is_reply', (x.parent_post_id is not null)) order by x.created_at desc), '[]'::jsonb),
         (select count(*) from hits) > 20
    into v_items, v_more
    from (select * from hits order by created_at desc limit 20) x;
  return jsonb_build_object('ok', true, 'items', v_items, 'has_more', v_more);
end $function$;

revoke all on function public.community_replies(uuid) from public, anon;
revoke all on function public.community_search_posts(text, uuid, timestamptz) from public, anon;
grant execute on function public.community_replies(uuid) to authenticated;
grant execute on function public.community_search_posts(text, uuid, timestamptz) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.community_replies(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.community_search_posts(text, uuid, timestamptz)', 'EXECUTE') then
    raise exception 'community is_mine fix: anon can execute a community read';
  end if;
  if position('coalesce(r.author_profile_id = v_uid, false)' in pg_get_functiondef('public.community_replies(uuid)'::regprocedure)) = 0
     or position('coalesce(x.author_profile_id = v_uid, false)' in pg_get_functiondef('public.community_search_posts(text, uuid, timestamptz)'::regprocedure)) = 0 then
    raise exception 'community is_mine fix: coalesce missing';
  end if;
end $$;
