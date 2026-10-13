-- Proof: a governed configuration version cannot be activated while older than one
-- already signed (migration *_governed_config_never_activate_older_than_signed.sql).
--
--   1. All ten tables carry the guard; the partitioned ones name their partition columns.
--   2. Signing a newer version through the real sign_alert_rules works.
--   3. Signing an older unsigned draft through the real RPC is refused (23514) and the live
--      version and the draft's unsigned state are unchanged. A direct activation is refused too.
--   4. A still-newer version can then be signed (the guard is not a blanket lock).
--   5. SABOTAGE: the trigger dropped; signing the older draft must now succeed (check 3 flips).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
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
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'cfgguard-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'CfgGuard ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'CfgGuard ' || p_label, 'MDCN', 'CfgGuard-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, true)
  returning id into v_staff;
  return v;
end $f$;


create function pg_temp.msg(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_max integer; v_cfg jsonb;
  v_hi uuid; v_mid uuid; v_top uuid; v_txt text; v_live integer; v_mid_signed boolean;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');

  -- 1. Shape
  perform pg_temp.rec('ten tables carry the guard', '10', (select count(*)::text from pg_trigger where tgname = 'refuse_superseded_activation' and not tgisinternal));
  perform pg_temp.rec('cv_risk_config is partitioned by organisation', 'true',
    (select (pg_get_triggerdef(oid) like '%organisation_id%')::text from pg_trigger where tgname = 'refuse_superseded_activation' and tgrelid = 'public.cv_risk_config'::regclass));
  perform pg_temp.rec('risk questionnaires are partitioned by organisation and code', 'true',
    (select (pg_get_triggerdef(oid) like '%organisation_id%' and pg_get_triggerdef(oid) like '%code%')::text from pg_trigger where tgname = 'refuse_superseded_activation' and tgrelid = 'public.risk_questionnaire_configs'::regclass));

  select max(version) into v_max from public.alert_rules;
  select config into v_cfg from public.alert_rules order by version desc limit 1;
  insert into public.alert_rules (version, config, notes) values (v_max + 10, v_cfg, 'guard test newer') returning id into v_hi;
  insert into public.alert_rules (version, config, notes) values (v_max + 5, v_cfg, 'guard test older draft') returning id into v_mid;

  -- 2. Signing the newer version works
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg(format('select public.sign_alert_rules(%L)', v_hi));
  perform pg_temp.back();
  perform pg_temp.rec('signing the newer version works', 'ok', v_txt);
  select version into v_live from public.alert_rules where is_active;
  perform pg_temp.rec('...and it is now live', (v_max + 10)::text, v_live::text);

  -- 3. Signing the older draft is refused, and nothing changes
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg(format('select public.sign_alert_rules(%L)', v_mid));
  perform pg_temp.back();
  perform pg_temp.rec('signing an older draft is refused', 'true', (v_txt like '23514:%older than signed version%')::text);
  select version into v_live from public.alert_rules where is_active;
  select (approved_at is not null) into v_mid_signed from public.alert_rules where id = v_mid;
  perform pg_temp.rec('...the live version is unchanged', (v_max + 10)::text, v_live::text);
  perform pg_temp.rec('...and the draft stays unsigned', 'false', v_mid_signed::text);
  perform pg_temp.rec('a direct activation is refused too', 'true',
    (pg_temp.msg(format('update public.alert_rules set is_active = true where id = %L', v_mid)) like '23514:%')::text);

  -- 4. A still-newer version can be signed
  insert into public.alert_rules (version, config, notes) values (v_max + 20, v_cfg, 'guard test top') returning id into v_top;
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg(format('select public.sign_alert_rules(%L)', v_top));
  perform pg_temp.back();
  perform pg_temp.rec('a still-newer version can be signed', 'ok', v_txt);

  -- 5. SABOTAGE: the guard removed; the older draft must now be signable (so check 3 would fail)
  drop trigger refuse_superseded_activation on public.alert_rules;
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg(format('select public.sign_alert_rules(%L)', v_mid));
  perform pg_temp.back();
  insert into results values ('sabotaged', 'signing an older draft is refused', 'true', (v_txt like '23514:%older than signed version%')::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'Config supersede guard proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 1 then
    raise exception 'VACUOUS TEST: the sabotage step did not change the matching check';
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to differ inside the DO block above and are deliberately not printed.

rollback;
