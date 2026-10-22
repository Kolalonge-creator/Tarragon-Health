-- CGJ proof: a patient invites a Care Circle member into ONE consultation call (migration *_cgj_caregiver_in_consultation.sql).
-- One rolled-back transaction. Proves:
--   1. The sixth permission exists and the old shape is unchanged; the config row is active and validated.
--   2. Who can invite: the patient, and a proxy who already acts for them; never a stranger, never a proxy of another patient.
--   3. Who can be invited: only an active, unexpired, unpaused circle member of THAT patient who holds attend_consultation, an adult,
--      not the clinician; refused for a non-member, a member without the permission, an expired or revoked member, a paused circle,
--      another patient's circle member, an under-age account; capped per call; no duplicate; refused for an ended call, a closed join
--      window and another patient's call. Every refusal to a stranger is the same.
--   4. Accept/decline: only the invited person, once. The credential (service_get_caregiver_pass) exists only for an accepted, unexpired
--      pass inside the join window of a live call, and dies with the call, the circle member, a pause or a removal.
--   5. The caregiver gains NO chart access: reads no encounter, event, note or consent row; cannot ask, give or withdraw scribe consent;
--      cannot report call events; cannot write a pass.
--   6. The clinician: sees the relationship label and a state (never a name), sees presence, removes (only the assigned clinician);
--      removal is final for the call (no credential, no rejoin record, no re-invite) and is audited.
--   7. Events: append-only, their own kinds, ids and small codes only, and the general recorders still refuse them.
--   8. Privileges: no anon or signed-in execute on the server-only functions; the pass table is read-only to signed-in users.
-- SABOTAGE (each must flip a check): the permission test removed, the live-call test removed, the clinician-only removal test removed,
-- the inviter test removed, and a server-only function granted to signed-in users.
begin;

-- registration refuses minors; the under-age fixture needs one (switched off inside this rolled-back transaction only)
do $$
declare r record;
begin
  if exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_01_enforce_adult_registration') then
    alter table public.profiles disable trigger profiles_01_enforce_adult_registration;
  end if;
  for r in select c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgname = '00_minor_dependant_scope' and not t.tgisinternal loop
    execute format('alter table public.%I disable trigger "00_minor_dependant_scope"', r.relname);
  end loop;
end $$;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.svc(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  set local role service_role;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
-- run as the table owner; the SQLSTATE of the failure ('ok' when it did not fail)
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
-- Events written in ONE transaction share a created_at (now()), but in production each is its own request. After each step the test
-- moves the earlier events back a second (the append-only trigger is lifted for the instant, in this rolled-back transaction only), so
-- "the latest of joined and left" has the order a real run has.
create function pg_temp.tick() returns void language plpgsql as
$f$ begin
  alter table public.encounter_events disable trigger encounter_events_append_only;
  update public.encounter_events set created_at = created_at - interval '1 second' where is_test;
  alter table public.encounter_events enable trigger encounter_events_append_only;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_age integer default 45, p_support boolean default false) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'cgj-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'CGJ ' || p_label || ' Surname', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          case when p_age is null then null else (current_date - (p_age::text || ' years')::interval)::date end, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, full_name = excluded.full_name,
                                  date_of_birth = excluded.date_of_birth;
  if p_support then update public.profiles set receives_care = false where id = v; end if;
  return v;
end $f$;
-- a consultation (a fixture: the booking machinery is S21's and has its own proof)
create function pg_temp.mkenc(p_org uuid, p_pat uuid, p_clin uuid, p_at timestamptz, p_status text default 'scheduled') returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, policy_version, is_test)
  values (p_org, p_pat, p_clin, 'video', p_status, p_at, private.consult_policy_version(), true) returning id into v;
  return v;
end $f$;
create function pg_temp.mkmember(p_org uuid, p_pat uuid, p_sup uuid, p_label text, p_perms text[], p_state text default 'active', p_days integer default 90) returns uuid
language plpgsql as $f$ declare v uuid;
begin
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, state, expires_at, revoked_at, is_test)
  values (p_org, p_pat, p_sup, p_label, p_perms, p_state, now() + (p_days::text || ' days')::interval,
          case when p_state = 'revoked' then now() else null end, true) returning id into v;
  return v;
end $f$;
create function pg_temp.invite(p_who uuid, p_enc uuid, p_member uuid) returns text language sql as
$$ select pg_temp.q_as(p_who, format($q$select public.invite_caregiver_to_consultation(%L, %L)::text$q$, p_enc, p_member)) $$;
create function pg_temp.pass_of(p_enc uuid, p_sup uuid) returns uuid language sql as
$$ select id from public.encounter_caregiver_passes where encounter_id = p_enc and caregiver_id = p_sup order by created_at desc limit 1 $$;
create function pg_temp.cred(p_enc uuid, p_sup uuid) returns text language sql as
$$ select pg_temp.svc(format($q$select public.service_get_caregiver_pass(%L, %L)::text$q$, p_enc, p_sup)) $$;
create function pg_temp.nev(p_enc uuid, p_kind text) returns integer language sql as
$$ select count(*)::integer from public.encounter_events where encounter_id = p_enc and kind = p_kind $$;
create function pg_temp.is_err(p_r text, p_frag text) returns text language sql as
$$ select (p_r like 'ERR:%' and p_r like '%' || p_frag || '%')::text $$;

