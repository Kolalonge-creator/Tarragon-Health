-- Community proof 3 of 3: posting, moderation and the safety hand-off (migrations *_community_member_rpcs.sql, *_community_staff_admin_rpcs.sql).
--
-- Proves, in one rolled-back transaction:
--   1. A new member is pre-moderated for the first three posts, then publishes; a retry with the same request id is one post.
--   2. A phone number is blocked and its text is in no table; repeated blocked attempts start a cool-down that refuses even clean
--      posts; other members are unaffected.
--   3. Selling, cure claims and medicine instructions are held for a person; a removal needs a reason, tells the author with a
--      fixed notice, and cannot be undone by the author or by a hand edit.
--   4. Three different reporters hide a post; the queue shows counts and reasons but never who reported; approving restores it.
--   5. SAFETY: emergency or self-harm language is withheld (not published), signalled, and visible only to the author and to a
--      safety reviewer, as a handle with no identity. Moderators never see it and cannot decide it. Nothing is sent to an
--      emergency contact or the care team from a post. Self-harm outranks emergency. A danger report raises a reviewer signal.
--      An edit is scanned like a new post.
--   6. Replies are one level deep; the notice is in-app, non-clinical, fixed, with an empty payload (INV-07), and is not repeated
--      within ten minutes or sent to a member who muted the group.
--   7. Deleting, leaving, and the retention purge (service role only); sanctions through a post (mute, ban, platform-wide for an
--      admin only) with no identity in the answer; the hourly limit; length limits.
--   8. The moderation log and config versions cannot be changed; pinned clinician content shows only once a second clinician has
--      reviewed it, with the reviewer's real name.
--   Sabotage: the scan is replaced by "allow everything"; pre-moderation is removed. The matching checks must flip.
--
--   psql -f packages/db/tests/community_posting_and_safety.sql   (against a database where the community migrations are applied)

begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.msg(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  -- clear the session claims too: a leftover sub makes auth.uid() non-null and the is_test guard then treats the owner as a person
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.act_service() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'com-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'COM ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  if not p_test then update public.profiles set is_test = false where id = v; end if;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'COM ' || p_label, 'MDCN', 'COM-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      true, p_admin, true, array['en'], 'General practice')
  returning id into v_staff;
  return v;
end $f$;

create function pg_temp.asj(p_uid uuid, p_sql text) returns jsonb language plpgsql as
$f$
declare v jsonb;
begin
  perform pg_temp.act(p_uid);
  begin
    execute p_sql into v;
  exception when others then
    perform pg_temp.back();
    return jsonb_build_object('error', sqlstate, 'message', sqlerrm);
  end;
  perform pg_temp.back();
  return v;
end $f$;

-- Ageing a post is something only an operator can do (the guard forbids it): disable the guard for one statement.
create function pg_temp.age_posts(p_where text) returns void language plpgsql as
$f$ begin
  alter table public.community_posts disable trigger community_posts_guard;
  execute 'update public.community_posts set created_at = now() - interval ''3 days'' where ' || p_where;
  alter table public.community_posts enable trigger community_posts_guard;
end $f$;

create function pg_temp.sub(p_uid uuid, p_group uuid, p_body text, p_parent uuid default null, p_req uuid default null) returns jsonb language sql as
$f$ select pg_temp.asj(p_uid, format('select public.community_submit_post(%L, %L, %L, %L)', p_group, p_parent, p_body, p_req)) $f$;

create function pg_temp.joined(p_uid uuid, p_group uuid) returns jsonb language sql as
$f$ select pg_temp.asj(p_uid, format('select public.community_join_group(%L, %s, true)', p_group, (select rules_version from public.community_groups where id = p_group))) $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_doc uuid; v_doc2 uuid; v_mod uuid; v_rev uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid; v_p5 uuid; v_p6 uuid; v_p7 uuid;
  v_g uuid; v_j jsonb; v_post uuid; v_post2 uuid; v_req uuid := gen_random_uuid(); v_n integer; v_sig uuid; v_pin uuid; v_slug text;
begin
  select id into v_org from public.organisations order by id limit 1;
  if v_org is null then insert into public.organisations (name) values ('community proof org') returning id into v_org; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_doc := pg_temp.mkdoc(v_org, v_admin, 'doc', 'senior_medical_officer');
  v_doc2 := pg_temp.mkdoc(v_org, v_admin, 'doc2', 'senior_medical_officer');
  v_mod := pg_temp.mkuser(v_org, 'mod', 'care_coordinator');
  v_rev := pg_temp.mkuser(v_org, 'rev', 'care_coordinator');
  v_p1 := pg_temp.mkuser(v_org, 'p1', 'patient'); v_p2 := pg_temp.mkuser(v_org, 'p2', 'patient'); v_p3 := pg_temp.mkuser(v_org, 'p3', 'patient');
  v_p4 := pg_temp.mkuser(v_org, 'p4', 'patient'); v_p5 := pg_temp.mkuser(v_org, 'p5', 'patient'); v_p6 := pg_temp.mkuser(v_org, 'p6', 'patient');
  v_p7 := pg_temp.mkuser(v_org, 'p7', 'patient');

  -- A live rule set that carries test safety rules (the CMO's act, as in production), a live group, a moderator and a reviewer
  update public.community_filter_rule_sets set status = 'retired' where status = 'active';
  perform pg_temp.asj(v_admin, 'select public.community_admin_rule_set_activate(1)');
  v_j := pg_temp.asj(v_admin, 'select public.community_admin_rule_set_create(1)');
  perform pg_temp.asj(v_cmo, format($q$select public.community_admin_rule_save(%s, 'emergency', 'regex', '\ytest emergency phrase\y', 'safety', 'proof only')$q$, v_j ->> 'version'));
  perform pg_temp.asj(v_cmo, format($q$select public.community_admin_rule_save(%s, 'self_harm', 'regex', '\ytest crisis phrase\y', 'safety', 'proof only')$q$, v_j ->> 'version'));
  perform pg_temp.asj(v_cmo, format('select public.community_admin_rule_set_activate(%s)', v_j ->> 'version'));
  perform pg_temp.rec('setup: a CMO-signed set with safety rules is live', 'true',
    (exists (select 1 from public.community_filter_rule_sets where status = 'active' and approved_by = v_cmo))::text);
  v_j := pg_temp.asj(v_admin, $q$select public.community_admin_save_group(null, 'Proof posting group', 'proof-posting', 'x', 'hypertension', 'Be kind.', 'open', null)$q$);
  v_g := (v_j ->> 'id')::uuid;
  perform pg_temp.asj(v_admin, format('select public.community_admin_save_group(%L, null, null, null, null, null, null, ''active'')', v_g));
  perform pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'moderator', %L)$q$, v_mod, v_g));
  perform pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'safety_reviewer', null)$q$, v_rev));
  perform pg_temp.joined(v_p1, v_g); perform pg_temp.joined(v_p2, v_g); perform pg_temp.joined(v_p3, v_g); perform pg_temp.joined(v_p4, v_g);
  perform pg_temp.joined(v_p5, v_g); perform pg_temp.joined(v_p6, v_g); perform pg_temp.joined(v_p7, v_g);

  -- 1. A new member is pre-moderated for the first three posts, then publishes ------------------------------------------------
  for v_n in 1..3 loop
    v_j := pg_temp.sub(v_p1, v_g, 'Post number ' || v_n || ' from a new member');
    perform pg_temp.rec('new member post ' || v_n || ' is held for a moderator', 'held', (v_j ->> 'status'));
    perform pg_temp.asj(v_mod, format($q$select public.community_mod_decide(%L, 'approve', null)$q$, v_j ->> 'post_id'));
  end loop;
  perform pg_temp.rec('three approvals are counted', '3', (select approved_post_count::text from public.community_memberships where group_id = v_g and profile_id = v_p1));
  v_j := pg_temp.sub(v_p1, v_g, 'Now I post without waiting');
  v_post := (v_j ->> 'post_id')::uuid;
  perform pg_temp.rec('after three approved posts a post publishes at once', 'published', (v_j ->> 'status'));
  update public.community_memberships set approved_post_count = 10 where group_id = v_g and profile_id in (v_p2, v_p3, v_p4, v_p5, v_p6, v_p7);

  -- 2. A retry with the same request id is the same post --------------------------------------------------------------------------
  v_j := pg_temp.sub(v_p2, v_g, 'Posted once', null, v_req);
  perform pg_temp.rec('first send publishes', 'published', (v_j ->> 'status'));
  v_j := pg_temp.sub(v_p2, v_g, 'Posted once', null, v_req);
  perform pg_temp.rec('a retry is reported as a repeat', 'true', (v_j ->> 'repeat'));
  perform pg_temp.rec('...and there is still one such post', '1', (select count(*)::text from public.community_posts where client_request_id = v_req));

  -- 3. Contact details are blocked and the text is never stored ---------------------------------------------------------------------
  v_j := pg_temp.sub(v_p3, v_g, 'please call me on 08031234567 tonight');
  perform pg_temp.rec('a phone number is blocked', 'blocked', (v_j ->> 'status'));
  perform pg_temp.rec('...for the contact class', 'contact', (v_j ->> 'reason'));
  perform pg_temp.rec('the number is in no post, event or notification', '0',
    (select count(*)::text from (
        select to_jsonb(p)::text t from public.community_posts p union all
        select to_jsonb(e)::text from public.community_moderation_events e union all
        select to_jsonb(n)::text from public.notifications n union all
        select to_jsonb(s)::text from public.community_safety_signals s) x where t like '%0803123%'));
  perform pg_temp.rec('the blocked attempt is logged without text', 'true',
    (exists (select 1 from public.community_moderation_events where action = 'blocked' and member_profile_id = v_p3 and filter_hits::text like '%contact%'))::text);
  perform pg_temp.rec('no post row exists for a blocked attempt', '0', (select count(*)::text from public.community_posts where author_profile_id = v_p3));

  -- 4. Repeated blocked attempts trigger a cool-down ----------------------------------------------------------------------------------
  perform pg_temp.sub(v_p5, v_g, 'email me john.doe@gmail.com');
  perform pg_temp.sub(v_p5, v_g, 'visit www.healthcure.com');
  perform pg_temp.rec('two blocked attempts do not yet cool down', 'published', (pg_temp.sub(v_p5, v_g, 'a clean post in between') ->> 'status'));
  perform pg_temp.sub(v_p5, v_g, 'dm me');
  perform pg_temp.rec('the third blocked attempt starts a cool-down', 'true',
    (exists (select 1 from public.community_moderation_events where action = 'cooldown_started' and member_profile_id = v_p5))::text);
  perform pg_temp.rec('during the cool-down even a clean post is refused', 'cooling_down', (pg_temp.sub(v_p5, v_g, 'a perfectly clean post') ->> 'reason'));
  perform pg_temp.rec('another member is not affected', 'published', (pg_temp.sub(v_p6, v_g, 'a perfectly clean post') ->> 'status'));

  -- 5. Held for a person: selling, cure claims, medicine instructions -----------------------------------------------------------------------
  v_j := pg_temp.sub(v_p2, v_g, 'I sell detox tea, message for details');
  v_post2 := (v_j ->> 'post_id')::uuid;
  perform pg_temp.rec('a sales post is held', 'held', (v_j ->> 'status'));
  perform pg_temp.rec('the moderator sees it with its reasons', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_mod, format('select public.community_mod_queue(%L)', v_g)) -> 'items') i where i ->> 'post_id' = v_post2::text and i -> 'reasons' ? 'commerce'))::text);
  perform pg_temp.rec('removing needs a reason', 'reason_needed', (pg_temp.asj(v_mod, format($q$select public.community_mod_decide(%L, 'remove', null)$q$, v_post2)) ->> 'reason'));
  perform pg_temp.rec('the moderator removes it', 'removed', (pg_temp.asj(v_mod, format($q$select public.community_mod_decide(%L, 'remove', 'selling')$q$, v_post2)) ->> 'status'));
  perform pg_temp.rec('a removed post is not in anyone''s feed', 'false',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_p2, format('select public.community_feed(%L)', v_g)) -> 'posts') x where x ->> 'id' = v_post2::text))::text);
  perform pg_temp.rec('the author is told with a fixed notice', '{}',
    (select payload::text from public.notifications where recipient_id = v_p2 and template = 'community_post_removed' limit 1));
  perform pg_temp.rec('a removed post cannot be brought back by the author', 'not_editable', (pg_temp.asj(v_p2, format($q$select public.community_edit_post(%L, 'hello again')$q$, v_post2)) ->> 'reason'));
  perform pg_temp.rec('a removed post cannot be brought back by a hand edit', '42501', pg_temp.try(format('update public.community_posts set state = ''visible'' where id = %L', v_post2)));
  perform pg_temp.rec('a held post can be hard to tell from advice: medicine instruction is held', 'held',
    (pg_temp.sub(v_p6, v_g, 'my advice is stop taking your metformin') ->> 'status'));

  -- 6. Reports hide a post once enough different members report it -------------------------------------------------------------------------
  perform pg_temp.rec('a member cannot report their own post', 'own_post', (pg_temp.asj(v_p1, format($q$select public.community_report_post(%L, 'other', null)$q$, v_post)) ->> 'reason'));
  perform pg_temp.rec('a bad reason code is refused', 'bad_reason', (pg_temp.asj(v_p2, format($q$select public.community_report_post(%L, 'because', null)$q$, v_post)) ->> 'reason'));
  perform pg_temp.rec('first report', 'reported', (pg_temp.asj(v_p2, format($q$select public.community_report_post(%L, 'harassment', null)$q$, v_post)) ->> 'status'));
  perform pg_temp.rec('a duplicate report is not counted twice', 'already_reported', (pg_temp.asj(v_p2, format($q$select public.community_report_post(%L, 'harassment', null)$q$, v_post)) ->> 'status'));
  perform pg_temp.asj(v_p3, format($q$select public.community_report_post(%L, 'harassment', null)$q$, v_post));
  perform pg_temp.rec('below the threshold the post stays visible', 'visible', (select state from public.community_posts where id = v_post));
  perform pg_temp.asj(v_p4, format($q$select public.community_report_post(%L, 'harassment', null)$q$, v_post));
  perform pg_temp.rec('the third distinct reporter hides it pending review', 'auto_hidden', (select state from public.community_posts where id = v_post));
  perform pg_temp.rec('the moderator sees the report count and reasons', '3',
    (select (i ->> 'report_count') from jsonb_array_elements(pg_temp.asj(v_mod, format('select public.community_mod_queue(%L)', v_g)) -> 'items') i where i ->> 'post_id' = v_post::text));
  perform pg_temp.rec('the reporters are not named in the queue', 'false',
    (pg_temp.asj(v_mod, format('select public.community_mod_queue(%L)', v_g))::text like '%' || v_p2::text || '%')::text);
  perform pg_temp.rec('approving dismisses the reports and restores the post', 'approved', (pg_temp.asj(v_mod, format($q$select public.community_mod_decide(%L, 'approve', null)$q$, v_post)) ->> 'status'));
  perform pg_temp.rec('...visible again', 'visible', (select state from public.community_posts where id = v_post));
  perform pg_temp.rec('...and the reports are dismissed', '0', (select count(*)::text from public.community_reports where post_id = v_post and status = 'open'));

  -- 7. The safety hand-off ----------------------------------------------------------------------------------------------------------------
  v_j := pg_temp.sub(v_p4, v_g, 'honestly I have a test emergency phrase right now');
  v_post := (v_j ->> 'post_id')::uuid;
  perform pg_temp.rec('emergency language is withheld, not published', 'withheld', (v_j ->> 'status'));
  perform pg_temp.rec('...and the author is told which kind (for the right card)', 'emergency', (v_j ->> 'safety_kind'));
  perform pg_temp.rec('a signal is raised', '1', (select count(*)::text from public.community_safety_signals where post_id = v_post and kind = 'emergency_language'));
  perform pg_temp.rec('other members cannot see the withheld post', 'false',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_p3, format('select public.community_feed(%L)', v_g)) -> 'posts') x where x ->> 'id' = v_post::text))::text);
  perform pg_temp.rec('the author sees it waiting', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_p4, format('select public.community_feed(%L)', v_g)) -> 'posts') x where x ->> 'id' = v_post::text and (x ->> 'pending_review')::boolean))::text);
  perform pg_temp.rec('moderators never see a safety post', 'false',
    (pg_temp.asj(v_mod, format('select public.community_mod_queue(%L)', v_g))::text like '%' || v_post::text || '%')::text);
  perform pg_temp.rec('a moderator cannot decide a safety post', 'safety_reviewer_only', (pg_temp.asj(v_mod, format($q$select public.community_mod_decide(%L, 'approve', null)$q$, v_post)) ->> 'reason'));
  v_j := pg_temp.asj(v_rev, 'select public.community_safety_queue()');
  perform pg_temp.rec('the safety reviewer sees it', 'true', (exists (select 1 from jsonb_array_elements(v_j -> 'items') i where i ->> 'post_id' = v_post::text))::text);
  perform pg_temp.rec('...with a handle and no identity', 'false', (v_j::text like '%' || v_p4::text || '%')::text);
  perform pg_temp.rec('nothing is sent to an emergency contact or the care team from a post', '0',
    (select count(*)::text from public.notifications where recipient_id = v_p4 and (template ilike '%emergency%' or template ilike '%care_team%')));
  select id into v_sig from public.community_safety_signals where post_id = v_post;
  perform pg_temp.rec('a bad decision is refused', 'bad_decision', (pg_temp.asj(v_rev, format($q$select public.community_safety_decide(%L, 'delete')$q$, v_sig)) ->> 'reason'));
  perform pg_temp.rec('a moderator cannot decide a signal', '42501', (pg_temp.asj(v_mod, format($q$select public.community_safety_decide(%L, 'release')$q$, v_sig)) ->> 'error'));
  perform pg_temp.rec('the reviewer keeps it withheld', 'kept_withheld', (pg_temp.asj(v_rev, format($q$select public.community_safety_decide(%L, 'keep_withheld')$q$, v_sig)) ->> 'status'));
  perform pg_temp.rec('...so it stays held', 'held', (select state from public.community_posts where id = v_post));
  perform pg_temp.rec('a handled signal cannot be handled twice', 'already_handled', (pg_temp.asj(v_rev, format($q$select public.community_safety_decide(%L, 'close')$q$, v_sig)) ->> 'reason'));
  perform pg_temp.rec('the decision is on the log with the reviewer', 'true',
    (exists (select 1 from public.community_moderation_events where action = 'safety_kept_withheld' and actor_id = v_rev and subject_id = v_post))::text);
  v_j := pg_temp.sub(v_p6, v_g, 'a test crisis phrase and also a test emergency phrase');
  perform pg_temp.rec('self-harm language outranks emergency language', 'self_harm', (v_j ->> 'safety_kind'));
  perform pg_temp.rec('...and is signalled as self-harm', '1', (select count(*)::text from public.community_safety_signals where post_id = (v_j ->> 'post_id')::uuid and kind = 'self_harm_language'));
  perform pg_temp.rec('the reviewer can release a post', 'released',
    (pg_temp.asj(v_rev, format($q$select public.community_safety_decide(%L, 'release')$q$, (select id from public.community_safety_signals where post_id = (v_j ->> 'post_id')::uuid))) ->> 'status'));
  perform pg_temp.rec('...which publishes it', 'visible', (select state from public.community_posts where id = (v_j ->> 'post_id')::uuid));
  -- a report that someone may be in danger also reaches a reviewer
  v_j := pg_temp.sub(v_p2, v_g, 'A post that worries a friend');
  perform pg_temp.asj(v_p3, format($q$select public.community_report_post(%L, 'self_harm_or_danger', null)$q$, v_j ->> 'post_id'));
  perform pg_temp.rec('a danger report raises a reviewer signal', '1',
    (select count(*)::text from public.community_safety_signals where post_id = (v_j ->> 'post_id')::uuid and kind = 'reviewer_concern'));
  -- an edit is scanned like a new post
  v_j := pg_temp.sub(v_p3, v_g, 'a harmless line to edit');
  perform pg_temp.rec('an edit with a phone number is blocked', 'blocked', (pg_temp.asj(v_p3, format($q$select public.community_edit_post(%L, 'call 08031234567')$q$, v_j ->> 'post_id')) ->> 'status'));
  perform pg_temp.rec('...and the post keeps its old text', 'a harmless line to edit', (select body from public.community_posts where id = (v_j ->> 'post_id')::uuid));
  perform pg_temp.rec('an edit with emergency language is withheld', 'withheld', (pg_temp.asj(v_p3, format($q$select public.community_edit_post(%L, 'now a test emergency phrase')$q$, v_j ->> 'post_id')) ->> 'status'));
  perform pg_temp.rec('...and hidden from others', 'held', (select state from public.community_posts where id = (v_j ->> 'post_id')::uuid));
  v_j := pg_temp.sub(v_p3, v_g, 'another line to edit');
  perform pg_temp.rec('a clean edit is applied', 'published', (pg_temp.asj(v_p3, format($q$select public.community_edit_post(%L, 'the edited line')$q$, v_j ->> 'post_id')) ->> 'status'));
  perform pg_temp.rec('...and marked edited', 'true', (select (edited_at is not null)::text from public.community_posts where id = (v_j ->> 'post_id')::uuid));
  perform pg_temp.rec('someone else cannot edit it', 'not_yours', (pg_temp.asj(v_p2, format($q$select public.community_edit_post(%L, 'mine now')$q$, v_j ->> 'post_id')) ->> 'reason'));
  perform pg_temp.age_posts(format('id = %L', v_j ->> 'post_id'));
  perform pg_temp.rec('after the edit window an edit is refused', 'edit_window_over', (pg_temp.asj(v_p3, format($q$select public.community_edit_post(%L, 'too late')$q$, v_j ->> 'post_id')) ->> 'reason'));

  -- 8. Replies are one level deep, and the notice carries nothing -------------------------------------------------------------------------
  v_j := pg_temp.sub(v_p2, v_g, 'A question for the group');
  v_post := (v_j ->> 'post_id')::uuid;
  v_j := pg_temp.sub(v_p3, v_g, 'An answer from me', v_post);
  perform pg_temp.rec('a reply publishes', 'published', (v_j ->> 'status'));
  perform pg_temp.rec('a reply to a reply is refused', 'reply_target_gone', (pg_temp.sub(v_p4, v_g, 'a nested reply', (v_j ->> 'post_id')::uuid) ->> 'reason'));
  perform pg_temp.rec('the original author gets one in-app notice', '1', (select count(*)::text from public.notifications where recipient_id = v_p2 and template = 'community_reply'));
  perform pg_temp.sub(v_p4, v_g, 'A second answer', v_post);
  perform pg_temp.rec('a second reply within ten minutes does not add another notice', '1', (select count(*)::text from public.notifications where recipient_id = v_p2 and template = 'community_reply'));
  perform pg_temp.rec('the notice names no group, handle or text (INV-07)', '{}', (select payload::text from public.notifications where recipient_id = v_p2 and template = 'community_reply' limit 1));
  perform pg_temp.rec('the notice is in-app and non-clinical', 'in_app/non_clinical',
    (select channel::text || '/' || content_class::text from public.notifications where recipient_id = v_p2 and template = 'community_reply' limit 1));
  perform pg_temp.rec('replies list for a member', '2', (jsonb_array_length(pg_temp.asj(v_p4, format('select public.community_replies(%L)', v_post)) -> 'replies'))::text);
  perform pg_temp.asj(v_p3, format('select public.community_set_group_muted(%L, true)', v_g));
  perform pg_temp.sub(v_p4, v_g, 'a reply to a muted member', (select id from public.community_posts where author_profile_id = v_p3 and parent_post_id is null order by created_at limit 1));
  perform pg_temp.rec('a muted member gets no notice', '0', (select count(*)::text from public.notifications where recipient_id = v_p3 and template = 'community_reply'));
  perform pg_temp.rec('a member can support a post', '1', (pg_temp.asj(v_p3, format('select public.community_react(%L, true)', v_post)) ->> 'support_count'));
  perform pg_temp.rec('...once', '1', (pg_temp.asj(v_p3, format('select public.community_react(%L, true)', v_post)) ->> 'support_count'));
  perform pg_temp.rec('...and take it back', '0', (pg_temp.asj(v_p3, format('select public.community_react(%L, false)', v_post)) ->> 'support_count'));

  -- 9. Deleting, leaving, retention ---------------------------------------------------------------------------------------------------------------
  v_j := pg_temp.sub(v_p6, v_g, 'I will delete this later');
  perform pg_temp.rec('an author can delete their post', 'deleted', (pg_temp.asj(v_p6, format('select public.community_delete_own_post(%L)', v_j ->> 'post_id')) ->> 'status'));
  perform pg_temp.rec('...and cannot delete someone else''s', 'not_yours', (pg_temp.asj(v_p6, format('select public.community_delete_own_post(%L)', v_post)) ->> 'reason'));
  update public.community_posts set removed_at = now() - interval '100 days' where id = (v_j ->> 'post_id')::uuid;
  perform pg_temp.rec('a signed-in user cannot run the purge', '42501', (pg_temp.asj(v_p6, 'select public.community_purge_expired()') ->> 'error'));
  perform pg_temp.act_service();
  perform pg_temp.rec('the service role purges expired bodies', 'true', (public.community_purge_expired() >= 1)::text);
  perform pg_temp.back();
  perform pg_temp.rec('...which blanks the removed text only', '[removed]', (select body from public.community_posts where id = (v_j ->> 'post_id')::uuid));
  perform pg_temp.rec('...and leaves a live post alone', 'A question for the group', (select body from public.community_posts where id = v_post));
  perform pg_temp.sub(v_p7, v_g, 'one more from a leaver');
  perform pg_temp.rec('leaving can delete the member''s posts', 'left', (pg_temp.asj(v_p7, format('select public.community_leave_group(%L, true)', v_g)) ->> 'status'));
  perform pg_temp.rec('...so none of them is visible any more', '0', (select count(*)::text from public.community_posts where author_profile_id = v_p7 and state = 'visible'));

  -- 10. Sanctions work through a post, and a moderator never learns who -------------------------------------------------------------------------
  v_j := pg_temp.sub(v_p1, v_g, 'a post that earns a mute');
  v_post := (v_j ->> 'post_id')::uuid;
  v_j := pg_temp.asj(v_mod, format($q$select public.community_mod_sanction(%L, 'mute', 'spamming', 2, false)$q$, v_post));
  perform pg_temp.rec('a moderator mutes through a post', 'ok', (v_j ->> 'status'));
  perform pg_temp.rec('the answer carries no identity', 'false', (v_j::text like '%' || v_p1::text || '%')::text);
  perform pg_temp.rec('a muted member cannot post', 'muted', (pg_temp.sub(v_p1, v_g, 'trying anyway') ->> 'reason'));
  perform pg_temp.rec('a muted member can still read', 'true', (pg_temp.asj(v_p1, format('select public.community_feed(%L)', v_g)) ->> 'ok'));
  perform pg_temp.rec('a mute needs hours', 'hours_needed', (pg_temp.asj(v_mod, format($q$select public.community_mod_sanction(%L, 'mute', 'spamming', null, false)$q$, v_post)) ->> 'reason'));
  perform pg_temp.rec('a moderator cannot sanction across every group', '42501', (pg_temp.asj(v_mod, format($q$select public.community_mod_sanction(%L, 'ban', 'abuse', null, true)$q$, v_post)) ->> 'error'));
  perform pg_temp.rec('an admin can', 'ok', (pg_temp.asj(v_admin, format($q$select public.community_mod_sanction(%L, 'warning', 'first warning', null, true)$q$, v_post)) ->> 'status'));
  delete from public.community_sanctions where profile_id = v_p1;
  perform pg_temp.asj(v_mod, format($q$select public.community_mod_sanction(%L, 'ban', 'abuse', null, false)$q$, v_post));
  perform pg_temp.rec('a banned member cannot post', 'banned', (pg_temp.sub(v_p1, v_g, 'trying anyway') ->> 'reason'));
  delete from public.community_sanctions where profile_id = v_p1;
  perform pg_temp.rec('a lifted sanction restores posting', 'published', (pg_temp.sub(v_p1, v_g, 'back again') ->> 'status'));
  perform pg_temp.rec('every member notice is fixed text', 'true',
    (select bool_and(payload = '{}'::jsonb)::text from public.notifications where template like 'community\_%'));

  -- 11. Limits ------------------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('a very long post is refused', 'too_long', (pg_temp.sub(v_p2, v_g, repeat('word ', 500)) ->> 'reason'));
  perform pg_temp.rec('an empty post is refused', 'empty', (pg_temp.sub(v_p2, v_g, '   ') ->> 'reason'));
  delete from public.community_posts where false;
  for v_n in 1..6 loop insert into public.community_posts (group_id, author_profile_id, author_handle, body) select v_g, v_p7, handle, 'filler ' || v_n from public.community_memberships where group_id = v_g and profile_id = v_p7; end loop;
  update public.community_memberships set status = 'active', left_at = null where group_id = v_g and profile_id = v_p7;
  perform pg_temp.rec('the hourly limit holds', 'rate_limited', (pg_temp.sub(v_p7, v_g, 'one too many') ->> 'reason'));

  -- 12. Logs, config, and pinned content ----------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('the moderation log cannot be edited', '42501', pg_temp.try('update public.community_moderation_events set action = ''x'''));
  perform pg_temp.rec('the moderation log cannot be deleted from', '42501', pg_temp.try('delete from public.community_moderation_events'));
  perform pg_temp.rec('the moderation log cannot be truncated', '42501', pg_temp.try('truncate public.community_moderation_events'));
  perform pg_temp.rec('a config version cannot be edited', '42501', pg_temp.try('update public.community_config set params = ''{}''::jsonb where version = 1'));
  perform pg_temp.rec('a config version cannot be deleted', '42501', pg_temp.try('delete from public.community_config where version = 1'));
  perform pg_temp.rec('exactly one config version is active', '1', (select count(*)::text from public.community_config where is_active));
  v_j := pg_temp.asj(v_doc, format($q$select public.community_clinician_pin(%L, 'When to see your care team', 'If a reading stays high, tell your care team.')$q$, v_g));
  v_pin := (v_j ->> 'id')::uuid;
  perform pg_temp.rec('a clinician pins a note', 'ok', (v_j ->> 'status'));
  perform pg_temp.rec('a patient cannot pin', '42501', (pg_temp.asj(v_p1, format($q$select public.community_clinician_pin(%L, 'Not allowed', 'x')$q$, v_g)) ->> 'error'));
  select slug into v_slug from public.community_groups where id = v_g;
  perform pg_temp.rec('an unreviewed note is not shown to members', '0', (jsonb_array_length(pg_temp.asj(v_p2, format('select public.community_get_group(%L)', v_slug)) -> 'pinned'))::text);
  perform pg_temp.rec('the author cannot review their own note', 'not_reviewable', (pg_temp.asj(v_doc, format('select public.community_clinician_review_pin(%L)', v_pin)) ->> 'reason') || '');
  perform pg_temp.rec('a patient cannot review', 'not_reviewable', (pg_temp.asj(v_p1, format('select public.community_clinician_review_pin(%L)', v_pin)) ->> 'reason') || '');
  perform pg_temp.rec('a second clinician reviews', 'ok', (pg_temp.asj(v_doc2, format('select public.community_clinician_review_pin(%L)', v_pin)) ->> 'status'));
  v_j := pg_temp.asj(v_p2, format('select public.community_get_group(%L)', v_slug));
  perform pg_temp.rec('the group view returns the post limit from the configuration', '2000', (v_j -> 'limits' ->> 'post_max_chars'));
  perform pg_temp.rec('...and the edit window', '15', (v_j -> 'limits' ->> 'edit_window_minutes'));
  perform pg_temp.rec('a reviewed note is shown with the reviewer''s real name', 'COM doc2', (v_j -> 'pinned' -> 0 ->> 'reviewed_by_name'));
  perform pg_temp.rec('...and when it was reviewed', 'true', ((v_j -> 'pinned' -> 0 ->> 'reviewed_at') is not null)::text);

  -- 13. SABOTAGE -------------------------------------------------------------------------------------------------------------------------------------------
  -- (a) the scan lets everything through: a phone number must no longer be blocked
  create or replace function private.community_scan(p_body text) returns jsonb language sql stable as $s$ select jsonb_build_object('decision', 'allow', 'version', 1, 'hits', '[]'::jsonb) $s$;
  insert into results values ('sabotaged', 'a phone number is blocked', 'blocked', coalesce(pg_temp.sub(v_p2, v_g, 'please call me on 08031234567 tonight') ->> 'status', 'null'));
  -- (b) pre-moderation removed: a brand-new member's first post publishes
  create or replace function private.community_scan_outcome(p_scan jsonb, p_approved_post_count integer) returns jsonb language sql stable as $s$ select jsonb_build_object('action', 'publish', 'class', null, 'codes', '[]'::jsonb) $s$;
  update public.community_memberships set approved_post_count = 0 where group_id = v_g and profile_id = v_p2;
  perform pg_temp.age_posts(format('author_profile_id = %L', v_p2));
  insert into results values ('sabotaged', 'a new member''s first post is held', 'held', coalesce(pg_temp.sub(v_p2, v_g, 'brand new here') ->> 'status', 'null'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'community posting proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed the matching check', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to differ inside the DO block above and are deliberately not printed.

rollback;
