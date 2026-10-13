-- S09x proof: My Health completion (migration *_s09x_my_health_completion.sql).
--   a. the patient's access log: one function, scoped to the caller, newest first, no clinical content, routine staff opens hidden by config.
--   b. safer sharing: PIN (hashed, salted, shown once), lockout, per-client rate limit, one-session, revoke, expiry, default expiry from config,
--      no direct writes, no staff read of a share credential, no pin_hash to any client, the anon door answers null for every dead link alike.
--   c. lock-screen presence: off by default, minimal facts (no allergen, condition or medicine name), the governed field list (CMO signs),
--      the wallet_pass guard born off and impossible to switch on.
-- One rolled-back transaction. is_test data only. SABOTAGE section at the end: the lockout, the PIN check and the minimiser are each broken
-- once; the matching checks must flip (otherwise the test is vacuous).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
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
-- run one query as a signed-in user, return its single text value, or 'ERR:' || message
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- the same as the anonymous caller
create function pg_temp.q_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's09x-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S09x ' || p_label || ' Person', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S09x ' || p_label, 'MDCN', 'S09X-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true);
  return v;
end $f$;
-- create a share as a user; returns the jsonb text
create function pg_temp.mk_share(p_uid uuid, p_pin boolean, p_one_session boolean default false, p_hours integer default null) returns jsonb
language plpgsql as $f$
declare r text;
begin
  r := pg_temp.q_as(p_uid, format('select public.create_record_share(array[''vitals'',''emergency_info'']::text[], %s, %L, %L)::text',
                                  coalesce(p_hours::text, 'null'), p_pin, p_one_session));
  return r::jsonb;
end $f$;
create function pg_temp.open(p_token text, p_pin text, p_client text) returns jsonb
language plpgsql as $f$
declare r text;
begin
  r := pg_temp.q_anon(format('select public.record_share_by_token(%L, %L, %L)::text', p_token, p_pin, p_client));
  return r::jsonb;
end $f$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_p uuid; v_q uuid; v_g uuid; v_card uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  v_p := pg_temp.mkuser(v_org, 'patient', 'patient');  perform pg_temp.setf('p', v_p);
  v_q := pg_temp.mkuser(v_org, 'other', 'patient');    perform pg_temp.setf('q', v_q);
  v_g := pg_temp.mkuser(v_org, 'grantee', 'patient');  perform pg_temp.setf('g', v_g);
  perform pg_temp.setf('senior', pg_temp.mkdoc(v_org, 'senior', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin));
  update public.profiles set emergency_contact_name = 'S09x Contact', emergency_contact_phone = '+2348012345678', emergency_contact_relationship = 'sibling' where id = v_p;
  insert into public.patient_blood_profile (patient_id, organisation_id, blood_group, genotype, provenance, attested_at, attestation_version)
  values (v_p, v_org, 'O+', 'AA', 'patient_attested', now(), 'v1');
  insert into public.patient_allergies (organisation_id, patient_id, allergen, reaction) values (v_org, v_p, 'penicillin-s09x', 'rash');
  insert into public.care_plans (organisation_id, patient_id, condition, status) values (v_org, v_p, 'hypertension', 'active');
exception when others then
  raise exception 'fixture failed: %', sqlerrm;
end $$;

