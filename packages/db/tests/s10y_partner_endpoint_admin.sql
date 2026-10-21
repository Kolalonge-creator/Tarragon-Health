-- S10y proof: admin reads and guarded actions for partner webhook endpoints (migration *_s10y_partner_endpoint_admin.sql).
--
-- Proves in one rolled-back transaction:
--   1. The overview is admin only (a clinician and a patient get 42501), lists the endpoint of the caller's organisation only, and its
--      output contains neither the current nor the previous signing secret, and no url query string.
--   2. A previous key shows only while its grace window is open.
--   3. admin_reenable_partner_webhook_endpoint: admin only, refuses a missing or short reason (22022/22023 family), refuses another
--      organisation's endpoint, resets the endpoint, and writes an audit row carrying the reason and no secret.
--   4. The map overview lists event types; a mapping appears after set_partner_event_mapping; remove_partner_event_mapping is admin
--      only, deletes the row, switches the subscriber off and is audited; removing an unmapped type is refused.
--   5. Rotation through the existing function still returns the secret once and the audit row holds no secret.
--   6. SABOTAGE: (a) the re-enable function with its reason check removed must ACCEPT an empty reason (so check 3 would fail on it);
--      (b) an overview that returns the secret and drops the organisation filter must fail the no-secret and the org checks.
--   7/8. A second organisation's admin sees and touches nothing; a mapping on a deactivated event type stays listed and removable.
--   A test that cannot fail is not a test.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;   -- rows are written while the session runs as the authenticated role

