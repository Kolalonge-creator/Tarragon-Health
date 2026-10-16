-- OQ-451 and OQ-452 proof (migration *_oq451_oq452_signing_functions_and_deep_health.sql).
--
-- One rolled-back transaction. Every behaviour has a control, and the last section SABOTAGES the build (each removal must flip its check):
--   1. Rollout     nothing was signed or activated by the migration; the live-shaped rows are untouched; every new function is closed to anon.
--   2. Task layer  sign_queue_task_layer_config: only the CMO; accepting the version in force keeps it live; a signed version cannot be
--                  edited or deleted; a new version is signed as a NEW row and retires the old one; an older or invalid version is refused.
--   3. Paging      activate_paging_delivery_config REFUSES (returns the reasons, changes nothing) until every on-call clinician has a working
--                  push subscription, a verified email and a test page acknowledged within the window of the version being activated;
--                  test clinicians are not counted; nobody on call is itself a reason; CMO only; when met it activates, signs and audits.
--   4. Deep health platform_deep_health(): service role only; reports a stale or missing queue/paging heartbeat and counts open sev1.
--   5. SABOTAGE    the freeze guard, the checklist and the CMO test are each removed and the matching check must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sab(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); perform set_config('request.jwt.claim.sub', '', true); end $f$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return coalesce(r, 'null');
end $f$;
create function pg_temp.q(p_sql text) returns text language plpgsql as
$f$ declare r text; begin execute p_sql into r; return coalesce(r, 'null'); end $f$;
-- run as the service role (what the /api/health/deep route uses)
create function pg_temp.q_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  set local role service_role;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return coalesce(r, 'null');
end $f$;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'oq451-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'OQ451 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test, 'en')
  on conflict (id) do update set role = excluded.role, is_test = p_test, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text, p_comps text[], p_test boolean) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician', p_test); s uuid; c text;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'OQ451 ' || p_label, 'MDCN', 'OQ451-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, p_test)
  returning id into s;
  foreach c in array p_comps loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, p_test);
  end loop;
  return v;
end $f$;
create function pg_temp.give_push(p_org uuid, p_uid uuid, p_disabled boolean default false) returns void language sql as
$$ insert into public.push_subscriptions (organisation_id, profile_id, endpoint, p256dh_key, auth_key, disabled_at)
   values (p_org, p_uid, 'https://push.invalid/' || gen_random_uuid(), 'k', 'a', case when p_disabled then now() end) $$;
create function pg_temp.give_ack(p_org uuid, p_uid uuid, p_ago interval) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.page_tests (organisation_id, clinician_id, requested_by, kind, sent_at, delivered_at, acknowledged_at, is_test)
  values (p_org, p_uid, p_uid, 'readiness', now() - p_ago, now() - p_ago, now() - p_ago, false);
  perform set_config('tarragon.paging_write', 'off', true);
