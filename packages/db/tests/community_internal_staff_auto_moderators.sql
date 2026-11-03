-- Community: internal staff moderate automatically, an admin can withdraw it (migration *_community_internal_staff_moderate_automatically.sql,
-- decision COM-28). One rolled-back transaction; the sabotage step must flip its check.
--
--   psql -f packages/db/tests/community_internal_staff_auto_moderators.sql

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
-- Real (not test) staff accounts: the automatic grant deliberately skips test accounts, so this proof mints real ones and rolls them back.
create function pg_temp.mkreal(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'cam-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'CAM ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '40 years')::date, false, 'en')
  on conflict (id) do update set role = excluded.role, is_test = false, is_active = true, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.grants(p uuid) returns text language sql as
$f$ select coalesce(string_agg(s.scope || ':' || s.source, ',' order by s.scope), '') from public.community_staff s where s.profile_id = p and s.revoked_at is null and s.group_id is null $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_doc uuid; v_ceo uuid; v_fin uuid; v_cc uuid; v_ext uuid; v_test uuid; v_pat uuid; v_grant uuid; v_j jsonb;
begin
  select id into v_org from public.organisations order by id limit 1;
  if v_org is null then insert into public.organisations (name) values ('community proof org') returning id into v_org; end if;

  -- 1. each internal staff role is a moderator the moment the account exists; external roles, patients and test accounts are not
  v_admin := pg_temp.mkreal(v_org, 'admin', 'admin');
  v_ceo := pg_temp.mkreal(v_org, 'ceo', 'analyst');
  v_fin := pg_temp.mkreal(v_org, 'fin', 'finance');
  v_cc := pg_temp.mkreal(v_org, 'cc', 'care_coordinator');
  v_ext := pg_temp.mkreal(v_org, 'hmo', 'hmo_admin');
  v_pat := pg_temp.mkreal(v_org, 'pat', 'patient');
  perform pg_temp.rec('an admin account is a moderator automatically', 'moderator:automatic', pg_temp.grants(v_admin));
  perform pg_temp.rec('the CEO (analyst) account is a moderator automatically', 'moderator:automatic', pg_temp.grants(v_ceo));
  perform pg_temp.rec('a finance account is a moderator automatically', 'moderator:automatic', pg_temp.grants(v_fin));
  perform pg_temp.rec('a care coordinator is a moderator automatically', 'moderator:automatic', pg_temp.grants(v_cc));
  perform pg_temp.rec('an HMO admin (external) gets nothing', '', pg_temp.grants(v_ext));
  perform pg_temp.rec('a patient gets nothing', '', pg_temp.grants(v_pat));
  v_test := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values (v_test, 'cam-test-' || v_test || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test, language) values (v_test, v_org, 'clinician', 'CAM test clinician', true, 'en')
  on conflict (id) do update set role = 'clinician', is_test = true, is_active = true;
  perform pg_temp.rec('a test account gets nothing automatically', '', pg_temp.grants(v_test));

  -- 2. a doctor also reviews safety signals once their clinical_staff row is active
  v_doc := pg_temp.mkreal(v_org, 'doc', 'clinician');
  perform pg_temp.rec('a clinician account without a working clinical_staff row moderates only', 'moderator:automatic', pg_temp.grants(v_doc));
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (v_org, v_doc, 'CAM doc', 'MDCN', 'CAM-' || substr(v_doc::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', v_admin,
      'senior_medical_officer', 'employed', 2, true, v_admin, false, array['en'], 'General practice');
  perform pg_temp.rec('an active doctor is also a safety reviewer', 'moderator:automatic,safety_reviewer:automatic', pg_temp.grants(v_doc));
  perform pg_temp.rec('the doctor can open the moderation queue', 'true', (pg_temp.asj(v_doc, 'select public.community_mod_queue(null)') ? 'items')::text);
  perform pg_temp.rec('the doctor can open the safety queue', 'true', (pg_temp.asj(v_doc, 'select public.community_safety_queue()') ? 'items')::text);
  perform pg_temp.rec('the CEO can open the moderation queue', 'true', (pg_temp.asj(v_ceo, 'select public.community_mod_queue(null)') ? 'items')::text);
  perform pg_temp.rec('the CEO is not a safety reviewer', '42501', pg_temp.asj(v_ceo, 'select public.community_safety_queue()') ->> 'error');
  perform pg_temp.rec('the HMO admin cannot open the moderation queue', '42501', pg_temp.asj(v_ext, 'select public.community_mod_queue(null)') ->> 'error');

  -- 3. an admin withdraws it, and it does not come back by itself
  select id into v_grant from public.community_staff where profile_id = v_ceo and scope = 'moderator' and revoked_at is null;
  v_j := pg_temp.asj(v_admin, format('select public.community_admin_revoke_staff(%L)', v_grant));
  perform pg_temp.rec('an admin withdraws the CEO grant', 'ok', v_j ->> 'status');
  perform pg_temp.rec('the withdrawal records who did it', 'true', (select (revoked_by = v_admin)::text from public.community_staff where id = v_grant));
  perform pg_temp.rec('the CEO can no longer open the queue', '42501', pg_temp.asj(v_ceo, 'select public.community_mod_queue(null)') ->> 'error');
  update public.profiles set is_active = false where id = v_ceo;
  update public.profiles set is_active = true where id = v_ceo;
  perform pg_temp.rec('reactivating the account does not re-grant what an admin withdrew', '', pg_temp.grants(v_ceo));
  v_j := pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'moderator', null)$q$, v_ceo));
  perform pg_temp.rec('an admin can grant it again by hand', 'moderator:admin', pg_temp.grants(v_ceo));

  -- 4. a role change is enough: a patient promoted to care coordinator becomes a moderator; an account deactivated keeps no live power
  update public.profiles set role = 'care_coordinator' where id = v_pat;
  perform pg_temp.rec('a promotion to an internal role grants moderation', 'moderator:automatic', pg_temp.grants(v_pat));
  update public.profiles set is_active = false where id = v_cc;
  perform pg_temp.rec('a deactivated coordinator cannot moderate', '42501', pg_temp.asj(v_cc, 'select public.community_mod_queue(null)') ->> 'error');

  -- 5. the guard still refuses a hand grant to an external role, and an automatic row never names a granting admin
  perform pg_temp.rec('an admin cannot grant moderation to an HMO admin by hand', '42501',
    pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'moderator', null)$q$, v_ext)) ->> 'error');
  perform pg_temp.rec('no automatic grant names a granting admin', 'true', (select coalesce(bool_and(granted_by is null), true)::text from public.community_staff where source = 'automatic'));
  perform pg_temp.rec('every live grant belongs to an internal staff role', 'true',
    (select coalesce(bool_and(private.community_internal_staff_role(p.role)), true)::text from public.community_staff s join public.profiles p on p.id = s.profile_id where s.revoked_at is null));
  perform pg_temp.rec('a signed-in user cannot call the automatic grant', 'false', has_function_privilege('authenticated', 'private.community_auto_grant(uuid)', 'EXECUTE')::text);
end $$;

-- Sabotage: with the profile trigger gone, a new finance account gets nothing; the check must flip.
do $$
declare v_org uuid; v_fin2 uuid;
begin
  select id into v_org from public.organisations order by id limit 1;
  drop trigger community_auto_grant_profile on public.profiles;
  v_fin2 := pg_temp.mkreal(v_org, 'fin2', 'finance');
  insert into results values ('sabotage', 'without the trigger a new finance account is not a moderator', 'moderator:automatic', pg_temp.grants(v_fin2));
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results order by phase desc, check_name;

do $$
declare v_fail integer; v_sab integer;
begin
  select count(*) into v_fail from results where phase = 'real' and expected is distinct from actual;
  select count(*) into v_sab from results where phase = 'sabotage' and expected is distinct from actual;
  if v_fail > 0 then raise exception 'community_internal_staff_auto_moderators: % real check(s) failed', v_fail; end if;
  if v_sab <> 1 then raise exception 'community_internal_staff_auto_moderators: sabotage did not flip'; end if;
end $$;

rollback;
