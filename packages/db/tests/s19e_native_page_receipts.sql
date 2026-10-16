-- S19e proof: a native (Expo) push receipt confirms a mobile-only clinician's route; page_channel_ready exists, defaults false.
-- One rolled-back transaction. Controls: no subscription, a disabled native subscription and a web-only 'in_app' absence stay false.
-- Sabotage: the S19c (web-only) definition is restored; the native case must flip to false, proving the new clause is what decides it.
begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
grant all on results to public;

do $$
declare
  v_org uuid; v uuid := gen_random_uuid(); v_def text; v_old text; v_test uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (v, 's19e-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
    values (v, v_org, 'clinician', 'S19e clinician', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '40 years')::date, true, 'en')
    on conflict (id) do update set role = 'clinician', is_test = true;

  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.page_tests (organisation_id, clinician_id, kind, acknowledged_at, delivered_at, is_test) values (v_org, v, 'readiness', now(), now(), true) returning id into v_test;
  insert into public.page_delivered_acks (test_id, clinician_id, channel) values (v_test, v, 'push');
  perform set_config('tarragon.paging_write', 'off', true);

  insert into results values ('a push receipt with no subscription does not confirm the route', 'false', private.clinician_route_confirmed(v)::text);

  insert into public.push_subscriptions (organisation_id, profile_id, platform, expo_push_token, disabled_at)
    values (v_org, v, 'android', 'ExponentPushToken[s19e-' || v || ']', now());
  insert into results values ('a DISABLED native subscription does not confirm it', 'false', private.clinician_route_confirmed(v)::text);

  update public.push_subscriptions set disabled_at = null, last_seen_at = now() - interval '30 days' where profile_id = v;
  insert into results values ('a native subscription not seen for 30 days (a dead token) does not confirm it', 'false', private.clinician_route_confirmed(v)::text);
  update public.push_subscriptions set last_seen_at = now() where profile_id = v;
  insert into results values ('a live native (android) subscription with a push receipt confirms it', 'true', private.clinician_route_confirmed(v)::text);
  insert into results values ('page_channel_ready defaults to false', 'false', (select page_channel_ready::text from public.push_subscriptions where profile_id = v));
  insert into results values ('the function is not executable by anon or authenticated', 'false,false',
    has_function_privilege('anon', 'private.clinician_route_confirmed(uuid)', 'EXECUTE')::text || ',' || has_function_privilege('authenticated', 'private.clinician_route_confirmed(uuid)', 'EXECUTE')::text);

  -- SABOTAGE: the S19c definition (web subscriptions only)
  v_def := pg_get_functiondef('private.clinician_route_confirmed(uuid)'::regprocedure);
  v_old := replace(v_def, 'or (s.platform in (''ios'', ''android'') and s.expo_push_token is not null', 'and (false');
  if v_old = v_def then raise exception 'VACUOUS TEST: could not strip the native clause'; end if;
  execute v_old;
  insert into results values ('SABOTAGE: web-only definition leaves the native clinician unconfirmed', 'true', private.clinician_route_confirmed(v)::text);
end $$;

do $$
declare v_bad text;
begin
  select string_agg(check_name || ' => expected ' || expected || ' got ' || actual, '; ') into v_bad
    from results where check_name not like 'SABOTAGE%' and expected is distinct from actual;
  if v_bad is not null then raise exception 'S19e native receipts FAILED: %', v_bad; end if;
  if exists (select 1 from results where check_name like 'SABOTAGE%' and expected = actual) then
    raise exception 'VACUOUS TEST: the sabotage did not change the native check';
  end if;
end $$;

select check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
  from results where check_name not like 'SABOTAGE%' order by check_name;

rollback;