-- 1. Grants and shape -------------------------------------------------------------------------------------------------------------
do $$
declare r text;
begin
  perform pg_temp.ck('anon cannot create a share', '42501', replace(pg_temp.q_anon($q$select public.create_record_share(array['vitals']::text[], 1, false, false)::text$q$), 'ERR:', ''));
  perform pg_temp.ck('anon cannot read an access log', '42501', replace(pg_temp.q_anon('select public.my_access_log()::text'), 'ERR:', ''));
  perform pg_temp.ck('anon cannot read lock-screen facts', '42501', replace(pg_temp.q_anon('select public.my_lock_screen_facts()::text'), 'ERR:', ''));
  perform pg_temp.ck('anon cannot set the pass', '42501', replace(pg_temp.q_anon('select public.set_lock_screen_pass(true)::text'), 'ERR:', ''));
  perform pg_temp.ck('anon cannot sign the config', '42501', replace(pg_temp.q_anon(format('select public.sign_my_health_config(%L)::text', gen_random_uuid())), 'ERR:', ''));
  perform pg_temp.ck('the share door is the one deliberate anon-callable function', 'true|false',
    has_function_privilege('anon', 'public.record_share_by_token(text, text, text)', 'EXECUTE')::text || '|' || has_function_privilege('anon', 'public.create_record_share(text[], integer, boolean, boolean)', 'EXECUTE')::text);
  perform pg_temp.ck('the old one-argument door and the old create signature are gone (no overload left to confuse)', '0',
    (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and ((proname = 'record_share_by_token' and pronargs = 1) or (proname = 'create_record_share' and pronargs = 2))));
  perform pg_temp.ck('no client can read pin_hash', 'false|true',
    has_column_privilege('authenticated', 'public.record_shares', 'pin_hash', 'SELECT')::text || '|' || has_column_privilege('authenticated', 'public.record_shares', 'token', 'SELECT')::text);
  perform pg_temp.ck('no client can write record_shares directly', 'false|false|false',
    has_table_privilege('authenticated', 'public.record_shares', 'INSERT')::text || '|' || has_table_privilege('authenticated', 'public.record_shares', 'UPDATE')::text || '|' || has_table_privilege('authenticated', 'public.record_shares', 'DELETE')::text);
  perform pg_temp.ck('staff no longer have a policy that reads share credentials', '1',
    (select count(*)::text from pg_policy where polrelid = 'public.record_shares'::regclass));
  perform pg_temp.ck('client_hash is not readable by clients', 'false', has_column_privilege('authenticated', 'public.record_share_lookups', 'client_hash', 'SELECT')::text);
  perform pg_temp.ck('the pass guard is born off', 'false', (select is_on::text from public.go_live_guards where key = 'wallet_pass'));
  perform pg_temp.ck('the pass guard can never be satisfied until a conditions branch exists', 'true',
    (not exists (select 1 from jsonb_array_elements(private.go_live_conditions('wallet_pass', null)) c where (c ->> 'met')::boolean))::text);
  r := pg_temp.q_as(pg_temp.f('admin'), $q$select public.set_go_live_guard('wallet_pass', true, 'S09x proof tries to switch it on')::text$q$);
  perform pg_temp.ck('...and an admin cannot switch it on', 'true', (r like 'ERR:%')::text);
  perform pg_temp.ck('...it is still off afterwards', 'false', (select is_on::text from public.go_live_guards where key = 'wallet_pass'));
end $$;