end $f$;
create function pg_temp.drop_acks(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.paging_write', 'on', true);
  delete from public.page_tests where clinician_id = p_uid;
  perform set_config('tarragon.paging_write', 'off', true);
end $f$;
-- the active-state snapshot "version:active:signed" of one table
create function pg_temp.state(p_table text) returns text language plpgsql as
$f$ declare r text;
begin
  execute format('select string_agg(version || '':'' || is_active::int || '':'' || (approved_at is not null)::int, '','' order by version) from public.%I', p_table) into r;
  return r;
end $f$;
-- who the activation check names, as "name1|name2"
create function pg_temp.named(p_check jsonb) returns text language sql as
$$ select coalesce(string_agg(r ->> 'name', '|' order by r ->> 'name'), '') from jsonb_array_elements(p_check -> 'reasons') r where r ->> 'code' = 'clinician_not_ready' $$;
create function pg_temp.gaps_of(p_check jsonb, p_name text) returns text language sql as
$$ select coalesce((select string_agg(g, ',' order by g) from jsonb_array_elements(p_check -> 'reasons') r, jsonb_array_elements_text(r -> 'gaps') g where r ->> 'name' = p_name), '') $$;

-- fixtures ----------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_cmo uuid; v_x uuid; v_y uuid; v_t uuid; v_other uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', true);
  update public.clinical_staff set active = false where is_test is not true;
  -- the CMO is a real (non-test) account; the on-call clinicians X and Y are real; T is a test clinician with the on-call competency
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer', '{}', false);
  v_other := pg_temp.mkdoc(v_org, v_admin, 'plain', 'senior_medical_officer', '{adult_general}', false);
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('cmo', v_cmo); perform pg_temp.setf('plain', v_other);
  -- a clinician on call BEFORE the fixtures below would make the "nobody on call" check meaningless: none exists yet
  perform pg_temp.rec('fixture: no non-test clinician has the on-call competency yet', '0',
    (select count(*)::text from public.clinical_staff cs where cs.active and not cs.is_test and private.has_competency(cs.profile_id, 'on_call')));
end $$;

-- 1. Rollout -------------------------------------------------------------------------------------------------------------------
do $$
declare v_cmo uuid := pg_temp.f('cmo'); v_plain uuid := pg_temp.f('plain'); v_admin uuid := pg_temp.f('admin'); f text; v_bad text := '';
begin
  perform pg_temp.rec('rollout: the migration signed nothing and changed no active row', 'true,true',
    (pg_temp.state('queue_task_layer_config') ~ '^1:1:0') || ',' || (pg_temp.state('paging_delivery_config') ~ '^1:1:0,2:0:0$'));
  foreach f in array array['public.sign_queue_task_layer_config(integer)', 'public.paging_delivery_activation_check(integer)', 'public.activate_paging_delivery_config(integer)',
                           'public.platform_deep_health()'] loop
    if has_function_privilege('anon', f::regprocedure, 'EXECUTE') then v_bad := v_bad || f || ' '; end if;
  end loop;
  perform pg_temp.rec('rollout: no new public function is executable by anon', '', v_bad);
  perform pg_temp.rec('rollout: platform_deep_health is service role only; the signing functions are for authenticated', 'false,true,true',
    has_function_privilege('authenticated', 'public.platform_deep_health()', 'EXECUTE')::text || ',' ||
    has_function_privilege('authenticated', 'public.sign_queue_task_layer_config(integer)', 'EXECUTE')::text || ',' ||
    has_function_privilege('service_role', 'public.platform_deep_health()', 'EXECUTE')::text);
  perform pg_temp.rec('rollout: the existing task layer version passes the validity check the signing function applies', 'true',
    (select bool_and(private.task_layer_rules_valid(rules))::text from public.queue_task_layer_config));
end $$;

-- 2. Task layer ----------------------------------------------------------------------------------------------------------------
do $$
declare v_cmo uuid := pg_temp.f('cmo'); v_plain uuid := pg_temp.f('plain'); v_admin uuid := pg_temp.f('admin'); v_rules jsonb;
begin
  select rules into v_rules from public.queue_task_layer_config where version = 1;
  -- "used": the version in force is frozen even before anyone signs it
  perform pg_temp.rec('task layer: the version in force cannot be edited in place, signed or not', '23514',
    pg_temp.try($q$update public.queue_task_layer_config set rules = jsonb_set(rules, '{lead_window_cap_fraction}', '0.9') where version = 1$q$));
  perform pg_temp.rec('task layer: the version in force cannot be deleted', '23514', pg_temp.try('delete from public.queue_task_layer_config where version = 1'));
  perform pg_temp.rec('task layer: only the CMO signs (a clinician and an admin are refused, and nothing changes)', '42501,42501,1:1:0',
    pg_temp.try_as(v_plain, 'select public.sign_queue_task_layer_config(1)') || ',' || pg_temp.try_as(v_admin, 'select public.sign_queue_task_layer_config(1)') || ',' || pg_temp.state('queue_task_layer_config'));
  perform pg_temp.rec('task layer: an unknown version is refused', 'P0002', pg_temp.try_as(v_cmo, 'select public.sign_queue_task_layer_config(99)'));
  -- accept the version in force: signature only, still live, audited
  perform pg_temp.rec('task layer: the CMO accepts the version in force; it stays live and is now signed', 'ok,1:1:1',
    pg_temp.try_as(v_cmo, 'select public.sign_queue_task_layer_config(1)') || ',' || pg_temp.state('queue_task_layer_config'));
  perform pg_temp.rec('task layer: the signature is audited with the signer', '1',
    (select count(*)::text from public.audit_log where action = 'queue_task_layer_config.signed' and actor_id = v_cmo and event ->> 'version' = '1'));
  perform pg_temp.rec('task layer: signing the same version twice is refused', '23514', pg_temp.try_as(v_cmo, 'select public.sign_queue_task_layer_config(1)'));
  perform pg_temp.rec('task layer: a signed version cannot be edited, re-signed by hand or deleted', '23514,23514,23514',
    pg_temp.try($q$update public.queue_task_layer_config set rules = jsonb_set(rules, '{lead_window_cap_fraction}', '0.9') where version = 1$q$) || ',' ||
    pg_temp.try('update public.queue_task_layer_config set approved_by = null where version = 1') || ',' ||
    pg_temp.try('delete from public.queue_task_layer_config where version = 1'));
  -- a change is a NEW version: a draft above everything live can still be corrected; once signed it retires v1
  insert into public.queue_task_layer_config (version, is_active, effective_from, rules) values (2, false, current_date, jsonb_set(v_rules, '{lead_window_cap_fraction}', '0.4'));
  perform pg_temp.rec('task layer: a draft above everything live can still be corrected', 'ok',
    pg_temp.try($q$update public.queue_task_layer_config set rules = jsonb_set(rules, '{lead_window_cap_fraction}', '0.45') where version = 2$q$));
  perform pg_temp.rec('task layer: signing a new draft makes it live and retires v1 (which stays, signed)', 'ok,1:0:1,2:1:1',
    pg_temp.try_as(v_cmo, 'select public.sign_queue_task_layer_config(2)') || ',' || pg_temp.state('queue_task_layer_config'));
  perform pg_temp.rec('task layer: the retired v1 cannot be switched back on, and the live v2 holds the edited number', '23514,0.45',
    pg_temp.try('update public.queue_task_layer_config set is_active = true where version = 1') || ',' ||
    (select rules ->> 'lead_window_cap_fraction' from public.queue_task_layer_config where is_active));
  perform pg_temp.rec('task layer: exactly one version is in force', '1', (select count(*)::text from public.queue_task_layer_config where is_active));
  -- an invalid draft cannot be signed
  insert into public.queue_task_layer_config (version, is_active, effective_from, rules) values (3, false, current_date, '{"lead_window_cap_fraction": 0.5}');
  perform pg_temp.rec('task layer: a draft missing a setting the task layer needs cannot be signed', '23514,2:1:1,3:0:0',
    pg_temp.try_as(v_cmo, 'select public.sign_queue_task_layer_config(3)') || ',' || (select string_agg(version || ':' || is_active::int || ':' || (approved_at is not null)::int, ',' order by version) from public.queue_task_layer_config where version >= 2));
  -- an older version is never signed into force
  insert into public.queue_task_layer_config (version, is_active, effective_from, rules) values (0, false, current_date, v_rules);
  perform pg_temp.rec('task layer: an older version cannot be signed into force', '23514', pg_temp.try_as(v_cmo, 'select public.sign_queue_task_layer_config(0)'));
end $$;

-- 3. Paging delivery ---------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); v_cmo uuid := pg_temp.f('cmo'); v_plain uuid := pg_temp.f('plain');
        v_x uuid; v_y uuid; v_t uuid; c jsonb; r jsonb;
