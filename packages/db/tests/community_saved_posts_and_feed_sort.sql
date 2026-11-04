-- Community saved posts and feed order (migration *_community_saved_posts_and_feed_sort.sql).
-- One rolled-back transaction. Proves: a member saves and unsaves a top-level post they can read; a reply, someone else's held post and a
-- group they are not in all give the same 'not_found'; the saved list shows only posts the member can still read (leaving the group or
-- hiding the author drops them); i_saved is per member; 'discussed' orders by visible replies over the last 30 days and is one page;
-- 'latest' is unchanged; an unknown order is refused; nothing is reachable by anon or by a direct table read.
-- SABOTAGE: the saved list's reader check removed; a post from a group the member left reappears. Must flip.
--
--   psql -f packages/db/tests/community_saved_posts_and_feed_sort.sql   (against a database where the community migrations are applied)

begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'csv-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'CSV ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
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
create function pg_temp.sub(p_uid uuid, p_group uuid, p_body text, p_parent uuid default null) returns jsonb language sql as
$f$ select pg_temp.asj(p_uid, format('select public.community_submit_post(%L, %L, %L, %L)', p_group, p_parent, p_body, gen_random_uuid())) $f$;
create function pg_temp.joined(p_uid uuid, p_group uuid) returns jsonb language sql as
$f$ select pg_temp.asj(p_uid, format('select public.community_join_group(%L, %s, true)', p_group, (select rules_version from public.community_groups where id = p_group))) $f$;
create function pg_temp.saved_ids(p_uid uuid) returns text language sql as
$f$ select coalesce((select string_agg(e ->> 'id', ',' order by e ->> 'saved_at' desc) from jsonb_array_elements(pg_temp.asj(p_uid, 'select public.community_saved_list()') -> 'posts') e), '') $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_p1 uuid; v_p2 uuid; v_p3 uuid; v_g uuid; v_g2 uuid; v_j jsonb;
  v_a uuid; v_b uuid; v_old uuid; v_reply uuid; v_held uuid; v_other uuid;
