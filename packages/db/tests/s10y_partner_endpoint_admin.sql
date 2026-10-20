-- S10y proof: admin partner endpoint screen support (migration *_s10y_partner_endpoint_admin.sql).
-- One rolled-back transaction, simulated admin session AND non-admin control:
--   1. List: admin sees the endpoint with status columns; no column named secret or previous_secret; a clinician is refused.
--   2. Re-enable: no reason / short reason refused; a non-admin refused; admin with a reason switches it on, counter reset, audit row
--      carries the reason; re-enabling an endpoint that is already on is refused.
--   3. Rotation through the existing function: the new secret never appears in the audit log nor in the list output.
--   4. Mapping disable: non-admin refused, admin removes it and the subscriber goes inactive.
--   5. anon cannot execute any of the three new functions.
--   6. SABOTAGE: the reason check is removed inside the transaction; the "empty reason refused" check must then FAIL.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

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
  v_org uuid; v_admin uuid; v_clin uuid; v_partner uuid; v_ep uuid; v_new text; v_err text; v_cols text; v_n integer;
  v_key text; v_org2 uuid; v_ep2 uuid; v_partner2 uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_clin := pg_temp.mkuser(v_org, 'clinician', 'clinician');

  insert into public.partner_integrations (organisation_id, name, base_url) values (v_org, 's10y partner', 'https://example.invalid') returning id into v_partner;
  insert into public.partner_webhook_endpoints (organisation_id, partner_integration_id, name, url, secret, event_types, environment,
                                                is_active, consecutive_failures, auto_disabled_at, disabled_reason)
    values (v_org, v_partner, 's10y ep', 'https://svc:pw@hooks.example.invalid:8443/path/x', repeat('a', 40), array['result.available']::public.integration_event_type[], 'live',
            false, 20, now(), 'Switched off automatically')
    returning id into v_ep;

  insert into public.organisations (name, type) values ('s10y other org', (select type from public.organisations where id = v_org)) returning id into v_org2;
  insert into public.partner_integrations (organisation_id, name, base_url) values (v_org2, 's10y other partner', 'https://example.invalid') returning id into v_partner2;
  insert into public.partner_webhook_endpoints (organisation_id, partner_integration_id, name, url, secret, event_types, environment, is_active)
    values (v_org2, v_partner2, 's10y other ep', 'https://other.example.invalid/x', repeat('c', 40), array['result.available']::public.integration_event_type[], 'live', false)
    returning id into v_ep2;

  -- 1. List ----------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform * from public.admin_list_partner_webhook_endpoints(); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  reset role;
  insert into results values ('real', 'a clinician cannot list endpoints', '42501', v_err);

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.admin_list_partner_webhook_endpoints() where id = v_ep and url_host = 'hooks.example.invalid:8443' and not is_active and consecutive_failures = 20;
  insert into results values ('real', 'admin sees the endpoint with host, status and failures', '1', v_n::text);
  reset role;
  select string_agg(n, ',') into v_cols
    from (select unnest(p.proargnames) n from pg_proc p
           where p.proname = 'admin_list_partner_webhook_endpoints' and p.pronamespace = 'public'::regnamespace) q
   where n in ('secret', 'previous_secret');
  insert into results values ('real', 'list output has no secret column', 'null', coalesce(v_cols, 'null'));

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.admin_list_partner_webhook_endpoints() where id = v_ep2;
  insert into results values ('real', 'another organisation endpoint is not listed', '0', v_n::text);
  begin perform public.admin_reenable_partner_webhook_endpoint(v_ep2, 'trying another organisation'); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  reset role;
  insert into results values ('real', 'another organisation endpoint cannot be re-enabled', 'P0001|false', v_err || '|' || (select is_active::text from public.partner_webhook_endpoints where id = v_ep2));

  -- 2. Re-enable -------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.admin_reenable_partner_webhook_endpoint(v_ep, null); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'empty reason refused', '22023', v_err);
  begin perform public.admin_reenable_partner_webhook_endpoint(v_ep, 'short'); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'short reason refused', '22023', v_err);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.admin_reenable_partner_webhook_endpoint(v_ep, 'partner fixed their server'); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  reset role;
  insert into results values ('real', 'a clinician cannot re-enable', '42501', v_err);
  insert into results values ('real', 'endpoint still off after refusals', 'false|20', (select is_active::text || '|' || consecutive_failures::text from public.partner_webhook_endpoints where id = v_ep));

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_reenable_partner_webhook_endpoint(v_ep, 'partner fixed their server');
  begin perform public.admin_reenable_partner_webhook_endpoint(v_ep, 'partner fixed their server'); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  reset role;
  insert into results values ('real', 'admin re-enable resets state', 'true|0|true',
    (select is_active::text || '|' || consecutive_failures::text || '|' || (auto_disabled_at is null and disabled_reason is null)::text from public.partner_webhook_endpoints where id = v_ep));
  insert into results values ('real', 're-enable is audited with the reason', '1',
    (select count(*)::text from public.audit_log where action = 'integration.webhook.reenabled' and event::text like '%partner fixed their server%'));
  insert into results values ('real', 're-enabling an endpoint already on is refused', '55000', v_err);

  -- 3. Rotation: secret never in audit or list ---------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_new := public.rotate_partner_webhook_secret(v_ep, 24);
  select count(*) into v_n from public.admin_list_partner_webhook_endpoints() w
   where w.signing_key_version = 2 and w.previous_secret_expires_at > now() + interval '23 hours' and to_jsonb(w)::text not like '%' || v_new || '%';
  reset role;
  insert into results values ('real', 'after rotation the list shows version 2 and the grace end, without the secret', '1', v_n::text);
  insert into results values ('real', 'the new secret is not in the audit log', '0', (select count(*)::text from public.audit_log where event::text like '%' || v_new || '%'));

  -- 4. Mapping disable ---------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_key := public.set_partner_event_mapping('lab_result.released', 'result.available', array['lab_result_id']);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.admin_disable_partner_event_mapping('lab_result.released'); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  reset role;
  insert into results values ('real', 'a clinician cannot remove a mapping', '42501', v_err);
  -- the event type is switched off after it was mapped: the mapping must still be removable
  update public.event_types set is_active = false where event_type = 'lab_result.released';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_disable_partner_event_mapping('lab_result.released');
  reset role;
  insert into results values ('real', 'admin removes the mapping and the subscriber goes inactive', '0|false',
    (select (select count(*) from public.partner_event_map where bus_event_type = 'lab_result.released')::text || '|' ||
            (select is_active::text from public.event_subscribers where subscriber_key = v_key)));

  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform * from public.admin_list_partner_event_mappings(); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  reset role;
  insert into results values ('real', 'a clinician cannot list mappings', '42501', v_err);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.admin_list_partner_event_mappings() where event_type = 'lab_result.released' and not mapped;
  reset role;
  insert into results values ('real', 'admin sees the event type as not mapped after removal', '1', v_n::text);

  -- 5. anon ------------------------------------------------------------------------------------------
  insert into results values ('real', 'anon cannot execute the new functions', 'false',
    (has_function_privilege('anon', 'public.admin_list_partner_webhook_endpoints()', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_reenable_partner_webhook_endpoint(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_list_partner_event_mappings()', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_disable_partner_event_mapping(text)', 'EXECUTE'))::text);

  -- 6. SABOTAGE: remove the reason check, the same check must now fail ------------------------------------
  update public.partner_webhook_endpoints set is_active = false where id = v_ep;
  create or replace function public.admin_reenable_partner_webhook_endpoint(p_endpoint_id uuid, p_reason text)
  returns void language plpgsql security definer set search_path = '' as $f$
  begin update public.partner_webhook_endpoints set is_active = true where id = p_endpoint_id; end $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.admin_reenable_partner_webhook_endpoint(v_ep, null); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  reset role;
  insert into results values ('sabotaged', 'reason check removed: empty reason refused', '22023', v_err);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S10y proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 1 then
    raise exception 'VACUOUS TEST: the sabotage did not flip the reason check';
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
