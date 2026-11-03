-- Care Circle supporter join path proof (migration *_care_circle_supporter_join_path.sql). One rolled-back transaction.
-- Proves: with invite-only sign-up ON, a contact holding a valid pending Care Circle invite may sign up ONLY as a supporter-only account
-- (email, or the phone GoTrue holds; never a phone typed into metadata), a patient sign-up on the same contact is still refused, a stranger
-- and an expired invite are refused, the invite is not consumed; a supporter sign-up is receives_care = false from the first row (control:
-- an ordinary sign-up still receives care); the kind pre-check agrees; the signed-out landing answers only for a valid invite, says only the
-- first name, the view permissions and the masked contact, counts no attempt and is service role only; the signed-in status names the
-- reason (wrong contact, own invite, expired, already a member). SABOTAGE (each must flip a check): the carve-out without its
-- supporter-only test lets a patient sign-up through; the default trigger dropped leaves a supporter receiving care.
begin;

create temp table fx(k text primary key, v text) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns text language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v text) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.as_role(p_role text, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  perform set_config('request.jwt.claim.role', p_role, true);
  execute format('set local role %I', p_role);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
-- a GoTrue-style sign-up through the real trigger (the test setting makes the gate apply); 'ok' or the error
create function pg_temp.signup(p_email text, p_phone text, p_meta jsonb) returns text language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  perform set_config('tarragon.signup_gate_test', 'on', true);
  begin
    insert into auth.users (id, email, phone, encrypted_password, raw_app_meta_data, raw_user_meta_data)
    values (v, p_email, p_phone, 'x', '{}', p_meta);
  exception when others then
    perform set_config('tarragon.signup_gate_test', '', true);
    return 'ERR:' || sqlerrm;
  end;
  perform set_config('tarragon.signup_gate_test', '', true);
  perform pg_temp.setf('last', v::text);
  return 'ok';
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ccj-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = p_org, role = 'patient', full_name = 'Adaeze ' || p_label || ' Okafor', is_test = true, is_active = true where id = v;
  return v;
end $f$;
create function pg_temp.invite(p_pat uuid, p_kind text, p_contact text, p_label text) returns void language plpgsql as
$f$ declare r text; j jsonb;
begin
  r := pg_temp.q_as(p_pat, format($q$select public.create_care_circle_invite(%L, %L, 'Sister', array['weekly_bp_trend','red_alerts','pay_for_care']::text[])::text$q$, p_kind, p_contact));
  if r is null or r like 'ERR:%' then raise exception 'fixture: invite % not created: %', p_label, r; end if;
  j := r::jsonb;
  perform pg_temp.setf('tok-' || p_label, j ->> 'token');
  perform pg_temp.setf('inv-' || p_label, j ->> 'invite_id');
end $f$;

do $$
declare
  v_org uuid; v_pat uuid; v_stranger uuid; v_sup uuid; r text; j jsonb; v_n int;
  sfx text := substr(gen_random_uuid()::text, 1, 8);
  e1 text := 'ccj-aunty-' || sfx || '@example.invalid';
  e2 text := 'ccj-brother-' || sfx || '@example.invalid';
  e3 text := 'ccj-expired-' || sfx || '@example.invalid';
  ph text := '+23480' || lpad((random() * 99999999)::int::text, 8, '0');
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture missing: organisation'; end if;
  v_pat := pg_temp.mkuser(v_org, 'patient');
  v_stranger := pg_temp.mkuser(v_org, 'stranger');

  perform pg_temp.invite(v_pat, 'email', e1, 'e1');
  perform pg_temp.invite(v_pat, 'email', e2, 'e2');
  perform pg_temp.invite(v_pat, 'email', e3, 'e3');
  perform pg_temp.invite(v_pat, 'phone', ph, 'ph');
  update public.care_circle_invites set expires_at = now() - interval '1 minute' where id = pg_temp.f('inv-e3')::uuid;

  -- invite-only ON, open guard OFF (control: the switch really is the gate)
  update public.platform_switches set is_on = true where key = 'signup_invites_required';
  update public.go_live_guards set is_on = false where key = 'public_signup_enabled';
  if pg_temp.signup('ccj-plain-' || sfx || '@example.invalid', null, '{}') not like 'ERR:%signup_invite_required%' then
    raise exception 'CONTROL FAIL: an uninvited sign-up got through with invite-only on';
  end if;

  -- 1. the invited email, as a supporter: allowed, and supporter-only from the first row
  r := pg_temp.signup(e1, null, '{"account_purpose":"support"}');
  if r <> 'ok' then raise exception 'FAIL: the invited email could not sign up as a supporter: %', r; end if;
  v_sup := pg_temp.f('last')::uuid;
  if (select receives_care from public.profiles where id = v_sup) is distinct from false then
    raise exception 'FAIL: a supporter sign-up was created receiving care';
  end if;
  if (select state from public.care_circle_invites where id = pg_temp.f('inv-e1')::uuid) <> 'pending' then
    raise exception 'FAIL: signing up consumed the Care Circle invite';
  end if;

  -- 2. the invited email, as a patient: still refused
  r := pg_temp.signup(e2, null, '{}');
  if r not like 'ERR:%signup_invite_required%' then raise exception 'FAIL: a Care Circle invite let a PATIENT sign-up through: %', r; end if;
  r := pg_temp.signup(e2, null, '{"account_purpose":"care"}');
  if r not like 'ERR:%signup_invite_required%' then raise exception 'FAIL: any account_purpose other than support was let through: %', r; end if;

  -- 3. a stranger as a supporter, and an expired invite: refused
  if pg_temp.signup('ccj-nobody-' || sfx || '@example.invalid', null, '{"account_purpose":"support"}') not like 'ERR:%signup_invite_required%' then
    raise exception 'FAIL: a stranger signed up as a supporter with no invite';
  end if;
  if pg_temp.signup(e3, null, '{"account_purpose":"support"}') not like 'ERR:%signup_invite_required%' then
    raise exception 'FAIL: an expired Care Circle invite let a sign-up through';
  end if;

  -- 4. a phone invite: the phone GoTrue holds (stored without the +) counts; a phone typed into metadata never does
  if pg_temp.signup('ccj-meta-' || sfx || '@example.invalid', null, jsonb_build_object('account_purpose', 'support', 'phone', ph)) not like 'ERR:%signup_invite_required%' then
    raise exception 'FAIL: an unverified metadata phone borrowed a Care Circle phone invite';
  end if;
  r := pg_temp.signup(null, substr(ph, 2), '{"account_purpose":"support"}');
  if r <> 'ok' then raise exception 'FAIL: the invited phone could not sign up as a supporter: %', r; end if;

  -- 5. the kind pre-check agrees, and is service role only
  if pg_temp.as_role('service_role', format('select public.signup_gate_status_supporter(null, %L, null)::text', e2)) <> 'true' then
    raise exception 'FAIL: the supporter pre-check said no to an invited email';
  end if;
  if pg_temp.as_role('service_role', format('select public.signup_gate_status(null, %L, null)::text', e2)) <> 'false' then
    raise exception 'FAIL: the ordinary pre-check said yes to an invited email (that is a patient sign-up)';
  end if;
  if pg_temp.as_role('anon', 'select public.signup_gate_status_supporter(null, null, null)::text') <> 'ERR:42501'
     or pg_temp.as_role('authenticated', 'select public.signup_gate_status_supporter(null, null, null)::text') <> 'ERR:42501' then
    raise exception 'FAIL: the supporter pre-check is reachable outside the service role';
  end if;

  -- 6. the signed-out landing
  select attempts into v_n from public.care_circle_invites where id = pg_temp.f('inv-e2')::uuid;
  j := pg_temp.as_role('service_role', format('select public.care_circle_invite_landing(%L)::text', pg_temp.f('tok-e2')))::jsonb;
  if (j ->> 'ok') <> 'true' or (j ->> 'inviter_first_name') <> 'Adaeze' or (j ->> 'contact_kind') <> 'email' or j ->> 'contact_hint' is null then
    raise exception 'FAIL: the landing did not describe a valid invite: %', j;
  end if;
  if (j -> 'permissions') ? 'pay_for_care' or not (j -> 'permissions') ? 'weekly_bp_trend' then
    raise exception 'FAIL: the landing permissions are wrong: %', j -> 'permissions';
  end if;
  if j ? 'relationship' or j ? 'patient_id' or j::text ilike '%Okafor%' or j::text ilike '%' || e2 || '%' then
    raise exception 'FAIL: the landing said more than the first name and the permissions: %', j;
  end if;
  if (select attempts from public.care_circle_invites where id = pg_temp.f('inv-e2')::uuid) <> v_n then
    raise exception 'FAIL: the landing counted an attempt';
  end if;
  if pg_temp.as_role('service_role', format('select public.care_circle_invite_landing(%L)::text', pg_temp.f('tok-e3')))::jsonb <> '{"ok": false}'::jsonb
     or pg_temp.as_role('service_role', format('select public.care_circle_invite_landing(%L)::text', repeat('x', 43)))::jsonb <> '{"ok": false}'::jsonb
     or pg_temp.as_role('service_role', 'select public.care_circle_invite_landing(''short'')::text')::jsonb <> '{"ok": false}'::jsonb then
    raise exception 'FAIL: an expired, unknown or malformed token was not the same {ok:false}';
  end if;
  if pg_temp.as_role('anon', format('select public.care_circle_invite_landing(%L)::text', pg_temp.f('tok-e2'))) <> 'ERR:42501'
     or pg_temp.as_role('authenticated', format('select public.care_circle_invite_landing(%L)::text', pg_temp.f('tok-e2'))) <> 'ERR:42501' then
    raise exception 'FAIL: the landing is reachable outside the service role';
  end if;

  -- 7. the signed-in status, for the person holding the link
  r := pg_temp.q_as(v_stranger, format('select public.care_circle_invite_status(%L)::text', pg_temp.f('tok-e1')));
  if (r::jsonb ->> 'reason') <> 'wrong_contact' or (r::jsonb ->> 'contact_kind') <> 'email' then raise exception 'FAIL: wrong contact not named: %', r; end if;
  r := pg_temp.q_as(v_pat, format('select public.care_circle_invite_status(%L)::text', pg_temp.f('tok-e1')));
  if (r::jsonb ->> 'reason') <> 'own_invite' then raise exception 'FAIL: own invite not named: %', r; end if;
  r := pg_temp.q_as(v_stranger, format('select public.care_circle_invite_status(%L)::text', pg_temp.f('tok-e3')));
  if (r::jsonb ->> 'reason') <> 'expired' then raise exception 'FAIL: expiry not named: %', r; end if;
  if pg_temp.as_role('anon', format('select public.care_circle_invite_status(%L)::text', pg_temp.f('tok-e1'))) <> 'ERR:42501' then
    raise exception 'FAIL: anon can ask the status of an invite';
  end if;
  -- the supporter confirms their email, accepts, and the same link now says they are already in
  update auth.users set email_confirmed_at = now() where id = v_sup;
  update public.profiles set is_test = true where id = v_sup;
  r := pg_temp.q_as(v_sup, format('select public.accept_care_circle_invite(%L)::text', pg_temp.f('tok-e1')));
  if (r::jsonb ->> 'ok') <> 'true' then raise exception 'FAIL: the new supporter could not accept: %', r; end if;
  r := pg_temp.q_as(v_sup, format('select public.care_circle_invite_status(%L)::text', pg_temp.f('tok-e1')));
  if (r::jsonb ->> 'reason') <> 'already_member' or (r::jsonb ->> 'patient_id') <> v_pat::text then raise exception 'FAIL: already a member not named: %', r; end if;
  -- the status never accepts, and asking it changed no attempt count
  if (select attempts from public.care_circle_invites where id = pg_temp.f('inv-e1')::uuid) <> 0 then
    raise exception 'FAIL: the status or landing counted an attempt on the accepted invite';
  end if;

  -- 8. CONTROL: an ordinary sign-up, switch OFF, still receives care
  update public.platform_switches set is_on = false where key = 'signup_invites_required';
  r := pg_temp.signup('ccj-patient-' || sfx || '@example.invalid', null, '{}');
  if r <> 'ok' or (select receives_care from public.profiles where id = pg_temp.f('last')::uuid) is distinct from true then
    raise exception 'CONTROL FAIL: an ordinary sign-up did not receive care (%)', r;
  end if;
  update public.platform_switches set is_on = true where key = 'signup_invites_required';

  -- SABOTAGE 1: the carve-out without its supporter-only test must let the patient sign-up through (the check above must flip)
  create or replace function private.signup_circle_invite_ok(p_phone text, p_email text, p_meta jsonb) returns boolean
  language plpgsql stable security definer set search_path = '' as $s$
  begin
    return exists (select 1 from public.care_circle_invites i where i.state = 'pending' and i.expires_at > now() and i.invitee_kind = 'email'
                     and i.invitee_hash = private.circle_contact_hash(private.circle_normalise_contact('email', p_email)));
  end $s$;
  if pg_temp.signup(e2, null, '{}') like 'ERR:%' then
    raise exception 'VACUOUS: with the supporter-only test removed, the patient sign-up was still refused';
  end if;

  -- SABOTAGE 2: without the default trigger a supporter sign-up receives care (the check in 1 must flip)
  drop trigger profiles_00_supporter_signup_default on public.profiles;
  update public.platform_switches set is_on = false where key = 'signup_invites_required';
  r := pg_temp.signup('ccj-sab-' || sfx || '@example.invalid', null, '{"account_purpose":"support"}');
  if r <> 'ok' or (select receives_care from public.profiles where id = pg_temp.f('last')::uuid) is distinct from true then
    raise exception 'VACUOUS: with the default trigger dropped, the supporter sign-up still did not receive care';
  end if;

  raise notice 'care_circle_supporter_join_path: all checks passed';
end $$;

select 'care_circle_supporter_join_path' as check_name, 'all' as observed, 'all' as expected, 'PASS' as verdict;

rollback;
