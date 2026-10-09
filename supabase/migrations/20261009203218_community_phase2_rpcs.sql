-- Community Phase 2: member controls (hide one author, digest, search), group prompts and size cap, moderator roster, appeals,
-- second-moderator quality sampling. docs/COMMUNITY_SPEC.md section 13. The tables are in the schema migration; this holds the RPCs.
-- Everything is RPC-only like the rest of Community. The feature stays dormant behind the `community` go-live guard.

-- ---------------------------------------------------------------------------
-- 1. Private helper: pick a share of moderator decisions for a second look
-- ---------------------------------------------------------------------------
create or replace function private.community_maybe_sample(p_post uuid, p_group uuid, p_decision text, p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if random() * 100 < private.community_cfg_int('quality_sample_pct') then
    insert into public.community_mod_samples (post_id, group_id, decision, decided_by) values (p_post, p_group, p_decision, p_actor);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Members: hide one author, digest, search
-- ---------------------------------------------------------------------------
create or replace function public.community_hide_author(p_post_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  po public.community_posts;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into po from public.community_posts where id = p_post_id;
  if not found or po.state <> 'visible' or not private.community_reader_ok(po.group_id, v_uid) then
    return jsonb_build_object('status', 'refused', 'reason', 'not_available');
  end if;
  if po.author_profile_id is null or po.author_profile_id = v_uid then return jsonb_build_object('status', 'refused', 'reason', 'own_post'); end if;
  if (select count(*) from public.community_hidden_authors where viewer_id = v_uid) >= 200 then
    return jsonb_build_object('status', 'refused', 'reason', 'too_many');
  end if;
  insert into public.community_hidden_authors (viewer_id, author_id, group_id, handle)
  values (v_uid, po.author_profile_id, po.group_id, po.author_handle)
  on conflict (viewer_id, author_id, group_id) do nothing;
  return jsonb_build_object('status', 'hidden');
end $$;

create or replace function public.community_unhide_author(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  delete from public.community_hidden_authors where id = p_id and viewer_id = v_uid;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'not_found'); end if;
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.community_hidden_authors(p_group_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.community_reader_ok(p_group_id, v_uid) then return jsonb_build_object('ok', false, 'reason', 'not_a_member'); end if;
  return jsonb_build_object('ok', true, 'hidden', coalesce((
    select jsonb_agg(jsonb_build_object('id', h.id, 'handle', h.handle) order by h.created_at)
      from public.community_hidden_authors h where h.viewer_id = v_uid and h.group_id = p_group_id), '[]'::jsonb));
end $$;

create or replace function public.community_set_digest(p_group_id uuid, p_on boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  update public.community_memberships set digest_opt_in = coalesce(p_on, false)
   where group_id = p_group_id and profile_id = v_uid and status = 'active';
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'not_a_member'); end if;
  return jsonb_build_object('status', 'ok', 'digest_opt_in', coalesce(p_on, false));
end $$;

-- Search is over group names, descriptions and topics only. There is no search of posts: a post archive is a record of who said what.
create or replace function public.community_search_groups(p_q text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
  v_q text := lower(btrim(coalesce(p_q, '')));
  v_like text;
begin
  v := public.community_list_groups();
  if length(v_q) < 2 or length(v_q) > 60 or (v ->> 'open')::boolean is not true or (v ->> 'adult')::boolean is not true then return v; end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return jsonb_set(v, '{groups}', coalesce((
    select jsonb_agg(x) from jsonb_array_elements(v -> 'groups') x
     where lower(x ->> 'name') like v_like escape '\' or lower(x ->> 'description') like v_like escape '\' or lower(x ->> 'topic_label') like v_like escape '\'), '[]'::jsonb));
end $$;

-- One quiet in-app notice per week to members who opted in, only when something new was posted. Fixed text, no group name (INV-07).
-- Run on a schedule by an operator (service role), like the purge. Never required for anything to work.
create or replace function public.community_send_digests() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select distinct m.profile_id
      from public.community_memberships m
      join public.community_groups g on g.id = m.group_id and g.status = 'active'
     where m.digest_opt_in and m.status = 'active' and not m.notifications_muted
       and exists (select 1 from public.community_posts p
                    where p.group_id = m.group_id and p.state = 'visible' and p.created_at > now() - interval '7 days'
                      and p.author_profile_id is distinct from m.profile_id)
  loop
    continue when not private.go_live_open_patient('community', r.profile_id) or not private.community_adult(r.profile_id);
    continue when exists (select 1 from public.notifications n where n.recipient_id = r.profile_id and n.template = 'community_digest' and n.created_at > now() - interval '6 days');
    perform private.community_notify(r.profile_id, 'community_digest', r.profile_id, 'profiles');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Staff: roster name, group size cap, group prompts
-- ---------------------------------------------------------------------------
-- The staff member chooses what members see ("Ada, community moderator"). Nothing shows until they choose it.
create or replace function public.community_set_my_display_name(p_name text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not exists (select 1 from public.community_staff where profile_id = v_uid and revoked_at is null) then
    raise exception 'community staff only' using errcode = '42501';
  end if;
  if v_name is not null and v_name !~ '^[A-Za-z][A-Za-z ,.''-]{1,39}$' then
    return jsonb_build_object('status', 'refused', 'reason', 'bad_name');
  end if;
  update public.community_staff set display_name = v_name where profile_id = v_uid and revoked_at is null;
  return jsonb_build_object('status', 'ok', 'display_name', v_name);
end $$;

create or replace function public.community_admin_set_group_cap(p_id uuid, p_cap integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  if p_cap is not null and p_cap not between 10 and 100000 then return jsonb_build_object('status', 'refused', 'reason', 'bad_cap'); end if;
  update public.community_groups set member_cap = p_cap where id = p_id;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'no_such_group'); end if;
  return jsonb_build_object('status', 'ok', 'member_cap', p_cap);
end $$;

create or replace function private.community_can_prompt(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.community_can_configure() or private.community_is_moderator(p_group)
$$;

create or replace function public.community_admin_save_prompt(p_group_id uuid, p_body text, p_show_from timestamptz default null, p_show_until timestamptz default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_scan jsonb;
  v_id uuid;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.community_can_prompt(p_group_id) then raise exception 'admins, the Chief Medical Officer and moderators of this group only' using errcode = '42501'; end if;
  if length(v_body) not between 5 and 300 then return jsonb_build_object('status', 'refused', 'reason', 'bad_length'); end if;
  if not exists (select 1 from public.community_groups where id = p_group_id and status <> 'archived') then return jsonb_build_object('status', 'refused', 'reason', 'no_such_group'); end if;
  -- the same filters as a member's post: no phone number, email or outside link, even from staff
  v_scan := private.community_scan(v_body);
  if v_scan ->> 'decision' = 'unavailable' then return jsonb_build_object('status', 'refused', 'reason', 'not_ready'); end if;
  if v_scan ->> 'decision' in ('block', 'safety') then return jsonb_build_object('status', 'refused', 'reason', 'text_not_allowed'); end if;
  if p_show_until is not null and p_show_until <= coalesce(p_show_from, now()) then return jsonb_build_object('status', 'refused', 'reason', 'bad_window'); end if;
  insert into public.community_group_prompts (group_id, body, show_from, show_until, created_by)
  values (p_group_id, v_body, coalesce(p_show_from, now()), p_show_until, v_uid) returning id into v_id;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

create or replace function public.community_admin_prompts(p_group_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.community_can_prompt(p_group_id) then raise exception 'admins, the Chief Medical Officer and moderators of this group only' using errcode = '42501'; end if;
  return jsonb_build_object('prompts', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'body', p.body, 'show_from', p.show_from, 'show_until', p.show_until,
                                        'showing', (p.show_from <= now() and (p.show_until is null or p.show_until > now()))) order by p.show_from desc)
      from public.community_group_prompts p where p.group_id = p_group_id and (p.show_until is null or p.show_until > now() - interval '30 days')), '[]'::jsonb));
end $$;

create or replace function public.community_admin_end_prompt(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.community_group_prompts;
begin
  if (select auth.uid()) is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into p from public.community_group_prompts where id = p_id;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'not_found'); end if;
  if not private.community_can_prompt(p.group_id) then raise exception 'admins, the Chief Medical Officer and moderators of this group only' using errcode = '42501'; end if;
  -- a prompt that has barely started (or not started) is simply removed; a running one is ended now
  if p.show_from > now() - interval '1 minute' then
    delete from public.community_group_prompts where id = p_id;
  else
    update public.community_group_prompts set show_until = now() where id = p_id and (show_until is null or show_until > now());
  end if;
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Appeals
-- ---------------------------------------------------------------------------
create or replace function public.community_my_actions() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_days integer := private.community_cfg_int('appeal_window_days');
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.go_live_open_patient('community', v_uid) or not private.community_adult(v_uid) then
    return jsonb_build_object('open', false, 'removed_posts', '[]'::jsonb, 'sanctions', '[]'::jsonb);
  end if;
  return jsonb_build_object('open', true,
    'removed_posts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'post_id', po.id, 'group_name', g.name, 'removed_at', po.removed_at, 'reason_code', po.removed_reason_code,
               'appeal_status', (select a.status from public.community_appeals a where a.post_id = po.id order by a.created_at desc limit 1),
               'can_appeal', not exists (select 1 from public.community_appeals a where a.post_id = po.id)) order by po.removed_at desc)
        from public.community_posts po join public.community_groups g on g.id = po.group_id
       where po.author_profile_id = v_uid and po.state = 'removed' and po.removed_by is not null
         and po.removed_at > now() - make_interval(days => v_days)
         and not exists (select 1 from unnest(po.hold_reason_codes) c where c like 'safety:%')), '[]'::jsonb),
    'sanctions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sanction_id', s.id, 'kind', s.kind, 'group_name', g.name, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'reason_code', s.reason_code,
               'overturned', (s.appeal_state = 'overturned'),
               'appeal_status', (select a.status from public.community_appeals a where a.sanction_id = s.id order by a.created_at desc limit 1),
               'can_appeal', not exists (select 1 from public.community_appeals a where a.sanction_id = s.id)) order by s.created_at desc)
        from public.community_sanctions s left join public.community_groups g on g.id = s.group_id
       where s.profile_id = v_uid and s.created_at > now() - make_interval(days => v_days)), '[]'::jsonb));
