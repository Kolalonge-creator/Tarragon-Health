-- Signup invite list proof: off by default; when on, GoTrue-created users need a pilot invite (phone, email, code), a sponsor-paid phone, an
-- admin-created exempt account, or the open guard; single-use and max-use limits hold; expired, revoked and self-declared exemptions are refused;
-- migrations and owner scripts are never gated; no anon access; the code is stored only as a hash. Own fixtures; BEGIN/ROLLBACK; sabotage last.
begin;

do $$
declare
  v_org uuid; v_admin uuid := gen_random_uuid(); v_pat uuid; v_prod uuid; v_inv jsonb; v_code text; v_ok boolean; v_msg text; v_n int; v_id uuid;
  v_phone_id uuid; v_email_id uuid;

begin
  select id into v_org from public.organisations limit 1;
  select id into v_pat from public.profiles where role = 'patient' limit 1;
  select id into v_prod from public.service_products limit 1;
  if v_org is null or v_pat is null or v_prod is null then raise exception 'fixture missing'; end if;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_admin, 'inv-admin@example.invalid','x',now(),'{}','{}');
  update public.profiles set organisation_id = v_org, role = 'admin', full_name = 'Inv Admin', is_test = true where id = v_admin;

  if public.platform_switch_is_on('signup_invites_required') then raise exception 'control failure: the switch is already on'; end if;
  if exists (select 1 from public.go_live_guards where key = 'public_signup_enabled' and is_on) then raise exception 'control failure: public signup guard is on'; end if;

  -- the real grants GoTrue's role needs (the proof cannot impersonate it, so the gate is exercised through the test setting)
  if not has_schema_privilege('supabase_auth_admin', 'private', 'USAGE')
     or not has_function_privilege('supabase_auth_admin', 'private.enforce_signup_invite()', 'EXECUTE')
     or not has_function_privilege('supabase_auth_admin', 'private.signup_may_create_user(text, text, jsonb, jsonb)', 'EXECUTE')
     or not has_function_privilege('supabase_auth_admin', 'public.platform_switch_is_on(text)', 'EXECUTE')
     or not has_function_privilege('supabase_auth_admin', 'private.go_live_guard_on(text)', 'EXECUTE') then
    raise exception 'FAIL: GoTrue''s role lacks a privilege the trigger needs';
  end if;
  if has_function_privilege('anon', 'private.enforce_signup_invite()', 'EXECUTE') then raise exception 'FAIL: anon can run the trigger function'; end if;
  perform set_config('tarragon.signup_gate_test', 'on', true);

  -- 1. switch OFF (the shipped state): GoTrue can create anyone
  
  insert into auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data) values (gen_random_uuid(), 'open1@example.invalid', 'x', '{}', '{}');
  reset role;

  -- switch ON
  update public.platform_switches set is_on = true where key = 'signup_invites_required';

  -- 2. GATE: GoTrue, no invite -> refused with the code the app maps to a kind message
  
  begin insert into auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data) values (gen_random_uuid(), 'stranger@example.invalid', 'x', '{}', '{}'); v_ok := true; v_msg := null;
  exception when others then v_ok := false; v_msg := sqlerrm; end;
  reset role;
  if v_ok or v_msg is distinct from 'signup_invite_required' then raise exception 'FAIL: an uninvited sign-up was not refused (ok %, msg %)', v_ok, v_msg; end if;

  -- 3. CONTROL: the owner (migrations, scripts, proofs) is never gated: the gate is off for it
  perform set_config('tarragon.signup_gate_test', '', true);
  insert into auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data) values (gen_random_uuid(), 'owner-made@example.invalid', 'x', '{}', '{}');
  perform set_config('tarragon.signup_gate_test', 'on', true);

  -- 4. admin creates invites (as a real admin session)
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  v_inv := public.create_signup_invite('phone', '+2348011112222', 'Lagos pilot week 1');
  v_phone_id := (v_inv ->> 'id')::uuid;
  v_inv := public.create_signup_invite('email', 'Pilot.User@Example.Invalid', 'Clinic referral');
  v_email_id := (v_inv ->> 'id')::uuid;
  v_inv := public.create_signup_invite('code', null, 'Employer launch event', 2, 14);
  v_code := v_inv ->> 'code';
  begin perform public.create_signup_invite('phone', '08011112222', 'bad format'); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: a phone number not in international format was accepted'; end if;
  begin perform public.create_signup_invite('code', null, 'x'); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: an invite with no real label was accepted'; end if;
  reset role;
  if v_code is null or length(v_code) <> 10 then raise exception 'FAIL: code not returned once (%)', v_code; end if;
  if exists (select 1 from public.signup_invites where code_hash = v_code or code_hash ilike '%' || v_code || '%') then raise exception 'FAIL: the code is stored in the clear'; end if;
  if exists (select 1 from public.signup_invites where kind = 'code' and (phone is not null or email is not null)) then raise exception 'FAIL: a code invite carries an identifier'; end if;

  -- 5. a phone invite lets that phone through (GoTrue stores phones without the +), once
  
  insert into auth.users (id, phone, encrypted_password, raw_app_meta_data, raw_user_meta_data) values (gen_random_uuid(), '2348011112222', 'x', '{}', '{}');
  reset role;
  select uses into v_n from public.signup_invites where id = v_phone_id;
  if v_n <> 1 then raise exception 'FAIL: phone invite uses = % after one sign-up', v_n; end if;
  -- the same invite cannot be used by anyone else (another account on the same number would hit the unique constraint first, so use the metadata phone)
  
  begin insert into auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data) values (gen_random_uuid(), 'second@example.invalid', 'x', '{}', '{"phone":"+2348011112222"}'); v_ok := true; v_msg := null;
  exception when others then v_ok := false; v_msg := sqlerrm; end;
  reset role;
  if v_ok then raise exception 'FAIL: a single-use phone invite was used twice'; end if;

  -- 6. an email invite matches regardless of case
  
  insert into auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data) values (gen_random_uuid(), 'pilot.user@example.invalid', 'x', '{}', '{}');
  reset role;

  -- 7. a code with two uses: lower case works, a third person is refused, and the code is not an identifier
  
  insert into auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data) values (gen_random_uuid(), 'c1@example.invalid', 'x', '{}', jsonb_build_object('invite_code', lower(v_code)));
  insert into auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data) values (gen_random_uuid(), 'c2@example.invalid', 'x', '{}', jsonb_build_object('invite_code', ' ' || v_code || ' '));
  begin insert into auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data) values (gen_random_uuid(), 'c3@example.invalid', 'x', '{}', jsonb_build_object('invite_code', v_code)); v_ok := true;
  exception when others then v_ok := false; end;
  reset role;
  if v_ok then raise exception 'FAIL: a code used beyond its max uses'; end if;
  begin  insert into auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data) values (gen_random_uuid(), 'wrongcode@example.invalid', 'x', '{}', '{"invite_code":"ZZZZZZZZZZ"}'); v_ok := true;
  exception when others then v_ok := false; end;
  reset role;
  if v_ok then raise exception 'FAIL: a wrong code was accepted'; end if;

  -- 8. expired and revoked invites are refused
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  v_inv := public.create_signup_invite('email', 'expired@example.invalid', 'Will expire');
  v_id := (v_inv ->> 'id')::uuid;
  reset role;
  update public.signup_invites set expires_at = now() - interval '1 day' where id = v_id;
  
  begin insert into auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data) values (gen_random_uuid(), 'expired@example.invalid', 'x', '{}', '{}'); v_ok := true; exception when others then v_ok := false; end;
  reset role;
  if v_ok then raise exception 'FAIL: an expired invite worked'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  v_inv := public.create_signup_invite('email', 'revoked@example.invalid', 'Will be revoked');
  perform public.revoke_signup_invite((v_inv ->> 'id')::uuid);
  reset role;
  
  begin insert into auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data) values (gen_random_uuid(), 'revoked@example.invalid', 'x', '{}', '{}'); v_ok := true; exception when others then v_ok := false; end;
  reset role;
  if v_ok then raise exception 'FAIL: a revoked invite worked'; end if;

  -- 9. exemption: only app metadata (admin API) counts; a visitor-declared flag in user metadata does not
  
  insert into auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data) values (gen_random_uuid(), 'exempt@example.invalid', 'x', '{"signup_exempt":"true"}', '{}');
  begin insert into auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data) values (gen_random_uuid(), 'selfexempt@example.invalid', 'x', '{}', '{"signup_exempt":"true"}'); v_ok := true; exception when others then v_ok := false; end;
  reset role;
  if v_ok then raise exception 'FAIL: a visitor exempted themselves through user metadata'; end if;

  -- 10. a sponsor-paid phone number is never locked out
  insert into public.sponsored_service_reservations (organisation_id, service_product_id, sponsor_profile_id, recipient_phone, recipient_first_name, status, amount_kobo, invite_token)
  values (v_org, v_prod, v_pat, '+2348033334444', 'Amaka', 'invited', 500000, 'proof-token-1');
  
  insert into auth.users (id, phone, encrypted_password, raw_app_meta_data, raw_user_meta_data) values (gen_random_uuid(), '2348033334444', 'x', '{}', '{}');
  reset role;

  -- 11. the kind pre-check answers without consuming
  select uses into v_n from public.signup_invites where id = v_email_id;
  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  set local role service_role;
  v_ok := public.signup_gate_status(null, 'nobody@example.invalid', null);
  reset role;
  if v_ok then raise exception 'FAIL: the pre-check said yes to an uninvited email'; end if;
  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  set local role service_role;
  v_ok := public.signup_gate_status('+2348055556666', 'fresh-invite@example.invalid', null);
  reset role;
  if v_ok then raise exception 'FAIL: the pre-check said yes with no invite'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.create_signup_invite('email', 'fresh-invite@example.invalid', 'Pre-check test');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  set local role service_role;
  v_ok := public.signup_gate_status(null, 'fresh-invite@example.invalid', null);
  reset role;
  if not v_ok then raise exception 'FAIL: the pre-check said no to an invited email'; end if;
  if (select uses from public.signup_invites where email = 'fresh-invite@example.invalid') <> 0 then raise exception 'FAIL: the pre-check consumed the invite'; end if;

  -- 12. access: anon and a patient can do nothing; a signed-in patient cannot ask the gate; the table is unreadable
  begin set local role anon; perform public.signup_invites_list(); v_ok := true; exception when others then v_ok := false; end;
  reset role;
  if v_ok then raise exception 'FAIL: anon listed invites'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.create_signup_invite('code', null, 'patient made'); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: a patient created an invite'; end if;
  begin perform public.signup_gate_status(null, 'x@example.invalid', null); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: a signed-in patient called the gate pre-check'; end if;
  begin perform count(*) from public.signup_invites; v_ok := true; exception when insufficient_privilege then v_ok := false; end;
  if v_ok then raise exception 'FAIL: a patient read the invites table'; end if;
  reset role;

  -- 13. the open guard lets everyone in
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note) values ('public_signup_enabled', 'switched_on', v_admin, 'admin', 'proof');
  update public.go_live_guards set is_on = true, changed_at = now(), changed_by = v_admin, change_note = 'proof' where key = 'public_signup_enabled';
  
  insert into auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data) values (gen_random_uuid(), 'guard-open@example.invalid', 'x', '{}', '{}');
  reset role;
  raise notice 'PASS: invite-only gate (phone, email, code, sponsor-paid, exempt, guard) with limits, refusals and a hashed code';

  -- SABOTAGE: a checker that always says yes lets the uninvited in
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note) values ('public_signup_enabled', 'switched_off', v_admin, 'admin', 'proof off');
  update public.go_live_guards set is_on = false, changed_at = now(), changed_by = v_admin, change_note = 'proof off' where key = 'public_signup_enabled';
  create or replace function private.signup_may_create_user(p_phone text, p_email text, p_meta jsonb, p_app_meta jsonb) returns boolean language sql as $f$ select true $f$;
  
  insert into auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data) values (gen_random_uuid(), 'sabotage-stranger@example.invalid', 'x', '{}', '{}');
  reset role;
  raise notice 'PASS: sabotage confirmed (an always-yes checker admits the uninvited)';
end $$;

rollback;