do $$
declare
  v_org uuid;
  v_pat uuid; v_pat2 uuid; v_clin uuid; v_clin2 uuid; v_prx uuid; v_prx2 uuid; v_stranger uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid; v_s5 uuid; v_s6 uuid; v_s7 uuid; v_s8 uuid; v_s9 uuid;
  v_m1 uuid; v_m2 uuid; v_m4 uuid; v_m5 uuid; v_m6 uuid; v_m7 uuid; v_m8 uuid; v_mclin uuid; v_m9 uuid;
  v_eX uuid; v_eA uuid; v_eB uuid; v_eEnded uuid; v_eLate uuid; v_eEarly uuid; v_eD uuid; v_eP uuid; v_eS uuid;
  r text; j jsonb; v_pass uuid; n integer;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;

  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, 'patient2', 'patient');
  v_clin := pg_temp.mkuser(v_org, 'clinician', 'clinician');
  v_clin2 := pg_temp.mkuser(v_org, 'clinician2', 'clinician');
  v_prx := pg_temp.mkuser(v_org, 'proxy', 'patient');
  v_prx2 := pg_temp.mkuser(v_org, 'proxy2', 'patient');
  v_stranger := pg_temp.mkuser(v_org, 'stranger', 'patient');
  v_s1 := pg_temp.mkuser(v_org, 'daughter', 'patient', null, true);   -- supporter-only account: never asked for a date of birth
  v_s2 := pg_temp.mkuser(v_org, 'son', 'patient');
  v_s3 := pg_temp.mkuser(v_org, 'nonmember', 'patient');
  v_s4 := pg_temp.mkuser(v_org, 'expired', 'patient');
  v_s5 := pg_temp.mkuser(v_org, 'revoked', 'patient');
  v_s6 := pg_temp.mkuser(v_org, 'teen', 'patient', 15);
  v_s7 := pg_temp.mkuser(v_org, 'second', 'patient');
  v_s8 := pg_temp.mkuser(v_org, 'otherpatientsupporter', 'patient');
  v_s9 := pg_temp.mkuser(v_org, 'third', 'patient');
  perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('pat2', v_pat2); perform pg_temp.setf('clin', v_clin); perform pg_temp.setf('clin2', v_clin2);
  perform pg_temp.setf('prx', v_prx); perform pg_temp.setf('prx2', v_prx2); perform pg_temp.setf('stranger', v_stranger);
  perform pg_temp.setf('s1', v_s1); perform pg_temp.setf('s2', v_s2); perform pg_temp.setf('s3', v_s3); perform pg_temp.setf('s4', v_s4);
  perform pg_temp.setf('s5', v_s5); perform pg_temp.setf('s6', v_s6); perform pg_temp.setf('s7', v_s7); perform pg_temp.setf('s8', v_s8); perform pg_temp.setf('s9', v_s9);

  -- proxies: the older profile_access grant at manage level is what private.can_act_for reads
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_pat, v_prx, 'manage', v_pat);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_pat2, v_prx2, 'manage', v_pat2);

  -- the circle
  v_m1 := pg_temp.mkmember(v_org, v_pat, v_s1, 'Daughter', array['attend_consultation', 'appointments']);
  v_m2 := pg_temp.mkmember(v_org, v_pat, v_s2, 'Son', array['appointments']);                       -- no attend_consultation
  v_m4 := pg_temp.mkmember(v_org, v_pat, v_s4, 'Niece', array['attend_consultation']);
  update public.care_circle_members set expires_at = now() - interval '1 day' where id = v_m4;      -- expired
  v_m5 := pg_temp.mkmember(v_org, v_pat, v_s5, 'Cousin', array['attend_consultation'], 'revoked');
  v_m6 := pg_temp.mkmember(v_org, v_pat, v_s6, 'Grandson', array['attend_consultation']);           -- 15 years old
  v_m7 := pg_temp.mkmember(v_org, v_pat, v_s7, 'Sister', array['attend_consultation']);
  v_m8 := pg_temp.mkmember(v_org, v_pat2, v_s8, 'Brother', array['attend_consultation']);           -- a member of ANOTHER patient's circle
  v_mclin := pg_temp.mkmember(v_org, v_pat, v_clin, 'Friend', array['attend_consultation']);        -- the care team's own doctor
  v_m9 := pg_temp.mkmember(v_org, v_pat, v_s9, 'Nephew', array['attend_consultation']);
  perform pg_temp.setf('m1', v_m1); perform pg_temp.setf('m7', v_m7); perform pg_temp.setf('m9', v_m9);

  -- the consultations: A is live now; B is another patient's; Ended is over; Late's join window has closed; Early opens in two days
  v_eA := pg_temp.mkenc(v_org, v_pat, v_clin, now() + interval '5 minutes');
  v_eB := pg_temp.mkenc(v_org, v_pat2, v_clin2, now() + interval '5 minutes');
  v_eEnded := pg_temp.mkenc(v_org, v_pat, v_clin, now() - interval '10 minutes', 'completed');
  v_eLate := pg_temp.mkenc(v_org, v_pat, v_clin, now() - interval '3 hours');
  v_eEarly := pg_temp.mkenc(v_org, v_pat, v_clin, now() + interval '2 days');
  v_eD := pg_temp.mkenc(v_org, v_pat, v_clin, now() + interval '5 minutes');
  v_eP := pg_temp.mkenc(v_org, v_pat, v_clin, now() + interval '5 minutes');
  v_eS := pg_temp.mkenc(v_org, v_pat, v_clin, now() + interval '5 minutes');
  perform pg_temp.setf('eA', v_eA); perform pg_temp.setf('eB', v_eB); perform pg_temp.setf('eEnded', v_eEnded); perform pg_temp.setf('eLate', v_eLate);
  perform pg_temp.setf('eEarly', v_eEarly); perform pg_temp.setf('eD', v_eD); perform pg_temp.setf('eP', v_eP); perform pg_temp.setf('eS', v_eS);

  -- ===== 1. the permission and the config
  perform pg_temp.ck('attend_consultation is a valid permission', 'true', private.circle_permissions_valid(array['attend_consultation'])::text);
  perform pg_temp.ck('the old five still validate', 'true', private.circle_permissions_valid(array['adherence_summary', 'weekly_bp_trend', 'appointments', 'red_alerts', 'pay_for_care'])::text);
  perform pg_temp.ck('all six validate together', 'true', private.circle_permissions_valid(array['adherence_summary', 'weekly_bp_trend', 'appointments', 'red_alerts', 'pay_for_care', 'attend_consultation'])::text);
  perform pg_temp.ck('an unknown permission is refused', 'false', private.circle_permissions_valid(array['attend_any_call'])::text);
  perform pg_temp.ck('a repeated permission is refused', 'false', private.circle_permissions_valid(array['attend_consultation', 'attend_consultation'])::text);
  perform pg_temp.ck('exactly one active config row', '1', (select count(*)::text from public.consultation_caregiver_config where is_active));
  perform pg_temp.ck('the config rejects a missing key', '23514',
    pg_temp.try($q$insert into public.consultation_caregiver_config (version, rules, effective_from) values (99, '{"inviteExpiryMinutes":60}'::jsonb, current_date)$q$));
  perform pg_temp.ck('the config rejects five people per call', '23514',
    pg_temp.try($q$insert into public.consultation_caregiver_config (version, rules, effective_from) values (98, '{"inviteExpiryMinutes":60,"maxCaregiversPerCall":5,"minAgeYears":18,"requireDateOfBirth":false}'::jsonb, current_date)$q$));
  perform pg_temp.ck('the config accepts a valid new version (a new row, not an edit)', 'ok',
    pg_temp.try($q$insert into public.consultation_caregiver_config (version, rules, effective_from) values (97, '{"inviteExpiryMinutes":60,"maxCaregiversPerCall":2,"minAgeYears":18,"requireDateOfBirth":true}'::jsonb, current_date)$q$));

  -- ===== 3. refusals first (nothing is created by any of them)
  perform pg_temp.ck('a stranger cannot invite into someone else''s call', 'true', pg_temp.is_err(pg_temp.invite(v_stranger, v_eA, v_m1), 'caregiver_invite_not_allowed'));
  perform pg_temp.ck('the supporter cannot invite themselves', 'true', pg_temp.is_err(pg_temp.invite(v_s1, v_eA, v_m1), 'caregiver_invite_not_allowed'));
  perform pg_temp.ck('the clinician cannot invite', 'true', pg_temp.is_err(pg_temp.invite(v_clin, v_eA, v_m1), 'caregiver_invite_not_allowed'));
  perform pg_temp.ck('another patient''s proxy cannot invite', 'true', pg_temp.is_err(pg_temp.invite(v_prx2, v_eA, v_m1), 'caregiver_invite_not_allowed'));
  perform pg_temp.ck('an unknown consultation reads the same as someone else''s', 'true', pg_temp.is_err(pg_temp.invite(v_pat, gen_random_uuid(), v_m1), 'caregiver_invite_not_allowed'));
  perform pg_temp.ck('a patient cannot invite into another patient''s call', 'true', pg_temp.is_err(pg_temp.invite(v_pat, v_eB, v_m8), 'caregiver_invite_not_allowed'));
  perform pg_temp.ck('a member without attend_consultation is refused', 'true', pg_temp.is_err(pg_temp.invite(v_pat, v_eA, v_m2), 'caregiver_invite_not_permitted'));
  perform pg_temp.ck('an expired member is refused', 'true', pg_temp.is_err(pg_temp.invite(v_pat, v_eA, v_m4), 'caregiver_invite_not_permitted'));
  perform pg_temp.ck('a revoked member is refused', 'true', pg_temp.is_err(pg_temp.invite(v_pat, v_eA, v_m5), 'caregiver_invite_not_permitted'));
  perform pg_temp.ck('an under-age account is refused', 'true', pg_temp.is_err(pg_temp.invite(v_pat, v_eA, v_m6), 'caregiver_invite_not_permitted'));
  perform pg_temp.ck('the care team''s own doctor is refused', 'true', pg_temp.is_err(pg_temp.invite(v_pat, v_eA, v_mclin), 'caregiver_invite_not_permitted'));
  perform pg_temp.ck('another patient''s circle member cannot be brought in', 'true', pg_temp.is_err(pg_temp.invite(v_pat, v_eA, v_m8), 'caregiver_invite_not_permitted'));
  perform pg_temp.ck('a made-up member id is refused', 'true', pg_temp.is_err(pg_temp.invite(v_pat, v_eA, gen_random_uuid()), 'caregiver_invite_not_permitted'));
  perform pg_temp.ck('an ended call refuses an invite', 'true', pg_temp.is_err(pg_temp.invite(v_pat, v_eEnded, v_m1), 'caregiver_invite_call_not_live'));
  perform pg_temp.ck('a call whose window has closed refuses an invite', 'true', pg_temp.is_err(pg_temp.invite(v_pat, v_eLate, v_m1), 'caregiver_invite_call_not_live'));
  insert into public.care_circle_pauses (patient_id, organisation_id, paused_until, is_test) values (v_pat2, v_org, now() + interval '3 days', true);
  perform pg_temp.ck('nothing was created by any refusal', '0', (select count(*)::text from public.encounter_caregiver_passes));

  -- ===== 2. the patient invites a permitted member
  r := pg_temp.invite(v_pat, v_eA, v_m1);
  perform pg_temp.ck('the patient invites a permitted member', 'true', (r not like 'ERR:%')::text);
  v_pass := pg_temp.pass_of(v_eA, v_s1);
  perform pg_temp.setf('passA', v_pass);
  perform pg_temp.ck('the pass is invited and carries the circle label', 'invited|Daughter',
    (select state || '|' || relationship from public.encounter_caregiver_passes where id = v_pass));
  perform pg_temp.ck('the pass records the config version (INV-16)', '1', (select config_version::text from public.encounter_caregiver_passes where id = v_pass));
  perform pg_temp.ck('the invite expires no later than the join window closes', 'true',
    (select (expires_at <= e.scheduled_at + interval '60 minutes' and expires_at <= now() + interval '240 minutes 1 second')::text
       from public.encounter_caregiver_passes p join public.encounters e on e.id = p.encounter_id where p.id = v_pass));
  perform pg_temp.ck('an unsupported supporter-only account (no date of birth) can be invited', 'true',
    (select (date_of_birth is null)::text from public.profiles where id = v_s1));
  perform pg_temp.ck('the invite is an event with the pass id and nothing else', 'true',
    (select (count(*) = 1 and bool_and(payload = jsonb_build_object('pass_id', v_pass)) and bool_and(actor_role = 'patient' and actor_id = v_pat))::text
       from public.encounter_events where encounter_id = v_eA and kind = 'caregiver_invited'));
  perform pg_temp.ck('the caregiver gets a neutral notice in the app and as a push, with an empty payload', '2|true',
    (select count(*)::text || '|' || coalesce(bool_and(payload = '{}'::jsonb), false)::text from public.notifications
      where recipient_id = v_s1 and template = 'circle_consultation_invite' and source_id = v_pass));
  perform pg_temp.ck('a second invite to the same person is refused', 'true', pg_temp.is_err(pg_temp.invite(v_pat, v_eA, v_m1), 'caregiver_invite_already_sent'));
  perform pg_temp.ck('the cap of people per call holds (one)', 'true', pg_temp.is_err(pg_temp.invite(v_pat, v_eA, v_m7), 'caregiver_invite_call_full'));
  perform pg_temp.ck('a call two days away can be invited to (the credential still waits for its window)', 'true', (pg_temp.invite(v_pat, v_eEarly, v_m1) not like 'ERR:%')::text);
  perform pg_temp.ck('...but the credential is not given before the join window opens', 'null',
    coalesce(pg_temp.cred(v_eEarly, v_s1), 'null'));

  -- a proxy who already acts for the patient can invite
  r := pg_temp.invite(v_prx, v_eP, v_m7);
  perform pg_temp.ck('a proxy who acts for the patient can invite', 'true', (r not like 'ERR:%')::text);
  perform pg_temp.ck('the proxy''s invite is recorded as the patient side, by the proxy', 'true',
    (select (count(*) = 1 and bool_and(actor_id = v_prx and actor_role = 'patient'))::text from public.encounter_events where encounter_id = v_eP and kind = 'caregiver_invited'));

  -- a paused circle blocks inviting
  perform pg_temp.mkmember(v_org, v_pat2, v_s3, 'Friend', array['attend_consultation']);
  perform pg_temp.ck('a paused circle cannot invite', 'true',
    pg_temp.is_err(pg_temp.invite(v_pat2, v_eB, (select id from public.care_circle_members where patient_id = v_pat2 and supporter_id = v_s3)), 'caregiver_invite_not_permitted'));

  -- ===== 4. accept, decline, the credential
  perform pg_temp.ck('no credential before the invite is accepted', 'null', coalesce(pg_temp.cred(v_eA, v_s1), 'null'));
  perform pg_temp.ck('only the invited person can answer', 'true',
    pg_temp.is_err(pg_temp.q_as(v_stranger, format($q$select public.respond_caregiver_consultation_invite(%L, true)::text$q$, v_pass)), 'caregiver_invite_unavailable'));
  perform pg_temp.ck('the patient cannot answer for the caregiver', 'true',
    pg_temp.is_err(pg_temp.q_as(v_pat, format($q$select public.respond_caregiver_consultation_invite(%L, true)::text$q$, v_pass)), 'caregiver_invite_unavailable'));
  perform pg_temp.ck('the caregiver sees their invite, with a first name and a time only', 'true',
    (pg_temp.q_as(v_s1, 'select public.my_consultation_invites()::text')::jsonb -> 0 ->> 'patient_first_name' = 'CGJ'
     and not (pg_temp.q_as(v_s1, 'select public.my_consultation_invites()::text') like '%Surname%'))::text);
  perform pg_temp.ck('a stranger''s invite list is empty', '[]', pg_temp.q_as(v_stranger, 'select public.my_consultation_invites()::text'));
  perform pg_temp.ck('the caregiver accepts', 'true', pg_temp.q_as(v_s1, format($q$select public.respond_caregiver_consultation_invite(%L, true)::text$q$, v_pass)));
  perform pg_temp.ck('...and the answer is an event', '1', pg_temp.nev(v_eA, 'caregiver_accepted')::text);
  perform pg_temp.ck('an accepted pass lasts for the call: its expiry becomes the close of the join window', 'true',
    (select (p.expires_at = e.scheduled_at + interval '60 minutes')::text from public.encounter_caregiver_passes p join public.encounters e on e.id = p.encounter_id where p.id = v_pass));
  perform pg_temp.ck('answering twice is refused', 'true',
    pg_temp.is_err(pg_temp.q_as(v_s1, format($q$select public.respond_caregiver_consultation_invite(%L, true)::text$q$, v_pass)), 'caregiver_invite_unavailable'));
  perform pg_temp.ck('the credential exists for the accepted caregiver inside the window', 'true', (pg_temp.cred(v_eA, v_s1)::jsonb ->> 'pass_id' = v_pass::text)::text);
  perform pg_temp.ck('...and not for another person on the same call', 'null', coalesce(pg_temp.cred(v_eA, v_s2), 'null'));
  perform pg_temp.ck('...and not for the same person on another call', 'null', coalesce(pg_temp.cred(v_eB, v_s1), 'null'));
  perform pg_temp.ck('the credential check is not callable by a signed-in caregiver', 'true',
    pg_temp.is_err(pg_temp.q_as(v_s1, format($q$select public.service_get_caregiver_pass(%L, %L)::text$q$, v_eA, v_s1)), 'permission denied'));
  perform pg_temp.ck('recording a join gives "recorded"', 'recorded', pg_temp.svc(format($q$select public.service_record_caregiver_event(%L, 'caregiver_joined', 'audio_only')$q$, v_pass)));
  perform pg_temp.ck('...as an event of its own kind with the pass id and the mode', 'true',
    (select (count(*) = 1 and bool_and(payload = jsonb_build_object('pass_id', v_pass, 'mode', 'audio_only')) and bool_and(actor_role = 'caregiver' and actor_id = v_s1))::text
       from public.encounter_events where encounter_id = v_eA and kind = 'caregiver_joined'));
  perform pg_temp.ck('a caregiver join never counts as the patient or clinician joining (no start, no status change)', 'scheduled|0',
    (select status || '|' || (select count(*)::text from public.encounter_events where encounter_id = v_eA and kind = 'joined') from public.encounters where id = v_eA));
  perform pg_temp.tick();
  j := pg_temp.q_as(v_clin, format($q$select public.consultation_caregivers(%L)::text$q$, v_eA))::jsonb;
  perform pg_temp.ck('the clinician sees the caregiver present once they have joined', 'true', (j -> 'passes' -> 0 ->> 'present'));
  perform pg_temp.ck('the caregiver reports leaving', 'true', pg_temp.q_as(v_s1, format($q$select public.report_caregiver_left(%L)::text$q$, v_eA)));
  perform pg_temp.tick();
  j := pg_temp.q_as(v_clin, format($q$select public.consultation_caregivers(%L)::text$q$, v_eA))::jsonb;
  perform pg_temp.ck('...and not present after they leave', 'false', (j -> 'passes' -> 0 ->> 'present'));
  perform pg_temp.ck('...and a stranger cannot report a leave', 'false', pg_temp.q_as(v_stranger, format($q$select public.report_caregiver_left(%L)::text$q$, v_eA)));
  perform pg_temp.ck('...and a leave cannot be reported twice for one join (the log cannot be filled by repeating it)', 'false|1',
    pg_temp.q_as(v_s1, format($q$select public.report_caregiver_left(%L)::text$q$, v_eA)) || '|' || pg_temp.nev(v_eA, 'caregiver_left')::text);
  perform pg_temp.svc(format($q$select public.service_record_caregiver_event(%L, 'caregiver_joined', 'video')$q$, v_pass));
  perform pg_temp.tick();

  -- ===== 5. no chart access
  perform pg_temp.ck('the caregiver reads no consultation row', '0', pg_temp.q_as(v_s1, 'select count(*)::text from public.encounters'));
  perform pg_temp.ck('the caregiver reads no consultation event', '0', pg_temp.q_as(v_s1, 'select count(*)::text from public.encounter_events'));
  perform pg_temp.ck('the caregiver reads no room reference', '0', pg_temp.q_as(v_s1, 'select count(*)::text from public.encounter_rooms'));
  perform pg_temp.ck('the caregiver reads no scribe consent row', '0', pg_temp.q_as(v_s1, 'select count(*)::text from public.consultation_scribe_consents'));
  perform pg_temp.ck('the caregiver reads no consultation note', '0', pg_temp.q_as(v_s1, 'select count(*)::text from public.clinical_encounter_notes'));
  perform pg_temp.ck('the caregiver reads no vitals reading of the patient', '0', pg_temp.q_as(v_s1, format($q$select count(*)::text from public.vitals_readings where patient_id = %L$q$, v_pat)));
  perform pg_temp.ck('the caregiver reads no pass row directly (they use the function that says what they may know)', '0', pg_temp.q_as(v_s1, 'select count(*)::text from public.encounter_caregiver_passes'));
  perform pg_temp.ck('the patient reads the passes they made', 'true', (pg_temp.q_as(v_pat, 'select count(*)::text from public.encounter_caregiver_passes')::integer >= 2)::text);
  perform pg_temp.ck('...but never who removed one, or who invited', 'true',
    (pg_temp.q_as(v_pat, 'select removed_by::text from public.encounter_caregiver_passes limit 1') like 'ERR:%permission denied%'
     and pg_temp.q_as(v_pat, 'select invited_by::text from public.encounter_caregiver_passes limit 1') like 'ERR:%permission denied%')::text);
  perform pg_temp.ck('a stranger reads no pass', '0', pg_temp.q_as(v_stranger, 'select count(*)::text from public.encounter_caregiver_passes'));
  perform pg_temp.ck('the caregiver cannot write a pass', 'true',
    (pg_temp.q_as(v_s1, format($q$update public.encounter_caregiver_passes set state = 'accepted' where id = %L returning 'x'$q$, v_pass)) is null
     or pg_temp.q_as(v_s1, format($q$update public.encounter_caregiver_passes set state = 'accepted' where id = %L returning 'x'$q$, v_pass)) like 'ERR:%')::text);
  perform pg_temp.ck('the caregiver cannot ask for scribe consent', 'true', (pg_temp.q_as(v_s1, format($q$select public.open_scribe_prompt(%L)::text$q$, v_eA)) like 'ERR:%')::text);
  perform pg_temp.ck('the caregiver cannot give scribe consent', 'true', (pg_temp.q_as(v_s1, format($q$select public.record_scribe_consent(%L, true)::text$q$, v_eA)) like 'ERR:%')::text);
  perform pg_temp.ck('the caregiver cannot withdraw scribe consent', 'true', (pg_temp.q_as(v_s1, format($q$select public.record_scribe_consent(%L, false)::text$q$, v_eA)) like 'ERR:%')::text);
  perform pg_temp.ck('the caregiver cannot report a call event (so cannot move the call to audio only)', 'true',
    (pg_temp.q_as(v_s1, format($q$select public.report_encounter_event(%L, 'mode_changed', '{"mode":"audio_only"}'::jsonb)::text$q$, v_eA)) like 'ERR:%')::text);
  perform pg_temp.ck('the call mode is untouched', 'null', (select coalesce(final_media_mode, 'null') from public.encounters where id = v_eA));
  perform pg_temp.ck('no scribe consent row exists because of a caregiver', '0', (select count(*)::text from public.consultation_scribe_consents where encounter_id = v_eA));
  perform pg_temp.ck('the patient cannot record a caregiver kind through the app recorder', 'true',
    (pg_temp.q_as(v_pat, format($q$select public.report_encounter_event(%L, 'caregiver_joined')::text$q$, v_eA)) like 'ERR:%')::text);
  perform pg_temp.ck('the server''s general recorder refuses a caregiver kind', 'true',
    (pg_temp.svc(format($q$select public.service_record_encounter_event(%L, 'caregiver_removed', 'system')$q$, v_eA)) like 'ERR:%')::text);
  perform pg_temp.ck('recording is still pinned off in the room table', 'true',
    exists (select 1 from pg_constraint where conrelid = 'public.encounter_rooms'::regclass and pg_get_constraintdef(oid) ilike '%recording_enabled%')::text);

  -- ===== 6. the clinician
  j := pg_temp.q_as(v_clin, format($q$select public.consultation_caregivers(%L)::text$q$, v_eA))::jsonb;
  perform pg_temp.ck('the clinician is told the role, the label, the state and presence', 'clinician|Daughter|accepted|true',
    (j ->> 'role') || '|' || (j -> 'passes' -> 0 ->> 'relationship') || '|' || (j -> 'passes' -> 0 ->> 'state') || '|' || (j -> 'passes' -> 0 ->> 'present'));
  perform pg_temp.ck('the clinician is never given a name or the person''s id', 'true',
    (j -> 'passes' -> 0 -> 'name' = 'null'::jsonb and j::text not like '%Surname%' and j::text not like '%' || v_s1::text || '%' and (j -> 'invitable') = '[]'::jsonb)::text);
  perform pg_temp.ck('the clinician may remove', 'true', (j -> 'passes' -> 0 ->> 'removable'));
  j := pg_temp.q_as(v_pat, format($q$select public.consultation_caregivers(%L)::text$q$, v_eA))::jsonb;
  perform pg_temp.ck('the patient sees the person they invited by first name', 'true', (j -> 'passes' -> 0 ->> 'name' like 'CGJ daughter%')::text);
  perform pg_temp.ck('...and is offered no one who already has a pass, nor someone who may not be invited', 'true',
    (not exists (select 1 from jsonb_array_elements(j -> 'invitable') x where x ->> 'relationship' in ('Daughter', 'Son', 'Niece', 'Cousin', 'Grandson', 'Friend', 'Brother')))::text);
  perform pg_temp.ck('a stranger is told nothing about who is on a call', 'null', coalesce(pg_temp.q_as(v_stranger, format($q$select public.consultation_caregivers(%L)::text$q$, v_eA)), 'null'));
  perform pg_temp.ck('another clinician is told nothing', 'null', coalesce(pg_temp.q_as(v_clin2, format($q$select public.consultation_caregivers(%L)::text$q$, v_eA)), 'null'));
  perform pg_temp.ck('the caregiver is not told who else is on the call', 'null', coalesce(pg_temp.q_as(v_s1, format($q$select public.consultation_caregivers(%L)::text$q$, v_eA)), 'null'));

  perform pg_temp.ck('another clinician cannot remove', 'true', pg_temp.is_err(pg_temp.q_as(v_clin2, format($q$select public.remove_caregiver_from_consultation(%L)::text$q$, v_pass)), 'caregiver_remove_not_allowed'));
  perform pg_temp.ck('the patient cannot use the clinician''s removal', 'true', pg_temp.is_err(pg_temp.q_as(v_pat, format($q$select public.remove_caregiver_from_consultation(%L)::text$q$, v_pass)), 'caregiver_remove_not_allowed'));
  perform pg_temp.ck('the caregiver cannot remove themselves through it', 'true', pg_temp.is_err(pg_temp.q_as(v_s1, format($q$select public.remove_caregiver_from_consultation(%L)::text$q$, v_pass)), 'caregiver_remove_not_allowed'));
  perform pg_temp.ck('a free-text reason is refused', 'true', pg_temp.is_err(pg_temp.q_as(v_clin, format($q$select public.remove_caregiver_from_consultation(%L, 'Ada is rude')::text$q$, v_pass)), 'caregiver_remove_reason_invalid'));
  perform pg_temp.ck('the assigned clinician removes', 'true', pg_temp.q_as(v_clin, format($q$select public.remove_caregiver_from_consultation(%L, 'privacy')::text$q$, v_pass)));
  j := pg_temp.q_as(v_clin, format($q$select public.consultation_caregivers(%L)::text$q$, v_eA))::jsonb;
  perform pg_temp.ck('...the clinician still sees the removal on the call (with nothing left to remove)', 'removed|false',
    (j -> 'passes' -> 0 ->> 'state') || '|' || (j -> 'passes' -> 0 ->> 'removable'));
  j := pg_temp.q_as(v_pat, format($q$select public.consultation_caregivers(%L)::text$q$, v_eA))::jsonb;
  perform pg_temp.ck('...and so does the patient', 'removed', (j -> 'passes' -> 0 ->> 'state'));
  perform pg_temp.ck('...the pass is removed, by the clinician', 'removed|true',
    (select state || '|' || (removed_by = v_clin)::text from public.encounter_caregiver_passes where id = v_pass));
  perform pg_temp.ck('...the removal is an event with the pass id and a code', 'true',
    (select (count(*) = 1 and bool_and(payload = jsonb_build_object('pass_id', v_pass, 'reason_code', 'privacy')) and bool_and(actor_role = 'clinician' and actor_id = v_clin))::text
       from public.encounter_events where encounter_id = v_eA and kind = 'caregiver_removed'));
  perform pg_temp.ck('removing again is quiet and writes no second event', 'true|1',
    pg_temp.q_as(v_clin, format($q$select public.remove_caregiver_from_consultation(%L)::text$q$, v_pass)) || '|' || pg_temp.nev(v_eA, 'caregiver_removed')::text);
  perform pg_temp.ck('no credential after removal', 'null', coalesce(pg_temp.cred(v_eA, v_s1), 'null'));
  perform pg_temp.ck('a join after removal is refused as removed (and not recorded)', 'refused_removed',
    pg_temp.svc(format($q$select public.service_record_caregiver_event(%L, 'caregiver_joined', 'video')$q$, v_pass)));
  perform pg_temp.ck('...only the earlier joins are on the log', '2', pg_temp.nev(v_eA, 'caregiver_joined')::text);
  perform pg_temp.ck('leaving after a removal is still recorded', 'recorded', pg_temp.svc(format($q$select public.service_record_caregiver_event(%L, 'caregiver_left', null)$q$, v_pass)));
  perform pg_temp.ck('the removed caregiver cannot be re-invited to this call', 'true', pg_temp.is_err(pg_temp.invite(v_pat, v_eA, v_m1), 'caregiver_invite_removed_for_this_call'));
  perform pg_temp.ck('the removed caregiver cannot answer an old invite', 'true',
    pg_temp.is_err(pg_temp.q_as(v_s1, format($q$select public.respond_caregiver_consultation_invite(%L, true)::text$q$, v_pass)), 'caregiver_invite_unavailable'));
  perform pg_temp.ck('the removed caregiver''s invite list no longer shows the call', 'true',
    (pg_temp.q_as(v_s1, 'select public.my_consultation_invites()::text')::jsonb @> '[{"encounter_id":"x"}]'::jsonb = false
     and not (pg_temp.q_as(v_s1, 'select public.my_consultation_invites()::text') like '%' || v_eA::text || '%'))::text);
  perform pg_temp.ck('...but they can still be invited to a DIFFERENT call', 'true', (pg_temp.invite(v_pat, v_eS, v_m1) not like 'ERR:%')::text);
  perform pg_temp.ck('after the removal the cap has room again on the same call', 'true', (pg_temp.invite(v_pat, v_eA, v_m7) not like 'ERR:%')::text);

  -- ===== 4b. the credential dies with the call, the member, a pause
  r := pg_temp.invite(v_pat, v_eD, v_m1);
  v_pass := pg_temp.pass_of(v_eD, v_s1);
  perform pg_temp.q_as(v_s1, format($q$select public.respond_caregiver_consultation_invite(%L, true)::text$q$, v_pass));
  perform pg_temp.ck('a second call: the credential exists once accepted', 'true', (pg_temp.cred(v_eD, v_s1)::jsonb ->> 'pass_id' = v_pass::text)::text);
  update public.encounters set status = 'completed' where id = v_eD;
  perform pg_temp.ck('when the call ends the credential is gone', 'null', coalesce(pg_temp.cred(v_eD, v_s1), 'null'));
  perform pg_temp.ck('...a join is refused', 'refused', pg_temp.svc(format($q$select public.service_record_caregiver_event(%L, 'caregiver_joined', 'video')$q$, v_pass)));
  perform pg_temp.ck('...and the invite is off the list', 'false', (pg_temp.q_as(v_s1, 'select public.my_consultation_invites()::text') like '%' || v_eD::text || '%')::text);

  -- member revoked after accepting (on the call that still has the Sister invite from above: use a fresh call)
  v_pass := pg_temp.pass_of(v_eS, v_s1);
  perform pg_temp.q_as(v_s1, format($q$select public.respond_caregiver_consultation_invite(%L, true)::text$q$, v_pass));
  perform pg_temp.ck('a third call: the credential exists once accepted', 'true', (pg_temp.cred(v_eS, v_s1)::jsonb ->> 'pass_id' = v_pass::text)::text);
  insert into public.care_circle_pauses (patient_id, organisation_id, paused_until, is_test) values (v_pat, v_org, now() + interval '3 days', true);
  perform pg_temp.ck('a paused circle ends the credential at once', 'null', coalesce(pg_temp.cred(v_eS, v_s1), 'null'));
  delete from public.care_circle_pauses where patient_id = v_pat;
  perform pg_temp.ck('...and it returns when the pause ends', 'true', (pg_temp.cred(v_eS, v_s1)::jsonb ->> 'pass_id' = v_pass::text)::text);
  update public.care_circle_members set state = 'revoked', revoked_at = now() where id = v_m1;
  perform pg_temp.ck('a revoked circle member loses the credential on the very next call', 'null', coalesce(pg_temp.cred(v_eS, v_s1), 'null'));
  update public.care_circle_members set state = 'active', revoked_at = null where id = v_m1;
  update public.care_circle_members set permissions = array['appointments'] where id = v_m1;
  perform pg_temp.ck('...and so does taking the permission away', 'null', coalesce(pg_temp.cred(v_eS, v_s1), 'null'));
  update public.care_circle_members set permissions = array['attend_consultation', 'appointments'] where id = v_m1;
  perform pg_temp.ck('...and it returns when the member holds it again (nothing is cached)', 'true', (pg_temp.cred(v_eS, v_s1)::jsonb ->> 'pass_id' = v_pass::text)::text);
  update public.encounter_caregiver_passes set expires_at = now() - interval '1 minute' where id = v_pass;
  perform pg_temp.ck('an accepted pass past its own expiry gives no credential', 'null', coalesce(pg_temp.cred(v_eS, v_s1), 'null'));

  -- ===== 4c. an invite that runs out of time, and a call that runs past its window
  perform pg_temp.ck('an unanswered invite can still be answered while in date', 'true', (pg_temp.q_as(v_s7, 'select public.my_consultation_invites()::text') like '%' || v_eP::text || '%')::text);
  update public.encounter_caregiver_passes set expires_at = now() - interval '1 minute' where id = pg_temp.pass_of(v_eP, v_s7);
  perform pg_temp.ck('an unanswered invite past its time is off the list and cannot be answered', 'true',
    ((pg_temp.q_as(v_s7, 'select public.my_consultation_invites()::text') not like '%' || v_eP::text || '%')
     and pg_temp.is_err(pg_temp.q_as(v_s7, format($q$select public.respond_caregiver_consultation_invite(%L, true)::text$q$, pg_temp.pass_of(v_eP, v_s7))), 'caregiver_invite_unavailable') = 'true')::text);
  j := pg_temp.q_as(v_pat, format($q$select public.consultation_caregivers(%L)::text$q$, v_eP))::jsonb;
  perform pg_temp.ck('...the patient is not shown it as still waiting, and its place is free again', 'true',
    ((j -> 'passes') = '[]'::jsonb and exists (select 1 from jsonb_array_elements(j -> 'invitable') x where x ->> 'relationship' = 'Sister'))::text);
  perform pg_temp.ck('...a different person can take the place (the cap counts only invites in force)', 'true', (pg_temp.invite(v_pat, v_eP, v_m9) not like 'ERR:%')::text);
  perform pg_temp.ck('...while that place is taken, the cap still holds for the person whose invite ran out', 'true',
    (pg_temp.invite(v_pat, v_eP, v_m7) like 'ERR:%caregiver_invite_call_full%')::text);
  update public.encounter_caregiver_passes set state = 'cancelled' where id = pg_temp.pass_of(v_eP, v_s9);
  r := pg_temp.invite(v_pat, v_eP, v_m7);
  select count(*) into n from public.encounter_events where encounter_id = v_eP and kind = 'caregiver_invite_cancelled' and payload ->> 'reason_code' = 'expired' and actor_role = 'system';
  perform pg_temp.ck('...once there is room, the stale invite of the same person is cleared (logged as expired) and a new one made', 'true|1',
    (r not like 'ERR:%')::text || '|' || n::text);

  -- a call that runs past its join window keeps its guest; one that is not in progress does not
  v_eX := pg_temp.mkenc(v_org, v_pat, v_clin, now() - interval '90 minutes', 'in_progress');
  insert into public.encounter_caregiver_passes (organisation_id, encounter_id, patient_id, caregiver_id, circle_member_id, relationship, state, expires_at, accepted_at, config_version, is_test)
  values (v_org, v_eX, v_pat, v_s1, v_m1, 'Daughter', 'accepted', now() - interval '30 minutes', now() - interval '80 minutes', 1, true);
  perform pg_temp.ck('a call running past its window still lists its guest (so the page does not drop them mid-call)', 'true',
    (pg_temp.q_as(v_s1, 'select public.my_consultation_invites()::text') like '%' || v_eX::text || '%')::text);
  perform pg_temp.ck('...but a new entry through the closed window is refused', 'null', coalesce(pg_temp.cred(v_eX, v_s1), 'null'));
  update public.encounters set status = 'scheduled' where id = v_eX;
  perform pg_temp.ck('...and once the call is not in progress and its window is closed the guest is off the list', 'false',
    (pg_temp.q_as(v_s1, 'select public.my_consultation_invites()::text') like '%' || v_eX::text || '%')::text);

  -- ===== 7. events are append-only, ids and codes only
  perform pg_temp.ck('encounter events cannot be updated, even by the table owner', '23514', pg_temp.try($q$update public.encounter_events set kind = 'left' where kind like 'caregiver_%'$q$));
  perform pg_temp.ck('encounter events cannot be removed, even by the table owner', '23514', pg_temp.try($q$delete from public.encounter_events where kind like 'caregiver_%'$q$));
  perform pg_temp.ck('every caregiver event holds only a pass id, a mode or a reason code', 'true',
    (select (count(*) > 0 and bool_and((select bool_and(k in ('pass_id', 'mode', 'reason_code')) from jsonb_object_keys(payload) k)))::text
       from public.encounter_events where kind like 'caregiver_%'));
  perform pg_temp.ck('no caregiver event carries a name', 'true',
    (select (count(*) > 0 and bool_and(payload::text !~* 'surname|cgj'))::text from public.encounter_events where kind like 'caregiver_%'));

  -- ===== 8. privileges
  perform pg_temp.ck('anon cannot execute the invite', '42501', pg_temp.try_anon(format($q$select public.invite_caregiver_to_consultation(%L, %L)$q$, v_eA, v_m1)));
  perform pg_temp.ck('anon cannot execute the clinician view', '42501', pg_temp.try_anon(format($q$select public.consultation_caregivers(%L)$q$, v_eA)));
  perform pg_temp.ck('anon cannot execute the server-only credential', '42501', pg_temp.try_anon(format($q$select public.service_get_caregiver_pass(%L, %L)$q$, v_eA, v_s1)));
  perform pg_temp.ck('anon cannot read the pass table', '42501', pg_temp.try_anon('select 1 from public.encounter_caregiver_passes'));
  perform pg_temp.ck('signed-in users cannot execute the presence recorder', 'false', has_function_privilege('authenticated', 'public.service_record_caregiver_event(uuid,text,text)', 'EXECUTE')::text);
  perform pg_temp.ck('signed-in users cannot list pass ids', 'false', has_function_privilege('authenticated', 'public.service_caregiver_pass_ids(uuid)', 'EXECUTE')::text);
  perform pg_temp.ck('service_role can', 'true', has_function_privilege('service_role', 'public.service_caregiver_pass_ids(uuid)', 'EXECUTE')::text);
  perform pg_temp.ck('the pass ids of a call are all there (any state)', 'true',
    (select cardinality(public.service_caregiver_pass_ids(v_eA)) >= 2)::text);
  perform pg_temp.ck('signed-in users have no write on the pass table', 'false',
    (has_table_privilege('authenticated', 'public.encounter_caregiver_passes', 'INSERT') or has_table_privilege('authenticated', 'public.encounter_caregiver_passes', 'UPDATE') or has_table_privilege('authenticated', 'public.encounter_caregiver_passes', 'DELETE'))::text);
