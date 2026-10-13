-- ===========================================================================
-- Proof: 20261013*_s03b_account_recovery_routes.sql (v5 S03b-b; answers OQ-43; INV-07, INV-08, INV-10).
--
-- Proves, against the real migrated schema, with simulated sessions per caller and the service role:
--   1. Backup codes: ten codes in the agreed shape, stored only as a hash, never readable by an application role; a patient
--      only; at most the configured number of sets a day; regenerating kills the old set; redeeming is service-role only,
--      single use, answers the same {ok:false} for every failure, locks one account after too many wrong tries (and leaves
--      another account alone), accepts an email or a phone identifier, never identifies an account by an UNVERIFIED channel;
--      a spent code can be given back; completing a recovery ends every session of that account and only that account.
--   2. Recovery contact: only a live Care Circle member can be named; the contact must agree; a stranger cannot answer or
--      confirm for someone else; asking is silent about whether anything exists; confirming starts a wait the contact cannot
--      shorten; the link is claimed once, only after the wait, and returns no address; a contact who leaves the circle (or
--      is removed) ends the request; either side can revoke; rows are readable only by the two people they name.
--   3. Change-number gate: an account with a confirmed phone or email cannot start a number change (a direct Auth update, not
--      just an app action) without a fresh single-use authorisation; an account with nothing to confirm with is not blocked;
--      the owner is told when the number moves; recovery by text code is held for 72 hours after a change, unless the contact
--      route released the account.
--   4. Every step audited (no secret in the event); owner notified in-app and by email, never SMS; anon has no access anywhere.
--   4b. A password step-up (recorded only by the server) is needed, once, to make backup codes or name a recovery contact; a
--      session alone, a step-up for the other purpose, an expired one, a spent one and one earned by a DIFFERENT session of the same
--      account (bound to the session_id claim) are all refused.
--   4c. Security notices are 'routine', never 'critical' (the escalation engine re-sends a critical, unopened notice by SMS).
--   4d. The pause reads WHEN THE NUMBER ACTUALLY MOVED (recorded by a trigger), not phone_confirmed_at, which GoTrue re-stamps on
--      every successful SMS code: a re-stamp alone starts no pause. A failure to queue the number-changed notice never blocks a change.
--   5. SABOTAGE x7, each proving its check can fail: grant read on the codes table, grant EXECUTE on redeem to authenticated,
--      drop the minimum-wait CHECK, neuter the change-number gate, grant EXECUTE to PUBLIC, a 'critical' notice, and the old
--      phone_confirmed_at pause signal.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

create function pg_temp.call_as(p_uid uuid, p_sql text, p_session text default 'sess-0001-aaaa') returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_session)::text, true);
  execute 'set local role authenticated';
  execute p_sql into j;
  execute 'reset role';
  return j;
exception when others then
  execute 'reset role';
  raise;
end $$;

create function pg_temp.svc_bool(p_sql text) returns boolean language plpgsql as $$
declare b boolean;
begin
  execute 'set local role service_role';
  execute p_sql into b;
  execute 'reset role';
  return b;
exception when others then
  execute 'reset role';
  raise;
end $$;

create function pg_temp.call_svc(p_sql text) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  execute 'set local role service_role';
  execute p_sql into j;
  execute 'reset role';
  return j;
exception when others then
  execute 'reset role';
  raise;
end $$;

-- true when the statement is refused (any error), false when it ran
create function pg_temp.refused(p_role text, p_uid uuid, p_sql text) returns boolean language plpgsql as $$
declare j jsonb;
begin
  if p_uid is not null then perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true); end if;
  execute format('set local role %s', p_role);
  begin
    execute p_sql;
  exception when others then
    execute 'reset role';
    return true;
  end;
  execute 'reset role';
  return false;
end $$;

-- the server's step-up (service role), then the signed-in call
create function pg_temp.step_up(p_uid uuid, p_purpose text, p_session text default 'sess-0001-aaaa') returns boolean language plpgsql as $$
begin
  return (pg_temp.call_svc(format('select to_jsonb(public.record_step_up(%L, %L, %L))', p_uid, p_purpose, p_session)))::text::boolean;
end $$;
create function pg_temp.gen_codes(p_uid uuid) returns jsonb language plpgsql as $$
begin
  perform pg_temp.step_up(p_uid, 'backup_codes');
  return pg_temp.call_as(p_uid, 'select to_jsonb(public.generate_backup_codes())');
end $$;
create function pg_temp.propose(p_uid uuid, p_member uuid) returns jsonb language plpgsql as $$
begin
  perform pg_temp.step_up(p_uid, 'recovery_contact');
  return pg_temp.call_as(p_uid, format('select public.propose_recovery_contact(%L)', p_member));
end $$;