create or replace function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's10y-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S10y ' || p_label, (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_org2 uuid; v_admin uuid; v_clin uuid; v_pat uuid;
  v_partner uuid; v_ep uuid; v_ep2 uuid; v_admin2 uuid;
  v_sec text := 'cccccccccccccccccccccccccccccccccccccccc';
  v_new text; v_err text; v_txt text; v_n integer; v_prev timestamptz;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into public.organisations (name, type) values ('S10y other org', 'direct_consumer') returning id into v_org2;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_clin := pg_temp.mkuser(v_org, 'clinician', 'clinician');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');

  insert into public.partner_integrations (organisation_id, name, base_url) values (v_org, 's10y partner', 'https://example.invalid') returning id into v_partner;
  insert into public.partner_webhook_endpoints (organisation_id, partner_integration_id, name, url, secret, event_types, environment)
    values (v_org, v_partner, 's10y endpoint', 'https://user:PASSWORD@example.invalid/services/PATHTOKEN/hook?token=SECRETQUERY', v_sec, array['result.available']::public.integration_event_type[], 'live')
    returning id into v_ep;
  insert into public.partner_integrations (organisation_id, name, base_url) values (v_org2, 's10y partner 2', 'https://example.invalid') returning id into v_partner;
  insert into public.partner_webhook_endpoints (organisation_id, partner_integration_id, name, url, secret, event_types, environment)
    values (v_org2, v_partner, 's10y other org endpoint', 'https://example.invalid/other', repeat('d', 40), array['result.available']::public.integration_event_type[], 'live')
    returning id into v_ep2;
  update public.partner_webhook_endpoints
     set is_active = false, auto_disabled_at = now(), disabled_reason = 'proof: 20 failures in a row', consecutive_failures = 20
   where id = v_ep;

  -- 1. read access
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin perform * from public.partner_webhook_admin_overview(); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'a clinician cannot read the endpoint overview', '42501', v_err);
  begin perform * from public.partner_event_map_admin_overview(); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'a clinician cannot read the map overview', '42501', v_err);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform * from public.partner_webhook_admin_overview(); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'a patient cannot read the endpoint overview', '42501', v_err);
  begin perform public.admin_reenable_partner_webhook_endpoint(v_ep, 'a perfectly good reason'); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'a patient cannot re-enable an endpoint', '42501', v_err);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.remove_partner_event_mapping('lab_result.released'); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'a clinician cannot remove a mapping', '42501', v_err);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.partner_webhook_admin_overview();
  insert into results values ('real', 'the overview lists only the caller organisation endpoints (>=1, none from the other org)', 'true',
    ((select count(*) from public.partner_webhook_admin_overview() where endpoint_id = v_ep) = 1
     and (select count(*) from public.partner_webhook_admin_overview() where endpoint_id = v_ep2) = 0)::text);
  select (select jsonb_agg(to_jsonb(o)) from public.partner_webhook_admin_overview() o where endpoint_id = v_ep)::text into v_txt;
  insert into results values ('real', 'the overview output holds no signing secret', 'false', (position(v_sec in v_txt) > 0)::text);
  insert into results values ('real', 'the overview output holds no url credentials, path or query', 'false|false|false',
    (position('SECRETQUERY' in v_txt) > 0)::text || '|' || (position('PASSWORD' in v_txt) > 0)::text || '|' || (position('PATHTOKEN' in v_txt) > 0)::text);
  insert into results values ('real', 'the overview shows scheme and host only', 'https://example.invalid',
    (select url from public.partner_webhook_admin_overview() where endpoint_id = v_ep));
  insert into results values ('real', 'the overview shows the auto-disable state',
    'false|proof: 20 failures in a row|20',
    (select is_active::text || '|' || disabled_reason || '|' || consecutive_failures::text from public.partner_webhook_admin_overview() where endpoint_id = v_ep));

  -- 5 and 2. rotation (existing function) then the previous-key window
  v_new := public.rotate_partner_webhook_secret(v_ep, 24);
  insert into results values ('real', 'rotation returns a new secret of at least 32 characters', 'true', (length(v_new) >= 32 and v_new <> v_sec)::text);
  select (select jsonb_agg(to_jsonb(o)) from public.partner_webhook_admin_overview() o where endpoint_id = v_ep)::text into v_txt;
  insert into results values ('real', 'after rotation the overview holds neither the new nor the old secret', 'false|false',
    (position(v_new in v_txt) > 0)::text || '|' || (position(v_sec in v_txt) > 0)::text);
  select previous_key_expires_at into v_prev from public.partner_webhook_admin_overview() where endpoint_id = v_ep;
  insert into results values ('real', 'the grace window is shown while open', 'true', (v_prev > now())::text);
  reset role;
  update public.partner_webhook_endpoints set previous_secret_expires_at = now() - interval '1 minute' where id = v_ep;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select previous_key_expires_at into v_prev from public.partner_webhook_admin_overview() where endpoint_id = v_ep;
  insert into results values ('real', 'an expired grace window is not shown', 'true', (v_prev is null)::text);
  reset role;
  insert into results values ('real', 'the rotation audit row holds no secret', 'false',
    (select (position(v_new in event::text) > 0 or position(v_sec in event::text) > 0)::text
       from public.audit_log where action = 'integration.webhook.secret_rotated' and entity_id = v_ep order by created_at desc limit 1));

  -- 3. re-enable
  set local role authenticated;
  begin perform public.admin_reenable_partner_webhook_endpoint(v_ep, null); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 're-enable refuses a missing reason', '22023', v_err);
  begin perform public.admin_reenable_partner_webhook_endpoint(v_ep, '   short   '); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 're-enable refuses a short reason', '22023', v_err);
  begin perform public.admin_reenable_partner_webhook_endpoint(v_ep2, 'a perfectly good reason'); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 're-enable gives another organisation endpoint the same answer as a missing one', 'P0002', v_err);
  begin perform public.admin_reenable_partner_webhook_endpoint(gen_random_uuid(), 'a perfectly good reason'); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 're-enable refuses an unknown endpoint', 'P0002', v_err);
  insert into results values ('real', 'nothing changed by the refused calls', 'false|20',
    (select is_active::text || '|' || consecutive_failures::text from public.partner_webhook_endpoints where id = v_ep));
  perform public.admin_reenable_partner_webhook_endpoint(v_ep, 'Receiver fixed the certificate, confirmed by email');
  reset role;
  insert into results values ('real', 're-enable resets the endpoint', 'true|0|true',
    (select is_active::text || '|' || consecutive_failures::text || '|' || (auto_disabled_at is null and disabled_reason is null)::text
       from public.partner_webhook_endpoints where id = v_ep));
  insert into results values ('real', 're-enable audit row carries the reason and no secret', 'true|false',
    (select (event->>'reason' = 'Receiver fixed the certificate, confirmed by email')::text || '|' || (position(v_new in event::text) > 0)::text
       from public.audit_log where action = 'integration.webhook.reenabled_by_admin' and entity_id = v_ep order by created_at desc limit 1));

  -- 4. mapping
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into results values ('real', 'map overview lists event types, none mapped yet', 'true|false',
    ((select count(*) from public.partner_event_map_admin_overview()) > 0)::text || '|' ||
    (select bool_or(is_mapped)::text from public.partner_event_map_admin_overview() where bus_event_type = 'lab_result.released'));
  begin perform public.remove_partner_event_mapping('lab_result.released'); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'removing an unmapped type is refused', 'P0002', v_err);
  perform public.set_partner_event_mapping('lab_result.released', 'result.available', array['lab_result_id']);
  insert into results values ('real', 'a mapping shows in the overview with its subscriber active', 'true|result.available|{lab_result_id}|true',
    (select is_mapped::text || '|' || integration_event_type || '|' || id_keys::text || '|' || subscriber_active::text
       from public.partner_event_map_admin_overview() where bus_event_type = 'lab_result.released'));
  perform public.remove_partner_event_mapping('lab_result.released');
  reset role;
  insert into results values ('real', 'removal deletes the row and switches the subscriber off', '0|false',
    (select count(*)::text from public.partner_event_map where bus_event_type = 'lab_result.released') || '|' ||
    (select is_active::text from public.event_subscribers where subscriber_key = 'partner.webhook.lab_result_released'));
  insert into results values ('real', 'mapping set and removal were both audited', '2',
    (select count(*)::text from public.audit_log where action = 'event_bus.partner_mapping' and event->>'bus_event_type' = 'lab_result.released'
        and actor_id = v_admin));

  -- 7. a second organisation's admin sees and touches nothing of the first
  v_admin2 := pg_temp.mkuser(v_org2, 'admin2', 'admin');
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set organisation_id = v_org2 where id = v_admin2;   -- the signup trigger put the profile in the default organisation
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into results values ('real', 'another organisation admin cannot see this organisation endpoint', 'false|true',
    ((select count(*) from public.partner_webhook_admin_overview() where endpoint_id = v_ep) > 0)::text || '|' ||
    ((select count(*) from public.partner_webhook_admin_overview() where endpoint_id = v_ep2) > 0)::text);
  begin perform public.admin_reenable_partner_webhook_endpoint(v_ep, 'a perfectly good reason'); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'another organisation admin cannot re-enable this organisation endpoint', 'P0002', v_err);
  begin perform public.rotate_partner_webhook_secret(v_ep, 24); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'another organisation admin cannot rotate this organisation key', '42501', v_err);
  reset role;

  -- 8. a mapping whose event type was later deactivated stays visible and removable
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_partner_event_mapping('lab_result.released', 'result.available', array['lab_result_id']);
  reset role;
  update public.event_types set is_active = false where event_type = 'lab_result.released';
  set local role authenticated;
  insert into results values ('real', 'a mapping on a deactivated event type is still listed', 'true',
    (select is_mapped::text from public.partner_event_map_admin_overview() where bus_event_type = 'lab_result.released'));
  perform public.remove_partner_event_mapping('lab_result.released');
  reset role;
  insert into results values ('real', 'and can be removed', '0|false',
    (select count(*)::text from public.partner_event_map where bus_event_type = 'lab_result.released') || '|' ||
    (select is_active::text from public.event_subscribers where subscriber_key = 'partner.webhook.lab_result_released'));
  update public.event_types set is_active = true where event_type = 'lab_result.released';

  -- 6a. SABOTAGE: re-enable without its reason check must accept an empty reason, so the real check above would have failed on it
  create or replace function public.admin_reenable_partner_webhook_endpoint(p_endpoint_id uuid, p_reason text) returns void
  language plpgsql security definer set search_path = '' as $s$
  begin
    update public.partner_webhook_endpoints set is_active = true where id = p_endpoint_id;
  end $s$;
  begin perform public.admin_reenable_partner_webhook_endpoint(v_ep, null); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('sabotaged', 'reason check removed: an empty reason is refused', '22023', v_err);

  -- 6b. SABOTAGE: an overview that returns the secret and drops the organisation filter; the same two checks must now FAIL
  create or replace function public.partner_webhook_admin_overview()
  returns table (
    endpoint_id uuid, name text, partner_name text, url text, environment text, event_types text[],
    is_active boolean, auto_disabled_at timestamptz, disabled_reason text, consecutive_failures integer,
    last_success_at timestamptz, last_failure_at timestamptz, signing_key_version integer, previous_key_expires_at timestamptz,
    queued bigint, dead bigint, delivered_24h bigint)
  language sql security definer set search_path = '' as $s$
    select e.id, e.name, 'x'::text, e.secret, e.environment::text, '{}'::text[], e.is_active, e.auto_disabled_at, e.disabled_reason,
           e.consecutive_failures, e.last_success_at, e.last_failure_at, e.signing_key_version, null::timestamptz, 0::bigint, 0::bigint, 0::bigint
      from public.partner_webhook_endpoints e
  $s$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  insert into results values ('sabotaged', 'secret leaked into the overview: the no-secret check must catch it', 'false',
    (position((select secret from public.partner_webhook_endpoints where id = v_ep) in (select jsonb_agg(to_jsonb(o))::text from public.partner_webhook_admin_overview() o where endpoint_id = v_ep)) > 0)::text);
  insert into results values ('sabotaged', 'org filter dropped: the other organisation endpoint must not be listed', '0',
    (select count(*)::text from public.partner_webhook_admin_overview() where endpoint_id = v_ep2));
  -- the sabotaged function must not survive: the transaction is rolled back below.
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S10y proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 3 then
    raise exception 'VACUOUS TEST: expected both sabotages to fail their checks, only % did', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to FAIL inside the DO block above (a vacuous test raises). They are deliberately not printed:
-- the runner treats any FAIL verdict in the output as a failed proof.

rollback;
