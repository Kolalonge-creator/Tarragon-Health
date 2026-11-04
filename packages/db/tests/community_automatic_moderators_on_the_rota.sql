-- Community rota: an automatic moderator or safety-reviewer grant starts on the rota
-- (migration *_community_automatic_moderators_start_on_the_rota.sql). One rolled-back transaction; the sabotage step must flip its check.
--
--   psql -f packages/db/tests/community_automatic_moderators_on_the_rota.sql

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
-- Real (not test) staff accounts: the automatic grant skips test accounts, so this proof mints real ones and rolls them back.
create function pg_temp.mkreal(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'rota-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'ROTA ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '40 years')::date, false, 'en')
  on conflict (id) do update set role = excluded.role, is_test = false, is_active = true, full_name = excluded.full_name;
  return v;
end $f$;
-- "weekday:start-end" lines for one person's grant of one scope, so a seeded week reads as 7 rows of 0-24
create function pg_temp.week(p uuid, p_scope text) returns text language sql as
$f$ select coalesce(string_agg(sh.weekday || ':' || sh.start_hour || '-' || sh.end_hour, ',' order by sh.weekday), '')
      from public.community_staff s join public.community_shifts sh on sh.staff_id = s.id
     where s.profile_id = p and s.scope = p_scope and s.revoked_at is null and s.group_id is null $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_doc uuid; v_ceo uuid; v_fin uuid; v_ext uuid; v_grant uuid; v_new uuid; v_j jsonb;
  c_week constant text := '0:0-24,1:0-24,2:0-24,3:0-24,4:0-24,5:0-24,6:0-24';
begin
  select id into v_org from public.organisations order by id limit 1;
  if v_org is null then insert into public.organisations (name) values ('community rota proof org') returning id into v_org; end if;

  -- 1. a new internal staff account is on the rota the moment it is a moderator
  v_admin := pg_temp.mkreal(v_org, 'admin', 'admin');
  v_fin := pg_temp.mkreal(v_org, 'fin', 'finance');
  v_ceo := pg_temp.mkreal(v_org, 'ceo', 'analyst');
  v_ext := pg_temp.mkreal(v_org, 'hmo', 'hmo_admin');
  perform pg_temp.rec('a finance account starts on the moderator rota, every day all day', c_week, pg_temp.week(v_fin, 'moderator'));
  perform pg_temp.rec('an admin account starts on the moderator rota', c_week, pg_temp.week(v_admin, 'moderator'));
  perform pg_temp.rec('an external role has no rota', '', pg_temp.week(v_ext, 'moderator'));

  -- 2. a working doctor is on both rotas
  v_doc := pg_temp.mkreal(v_org, 'doc', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (v_org, v_doc, 'ROTA doc', 'MDCN', 'ROTA-' || substr(v_doc::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', v_admin,
      'senior_medical_officer', 'employed', 2, true, v_admin, false, array['en'], 'General practice');
  perform pg_temp.rec('a doctor starts on the moderator rota', c_week, pg_temp.week(v_doc, 'moderator'));
  perform pg_temp.rec('a doctor starts on the safety-reviewer rota', c_week, pg_temp.week(v_doc, 'safety_reviewer'));

  -- 3. coverage: with a live internal moderator and a live safety reviewer on the rota nothing is uncovered
  perform pg_temp.rec('no moderator hour is uncovered', '0', private.community_uncovered_hours('moderator')::text);
  perform pg_temp.rec('no safety-review hour is uncovered', '0', private.community_uncovered_hours('safety_reviewer')::text);

  -- 4. an admin's own edit is kept: a trimmed week is not put back, and a hand grant is not seeded
  select id into v_grant from public.community_staff where profile_id = v_fin and scope = 'moderator' and revoked_at is null;
  v_j := pg_temp.asj(v_admin, format($q$select public.community_admin_set_shifts(%L, '[{"weekday":1,"start_hour":9,"end_hour":17}]'::jsonb)$q$, v_grant));
  perform pg_temp.rec('an admin trims the finance rota', 'ok', v_j ->> 'status');
  update public.profiles set is_active = false where id = v_fin;
  update public.profiles set is_active = true where id = v_fin;
  perform pg_temp.rec('the trimmed week is not put back', '1:9-17', pg_temp.week(v_fin, 'moderator'));

  select id into v_grant from public.community_staff where profile_id = v_ceo and scope = 'moderator' and revoked_at is null;
  v_j := pg_temp.asj(v_admin, format('select public.community_admin_revoke_staff(%L)', v_grant));
  perform pg_temp.rec('withdrawing a grant takes the person off the rota', '', pg_temp.week(v_ceo, 'moderator'));
  v_j := pg_temp.asj(v_admin, format($q$select public.community_admin_grant_staff(%L, 'moderator', null)$q$, v_ceo));
  perform pg_temp.rec('a grant an admin makes by hand is not seeded with a rota', '', pg_temp.week(v_ceo, 'moderator'));

  -- 5. nobody can call the seeding function directly
  perform pg_temp.rec('a signed-in user cannot call the seeding function', 'false',
    has_function_privilege('authenticated', 'private.community_seed_default_shifts()', 'EXECUTE')::text);
end $$;

-- Sabotage: with the trigger gone, a new finance account is a moderator with no rota; the check must flip.
do $$
declare v_org uuid; v_fin2 uuid;
begin
  select id into v_org from public.organisations order by id limit 1;
  drop trigger community_seed_default_shifts on public.community_staff;
  v_fin2 := pg_temp.mkreal(v_org, 'fin2', 'finance');
  -- expected is the SABOTAGED outcome (no shifts), so the row reads PASS and the runner, which fails on any FAIL row, stays green
  insert into results values ('sabotage', 'without the trigger a new finance account has no rota', '', pg_temp.week(v_fin2, 'moderator'));
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results order by phase desc, check_name;

do $$
declare v_fail integer; v_sab integer;
begin
  select count(*) into v_fail from results where phase = 'real' and expected is distinct from actual;
  select count(*) into v_sab from results where phase = 'sabotage' and actual = '';
  if v_fail > 0 then raise exception 'community_automatic_moderators_on_the_rota: % real check(s) failed', v_fail; end if;
  if v_sab <> 1 then raise exception 'community_automatic_moderators_on_the_rota: sabotage did not flip'; end if;
end $$;

rollback;