do $$
declare
  v_org uuid;
  p1 uuid := gen_random_uuid();      -- patient: confirmed email AND confirmed phone, 30 days old
  p2 uuid := gen_random_uuid();      -- supporter / recovery contact
  p3 uuid := gen_random_uuid();      -- stranger patient
  p4 uuid := gen_random_uuid();      -- phone-only patient
  p5 uuid := gen_random_uuid();      -- number moved a moment ago (by update, so the trigger records it)
  p6 uuid := gen_random_uuid();      -- phone typed but NOT verified
  p7 uuid := gen_random_uuid();      -- brand-new account, nothing confirmed
  clin uuid := gen_random_uuid();
  m1 uuid; m4 uuid;
  codes jsonb; codes2 jsonb; c1 text; c2 text; r jsonb; rid uuid; cid uuid; cid4 uuid; n integer; v_txt text; v_ts timestamptz;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, phone, phone_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data) values
    (p1, 's03b-p1@example.invalid', 'x', now(), '2348044440001', now() - interval '20 days', now() - interval '30 days', '{}', '{}'),
    (p2, 's03b-p2@example.invalid', 'x', now(), null, null, now() - interval '30 days', '{}', '{}'),
    (p3, 's03b-p3@example.invalid', 'x', now(), null, null, now() - interval '30 days', '{}', '{}'),
    (p4, null, 'x', null, '2348044440004', now() - interval '20 days', now() - interval '30 days', '{}', '{}'),
    (p5, 's03b-p5@example.invalid', 'x', now(), '2348044440005', now() - interval '30 days', now() - interval '30 days', '{}', '{}'),
    (p6, 's03b-p6@example.invalid', 'x', null, '2348044440006', null, now() - interval '30 days', '{}', '{}'),
    (p7, null, 'x', null, null, null, now(), '{}', '{}'),
    (clin, 's03b-clin@example.invalid', 'x', now(), null, null, now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (p1, v_org, 'patient', 'S03B Patient One', '+2348044440001'),
    (p2, v_org, 'patient', 'S03B Supporter', null),
    (p3, v_org, 'patient', 'S03B Stranger', null),
    (p4, v_org, 'patient', 'S03B Phone Only', '+2348044440004'),
    (p5, v_org, 'patient', 'S03B Recent Swap', '+2348044440005'),
    (p6, v_org, 'patient', 'S03B Unverified', '+2348044440006'),
    (p7, v_org, 'patient', 'S03B Brand New', null),
    (clin, v_org, 'clinician', 'S03B Clinician', null)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name, phone = excluded.phone;

  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at)
  values (v_org, p1, p2, 'Sister', array['adherence_summary'], now() + interval '300 days') returning id into m1;
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at)
  values (v_org, p4, p2, 'Sister', array['adherence_summary'], now() + interval '300 days') returning id into m4;

  -- p5's number moves now (a plain update: the trigger records WHEN it moved, which is what the pause reads)
  update auth.users set phone = '2348044440099' where id = p5;

  -- ===== 1. BACKUP CODES
  -- 1-pre. the password step-up: a session alone cannot make codes
  v_txt := null;
  begin perform pg_temp.call_as(p1, 'select to_jsonb(public.generate_backup_codes())'); exception when others then v_txt := sqlerrm; end;
  if v_txt is distinct from 'step_up_required' then raise exception 'FAIL 1-pre a: codes were made with no step-up (%)', v_txt; end if;
  perform pg_temp.step_up(p1, 'recovery_contact');       -- the OTHER purpose does not unlock codes
  v_txt := null;
  begin perform pg_temp.call_as(p1, 'select to_jsonb(public.generate_backup_codes())'); exception when others then v_txt := sqlerrm; end;
  if v_txt is distinct from 'step_up_required' then raise exception 'FAIL 1-pre b: a recovery_contact step-up unlocked codes (%)', v_txt; end if;
  perform pg_temp.step_up(p1, 'backup_codes');
  update public.account_step_ups set expires_at = now() - interval '1 minute' where user_id = p1;   -- expired
  v_txt := null;
  begin perform pg_temp.call_as(p1, 'select to_jsonb(public.generate_backup_codes())'); exception when others then v_txt := sqlerrm; end;
  if v_txt is distinct from 'step_up_required' then raise exception 'FAIL 1-pre c: an expired step-up was accepted (%)', v_txt; end if;
  if not pg_temp.refused('authenticated', p1, format('select public.record_step_up(%L, %L, %L)', p1, 'backup_codes', 'sess-0001-aaaa')) then raise exception 'FAIL 1-pre d: a session can record its own step-up'; end if;
  if not pg_temp.refused('anon', null, format('select public.record_step_up(%L, %L, %L)', p1, 'backup_codes', 'sess-0001-aaaa')) then raise exception 'FAIL 1-pre d: anon can record a step-up'; end if;
  if pg_temp.step_up(clin, 'backup_codes') then raise exception 'FAIL 1-pre e: a step-up was recorded for a non-patient'; end if;
  if pg_temp.step_up(p1, 'backup_codes', 'short') or pg_temp.step_up(p1, 'backup_codes', null) then raise exception 'FAIL 1-pre e: a step-up was recorded with no usable session'; end if;
  -- bound to the session that earned it: a second access token for the same account cannot spend it, and the failed try spends nothing
  perform pg_temp.step_up(p1, 'backup_codes', 'sess-0001-aaaa');
  v_txt := null;
  begin perform pg_temp.call_as(p1, 'select to_jsonb(public.generate_backup_codes())', 'sess-0002-bbbb'); exception when others then v_txt := sqlerrm; end;
  if v_txt is distinct from 'step_up_required' then raise exception 'FAIL 1-pre e2: another session spent the step-up (%)', v_txt; end if;
  if not exists (select 1 from public.account_step_ups where user_id = p1 and purpose = 'backup_codes' and consumed_at is null and session_id = 'sess-0001-aaaa') then
    raise exception 'FAIL 1-pre e2: a refused try spent the step-up'; end if;
  delete from public.account_step_ups where user_id = p1;

  codes := pg_temp.gen_codes(p1);
  -- a step-up is spent by use
  v_txt := null;
  begin perform pg_temp.call_as(p1, 'select to_jsonb(public.generate_backup_codes())'); exception when others then v_txt := sqlerrm; end;
  if v_txt is distinct from 'step_up_required' then raise exception 'FAIL 1-pre f: one step-up made two sets (%)', v_txt; end if;
  -- spent rows are not kept: recording the next one removes them
  perform pg_temp.step_up(p1, 'backup_codes');
  if exists (select 1 from public.account_step_ups where user_id = p1 and consumed_at is not null) then raise exception 'FAIL 1-pre g: a spent step-up was kept'; end if;
  delete from public.account_step_ups where user_id = p1;
  if jsonb_array_length(codes) <> 10 then raise exception 'FAIL 1a: expected 10 codes, got %', jsonb_array_length(codes); end if;
  if exists (select 1 from jsonb_array_elements_text(codes) c where c !~ '^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$') then
    raise exception 'FAIL 1a: a code is not in the XXXXX-XXXXX shape: %', codes; end if;
  if (select count(distinct c) from jsonb_array_elements_text(codes) c) <> 10 then raise exception 'FAIL 1a: codes are not distinct'; end if;
  select count(*) into n from public.account_backup_codes where user_id = p1;
  if n <> 10 then raise exception 'FAIL 1b: % rows stored', n; end if;
  if exists (select 1 from public.account_backup_codes b, jsonb_array_elements_text(codes) c
              where b.user_id = p1 and (b.code_hash = c or b.code_hash = replace(c, '-', ''))) then
    raise exception 'FAIL 1b: a code is stored in the clear'; end if;
  if not pg_temp.refused('authenticated', p1, 'select * from public.account_backup_codes') then raise exception 'FAIL 1c: a patient can read the codes table'; end if;
  if not pg_temp.refused('anon', null, 'select * from public.account_backup_codes') then raise exception 'FAIL 1c: anon can read the codes table'; end if;
  if not pg_temp.refused('anon', null, 'select public.generate_backup_codes()') then raise exception 'FAIL 1c: anon can generate codes'; end if;
  if not pg_temp.refused('authenticated', clin, 'select public.generate_backup_codes()') then raise exception 'FAIL 1d: a clinician account was given backup codes'; end if;
  r := pg_temp.call_as(p1, 'select public.my_backup_code_status()');
  if (r ->> 'remaining')::int <> 10 or (r ->> 'total')::int <> 10 then raise exception 'FAIL 1e: status wrong %', r; end if;

  c1 := codes ->> 0;
  -- redeeming is service role only
  if not pg_temp.refused('authenticated', p1, format('select public.redeem_backup_code(%L, %L, %L)', 'email', 's03b-p1@example.invalid', c1)) then
    raise exception 'FAIL 1f: a signed-in session can redeem a backup code'; end if;
  if not pg_temp.refused('anon', null, format('select public.redeem_backup_code(%L, %L, %L)', 'email', 's03b-p1@example.invalid', c1)) then
    raise exception 'FAIL 1f: anon can redeem a backup code'; end if;

  -- every failure looks the same
  for r in select pg_temp.call_svc(format('select public.redeem_backup_code(%L, %L, %L)', k, i, c)) from (values
      ('email', 'nobody@example.invalid', c1),                   -- unknown identifier
      ('email', 's03b-p1@example.invalid', 'AAAAA-AAAAA'),       -- wrong code
      ('email', 's03b-p3@example.invalid', c1),                  -- someone else's address with this code
      ('email', 's03b-clin@example.invalid', c1),                -- not a patient
      ('phone', '+2348044440006', c1),                           -- unverified phone identifies nobody
      ('email', 's03b-p6@example.invalid', c1),                  -- unverified email identifies nobody
      ('email', 'not an address', c1)) as t(k, i, c) loop
    if r is distinct from jsonb_build_object('ok', false) then raise exception 'FAIL 1g: a failure is distinguishable: %', r; end if;
  end loop;

  -- the right code works once, by email and by phone, and shrinks the set
  r := pg_temp.call_svc(format('select public.redeem_backup_code(%L, %L, %L)', 'email', 'S03B-P1@example.invalid', lower(c1)));
  if not (r ->> 'ok')::boolean or (r ->> 'user_id')::uuid <> p1 or (r ->> 'remaining')::int <> 9 then raise exception 'FAIL 1h: right code refused or wrong shape %', r; end if;
  r := pg_temp.call_svc(format('select public.redeem_backup_code(%L, %L, %L)', 'email', 's03b-p1@example.invalid', c1));
  if (r ->> 'ok')::boolean then raise exception 'FAIL 1i: a code worked twice'; end if;
  r := pg_temp.call_svc(format('select public.redeem_backup_code(%L, %L, %L)', 'phone', '0804 444 0001', codes ->> 1));
  if not (r ->> 'ok')::boolean or (r ->> 'remaining')::int <> 8 then raise exception 'FAIL 1j: phone identifier refused %', r; end if;
  -- give a spent code back (password change failed)
  if not (pg_temp.call_svc(format('select to_jsonb(public.release_backup_code(%L, %L))', p1, codes ->> 1)))::text::boolean then raise exception 'FAIL 1k: code not released'; end if;
  r := pg_temp.call_svc(format('select public.redeem_backup_code(%L, %L, %L)', 'phone', '+2348044440001', codes ->> 1));
  if not (r ->> 'ok')::boolean then raise exception 'FAIL 1k: a released code did not work again'; end if;

  -- completing a recovery ends this account's sessions and only this account's
  insert into auth.sessions (id, user_id) values (gen_random_uuid(), p1), (gen_random_uuid(), p1), (gen_random_uuid(), p3);
  r := pg_temp.call_svc(format('select public.complete_backup_code_recovery(%L)', p1));
  if not (r ->> 'ok')::boolean then raise exception 'FAIL 1l: complete refused %', r; end if;
  if exists (select 1 from auth.sessions where user_id = p1) then raise exception 'FAIL 1l: the account kept a session'; end if;
  if not exists (select 1 from auth.sessions where user_id = p3) then raise exception 'FAIL 1l: another account lost its session'; end if;
  if not pg_temp.refused('authenticated', p1, format('select public.complete_backup_code_recovery(%L)', p1)) then raise exception 'FAIL 1l: a session can complete its own recovery'; end if;

  -- the per-account lock: 10 wrong tries in an hour, then even the right code is refused; another account is unaffected
  codes2 := pg_temp.gen_codes(p3);
  for n in 1..10 loop
    perform pg_temp.call_svc(format('select public.redeem_backup_code(%L, %L, %L)', 'email', 's03b-p3@example.invalid', 'WRONG-CODE' || n));
  end loop;
  r := pg_temp.call_svc(format('select public.redeem_backup_code(%L, %L, %L)', 'email', 's03b-p3@example.invalid', codes2 ->> 0));
  if (r ->> 'ok')::boolean then raise exception 'FAIL 1m: a locked account still accepted its code'; end if;
  r := pg_temp.call_svc(format('select public.redeem_backup_code(%L, %L, %L)', 'email', 's03b-p1@example.invalid', codes ->> 2));
  if not (r ->> 'ok')::boolean then raise exception 'FAIL 1m(control): an unrelated account was locked out %', r; end if;
  delete from public.account_backup_code_attempts where user_id = p3;
  r := pg_temp.call_svc(format('select public.redeem_backup_code(%L, %L, %L)', 'email', 's03b-p3@example.invalid', codes2 ->> 0));
  if not (r ->> 'ok')::boolean then raise exception 'FAIL 1m(control): lock did not lift once the attempts aged out %', r; end if;

  -- regenerating kills the old set; the day limit holds (p1 has generated once)
  codes2 := pg_temp.gen_codes(p1);
  r := pg_temp.call_svc(format('select public.redeem_backup_code(%L, %L, %L)', 'email', 's03b-p1@example.invalid', codes ->> 3));
  if (r ->> 'ok')::boolean then raise exception 'FAIL 1n: a code from the old set still works after regenerating'; end if;
  r := pg_temp.call_svc(format('select public.redeem_backup_code(%L, %L, %L)', 'email', 's03b-p1@example.invalid', codes2 ->> 3));
  if not (r ->> 'ok')::boolean then raise exception 'FAIL 1n: a code from the new set was refused %', r; end if;
  perform pg_temp.gen_codes(p1);
  v_txt := null;
  begin perform pg_temp.gen_codes(p1);
  exception when others then v_txt := sqlerrm; end;
  if v_txt is distinct from 'backup_codes_rate_limited' then raise exception 'FAIL 1o: the daily limit did not hold (%)', v_txt; end if;

  -- notices: in-app and email, templates named, never SMS, no code in the text
  if not exists (select 1 from public.notifications where recipient_id = p1 and template = 'security.backup_codes_generated' and channel = 'in_app')
     or not exists (select 1 from public.notifications where recipient_id = p1 and template = 'security.backup_codes_generated' and channel = 'email') then
    raise exception 'FAIL 1p: owner not told in-app and by email when codes were made'; end if;
  if exists (select 1 from public.notifications where recipient_id = p1 and template = 'security.backup_codes_generated' and channel = 'email'
                and (payload ->> 'to_email') is distinct from 's03b-p1@example.invalid') then
    raise exception 'FAIL 1p: the email notice carries no to_email, so the dispatcher would fail it'; end if;
  if exists (select 1 from public.notifications where template like 'security.%' and recipient_id in (p1, p2, p3, p4, p5) and priority = 'critical') then
    raise exception 'FAIL 1p: a security notice is critical, so the escalation engine would re-send it by SMS (INV-08)'; end if;
  if exists (select 1 from public.notifications where recipient_id in (p1, p2, p3, p4, p5) and template like 'security.%' and channel in ('sms', 'push', 'voice')) then
    raise exception 'FAIL 1p: a security notice went out on a non-core channel'; end if;
  if exists (select 1 from public.notifications n, jsonb_array_elements_text(codes2) c where n.recipient_id = p1 and n.payload::text like '%' || c || '%') then
    raise exception 'FAIL 1p: a code appears in a notification'; end if;
  if exists (select 1 from public.audit_log a, jsonb_array_elements_text(codes2) c where a.subject_patient_id = p1 and a.event::text like '%' || c || '%') then
    raise exception 'FAIL 1q: a code appears in the audit log'; end if;
  if not exists (select 1 from public.audit_log where subject_patient_id = p1 and action = 'account.backup_code_used') then raise exception 'FAIL 1q: use not audited'; end if;
  if not exists (select 1 from public.audit_log where subject_patient_id = p3 and action = 'account.backup_code_failed' and result = 'denied') then raise exception 'FAIL 1q: failures not audited'; end if;
  raise notice 'PASS 1 backup codes';

  -- ===== 2. RECOVERY CONTACT
  -- before anyone is named: asking changes nothing and says nothing
  r := pg_temp.call_svc(format('select public.request_contact_recovery(%L, %L)', 'email', 's03b-p1@example.invalid'));
  if r is distinct from jsonb_build_object('ok', false) then raise exception 'FAIL 2a: a request with no contact was not a plain no: %', r; end if;
  -- only a live circle member of THIS patient can be named
  r := pg_temp.propose(p3, m1);
  if (r ->> 'ok')::boolean then raise exception 'FAIL 2b: a stranger named someone else''s circle member'; end if;
  r := pg_temp.propose(p1, gen_random_uuid());
  if (r ->> 'ok')::boolean then raise exception 'FAIL 2b: a made-up member was accepted'; end if;
  if not pg_temp.refused('authenticated', clin, format('select public.propose_recovery_contact(%L)', m1)) then raise exception 'FAIL 2b: a clinician account can name a contact'; end if;
  -- naming a contact also needs the password step-up (earlier attempts left unspent ones behind; clear them)
  delete from public.account_step_ups where user_id = p1;
  v_txt := null;
  begin perform pg_temp.call_as(p1, format('select public.propose_recovery_contact(%L)', m1)); exception when others then v_txt := sqlerrm; end;
  if v_txt is distinct from 'step_up_required' then raise exception 'FAIL 2c-pre: a contact was named with no step-up (%)', v_txt; end if;
  r := pg_temp.propose(p1, m1);
  if not (r ->> 'ok')::boolean then raise exception 'FAIL 2c: could not name a circle member %', r; end if;
  cid := (r ->> 'id')::uuid;
  r := pg_temp.propose(p1, m1);
  if (r ->> 'error') is distinct from 'already_set' then raise exception 'FAIL 2c: a second contact was allowed %', r; end if;
  -- not yet agreed: still a plain no
  r := pg_temp.call_svc(format('select public.request_contact_recovery(%L, %L)', 'email', 's03b-p1@example.invalid'));
  if (r ->> 'ok')::boolean then raise exception 'FAIL 2d: recovery started before the contact agreed'; end if;
  -- a stranger cannot answer for them; the contact can
  r := pg_temp.call_as(p3, format('select public.respond_recovery_contact(%L, true)', cid));
  if (r ->> 'ok')::boolean then raise exception 'FAIL 2e: a stranger answered for the contact'; end if;
  r := pg_temp.call_as(p1, format('select public.respond_recovery_contact(%L, true)', cid));
  if (r ->> 'ok')::boolean then raise exception 'FAIL 2e: the patient agreed on the contact''s behalf'; end if;
  r := pg_temp.call_as(p2, format('select public.respond_recovery_contact(%L, true)', cid));
  if not (r ->> 'ok')::boolean or (r ->> 'state') <> 'accepted' then raise exception 'FAIL 2e: the contact could not agree %', r; end if;
  -- asking now works, silently to the caller, and tells both people
  r := pg_temp.call_svc(format('select public.request_contact_recovery(%L, %L)', 'email', 'S03B-P1@example.invalid'));
  if not (r ->> 'ok')::boolean then raise exception 'FAIL 2f: request refused %', r; end if;
  rid := (r ->> 'request_id')::uuid;
  if r::text like '%@%' or r::text like '%2348044440001%' then raise exception 'FAIL 2f: the answer carries an address or number'; end if;
  if not exists (select 1 from public.notifications where recipient_id = p2 and template = 'security.recovery_contact_request' and channel = 'in_app')
     or not exists (select 1 from public.notifications where recipient_id = p1 and template = 'security.recovery_contact_request_patient' and channel = 'in_app')
     or not exists (select 1 from public.notifications where recipient_id = p1 and template = 'security.recovery_contact_request_patient' and channel = 'email') then
    raise exception 'FAIL 2f: the contact and the patient were not both told'; end if;
  -- a second ask while one is open is a plain no (and the same shape as every other no)
  r := pg_temp.call_svc(format('select public.request_contact_recovery(%L, %L)', 'email', 's03b-p1@example.invalid'));
  if r is distinct from jsonb_build_object('ok', false) then raise exception 'FAIL 2g: duplicate request not a plain no %', r; end if;
  -- cannot claim before the contact confirms
  r := pg_temp.call_svc(format('select public.claim_contact_recovery(%L, %L)', 'email', 's03b-p1@example.invalid'));
  if (r ->> 'ok')::boolean then raise exception 'FAIL 2h: claimed before the contact confirmed'; end if;
  -- the contact lists it, a stranger cannot confirm it
  r := pg_temp.call_as(p2, 'select public.my_recovery_contact_duties()');
  if jsonb_array_length(r -> 'requests') <> 1 then raise exception 'FAIL 2i: the contact does not see the request %', r; end if;
  r := pg_temp.call_as(p3, format('select public.confirm_contact_recovery(%L, true)', rid));
  if (r ->> 'ok')::boolean then raise exception 'FAIL 2i: a stranger confirmed someone else''s recovery'; end if;
  r := pg_temp.call_as(p1, format('select public.confirm_contact_recovery(%L, true)', rid));
  if (r ->> 'ok')::boolean then raise exception 'FAIL 2i: the person recovering confirmed their own recovery'; end if;
  -- confirm starts the wait
  r := pg_temp.call_as(p2, format('select public.confirm_contact_recovery(%L, true)', rid));
  if not (r ->> 'ok')::boolean then raise exception 'FAIL 2j: the contact could not confirm %', r; end if;
  v_ts := (r ->> 'release_at')::timestamptz;
  if v_ts < now() + interval '23 hours 59 minutes' or v_ts > now() + interval '24 hours 1 minute' then raise exception 'FAIL 2j: wait is not 24 hours: %', v_ts; end if;
  r := pg_temp.call_svc(format('select public.claim_contact_recovery(%L, %L)', 'email', 's03b-p1@example.invalid'));
  if (r ->> 'ok')::boolean then raise exception 'FAIL 2k: claimed during the wait'; end if;
  -- the wait cannot be edited down below an hour by data
  v_txt := null;
  begin update public.account_recovery_contact_requests set release_at = confirmed_at where id = rid;
  exception when check_violation then v_txt := 'blocked'; end;
  if v_txt is distinct from 'blocked' then raise exception 'FAIL 2k: release_at can be set to the confirmation time'; end if;
  -- time passes
  update public.account_recovery_contact_requests set confirmed_at = now() - interval '25 hours', release_at = now() - interval '1 hour' where id = rid;
  r := pg_temp.call_svc(format('select public.claim_contact_recovery(%L, %L)', 'email', 's03b-p1@example.invalid'));
  if not (r ->> 'ok')::boolean or (r ->> 'user_id')::uuid <> p1 then raise exception 'FAIL 2l: claim after the wait refused %', r; end if;
  if r::text like '%@%' or r::text ~ '\+?234[0-9]{10}' then raise exception 'FAIL 2l: claim returned an address or number %', r; end if;
  r := pg_temp.call_svc(format('select public.claim_contact_recovery(%L, %L)', 'email', 's03b-p1@example.invalid'));
  if (r ->> 'ok')::boolean then raise exception 'FAIL 2m: a claim was usable twice'; end if;
  if not (pg_temp.call_svc(format('select to_jsonb(public.unrelease_contact_recovery(%L))', rid)))::text::boolean then raise exception 'FAIL 2m: could not reopen after a failed send'; end if;
  r := pg_temp.call_svc(format('select public.claim_contact_recovery(%L, %L)', 'email', 's03b-p1@example.invalid'));
  if not (r ->> 'ok')::boolean then raise exception 'FAIL 2m: reopened request could not be claimed'; end if;
  -- service role only
  if not pg_temp.refused('authenticated', p1, format('select public.claim_contact_recovery(%L, %L)', 'email', 's03b-p1@example.invalid')) then raise exception 'FAIL 2n: a session can claim'; end if;
  if not pg_temp.refused('authenticated', p1, format('select public.request_contact_recovery(%L, %L)', 'email', 's03b-p1@example.invalid')) then raise exception 'FAIL 2n: a session can raise a request'; end if;

  -- a contact who leaves the circle ends a confirmed request
  r := pg_temp.propose(p4, m4);
  cid4 := (r ->> 'id')::uuid;
  perform pg_temp.call_as(p2, format('select public.respond_recovery_contact(%L, true)', cid4));
  r := pg_temp.call_svc(format('select public.request_contact_recovery(%L, %L)', 'phone', '08044440004'));
  if not (r ->> 'ok')::boolean then raise exception 'FAIL 2o: phone identifier refused for a phone-only patient %', r; end if;
  rid := (r ->> 'request_id')::uuid;
  perform pg_temp.call_as(p2, format('select public.confirm_contact_recovery(%L, true)', rid));
  update public.account_recovery_contact_requests set confirmed_at = now() - interval '25 hours', release_at = now() - interval '1 hour' where id = rid;
  update public.care_circle_members set state = 'revoked', revoked_at = now() where id = m4;
  r := pg_temp.call_svc(format('select public.claim_contact_recovery(%L, %L)', 'phone', '+2348044440004'));
  if (r ->> 'ok')::boolean then raise exception 'FAIL 2p: a contact removed from the circle still released an account'; end if;
  select state into v_txt from public.account_recovery_contact_requests where id = rid;
  if v_txt <> 'cancelled' then raise exception 'FAIL 2p: request state is % not cancelled', v_txt; end if;
  -- the patient shows as having lost their contact
  r := pg_temp.call_as(p4, 'select public.my_recovery_contact()');
  if (r ->> 'still_in_circle')::boolean then raise exception 'FAIL 2p: patient is told the contact is still in the circle'; end if;

  -- revoke by either side cancels the open request
  r := pg_temp.call_as(p1, format('select public.revoke_recovery_contact(%L)', cid));
  if not (r ->> 'ok')::boolean then raise exception 'FAIL 2q: patient could not revoke %', r; end if;
  r := pg_temp.call_as(p3, format('select public.revoke_recovery_contact(%L)', cid4));
  if (r ->> 'ok')::boolean then raise exception 'FAIL 2q: a stranger revoked someone else''s contact'; end if;
  r := pg_temp.call_as(p2, format('select public.revoke_recovery_contact(%L)', cid4));
  if not (r ->> 'ok')::boolean then raise exception 'FAIL 2q: the contact could not step down %', r; end if;
  r := pg_temp.call_svc(format('select public.request_contact_recovery(%L, %L)', 'email', 's03b-p1@example.invalid'));
  if (r ->> 'ok')::boolean then raise exception 'FAIL 2q: recovery started after the contact was revoked'; end if;
  -- request limit per week: p1 already has 1 request this week; make two more attempts possible then hit the cap
  r := pg_temp.propose(p1, m1);
  perform pg_temp.call_as(p2, format('select public.respond_recovery_contact(%L, true)', (r ->> 'id')::uuid));
  r := pg_temp.call_svc(format('select public.request_contact_recovery(%L, %L)', 'email', 's03b-p1@example.invalid'));
  if not (r ->> 'ok')::boolean then raise exception 'FAIL 2r: second request in the week refused %', r; end if;
  perform pg_temp.call_as(p1, 'select public.cancel_contact_recovery()');
  r := pg_temp.call_svc(format('select public.request_contact_recovery(%L, %L)', 'email', 's03b-p1@example.invalid'));
  if (r ->> 'ok')::boolean then raise exception 'FAIL 2r: the weekly request cap did not hold'; end if;

  -- RLS: the two people a row names can read it; nobody else
  r := pg_temp.call_as(p1, 'select to_jsonb(count(*)) from public.account_recovery_contacts');
  if (r #>> '{}')::int < 1 then raise exception 'FAIL 2s(control): the patient cannot read their own contact row'; end if;
  r := pg_temp.call_as(p2, 'select to_jsonb(count(*)) from public.account_recovery_contacts');
  if (r #>> '{}')::int < 1 then raise exception 'FAIL 2s(control): the contact cannot read the row that names them'; end if;
  r := pg_temp.call_as(p3, 'select to_jsonb(count(*)) from public.account_recovery_contacts');
  if (r #>> '{}')::int <> 0 then raise exception 'FAIL 2s: a stranger reads contact rows'; end if;
  r := pg_temp.call_as(p3, 'select to_jsonb(count(*)) from public.account_recovery_contact_requests');
  if (r #>> '{}')::int <> 0 then raise exception 'FAIL 2s: a stranger reads recovery requests'; end if;
  if not pg_temp.refused('authenticated', p1, format('update public.account_recovery_contact_requests set state = ''released'' where patient_id = %L', p1)) then
    -- an UPDATE with no write grant must be refused outright
    raise exception 'FAIL 2s: a patient can write a recovery request directly'; end if;
  if not pg_temp.refused('authenticated', p2, format('insert into public.account_recovery_contacts (organisation_id, patient_id, contact_id, member_id, state) values (%L, %L, %L, %L, ''accepted'')', v_org, p3, p2, m1)) then
    raise exception 'FAIL 2s: a supporter can insert themselves as a contact'; end if;
  if not pg_temp.refused('anon', null, 'select * from public.account_recovery_contacts') then raise exception 'FAIL 2s: anon reads contacts'; end if;
  raise notice 'PASS 2 recovery contact';

  -- ===== 3. CHANGE-NUMBER GATE and the hold
  -- CONTROL first (before any change touches p1's timestamps): an account whose number is 20 days old is not held
  r := pg_temp.call_as(p1, 'select public.my_phone_recovery_hold()');
  if (r ->> 'held')::boolean then raise exception 'FAIL 3h(control): an account whose number is 20 days old is held %', r; end if;
  -- a phone_confirmed_at re-stamp (what GoTrue does on every successful SMS code) is NOT a number change and starts no pause
  update auth.users set phone_confirmed_at = now() where id = p4;
  r := pg_temp.call_as(p4, 'select public.my_phone_recovery_hold()');
  if (r ->> 'held')::boolean then raise exception 'FAIL 3h0: a normal code login (a phone_confirmed_at re-stamp) started a pause %', r; end if;
  if exists (select 1 from public.account_phone_changes where user_id = p4) then raise exception 'FAIL 3h0: a re-stamp was recorded as a number change'; end if;
  if (select count(*) from public.account_phone_changes where user_id = p5) <> 1 then raise exception 'FAIL 3h0: the move of p5''s number was not recorded exactly once'; end if;
  -- the freshness check is service only and does not spend anything
  if pg_temp.svc_bool(format('select public.has_fresh_phone_change_authorisation(%L)', p1)) then raise exception 'FAIL 3b0: p1 already holds an authorisation'; end if;
  if not pg_temp.refused('authenticated', p1, format('select public.has_fresh_phone_change_authorisation(%L)', p1)) then raise exception 'FAIL 3b0: a session can ask about authorisations'; end if;
  -- p1 has a confirmed phone and email: a direct number change is refused with no authorisation
  v_txt := null;
  begin update auth.users set phone_change = '2348055550001', phone_change_sent_at = now() where id = p1;
  exception when others then v_txt := sqlerrm; end;
  if v_txt is distinct from 'phone_change_needs_confirmation' then raise exception 'FAIL 3a: a number change started with no confirmation (%)', v_txt; end if;
  -- an authorisation must be earned through the service role, not by a session
  if not pg_temp.refused('authenticated', p1, format('select public.authorise_phone_change(%L, %L)', p1, 'email')) then raise exception 'FAIL 3b: a session can authorise its own number change'; end if;
  if not pg_temp.refused('anon', null, format('select public.authorise_phone_change(%L, %L)', p1, 'email')) then raise exception 'FAIL 3b: anon can authorise a number change'; end if;
  -- the method must be real: p7 has no confirmed phone or email
  r := pg_temp.call_svc(format('select public.authorise_phone_change(%L, %L)', p7, 'old_phone'));
  if (r ->> 'ok')::boolean then raise exception 'FAIL 3c: old_phone authorised for an account with no confirmed phone'; end if;
  r := pg_temp.call_svc(format('select public.authorise_phone_change(%L, %L)', p4, 'email'));
  if (r ->> 'ok')::boolean then raise exception 'FAIL 3c: email authorised for an account with no confirmed email'; end if;
  -- the gate covers every active account that has something to confirm with, staff included (a clinician with a verified email can be confirmed)
  r := pg_temp.call_svc(format('select public.authorise_phone_change(%L, %L)', clin, 'email'));
  if not (r ->> 'ok')::boolean then raise exception 'FAIL 3c: a clinician with a verified email could not be authorised %', r; end if;
  r := pg_temp.call_svc(format('select public.authorise_phone_change(%L, %L)', gen_random_uuid(), 'email'));
  if (r ->> 'ok')::boolean then raise exception 'FAIL 3c: an unknown account was authorised'; end if;
  -- authorised: the change goes through exactly once
  r := pg_temp.call_svc(format('select public.authorise_phone_change(%L, %L)', p1, 'email'));
  if not (r ->> 'ok')::boolean then raise exception 'FAIL 3d: authorise refused %', r; end if;
  if not exists (select 1 from public.notifications where recipient_id = p1 and template = 'security.phone_change_started' and channel = 'in_app')
     or not exists (select 1 from public.notifications where recipient_id = p1 and template = 'security.phone_change_started' and channel = 'email') then
    raise exception 'FAIL 3d: owner not told when a number change started'; end if;
  if not pg_temp.svc_bool(format('select public.has_fresh_phone_change_authorisation(%L)', p1)) then raise exception 'FAIL 3d: a fresh authorisation is not reported'; end if;
  update auth.users set phone_change = '2348055550001', phone_change_sent_at = now() where id = p1;
  if pg_temp.svc_bool(format('select public.has_fresh_phone_change_authorisation(%L)', p1)) then raise exception 'FAIL 3d: a spent authorisation is reported as fresh'; end if;
  -- a resend of the same number and the clearing on confirmation are not gated
  update auth.users set phone_change = '2348055550001', phone_change_sent_at = now() where id = p1;
  update auth.users set phone_change = '' where id = p1;
  v_txt := null;
  begin update auth.users set phone_change = '2348055550002' where id = p1;
  exception when others then v_txt := sqlerrm; end;
  if v_txt is distinct from 'phone_change_needs_confirmation' then raise exception 'FAIL 3e: one authorisation allowed two changes (%)', v_txt; end if;
  -- an expired authorisation does not count
  perform pg_temp.call_svc(format('select public.authorise_phone_change(%L, %L)', p1, 'old_phone'));
  update public.phone_change_authorisations set expires_at = now() - interval '1 minute' where user_id = p1 and consumed_at is null;
  v_txt := null;
  begin update auth.users set phone_change = '2348055550003' where id = p1;
  exception when others then v_txt := sqlerrm; end;
  if v_txt is distinct from 'phone_change_needs_confirmation' then raise exception 'FAIL 3f: an expired authorisation was accepted (%)', v_txt; end if;
  -- someone else's authorisation does not count
  perform pg_temp.call_svc(format('select public.authorise_phone_change(%L, %L)', p3, 'email'));
  v_txt := null;
  begin update auth.users set phone_change = '2348055550004' where id = p1;
  exception when others then v_txt := sqlerrm; end;
  if v_txt is distinct from 'phone_change_needs_confirmation' then raise exception 'FAIL 3g: another account''s authorisation was accepted (%)', v_txt; end if;
  -- CONTROL: an account with nothing to confirm with is not blocked (a first number on a brand-new account)
  update auth.users set phone_change = '2348055550007', phone_change_sent_at = now() where id = p7;
  -- the owner is told when the number actually moves, and recovery by code is then held
  update auth.users set phone = '2348055550001', phone_confirmed_at = now(), phone_change = '' where id = p1;
  if not exists (select 1 from public.notifications where recipient_id = p1 and template = 'security.phone_changed' and channel = 'in_app')
     or not exists (select 1 from public.notifications where recipient_id = p1 and template = 'security.phone_changed' and channel = 'email') then
    raise exception 'FAIL 3h: owner not told when the number moved'; end if;
  if exists (select 1 from public.notifications where recipient_id = p1 and channel = 'sms') then raise exception 'FAIL 3h: an SMS notice was queued (INV-08)'; end if;
  -- p1 was released by a contact minutes ago in section 2, so the hold is lifted for now (and says why) ...
  r := pg_temp.call_as(p1, 'select public.my_phone_recovery_hold()');
  if (r ->> 'held')::boolean or not coalesce((r ->> 'released_by_contact')::boolean, false) then raise exception 'FAIL 3i: a fresh contact release did not lift the hold for p1 %', r; end if;
  -- ... and once that release is older than two hours the hold applies
  update public.account_recovery_contact_requests set released_at = now() - interval '3 hours' where patient_id = p1 and state = 'released';
  r := pg_temp.call_as(p1, 'select public.my_phone_recovery_hold()');
  if not (r ->> 'held')::boolean or (r ->> 'until')::timestamptz < now() + interval '71 hours' then raise exception 'FAIL 3i: recovery by code not held after a number change %', r; end if;
  r := pg_temp.call_as(p5, 'select public.my_phone_recovery_hold()');
  if not (r ->> 'held')::boolean then raise exception 'FAIL 3i: a number confirmed 5 hours ago is not held'; end if;
  r := pg_temp.call_as(p3, 'select public.my_phone_recovery_hold()');
  if (r ->> 'held')::boolean then raise exception 'FAIL 3i(control): an account with no phone is held'; end if;
  r := pg_temp.call_as(p7, 'select public.my_phone_recovery_hold()');
  if (r ->> 'held')::boolean then raise exception 'FAIL 3i(control): a brand-new account is held'; end if;
  -- the contact route is the second confirmation: a release in the last two hours lifts the hold; an old one does not
  insert into public.account_recovery_contacts (organisation_id, patient_id, contact_id, member_id, state, responded_at)
    values (v_org, p5, p2, m1, 'accepted', now()) returning id into cid;
  insert into public.account_recovery_contact_requests (organisation_id, patient_id, contact_id, contact_row_id, state, expires_at, confirmed_at, release_at, released_at)
    values (v_org, p5, p2, cid, 'released', now() + interval '1 day', now() - interval '26 hours', now() - interval '1 hour', now() - interval '3 hours') returning id into rid;
  r := pg_temp.call_as(p5, 'select public.my_phone_recovery_hold()');
  if not (r ->> 'held')::boolean then raise exception 'FAIL 3j: a release three hours ago lifted the hold'; end if;
  update public.account_recovery_contact_requests set released_at = now() - interval '10 minutes' where id = rid;
  r := pg_temp.call_as(p5, 'select public.my_phone_recovery_hold()');
  if (r ->> 'held')::boolean then raise exception 'FAIL 3j: a fresh contact release did not lift the hold %', r; end if;
  if not exists (select 1 from public.audit_log where subject_patient_id = p1 and action = 'account.phone_change_authorised') then raise exception 'FAIL 3k: authorisation not audited'; end if;
  -- the number-changed notice failing to queue must NEVER block a legitimate number change (it is a warning)
  create or replace function private.recovery_notice(p_user uuid, p_template text, p_message text, p_email boolean default true) returns text[]
    language plpgsql security definer set search_path = '' as $f$ begin raise exception 'forced failure for the proof'; end $f$;
  update auth.users set phone = '2348077770003' where id = p4;   -- p4 has an old number, so a notice IS attempted
  if (select phone from auth.users where id = p4) <> '2348077770003' then raise exception 'FAIL 3l: a failing notice blocked the number change'; end if;
  if not exists (select 1 from public.account_phone_changes where user_id = p4) then raise exception 'FAIL 3l: the change was not recorded when the notice failed'; end if;
  raise notice 'PASS 3 change-number gate and hold';
end $$;

-- ===========================================================================
-- 5. SABOTAGE. Each block reverts one guard and proves the matching check above could fail.
-- ===========================================================================
do $$
declare
  v_org uuid; s uuid := gen_random_uuid(); t uuid := gen_random_uuid(); v_ok boolean; v_txt text; rid uuid; cid uuid; m uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (s, 's03bsab-s@example.invalid', 'x', now(), '{}', '{}'), (t, 's03bsab-t@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name) values (s, v_org, 'patient', 'Sab Subject'), (t, v_org, 'patient', 'Sab Contact')
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id;
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at)
    values (v_org, s, t, 'Sister', array['adherence_summary'], now() + interval '100 days') returning id into m;
  insert into public.account_recovery_contacts (organisation_id, patient_id, contact_id, member_id, state, responded_at) values (v_org, s, t, m, 'accepted', now()) returning id into cid;
  insert into public.account_recovery_contact_requests (organisation_id, patient_id, contact_id, contact_row_id, state, expires_at, confirmed_at, release_at)
    values (v_org, s, t, cid, 'confirmed', now() + interval '2 days', now(), now() + interval '24 hours') returning id into rid;

  -- S1: grant read on the codes table; a signed-in patient can then read it (the 1c check would fail)
  execute 'grant select on public.account_backup_codes to authenticated';
  execute 'create policy sab_codes on public.account_backup_codes for select to authenticated using (true)';
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_ok := true;
  begin perform 1 from public.account_backup_codes limit 1; exception when others then v_ok := false; end;
  execute 'reset role';
  if not v_ok then raise exception 'VACUOUS TEST: granting select did not open the codes table'; end if;

  -- S2: grant EXECUTE on redeem to authenticated; a session can then call it
  execute 'grant execute on function public.redeem_backup_code(text,text,text) to authenticated';
  if not has_function_privilege('authenticated', 'public.redeem_backup_code(text,text,text)', 'EXECUTE') then raise exception 'VACUOUS TEST: grant did not expose redeem'; end if;

  -- S3: drop the minimum-wait CHECK; the wait can then be zeroed by data
  for v_txt in select conname from pg_constraint where conrelid = 'public.account_recovery_contact_requests'::regclass and contype = 'c'
                  and pg_get_constraintdef(oid) like '%release_at >= (confirmed_at%' loop
    execute format('alter table public.account_recovery_contact_requests drop constraint %I', v_txt);
  end loop;
  v_ok := false;
  begin update public.account_recovery_contact_requests set release_at = confirmed_at where id = rid; v_ok := true;
  exception when others then v_ok := false; end;
  if not v_ok then raise exception 'VACUOUS TEST: dropping the minimum-wait CHECK did not allow a zero wait'; end if;

  -- S4: replace the gate function with a no-op; a number change then starts with no authorisation
  execute $f$create or replace function private.enforce_phone_change_authorisation() returns trigger language plpgsql security definer set search_path = '' as $b$ begin return new; end $b$ $f$;
  v_ok := false;
  begin update auth.users set phone_change = '2348066660001' where id = s; v_ok := true; exception when others then v_ok := false; end;
  if not v_ok then raise exception 'VACUOUS TEST: neutering the gate did not allow an unconfirmed number change'; end if;
  -- (control for the proof: with the real gate the same update is refused - proven in section 3 above)

  -- S6: a notice written 'critical' is exactly what the escalation engine picks up (the 1p check would then fail)
  create or replace function private.recovery_notice(p_user uuid, p_template text, p_message text, p_email boolean default true) returns text[]
    language plpgsql security definer set search_path = '' as $f$
    begin
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class, priority)
      select organisation_id, p_user, 'in_app', 'pending', p_template, '{}'::jsonb, 'non_clinical', 'critical' from public.profiles where id = p_user;
      return array['in_app'];
    end $f$;
  perform private.recovery_notice(s, 'security.sab', 'x');
  if not exists (select 1 from public.notifications where recipient_id = s and template = 'security.sab' and priority = 'critical') then
    raise exception 'VACUOUS TEST: a critical security notice is not detectable by the priority check'; end if;

  -- S7: the old pause signal (phone_confirmed_at) makes a plain code login look like a number change
  create or replace function private.number_changed_recently(p_user uuid, p_hours integer) returns boolean language sql stable security definer set search_path = ''
    as $f$ select coalesce((select u.created_at < now() - make_interval(hours => p_hours) and greatest(u.phone_change_sent_at, u.phone_confirmed_at) > now() - make_interval(hours => p_hours) from auth.users u where u.id = p_user), false) $f$;
  update auth.users set phone = '2348088880001', phone_confirmed_at = now(), created_at = now() - interval '30 days' where id = s;
  if not private.number_changed_recently(s, 72) then raise exception 'VACUOUS TEST: the old signal does not treat a re-stamp as a change'; end if;

  -- S5: grant EXECUTE to PUBLIC; anon inherits it (the public-revoke gotcha)
  execute 'grant execute on function public.generate_backup_codes() to public';
  if not has_function_privilege('anon', 'public.generate_backup_codes()', 'EXECUTE') then
    raise exception 'VACUOUS TEST: granting to PUBLIC did not reach anon, so the anon check proves nothing'; end if;
end $$;

select 'PASS: s03b_account_recovery_routes' as result;

rollback;