end $$;

create or replace function public.community_appeal(p_kind text, p_target_id uuid, p_reason text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_days integer := private.community_cfg_int('appeal_window_days');
  v_reason text := btrim(coalesce(p_reason, ''));
  po public.community_posts;
  s public.community_sanctions;
  v_id uuid;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.go_live_open_patient('community', v_uid) or not private.community_adult(v_uid) then return jsonb_build_object('status', 'refused', 'reason', 'not_open_yet'); end if;
  if length(v_reason) not between 10 and 1000 then return jsonb_build_object('status', 'refused', 'reason', 'reason_length'); end if;
  if p_kind = 'removal' then
    select * into po from public.community_posts where id = p_target_id;
    if not found or po.author_profile_id is distinct from v_uid or po.state <> 'removed' or po.removed_by is null
       or po.removed_at < now() - make_interval(days => v_days)
       or exists (select 1 from unnest(po.hold_reason_codes) c where c like 'safety:%') then
      return jsonb_build_object('status', 'refused', 'reason', 'not_appealable');
    end if;
    if exists (select 1 from public.community_appeals a where a.post_id = po.id) then return jsonb_build_object('status', 'refused', 'reason', 'already_appealed'); end if;
    insert into public.community_appeals (profile_id, kind, post_id, group_id, reason) values (v_uid, 'removal', po.id, po.group_id, v_reason) returning id into v_id;
    perform private.community_log_event(po.group_id, po.id, v_uid, 'appeal_opened', v_uid, 'removal', '[]'::jsonb);
  elsif p_kind = 'sanction' then
    select * into s from public.community_sanctions where id = p_target_id;
    if not found or s.profile_id <> v_uid or s.created_at < now() - make_interval(days => v_days) then
      return jsonb_build_object('status', 'refused', 'reason', 'not_appealable');
    end if;
    if exists (select 1 from public.community_appeals a where a.sanction_id = s.id) then return jsonb_build_object('status', 'refused', 'reason', 'already_appealed'); end if;
    insert into public.community_appeals (profile_id, kind, sanction_id, group_id, reason) values (v_uid, 'sanction', s.id, s.group_id, v_reason) returning id into v_id;
    update public.community_sanctions set appeal_state = 'requested' where id = s.id;
    perform private.community_log_event(s.group_id, s.id, v_uid, 'appeal_opened', v_uid, 'sanction', '[]'::jsonb);
  else
    return jsonb_build_object('status', 'refused', 'reason', 'bad_kind');
  end if;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

-- Appeals a moderator may decide: of their groups, and never one against their own decision. No member identity is returned.
create or replace function public.community_appeal_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.community_is_moderator() then raise exception 'community moderators only' using errcode = '42501'; end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'appeal_id', a.id, 'kind', a.kind, 'group_name', g.name, 'created_at', a.created_at, 'member_says', a.reason,
             'original_reason_code', coalesce(po.removed_reason_code, s.reason_code), 'sanction_kind', s.kind,
             'author_handle', po.author_handle, 'body', case when po.body = '[removed]' then null else po.body end) order by a.created_at)
      from public.community_appeals a
      join public.community_groups g on g.id = a.group_id
      left join public.community_posts po on po.id = a.post_id
      left join public.community_sanctions s on s.id = a.sanction_id
     where a.status = 'open' and private.community_is_moderator(a.group_id)
       and coalesce(po.removed_by, s.issued_by) is distinct from v_uid), '[]'::jsonb));
