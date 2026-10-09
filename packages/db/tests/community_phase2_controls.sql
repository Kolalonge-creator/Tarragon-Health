-- Community proof 4 of 4: Phase 2 (hide one author, search, size cap, moderator roster, group prompts, digests, appeals,
-- second-moderator sampling, eating-disorder hand-off to the safety reviewer).
--
-- Proves, in one rolled-back transaction, with a sabotage step for the hide filter and the prompt gate:
--   1. Hiding an author removes their posts and replies from MY feed only, names no one, is undone by unhiding, and stops reply notices.
--   2. Search finds groups by name, description or topic, never posts.
--   3. A full group refuses new members; only an admin sets the cap.
--   4. A moderator who chooses a name appears in the group's team list (no ids); a phone-number-shaped name is refused.
--   5. Group prompts: staff only, run through the same filters as a post, shown only inside their window.
--   6. The weekly digest is opt-in, fixed text, once per week, and the job is for the service role only.
--   7. Appeals: only the author, only inside the window, once; decided by a different moderator; overturning restores the post or lifts the sanction.
--   8. A sampled decision is re-checked by a different moderator; the CMO sees the disagreement rate.
--   9. Disordered-eating wording is held for a moderator, who can hand it to a safety reviewer (and then cannot see it again);
--      everyday talk (water pills, a skipped lunch) is not held.
--  10. A removed post cannot come back by any other route than an overturned appeal.
--
-- Run: psql -f packages/db/tests/community_phase2_controls.sql   (against a database where the community migrations are applied)

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
  v_org uuid; v_admin uuid; v_cmo uuid; v_mod uuid; v_mod2 uuid; v_rev uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid; v_p5 uuid; v_p6 uuid;
  v_g uuid; v_j jsonb; v_post uuid; v_post2 uuid; v_reply uuid; v_n integer; v_id uuid; v_hid uuid; v_sanc uuid; v_sample uuid; v_team jsonb;
  v_extra uuid; v_slug text;
