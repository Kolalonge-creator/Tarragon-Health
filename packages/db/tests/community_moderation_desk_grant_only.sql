-- Community moderation desk, Phase A (migration *_community_moderation_desk_grant_only_and_overview.sql, decision COM-31).
-- Replaces community_internal_staff_auto_moderators.sql and community_automatic_moderators_on_the_rota.sql, whose behaviour (COM-28)
-- the founder reversed. One rolled-back transaction; the sabotage step must flip its check.
--
--   psql -f packages/db/tests/community_moderation_desk_grant_only.sql

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
-- Real (not test) staff accounts: the old automatic grant skipped test accounts, so a test account would prove nothing here.
create function pg_temp.mkreal(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'cmd-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'CMD ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '40 years')::date, false, 'en')
  on conflict (id) do update set role = excluded.role, is_test = false, is_active = true, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.grants(p uuid) returns text language sql as
$f$ select coalesce(string_agg(s.scope || ':' || s.source, ',' order by s.scope), '') from public.community_staff s where s.profile_id = p and s.revoked_at is null $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_fin uuid; v_ceo uuid; v_cc uuid; v_doc uuid; v_pat uuid; v_grant uuid; v_j jsonb; v_txt text;
begin
  select id into v_org from public.organisations order by id limit 1;
  if v_org is null then insert into public.organisations (name) values ('community desk proof org') returning id into v_org; end if;

  -- 1. nobody is a moderator because of their account: no automatic grant for any internal role, nor for a working doctor
  perform pg_temp.rec('no live automatic grant remains anywhere', '0', (select count(*)::text from public.community_staff where source = 'automatic' and revoked_at is null));
  perform pg_temp.rec('the automatic grant triggers are gone', '0',
    (select count(*)::text from pg_trigger where tgname in ('community_auto_grant_profile', 'community_auto_grant_clinical_staff', 'community_seed_default_shifts')));
  v_admin := pg_temp.mkreal(v_org, 'admin', 'admin');
  v_fin := pg_temp.mkreal(v_org, 'fin', 'finance');
  v_ceo := pg_temp.mkreal(v_org, 'ceo', 'analyst');
  v_cc := pg_temp.mkreal(v_org, 'cc', 'care_coordinator');
  v_pat := pg_temp.mkreal(v_org, 'pat', 'patient');
  v_doc := pg_temp.mkreal(v_org, 'doc', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (v_org, v_doc, 'CMD doc', 'MDCN', 'CMD-' || substr(v_doc::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', v_admin,
      'senior_medical_officer', 'employed', 2, true, v_admin, false, array['en'], 'General practice');
  perform pg_temp.rec('a new admin account holds no community grant', '', pg_temp.grants(v_admin));
  perform pg_temp.rec('a new finance account holds no community grant', '', pg_temp.grants(v_fin));
  perform pg_temp.rec('a new analyst account holds no community grant', '', pg_temp.grants(v_ceo));
  perform pg_temp.rec('a new care coordinator holds no community grant', '', pg_temp.grants(v_cc));
  perform pg_temp.rec('a working doctor holds no community grant', '', pg_temp.grants(v_doc));

  -- 2. without a grant: no desk, no queue (the admin's desk access is by account, through is_admin, not by grant)
  perform pg_temp.rec('finance without a grant has no desk', 'false', pg_temp.asj(v_fin, 'select public.community_staff_context()') ->> 'has_desk');
  perform pg_temp.rec('finance without a grant cannot open the overview', '42501', pg_temp.asj(v_fin, 'select public.community_desk_overview(7)') ->> 'error');
  perform pg_temp.rec('finance without a grant cannot open the queue', '42501', pg_temp.asj(v_fin, 'select public.community_mod_queue(null)') ->> 'error');
  perform pg_temp.rec('a doctor without a grant cannot open the safety queue', '42501', pg_temp.asj(v_doc, 'select public.community_safety_queue()') ->> 'error');
  perform pg_temp.rec('a patient cannot open the overview', '42501', pg_temp.asj(v_pat, 'select public.community_desk_overview(7)') ->> 'error');
  perform pg_temp.rec('an admin has the desk', 'true', pg_temp.asj(v_admin, 'select public.community_staff_context()') ->> 'has_desk');

  -- 3. given a role, any staff account gets the shared desk
  v_j := pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'moderator', null)$q$, v_fin));
  perform pg_temp.rec('an admin gives finance the moderator role', 'ok', v_j ->> 'status');
  perform pg_temp.rec('finance now has the desk', 'true', pg_temp.asj(v_fin, 'select public.community_staff_context()') ->> 'has_desk');
  v_j := pg_temp.asj(v_fin, 'select public.community_desk_overview(7)');
  perform pg_temp.rec('the moderator opens the overview', 'true', (v_j ? 'kpis' and v_j ? 'attention' and v_j ? 'groups')::text);
  perform pg_temp.rec('a moderator does not see safety details', 'false', v_j ->> 'sees_safety');
  perform pg_temp.rec('an unknown period falls back to 7 days', '7', pg_temp.asj(v_fin, 'select public.community_desk_overview(12)') ->> 'days');
  perform pg_temp.rec('the 30-day series has 30 days', '30', jsonb_array_length(pg_temp.asj(v_fin, 'select public.community_desk_overview(30)') -> 'series')::text);
  v_txt := v_j::text;
  perform pg_temp.rec('the overview carries no member identity key', 'false',
    (v_txt ~ '"(profile_id|author_profile_id|member_profile_id|reporter_profile_id|author_handle|handle|body)"')::text);
  v_j := pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'moderator', null)$q$, v_fin));
  perform pg_temp.rec('the same role twice is refused', 'already_granted', v_j ->> 'reason');

  -- 4. Senior Moderator: global only, always with a moderator grant, withdrawn together
  -- the group id is read here as the test owner: a signed-in session has no direct read on community_groups
  v_j := pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'senior_moderator', %L)$q$, v_cc, (select id from public.community_groups order by name limit 1)));
  perform pg_temp.rec('a senior moderator grant for one group is refused', 'senior_moderator_is_global', coalesce(v_j ->> 'reason', v_j ->> 'error'));
  v_j := pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'senior_moderator', null)$q$, v_cc));
  perform pg_temp.rec('an admin makes the coordinator a senior moderator', 'ok', v_j ->> 'status');
  perform pg_temp.rec('a senior moderator is also a moderator', 'moderator:admin,senior_moderator:admin', pg_temp.grants(v_cc));
  perform pg_temp.rec('the context says senior moderator', 'true', pg_temp.asj(v_cc, 'select public.community_staff_context()') ->> 'is_senior_moderator');
  perform pg_temp.rec('the senior moderator opens the queue', 'true', (pg_temp.asj(v_cc, 'select public.community_mod_queue(null)') ? 'items')::text);
  perform pg_temp.rec('a senior moderator is not a safety reviewer', '42501', pg_temp.asj(v_cc, 'select public.community_safety_queue()') ->> 'error');
  select id into v_grant from public.community_staff where profile_id = v_cc and scope = 'moderator' and revoked_at is null;
  v_j := pg_temp.asj(v_admin, format('select public.community_admin_revoke_staff(%L)', v_grant));
  perform pg_temp.rec('withdrawing the moderator role withdraws senior too', '', pg_temp.grants(v_cc));
  perform pg_temp.rec('the coordinator has no desk after withdrawal', 'false', pg_temp.asj(v_cc, 'select public.community_staff_context()') ->> 'has_desk');
  perform pg_temp.rec('a moderator cannot grant roles', '42501',
    pg_temp.asj(v_fin, format($q$select public.community_admin_grant_staff(%L, 'moderator', null)$q$, v_ceo)) ->> 'error');

  -- 5. a safety reviewer sees safety on the overview
  v_j := pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'safety_reviewer', null)$q$, v_doc));
  perform pg_temp.rec('the doctor is given safety review', 'ok', v_j ->> 'status');
  perform pg_temp.rec('a safety reviewer sees safety details', 'true', pg_temp.asj(v_doc, 'select public.community_desk_overview(7)') ->> 'sees_safety');
  perform pg_temp.rec('the safety reviewer opens the safety queue', 'true', (pg_temp.asj(v_doc, 'select public.community_safety_queue()') ? 'items')::text);

  -- 6. privileges
  perform pg_temp.rec('anon cannot run the overview', 'false', has_function_privilege('anon', 'public.community_desk_overview(integer)', 'EXECUTE')::text);
  perform pg_temp.rec('anon cannot read the staff context', 'false', has_function_privilege('anon', 'public.community_staff_context()', 'EXECUTE')::text);
  perform pg_temp.rec('a signed-in user cannot call the senior check directly', 'false', has_function_privilege('authenticated', 'private.community_is_senior_moderator()', 'EXECUTE')::text);
  perform pg_temp.rec('every live grant belongs to an internal staff role', 'true',
    (select coalesce(bool_and(private.community_internal_staff_role(p.role)), true)::text from public.community_staff s join public.profiles p on p.id = s.profile_id where s.revoked_at is null));