-- 2. Creating a share ---------------------------------------------------------------------------------------------------------------
do $$
declare s jsonb; s2 jsonb; s3 jsonb; r text; v_p uuid := pg_temp.f('p');
begin
  s := pg_temp.mk_share(v_p, false);
  perform pg_temp.setf('share_plain', (s ->> 'id')::uuid);
  perform pg_temp.ck('the default expiry comes from config (12 hours), not the old 24', 'true',
    (abs(extract(epoch from ((s ->> 'expires_at')::timestamptz - now())) - 12 * 3600) < 120)::text);
  perform pg_temp.ck('a share without a PIN carries none', 'false|null', coalesce(s ->> 'pin_protected', 'x') || '|' || coalesce(s ->> 'pin', 'null'));
  perform pg_temp.ck('the 30 day cap still holds', 'true', (pg_temp.q_as(v_p, $q$select public.create_record_share(array['vitals']::text[], 721)::text$q$) like 'ERR:%')::text);
  perform pg_temp.ck('30 days exactly is allowed', 'true', (pg_temp.q_as(v_p, $q$select public.create_record_share(array['vitals']::text[], 720)::text$q$) not like 'ERR:%')::text);
  perform pg_temp.ck('zero hours is refused', 'true', (pg_temp.q_as(v_p, $q$select public.create_record_share(array['vitals']::text[], 0)::text$q$) like 'ERR:%')::text);
  perform pg_temp.ck('reproductive_health is not a shareable section', 'true',
    (pg_temp.q_as(v_p, $q$select public.create_record_share(array['reproductive_health']::text[], 1)::text$q$) like 'ERR:%')::text);
  s2 := pg_temp.mk_share(v_p, true);
  s3 := pg_temp.mk_share(v_p, true);
  perform pg_temp.ck('a PIN share returns a 6 digit PIN once', 'true', ((s2 ->> 'pin') ~ '^[0-9]{6}$' and (s2 ->> 'pin_protected')::boolean)::text);
  perform pg_temp.ck('the PIN is stored as a bcrypt hash, not in clear', 'true',
    (select (pin_hash like '$2%' and pin_hash <> (s2 ->> 'pin'))::text from public.record_shares where id = (s2 ->> 'id')::uuid));
  perform pg_temp.ck('each share has its own salt', 'true',
    ((select substr(pin_hash, 1, 29) from public.record_shares where id = (s2 ->> 'id')::uuid) <> (select substr(pin_hash, 1, 29) from public.record_shares where id = (s3 ->> 'id')::uuid))::text);
  perform pg_temp.ck('the patient can list their shares but the list has no PIN or hash', 'true',
    (pg_temp.q_as(v_p, 'select count(*)::text from public.record_shares') = '4'
     and pg_temp.q_as(v_p, 'select pin_hash from public.record_shares limit 1') like 'ERR:%permission denied%')::text);
  perform pg_temp.ck('a patient cannot insert a share row directly', 'true',
    (pg_temp.q_as(v_p, format($q$insert into public.record_shares (organisation_id, patient_id, token, sections, expires_at) values (%L, %L, repeat('a', 40), array['vitals'], now() + interval '1 day')$q$, pg_temp.f('org'), v_p)) like 'ERR:permission denied%')::text);
  perform pg_temp.ck('a patient cannot unlock a locked share by writing the row', 'true',
    (pg_temp.q_as(v_p, format('update public.record_shares set locked_at = null, pin_misses = 0 where id = %L', s2 ->> 'id')) like 'ERR:permission denied%')::text);
  perform pg_temp.setf('share_pin', (s2 ->> 'id')::uuid);
  create temp table if not exists toks(k text primary key, t text, pin text) on commit drop;
  grant all on toks to public;
  insert into toks values ('plain', s ->> 'token', null), ('pin', s2 ->> 'token', s2 ->> 'pin'), ('pin_b', s3 ->> 'token', s3 ->> 'pin');
end $$;

-- 3. Opening: PIN, lockout, rate limit, uniform null ----------------------------------------------------------------------------------
do $$
declare t_plain text := (select t from toks where k = 'plain'); t_pin text := (select t from toks where k = 'pin'); pin_ok text := (select pin from toks where k = 'pin');
        t_b text := (select t from toks where k = 'pin_b'); pin_b text := (select pin from toks where k = 'pin_b');
        r jsonb; wrong text; i integer; v_p uuid := pg_temp.f('p'); s jsonb; s2 jsonb; s3 jsonb; t_lock text; pin_lock text; t_rate text; pin_rate text;