begin
  perform pg_temp.rec('paging: v1 and v2 are frozen/draft as shipped: the v1 in force cannot be edited, v2 is a draft', '23514,ok',
    pg_temp.try($q$update public.paging_delivery_config set rules = jsonb_set(rules, '{merge_window_minutes}', '31') where version = 1$q$) || ',' ||
    pg_temp.try($q$update public.paging_delivery_config set rules = jsonb_set(rules, '{merge_window_minutes}', '30') where version = 2$q$));
  perform pg_temp.rec('paging: only the CMO may check or activate (a clinician and an admin are refused)', '42501,42501,42501,42501',
    pg_temp.try_as(v_plain, 'select public.activate_paging_delivery_config(2)') || ',' || pg_temp.try_as(v_admin, 'select public.activate_paging_delivery_config(2)') || ',' ||
    pg_temp.try_as(v_plain, 'select public.paging_delivery_activation_check(2)') || ',' || pg_temp.try_as(v_admin, 'select public.paging_delivery_activation_check(2)'));
  perform pg_temp.rec('paging: an unknown version is refused', 'P0002', pg_temp.try_as(v_cmo, 'select public.activate_paging_delivery_config(99)'));

  -- nobody on call at all is itself a reason, and it refuses
  perform pg_temp.act(v_cmo); r := public.activate_paging_delivery_config(2); perform pg_temp.back();
  perform pg_temp.rec('paging: with nobody on call it refuses, says why, and changes nothing', 'false,no_on_call_clinicians,1:1:0,2:0:0',
    (r ->> 'activated') || ',' || (r -> 'reasons' -> 0 ->> 'code') || ',' || (select string_agg(version || ':' || is_active::int || ':' || (approved_at is not null)::int, ',' order by version) from public.paging_delivery_config));

  v_x := pg_temp.mkdoc(v_org, v_admin, 'X', 'senior_medical_officer', '{on_call}', false);
  v_y := pg_temp.mkdoc(v_org, v_admin, 'Y', 'senior_medical_officer', '{on_call}', false);
  v_t := pg_temp.mkdoc(v_org, v_admin, 'T-test', 'senior_medical_officer', '{on_call}', true);
  perform pg_temp.setf('X', v_x); perform pg_temp.setf('Y', v_y); perform pg_temp.setf('T', v_t);

  perform pg_temp.act(v_cmo); c := public.paging_delivery_activation_check(2); perform pg_temp.back();
  perform pg_temp.rec('paging: the check names X and Y (not the test clinician, not a clinician without the competency) and shows three gaps for X', 'false,OQ451 X|OQ451 Y,push_subscription,test_page,2',
    (c ->> 'ready') || ',' || pg_temp.named(c) || ',' || split_part(pg_temp.gaps_of(c, 'OQ451 X'), ',', 1) || ',' || split_part(pg_temp.gaps_of(c, 'OQ451 X'), ',', 2) || ',' || (c ->> 'on_call_count'));
  perform pg_temp.act(v_cmo); r := public.activate_paging_delivery_config(2); perform pg_temp.back();
  perform pg_temp.rec('paging: activation refuses with the same reasons and nothing changes', 'false,OQ451 X|OQ451 Y,1:1:0,2:0:0',
    (r ->> 'activated') || ',' || pg_temp.named(r) || ',' || (select string_agg(version || ':' || is_active::int || ':' || (approved_at is not null)::int, ',' order by version) from public.paging_delivery_config));


  -- each gap is its own reason
  perform pg_temp.give_push(v_org, v_x); perform pg_temp.give_ack(v_org, v_x, interval '1 hour');
  perform pg_temp.give_push(v_org, v_y, true);                       -- Y's only subscription is disabled
  perform pg_temp.give_ack(v_org, v_y, interval '8 days');           -- Y's test page is older than the 7 day window
  update auth.users set email_confirmed_at = null where id = v_y;    -- Y's email is not verified
  perform pg_temp.act(v_cmo); c := public.paging_delivery_activation_check(2); perform pg_temp.back();
  perform pg_temp.rec('paging: X is ready; Y lacks a working subscription (the only one is disabled), a verified email and a test page inside the 7 day window',
    'OQ451 Y,push_subscription,test_page,verified_email', pg_temp.named(c) || ',' || pg_temp.gaps_of(c, 'OQ451 Y'));
  perform pg_temp.act(v_cmo); r := public.activate_paging_delivery_config(2); perform pg_temp.back();
  perform pg_temp.rec('paging: still refused while Y is missing things, and v2 stays inactive and unsigned', 'false,1:1:0,2:0:0',
    (r ->> 'activated') || ',' || (select string_agg(version || ':' || is_active::int || ':' || (approved_at is not null)::int, ',' order by version) from public.paging_delivery_config));

  -- fix Y one gap at a time: each fix removes exactly its own reason
  update auth.users set email_confirmed_at = now() where id = v_y;
  perform pg_temp.act(v_cmo); c := public.paging_delivery_activation_check(2); perform pg_temp.back();
  perform pg_temp.rec('paging: a verified email clears only the email gap', 'push_subscription,test_page', pg_temp.gaps_of(c, 'OQ451 Y'));
  perform pg_temp.give_push(v_org, v_y);
  perform pg_temp.act(v_cmo); c := public.paging_delivery_activation_check(2); perform pg_temp.back();
  perform pg_temp.rec('paging: a working subscription clears only the push gap', 'test_page', pg_temp.gaps_of(c, 'OQ451 Y'));
  perform pg_temp.give_ack(v_org, v_y, interval '2 days');
  perform pg_temp.act(v_cmo); c := public.paging_delivery_activation_check(2); perform pg_temp.back();
  perform pg_temp.rec('paging: a test page acknowledged inside the window clears the last gap: ready, two on call (the test clinician is not counted)', 'true,2',
    (c ->> 'ready') || ',' || (c ->> 'on_call_count'));

  -- activation
  perform pg_temp.act(v_cmo); r := public.activate_paging_delivery_config(2); perform pg_temp.back();
  perform pg_temp.rec('paging: with the checklist met the CMO activates v2: signed, live, v1 retired', 'true,1:0:0,2:1:1',
    (r ->> 'activated') || ',' || (select string_agg(version || ':' || is_active::int || ':' || (approved_at is not null)::int, ',' order by version) from public.paging_delivery_config));
  perform pg_temp.rec('paging: the activation is audited and the readiness requirement is now in force', '1,1',
    (select count(*)::text from public.audit_log where action = 'paging_delivery_config.activated' and actor_id = v_cmo and event ->> 'version' = '2') || ',' ||
    private.paging_delivery_rule('objective_readiness_required')::text);
  perform pg_temp.rec('paging: activating it again, or the older v1, is refused', '23514,23514',
    pg_temp.try_as(v_cmo, 'select public.activate_paging_delivery_config(2)') || ',' || pg_temp.try_as(v_cmo, 'select public.activate_paging_delivery_config(1)'));
  perform pg_temp.rec('paging: the live signed v2 cannot be edited or deleted', '23514,23514',
    pg_temp.try($q$update public.paging_delivery_config set rules = jsonb_set(rules, '{merge_window_minutes}', '31') where version = 2$q$) || ',' ||
    pg_temp.try('delete from public.paging_delivery_config where version = 2'));
  perform pg_temp.rec('paging: exactly one version is in force', '1', (select count(*)::text from public.paging_delivery_config where is_active));