begin
  select id into v_org from public.organisations order by id limit 1;
  if v_org is null then insert into public.organisations (name) values ('community proof org') returning id into v_org; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_mod := pg_temp.mkuser(v_org, 'mod', 'care_coordinator');
  v_mod2 := pg_temp.mkuser(v_org, 'mod2', 'care_coordinator');
  v_rev := pg_temp.mkuser(v_org, 'rev', 'care_coordinator');
  v_p1 := pg_temp.mkuser(v_org, 'p1', 'patient'); v_p2 := pg_temp.mkuser(v_org, 'p2', 'patient'); v_p3 := pg_temp.mkuser(v_org, 'p3', 'patient');
  v_p4 := pg_temp.mkuser(v_org, 'p4', 'patient'); v_p5 := pg_temp.mkuser(v_org, 'p5', 'patient'); v_p6 := pg_temp.mkuser(v_org, 'p6', 'patient');

  -- a live rule set copied from the seeded draft (so it carries the eating-disorder hold rules), plus test safety rules signed by the CMO
  update public.community_filter_rule_sets set status = 'retired' where status = 'active';
  perform pg_temp.asj(v_admin, 'select public.community_admin_rule_set_activate(1)');
  v_j := pg_temp.asj(v_admin, 'select public.community_admin_rule_set_create(1)');
  perform pg_temp.asj(v_cmo, format($q$select public.community_admin_rule_save(%s, 'self_harm', 'regex', '\ytest crisis phrase\y', 'safety', 'proof only')$q$, v_j ->> 'version'));
  perform pg_temp.asj(v_cmo, format('select public.community_admin_rule_set_activate(%s)', v_j ->> 'version'));
  v_j := pg_temp.asj(v_admin, $q$select public.community_admin_save_group(null, 'Proof phase two group', 'proof-phase-two', 'A place to talk about pressure.', 'hypertension', 'Be kind.', 'open', null)$q$);
  v_g := (v_j ->> 'id')::uuid;
  select slug into v_slug from public.community_groups where id = v_g;
  perform pg_temp.asj(v_admin, format('select public.community_admin_save_group(%L, null, null, null, null, null, null, ''active'')', v_g));
  perform pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'moderator', %L)$q$, v_mod, v_g));
  perform pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'moderator', %L)$q$, v_mod2, v_g));
  perform pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'safety_reviewer', null)$q$, v_rev));
  perform pg_temp.joined(v_p1, v_g); perform pg_temp.joined(v_p2, v_g); perform pg_temp.joined(v_p3, v_g); perform pg_temp.joined(v_p4, v_g);
  perform pg_temp.joined(v_p5, v_g); perform pg_temp.joined(v_p6, v_g);
  update public.community_memberships set approved_post_count = 10 where group_id = v_g and profile_id in (v_p1, v_p2, v_p3, v_p4);

  -- 1. Hide one author ------------------------------------------------------------------------------------------------------------------------
  v_j := pg_temp.sub(v_p2, v_g, 'My pressure was 130 over 85 this morning');
  v_post := (v_j ->> 'post_id')::uuid;
  v_j := pg_temp.sub(v_p3, v_g, 'A post from someone else');
  v_post2 := (v_j ->> 'post_id')::uuid;
  perform pg_temp.rec('before hiding, p1 sees p2''s post', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_p1, format('select public.community_feed(%L)', v_g)) -> 'posts') x where x ->> 'id' = v_post::text))::text);
  perform pg_temp.rec('hiding a post''s author works', 'hidden', (pg_temp.asj(v_p1, format('select public.community_hide_author(%L)', v_post)) ->> 'status'));
  perform pg_temp.rec('...so p1 no longer sees that author in the feed', 'false',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_p1, format('select public.community_feed(%L)', v_g)) -> 'posts') x where x ->> 'id' = v_post::text))::text);
  perform pg_temp.rec('...but still sees everyone else', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_p1, format('select public.community_feed(%L)', v_g)) -> 'posts') x where x ->> 'id' = v_post2::text))::text);
  perform pg_temp.rec('...and other members still see the hidden author', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_p4, format('select public.community_feed(%L)', v_g)) -> 'posts') x where x ->> 'id' = v_post::text))::text);
  perform pg_temp.rec('...and the author still sees their own post', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_p2, format('select public.community_feed(%L)', v_g)) -> 'posts') x where x ->> 'id' = v_post::text))::text);
  v_j := pg_temp.asj(v_p1, format('select public.community_hidden_authors(%L)', v_g));
  perform pg_temp.rec('the hidden list shows a handle', 'true', (jsonb_array_length(v_j -> 'hidden') = 1)::text);
  perform pg_temp.rec('...and no account id', 'false', (v_j::text like '%' || v_p2::text || '%')::text);
  perform pg_temp.rec('the author is told nothing', '0', (select count(*)::text from public.notifications where recipient_id = v_p2 and template ilike '%hid%'));
  perform pg_temp.rec('a member cannot hide themselves', 'own_post', (pg_temp.asj(v_p2, format('select public.community_hide_author(%L)', v_post)) ->> 'reason'));
  perform pg_temp.rec('a non-member cannot hide', 'not_available', (pg_temp.asj(pg_temp.mkuser(v_org, 'nonmember', 'patient'), format('select public.community_hide_author(%L)', v_post)) ->> 'reason'));
  -- replies: p1 posts, p2 (hidden by p1) replies, p1 is not notified; p3 replies, p1 is
  v_j := pg_temp.sub(v_p1, v_g, 'A question from p1');
  v_reply := (v_j ->> 'post_id')::uuid;
  perform pg_temp.sub(v_p2, v_g, 'A reply from the hidden author', v_reply);
  perform pg_temp.rec('a hidden author''s reply does not notify the hider', '0',
    (select count(*)::text from public.notifications where recipient_id = v_p1 and template = 'community_reply'));
  perform pg_temp.sub(v_p3, v_g, 'A reply from another member', v_reply);
  perform pg_temp.rec('...but another member''s reply does (control)', '1',
    (select count(*)::text from public.notifications where recipient_id = v_p1 and template = 'community_reply'));
  perform pg_temp.rec('the hider sees only the other reply', '1',
    (jsonb_array_length(pg_temp.asj(v_p1, format('select public.community_replies(%L)', v_reply)) -> 'replies'))::text);
  perform pg_temp.rec('everyone else sees both replies', '2',
    (jsonb_array_length(pg_temp.asj(v_p4, format('select public.community_replies(%L)', v_reply)) -> 'replies'))::text);
  select id into v_hid from public.community_hidden_authors where viewer_id = v_p1;
  perform pg_temp.rec('another member cannot unhide for p1', 'not_found', (pg_temp.asj(v_p4, format('select public.community_unhide_author(%L)', v_hid)) ->> 'reason'));
  perform pg_temp.rec('unhiding works', 'ok', (pg_temp.asj(v_p1, format('select public.community_unhide_author(%L)', v_hid)) ->> 'status'));
  perform pg_temp.rec('...and the author is back in the feed', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_p1, format('select public.community_feed(%L)', v_g)) -> 'posts') x where x ->> 'id' = v_post::text))::text);
  perform pg_temp.asj(v_p1, format('select public.community_hide_author(%L)', v_post));   -- hide again for the sabotage step below

  -- 2. Search --------------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('search finds a group by its topic', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_p1, $q$select public.community_search_groups('blood pressure')$q$) -> 'groups') x where x ->> 'id' = v_g::text))::text);
  perform pg_temp.rec('search finds a group by its name', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_p1, $q$select public.community_search_groups('phase two')$q$) -> 'groups') x where x ->> 'id' = v_g::text))::text);
  perform pg_temp.rec('search for nothing returns nothing', '0',
    (jsonb_array_length(pg_temp.asj(v_p1, $q$select public.community_search_groups('zzzqqq')$q$) -> 'groups'))::text);
  perform pg_temp.rec('a percent sign is not a wildcard', '0',
    (jsonb_array_length(pg_temp.asj(v_p1, $q$select public.community_search_groups('%%')$q$) -> 'groups'))::text);
  perform pg_temp.rec('search never looks inside posts', '0',
    (jsonb_array_length(pg_temp.asj(v_p1, $q$select public.community_search_groups('130 over 85')$q$) -> 'groups'))::text);

  -- 3. Size cap ------------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('a patient cannot set the cap', '42501', (pg_temp.asj(v_p1, format('select public.community_admin_set_group_cap(%L, 10)', v_g)) ->> 'error'));
  perform pg_temp.rec('a cap below ten is refused', 'bad_cap', (pg_temp.asj(v_admin, format('select public.community_admin_set_group_cap(%L, 5)', v_g)) ->> 'reason'));
  perform pg_temp.rec('an admin sets the cap', 'ok', (pg_temp.asj(v_admin, format('select public.community_admin_set_group_cap(%L, 10)', v_g)) ->> 'status'));
  for v_n in 1..4 loop perform pg_temp.joined(pg_temp.mkuser(v_org, 'fill' || v_n, 'patient'), v_g); end loop;
  v_extra := pg_temp.mkuser(v_org, 'late', 'patient');
  perform pg_temp.rec('a full group refuses a new member', 'group_full', (pg_temp.joined(v_extra, v_g) ->> 'reason'));
  perform pg_temp.rec('...and says it is full in the list', 'true',
    (select (x ->> 'full') from jsonb_array_elements(pg_temp.asj(v_extra, 'select public.community_list_groups()') -> 'groups') x where x ->> 'id' = v_g::text));
  perform pg_temp.asj(v_admin, format('select public.community_admin_set_group_cap(%L, null)', v_g));
  perform pg_temp.rec('with the cap removed they can join', 'joined', (pg_temp.joined(v_extra, v_g) ->> 'status'));

  -- 4. Moderator roster ----------------------------------------------------------------------------------------------------------------------
  v_team := pg_temp.asj(v_p1, format('select public.community_get_group(%L)', v_slug)) -> 'team';
  perform pg_temp.rec('no staff name shows until staff choose one', '0', (jsonb_array_length(v_team))::text);
  perform pg_temp.rec('a phone-number-shaped name is refused', 'bad_name', (pg_temp.asj(v_mod, $q$select public.community_set_my_display_name('08031234567')$q$) ->> 'reason'));
  perform pg_temp.rec('a patient cannot set a staff name', '42501', (pg_temp.asj(v_p1, $q$select public.community_set_my_display_name('Ada')$q$) ->> 'error'));
  perform pg_temp.rec('a moderator chooses a name', 'ok', (pg_temp.asj(v_mod, $q$select public.community_set_my_display_name('Ada, community moderator')$q$) ->> 'status'));
  v_j := pg_temp.asj(v_p1, format('select public.community_get_group(%L)', v_slug));
  perform pg_temp.rec('members see the chosen name', 'Ada, community moderator', (v_j -> 'team' -> 0 ->> 'display_name'));
  perform pg_temp.rec('...with the role', 'moderator', (v_j -> 'team' -> 0 ->> 'scope'));
  perform pg_temp.rec('...and no account id', 'false', ((v_j -> 'team')::text like '%' || v_mod::text || '%')::text);
  perform pg_temp.asj(v_mod, $q$select public.community_set_my_display_name(null)$q$);
  perform pg_temp.rec('clearing the name hides it again', '0',
    (jsonb_array_length(pg_temp.asj(v_p1, format('select public.community_get_group(%L)', v_slug)) -> 'team'))::text);

  -- 5. Group prompts -------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('a patient cannot write a prompt', '42501', (pg_temp.asj(v_p1, format($q$select public.community_admin_save_prompt(%L, 'Welcome, say hello below.')$q$, v_g)) ->> 'error'));
  perform pg_temp.rec('a prompt with a phone number is refused', 'text_not_allowed',
    (pg_temp.asj(v_admin, format($q$select public.community_admin_save_prompt(%L, 'Call me on 08031234567 for help')$q$, v_g)) ->> 'reason'));
  perform pg_temp.rec('a prompt with an outside link is refused', 'text_not_allowed',
    (pg_temp.asj(v_admin, format($q$select public.community_admin_save_prompt(%L, 'See http://example.com for tips')$q$, v_g)) ->> 'reason'));
  perform pg_temp.rec('a prompt that is too short is refused', 'bad_length', (pg_temp.asj(v_admin, format($q$select public.community_admin_save_prompt(%L, 'Hi')$q$, v_g)) ->> 'reason'));
  perform pg_temp.rec('the group''s moderator can write a prompt', 'ok',
    (pg_temp.asj(v_mod, format($q$select public.community_admin_save_prompt(%L, 'Welcome! Say hello and tell us how your week went.')$q$, v_g)) ->> 'status'));
  v_id := (select id from public.community_group_prompts where group_id = v_g order by created_at desc limit 1);
  perform pg_temp.rec('members see the prompt', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_p1, format('select public.community_get_group(%L)', v_slug)) -> 'prompts') x where x ->> 'id' = v_id::text))::text);
  perform pg_temp.asj(v_admin, format($q$select public.community_admin_save_prompt(%L, 'A prompt for next week only, not yet.', now() + interval '7 days')$q$, v_g));
  perform pg_temp.rec('a prompt for later is not shown yet', '1',
    (jsonb_array_length(pg_temp.asj(v_p1, format('select public.community_get_group(%L)', v_slug)) -> 'prompts'))::text);
  perform pg_temp.rec('ending a prompt', 'ok', (pg_temp.asj(v_admin, format('select public.community_admin_end_prompt(%L)', v_id)) ->> 'status'));
  perform pg_temp.rec('...removes it from the group', '0',
    (jsonb_array_length(pg_temp.asj(v_p1, format('select public.community_get_group(%L)', v_slug)) -> 'prompts'))::text);

  -- 6. Digest --------------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('a member opts in to the digest', 'true', (pg_temp.asj(v_p4, format('select public.community_set_digest(%L, true)', v_g)) ->> 'digest_opt_in'));
  perform pg_temp.rec('a non-member cannot', 'not_a_member', (pg_temp.asj(pg_temp.mkuser(v_org, 'outsider', 'patient'), format('select public.community_set_digest(%L, true)', v_g)) ->> 'reason'));
  perform pg_temp.rec('a signed-in user cannot run the digest job', '42501', (pg_temp.asj(v_p4, 'select public.community_send_digests()') ->> 'error'));
  perform pg_temp.act_service();
  perform public.community_send_digests();
  perform pg_temp.back();
  perform pg_temp.rec('the opted-in member gets one digest', '1', (select count(*)::text from public.notifications where recipient_id = v_p4 and template = 'community_digest'));
  perform pg_temp.rec('a member who did not opt in gets none', '0', (select count(*)::text from public.notifications where recipient_id = v_p3 and template = 'community_digest'));
  perform pg_temp.rec('the digest names no group and carries no text', '{}', (select payload::text from public.notifications where recipient_id = v_p4 and template = 'community_digest'));
  perform pg_temp.act_service();
  perform public.community_send_digests();
  perform pg_temp.back();
  perform pg_temp.rec('a second run in the same week sends nothing more', '1', (select count(*)::text from public.notifications where recipient_id = v_p4 and template = 'community_digest'));

  -- 7. Appeals -------------------------------------------------------------------------------------------------------------------------------
  v_j := pg_temp.sub(v_p5, v_g, 'First post from p5');                   -- held (first post)
  v_post := (v_j ->> 'post_id')::uuid;
  perform pg_temp.asj(v_mod, format($q$select public.community_mod_decide(%L, 'approve', null)$q$, v_post));
  v_j := pg_temp.sub(v_p5, v_g, 'Second post from p5, to be removed');
  v_post := (v_j ->> 'post_id')::uuid;
  perform pg_temp.rec('the moderator removes it', 'removed', (pg_temp.asj(v_mod, format($q$select public.community_mod_decide(%L, 'remove', 'off_topic')$q$, v_post)) ->> 'status'));
  v_j := pg_temp.asj(v_p5, 'select public.community_my_actions()');
  perform pg_temp.rec('the member sees the removal and may appeal', 'true',
    (select (x ->> 'can_appeal') from jsonb_array_elements(v_j -> 'removed_posts') x where x ->> 'post_id' = v_post::text));
  perform pg_temp.rec('someone else cannot appeal it', 'not_appealable', (pg_temp.asj(v_p6, format($q$select public.community_appeal('removal', %L, 'I think this was a mistake please')$q$, v_post)) ->> 'reason'));
  perform pg_temp.rec('a one-word reason is refused', 'reason_length', (pg_temp.asj(v_p5, format($q$select public.community_appeal('removal', %L, 'no')$q$, v_post)) ->> 'reason'));
  perform pg_temp.rec('the member appeals', 'ok', (pg_temp.asj(v_p5, format($q$select public.community_appeal('removal', %L, 'I was only describing my own readings, not selling anything.')$q$, v_post)) ->> 'status'));
  perform pg_temp.rec('only one appeal per removal', 'already_appealed', (pg_temp.asj(v_p5, format($q$select public.community_appeal('removal', %L, 'Asking a second time to be sure.')$q$, v_post)) ->> 'reason'));
  select id into v_id from public.community_appeals where post_id = v_post;
  perform pg_temp.rec('the moderator who removed it does not see it', 'false',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_mod, 'select public.community_appeal_queue()') -> 'items') x where x ->> 'appeal_id' = v_id::text))::text);
  perform pg_temp.rec('...and cannot decide it', 'not_your_appeal_to_decide', (pg_temp.asj(v_mod, format($q$select public.community_appeal_decide(%L, 'overturn', null)$q$, v_id)) ->> 'reason'));
  perform pg_temp.rec('a patient cannot decide it', '42501', (pg_temp.asj(v_p5, format($q$select public.community_appeal_decide(%L, 'overturn', null)$q$, v_id)) ->> 'error'));
  v_j := pg_temp.asj(v_mod2, 'select public.community_appeal_queue()');
  perform pg_temp.rec('a second moderator sees it with what the member said', 'true',
    (exists (select 1 from jsonb_array_elements(v_j -> 'items') x where x ->> 'appeal_id' = v_id::text and x ->> 'member_says' like 'I was only describing%'))::text);
  perform pg_temp.rec('...and not who the member is', 'false', (v_j::text like '%' || v_p5::text || '%')::text);
  perform pg_temp.rec('a direct update cannot bring a removed post back', '42501',
    pg_temp.try(format($q$update public.community_posts set state = 'visible' where id = %L$q$, v_post)));
  perform pg_temp.rec('the second moderator overturns', 'overturned', (pg_temp.asj(v_mod2, format($q$select public.community_appeal_decide(%L, 'overturn', 'Fine on reading again')$q$, v_id)) ->> 'status'));
  perform pg_temp.rec('...the post is back', 'visible', (select state from public.community_posts where id = v_post));
  perform pg_temp.rec('...the member is told', '1', (select count(*)::text from public.notifications where recipient_id = v_p5 and template = 'community_appeal_result'));
  perform pg_temp.rec('...and it cannot be decided twice', 'already_decided', (pg_temp.asj(v_mod2, format($q$select public.community_appeal_decide(%L, 'uphold', null)$q$, v_id)) ->> 'reason'));
  -- an upheld removal stays removed
  v_j := pg_temp.sub(v_p5, v_g, 'Third post from p5, also removed');
  v_post2 := (v_j ->> 'post_id')::uuid;
  perform pg_temp.asj(v_mod, format($q$select public.community_mod_decide(%L, 'remove', 'off_topic')$q$, v_post2));
  perform pg_temp.asj(v_p5, format($q$select public.community_appeal('removal', %L, 'Please look again at this one.')$q$, v_post2));
  select id into v_id from public.community_appeals where post_id = v_post2;
  perform pg_temp.rec('an upheld removal', 'upheld', (pg_temp.asj(v_mod2, format($q$select public.community_appeal_decide(%L, 'uphold', null)$q$, v_id)) ->> 'status'));
  perform pg_temp.rec('...stays removed', 'removed', (select state from public.community_posts where id = v_post2));
  -- a sanction appeal
  v_j := pg_temp.sub(v_p6, v_g, 'First post from p6');
  perform pg_temp.asj(v_mod, format($q$select public.community_mod_decide(%L, 'approve', null)$q$, v_j ->> 'post_id'));
  v_j := pg_temp.sub(v_p6, v_g, 'Second post from p6');
  perform pg_temp.rec('a moderator mutes the member', 'ok', (pg_temp.asj(v_mod, format($q$select public.community_mod_sanction(%L, 'mute', 'harassment', 48)$q$, v_j ->> 'post_id')) ->> 'status'));
  perform pg_temp.rec('a muted member cannot post', 'true', (pg_temp.sub(v_p6, v_g, 'Can I still post?') ->> 'status' <> 'published')::text);
  select id into v_sanc from public.community_sanctions where profile_id = v_p6;
  perform pg_temp.rec('the member appeals the sanction', 'ok', (pg_temp.asj(v_p6, format($q$select public.community_appeal('sanction', %L, 'I was joking with a friend and meant no harm.')$q$, v_sanc)) ->> 'status'));
  select id into v_id from public.community_appeals where sanction_id = v_sanc;
  perform pg_temp.rec('the second moderator lifts it', 'overturned', (pg_temp.asj(v_mod2, format($q$select public.community_appeal_decide(%L, 'overturn', null)$q$, v_id)) ->> 'status'));
  perform pg_temp.rec('...and the member can post again', 'published', (pg_temp.sub(v_p6, v_g, 'Back and glad to be here') ->> 'status'));
  -- the window
  update public.community_sanctions set created_at = now() - interval '30 days' where profile_id = v_p4;
  insert into public.community_sanctions (profile_id, group_id, kind, reason_code, issued_by, created_at) values (v_p4, v_g, 'warning', 'other', v_mod, now() - interval '30 days') returning id into v_sanc;
  perform pg_temp.rec('an old sanction is outside the appeal window', 'not_appealable', (pg_temp.asj(v_p4, format($q$select public.community_appeal('sanction', %L, 'This was a long time ago but still.')$q$, v_sanc)) ->> 'reason'));

  -- 8. Quality sampling ----------------------------------------------------------------------------------------------------------------------
  update public.community_config set is_active = false where is_active;
  insert into public.community_config (version, is_active, params)
  select (select max(version) + 1 from public.community_config), true, (select params || '{"quality_sample_pct": 100}'::jsonb from public.community_config order by version desc limit 1);
  v_j := pg_temp.sub(v_p3, v_g, 'A post for the sampler');
  v_post := (v_j ->> 'post_id')::uuid;
  perform pg_temp.asj(v_mod, format($q$select public.community_mod_decide(%L, 'remove', 'off_topic')$q$, v_post));
  select id into v_sample from public.community_mod_samples where post_id = v_post;
  perform pg_temp.rec('a decision is picked for a second look', 'true', (v_sample is not null)::text);
  perform pg_temp.rec('the moderator who decided does not get it', 'false',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_mod, 'select public.community_sample_queue()') -> 'items') x where x ->> 'sample_id' = v_sample::text))::text);
  perform pg_temp.rec('...and cannot review it', 'your_own_decision', (pg_temp.asj(v_mod, format('select public.community_sample_review(%L, true, null)', v_sample)) ->> 'reason'));
  perform pg_temp.rec('the other moderator gets it', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_mod2, 'select public.community_sample_queue()') -> 'items') x where x ->> 'sample_id' = v_sample::text))::text);
  perform pg_temp.rec('a patient cannot see the sample queue', '42501', (pg_temp.asj(v_p1, 'select public.community_sample_queue()') ->> 'error'));
  perform pg_temp.rec('the other moderator disagrees', 'ok', (pg_temp.asj(v_mod2, format($q$select public.community_sample_review(%L, false, 'Looks fine to me')$q$, v_sample)) ->> 'status'));
  v_j := pg_temp.asj(v_cmo, 'select public.community_quality_summary()');
  perform pg_temp.rec('the CMO sees the disagreement', '1', (v_j ->> 'disagreed_30d'));
  perform pg_temp.rec('a moderator cannot read the summary', '42501', (pg_temp.asj(v_mod, 'select public.community_quality_summary()') ->> 'error'));

  -- 9. Eating-disorder wording --------------------------------------------------------------------------------------------------------------
  update public.community_memberships set approved_post_count = 10 where group_id = v_g;
  v_j := pg_temp.sub(v_p3, v_g, 'I have been starving myself all week and I feel awful');
  v_post := (v_j ->> 'post_id')::uuid;
  perform pg_temp.rec('eating-disorder wording is held for a moderator', 'held', (v_j ->> 'status'));
  perform pg_temp.rec('...and the moderator sees why', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_mod, format('select public.community_mod_queue(%L)', v_g)) -> 'items') i where i ->> 'post_id' = v_post::text and i -> 'reasons' ? 'eating_disorder'))::text);
  perform pg_temp.rec('everyday talk is not held (water pills)', 'published', (pg_temp.sub(v_p4, v_g, 'I take my water pills every morning with breakfast') ->> 'status'));
  perform pg_temp.rec('everyday talk is not held (skipped lunch)', 'published', (pg_temp.sub(v_p4, v_g, 'I skipped lunch and my sugar dropped a bit') ->> 'status'));
  perform pg_temp.rec('the moderator hands it to a safety reviewer', 'sent_to_safety', (pg_temp.asj(v_mod, format($q$select public.community_mod_decide(%L, 'send_to_safety', null)$q$, v_post)) ->> 'status'));
  perform pg_temp.rec('...the reviewer sees it', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_rev, 'select public.community_safety_queue()') -> 'items') i where i ->> 'post_id' = v_post::text))::text);
  perform pg_temp.rec('...the moderators no longer do', 'false',
    (pg_temp.asj(v_mod, format('select public.community_mod_queue(%L)', v_g))::text like '%' || v_post::text || '%')::text);
  perform pg_temp.rec('...and cannot decide it any more', 'safety_reviewer_only', (pg_temp.asj(v_mod, format($q$select public.community_mod_decide(%L, 'approve', null)$q$, v_post)) ->> 'reason'));
  perform pg_temp.rec('the weight-loss rule words do not break the staff rule list', 'true',
    (exists (select 1 from public.community_filter_rules where class = 'eating_disorder' and action = 'hold'))::text);
  perform pg_temp.rec('a hold rule for this class cannot be made a safety rule', '23514',
    pg_temp.try(format($q$insert into public.community_filter_rules (rule_set_version, class, kind, pattern, action) values (%s, 'eating_disorder', 'regex', 'x', 'safety')$q$,
      (pg_temp.asj(v_admin, 'select public.community_admin_rule_set_create(null)') ->> 'version'))));

  -- 10. SABOTAGE -----------------------------------------------------------------------------------------------------------------------------
  -- (a) hiding is switched off: the hidden author must no longer disappear
  v_j := pg_temp.sub(v_p2, v_g, 'Another post from the hidden author');
  delete from public.community_hidden_authors;
  insert into results values ('sabotaged', 'a hidden author stays out of the feed', 'false',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_p1, format('select public.community_feed(%L)', v_g)) -> 'posts') x where x ->> 'id' = v_j ->> 'post_id'))::text);
  -- (b) the prompt gate is opened to everyone: a patient could write a prompt
  create or replace function private.community_can_prompt(p_group uuid) returns boolean language sql stable as 'select true';
  insert into results values ('sabotaged', 'a patient cannot write a prompt', '42501',
    coalesce(pg_temp.asj(v_p1, format($q$select public.community_admin_save_prompt(%L, 'A prompt written by a patient.')$q$, v_g)) ->> 'error', 'null'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'community phase 2 proof FAILED: %',
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
