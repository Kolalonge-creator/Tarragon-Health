-- Community proof 2 of 3: access and isolation (migrations *_community_schema.sql, *_community_member_rpcs.sql, *_community_staff_admin_rpcs.sql).
--
-- Proves, in one rolled-back transaction:
--   1. All eighteen community tables are RPC-only: RLS on, no policy, and no client role (anon, authenticated, service_role)
--      holds any privilege on any of them. The default privilege that grants new tables to authenticated is neutralised.
--   2. Function privileges: anon and PUBLIC execute nothing; signed-in users execute every public function (each checks its own
--      authority); the purge is for the service role only; no private helper is callable by a client.
--   3. The launch decisions are structural: no sensitive group (COM-2), no group for under-18s (COM-4), groups start as drafts,
--      cannot be deleted, a weight-loss group cannot go live without the CMO's current rules approval (COM-9), and moderation
--      is a grant on an existing role, not a new account role (COM-3).
--   4. The gates: the guard is born off (a real adult is refused, a test account can rehearse), and under-18, 18-tomorrow,
--      no date of birth, dependant and merged accounts are all refused; joining needs consent and the current rules.
--   5. Identity: the feed and the moderator queue carry a handle and never a profile id, and have exactly the listed fields.
--   6. Non-members, members who left and banned members cannot read; every other staff role (hmo, corporate, pharmacist,
--      finance, analyst, lab, payer, provider, ngo, lab liaison, clinician, CMO, admin without a grant) is refused the queues.
--      A scoped moderator sees only their group; a revoked moderator loses access.
--   7. The unmask: admin only, written reason, audit_log, the CMO is told with a fixed notice, and a daily limit holds.
--   Sabotage: a table privilege is granted to authenticated; the age gate is replaced by "true". The matching checks must flip.
--
--   psql -f packages/db/tests/community_access_and_isolation.sql   (against a database where the community migrations are applied)

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

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_mod uuid; v_mod2 uuid; v_rev uuid; v_doc uuid; v_cc uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_real uuid; v_minor uuid; v_edge uuid; v_young uuid; v_nodob uuid; v_dep uuid; v_merged uuid;
  v_g uuid; v_g2 uuid; v_gw uuid; v_rules integer; v_j jsonb; v_post uuid; v_post2 uuid; v_handle text; v_n integer; t text; r record;
  v_staffroles text[] := array['hmo_admin', 'corporate_admin', 'pharmacist', 'finance', 'analyst', 'lab_partner', 'payer_admin', 'provider_org_staff', 'ngo_admin', 'lab_liaison'];
  v_role text; v_u uuid; v_ok boolean; v_keys text; v_staff_id uuid;