end $$;

-- Sabotage: put an automatic grant back on profiles; a new finance account then holds a grant, so the "no grant" check must flip.
do $$
declare v_org uuid; v_fin2 uuid;
begin
  select id into v_org from public.organisations order by id limit 1;
  create function pg_temp.sab_grant() returns trigger language plpgsql security definer set search_path = '' as $f$
  begin
    if new.role in ('finance') then
      insert into public.community_staff (profile_id, scope, group_id, granted_by, source) values (new.id, 'moderator', null, null, 'automatic');
    end if;
    return null;
  end $f$;
  create trigger sab_auto_grant after insert or update of role on public.profiles for each row execute function pg_temp.sab_grant();
  v_fin2 := pg_temp.mkreal(v_org, 'fin2', 'finance');
  -- expected is the SABOTAGED outcome, so the row reads PASS; the final block checks that it flipped
  insert into results values ('sabotage', 'with an automatic grant back, a new finance account is a moderator', 'moderator:automatic', pg_temp.grants(v_fin2));
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results order by phase desc, check_name;

do $$
declare v_fail integer; v_sab integer;
begin
  select count(*) into v_fail from results where phase = 'real' and expected is distinct from actual;
  select count(*) into v_sab from results where phase = 'sabotage' and actual = 'moderator:automatic';
  if v_fail > 0 then raise exception 'community_moderation_desk_grant_only: % real check(s) failed', v_fail; end if;
  if v_sab <> 1 then raise exception 'community_moderation_desk_grant_only: sabotage did not flip'; end if;
end $$;

rollback;
