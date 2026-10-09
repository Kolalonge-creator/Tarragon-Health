-- Community proof 5 of 5: pre-moderated pictures, the 24/7 rota and coverage check, safety drills, overdue alerts, moderator removal tools,
-- and one-off doctor question sessions (text).
--
-- Proves, in one rolled-back transaction, with sabotage steps for the picture access check and the coverage check:
--   1. A picture post is always held for a moderator; only the author and the group's moderators can open the picture until it is
--      approved; once approved the group can; removal closes it to members; text filters still apply; a safety post's picture is
--      only for a safety reviewer; staff views are logged; bad files and wrong folders are refused; groups opt in; weight loss never.
--   2. The coverage check counts uncovered hours, the go-live condition follows it, shifts are validated, a drill can be recorded only by the CMO.
--   3. Overdue safety and queue work is counted and the right staff are told once.
--   4. Moderators can list recent posts and remove one; safety posts are not in that list.
--   5. Doctor sessions: admin creates, only named doctors answer, only inside the window plus grace, answers show the doctor's real
--      name, contact details are refused, the question author is told, doctors never see who asked.
--
-- Run: psql -f packages/db/tests/community_images_ops_qa.sql   (against a database where the community migrations are applied)

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
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid; v_p5 uuid; v_out uuid;
  v_g uuid; v_g2 uuid; v_wl uuid; v_slug text; v_j jsonb; v_post uuid; v_post2 uuid; v_img uuid; v_staff uuid; v_req uuid; v_sig uuid; v_series uuid; v_ans uuid; v_sess uuid;
  v_path text; v_n integer;
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
  v_p4 := pg_temp.mkuser(v_org, 'p4', 'patient'); v_p5 := pg_temp.mkuser(v_org, 'p5', 'patient'); v_out := pg_temp.mkuser(v_org, 'outsider', 'patient');

  update public.community_filter_rule_sets set status = 'retired' where status = 'active';
  perform pg_temp.asj(v_admin, 'select public.community_admin_rule_set_activate(1)');
  v_j := pg_temp.asj(v_admin, 'select public.community_admin_rule_set_create(1)');
  perform pg_temp.asj(v_cmo, format($q$select public.community_admin_rule_save(%s, 'self_harm', 'regex', '\ytest crisis phrase\y', 'safety', 'proof only')$q$, v_j ->> 'version'));
  perform pg_temp.asj(v_cmo, format('select public.community_admin_rule_set_activate(%s)', v_j ->> 'version'));
  v_j := pg_temp.asj(v_admin, $q$select public.community_admin_save_group(null, 'Proof images group', 'proof-images', 'x', 'hypertension', 'Be kind.', 'open', null)$q$);
  v_g := (v_j ->> 'id')::uuid;
  select slug into v_slug from public.community_groups where id = v_g;
  perform pg_temp.asj(v_admin, format('select public.community_admin_save_group(%L, null, null, null, null, null, null, ''active'')', v_g));
  perform pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'moderator', null)$q$, v_mod));
  perform pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'safety_reviewer', null)$q$, v_rev));
  perform pg_temp.joined(v_p1, v_g); perform pg_temp.joined(v_p2, v_g); perform pg_temp.joined(v_p3, v_g); perform pg_temp.joined(v_p4, v_g); perform pg_temp.joined(v_p5, v_g);
  update public.community_memberships set approved_post_count = 10 where group_id = v_g and profile_id in (v_p1, v_p2, v_p3, v_p4);

  -- 1. Pictures --------------------------------------------------------------------------------------------------------------------------
  v_path := v_g::text || '/' || gen_random_uuid()::text || '.jpg';
  perform pg_temp.rec('a picture is refused while the group has pictures off', 'images_off',
    (pg_temp.asj(v_p1, format($q$select public.community_submit_post_with_image(%L, null, 'My home cuff', null, %L, 'image/jpeg', 120000, 800, 600)$q$, v_g, v_path)) ->> 'reason'));
  perform pg_temp.rec('a patient cannot turn pictures on', '42501', (pg_temp.asj(v_p1, format('select public.community_admin_set_group_images(%L, true)', v_g)) ->> 'error'));
  v_j := pg_temp.asj(v_admin, $q$select public.community_admin_save_group(null, 'Proof weight group', 'proof-weight', 'x', 'weight_loss', 'Be kind.', 'open', null)$q$);
  v_wl := (v_j ->> 'id')::uuid;
  perform pg_temp.rec('pictures can never be turned on for a weight-loss group', 'not_for_this_topic', (pg_temp.asj(v_admin, format('select public.community_admin_set_group_images(%L, true)', v_wl)) ->> 'reason'));
  perform pg_temp.rec('an admin turns pictures on', 'ok', (pg_temp.asj(v_admin, format('select public.community_admin_set_group_images(%L, true)', v_g)) ->> 'status'));
  perform pg_temp.rec('...and the group view says so', 'true', (pg_temp.asj(v_p1, format('select public.community_get_group(%L)', v_slug)) -> 'group' ->> 'images_allowed'));
  perform pg_temp.rec('a wrong file type is refused', 'bad_image',
    (pg_temp.asj(v_p1, format($q$select public.community_submit_post_with_image(%L, null, 'x file', null, %L, 'image/gif', 1000, 10, 10)$q$, v_g, v_path)) ->> 'reason'));
  perform pg_temp.rec('an oversized file is refused', 'bad_image',
    (pg_temp.asj(v_p1, format($q$select public.community_submit_post_with_image(%L, null, 'big file', null, %L, 'image/jpeg', 99999999, 10, 10)$q$, v_g, v_path)) ->> 'reason'));
  perform pg_temp.rec('a path in another group''s folder is refused', 'bad_image',
    (pg_temp.asj(v_p1, format($q$select public.community_submit_post_with_image(%L, null, 'other folder', null, %L, 'image/jpeg', 1000, 10, 10)$q$, v_g, gen_random_uuid()::text || '/' || gen_random_uuid()::text || '.jpg')) ->> 'reason'));
  perform pg_temp.rec('a picture with a phone number in the words is blocked', 'blocked',
    (pg_temp.asj(v_p1, format($q$select public.community_submit_post_with_image(%L, null, 'call me on 08031234567', null, %L, 'image/jpeg', 1000, 10, 10)$q$, v_g, v_path)) ->> 'status'));
  perform pg_temp.rec('...and nothing was stored', '0', (select count(*)::text from public.community_post_images));
  v_req := gen_random_uuid();
  v_j := pg_temp.asj(v_p1, format($q$select public.community_submit_post_with_image(%L, null, 'My home blood pressure cuff', %L, %L, 'image/jpeg', 120000, 800, 600)$q$, v_g, v_req, v_path));
  v_post := (v_j ->> 'post_id')::uuid;
  perform pg_temp.rec('a picture post waits for a moderator, even from a trusted member', 'held', (v_j ->> 'status'));
  select id into v_img from public.community_post_images where post_id = v_post;
  perform pg_temp.rec('...and the picture is on file', 'true', (v_img is not null)::text);
  perform pg_temp.rec('a retried request does not store a second picture', '1',
    ((pg_temp.asj(v_p1, format($q$select public.community_submit_post_with_image(%L, null, 'My home blood pressure cuff', %L, %L, 'image/jpeg', 120000, 800, 600)$q$, v_g, v_req, v_g::text || '/' || gen_random_uuid()::text || '.jpg')) ->> 'repeat') is not null and (select count(*) from public.community_post_images) = 1)::int::text);
  perform pg_temp.rec('other members cannot see the post', 'false',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_p2, format('select public.community_feed(%L)', v_g)) -> 'posts') x where x ->> 'id' = v_post::text))::text);
  perform pg_temp.rec('other members cannot open the picture', 'not_found', (pg_temp.asj(v_p2, format('select public.community_image_ref(%L)', v_img)) ->> 'reason'));
  perform pg_temp.rec('a non-member cannot open the picture', 'not_found', (pg_temp.asj(v_out, format('select public.community_image_ref(%L)', v_img)) ->> 'reason'));
  perform pg_temp.rec('the author can open their own waiting picture', 'true', (pg_temp.asj(v_p1, format('select public.community_image_ref(%L)', v_img)) ->> 'ok'));
  perform pg_temp.rec('the author''s feed shows it waiting, with a picture', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_p1, format('select public.community_feed(%L)', v_g)) -> 'posts') x where x ->> 'id' = v_post::text and x -> 'image' ->> 'id' = v_img::text and (x ->> 'pending_review')::boolean))::text);
  v_j := pg_temp.asj(v_mod, 'select public.community_mod_queue()');
  perform pg_temp.rec('the moderator''s queue shows the picture and why it waits', 'true',
    (exists (select 1 from jsonb_array_elements(v_j -> 'items') i where i ->> 'post_id' = v_post::text and i ->> 'image_id' = v_img::text and i -> 'reasons' ? 'image'))::text);
  perform pg_temp.rec('the moderator can open it', 'true', (pg_temp.asj(v_mod, format('select public.community_image_ref(%L)', v_img)) ->> 'ok'));
  perform pg_temp.rec('...and the view is logged', 'true',
    (exists (select 1 from public.community_moderation_events where action = 'image_viewed' and actor_id = v_mod and subject_id = v_post))::text);
  perform pg_temp.rec('a safety reviewer cannot open an ordinary post''s picture', 'not_found', (pg_temp.asj(v_rev, format('select public.community_image_ref(%L)', v_img)) ->> 'reason'));
  perform pg_temp.rec('the moderator approves it', 'approved', (pg_temp.asj(v_mod, format($q$select public.community_mod_decide(%L, 'approve', null)$q$, v_post)) ->> 'status'));
  perform pg_temp.rec('now the group sees the post with its picture', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_p2, format('select public.community_feed(%L)', v_g)) -> 'posts') x where x ->> 'id' = v_post::text and x -> 'image' ->> 'id' = v_img::text))::text);
  perform pg_temp.rec('...and members can open the picture', 'true', (pg_temp.asj(v_p2, format('select public.community_image_ref(%L)', v_img)) ->> 'ok'));
  perform pg_temp.rec('...but a non-member still cannot', 'not_found', (pg_temp.asj(v_out, format('select public.community_image_ref(%L)', v_img)) ->> 'reason'));
  perform pg_temp.rec('a post cannot have two pictures', '23505',
    pg_temp.try(format($q$insert into public.community_post_images (post_id, group_id, storage_path, mime, size_bytes, width, height) values (%L, %L, %L, 'image/png', 10, 1, 1)$q$, v_post, v_g, v_g::text || '/' || gen_random_uuid()::text || '.png')));
  -- removal
  perform pg_temp.rec('the moderator removes the post', 'removed', (pg_temp.asj(v_mod, format($q$select public.community_mod_decide(%L, 'remove', 'off_topic')$q$, v_post)) ->> 'status'));
  perform pg_temp.rec('members can no longer open the picture', 'not_found', (pg_temp.asj(v_p2, format('select public.community_image_ref(%L)', v_img)) ->> 'reason'));
  perform pg_temp.rec('the moderator still can (for appeals)', 'true', (pg_temp.asj(v_mod, format('select public.community_image_ref(%L)', v_img)) ->> 'ok'));
  perform pg_temp.rec('the file is not due for deletion yet', 'false', ((pg_temp.asj(v_admin, 'select 1') is not null) and exists (select 1 from jsonb_array_elements(public.community_images_due()) x where x ->> 'id' = v_img::text))::text);
  update public.community_posts set removed_at = now() - interval '200 days' where id = v_post;
  perform pg_temp.rec('after the retention period the file is due', 'true',
    (exists (select 1 from jsonb_array_elements(public.community_images_due()) x where x ->> 'id' = v_img::text))::text);
  perform pg_temp.rec('a signed-in user cannot list files due', '42501', pg_temp.try('set local role authenticated; select public.community_images_due()'));
  perform pg_temp.back();
  perform pg_temp.rec('marking it deleted', '1', (public.community_images_mark_deleted(array[v_img]))::text);
  perform pg_temp.rec('...closes the picture to everyone', 'not_found', (pg_temp.asj(v_mod, format('select public.community_image_ref(%L)', v_img)) ->> 'reason'));
  -- a picture post with safety wording
  v_j := pg_temp.asj(v_p3, format($q$select public.community_submit_post_with_image(%L, null, 'a test crisis phrase', null, %L, 'image/png', 5000, 100, 100)$q$, v_g, v_g::text || '/' || gen_random_uuid()::text || '.png'));
  perform pg_temp.rec('a picture post with safety wording is withheld', 'withheld', (v_j ->> 'status'));
  v_post2 := (v_j ->> 'post_id')::uuid;
  select id into v_img from public.community_post_images where post_id = v_post2;
  perform pg_temp.rec('the moderator cannot open its picture', 'not_found', (pg_temp.asj(v_mod, format('select public.community_image_ref(%L)', v_img)) ->> 'reason'));
  perform pg_temp.rec('the safety reviewer can', 'true', (pg_temp.asj(v_rev, format('select public.community_image_ref(%L)', v_img)) ->> 'ok'));
  perform pg_temp.rec('the safety queue shows the picture', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_rev, 'select public.community_safety_queue()') -> 'items') i where i ->> 'post_id' = v_post2::text and i ->> 'image_id' = v_img::text))::text);

  -- 4. Moderator tools -------------------------------------------------------------------------------------------------------------------
  v_j := pg_temp.sub(v_p4, v_g, 'A live post the moderator will remove');
  v_post := (v_j ->> 'post_id')::uuid;
  perform pg_temp.rec('a moderator can list recent posts', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_mod, format('select public.community_mod_recent(%L)', v_g)) -> 'items') i where i ->> 'post_id' = v_post::text))::text);
  perform pg_temp.rec('...but not a safety post', 'false',
    (pg_temp.asj(v_mod, format('select public.community_mod_recent(%L)', v_g))::text like '%' || v_post2::text || '%')::text);
  perform pg_temp.rec('a patient cannot list them', '42501', (pg_temp.asj(v_p1, 'select public.community_mod_recent()') ->> 'error'));
  perform pg_temp.rec('the moderator removes a live post', 'removed', (pg_temp.asj(v_mod, format($q$select public.community_mod_decide(%L, 'remove', 'unwanted')$q$, v_post)) ->> 'status'));
  perform pg_temp.rec('...and it leaves the feed', 'false',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_p2, format('select public.community_feed(%L)', v_g)) -> 'posts') x where x ->> 'id' = v_post::text))::text);

  -- 2. Rota, coverage, drills ------------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('with no rota every hour is uncovered', '168', (private.community_uncovered_hours('moderator'))::text);
  perform pg_temp.rec('...and the go-live condition is not met', 'false',
    (select (c ->> 'met') from jsonb_array_elements(private.community_go_live_conditions('community')) c where c ->> 'code' = 'moderated_hours_declared'));
  select id into v_staff from public.community_staff where profile_id = v_mod and revoked_at is null;
  perform pg_temp.rec('a patient cannot set a rota', '42501', (pg_temp.asj(v_p1, format($q$select public.community_admin_set_shifts(%L, '[]')$q$, v_staff)) ->> 'error'));
  perform pg_temp.rec('a shift that ends before it starts is refused', 'bad_shifts',
    (pg_temp.asj(v_admin, format($q$select public.community_admin_set_shifts(%L, '[{"weekday":0,"start_hour":10,"end_hour":8}]')$q$, v_staff)) ->> 'reason'));
  perform pg_temp.rec('a day that does not exist is refused', 'bad_shifts',
    (pg_temp.asj(v_admin, format($q$select public.community_admin_set_shifts(%L, '[{"weekday":9,"start_hour":0,"end_hour":8}]')$q$, v_staff)) ->> 'reason'));
  perform pg_temp.asj(v_admin, format($q$select public.community_admin_set_shifts(%L, %L)$q$, v_staff, (select jsonb_agg(jsonb_build_object('weekday', d, 'start_hour', 0, 'end_hour', 24)) from generate_series(0, 6) d)::text));
  perform pg_temp.rec('a full week of shifts covers every moderator hour', '0', (private.community_uncovered_hours('moderator'))::text);
  perform pg_temp.rec('...but not the safety reviewer hours', '168', (private.community_uncovered_hours('safety_reviewer'))::text);
  perform pg_temp.rec('...so the condition is still not met', 'false',
    (select (c ->> 'met') from jsonb_array_elements(private.community_go_live_conditions('community')) c where c ->> 'code' = 'moderated_hours_declared'));
  select id into v_staff from public.community_staff where profile_id = v_rev and revoked_at is null;
  perform pg_temp.asj(v_admin, format($q$select public.community_admin_set_shifts(%L, %L)$q$, v_staff, (select jsonb_agg(jsonb_build_object('weekday', d, 'start_hour', h.s, 'end_hour', h.e)) from generate_series(0, 6) d, (values (0, 12), (12, 24)) h(s, e))::text));
  perform pg_temp.rec('two spans per day cover the safety reviewer week', '0', (private.community_uncovered_hours('safety_reviewer'))::text);
  perform pg_temp.rec('...and now the condition is met', 'true',
    (select (c ->> 'met') from jsonb_array_elements(private.community_go_live_conditions('community')) c where c ->> 'code' = 'moderated_hours_declared'));
  perform pg_temp.rec('the coverage report is for admins', '42501', (pg_temp.asj(v_p1, 'select public.community_coverage()') ->> 'error'));
  perform pg_temp.rec('...and shows no gaps now', '0', (jsonb_array_length(pg_temp.asj(v_admin, 'select public.community_coverage()') -> 'gaps'))::text);
  perform pg_temp.rec('a drill cannot be recorded by an admin', '42501', (pg_temp.asj(v_admin, $q$select public.community_record_tabletop(true, 'ok', '[]')$q$) ->> 'error'));
  perform pg_temp.rec('...so the drill condition is not met', 'false',
    (select (c ->> 'met') from jsonb_array_elements(private.community_go_live_conditions('community')) c where c ->> 'code' = 'tabletop_passed'));
  perform pg_temp.rec('the CMO records a passing drill', 'ok', (pg_temp.asj(v_cmo, $q$select public.community_record_tabletop(true, 'Self-harm phrase withheld, reviewer saw it, card shown.', '[{"step":"withheld","ok":true}]')$q$) ->> 'status'));
  perform pg_temp.rec('...and the drill condition is met', 'true',
    (select (c ->> 'met') from jsonb_array_elements(private.community_go_live_conditions('community')) c where c ->> 'code' = 'tabletop_passed'));
  perform pg_temp.rec('the drill list shows who ran it', 'COM cmo', (pg_temp.asj(v_admin, 'select public.community_tabletop_runs()') -> 'runs' -> 0 ->> 'run_by_name'));

  -- 3. Overdue work ----------------------------------------------------------------------------------------------------------------------
  update public.community_safety_signals set created_at = now() - interval '2 hours' where post_id = v_post2;
  perform pg_temp.rec('an old safety item is counted overdue', 'true', ((public.community_overdue_work() ->> 'safety_overdue')::int >= 1)::text);
  perform pg_temp.rec('the safety reviewer and the CMO are told', 'true', (public.community_notify_overdue() >= 2)::text);
  perform pg_temp.rec('...with the fixed notice', '1', (select count(*)::text from public.notifications where recipient_id = v_rev and template = 'community_overdue'));
  perform pg_temp.rec('...and a second run within ten minutes adds nothing', '1', (public.community_notify_overdue() * 0 + (select count(*) from public.notifications where recipient_id = v_rev and template = 'community_overdue'))::text);
  perform pg_temp.rec('a signed-in user cannot run the overdue job', '42501', (pg_temp.asj(v_admin, 'select public.community_notify_overdue()') ->> 'error'));

  -- 5. Doctor question sessions ---------------------------------------------------------------------------------------------------------------
  perform pg_temp.joined(v_p5, v_g);
  perform pg_temp.rec('a patient cannot create a session', '42501',
    (pg_temp.asj(v_p1, format($q$select public.community_admin_create_qa('Ask the doctors', 'Text only', now(), now() + interval '2 hours', %L, %L)$q$, array[v_doc], array[v_g])) ->> 'error'));
  perform pg_temp.rec('a session needs a real doctor', 'not_a_doctor',
    (pg_temp.asj(v_admin, format($q$select public.community_admin_create_qa('Ask the doctors', 'Text only', now(), now() + interval '2 hours', %L, %L)$q$, array[v_mod], array[v_g])) ->> 'reason'));
  perform pg_temp.rec('a session cannot run longer than twelve hours', 'bad_window',
    (pg_temp.asj(v_admin, format($q$select public.community_admin_create_qa('Ask the doctors', 'Text only', now(), now() + interval '13 hours', %L, %L)$q$, array[v_doc], array[v_g])) ->> 'reason'));
  v_j := pg_temp.asj(v_admin, format($q$select public.community_admin_create_qa('Ask the doctors', 'Text only. General information, not a diagnosis.', now(), now() + interval '2 hours', %L, %L)$q$, array[v_doc], array[v_g]));
  perform pg_temp.rec('an admin creates a session', 'ok', (v_j ->> 'status'));
  v_series := (v_j ->> 'series_id')::uuid;
  select id into v_sess from public.community_qa_sessions where series_id = v_series and group_id = v_g;
  v_j := pg_temp.asj(v_p1, format('select public.community_get_group(%L)', v_slug));
  perform pg_temp.rec('members see the session is open', 'open', (v_j -> 'qa' ->> 'status'));
  perform pg_temp.rec('...with the doctor''s real name', 'COM doc', (v_j -> 'qa' -> 'doctors' ->> 0));
  v_j := pg_temp.asj(v_p1, format($q$select public.community_ask_question(%L, %L, 'Is it safe to exercise with high blood pressure?', null)$q$, v_g, v_sess));
  perform pg_temp.rec('a member asks a question and it is published', 'published', (v_j ->> 'status'));
  v_post := (v_j ->> 'post_id')::uuid;
  perform pg_temp.rec('a question with a phone number is blocked', 'blocked', (pg_temp.asj(v_p1, format($q$select public.community_ask_question(%L, %L, 'call me on 08031234567', null)$q$, v_g, v_sess)) ->> 'status'));
  perform pg_temp.asj(v_p1, format($q$select public.community_ask_question(%L, %L, 'A second question about salt', null)$q$, v_g, v_sess));
  perform pg_temp.asj(v_p1, format($q$select public.community_ask_question(%L, %L, 'A third question about sleep', null)$q$, v_g, v_sess));
  perform pg_temp.rec('a fourth question is over the limit', 'qa_limit', (pg_temp.asj(v_p1, format($q$select public.community_ask_question(%L, %L, 'A fourth question about tea', null)$q$, v_g, v_sess)) ->> 'reason'));
  perform pg_temp.rec('a non-member cannot ask', 'not_a_member', (pg_temp.asj(v_out, format($q$select public.community_ask_question(%L, %L, 'May I ask something?', null)$q$, v_g, v_sess)) ->> 'reason'));
  -- a new member's first question waits for a moderator, so the doctors do not see it yet
  v_j := pg_temp.asj(v_p5, format($q$select public.community_ask_question(%L, %L, 'My first question as a new member', null)$q$, v_g, v_sess));
  perform pg_temp.rec('a new member''s first question waits for a moderator', 'held', (v_j ->> 'status'));
  v_j := pg_temp.asj(v_doc, 'select public.community_qa_doctor_sessions()');
  perform pg_temp.rec('the named doctor sees the session', 'true', (jsonb_array_length(v_j -> 'sessions') = 1 and (v_j -> 'sessions' -> 0 ->> 'can_answer')::boolean)::text);
  perform pg_temp.rec('another doctor sees none', '0', (jsonb_array_length(pg_temp.asj(v_doc2, 'select public.community_qa_doctor_sessions()') -> 'sessions'))::text);
  v_j := pg_temp.asj(v_doc, format('select public.community_qa_doctor_questions(%L)', v_series));
  perform pg_temp.rec('the doctor sees the published questions only', '3', (jsonb_array_length(v_j -> 'questions'))::text);
  perform pg_temp.rec('...with a handle and no account id', 'false', (v_j::text like '%' || v_p1::text || '%')::text);
  perform pg_temp.rec('a doctor who is not named cannot read the questions', '42501', (pg_temp.asj(v_doc2, format('select public.community_qa_doctor_questions(%L)', v_series)) ->> 'error'));
  perform pg_temp.rec('a doctor who is not named cannot answer', '42501', (pg_temp.asj(v_doc2, format($q$select public.community_qa_answer(%L, 'Yes, gentle exercise helps most people.')$q$, v_post)) ->> 'error'));
  perform pg_temp.rec('a patient cannot answer', '42501', (pg_temp.asj(v_p2, format($q$select public.community_qa_answer(%L, 'Yes, gentle exercise helps most people.')$q$, v_post)) ->> 'error'));
  perform pg_temp.rec('an answer with a phone number is refused', 'text_not_allowed', (pg_temp.asj(v_doc, format($q$select public.community_qa_answer(%L, 'Call me on 08031234567 and I will explain.')$q$, v_post)) ->> 'reason'));
  perform pg_temp.rec('the named doctor answers', 'ok', (pg_temp.asj(v_doc, format($q$select public.community_qa_answer(%L, 'Yes. Gentle exercise such as walking most days helps most people with high blood pressure. Check with your own doctor before starting anything hard.')$q$, v_post)) ->> 'status'));
  select id into v_ans from public.community_qa_answers where question_post_id = v_post;
  perform pg_temp.rec('the group sees the answer under the question with the doctor''s name', 'COM doc',
    (select x -> 'answers' -> 0 ->> 'doctor_name' from jsonb_array_elements(pg_temp.asj(v_p2, format('select public.community_feed(%L)', v_g)) -> 'posts') x where x ->> 'id' = v_post::text));
  perform pg_temp.rec('the asker is told', '1', (select count(*)::text from public.notifications where recipient_id = v_p1 and template = 'community_qa_answer'));
  perform pg_temp.rec('a patient cannot remove an answer', '42501', (pg_temp.asj(v_p1, format('select public.community_admin_remove_answer(%L)', v_ans)) ->> 'error'));
  perform pg_temp.rec('an admin removes an answer', 'ok', (pg_temp.asj(v_admin, format('select public.community_admin_remove_answer(%L)', v_ans)) ->> 'status'));
  perform pg_temp.rec('...and it leaves the feed', '0',
    (select jsonb_array_length(x -> 'answers')::text from jsonb_array_elements(pg_temp.asj(v_p2, format('select public.community_feed(%L)', v_g)) -> 'posts') x where x ->> 'id' = v_post::text));
  -- the window closes
  update public.community_qa_sessions set opens_at = now() - interval '4 hours', closes_at = now() - interval '3 hours' where id = v_sess;
  perform pg_temp.rec('after the session closes, new questions are refused', 'qa_closed', (pg_temp.asj(v_p2, format($q$select public.community_ask_question(%L, %L, 'Too late to ask?', null)$q$, v_g, v_sess)) ->> 'reason'));
  perform pg_temp.rec('...and after the grace period answers are refused too', 'qa_closed', (pg_temp.asj(v_doc, format($q$select public.community_qa_answer(%L, 'A late answer that should not be accepted.')$q$, v_post)) ->> 'reason'));
  update public.community_qa_sessions set closes_at = now() - interval '10 minutes' where id = v_sess;
  perform pg_temp.rec('within the grace period a doctor can still answer', 'ok', (pg_temp.asj(v_doc, format($q$select public.community_qa_answer(%L, 'One more point: if you get chest pain or feel faint, stop and seek care.')$q$, v_post)) ->> 'status'));
  perform pg_temp.rec('the admin list shows the session', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_admin, 'select public.community_admin_qa_list()') -> 'sessions') x where x ->> 'series_id' = v_series::text))::text);
  perform pg_temp.rec('an admin can cancel a session', 'ok', (pg_temp.asj(v_admin, format('select public.community_admin_cancel_qa(%L)', v_series)) ->> 'status'));

  -- SABOTAGE -----------------------------------------------------------------------------------------------------------------------------
  -- (a) the picture access check lets everyone in: a non-member must no longer be refused
  v_j := pg_temp.asj(v_p4, format($q$select public.community_submit_post_with_image(%L, null, 'Another picture post here', null, %L, 'image/png', 5000, 100, 100)$q$, v_g, v_g::text || '/' || gen_random_uuid()::text || '.png'));
  select id into v_img from public.community_post_images where post_id = (v_j ->> 'post_id')::uuid;
  create or replace function public.community_image_ref(p_image_id uuid) returns jsonb language sql security definer set search_path = '' as $s$ select jsonb_build_object('ok', true, 'path', 'x', 'mime', 'image/png') $s$;
  insert into results values ('sabotaged', 'a non-member cannot open a waiting picture', 'not_found', coalesce(pg_temp.asj(v_out, format('select public.community_image_ref(%L)', v_img)) ->> 'reason', 'null'));
  -- (b) the coverage count says everything is covered with no rota
  delete from public.community_shifts;
  create or replace function private.community_uncovered_hours(p_scope text) returns integer language sql stable as 'select 0';
  insert into results values ('sabotaged', 'with no rota the hours are uncovered', '168', private.community_uncovered_hours('moderator')::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'community images, rota and Q&A proof FAILED: %',
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
