-- Community proof 6: search inside own groups, moderator split of a reply, the picture-check flag, the welcome note and the gentle reminder
-- (migration *_community_search_split_nudges.sql). One rolled-back transaction; sabotage steps must flip their checks.
--
--   psql -f packages/db/tests/community_search_split_nudges.sql   (against a database where the community migrations are applied)

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
  v_org uuid; v_admin uuid; v_cmo uuid; v_mod uuid; v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid; v_pn uuid;
  v_g uuid; v_g2 uuid; v_j jsonb; v_post uuid; v_reply uuid; v_img uuid; v_slug text; v_hide uuid; v_n integer; v_pic uuid; v_held uuid;
begin
  -- Where real storage exists the proof cannot upload files, so the file check is answered "yes" for this rolled-back run only.
  if to_regclass('storage.objects') is not null then
    create or replace function private.community_storage_has(p_path text) returns boolean language sql stable as 'select true';
  end if;
  select id into v_org from public.organisations order by id limit 1;
  if v_org is null then insert into public.organisations (name) values ('community proof org') returning id into v_org; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_mod := pg_temp.mkuser(v_org, 'mod', 'care_coordinator');
  v_p1 := pg_temp.mkuser(v_org, 'p1', 'patient'); v_p2 := pg_temp.mkuser(v_org, 'p2', 'patient'); v_p3 := pg_temp.mkuser(v_org, 'p3', 'patient');
  v_p4 := pg_temp.mkuser(v_org, 'p4', 'patient'); v_pn := pg_temp.mkuser(v_org, 'pn', 'patient');

  update public.community_filter_rule_sets set status = 'retired' where status = 'active';
  perform pg_temp.asj(v_admin, 'select public.community_admin_rule_set_activate(1)');
  v_j := pg_temp.asj(v_admin, $q$select public.community_admin_save_group(null, 'Proof search group', 'proof-search', 'x', 'hypertension', 'Be kind.', 'open', null)$q$);
  v_g := (v_j ->> 'id')::uuid;
  select slug into v_slug from public.community_groups where id = v_g;
  perform pg_temp.asj(v_admin, format('select public.community_admin_save_group(%L, null, null, null, null, null, null, ''active'')', v_g));
  v_j := pg_temp.asj(v_admin, $q$select public.community_admin_save_group(null, 'Proof other group', 'proof-other', 'x', 'hypertension', 'Be kind.', 'open', null)$q$);
  v_g2 := (v_j ->> 'id')::uuid;
  perform pg_temp.asj(v_admin, format('select public.community_admin_save_group(%L, null, null, null, null, null, null, ''active'')', v_g2));
  perform pg_temp.asj(v_admin, format($q$select public.community_admin_set_group_images(%L, true)$q$, v_g));
  perform pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'moderator', %L)$q$, v_mod, v_g));
  perform pg_temp.joined(v_p1, v_g); perform pg_temp.joined(v_p2, v_g); perform pg_temp.joined(v_p3, v_g); perform pg_temp.joined(v_pn, v_g);
  perform pg_temp.joined(v_p2, v_g2); perform pg_temp.joined(v_p4, v_g2);
  update public.community_memberships set approved_post_count = 10 where profile_id in (v_p1, v_p2, v_p3, v_p4);

  -- 1. Search: own groups only, visible posts only, nothing identifying ----------------------------------------------------------------
  v_post := (pg_temp.sub(v_p1, v_g, 'my evening walking routine helps my pressure') ->> 'post_id')::uuid;
  perform pg_temp.sub(v_p2, v_g2, 'a walking routine for sugar in the other group');
  perform pg_temp.rec('setup: the post is showing', 'visible', (select state from public.community_posts where id = v_post));
  v_j := pg_temp.asj(v_p3, 'select public.community_search_posts(''walking'')');
  perform pg_temp.rec('a member finds a post in a group they belong to', '1', (jsonb_array_length(v_j -> 'items'))::text);
  perform pg_temp.rec('...and not the one in a group they have not joined', 'false', (v_j::text like '%other group%')::text);
  perform pg_temp.rec('the search is not case sensitive', '1', (jsonb_array_length(pg_temp.asj(v_p3, 'select public.community_search_posts(''WALKING'')') -> 'items'))::text);
  perform pg_temp.rec('a member of both groups finds both', '2', (jsonb_array_length(pg_temp.asj(v_p2, 'select public.community_search_posts(''walking'')') -> 'items'))::text);
  perform pg_temp.rec('a non-member of any such group finds nothing', '0', (jsonb_array_length(pg_temp.asj(v_p4, format($q$select public.community_search_posts('evening', %L)$q$, v_g)) -> 'items'))::text);
  perform pg_temp.rec('asking for a group you have not joined finds nothing', '0', (jsonb_array_length(pg_temp.asj(v_p3, format($q$select public.community_search_posts('walking', %L)$q$, v_g2)) -> 'items'))::text);
  perform pg_temp.rec('a very short search is refused', 'bad_query', (pg_temp.asj(v_p3, 'select public.community_search_posts(''ab'')') ->> 'reason'));
  perform pg_temp.rec('the answer carries a made-up name and no account id', 'false', (v_j::text like '%' || v_p1::text || '%')::text);
  -- a held post and a removed post are never found
  update public.community_memberships set approved_post_count = 0 where profile_id = v_pn and group_id = v_g;
  v_held := (pg_temp.sub(v_pn, v_g, 'a held newcomer walking note') ->> 'post_id')::uuid;
  perform pg_temp.rec('setup: the newcomer''s first post is held', 'held', (select state from public.community_posts where id = v_held));
  perform pg_temp.rec('a held post is not found', '1', (jsonb_array_length(pg_temp.asj(v_p3, 'select public.community_search_posts(''walking'')') -> 'items'))::text);
  -- a person the member has hidden is left out
  perform pg_temp.asj(v_p3, format('select public.community_hide_author(%L)', v_post));
  perform pg_temp.rec('a person the member hid is left out of their search', '0', (jsonb_array_length(pg_temp.asj(v_p3, 'select public.community_search_posts(''walking'')') -> 'items'))::text);
  perform pg_temp.rec('...but still found by others', '1', (jsonb_array_length(pg_temp.asj(v_p2, format($q$select public.community_search_posts('evening', %L)$q$, v_g)) -> 'items'))::text);
  perform pg_temp.asj(v_mod, format($q$select public.community_mod_decide(%L, 'remove', 'off_topic')$q$, v_post));
  perform pg_temp.rec('a removed post is not found', '0', (jsonb_array_length(pg_temp.asj(v_p2, format($q$select public.community_search_posts('evening', %L)$q$, v_g)) -> 'items'))::text);
  perform pg_temp.rec('the service role cannot search (members only)', 'true', (not has_function_privilege('service_role', 'public.community_search_posts(text,uuid,timestamptz)', 'EXECUTE'))::text);
  perform pg_temp.rec('anon cannot search', 'true', (not has_function_privilege('anon', 'public.community_search_posts(text,uuid,timestamptz)', 'EXECUTE'))::text);

  -- 2. A moderator turns a reply into its own post ---------------------------------------------------------------------------------------
  v_post := (pg_temp.sub(v_p1, v_g, 'a question about salt and dinner') ->> 'post_id')::uuid;
  v_reply := (pg_temp.sub(v_p2, v_g, 'actually I wanted to ask about exercise instead', v_post) ->> 'post_id')::uuid;
  perform pg_temp.rec('setup: it is a reply', 'true', ((select parent_post_id from public.community_posts where id = v_reply) is not null)::text);
  perform pg_temp.rec('a patient cannot split a reply', '42501', (pg_temp.asj(v_p3, format('select public.community_mod_split_reply(%L)', v_reply)) ->> 'error'));
  perform pg_temp.rec('a top-level post cannot be split', 'not_a_reply', (pg_temp.asj(v_mod, format('select public.community_mod_split_reply(%L)', v_post)) ->> 'reason'));
  perform pg_temp.rec('a hand edit cannot move a reply', '42501', pg_temp.try(format('update public.community_posts set parent_post_id = null where id = %L', v_reply)));
  perform pg_temp.rec('the moderator splits it', 'split', (pg_temp.asj(v_mod, format('select public.community_mod_split_reply(%L)', v_reply)) ->> 'status'));
  perform pg_temp.rec('...it is now its own post in the same group', 'true',
    (select (parent_post_id is null and group_id = v_g and body = 'actually I wanted to ask about exercise instead')::text from public.community_posts where id = v_reply));
  perform pg_temp.rec('...and shows in the feed as a top-level post', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_p3, format('select public.community_feed(%L)', v_g)) -> 'posts') x where x ->> 'id' = v_reply::text))::text);
  perform pg_temp.rec('...and the split is written in the log', '1', (select count(*)::text from public.community_moderation_events where action = 'split_to_post' and subject_id = v_reply));
  perform pg_temp.rec('the author is told nothing', '0', (select count(*)::text from public.notifications where recipient_id = v_p2 and template ilike '%split%'));
  perform pg_temp.rec('splitting it again is refused', 'not_a_reply', (pg_temp.asj(v_mod, format('select public.community_mod_split_reply(%L)', v_reply)) ->> 'reason'));

  -- 3. The automatic picture check can only add a flag ---------------------------------------------------------------------------------
  v_img := gen_random_uuid();
  v_j := pg_temp.asj(v_p1, format($q$select public.community_submit_post_with_image(%L, null, 'My home cuff reading', null, %L, 'image/jpeg', 120000, 800, 600)$q$, v_g, v_g::text || '/' || v_p1::text || '/' || v_img::text || '.jpg'));
  v_pic := (v_j ->> 'post_id')::uuid;
  perform pg_temp.rec('setup: a picture post is held', 'held', (select state from public.community_posts where id = v_pic));
  perform pg_temp.rec('a signed-in member cannot mark a picture flagged', 'true', (not has_function_privilege('authenticated', 'public.community_mark_image_flagged(uuid)', 'EXECUTE'))::text);
  perform pg_temp.act_service();
  perform pg_temp.rec('the service role can flag a held picture post', 'true', (public.community_mark_image_flagged(v_pic))::text);
  perform pg_temp.rec('...once only', 'false', (public.community_mark_image_flagged(v_pic))::text);
  perform pg_temp.rec('a held post with no picture cannot be flagged', 'false', (public.community_mark_image_flagged(v_held))::text);
  perform pg_temp.back();
  perform pg_temp.rec('the moderator sees the flag among the reasons', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_mod, format('select public.community_mod_queue(%L)', v_g)) -> 'items') i
              where i ->> 'post_id' = v_pic::text and (i -> 'reasons') ? 'image_flagged'))::text);
  perform pg_temp.rec('a flag never releases or removes the post: it is still held', 'held', (select state from public.community_posts where id = v_pic));

  -- 4. The welcome note and the gentle reminder ----------------------------------------------------------------------------------------
  perform pg_temp.rec('a member who has just joined is a new member', 'true', (pg_temp.asj(v_p3, format('select public.community_get_group(%L)', v_slug)) -> 'membership' ->> 'new_member'));
  update public.community_memberships set joined_at = now() - interval '30 days' where profile_id = v_p3 and group_id = v_g;
  perform pg_temp.rec('...and not after the welcome period', 'false', (pg_temp.asj(v_p3, format('select public.community_get_group(%L)', v_slug)) -> 'membership' ->> 'new_member'));
  perform pg_temp.asj(v_p1, format('select public.community_set_digest(%L, true)', v_g));
  insert into public.notifications (organisation_id, recipient_id, channel, template, payload, content_class, created_at)
  values (v_org, v_p1, 'in_app', 'community_reply', '{}', 'non_clinical', now() - interval '5 days'),
         (v_org, v_p3, 'in_app', 'community_reply', '{}', 'non_clinical', now() - interval '5 days'),
         (v_org, v_p2, 'in_app', 'community_reply', '{}', 'non_clinical', now() - interval '1 day');
  perform pg_temp.act_service();
  perform pg_temp.rec('one reminder goes to the member who chose the weekly note and has an old unread reply', '1', (public.community_send_return_nudges())::text);
  perform pg_temp.rec('a second run the same day sends none', '0', (public.community_send_return_nudges())::text);
  perform pg_temp.back();
  perform pg_temp.rec('...to that member only (not one who did not opt in, not a recent reply)', '1',
    (select count(*)::text from public.notifications where template = 'community_reply_waiting'));
  perform pg_temp.rec('...with fixed text: empty payload and no post or group named', 'true',
    (select (payload = '{}'::jsonb and source_id is null and source_table is null and recipient_id = v_p1)::text from public.notifications where template = 'community_reply_waiting'));
  perform pg_temp.rec('the reminder job is for the service role only', 'true,false',
    has_function_privilege('service_role', 'public.community_send_return_nudges()', 'EXECUTE')::text || ',' || has_function_privilege('authenticated', 'public.community_send_return_nudges()', 'EXECUTE')::text);

  -- 5. SABOTAGE -------------------------------------------------------------------------------------------------------------------------
  -- (a) the search ignores the viewer's groups: the non-member would now find posts, so the refusal must flip
  create or replace function private.community_reader_ok(p_group uuid, p_uid uuid) returns boolean language sql stable as 'select true';
  insert into results values ('sabotaged', 'asking for a group you have not joined finds nothing', '0',
    (jsonb_array_length(pg_temp.asj(v_p3, format($q$select public.community_search_posts('walking', %L)$q$, v_g2)) -> 'items'))::text);
  -- (b) allow any parent change: a hand edit could now move a reply, so the refusal must flip
  alter table public.community_posts disable trigger community_posts_guard;
  insert into results values ('sabotaged', 'a hand edit cannot move a reply', '42501', pg_temp.try(format('update public.community_posts set parent_post_id = null where id = %L', v_post)));
  alter table public.community_posts enable trigger community_posts_guard;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'community search and moderation proof FAILED: %',
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