begin
  wrong := case when pin_ok = '000000' then '111111' else '000000' end;
  r := pg_temp.open(t_plain, null, 'c1');
  perform pg_temp.ck('a share with no PIN opens', 'ok', r ->> 'status');
  perform pg_temp.ck('...and shows the sharer and the sections', 'true', coalesce((r ->> 'full_name' is not null and r -> 'emergency_info' is not null)::text, 'DEBUG ' || r::text));
  r := pg_temp.open(t_pin, null, 'c1');
  perform pg_temp.ck('a PIN share asks for the PIN and shows no record', 'pin_required|true', (r ->> 'status') || '|' || (r ->> 'full_name' is null)::text);
  r := pg_temp.open(t_pin, wrong, 'c1');
  perform pg_temp.ck('a wrong PIN is refused with attempts left', 'pin_required|4', (r ->> 'status') || '|' || (r ->> 'attempts_left'));
  perform pg_temp.ck('...and nothing was shown', 'true', (r ->> 'full_name' is null)::text);
  r := pg_temp.open(t_pin, pin_ok, 'c1');
  perform pg_temp.ck('the right PIN opens it', 'ok', r ->> 'status');
  perform pg_temp.ck('...and resets the miss counter', '0', (select pin_misses::text from public.record_shares where id = pg_temp.f('share_pin')));
  perform pg_temp.ck('a non-numeric PIN is a miss, never an error', 'pin_required', pg_temp.open(t_pin, 'abcd; drop', 'c9') ->> 'status');

  -- uniform null for everything dead
  perform pg_temp.ck('an unknown token returns null', 'true', (pg_temp.q_anon(format('select public.record_share_by_token(%L, %L, %L)::text', repeat('ab', 32), '123456', 'c1')) is null)::text);
  perform pg_temp.ck('a short token returns null', 'true', (pg_temp.q_anon(format('select public.record_share_by_token(%L)::text', 'abc')) is null)::text);

  -- lockout after 5 misses (distinct clients so the per-client limit does not interfere)
  s := pg_temp.mk_share(v_p, true); t_lock := s ->> 'token'; pin_lock := s ->> 'pin';
  wrong := case when pin_lock = '000000' then '111111' else '000000' end;
  for i in 1..4 loop
    r := pg_temp.open(t_lock, wrong, 'lock-client-' || i);
  end loop;
  perform pg_temp.ck('after 4 misses the share is still open to the right PIN', '1', (r ->> 'attempts_left'));
  r := pg_temp.open(t_lock, wrong, 'lock-client-5');
  perform pg_temp.ck('the 5th miss locks it (answer is the same null as a dead link)', 'true', (r is null or r::text = 'null')::text);
  perform pg_temp.ck('...and it is marked locked', 'true', (select (locked_at is not null)::text from public.record_shares where token = t_lock));
  r := pg_temp.open(t_lock, pin_lock, 'lock-client-6');
  perform pg_temp.ck('...and now even the RIGHT PIN is refused', 'true', (r is null or r::text = 'null')::text);
  perform pg_temp.ck('the lockout is audited: 5 wrong PINs and 1 lock', '5|1',
    (select count(*) filter (where outcome = 'pin_wrong')::text || '|' || count(*) filter (where outcome = 'locked')::text from public.record_share_lookups where share_id = (select id from public.record_shares where token = t_lock)));
  perform pg_temp.ck('...and the patient sees those rows (outcome only)', '6',
    pg_temp.q_as(v_p, format('select count(*)::text from public.record_share_lookups where share_id = (select id from public.record_shares where token = %L) and outcome in (''pin_wrong'',''locked'')', t_lock)));

  -- per-client limit: 3 wrong from one client; the 4th is blocked even with the right PIN; another client still gets in
  wrong := case when pin_b = '000000' then '111111' else '000000' end;
  for i in 1..3 loop r := pg_temp.open(t_b, wrong, 'same-client'); end loop;
  r := pg_temp.open(t_b, pin_b, 'same-client');
  perform pg_temp.ck('a client with 3 recent misses is told to try later, even with the right PIN', 'try_later', r ->> 'status');
  r := pg_temp.open(t_b, pin_b, 'another-client');
  perform pg_temp.ck('a different client with the right PIN opens it (the gate opens, not only closes)', 'ok', r ->> 'status');
end $$;

