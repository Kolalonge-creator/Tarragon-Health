-- Community live polish (founder instruction in chat, 2026-11-03: "ensure the group is live, remove the red tape that might make it
-- break, it can still be moderated without too much red tape").
--
-- Live rehearsal on 2026-11-03 (two test accounts, Dr Isaac's moderator and safety reviewer grants) showed the whole path works:
-- list, join, post, hold, approve, reply, support, report, contact block, self-harm and emergency withhold, safety decision, edit,
-- search, delete, appeal, leave. Two things were wrong for a live service:
--
--   1. Nobody is told when something arrives. A self-harm or emergency post wrote a safety signal and nothing else; a held post
--      and a member's report sat silently in the queue. The only staff notice was the overdue check, 30 to 60 minutes later, in the
--      in-app inbox alone. docs/COMMUNITY_SPEC.md section 4.4 says the safety reviewer is PAGED on the signal.
--      -> private.community_alert_staff(): a safety signal pages every safety reviewer and the Chief Medical Officer at once on
--         push, email and the inbox (priority critical, never gated, never throttled); a held post or a report tells the group's
--         moderators on push and the inbox, at most once per ten minutes each. Fixed wording, no excerpt, no handle, no group.
--
--   2. Every new member's first post waited for a moderator (new_member_premoderated_posts = 1). With one named moderator and no
--      rota, a first post could wait hours, and the member's first experience of the group was silence. The text filters already
--      block contact details and hold selling, cure claims, medicine instructions, abuse and spam; the safety rules withhold crisis
--      language; three reports hide a post. Pre-moderation of ordinary first posts is the one gate that depends on a person being
--      awake, so it is the one removed.
--      -> community_config version 2: new_member_premoderated_posts 0, everything else as version 1. Versions are append only, so
--         version 1 stays and is simply no longer active. Raising it again is a new version (decision COM-27).
--
-- Also: the overdue notice now carries which console area the reader works in, so a care coordinator and a clinician each get a
-- link they can open (the fixed in-app copy was pointing every reader at the coordinator page).
--
-- Bodies of community_submit_core, community_mod_decide, community_report_post and community_notify are the live definitions read
-- with pg_get_functiondef on 2026-11-03, with only the alert calls added.

begin;

-- 1. Staff alerts -------------------------------------------------------------------------------------------------------------------------

create or replace function private.community_staff_area(p_profile uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p.role when 'clinician' then 'clinician' when 'care_coordinator' then 'coordinator' else 'admin' end
    from public.profiles p where p.id = p_profile
$$;

revoke all on function private.community_staff_area(uuid) from public, anon, authenticated, service_role;

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
      join public.profiles p on p.id = x.profile_id and p.is_active and p.role in ('admin', 'care_coordinator', 'clinician')
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

revoke all on function private.community_alert_staff(text, uuid) from public, anon, authenticated, service_role;

-- the overdue notice carries the reader's console area (no post, group or handle, as before)
create or replace function private.community_notify(p_recipient uuid, p_template text, p_source uuid, p_source_table text default 'community_posts')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_recipient is null then return; end if;
  -- Chatty notices (a reply, the digest, an overdue reminder) are throttled to one unread per ten minutes. A notice about a distinct
  -- decision (an appeal result, a removal, a sanction, an answer) is never merged with another: each is a one-off event.
  if p_template in ('community_reply', 'community_digest', 'community_overdue') and exists (
    select 1 from public.notifications n
     where n.recipient_id = p_recipient and n.template = p_template and n.opened_at is null
       and n.created_at > now() - interval '10 minutes') then
    return;
  end if;
  -- The notice never records WHICH post or appeal it is about (source_id and source_table stay empty): a row that said so would let anyone
  -- who can read the table link a made-up name to the account that received the notice. p_source and p_source_table are kept so callers
  -- need not change; they are deliberately not stored. A staff notice carries only which console area the reader works in.
  insert into public.notifications (organisation_id, recipient_id, channel, template, payload, content_class)
  select p.organisation_id, p.id, 'in_app', p_template,
         case when p_template = 'community_overdue' then jsonb_build_object('area', private.community_staff_area(p.id)) else '{}'::jsonb end,
         'non_clinical'
    from public.profiles p where p.id = p_recipient and p.is_active;
end $$;

-- 2. The submit path pages on a safety signal and tells moderators about a held post ------------------------------------------------------

create or replace function private.community_submit_core(p_group_id uuid, p_parent_id uuid, p_body text, p_client_request_id uuid, p_image jsonb, p_qa_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  if v_gate ->> 'status' <> 'ok' then
    -- A member who is muted or suspended can still be in crisis: their words are read, and only if they suggest an emergency or
    -- self-harm do they go on to the safety path. Anything else is refused as before.
    if v_gate ->> 'reason' in ('muted', 'suspended')
       and private.community_scan(btrim(coalesce(p_body, ''))) ->> 'decision' = 'safety' then
      v_gate := jsonb_build_object('status', 'ok', 'approved_post_count', 0);
    else
      return v_gate;
    end if;
  end if;

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
    -- the file must really be there, in the caller's own folder
    if not private.community_storage_has(p_image ->> 'path') then return jsonb_build_object('status', 'refused', 'reason', 'bad_image'); end if;
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

  -- The words are read BEFORE the cool-down and the rate limits, because a person in crisis must never be turned away with "slow down":
  -- words that suggest an emergency or self-harm always reach the safety path (the card, the withheld post, the reviewers).
  v_scan := private.community_scan(v_body);
  if v_scan ->> 'decision' = 'unavailable' then return jsonb_build_object('status', 'refused', 'reason', 'not_ready'); end if;

  if v_scan ->> 'decision' <> 'safety' then
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
  end if;
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
    -- the safety reviewers and the Chief Medical Officer are paged now, not when the overdue check next runs
    perform private.community_alert_staff('safety', p_group_id);
    return jsonb_build_object('status', 'withheld', 'safety_kind', v_class, 'post_id', v_post_id);
  elsif v_action = 'hold' then
    perform private.community_log_event(p_group_id, v_post_id, v_uid, 'held', v_uid, v_class, v_scan -> 'hits');
    perform private.community_alert_staff('queue', p_group_id);
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

-- 3. A moderator's hand-off to a safety reviewer pages the reviewers -----------------------------------------------------------------------

create or replace function public.community_mod_decide(p_post_id uuid, p_decision text, p_reason_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  -- A moderator never approves their own post; another moderator does.
  if p_decision = 'approve' and po.author_profile_id = v_uid then return jsonb_build_object('status', 'refused', 'reason', 'own_post'); end if;

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
      perform private.community_alert_staff('safety', po.group_id);
    end if;
    perform private.community_log_event(po.group_id, po.id, po.author_profile_id, 'sent_to_safety', v_uid, 'moderator_concern', '[]'::jsonb);
    return jsonb_build_object('status', 'sent_to_safety');
  end if;
  return jsonb_build_object('status', 'refused', 'reason', 'bad_decision');
end $$;

-- 4. A member's report tells the moderators; a danger report pages the reviewers ----------------------------------------------------------

create or replace function public.community_report_post(p_post_id uuid, p_reason_code text, p_detail text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  po public.community_posts;
  v_n integer;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  -- locked, so two people reacting or reporting at once cannot each read a stale count
  select * into po from public.community_posts where id = p_post_id for update;
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
    perform private.community_alert_staff('safety', po.group_id);
  end if;
  perform private.community_alert_staff('queue', po.group_id);
  return jsonb_build_object('status', 'reported');
end $$;

-- 5. Configuration version 2: ordinary first posts publish at once -------------------------------------------------------------------------

update public.community_config set is_active = false where is_active;
-- community-rules-v2-begin (mirrored by packages/shared/src/proposed-config, community-mirror.test.ts; identical to version 1 except new_member_premoderated_posts)
insert into public.community_config (version, is_active, params) values (2, true, $json$
{
  "post_max_chars": 2000,
  "edit_window_minutes": 15,
  "new_member_premoderated_posts": 0,
  "appeal_window_days": 14,
  "quality_sample_pct": 10,
  "image_max_bytes": 4194304,
  "qa_questions_per_member": 3,
  "qa_answer_grace_minutes": 60,
  "overdue_safety_minutes": 30,
  "overdue_queue_minutes": 60,
  "rate_posts_per_hour": 6,
  "rate_posts_per_day": 30,
  "block_cooldown": {"max_blocks": 3, "window_minutes": 10, "cooldown_minutes": 60},
  "auto_hide_report_threshold": 3,
  "removed_body_retention_days": 90,
  "unmask": {"min_reason_chars": 20, "max_per_day": 5, "signal_window_days": 30},
  "consent_version": "v1-2026-10-12-founder-cmo",
  "feed_page_size": 20,
  "max_page_size": 50,
  "welcome_days": 14,
  "return_nudge_days": 3,
  "avatars": ["leaf", "sun", "river", "hill", "star", "seed", "cloud", "stone", "wave", "bird"],
  "handle_words": {
    "adjectives": ["calm", "brave", "bright", "gentle", "steady", "kind", "warm", "quiet", "bold", "clever", "cheerful", "patient", "sunny", "swift", "wise", "lively", "hopeful", "honest", "mellow", "sturdy", "tender", "vivid", "witty", "zesty", "noble", "merry", "serene", "spry", "plucky", "radiant"],
    "nouns": ["river", "hill", "leaf", "sparrow", "baobab", "palm", "harbour", "lantern", "meadow", "pebble", "breeze", "cedar", "comet", "dune", "ember", "falcon", "garden", "heron", "island", "jasmine", "kestrel", "lagoon", "maple", "orchid", "plateau", "quartz", "reed", "savanna", "thistle", "willow"]
  }
}
$json$::jsonb);
-- community-rules-v2-end

do $$
begin
  if (select count(*) from public.community_config where is_active) <> 1 then raise exception 'exactly one community config must be active'; end if;
  if private.community_cfg_int('new_member_premoderated_posts') <> 0 then raise exception 'config v2 not active'; end if;
  if (select params - 'new_member_premoderated_posts' from public.community_config where version = 2)
     is distinct from (select params - 'new_member_premoderated_posts' from public.community_config where version = 1) then
    raise exception 'config v2 must differ from v1 only in new_member_premoderated_posts';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'community_alert_staff') then
    raise exception 'community_alert_staff missing';
  end if;
end $$;

commit;