end $$;

create or replace function public.community_appeal_decide(p_id uuid, p_decision text, p_note text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  a public.community_appeals;
  po public.community_posts;
  s public.community_sanctions;
  v_status text;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into a from public.community_appeals where id = p_id for update;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'not_found'); end if;
  if not private.community_is_moderator(a.group_id) then raise exception 'community moderators only' using errcode = '42501'; end if;
  if a.status <> 'open' then return jsonb_build_object('status', 'refused', 'reason', 'already_decided'); end if;
  if p_decision not in ('uphold', 'overturn') then return jsonb_build_object('status', 'refused', 'reason', 'bad_decision'); end if;
  if length(coalesce(p_note, '')) > 500 then return jsonb_build_object('status', 'refused', 'reason', 'note_too_long'); end if;
  select * into po from public.community_posts where id = a.post_id;
  select * into s from public.community_sanctions where id = a.sanction_id;
  if coalesce(po.removed_by, s.issued_by) is not distinct from v_uid then
    return jsonb_build_object('status', 'refused', 'reason', 'not_your_appeal_to_decide');
  end if;
  v_status := case p_decision when 'overturn' then 'overturned' else 'upheld' end;
  if v_status = 'overturned' then
    if a.post_id is not null and po.state = 'removed' then
      perform set_config('community.restore_on_appeal', 'on', true);
      update public.community_posts set state = 'visible', removed_at = null, removed_by = null, removed_reason_code = null where id = po.id;
      perform set_config('community.restore_on_appeal', 'off', true);
    end if;
  end if;
  if a.sanction_id is not null then
    update public.community_sanctions set appeal_state = v_status where id = a.sanction_id;
  end if;
  update public.community_appeals set status = v_status, decided_by = v_uid, decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '') where id = a.id;
  perform private.community_log_event(a.group_id, coalesce(a.post_id, a.sanction_id), a.profile_id, 'appeal_' || v_status, v_uid, a.kind, '[]'::jsonb);
  perform private.community_notify(a.profile_id, 'community_appeal_result', a.id, 'community_appeals');
  return jsonb_build_object('status', v_status);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Quality sampling: a second moderator re-checks a share of decisions