-- 4. Revoke, expiry, one-session -----------------------------------------------------------------------------------------------------
do $$
declare v_p uuid := pg_temp.f('p'); v_q uuid := pg_temp.f('q'); s jsonb; r jsonb; t text; v_id uuid;
begin
  s := pg_temp.mk_share(v_p, false); t := s ->> 'token'; v_id := (s ->> 'id')::uuid;
  perform pg_temp.ck('a live share opens', 'ok', pg_temp.open(t, null, 'r1') ->> 'status');
  perform pg_temp.ck('another patient cannot revoke it', 'true', (pg_temp.q_as(v_q, format('select public.revoke_record_share(%L)::text', v_id)) like 'ERR:%')::text);
  perform pg_temp.ck('still opens after that attempt', 'ok', pg_temp.open(t, null, 'r1') ->> 'status');
  perform pg_temp.q_as(v_p, format('select public.revoke_record_share(%L)::text', v_id));
  r := pg_temp.open(t, null, 'r1');
  perform pg_temp.ck('a revoked share fails', 'true', (r is null or r::text = 'null')::text);
  perform pg_temp.ck('revoking twice is refused', 'true', (pg_temp.q_as(v_p, format('select public.revoke_record_share(%L)::text', v_id)) like 'ERR:%')::text);

  s := pg_temp.mk_share(v_p, false); t := s ->> 'token'; v_id := (s ->> 'id')::uuid;
  update public.record_shares set expires_at = now() - interval '1 minute' where record_shares.id = v_id;
  r := pg_temp.open(t, null, 'e1');
  perform pg_temp.ck('an expired share fails', 'true', (r is null or r::text = 'null')::text);

  s := pg_temp.mk_share(v_p, true); t := s ->> 'token'; v_id := (s ->> 'id')::uuid;
  update public.record_shares set expires_at = now() - interval '1 minute' where record_shares.id = v_id;
  r := pg_temp.open(t, s ->> 'pin', 'e2');
  perform pg_temp.ck('an expired PIN share fails even with the right PIN', 'true', (r is null or r::text = 'null')::text);

  s := pg_temp.mk_share(v_p, false, true); t := s ->> 'token'; v_id := (s ->> 'id')::uuid;
  r := pg_temp.open(t, null, 'o1');
  perform pg_temp.ck('a one-session share opens and says when the session ends', 'ok|true', (r ->> 'status') || '|' || (r ->> 'session_ends_at' is not null)::text);
  perform pg_temp.ck('...and opens again inside the window', 'ok', pg_temp.open(t, null, 'o2') ->> 'status');
  update public.record_shares set first_opened_at = now() - interval '31 minutes' where record_shares.id = v_id;
  r := pg_temp.open(t, null, 'o3');
  perform pg_temp.ck('...but not after the window has closed', 'true', (r is null or r::text = 'null')::text);
  perform pg_temp.ck('a share that is not one-session has no such window', 'ok',
    (select pg_temp.open((pg_temp.mk_share(v_p, false) ->> 'token'), null, 'n1') ->> 'status'));
end $$;

-- 5. The access log -------------------------------------------------------------------------------------------------------------------
do $$
declare v_p uuid := pg_temp.f('p'); v_q uuid := pg_temp.f('q'); v_g uuid := pg_temp.f('g'); v_org uuid := pg_temp.f('org'); v_card uuid; v_log text; v_j jsonb;
        v_prev timestamptz; v_ok boolean := true; e jsonb;