end $$;

-- ===========================================================================================================================
-- SABOTAGE: each gate removed in turn; the matching check must flip. Fresh fixtures, so earlier steps cannot mask it.
-- ===========================================================================================================================
do $$
declare
  v_org uuid; v_pat uuid; v_clin uuid; v_s uuid; v_stranger uuid; v_nm uuid;
  v_m uuid; v_mn uuid; v_e uuid; v_e2 uuid; v_e3 uuid; v_pass uuid;
  d text; r text;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  v_pat := pg_temp.mkuser(v_org, 'sab-patient', 'patient');
  v_clin := pg_temp.mkuser(v_org, 'sab-clin', 'clinician');
  v_s := pg_temp.mkuser(v_org, 'sab-sup', 'patient');
  v_nm := pg_temp.mkuser(v_org, 'sab-nopermission', 'patient');
  v_stranger := pg_temp.mkuser(v_org, 'sab-stranger', 'patient');
  v_m := pg_temp.mkmember(v_org, v_pat, v_s, 'Daughter', array['attend_consultation']);
  v_mn := pg_temp.mkmember(v_org, v_pat, v_nm, 'Son', array['appointments']);
  v_e := pg_temp.mkenc(v_org, v_pat, v_clin, now() + interval '5 minutes');
  v_e2 := pg_temp.mkenc(v_org, v_pat, v_clin, now() + interval '5 minutes');
  v_e3 := pg_temp.mkenc(v_org, v_pat, v_clin, now() + interval '5 minutes');

  -- (a) the permission test removed from the member gate
  select pg_get_functiondef('private.caregiver_member_ok(uuid, uuid, uuid)'::regprocedure) into d;
  d := replace(d, '''attend_consultation'' = any (m.permissions)', 'true');
  if d = pg_get_functiondef('private.caregiver_member_ok(uuid, uuid, uuid)'::regprocedure) then raise exception 'sabotage (a) did not change the function'; end if;
  execute d;
  r := pg_temp.invite(v_pat, v_e, v_mn);
  insert into results values ('sabotaged', 'a member without the permission is refused', 'true', (r like 'ERR:%caregiver_invite_not_permitted%')::text);

  -- (b) the live-call test removed from the pass gate
  r := pg_temp.invite(v_pat, v_e2, v_m);
  v_pass := pg_temp.pass_of(v_e2, v_s);
  perform pg_temp.q_as(v_s, format($q$select public.respond_caregiver_consultation_invite(%L, true)::text$q$, v_pass));
  update public.encounters set status = 'completed' where id = v_e2;
  select pg_get_functiondef('private.caregiver_pass_usable(uuid, text[], boolean)'::regprocedure) into d;
  d := replace(d, 'e.status not in (''scheduled'', ''waiting'', ''in_progress'')', 'false');
  if d = pg_get_functiondef('private.caregiver_pass_usable(uuid, text[], boolean)'::regprocedure) then raise exception 'sabotage (b) did not change the function'; end if;
  execute d;
  insert into results values ('sabotaged', 'the credential dies with the call', 'null', coalesce(pg_temp.cred(v_e2, v_s), 'null'));

  -- (c) the clinician-only test removed from the removal
  r := pg_temp.invite(v_pat, v_e3, v_m);
  v_pass := pg_temp.pass_of(v_e3, v_s);
  select pg_get_functiondef('public.remove_caregiver_from_consultation(uuid, text)'::regprocedure) into d;
  d := replace(d, 'e.clinician_id is distinct from v_uid', 'false');
  if d = pg_get_functiondef('public.remove_caregiver_from_consultation(uuid, text)'::regprocedure) then raise exception 'sabotage (c) did not change the function'; end if;
  execute d;
  r := pg_temp.q_as(v_pat, format($q$select public.remove_caregiver_from_consultation(%L)::text$q$, v_pass));
  insert into results values ('sabotaged', 'only the assigned clinician can remove', 'true', (r like 'ERR:%caregiver_remove_not_allowed%')::text);

  -- (d) the inviter test removed
  select pg_get_functiondef('private.caregiver_invite_actor_ok(uuid)'::regprocedure) into d;
  d := replace(d, 'select (select auth.uid()) is not null and (', 'select true or (');
  if d = pg_get_functiondef('private.caregiver_invite_actor_ok(uuid)'::regprocedure) then raise exception 'sabotage (d) did not change the function'; end if;
  execute d;
  delete from public.encounter_caregiver_passes where encounter_id = v_e;
  r := pg_temp.invite(v_stranger, v_e, v_m);
  insert into results values ('sabotaged', 'a stranger cannot invite', 'true', (r like 'ERR:%caregiver_invite_not_allowed%')::text);

  -- (e) a server-only function granted to signed-in users
  grant execute on function public.service_get_caregiver_pass(uuid, uuid) to authenticated;
  insert into results values ('sabotaged', 'a signed-in user cannot call the credential check', 'false', has_function_privilege('authenticated', 'public.service_get_caregiver_pass(uuid,uuid)', 'EXECUTE')::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'CGJ proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 5 then raise exception 'VACUOUS TEST: the sabotage flipped % of 5 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

-- the sabotaged runs: each must read FLIPPED (the check no longer holds once its gate is removed)
select phase, check_name, expected, actual, case when expected <> actual then 'FLIPPED (good)' else 'DID NOT FLIP' end as result
from results where phase = 'sabotaged' order by check_name;

rollback;