begin
  select id into v_org from public.organisations order by id limit 1;
  if v_org is null then insert into public.organisations (name) values ('community proof org') returning id into v_org; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_p1 := pg_temp.mkuser(v_org, 'p1', 'patient'); v_p2 := pg_temp.mkuser(v_org, 'p2', 'patient'); v_p3 := pg_temp.mkuser(v_org, 'p3', 'patient');

  -- posting fails closed without a live rule set; a fresh replay has none, so make the seeded set 1 live (as the other community proofs do)
  update public.community_filter_rule_sets set status = 'retired' where status = 'active';
  perform pg_temp.asj(v_admin, 'select public.community_admin_rule_set_activate(1)');

  v_j := pg_temp.asj(v_admin, $q$select public.community_admin_save_group(null, 'Proof saved group', 'proof-saved', 'x', 'hypertension', 'Be kind.', 'open', null)$q$);
  v_g := (v_j ->> 'id')::uuid;
  perform pg_temp.asj(v_admin, format('select public.community_admin_save_group(%L, null, null, null, null, null, null, ''active'')', v_g));
  v_j := pg_temp.asj(v_admin, $q$select public.community_admin_save_group(null, 'Proof other group', 'proof-saved-other', 'x', 'diabetes', 'Be kind.', 'open', null)$q$);
  v_g2 := (v_j ->> 'id')::uuid;
  perform pg_temp.asj(v_admin, format('select public.community_admin_save_group(%L, null, null, null, null, null, null, ''active'')', v_g2));
  perform pg_temp.joined(v_p1, v_g); perform pg_temp.joined(v_p2, v_g); perform pg_temp.joined(v_p3, v_g2);

  -- posts: an old busy thread (aged 40 days below), A (one reply), then B (two replies, the newest)
  v_old := (pg_temp.sub(v_p1, v_g, 'An old thread about walking every evening.') ->> 'post_id')::uuid;
  perform pg_temp.sub(v_p2, v_g, 'Walking helped me too.', v_old);
  perform pg_temp.sub(v_p2, v_g, 'I walk after dinner.', v_old);
  perform pg_temp.sub(v_p2, v_g, 'Still walking.', v_old);
  v_a := (pg_temp.sub(v_p1, v_g, 'How do you remember your evening tablets?') ->> 'post_id')::uuid;
  v_reply := (pg_temp.sub(v_p2, v_g, 'I keep them by the kettle.', v_a) ->> 'post_id')::uuid;
  v_b := (pg_temp.sub(v_p1, v_g, 'What has helped you eat less salt?') ->> 'post_id')::uuid;
  perform pg_temp.sub(v_p2, v_g, 'Cooking at home.', v_b);
  perform pg_temp.sub(v_p2, v_g, 'Less stock cubes.', v_b);
  v_held := (pg_temp.sub(v_p1, v_g, 'herbal detox for sale, dm for price') ->> 'post_id')::uuid;
  v_other := (pg_temp.sub(v_p3, v_g2, 'A post in a group p2 is not in.') ->> 'post_id')::uuid;
  perform pg_temp.rec('fixture posts published', 'true', (v_a is not null and v_b is not null and v_reply is not null and v_old is not null and v_other is not null)::text);
  perform pg_temp.rec('selling post held (fixture)', 'held', (select state::text from public.community_posts where id = v_held));

  -- ageing a post is an operator act the guard forbids; disable it for one statement
  alter table public.community_posts disable trigger community_posts_guard;
  update public.community_posts set created_at = now() - interval '40 days' where id = v_old;
  -- one transaction, one now(): space A and B (and the posts made after them) so "newest first" has an answer
  update public.community_posts set created_at = now() - interval '2 minutes' where id = v_a;
  update public.community_posts set created_at = now() - interval '1 minute' where id = v_b;
  update public.community_posts set created_at = now() - interval '3 minutes' where id in (v_held, v_other);
  alter table public.community_posts enable trigger community_posts_guard;

  -- 1. feed order
  v_j := pg_temp.asj(v_p2, format('select public.community_feed(%L)', v_g));
  perform pg_temp.rec('latest is the default and newest first', v_b::text, v_j -> 'posts' -> 0 ->> 'id');
  perform pg_temp.rec('latest still shows the 40-day-old thread', 'true',
    (exists (select 1 from jsonb_array_elements(v_j -> 'posts') e where e ->> 'id' = v_old::text))::text);
  v_j := pg_temp.asj(v_p2, format($q$select public.community_feed(%L, null, null, 'discussed')$q$, v_g));
  perform pg_temp.rec('discussed puts the most replied first', v_b::text || ',' || v_a::text,
    (select string_agg(e ->> 'id', ',' order by n) from jsonb_array_elements(v_j -> 'posts') with ordinality t(e, n)));
  perform pg_temp.rec('discussed leaves out threads older than 30 days', 'false',
    (exists (select 1 from jsonb_array_elements(v_j -> 'posts') e where e ->> 'id' = v_old::text))::text);
  perform pg_temp.rec('discussed is one page', 'false', v_j ->> 'has_more');
  perform pg_temp.rec('reply_count is the visible reply count', '2', v_j -> 'posts' -> 0 ->> 'reply_count');
  v_j := pg_temp.asj(v_p2, format($q$select public.community_feed(%L, null, null, 'loudest')$q$, v_g));
  perform pg_temp.rec('an unknown order is refused', 'bad_sort', v_j ->> 'reason');

  -- 2. save and unsave
  v_j := pg_temp.asj(v_p2, format('select public.community_set_saved(%L, true)', v_a));
  perform pg_temp.rec('a member saves a post', 'true', v_j ->> 'saved');
  v_j := pg_temp.asj(v_p2, format('select public.community_set_saved(%L, true)', v_a));
  perform pg_temp.rec('saving twice is harmless', 'true', v_j ->> 'saved');
  perform pg_temp.rec('one row per member and post', '1', (select count(*)::text from public.community_saved_posts where profile_id = v_p2));
  perform pg_temp.rec('the saved list shows it with its group', 'proof-saved',
    pg_temp.asj(v_p2, 'select public.community_saved_list()') -> 'posts' -> 0 ->> 'group_slug');
  v_j := pg_temp.asj(v_p2, format('select public.community_feed(%L)', v_g));
  perform pg_temp.rec('i_saved is true for the saver', 'true',
    (select e ->> 'i_saved' from jsonb_array_elements(v_j -> 'posts') e where e ->> 'id' = v_a::text));
  v_j := pg_temp.asj(v_p1, format('select public.community_feed(%L)', v_g));
  perform pg_temp.rec('i_saved is false for everyone else (the author is never told)', 'false',
    (select e ->> 'i_saved' from jsonb_array_elements(v_j -> 'posts') e where e ->> 'id' = v_a::text));
  perform pg_temp.rec('a reply cannot be saved', 'not_found', pg_temp.asj(v_p2, format('select public.community_set_saved(%L, true)', v_reply)) ->> 'reason');
  perform pg_temp.rec('someone else''s held post cannot be saved', 'not_found', pg_temp.asj(v_p2, format('select public.community_set_saved(%L, true)', v_held)) ->> 'reason');
  perform pg_temp.rec('the author may save their own held post', 'true', pg_temp.asj(v_p1, format('select public.community_set_saved(%L, true)', v_held)) ->> 'saved');
  perform pg_temp.rec('a post in a group you are not in cannot be saved', 'not_found', pg_temp.asj(v_p2, format('select public.community_set_saved(%L, true)', v_other)) ->> 'reason');
  perform pg_temp.rec('an unknown post gives the same answer', 'not_found', pg_temp.asj(v_p2, format('select public.community_set_saved(%L, true)', gen_random_uuid())) ->> 'reason');
  perform pg_temp.rec('a null flag is refused', 'bad_request', pg_temp.asj(v_p2, format('select public.community_set_saved(%L, null)', v_a)) ->> 'reason');
  update public.community_saved_posts set saved_at = now() - interval '1 minute' where profile_id = v_p2;  -- one transaction, one now(): space the saves
  v_j := pg_temp.asj(v_p2, format('select public.community_set_saved(%L, true)', v_b));
  perform pg_temp.rec('newest save first', v_b::text || ',' || v_a::text, pg_temp.saved_ids(v_p2));
  v_j := pg_temp.asj(v_p2, format('select public.community_set_saved(%L, false)', v_b));
  perform pg_temp.rec('unsave removes it', v_a::text, pg_temp.saved_ids(v_p2));

  -- 3. the list follows what the member can read today
  perform pg_temp.asj(v_p2, format('select public.community_hide_author(%L)', v_a));
  perform pg_temp.rec('hiding the author drops the saved post', '', pg_temp.saved_ids(v_p2));
  delete from public.community_hidden_authors where viewer_id = v_p2;
  perform pg_temp.rec('unhiding brings it back', v_a::text, pg_temp.saved_ids(v_p2));
  perform pg_temp.asj(v_p2, format('select public.community_leave_group(%L, false)', v_g));
  perform pg_temp.rec('leaving the group drops it', '', pg_temp.saved_ids(v_p2));
  perform pg_temp.rec('the row itself stays (rejoining restores it)', '1', (select count(*)::text from public.community_saved_posts where profile_id = v_p2));
  perform pg_temp.joined(v_p2, v_g);
  perform pg_temp.rec('rejoining restores it', v_a::text, pg_temp.saved_ids(v_p2));
  perform pg_temp.rec('a non-member''s saved list is empty, not an error', 'true', pg_temp.asj(v_p3, 'select public.community_saved_list()') ->> 'ok');

  -- an erased author leaves author_profile_id null: is_mine must stay a boolean, in the saved list and the feed
  update public.community_posts set author_profile_id = null where id = v_a;
  perform pg_temp.rec('a post whose author was erased is not mine (saved list)', 'false',
    pg_temp.asj(v_p2, 'select public.community_saved_list()') -> 'posts' -> 0 ->> 'is_mine');
  perform pg_temp.rec('a post whose author was erased is not mine (feed)', 'false',
    (select e ->> 'is_mine' from jsonb_array_elements(pg_temp.asj(v_p2, format('select public.community_feed(%L)', v_g)) -> 'posts') e where e ->> 'id' = v_a::text));
  perform pg_temp.rec('latest still reports reply counts', '2',
    (select e ->> 'reply_count' from jsonb_array_elements(pg_temp.asj(v_p2, format('select public.community_feed(%L)', v_g)) -> 'posts') e where e ->> 'id' = v_b::text));

  -- unsaving works after leaving the group (the row is the member's own)
  perform pg_temp.asj(v_p3, format('select public.community_set_saved(%L, true)', v_other));
  perform pg_temp.asj(v_p3, format('select public.community_leave_group(%L, false)', v_g2));
  perform pg_temp.rec('a member who left can still unsave', 'false', pg_temp.asj(v_p3, format('select public.community_set_saved(%L, false)', v_other)) ->> 'saved');
  perform pg_temp.rec('and the row is gone', '0', (select count(*)::text from public.community_saved_posts where profile_id = v_p3));

  -- 4. access
  perform pg_temp.rec('anon cannot save', 'false', has_function_privilege('anon', 'public.community_set_saved(uuid, boolean)', 'EXECUTE')::text);
  perform pg_temp.rec('anon cannot list', 'false', has_function_privilege('anon', 'public.community_saved_list(timestamptz)', 'EXECUTE')::text);
  perform pg_temp.rec('anon cannot read the feed', 'false', has_function_privilege('anon', 'public.community_feed(uuid, timestamptz, integer, text)', 'EXECUTE')::text);
  perform pg_temp.rec('a member cannot read the table directly', '42501', pg_temp.asj(v_p2, 'select to_jsonb(count(*)) from public.community_saved_posts') ->> 'error');
  perform pg_temp.rec('one community_feed signature', '1',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'community_feed'));
  perform pg_temp.rec('the old three-argument call still resolves', 'true',
    pg_temp.asj(v_p2, format('select public.community_feed(p_group_id => %L, p_before => null, p_limit => 5)', v_g)) ->> 'ok');