-- ---------------------------------------------------------------------------
create or replace function public.community_sample_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.community_is_moderator() then raise exception 'community moderators only' using errcode = '42501'; end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'sample_id', x.id, 'decision', x.decision, 'group_name', x.group_name, 'author_handle', x.author_handle,
             'body', x.body, 'reason_code', x.removed_reason_code, 'created_at', x.created_at) order by x.created_at)
      from (select sm.id, sm.decision, g.name as group_name, po.author_handle, case when po.body = '[removed]' then null else po.body end as body,
                   po.removed_reason_code, sm.created_at
              from public.community_mod_samples sm
              join public.community_groups g on g.id = sm.group_id
              left join public.community_posts po on po.id = sm.post_id
             where sm.reviewed_at is null and sm.decided_by is distinct from v_uid and private.community_is_moderator(sm.group_id)
               and (po.id is null or not exists (select 1 from unnest(po.hold_reason_codes) c where c like 'safety:%'))
             order by sm.created_at limit 20) x), '[]'::jsonb));
end $$;

create or replace function public.community_sample_review(p_id uuid, p_agrees boolean, p_note text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  sm public.community_mod_samples;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into sm from public.community_mod_samples where id = p_id for update;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'not_found'); end if;
  if not private.community_is_moderator(sm.group_id) then raise exception 'community moderators only' using errcode = '42501'; end if;
  if sm.reviewed_at is not null then return jsonb_build_object('status', 'refused', 'reason', 'already_reviewed'); end if;
  if sm.decided_by is not distinct from v_uid then return jsonb_build_object('status', 'refused', 'reason', 'your_own_decision'); end if;
  if p_agrees is null then return jsonb_build_object('status', 'refused', 'reason', 'choose_one'); end if;
  if length(coalesce(p_note, '')) > 500 then return jsonb_build_object('status', 'refused', 'reason', 'note_too_long'); end if;
  update public.community_mod_samples set reviewed_by = v_uid, reviewed_at = now(), agrees = p_agrees, note = nullif(btrim(coalesce(p_note, '')), '') where id = sm.id;
  perform private.community_log_event(sm.group_id, sm.post_id, null, 'sample_reviewed', v_uid, case when p_agrees then 'agree' else 'disagree' end, '[]'::jsonb);
  return jsonb_build_object('status', 'ok', 'agrees', p_agrees);
