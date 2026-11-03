-- Community live polish (migration *_community_live_polish.sql, decision COM-27): staff are paged, first posts publish at once.
-- One rolled-back transaction; the sabotage steps must flip their checks.
--
--   psql -f packages/db/tests/community_live_polish.sql   (against a database where the community migrations are applied)

begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
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
  values (v, 'clp-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'CLP ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician');
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'CLP ' || p_label, 'MDCN', 'CLP-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      true, p_admin, true, array['en'], 'General practice');
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
create function pg_temp.notices(p_uid uuid, p_kind text) returns text language sql as
$f$ select string_agg(n.channel::text || ':' || n.priority::text, ',' order by n.channel::text)
      from public.notifications n where n.recipient_id = p_uid and n.template = 'community_staff_alert' and n.payload ->> 'kind' = p_kind $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_mod uuid; v_rev uuid; v_other uuid; v_p1 uuid; v_p2 uuid;
  v_g uuid; v_j jsonb; v_post uuid; v_sig uuid;
begin
  select id into v_org from public.organisations order by id limit 1;
  if v_org is null then insert into public.organisations (name) values ('community proof org') returning id into v_org; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_mod := pg_temp.mkuser(v_org, 'mod', 'care_coordinator');
  v_rev := pg_temp.mkdoc(v_org, v_admin, 'rev', 'senior_medical_officer');
  v_other := pg_temp.mkdoc(v_org, v_admin, 'other', 'senior_medical_officer');
  v_p1 := pg_temp.mkuser(v_org, 'p1', 'patient'); v_p2 := pg_temp.mkuser(v_org, 'p2', 'patient');

  -- a live rule set with test safety rules (the CMO's act), an active group, a moderator (coordinator) and a safety reviewer (clinician)
  update public.community_filter_rule_sets set status = 'retired' where status = 'active';
  perform pg_temp.asj(v_admin, 'select public.community_admin_rule_set_activate(1)');
  v_j := pg_temp.asj(v_admin, 'select public.community_admin_rule_set_create(1)');
  perform pg_temp.asj(v_cmo, format($q$select public.community_admin_rule_save(%s, 'self_harm', 'regex', '\ytest crisis phrase\y', 'safety', 'proof only')$q$, v_j ->> 'version'));
  perform pg_temp.asj(v_cmo, format('select public.community_admin_rule_set_activate(%s)', v_j ->> 'version'));
  v_j := pg_temp.asj(v_admin, $q$select public.community_admin_save_group(null, 'Proof polish group', 'proof-polish', 'x', 'hypertension', 'Be kind.', 'open', null)$q$);
  v_g := (v_j ->> 'id')::uuid;
  perform pg_temp.asj(v_admin, format('select public.community_admin_save_group(%L, null, null, null, null, null, null, ''active'')', v_g));
  perform pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'moderator', %L)$q$, v_mod, v_g));
  perform pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'safety_reviewer', null)$q$, v_rev));
  perform pg_temp.joined(v_p1, v_g); perform pg_temp.joined(v_p2, v_g);

  -- 1. configuration: version 2 is the active one and only the first-post hold changed
  perform pg_temp.rec('config v2 is active', '2', (select version::text from public.community_config where is_active));
  perform pg_temp.rec('first-post hold is 0', '0', private.community_cfg_int('new_member_premoderated_posts')::text);
  perform pg_temp.rec('v2 equals v1 apart from the hold', 'true',
    ((select params - 'new_member_premoderated_posts' from public.community_config where version = 2)
      = (select params - 'new_member_premoderated_posts' from public.community_config where version = 1))::text);

  -- 2. a new member's ordinary first post publishes at once and tells nobody
  v_j := pg_temp.sub(v_p1, v_g, 'My first reading this morning was better than last week.');
  perform pg_temp.rec('first ordinary post is published', 'published', v_j ->> 'status');
  perform pg_temp.rec('no staff notice for a published post', '', coalesce(pg_temp.notices(v_mod, 'queue'), ''));
  v_post := (v_j ->> 'post_id')::uuid;

  -- 3. a held post tells the group's moderator on push and the inbox, once per ten minutes
  v_j := pg_temp.sub(v_p1, v_g, 'herbal detox for sale, dm for price');
  perform pg_temp.rec('selling post is held', 'held', v_j ->> 'status');
  perform pg_temp.rec('moderator told of the held post (push + inbox, routine)', 'in_app:routine,push:routine', coalesce(pg_temp.notices(v_mod, 'queue'), ''));
  perform pg_temp.rec('a safety reviewer who is not a moderator is not told of a held post', '', coalesce(pg_temp.notices(v_rev, 'queue'), ''));
  perform pg_temp.sub(v_p1, v_g, 'miracle cure, order now');
  perform pg_temp.rec('a second held post inside ten minutes adds no notice', 'in_app:routine,push:routine', coalesce(pg_temp.notices(v_mod, 'queue'), ''));

  -- 4. a member's report tells the moderator
  delete from public.notifications where recipient_id = v_mod and template = 'community_staff_alert';
  v_j := pg_temp.asj(v_p2, format($q$select public.community_report_post(%L, 'other', 'proof report')$q$, v_post));
  perform pg_temp.rec('report accepted', 'reported', v_j ->> 'status');
  perform pg_temp.rec('moderator told of the report', 'in_app:routine,push:routine', coalesce(pg_temp.notices(v_mod, 'queue'), ''));

  -- 5. a safety signal pages the reviewer and the CMO at once on push, email and inbox; not the moderator, not another doctor
  v_j := pg_temp.sub(v_p2, v_g, 'test crisis phrase');
  perform pg_temp.rec('crisis post is withheld', 'withheld', v_j ->> 'status');
  perform pg_temp.rec('safety reviewer paged (email + inbox + push, critical)', 'email:critical,in_app:critical,push:critical', coalesce(pg_temp.notices(v_rev, 'safety'), ''));
  perform pg_temp.rec('CMO paged too', 'email:critical,in_app:critical,push:critical', coalesce(pg_temp.notices(v_cmo, 'safety'), ''));
  perform pg_temp.rec('moderator without the reviewer scope is not paged', '', coalesce(pg_temp.notices(v_mod, 'safety'), ''));
  perform pg_temp.rec('an unrelated doctor is not paged', '', coalesce(pg_temp.notices(v_other, 'safety'), ''));
  perform pg_temp.rec('a page carries no excerpt, handle or group', 'true',
    (select bool_and(n.payload - 'kind' - 'area' = '{}'::jsonb and n.content_class = 'non_clinical') from public.notifications n where n.template = 'community_staff_alert')::text);
  perform pg_temp.rec('the reviewer (a clinician) is sent to the clinician area', 'clinician',
    (select min(n.payload ->> 'area') from public.notifications n where n.recipient_id = v_rev and n.template = 'community_staff_alert'));
  perform pg_temp.rec('the moderator (a coordinator) is sent to the coordinator area', 'coordinator',
    (select min(n.payload ->> 'area') from public.notifications n where n.recipient_id = v_mod and n.template = 'community_staff_alert'));
  -- a second crisis post pages again: a page is never throttled
  perform pg_temp.sub(v_p2, v_g, 'test crisis phrase again');
  perform pg_temp.rec('a second safety signal pages again', '6', (select count(*)::text from public.notifications n where n.recipient_id = v_rev and n.template = 'community_staff_alert'));

  -- 6. a danger report and a moderator hand-off page the reviewers too
  delete from public.notifications where template = 'community_staff_alert';
  perform pg_temp.asj(v_p1, format($q$select public.community_report_post(%L, 'self_harm_or_danger', 'worried about them')$q$,
    (select id from public.community_posts where author_profile_id = v_p2 and state = 'visible' limit 1)));
  v_j := pg_temp.sub(v_p2, v_g, 'Another ordinary post for the hand-off test.');
  perform pg_temp.asj(v_mod, format($q$select public.community_mod_decide(%L, 'send_to_safety', null)$q$, (v_j ->> 'post_id')::uuid));
  perform pg_temp.rec('moderator hand-off pages the reviewer', 'true', (exists (select 1 from public.notifications n where n.recipient_id = v_rev and n.template = 'community_staff_alert' and n.payload ->> 'kind' = 'safety'))::text);

  -- 7. the overdue notice carries the reader's area
  perform private.community_notify(v_mod, 'community_overdue', v_mod, 'profiles');
  perform pg_temp.rec('overdue notice names the coordinator area', 'coordinator', (select n.payload ->> 'area' from public.notifications n where n.recipient_id = v_mod and n.template = 'community_overdue' limit 1));