end $$;

-- 4. Deep health ---------------------------------------------------------------------------------------------------------------
do $$
declare v_cmo uuid := pg_temp.f('cmo'); v_b integer; v_inc uuid;
begin
  perform pg_temp.rec('deep: the service role reads three queue jobs and three paging components', '3,3',
    pg_temp.q_service($q$select jsonb_array_length(public.platform_deep_health() -> 'queue_jobs')::text || ',' || jsonb_array_length(public.platform_deep_health() -> 'paging')::text$q$));
  perform pg_temp.rec('deep: an authenticated user (even the CMO) is refused', 'ERR:42501', pg_temp.q_as(v_cmo, 'select public.platform_deep_health()::text'));

  -- a fresh queue heartbeat is within its limit; an old one is over it
  update public.queue_job_heartbeats set last_run_at = now() where job_name = 'sweep-clinical-tasks';
  perform pg_temp.rec('deep: a fresh queue heartbeat is inside its limit', 'false',
    pg_temp.q_service($q$select ((e ->> 'age_seconds')::int > (e ->> 'max_age_seconds')::int)::text from jsonb_array_elements(public.platform_deep_health() -> 'queue_jobs') e where e ->> 'job' = 'sweep-clinical-tasks'$q$));
  update public.queue_job_heartbeats set last_run_at = now() - interval '1 hour' where job_name = 'sweep-clinical-tasks';
  perform pg_temp.rec('deep: an hour-old queue heartbeat is over its limit', 'true',
    pg_temp.q_service($q$select ((e ->> 'age_seconds')::int > (e ->> 'max_age_seconds')::int)::text from jsonb_array_elements(public.platform_deep_health() -> 'queue_jobs') e where e ->> 'job' = 'sweep-clinical-tasks'$q$));
  delete from public.queue_job_heartbeats where job_name = 'expire-task-claims';
  perform pg_temp.rec('deep: a queue job with no heartbeat row at all is reported with a null age, never as fresh', 'true',
    pg_temp.q_service($q$select ((e -> 'age_seconds') = 'null'::jsonb)::text from jsonb_array_elements(public.platform_deep_health() -> 'queue_jobs') e where e ->> 'job' = 'expire-task-claims'$q$));
  perform pg_temp.rec('deep: the queue-watchdog heartbeat is always listed', '1',
    pg_temp.q_service($q$select count(*)::text from jsonb_array_elements(public.platform_deep_health() -> 'queue_jobs') e where e ->> 'job' = 'queue-watchdog'$q$));

  -- paging components: the limit is the engine heartbeat limit of the config in force
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.paging_heartbeats (component, last_seen_at) values ('process_events', now()) on conflict (component) do update set last_seen_at = now();
  perform pg_temp.rec('deep: a fresh process_events (edge function) heartbeat is inside its limit', 'false',
    pg_temp.q_service($q$select ((e ->> 'age_seconds')::int > (e ->> 'max_age_seconds')::int)::text from jsonb_array_elements(public.platform_deep_health() -> 'paging') e where e ->> 'component' = 'process_events'$q$));
  update public.paging_heartbeats set last_seen_at = now() - interval '10 minutes' where component = 'process_events';
  perform set_config('tarragon.paging_write', 'off', true);
  perform pg_temp.rec('deep: a ten-minute-old process_events heartbeat is over the 120 second limit', 'true,120',
    pg_temp.q_service($q$select ((e ->> 'age_seconds')::int > (e ->> 'max_age_seconds')::int)::text || ',' || (e ->> 'max_age_seconds') from jsonb_array_elements(public.platform_deep_health() -> 'paging') e where e ->> 'component' = 'process_events'$q$));

  -- open sev1 incidents are counted until they are resolved
  v_b := pg_temp.q_service($q$select (public.platform_deep_health() ->> 'open_sev1')$q$)::integer;
  insert into public.ops_incidents (category, severity, title) values ('technical', 'sev1', 'OQ-452 proof incident') returning id into v_inc;
  perform pg_temp.rec('deep: an open sev1 incident is counted', (v_b + 1)::text, pg_temp.q_service($q$select (public.platform_deep_health() ->> 'open_sev1')$q$));
  insert into public.ops_incidents (category, severity, title) values ('technical', 'sev2', 'OQ-452 proof sev2');
  perform pg_temp.rec('deep: a sev2 incident is not counted', (v_b + 1)::text, pg_temp.q_service($q$select (public.platform_deep_health() ->> 'open_sev1')$q$));
  update public.ops_incidents set status = 'resolved', root_cause = 'proof' where id = v_inc;
  perform pg_temp.rec('deep: a resolved sev1 incident is no longer counted', v_b::text, pg_temp.q_service($q$select (public.platform_deep_health() ->> 'open_sev1')$q$));
