-- G-01 proof: the gate model (migration 20261029223751_gate_model_masters_and_features.sql).
--   1. Shape: exactly nine masters; every parent is a master; no master carries a parent or a hold; an open guard is never held.
--   2. Parent rule: a feature forced on while its master is off reads CLOSED through private.go_live_guard_on; open once the
--      master is on; closed again when the master goes off.
--   3. Feature switching: an admin opens a feature whose switch_role is cmo and which has no condition branch at all (the kind
--      of guard that could never be switched on before); holding it needs a reason of at least 20 characters; the hold is kept
--      in held_reason and cleared on opening; both switches are logged; a patient is refused.
--   4. Masters are unchanged: role and conditions still gate them; a master cannot be held; a feature cannot be another
--      feature's parent; an unknown key reads closed.
--   5. The dashboard read carries kind, parent, hold and the effective answer, masters first.
--   SABOTAGE: the lookup put back to its pre-G-01 body (own row only); the parent-rule check must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- run a statement as a user: 'ok' or 'ERR:sqlstate'
create function pg_temp.sql_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return 'ok';
end $f$;
-- run a query as a user and return its one text value, or 'ERR:sqlstate'
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
-- run a statement as the table owner (this script): 'ok' or 'ERR:sqlstate'
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'ok';
exception when others then return 'ERR:' || sqlstate;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'g01-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'G01 ' || p_label, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
create function pg_temp.mkcmo(p_org uuid, p_admin uuid) returns uuid language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, 'cmo', 'clinician');
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'G01 cmo', 'MDCN', 'G01-cmo-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      'chief_medical_officer', 'contracted', 2, true, p_admin, true);
  return v;