end $$;

-- Sabotage: with the page removed from the submit path the reviewer hears nothing; the check above must flip.
do $$
declare v_src text; v_g uuid; v_p uuid; v_rev uuid;
begin
  select pg_get_functiondef('private.community_submit_core(uuid,uuid,text,uuid,jsonb,uuid)'::regprocedure) into v_src;
  execute replace(v_src, $r$perform private.community_alert_staff('safety', p_group_id);$r$, 'null;');
  delete from public.notifications where template = 'community_staff_alert';
  select g.id into v_g from public.community_groups g where g.slug = 'proof-polish';
  select p.id into v_p from public.profiles p where p.full_name = 'CLP p2';
  select p.id into v_rev from public.profiles p where p.full_name = 'CLP rev';
  perform pg_temp.sub(v_p, v_g, 'test crisis phrase third time');
  insert into results values ('sabotage', 'without the page the reviewer hears nothing', '', coalesce(pg_temp.notices(v_rev, 'safety'), ''));
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results order by phase desc, check_name;

do $$
declare v_fail integer; v_sab integer;
begin
  select count(*) into v_fail from results where phase = 'real' and expected is distinct from actual;
  select count(*) into v_sab from results where phase = 'sabotage' and actual = '';
  if v_fail > 0 then raise exception 'community_live_polish: % real check(s) failed', v_fail; end if;
  if v_sab <> 1 then raise exception 'community_live_polish: sabotage did not behave as expected'; end if;
end $$;

rollback;