begin
  select id into v_org from public.organisations order by id limit 1;
  if v_org is null then insert into public.organisations (name) values ('community proof org') returning id into v_org; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_doc := pg_temp.mkdoc(v_org, v_admin, 'doc', 'senior_medical_officer');
  v_mod := pg_temp.mkuser(v_org, 'mod', 'care_coordinator');
  v_mod2 := pg_temp.mkuser(v_org, 'mod2', 'care_coordinator');
  v_rev := pg_temp.mkuser(v_org, 'rev', 'care_coordinator');
  v_cc := pg_temp.mkuser(v_org, 'cc', 'care_coordinator');
  v_p1 := pg_temp.mkuser(v_org, 'p1', 'patient');
  v_p2 := pg_temp.mkuser(v_org, 'p2', 'patient');
  v_p3 := pg_temp.mkuser(v_org, 'p3', 'patient');
  v_real := pg_temp.mkuser(v_org, 'real', 'patient', false);
  v_minor := pg_temp.mkuser(v_org, 'minor', 'patient');
  v_edge := pg_temp.mkuser(v_org, 'edge18', 'patient');
  v_young := pg_temp.mkuser(v_org, 'almost18', 'patient');
  v_nodob := pg_temp.mkuser(v_org, 'nodob', 'patient');
  v_dep := pg_temp.mkuser(v_org, 'dependant', 'patient');
  v_merged := pg_temp.mkuser(v_org, 'merged', 'patient');
  update public.profiles set date_of_birth = (current_date - interval '17 years')::date where id = v_minor;
  update public.profiles set date_of_birth = (current_date - interval '18 years')::date where id = v_edge;
  update public.profiles set date_of_birth = (current_date - interval '18 years' + interval '1 day')::date where id = v_young;
  update public.profiles set date_of_birth = null where id = v_nodob;
  update public.profiles set is_dependent_account = true where id = v_dep;
  update public.profiles set merged_into_profile_id = v_p1 where id = v_merged;

  -- A live rule set so posting is possible (v1 has no safety rules, so an admin may activate it)
  update public.community_filter_rule_sets set status = 'retired' where status = 'active';
  perform pg_temp.asj(v_admin, 'select public.community_admin_rule_set_activate(1)');

  -- 1. Every community table is unreachable from every client role -------------------------------------------------------
  perform pg_temp.rec('there are eighteen community tables', '18', (select count(*)::text from pg_tables where schemaname = 'public' and tablename like 'community\_%'));
  perform pg_temp.rec('RLS is on for every community table', '18',
    (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'community\_%' and c.relkind = 'r' and c.relrowsecurity));
  perform pg_temp.rec('no community table has a policy (RPC-only)', '0', (select count(*)::text from pg_policies where schemaname = 'public' and tablename like 'community\_%'));
  for r in select tablename as t from pg_tables where schemaname = 'public' and tablename like 'community\_%' loop
    for t in select unnest(array['anon', 'authenticated', 'service_role']) loop
      if has_table_privilege(t, 'public.' || r.t, 'SELECT') or has_table_privilege(t, 'public.' || r.t, 'INSERT')
         or has_table_privilege(t, 'public.' || r.t, 'UPDATE') or has_table_privilege(t, 'public.' || r.t, 'DELETE') then
        perform pg_temp.rec(r.t || ' is reachable by ' || t, 'unreachable', 'REACHABLE');
      end if;
    end loop;
  end loop;
  perform pg_temp.rec('no client role holds any privilege on any community table', 'none',
    coalesce((select string_agg(tn || ':' || rn, ',') from (select tablename as tn, rn from pg_tables, unnest(array['anon', 'authenticated', 'service_role']) as rn
      where schemaname = 'public' and tablename like 'community\_%'
        and (has_table_privilege(rn, 'public.' || tablename, 'SELECT') or has_table_privilege(rn, 'public.' || tablename, 'INSERT'))) x), 'none'));
  perform pg_temp.act(v_p1);
  perform pg_temp.rec('a signed-in patient cannot read posts directly', '42501', pg_temp.try('select * from public.community_posts'));
  perform pg_temp.rec('a signed-in patient cannot read memberships directly', '42501', pg_temp.try('select * from public.community_memberships'));
  perform pg_temp.rec('a signed-in patient cannot write a post directly', '42501',
    pg_temp.try(format('insert into public.community_posts (group_id, author_handle, body) values (%L, ''x'', ''y'')', gen_random_uuid())));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('even an admin cannot read posts directly', '42501', pg_temp.try('select * from public.community_posts'));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot read the groups', '42501', pg_temp.try('select * from public.community_groups'));
  perform pg_temp.back();
  perform pg_temp.act_service();
  perform pg_temp.rec('the service role cannot read memberships', '42501', pg_temp.try('select * from public.community_memberships'));
  perform pg_temp.back();

  -- 2. Function privileges -------------------------------------------------------------------------------------------------
  perform pg_temp.rec('there are at least thirty public community functions', 'true',
    ((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'community\_%') >= 30)::text);
  perform pg_temp.rec('anon can execute no community function', 'none',
    coalesce((select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.proname like 'community\_%' and has_function_privilege('anon', p.oid, 'EXECUTE')), 'none'));
  perform pg_temp.rec('PUBLIC holds execute on no community function', 'none',
    coalesce((select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.proname like 'community\_%' and coalesce(p.proacl::text, '') ~ '(^\{|,)=X'), 'none'));
  perform pg_temp.rec('a signed-in user can execute every public community function except the two scheduled jobs', 'none',
    coalesce((select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'community\_%' and p.proname not in ('community_purge_expired', 'community_send_digests') and not has_function_privilege('authenticated', p.oid, 'EXECUTE')), 'none'));
  perform pg_temp.rec('a signed-in user cannot execute the purge', 'false', has_function_privilege('authenticated', 'public.community_purge_expired()', 'EXECUTE')::text);
  perform pg_temp.rec('only the service role may run the purge', 'true', has_function_privilege('service_role', 'public.community_purge_expired()', 'EXECUTE')::text);
  perform pg_temp.rec('only the service role may run the digest job', 'true,false',
    has_function_privilege('service_role', 'public.community_send_digests()', 'EXECUTE')::text || ',' || has_function_privilege('authenticated', 'public.community_send_digests()', 'EXECUTE')::text);
  perform pg_temp.rec('a signed-in user can execute no private community function', 'none',
    coalesce((select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.proname like 'community\_%' and has_function_privilege('authenticated', p.oid, 'EXECUTE')
         and p.prorettype <> 'trigger'::regtype), 'none'));

  -- 3. Groups: the launch decisions are structural ---------------------------------------------------------------------------
  perform pg_temp.rec('a sensitive group cannot exist (COM-2)', '23514',
    pg_temp.try(format('insert into public.community_groups (organisation_id, slug, name, topic_code, rules_text, sensitivity) values (%L, ''sens-group'', ''Sens'', ''hypertension'', ''r'', ''sensitive'')', v_org)));
  perform pg_temp.rec('a group for under-18s cannot exist (COM-4)', '23514',
    pg_temp.try(format('insert into public.community_groups (organisation_id, slug, name, topic_code, rules_text, min_age) values (%L, ''kids-group'', ''Kids'', ''hypertension'', ''r'', 16)', v_org)));
  perform pg_temp.rec('a group must start as a draft', '42501',
    pg_temp.try(format('insert into public.community_groups (organisation_id, slug, name, topic_code, rules_text, status) values (%L, ''live-group'', ''Live'', ''hypertension'', ''r'', ''active'')', v_org)));
  v_j := pg_temp.asj(v_admin, format($q$select public.community_admin_save_group(null, 'Proof BP group', 'proof-bp-group', 'for the proof', 'hypertension', 'Be kind. Keep contact details out.', 'open', null)$q$));
  v_g := (v_j ->> 'id')::uuid;
  perform pg_temp.rec('an admin creates a draft group', 'draft', (v_j ->> 'group_status'));
  perform pg_temp.rec('there is a group row to try to delete (the check below is not vacuous)', 'true', (exists (select 1 from public.community_groups where id = v_g))::text);
  perform pg_temp.rec('a group cannot be deleted', '42501', pg_temp.try(format('delete from public.community_groups where id = %L', v_g)));
  perform pg_temp.rec('a group''s organisation cannot be changed', '42501', pg_temp.try(format('update public.community_groups set organisation_id = gen_random_uuid() where id = %L', v_g)));
  perform pg_temp.rec('a patient cannot create a group', '42501',
    (pg_temp.asj(v_p1, $q$select public.community_admin_save_group(null, 'Nope group', 'nope-group', 'x', 'hypertension', 'r', 'open', null)$q$) ->> 'error'));
  perform pg_temp.rec('a moderator-only account cannot create a group', '42501',
    (pg_temp.asj(v_cc, $q$select public.community_admin_save_group(null, 'Nope group', 'nope-group', 'x', 'hypertension', 'r', 'open', null)$q$) ->> 'error'));
  v_j := pg_temp.asj(v_admin, format('select public.community_admin_save_group(%L, null, null, null, null, null, null, ''active'')', v_g));
  perform pg_temp.rec('an admin can make a plain group live', 'active', (v_j ->> 'group_status'));
  -- weight loss needs the CMO's rules approval (COM-9)
  v_j := pg_temp.asj(v_admin, $q$select public.community_admin_save_group(null, 'Proof habits group', 'proof-habits', 'x', 'weight_loss', 'No weights. Be kind.', 'open', null)$q$);
  v_gw := (v_j ->> 'id')::uuid;
  perform pg_temp.rec('a weight-loss group cannot go live without CMO-approved rules', '42501',
    (pg_temp.asj(v_admin, format('select public.community_admin_save_group(%L, null, null, null, null, null, null, ''active'')', v_gw)) ->> 'error'));
  perform pg_temp.rec('an admin cannot approve group rules', '42501',
    (pg_temp.asj(v_admin, format('select public.community_cmo_approve_group_rules(%L, 1)', v_gw)) ->> 'error'));
  perform pg_temp.rec('the CMO approves the current rules', 'approved', (pg_temp.asj(v_cmo, format('select public.community_cmo_approve_group_rules(%L, 1)', v_gw)) ->> 'status'));
  perform pg_temp.rec('after the CMO approval the group can go live', 'active',
    (pg_temp.asj(v_admin, format('select public.community_admin_save_group(%L, null, null, null, null, null, null, ''active'')', v_gw)) ->> 'group_status'));
  perform pg_temp.asj(v_admin, format($q$select public.community_admin_save_group(%L, null, null, null, null, 'New rules text.', null, 'read_only')$q$, v_gw));
  perform pg_temp.rec('editing the rules drops the approval', 'false',
    (select (rules_approved_version is not distinct from rules_version)::text from public.community_groups where id = v_gw));
  perform pg_temp.rec('a changed-rules group cannot go live again until re-approved', '42501',
    (pg_temp.asj(v_admin, format('select public.community_admin_save_group(%L, null, null, null, null, null, null, ''active'')', v_gw)) ->> 'error'));

  -- 4. Staff grants (COM-3) -----------------------------------------------------------------------------------------------------
  perform pg_temp.rec('a patient account cannot hold a moderator grant', '42501',
    pg_temp.try(format('insert into public.community_staff (profile_id, scope, granted_by) values (%L, ''moderator'', %L)', v_p1, v_admin)));
  perform pg_temp.rec('a non-admin cannot grant moderation', '42501',
    (pg_temp.asj(v_cmo, format($q$select public.community_admin_grant_staff(%L, 'moderator', null)$q$, v_mod)) ->> 'error'));
  perform pg_temp.rec('an admin grants a care coordinator moderation of one group', 'ok',
    (pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'moderator', %L)$q$, v_mod, v_g)) ->> 'status'));
  perform pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'safety_reviewer', null)$q$, v_rev));
  perform pg_temp.rec('the grant rides on an existing role: no new account role value exists', 'false',
    (exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'user_role' and e.enumlabel ilike '%moderator%'))::text);

  -- 5. The gates: go-live guard, age, account kind ------------------------------------------------------------------------------
  select rules_version into v_rules from public.community_groups where id = v_g;
  perform pg_temp.rec('the community guard is born off', 'false', (select is_on::text from public.go_live_guards where key = 'community'));
  perform pg_temp.rec('guard off: a real (non-test) adult sees the community as not open', 'false', (pg_temp.asj(v_real, 'select public.community_list_groups()') ->> 'open'));
  perform pg_temp.rec('guard off: a real adult cannot join', 'not_open_yet',
    (pg_temp.asj(v_real, format('select public.community_join_group(%L, %s, true)', v_g, v_rules)) ->> 'reason'));
  perform pg_temp.rec('guard off: a test account can rehearse (open)', 'true', (pg_temp.asj(v_p1, 'select public.community_list_groups()') ->> 'open'));
  perform pg_temp.rec('a test adult sees the live group', 'true',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_p1, 'select public.community_list_groups()') -> 'groups') x where x ->> 'slug' = 'proof-bp-group'))::text);
  perform pg_temp.asj(v_admin, $q$select public.community_admin_save_group(null, 'Proof draft group', 'proof-draft', 'x', 'general_health', 'Be kind.', 'open', null)$q$);
  perform pg_temp.rec('a draft group is not listed', 'false',
    (exists (select 1 from jsonb_array_elements(pg_temp.asj(v_p1, 'select public.community_list_groups()') -> 'groups') x where x ->> 'slug' = 'proof-draft'))::text);
  perform pg_temp.rec('a draft group cannot be joined', 'group_closed', (pg_temp.asj(v_p1, format('select public.community_join_group(%L, 1, true)', (select id from public.community_groups where slug = 'proof-draft'))) ->> 'reason'));
  perform pg_temp.rec('a read-only group is listed but closed to posting', 'group_read_only',
    (pg_temp.asj(v_p1, format($q$select public.community_submit_post(%L, null, 'hi', null)$q$, v_gw)) ->> 'reason') || '');
  perform pg_temp.rec('a 17-year-old is refused', 'adults_only', (pg_temp.asj(v_minor, format('select public.community_join_group(%L, %s, true)', v_g, v_rules)) ->> 'reason'));
  perform pg_temp.rec('a member who turns 18 today is accepted', 'joined', (pg_temp.asj(v_edge, format('select public.community_join_group(%L, %s, true)', v_g, v_rules)) ->> 'status'));
  perform pg_temp.rec('a member who turns 18 tomorrow is refused', 'adults_only', (pg_temp.asj(v_young, format('select public.community_join_group(%L, %s, true)', v_g, v_rules)) ->> 'reason'));
  perform pg_temp.rec('no date of birth is refused (fail closed)', 'adults_only', (pg_temp.asj(v_nodob, format('select public.community_join_group(%L, %s, true)', v_g, v_rules)) ->> 'reason'));
  perform pg_temp.rec('a dependant account is refused', 'adults_only', (pg_temp.asj(v_dep, format('select public.community_join_group(%L, %s, true)', v_g, v_rules)) ->> 'reason'));
  perform pg_temp.rec('a merged account is refused', 'adults_only', (pg_temp.asj(v_merged, format('select public.community_join_group(%L, %s, true)', v_g, v_rules)) ->> 'reason'));
  perform pg_temp.rec('joining needs the consent', 'consent_needed', (pg_temp.asj(v_p1, format('select public.community_join_group(%L, %s, false)', v_g, v_rules)) ->> 'reason'));
  perform pg_temp.rec('joining needs the current rules', 'rules_changed', (pg_temp.asj(v_p1, format('select public.community_join_group(%L, %s, true)', v_g, v_rules + 7)) ->> 'reason'));
  perform pg_temp.rec('a draft group cannot be joined', 'group_closed', (pg_temp.asj(v_p1, format('select public.community_join_group(%L, 1, true)', (select id from public.community_groups where slug = 'proof-habits'))) ->> 'reason'));

  v_j := pg_temp.asj(v_p1, format('select public.community_join_group(%L, %s, true)', v_g, v_rules));
  v_handle := v_j ->> 'handle';
  perform pg_temp.rec('a member joins and is given a system-issued handle', 'joined', (v_j ->> 'status'));
  perform pg_temp.rec('the handle is adjective-noun-number', 'true', (v_handle ~ '^[a-z]{3,12}-[a-z]{3,12}-[0-9]{2,3}$')::text);
  perform pg_temp.rec('joining again gives the same handle', v_handle, (pg_temp.asj(v_p1, format('select public.community_join_group(%L, %s, true)', v_g, v_rules)) ->> 'handle'));
  perform pg_temp.rec('the consent version is recorded', 'DRAFT-UNAPPROVED', (select consent_version from public.community_memberships where group_id = v_g and profile_id = v_p1));
  perform pg_temp.asj(v_p2, format('select public.community_join_group(%L, %s, true)', v_g, v_rules));

  -- 6. Identity never leaves the database ----------------------------------------------------------------------------------------
  -- p1 posts; as a new member the post waits for a moderator (pre-moderation)
  v_j := pg_temp.asj(v_p1, format($q$select public.community_submit_post(%L, null, 'Hello from the proof group', gen_random_uuid())$q$, v_g));
  v_post := (v_j ->> 'post_id')::uuid;
  perform pg_temp.rec('a new member''s first post waits for a moderator', 'held', (v_j ->> 'status'));
  perform pg_temp.rec('another member does not see a held post', '0',
    (jsonb_array_length(pg_temp.asj(v_p2, format('select public.community_feed(%L)', v_g)) -> 'posts'))::text);
  perform pg_temp.rec('the author sees their own held post, marked as waiting', 'true',
    ((pg_temp.asj(v_p1, format('select public.community_feed(%L)', v_g)) -> 'posts' -> 0 ->> 'pending_review'))::text);
  -- the scoped moderator sees the post with a handle and no identity
  v_j := pg_temp.asj(v_mod, format('select public.community_mod_queue(%L)', v_g));
  perform pg_temp.rec('the moderator sees the held post', '1', (jsonb_array_length(v_j -> 'items'))::text);
  perform pg_temp.rec('the moderator sees the handle', v_handle, (v_j -> 'items' -> 0 ->> 'author_handle'));
  perform pg_temp.rec('the moderator queue never carries a profile id', 'false', (v_j::text like '%' || v_p1::text || '%')::text);
  select string_agg(k, ',' order by k collate "C") into v_keys from jsonb_object_keys(v_j -> 'items' -> 0) k;
  perform pg_temp.rec('the moderator queue item has exactly these fields', 'author_handle,author_is_new,body,created_at,group_id,group_name,is_reply,post_id,reasons,report_count,report_reasons,state', v_keys);
  perform pg_temp.rec('the moderator approves', 'approved', (pg_temp.asj(v_mod, format($q$select public.community_mod_decide(%L, 'approve', null)$q$, v_post)) ->> 'status'));
  v_j := pg_temp.asj(v_p2, format('select public.community_feed(%L)', v_g));
  perform pg_temp.rec('after approval the other member sees the post', '1', (jsonb_array_length(v_j -> 'posts'))::text);
  perform pg_temp.rec('the feed shows the handle', v_handle, (v_j -> 'posts' -> 0 ->> 'author_handle'));
  perform pg_temp.rec('the feed never carries a profile id', 'false', (v_j::text like '%' || v_p1::text || '%')::text);
  select string_agg(k, ',' order by k collate "C") into v_keys from jsonb_object_keys(v_j -> 'posts' -> 0) k;
  perform pg_temp.rec('a feed post has exactly these fields', 'author_avatar,author_handle,body,created_at,edited_at,i_supported,id,is_mine,pending_review,reply_count,support_count', v_keys);
  perform pg_temp.rec('approving counted toward the author leaving pre-moderation', '1', (select approved_post_count::text from public.community_memberships where group_id = v_g and profile_id = v_p1));

  -- 7. Who can read the community ---------------------------------------------------------------------------------------------------
  perform pg_temp.rec('a non-member cannot read the feed', 'not_a_member', (pg_temp.asj(v_p3, format('select public.community_feed(%L)', v_g)) ->> 'reason'));
  perform pg_temp.rec('a non-member cannot read replies', 'not_a_member', (pg_temp.asj(v_p3, format('select public.community_replies(%L)', v_post)) ->> 'reason'));
  perform pg_temp.rec('a non-member cannot react', 'not_available', (pg_temp.asj(v_p3, format('select public.community_react(%L, true)', v_post)) ->> 'reason'));
  perform pg_temp.rec('a non-member cannot report', 'not_available', (pg_temp.asj(v_p3, format($q$select public.community_report_post(%L, 'other', null)$q$, v_post)) ->> 'reason'));
  perform pg_temp.rec('a non-member cannot post', 'not_a_member', (pg_temp.asj(v_p3, format($q$select public.community_submit_post(%L, null, 'hi', null)$q$, v_g)) ->> 'reason'));
  perform pg_temp.rec('a member can leave', 'left', (pg_temp.asj(v_p2, format('select public.community_leave_group(%L, false)', v_g)) ->> 'status'));
  perform pg_temp.rec('after leaving the feed is closed', 'not_a_member', (pg_temp.asj(v_p2, format('select public.community_feed(%L)', v_g)) ->> 'reason'));
  perform pg_temp.asj(v_p2, format('select public.community_join_group(%L, %s, true)', v_g, v_rules));
  perform pg_temp.rec('rejoining restores access', 'true', (pg_temp.asj(v_p2, format('select public.community_feed(%L)', v_g)) ->> 'ok'));
  -- a ban removes read access too
  insert into public.community_sanctions (profile_id, group_id, kind, reason_code, issued_by) values (v_p2, v_g, 'ban', 'proof', v_admin);
  perform pg_temp.rec('a banned member cannot read', 'not_a_member', (pg_temp.asj(v_p2, format('select public.community_feed(%L)', v_g)) ->> 'reason'));
  perform pg_temp.rec('a banned member cannot rejoin', 'not_allowed', (pg_temp.asj(v_p2, format('select public.community_join_group(%L, %s, true)', v_g, v_rules)) ->> 'reason'));
  delete from public.community_sanctions where profile_id = v_p2;

  -- 8. Every other staff role is refused (nothing is granted by being staff) -------------------------------------------------------------
  foreach v_role in array v_staffroles loop
    v_u := pg_temp.mkuser(v_org, 'st-' || v_role, v_role);
    perform pg_temp.rec(v_role || ': refused the moderation queue', '42501', (pg_temp.asj(v_u, 'select public.community_mod_queue(null)') ->> 'error'));
    perform pg_temp.rec(v_role || ': refused the safety queue', '42501', (pg_temp.asj(v_u, 'select public.community_safety_queue()') ->> 'error'));
    perform pg_temp.rec(v_role || ': refused group administration', '42501', (pg_temp.asj(v_u, 'select public.community_admin_groups()') ->> 'error'));
    perform pg_temp.rec(v_role || ': refused the unmask', '42501', (pg_temp.asj(v_u, format($q$select public.community_admin_unmask(%L, %L, 'a long enough reason to be accepted')$q$, v_g, v_handle)) ->> 'error'));
    perform pg_temp.rec(v_role || ': cannot read the feed', 'not_a_member', (pg_temp.asj(v_u, format('select public.community_feed(%L)', v_g)) ->> 'reason'));
  end loop;
  perform pg_temp.rec('a clinician is refused the moderation queue', '42501', (pg_temp.asj(v_doc, 'select public.community_mod_queue(null)') ->> 'error'));
  perform pg_temp.rec('a clinician is refused the safety queue', '42501', (pg_temp.asj(v_doc, 'select public.community_safety_queue()') ->> 'error'));
  perform pg_temp.rec('the CMO is refused the moderation queue unless granted', '42501', (pg_temp.asj(v_cmo, 'select public.community_mod_queue(null)') ->> 'error'));
  perform pg_temp.rec('an admin without a grant is refused the moderation queue', '42501', (pg_temp.asj(v_admin, 'select public.community_mod_queue(null)') ->> 'error'));
  perform pg_temp.rec('a care coordinator without a grant is refused the moderation queue', '42501', (pg_temp.asj(v_cc, 'select public.community_mod_queue(null)') ->> 'error'));
  perform pg_temp.rec('a moderator is refused the safety queue', '42501', (pg_temp.asj(v_mod, 'select public.community_safety_queue()') ->> 'error'));
  perform pg_temp.rec('a safety reviewer is refused the moderation queue', '42501', (pg_temp.asj(v_rev, 'select public.community_mod_queue(null)') ->> 'error'));
  perform pg_temp.rec('a safety reviewer reaches the safety queue', '0', (jsonb_array_length(pg_temp.asj(v_rev, 'select public.community_safety_queue()') -> 'items'))::text);
  -- scope: a moderator of one group sees nothing of another
  v_j := pg_temp.asj(v_admin, $q$select public.community_admin_save_group(null, 'Proof diabetes group', 'proof-dm-group', 'x', 'diabetes', 'Be kind.', 'open', null)$q$);
  v_g2 := (v_j ->> 'id')::uuid;
  perform pg_temp.asj(v_admin, format('select public.community_admin_save_group(%L, null, null, null, null, null, null, ''active'')', v_g2));
  perform pg_temp.asj(v_p3, format('select public.community_join_group(%L, 1, true)', v_g2));
  v_j := pg_temp.asj(v_p3, format($q$select public.community_submit_post(%L, null, 'First post in the other group', null)$q$, v_g2));
  v_post2 := (v_j ->> 'post_id')::uuid;
  perform pg_temp.rec('the moderator of group one sees nothing of group two', '0',
    (jsonb_array_length(pg_temp.asj(v_mod, 'select public.community_mod_queue(null)') -> 'items'))::text);
  perform pg_temp.rec('...and cannot decide a group-two post', '42501',
    (pg_temp.asj(v_mod, format($q$select public.community_mod_decide(%L, 'approve', null)$q$, v_post2)) ->> 'error'));
  perform pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'moderator', null)$q$, v_mod2));
  perform pg_temp.rec('a moderator with an all-groups grant sees group two', '1',
    (jsonb_array_length(pg_temp.asj(v_mod2, 'select public.community_mod_queue(null)') -> 'items'))::text);
  select id into v_staff_id from public.community_staff where profile_id = v_mod2 and revoked_at is null;
  perform pg_temp.rec('the all-groups grant exists to be revoked (the check below is not vacuous)', 'true', (v_staff_id is not null)::text);
  perform pg_temp.asj(v_admin, format('select public.community_admin_revoke_staff(%L)', v_staff_id));
  perform pg_temp.rec('a revoked moderator loses access', '42501', (pg_temp.asj(v_mod2, 'select public.community_mod_queue(null)') ->> 'error'));

  -- 9. The one place a name is revealed ----------------------------------------------------------------------------------------------
  perform pg_temp.rec('unmask: the CMO is not an admin', '42501', (pg_temp.asj(v_cmo, format($q$select public.community_admin_unmask(%L, %L, 'a long enough reason to be accepted')$q$, v_g, v_handle)) ->> 'error'));
  perform pg_temp.rec('unmask: a short reason is refused', 'reason_too_short', (pg_temp.asj(v_admin, format($q$select public.community_admin_unmask(%L, %L, 'because')$q$, v_g, v_handle)) ->> 'reason'));
  v_j := pg_temp.asj(v_admin, format($q$select public.community_admin_unmask(%L, %L, 'A safety review needs to reach this member urgently.')$q$, v_g, v_handle));
  perform pg_temp.rec('unmask: an admin with a written reason resolves the handle', v_p1::text, (v_j ->> 'profile_id'));
  perform pg_temp.rec('unmask: written to audit_log', '1', (select count(*)::text from public.audit_log where action = 'community_unmask' and actor_id = v_admin));
  perform pg_temp.rec('unmask: the audit row never carries the member''s id (audit_log is readable by org staff and analysts)', 'false',
    (exists (select 1 from public.audit_log where action = 'community_unmask' and (event::text like '%' || v_p1::text || '%' or entity_id::text = v_p1::text)))::text);
  perform pg_temp.rec('unmask: ...nor a name', 'false',
    (exists (select 1 from public.audit_log where action = 'community_unmask' and event::text like '%COM p1%'))::text);
  perform pg_temp.rec('unmask: who was looked up is kept in the private moderation log', 'true',
    (exists (select 1 from public.community_moderation_events where action = 'unmasked' and member_profile_id = v_p1 and actor_id = v_admin))::text);
  perform pg_temp.rec('unmask: the audit row keeps the reason', 'true', (exists (select 1 from public.audit_log where action = 'community_unmask' and event ->> 'reason' like 'A safety review%'))::text);
  perform pg_temp.rec('unmask: the CMO is told, with a fixed notice and no content', '{}',
    (select payload::text from public.notifications where recipient_id = v_cmo and template = 'community_unmask_notice' limit 1));
  perform pg_temp.rec('unmask: an unknown handle resolves to nothing', 'no_such_member',
    (pg_temp.asj(v_admin, format($q$select public.community_admin_unmask(%L, 'nobody-here-99', 'A safety review needs to reach this member urgently.')$q$, v_g)) ->> 'reason'));
  for v_n in 1..5 loop
    perform pg_temp.asj(v_admin, format($q$select public.community_admin_unmask(%L, %L, 'A safety review needs to reach this member urgently.')$q$, v_g, v_handle));
  end loop;
  perform pg_temp.rec('unmask: the daily limit holds', 'daily_limit',
    (pg_temp.asj(v_admin, format($q$select public.community_admin_unmask(%L, %L, 'A safety review needs to reach this member urgently.')$q$, v_g, v_handle)) ->> 'reason'));

  -- 10. SABOTAGE -----------------------------------------------------------------------------------------------------------------------------
  -- (a) hand a client role a table privilege: the direct-read refusal must flip
  grant select on public.community_posts to authenticated;
  perform pg_temp.act(v_p1);
  insert into results values ('sabotaged', 'a patient cannot read posts directly', '42501', pg_temp.try('select * from public.community_posts'));
  perform pg_temp.back();
  revoke select on public.community_posts from authenticated;
  -- (b) disable the age gate: the 17-year-old is let in, so the refusal must flip
  create or replace function private.community_adult(p_profile uuid) returns boolean language sql stable as 'select true';
  insert into results values ('sabotaged', 'a 17-year-old is refused', 'adults_only',
    coalesce(pg_temp.asj(v_minor, format('select public.community_join_group(%L, %s, true)', v_g, v_rules)) ->> 'reason', 'let in'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'community access proof FAILED: %',
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
