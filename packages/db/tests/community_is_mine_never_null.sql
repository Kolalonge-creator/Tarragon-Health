-- Community is_mine is never null (migration *_community_is_mine_never_null_in_replies_and_search.sql).
-- One rolled-back transaction. Proves: after an author is erased (author_profile_id null) their reply and their post still load, and
-- community_replies and community_search_posts report is_mine as false (a JSON boolean), while the member's own posts stay true.
-- SABOTAGE: the bare comparison put back in replies, then in search; is_mine turns null in each. Both must flip.
--
--   psql -f packages/db/tests/community_is_mine_never_null.sql   (against a database where the community migrations are applied)

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
  values (v, 'cim-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'CIM ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
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
  v_org uuid; v_admin uuid; v_p1 uuid; v_p2 uuid; v_g uuid; v_j jsonb; v_top uuid; v_reply uuid; v_mine uuid;
begin
  select id into v_org from public.organisations order by id limit 1;
  if v_org is null then insert into public.organisations (name) values ('community proof org') returning id into v_org; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_p1 := pg_temp.mkuser(v_org, 'p1', 'patient'); v_p2 := pg_temp.mkuser(v_org, 'p2', 'patient');

  update public.community_filter_rule_sets set status = 'retired' where status = 'active';
  perform pg_temp.asj(v_admin, 'select public.community_admin_rule_set_activate(1)');
  v_j := pg_temp.asj(v_admin, $q$select public.community_admin_save_group(null, 'Proof is_mine group', 'proof-is-mine', 'x', 'hypertension', 'Be kind.', 'open', null)$q$);
  v_g := (v_j ->> 'id')::uuid;
  perform pg_temp.asj(v_admin, format('select public.community_admin_save_group(%L, null, null, null, null, null, null, ''active'')', v_g));
  perform pg_temp.joined(v_p1, v_g); perform pg_temp.joined(v_p2, v_g);

  v_top := (pg_temp.sub(v_p2, v_g, 'Who else walks every evening with a pedometer?') ->> 'post_id')::uuid;
  v_reply := (pg_temp.sub(v_p1, v_g, 'I walk every evening, pedometer in my pocket.', v_top) ->> 'post_id')::uuid;
  v_mine := (pg_temp.sub(v_p2, v_g, 'My own pedometer reply.', v_top) ->> 'post_id')::uuid;
  perform pg_temp.rec('fixture posts published', 'true', (v_top is not null and v_reply is not null and v_mine is not null)::text);

  -- the author of the reply and of the top post is erased: their posts stay, author_profile_id goes null
  update public.community_posts set author_profile_id = null where id in (v_reply, v_top);

  v_j := pg_temp.asj(v_p2, format('select public.community_replies(%L)', v_top));
  perform pg_temp.rec('replies still load', 'true', v_j ->> 'ok');
  perform pg_temp.rec('an erased author''s reply is not mine (a boolean, not null)', 'false',
    (select e -> 'is_mine' from jsonb_array_elements(v_j -> 'replies') e where e ->> 'id' = v_reply::text)::text);
  perform pg_temp.rec('my own reply is still mine', 'true',
    (select e -> 'is_mine' from jsonb_array_elements(v_j -> 'replies') e where e ->> 'id' = v_mine::text)::text);
  perform pg_temp.rec('no reply carries a null is_mine', '0',
    (select count(*)::text from jsonb_array_elements(v_j -> 'replies') e where jsonb_typeof(e -> 'is_mine') <> 'boolean'));

  v_j := pg_temp.asj(v_p2, 'select public.community_search_posts(''pedometer'')');
  perform pg_temp.rec('search finds all three', '3', jsonb_array_length(v_j -> 'items')::text);
  perform pg_temp.rec('no search hit carries a null is_mine', '0',
    (select count(*)::text from jsonb_array_elements(v_j -> 'items') e where jsonb_typeof(e -> 'is_mine') <> 'boolean'));
  perform pg_temp.rec('an erased author''s post is not mine in search', 'false',
    (select e -> 'is_mine' from jsonb_array_elements(v_j -> 'items') e where e ->> 'id' = v_top::text)::text);
  perform pg_temp.rec('my own post is mine in search', 'true',
    (select e -> 'is_mine' from jsonb_array_elements(v_j -> 'items') e where e ->> 'id' = v_mine::text)::text);

  perform pg_temp.rec('anon cannot read replies', 'false', has_function_privilege('anon', 'public.community_replies(uuid)', 'EXECUTE')::text);
  perform pg_temp.rec('anon cannot search', 'false', has_function_privilege('anon', 'public.community_search_posts(text, uuid, timestamptz)', 'EXECUTE')::text);
end $$;

-- SABOTAGE 1: put the bare comparison back in replies; the erased author's reply comes back with a null is_mine.
do $$
declare v_src text; v_p2 uuid; v_top uuid; v_j jsonb;
begin
  select pg_get_functiondef('public.community_replies(uuid)'::regprocedure) into v_src;
  execute replace(v_src, 'coalesce(r.author_profile_id = v_uid, false)', '(r.author_profile_id = v_uid)');
  select p.id into v_p2 from public.profiles p where p.full_name = 'CIM p2';
  select po.id into v_top from public.community_posts po join public.community_groups g on g.id = po.group_id
   where g.slug = 'proof-is-mine' and po.parent_post_id is null;
  v_j := pg_temp.asj(v_p2, format('select public.community_replies(%L)', v_top));
  insert into results values ('sabotage', 'without the coalesce a reply has a null is_mine', '0',
    (select count(*)::text from jsonb_array_elements(v_j -> 'replies') e where jsonb_typeof(e -> 'is_mine') <> 'boolean'));
end $$;

-- SABOTAGE 2: put the bare comparison back in search; the erased author's post comes back with a null is_mine.
do $$
declare v_src text; v_p2 uuid; v_j jsonb;
begin
  select pg_get_functiondef('public.community_search_posts(text, uuid, timestamptz)'::regprocedure) into v_src;
  execute replace(v_src, 'coalesce(x.author_profile_id = v_uid, false)', '(x.author_profile_id = v_uid)');
  select p.id into v_p2 from public.profiles p where p.full_name = 'CIM p2';
  v_j := pg_temp.asj(v_p2, 'select public.community_search_posts(''pedometer'')');
  insert into results values ('sabotage', 'without the coalesce a search hit has a null is_mine', '0',
    (select count(*)::text from jsonb_array_elements(v_j -> 'items') e where jsonb_typeof(e -> 'is_mine') <> 'boolean'));
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results order by phase desc, check_name;

do $$
declare v_fail integer; v_sab integer;
begin
  select count(*) into v_fail from results where phase = 'real' and expected is distinct from actual;
  select count(*) into v_sab from results where phase = 'sabotage' and expected is distinct from actual;
  if v_fail > 0 then raise exception 'community_is_mine_never_null: % real check(s) failed', v_fail; end if;
  if v_sab <> 2 then raise exception 'community_is_mine_never_null: sabotage did not flip (% of 2)', v_sab; end if;
end $$;

rollback;