end $$;

-- SABOTAGE: drop the reader check from the saved list; a member who left the group sees the post again.
do $$
declare v_src text; v_p2 uuid; v_g uuid; v_a uuid;
begin
  select pg_get_functiondef('public.community_saved_list(timestamptz)'::regprocedure) into v_src;
  execute replace(v_src, 'and private.community_reader_ok(po.group_id, v_uid)', '');
  select p.id into v_p2 from public.profiles p where p.full_name = 'CSV p2';
  select g.id into v_g from public.community_groups g where g.slug = 'proof-saved';
  perform pg_temp.asj(v_p2, format('select public.community_leave_group(%L, false)', v_g));
  select s.post_id into v_a from public.community_saved_posts s where s.profile_id = v_p2;
  insert into results values ('sabotage', 'without the reader check a left group''s post shows', v_a::text, pg_temp.saved_ids(v_p2));
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results order by phase desc, check_name;

do $$
declare v_fail integer; v_sab integer;
begin
  select count(*) into v_fail from results where phase = 'real' and expected is distinct from actual;
  select count(*) into v_sab from results where phase = 'sabotage' and expected = actual and actual <> '';
  if v_fail > 0 then raise exception 'community_saved_posts_and_feed_sort: % real check(s) failed', v_fail; end if;
  if v_sab <> 1 then raise exception 'community_saved_posts_and_feed_sort: sabotage did not flip'; end if;
end $$;

rollback;