end $f$;
-- force a row's switch the way a rolled-back proof may (the table guard paused for the one statement); never a hold on an open row
create function pg_temp.force(p_key text, p_on boolean) returns void language plpgsql as $f$
begin
  alter table public.go_live_guards disable trigger go_live_guards_guard;
  update public.go_live_guards
     set is_on = p_on, changed_at = case when p_on then now() end, changed_by = case when p_on then pg_temp.f('admin') end,
         change_note = case when p_on then 'G-01 proof, rolled back' end, held_reason = case when p_on then null else held_reason end
   where key = p_key;
  alter table public.go_live_guards enable trigger go_live_guards_guard;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_pat uuid; v_feature text := 'device_alert_task_enabled'; v_child text := 'post_consult_checkins_enabled';
  v_total integer;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  insert into fx values ('admin', v_admin);
  v_cmo := pg_temp.mkcmo(v_org, v_admin);
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  update public.profiles set is_test = false where id = v_pat; -- a REAL person: the test-account bypass above the lookup must not answer for them

  -- 1. shape ----------------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('exactly nine masters, named',
    'assistant_enabled,checkout_enabled,clinical_operations_enabled,lab_booking_enabled,on_call_cover_ok,payouts_enabled,prescribing_enabled,public_signup_enabled,research_export_enabled',
    (select string_agg(key, ',' order by key) from public.go_live_guards where kind = 'master'));
  perform pg_temp.rec('every parent is a master', '0',
    (select count(*)::text from public.go_live_guards g join public.go_live_guards p on p.key = g.parent_key where p.kind <> 'master'));
  perform pg_temp.rec('no master carries a parent or a hold', '0',
    (select count(*)::text from public.go_live_guards where kind = 'master' and (parent_key is not null or held_reason is not null)));
  perform pg_temp.rec('an open guard is never held', '0', (select count(*)::text from public.go_live_guards where is_on and held_reason is not null));
  perform pg_temp.rec('every hold is a sentence of at least 20 characters', 'true',
    (select coalesce(bool_and(length(btrim(held_reason)) >= 20), true)::text from public.go_live_guards where held_reason is not null));
  perform pg_temp.rec('the two fixtures have the expected kinds and parent', 'feature|clinical_operations_enabled|feature|null',
    (select kind || '|' || coalesce(parent_key, 'null') from public.go_live_guards where key = v_child) || '|' ||
    (select kind || '|' || coalesce(parent_key, 'null') from public.go_live_guards where key = v_feature));

  -- 2. the parent rule --------------------------------------------------------------------------------------------------------
  perform pg_temp.force(v_child, true);
  perform pg_temp.rec('a feature forced on under a closed master reads closed', 'false', private.go_live_guard_on(v_child)::text);
  perform pg_temp.rec('...and so does the client question for a real signed-in person', 'false', pg_temp.q_as(v_pat, format('select public.go_live_guard_is_open(%L)::text', v_child)));
  perform pg_temp.force('clinical_operations_enabled', true);
  perform pg_temp.rec('open once its master is on', 'true', private.go_live_guard_on(v_child)::text);
  perform pg_temp.force('clinical_operations_enabled', false);
  perform pg_temp.rec('closed again when the master goes off', 'false', private.go_live_guard_on(v_child)::text);
  perform pg_temp.force(v_child, false);

  -- 3. feature switching ------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('the feature fixture is off, switched by the CMO on paper, and has no condition branch', 'false|cmo|unknown_guard',
    (select is_on::text || '|' || switch_role from public.go_live_guards where key = v_feature) || '|' ||
    coalesce(private.go_live_conditions_safe(v_feature, v_org) -> 0 ->> 'code', 'none'));
  perform pg_temp.rec('a patient cannot switch it', 'ERR:42501', pg_temp.sql_as(v_pat, format('select public.set_go_live_guard(%L, true, %L)', v_feature, 'a patient tries')));
  perform pg_temp.rec('opening it still needs a note', 'ERR:22023', pg_temp.sql_as(v_admin, format('select public.set_go_live_guard(%L, true, null)', v_feature)));
  perform pg_temp.rec('an ADMIN opens a cmo-role feature with no condition met (G-01)', 'ok',
    pg_temp.sql_as(v_admin, format('select public.set_go_live_guard(%L, true, %L)', v_feature, 'G-01 proof: opening a feature')));
  perform pg_temp.rec('...it is on, not held, and reads open', 'true|null|true',
    (select is_on::text || '|' || coalesce(held_reason, 'null') from public.go_live_guards where key = v_feature) || '|' || private.go_live_guard_on(v_feature)::text);
  perform pg_temp.rec('holding it needs a reason of at least 20 characters', 'ERR:22023',
    pg_temp.sql_as(v_admin, format('select public.set_go_live_guard(%L, false, %L)', v_feature, 'too short')));
  perform pg_temp.rec('the CMO holds it with a reason', 'ok',
    pg_temp.sql_as(v_cmo, format('select public.set_go_live_guard(%L, false, %L)', v_feature, 'G-01 proof: held because the proof says so')));
  perform pg_temp.rec('...off, the reason kept, and closed', 'false|G-01 proof: held because the proof says so|false',
    (select is_on::text || '|' || coalesce(held_reason, 'null') from public.go_live_guards where key = v_feature) || '|' || private.go_live_guard_on(v_feature)::text);
  perform pg_temp.rec('both switches were logged with the actor''s role', 'admin:switched_on,cmo:switched_off',
    (select string_agg(actor_role || ':' || action, ',' order by id) from public.go_live_guard_log where guard_key = v_feature));
  -- (two statements on purpose: an uncorrelated scalar subquery is an InitPlan and would be read BEFORE the switch in the same expression)
  perform pg_temp.rec('the CMO opens it again', 'ok', pg_temp.sql_as(v_cmo, format('select public.set_go_live_guard(%L, true, %L)', v_feature, 'G-01 proof: open again')));
  perform pg_temp.rec('...which clears the hold', 'null', (select coalesce(held_reason, 'null') from public.go_live_guards where key = v_feature));

  -- 4. masters are unchanged ---------------------------------------------------------------------------------------------------
  perform pg_temp.rec('a master keeps its role: an admin cannot open a CMO master', 'ERR:42501',
    pg_temp.sql_as(v_admin, 'select public.set_go_live_guard(''prescribing_enabled'', true, ''G-01 proof'')'));
  perform pg_temp.rec('a master keeps its conditions: the CMO is refused while they are unmet', 'ERR:22023',
    pg_temp.sql_as(v_cmo, 'select public.set_go_live_guard(''prescribing_enabled'', true, ''G-01 proof'')'));
  perform pg_temp.rec('a master cannot be held', 'ERR:22023',
    pg_temp.try('update public.go_live_guards set held_reason = ''a master is switched off, never held, says G-01'' where key = ''prescribing_enabled'''));
  perform pg_temp.rec('a feature cannot be another feature''s parent', 'ERR:22023',
    pg_temp.try(format('update public.go_live_guards set parent_key = %L where key = %L', v_feature, 'nafdac_verify_helper_enabled')));
  perform pg_temp.rec('a guard is still created switched off', 'ERR:42501',
    pg_temp.try(format('insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, is_on, changed_at, changed_by, change_note) values (''g01_born_on'', ''x'', ''x'', ''x'', ''admin'', true, now(), %L, ''x'')', v_admin)));
  perform pg_temp.rec('an unknown key reads closed', 'false', private.go_live_guard_on('no_such_guard_g01')::text);

  -- 5. the dashboard read ------------------------------------------------------------------------------------------------------
  select count(*) into v_total from public.go_live_guards;
  perform pg_temp.rec('every dashboard row carries kind, parent_key, held_reason and open', v_total::text,
    pg_temp.q_as(v_admin, 'select count(*)::text from jsonb_array_elements(public.go_live_guard_status()) g where g ? ''kind'' and g ? ''parent_key'' and g ? ''held_reason'' and g ? ''open'''));
  perform pg_temp.rec('masters come first', 'master', pg_temp.q_as(v_admin, 'select public.go_live_guard_status() -> 0 ->> ''kind'''));
  perform pg_temp.rec('a held feature says so on the dashboard', 'true',
    pg_temp.q_as(v_admin, 'select (exists (select 1 from jsonb_array_elements(public.go_live_guard_status()) g where g ->> ''key'' = ''wallet_pass'' and g ->> ''held_reason'' is not null and (g ->> ''open'')::boolean = false))::text'));
end $$;

-- SABOTAGE: the lookup put back to its pre-G-01 body (own row only). A feature forced on under a closed master must then read OPEN.
do $$
declare v_orig text; r text;
begin
  v_orig := pg_get_functiondef('private.go_live_guard_on(text)'::regprocedure);
  create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path to ''
    as $b$ select coalesce((select g.is_on from public.go_live_guards g where g.key = p_key), false) $b$;
  perform pg_temp.force('post_consult_checkins_enabled', true);
  r := private.go_live_guard_on('post_consult_checkins_enabled')::text;
  insert into results values ('sabotaged', 'a feature forced on under a closed master reads closed', 'false', r);
  perform pg_temp.force('post_consult_checkins_enabled', false);
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'G-01 gate model proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotage did not flip the parent-rule check'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