end $$;

-- For the CMO and admins: how the second look is going.
create or replace function public.community_quality_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'waiting', (select count(*) from public.community_mod_samples where reviewed_at is null),
    'reviewed_30d', (select count(*) from public.community_mod_samples where reviewed_at > now() - interval '30 days'),
    'disagreed_30d', (select count(*) from public.community_mod_samples where reviewed_at > now() - interval '30 days' and agrees is false),
    'appeals_open', (select count(*) from public.community_appeals where status = 'open'),
    'appeals_overturned_30d', (select count(*) from public.community_appeals where status = 'overturned' and decided_at > now() - interval '30 days'),
    'appeals_decided_30d', (select count(*) from public.community_appeals where status <> 'open' and decided_at > now() - interval '30 days'));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Privileges
-- ---------------------------------------------------------------------------
revoke all on function private.community_maybe_sample(uuid, uuid, text, uuid), private.community_can_prompt(uuid)
  from public, anon, authenticated, service_role;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'community_hide_author', 'community_unhide_author', 'community_hidden_authors', 'community_set_digest', 'community_search_groups',
       'community_send_digests', 'community_set_my_display_name', 'community_admin_set_group_cap', 'community_admin_save_prompt',
       'community_admin_prompts', 'community_admin_end_prompt', 'community_my_actions', 'community_appeal', 'community_appeal_queue',
       'community_appeal_decide', 'community_sample_queue', 'community_sample_review', 'community_quality_summary')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname = 'community_send_digests' then
      execute format('grant execute on function %s to service_role', r.sig);
    else
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;