begin
  insert into public.emergency_cards (patient_id, organisation_id, token, is_active, consented_at, expires_at)
  values (v_p, v_org, repeat('c', 64), true, now(), now() + interval '30 days') returning id into v_card;
  insert into public.emergency_card_lookups (card_id) values (v_card);
  insert into public.profile_access (profile_id, grantee_user_id, granted_by) values (v_p, v_g, v_p);
  insert into public.emergency_access_grants (profile_id, grantee_user_id, reason) values (v_p, v_g, 'SECRET-REASON-chest-pain');
  insert into public.emergency_record_access_grants (requester_id, requester_org_id, patient_id, patient_org_id, reason, expires_at)
  values (pg_temp.f('senior'), v_org, v_p, v_org, 'SECRET-REASON-collapse', now() + interval '8 hours');
  insert into public.care_access_events (organisation_id, patient_id, actor_profile_id, kind, scope) values (v_org, v_p, v_g, 'record_viewed', 'health_summary');
  insert into public.staff_record_opens (expires_at, staff_id, patient_id, organisation_id, basis) values (now() + interval '8 hours', pg_temp.f('senior'), v_p, v_org, 'open');

  -- one transaction means one now(): spread the lookups in time so ordering and the cursor are really exercised
  with ranked as (select l.id, row_number() over (order by l.id) as n from public.record_share_lookups l)
  update public.record_share_lookups l set looked_up_at = now() - (ranked.n * interval '1 minute') from ranked where ranked.id = l.id;
  update public.emergency_card_lookups set looked_up_at = now() - interval '90 minutes';
  v_log := pg_temp.q_as(v_p, 'select public.my_access_log()::text');
  v_j := v_log::jsonb;
  perform pg_temp.ck('the log has share, PIN, card, emergency, break-glass and delegated entries', 'true',
    (v_j @> '[{"kind":"share_opened"}]'::jsonb and v_j @> '[{"kind":"share_pin_wrong"}]'::jsonb and v_j @> '[{"kind":"share_locked"}]'::jsonb
     and v_j @> '[{"kind":"emergency_card_opened"}]'::jsonb and v_j @> '[{"kind":"emergency_access_grant"}]'::jsonb
     and v_j @> '[{"kind":"emergency_record_access"}]'::jsonb and v_j @> '[{"kind":"delegated_access"}]'::jsonb)::text);
  for e in select * from jsonb_array_elements(v_j) loop
    if v_prev is not null and (e ->> 'at')::timestamptz > v_prev then v_ok := false; end if;
    v_prev := (e ->> 'at')::timestamptz;
  end loop;
  perform pg_temp.ck('newest first', 'true', v_ok::text);
  perform pg_temp.ck('routine staff openings are NOT shown by default (OQ-281, founder direction)', 'false', (v_j @> '[{"kind":"staff_record_opened"}]'::jsonb)::text);
  perform pg_temp.ck('no reason text, allergen, condition, phone or blood group in the log', 'false',
    (v_log ilike '%SECRET-REASON%' or v_log ilike '%penicillin%' or v_log ilike '%hypertension%' or v_log ilike '%2348012345678%' or strpos(v_log, 'O+') > 0)::text);
  perform pg_temp.ck('reproductive_health appears nowhere in the log', 'false', (v_log ilike '%reproductive%')::text);
  perform pg_temp.ck('another patient sees none of it', '[]', pg_temp.q_as(v_q, 'select public.my_access_log()::text'));
  perform pg_temp.ck('a page of one returns one', '1', jsonb_array_length(pg_temp.q_as(v_p, 'select public.my_access_log(1)::text')::jsonb)::text);
  perform pg_temp.ck('a cursor returns only older entries', 'true',
    (((select count(*) from jsonb_array_elements(pg_temp.q_as(v_p, format('select public.my_access_log(100, %L)::text', (v_j -> 0 ->> 'at')))::jsonb))
      = (select count(*) from jsonb_array_elements(v_j) x where (x ->> 'at')::timestamptz < (v_j -> 0 ->> 'at')::timestamptz)
      and (select count(*) from jsonb_array_elements(v_j) x where (x ->> 'at')::timestamptz < (v_j -> 0 ->> 'at')::timestamptz) > 0))::text);
  -- the gate opens: flip the staff-opens flag
  update public.my_health_config set config = jsonb_set(config, '{access_log,show_staff_opens}', 'true') where is_active;
  v_j := pg_temp.q_as(v_p, 'select public.my_access_log()::text')::jsonb;
  perform pg_temp.ck('with the flag on, staff openings appear (who, when, no content)', 'true',
    (v_j @> '[{"kind":"staff_record_opened"}]'::jsonb)::text);
  update public.my_health_config set config = jsonb_set(config, '{access_log,show_staff_opens}', 'false') where is_active;