end $$;

-- 5. SABOTAGE: each removal must flip its check ----------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); v_cmo uuid := pg_temp.f('cmo'); v_plain uuid := pg_temp.f('plain'); v_z uuid; r jsonb; v_rules jsonb;
begin
  -- (a) the freeze guard: a signed version must not be editable
  perform pg_temp.rec('sabotage control: the signed task layer v2 cannot be edited', '23514',
    pg_temp.try($q$update public.queue_task_layer_config set rules = jsonb_set(rules, '{lead_window_cap_fraction}', '0.9') where version = 2$q$));
  drop trigger frozen_config_guard on public.queue_task_layer_config;
  perform pg_temp.sab('sabotage: with the freeze guard dropped a signed version can be edited', '23514',
    pg_temp.try($q$update public.queue_task_layer_config set rules = jsonb_set(rules, '{lead_window_cap_fraction}', '0.9') where version = 2$q$));

  -- (b) the checklist: a clinician who is not ready must block activation
  select rules into v_rules from public.paging_delivery_config where version = 2;
  insert into public.paging_delivery_config (version, is_active, effective_from, rules) values (3, false, current_date, v_rules);
  v_z := pg_temp.mkdoc(v_org, v_admin, 'Z', 'senior_medical_officer', '{on_call}', false);
  perform pg_temp.act(v_cmo); r := public.activate_paging_delivery_config(3); perform pg_temp.back();
  perform pg_temp.rec('sabotage control: an on-call clinician with nothing set up blocks activation', 'false', (r ->> 'activated'));
  create or replace function private.paging_activation_gaps(p_window_days integer) returns jsonb
    language sql stable security definer set search_path = '' as $f$ select '[]'::jsonb $f$;
  perform pg_temp.act(v_cmo); r := public.activate_paging_delivery_config(3); perform pg_temp.back();
  perform pg_temp.sab('sabotage: with the checklist emptied the same activation goes through', 'false', (r ->> 'activated'));

  -- (c) the CMO test: a plain clinician must be refused
  insert into public.queue_task_layer_config (version, is_active, effective_from, rules) select 4, false, current_date, rules from public.queue_task_layer_config where version = 2;
  perform pg_temp.rec('sabotage control: a plain clinician cannot sign', '42501', pg_temp.try_as(v_plain, 'select public.sign_queue_task_layer_config(4)'));
  create or replace function private.credential_is_cmo() returns boolean
    language sql stable security definer set search_path = '' as $f$ select true $f$;
  perform pg_temp.sab('sabotage: with the CMO test removed a plain clinician can sign', '42501', pg_temp.try_as(v_plain, 'select public.sign_queue_task_layer_config(4)'));
end $$;

do $$
declare v_bad integer; v_caught integer; v_sab integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'OQ-451/452 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_sab from results where phase = 'sabotaged';
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_sab < 3 or v_caught < v_sab then
    raise exception 'VACUOUS TEST: only % of % sabotage steps changed the matching check; unchanged: %', v_caught, v_sab,
      (select string_agg(check_name || ' expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'sabotaged' and expected = actual);
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