end $$;

-- 6. Lock-screen presence -------------------------------------------------------------------------------------------------------------
do $$
declare v_p uuid := pg_temp.f('p'); v_q uuid := pg_temp.f('q'); v_j jsonb; v_txt text; v_keys text[]; v_id uuid;
begin
  v_txt := pg_temp.q_as(v_p, 'select public.my_lock_screen_facts()::text');
  perform pg_temp.ck('the pass is OFF by default and reveals nothing', 'false|false', (v_txt::jsonb ->> 'enabled') || '|' || (v_txt::jsonb ? 'blood_group')::text);
  perform pg_temp.ck('the field list starts unsigned', 'false', (v_txt::jsonb ->> 'fields_signed'));
  perform pg_temp.q_as(v_p, 'select public.set_lock_screen_pass(true)::text');
  v_txt := pg_temp.q_as(v_p, 'select public.my_lock_screen_facts()::text');
  v_j := v_txt::jsonb;
  perform pg_temp.ck('turned on, it carries initials, blood group, genotype, provenance, allergies-on-file and the contact phone', 'SP|O+|AA|patient_attested|true|+2348012345678',
    coalesce((v_j ->> 'initials') || '|' || (v_j ->> 'blood_group') || '|' || (v_j ->> 'genotype') || '|' || (v_j ->> 'genotype_provenance') || '|' || (v_j ->> 'allergies_on_file') || '|' || (v_j ->> 'emergency_contact_phone'), 'DEBUG ' || v_txt));
  perform pg_temp.ck('NO allergen, condition or medicine name appears anywhere in the payload', 'false',
    (v_txt ilike '%penicillin%' or v_txt ilike '%hypertension%' or v_txt ilike '%rash%' or v_txt ilike '%S09x%')::text);
  select array_agg(k order by k) into v_keys from jsonb_object_keys(v_j) k;
  perform pg_temp.ck('only the approved keys are present', 'true',
    (v_keys <@ array['enabled','fields_signed','fields','initials','blood_group','genotype','genotype_provenance','allergies_on_file','emergency_contact_phone'])::text);
  perform pg_temp.ck('another patient is unaffected (still off)', 'false', (pg_temp.q_as(v_q, 'select public.my_lock_screen_facts()::text')::jsonb ->> 'enabled'));
  perform pg_temp.ck('a patient cannot write the setting table directly', 'true',
    (pg_temp.q_as(v_p, format('update public.patient_lock_screen_pass set enabled = true where profile_id = %L', v_q)) like 'ERR:permission denied%')::text);
  perform pg_temp.ck('a patient cannot read someone else''s setting', '0', pg_temp.q_as(v_q, format('select count(*)::text from public.patient_lock_screen_pass where profile_id = %L', v_p)));
  perform pg_temp.q_as(v_p, 'select public.set_lock_screen_pass(false)::text');
  perform pg_temp.ck('turning it off hides everything again', 'false|false', (pg_temp.q_as(v_p, 'select public.my_lock_screen_facts()::text')::jsonb ->> 'enabled') || '|' || (pg_temp.q_as(v_p, 'select public.my_lock_screen_facts()::text')::jsonb ? 'blood_group')::text);
  perform pg_temp.ck('a null setting is refused', 'true', (pg_temp.q_as(v_p, 'select public.set_lock_screen_pass(null)::text') like 'ERR:%')::text);

  -- CMO signs the field list
  select id into v_id from public.my_health_config where is_active;
  perform pg_temp.ck('a senior clinician cannot sign the field list', 'true', (pg_temp.q_as(pg_temp.f('senior'), format('select public.sign_my_health_config(%L)::text', v_id)) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('a patient cannot sign it', 'true', (pg_temp.q_as(v_p, format('select public.sign_my_health_config(%L)::text', v_id)) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('the CMO signs it', 'true', (pg_temp.q_as(pg_temp.f('cmo'), format('select public.sign_my_health_config(%L)::text', v_id)) ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.q_as(v_p, 'select public.set_lock_screen_pass(true)::text');
  perform pg_temp.ck('...and the facts then say the field list is signed', 'true', (pg_temp.q_as(v_p, 'select public.my_lock_screen_facts()::text')::jsonb ->> 'fields_signed'));
  perform pg_temp.ck('...but the wallet guard is still off', 'false', (select is_on::text from public.go_live_guards where key = 'wallet_pass'));
  -- an older draft can never be signed over a newer signed version
  insert into public.my_health_config (version, is_active, config, notes) values (2, false, (select config from public.my_health_config where is_active), 'older draft');
  insert into public.my_health_config (version, is_active, config, notes) values (3, false, (select config from public.my_health_config where is_active), 'newer draft');
  perform pg_temp.q_as(pg_temp.f('cmo'), format('select public.sign_my_health_config(%L)::text', (select id from public.my_health_config where version = 3)));
  perform pg_temp.ck('signing an older draft after a newer one is signed is refused', 'true',
    (pg_temp.q_as(pg_temp.f('cmo'), format('select public.sign_my_health_config(%L)::text', (select id from public.my_health_config where version = 2))) like 'ERR:%')::text);
end $$;

-- 7. SABOTAGE: each protection broken once; the check must flip -----------------------------------------------------------------------
do $$
declare v_def text; r jsonb; s jsonb; t text; pin text; wrong text; i integer; v_p uuid := pg_temp.f('p'); v_locked text; v_txt text;
begin
  -- (1) lockout removed: a share must then stay open after 5 misses
  v_def := pg_get_functiondef('public.record_share_by_token(text, text, text)'::regprocedure);
  v_def := replace(v_def, 'if v_misses >= v_max then', 'if false then');
  execute v_def;
  s := pg_temp.mk_share(v_p, true); t := s ->> 'token'; pin := s ->> 'pin';
  wrong := case when pin = '000000' then '111111' else '000000' end;
  for i in 1..6 loop r := pg_temp.open(t, wrong, 'sab-' || i); end loop;
  r := pg_temp.open(t, pin, 'sab-ok');
  insert into results values ('sabotaged', 'SABOTAGE: with the lockout removed a locked-out share still opens', 'null', coalesce(r ->> 'status', 'null'));
  -- (2) PIN check removed: a wrong PIN must then open the record
  v_def := replace(v_def, 'if p_pin !~ ''^[0-9]{4,12}$'' or extensions.crypt(p_pin, v_share.pin_hash) is distinct from v_share.pin_hash then', 'if false then');
  execute v_def;
  s := pg_temp.mk_share(v_p, true); t := s ->> 'token'; pin := s ->> 'pin';
  r := pg_temp.open(t, case when pin = '000000' then '111111' else '000000' end, 'sab-w');
  insert into results values ('sabotaged', 'SABOTAGE: with the PIN check removed a wrong PIN opens the record', 'pin_required', coalesce(r ->> 'status', 'null'));
  -- (3) minimiser broken: allergies named in the payload
  v_def := pg_get_functiondef('public.my_lock_screen_facts()'::regprocedure);
  v_def := replace(v_def, $s$'allergies_on_file', case when exists (select 1 from public.patient_allergies a where a.patient_id = v_uid) then true else null end,$s$,
                          $s$'allergies_on_file', (select string_agg(a.allergen, ',') from public.patient_allergies a where a.patient_id = v_uid),$s$);
  execute v_def;
  perform pg_temp.q_as(v_p, 'select public.set_lock_screen_pass(true)::text');
  v_txt := pg_temp.q_as(v_p, 'select public.my_lock_screen_facts()::text');
  insert into results values ('sabotaged', 'SABOTAGE: a leaky payload names the allergen', 'false', (v_txt ilike '%penicillin%')::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S09x proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
