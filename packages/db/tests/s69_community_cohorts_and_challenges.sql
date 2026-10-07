-- S69 proof: private cohorts, effort challenges, cohort totals and the cohort board (migrations *_s69_community_cohorts_and_challenges.sql and
-- *_s69b_go_live_guard_and_wellness_nudge.sql). One rolled-back transaction. Proves:
--   1.  Nothing is switched on by the migration: both platform modules off, no template approved, the guard off; a real patient is refused while
--       closed, and a test account passes (and can only ever be in a test cohort).
--   2.  The go-live guard (INV-14): cannot be switched on until a CMO-signed template, a recorded DPIA and counsel's confirmation exist; then it opens.
--   3.  Cohort names are generic (a condition-themed name is refused); invites are hashed, single use, expiring, identical on every failure.
--   4.  Consent: joining needs an explicit yes; contributing needs a second yes; withdrawing, leaving, removal and "community off" each erase the
--       member's own effort rows.
--   5.  The member list shows first names only; a moderator reads no health data and no other member's effort row; a non-member, an employer,
--       a sponsor, an unrelated clinician and anon read nothing; an admin sees cohort rows and nothing about members.
--   6.  The effort-only rule (insulin, pregnancy, kidney disease, eating disorder): a neutral "not available", identical to a non-member's answer.
--   7.  Totals: floor of 10 contributors, leave-one-out (a dominant contributor hides the total), rounding, publish delay, no member id anywhere.
--   8.  Individual values never appear in any challenge view (closed key set; a distinctive value and every member id are searched for).
--   9.  The board compares cohorts only (anonymous labels, needs 3 cohorts, no member rank).
--   10. One generic notice ("community_update", empty payload), once, never to a muted member or someone with community off; events carry ids only.
--   11. Moderation: report-and-remove, moderator close, admin freeze, global switch; group sessions are dormant and cannot record or scribe.
--   12. The solo wellness challenge nudge no longer carries a title or progress figure.
--   13. SABOTAGE: the floor, leave-one-out, the effort-only rule, the individual-value guard, the participation RLS and the notice payload are each
--       broken in turn; every one of the six checks must flip.
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
create function pg_temp.sab(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- run a statement as a user, return its first column as text ('ERR:<state>' on an error)
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate || ':' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.j(p_uid uuid, p_sql text) returns jsonb language plpgsql as
$f$ declare r text; begin r := pg_temp.q_as(p_uid, p_sql); if r like 'ERR:%' then return jsonb_build_object('error', r); end if; return r::jsonb; end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role anon;
  begin execute p_sql into r; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's69-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'Name' || replace(p_label, '_', '') || ' Surname', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  return v;
end $f$;
-- a patient who belongs to a cohort: invite as the moderator, join with consent, give the totals consent
create function pg_temp.enrol(p_org uuid, p_cohort uuid, p_mod uuid, p_label text, p_totals boolean default true) returns uuid language plpgsql as
$f$ declare v uuid; t text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'patient');
  t := pg_temp.q_as(p_mod, format('select (public.community_create_invite(%L::uuid) ->> %L)', p_cohort, 'token'));
  perform pg_temp.q_as(v, format('select public.community_join(%L, true)::text', t));
  if p_totals then perform pg_temp.q_as(v, format('select public.community_set_totals_consent(%L::uuid, true)::text', p_cohort)); end if;
  return v;
end $f$;
-- proof-only clock: make every snapshot published (the delay is real; this only skips waiting for it)
create function pg_temp.publish_all() returns void language plpgsql as
$f$ begin
  alter table public.challenge_totals disable trigger challenge_totals_append_only;
  update public.challenge_totals set published_after = as_of - interval '1 minute';
  alter table public.challenge_totals enable trigger challenge_totals_append_only;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_doc uuid; v_emp uuid; v_spo uuid; v_out uuid; v_real uuid;
  v_ma uuid; v_mb uuid; v_mc uuid; v_md uuid; v_me uuid;
  v_ca uuid; v_cb uuid; v_cc uuid; v_cd uuid; v_ce uuid;
  v_chA uuid; v_chB uuid; v_chC uuid; v_chD uuid; v_chLog uuid; v_chSalt uuid;
  v_u uuid; v_i integer; r jsonb; t text; v_n integer; v_tok text; v_tok2 text;
  v_ins uuid; v_preg uuid; v_ckd uuid; v_ed uuid; v_first uuid; v_mute uuid; v_off uuid; v_leaver uuid; v_wd uuid; v_bad uuid; v_reported uuid;
  v_member_row uuid; v_all text; v_keys text; v_a_members uuid[] := '{}'; v_b_members uuid[] := '{}'; v_c_members uuid[] := '{}'; v_d_members uuid[] := '{}';
  v_event uuid; v_notif integer; v_notif2 integer; v_org2 uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician');
  v_emp := pg_temp.mkuser(v_org, 'emp', 'corporate_admin');
  v_spo := pg_temp.mkuser(v_org, 'spo', 'hmo_admin');
  v_out := pg_temp.mkuser(v_org, 'outsider', 'patient');
  v_real := pg_temp.mkuser(v_org, 'real', 'patient');
  update public.profiles set is_test = false where id = v_real;

  -- the CMO (an active chief_medical_officer clinical_staff row)
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by,
      doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_cmo, 'S69 cmo', 'MDCN', 'S69-cmo-' || substr(v_cmo::text, 1, 8), true, 'active', now(), v_admin,
      'chief_medical_officer', 'contracted', 2, true, v_admin, true);

  ---------------------------------------------------------------------------------------------------------------- 1. closed by default
  perform pg_temp.ck('1 module community_cohorts is off', 'false', (select is_enabled::text from public.platform_modules where key = 'community_cohorts'));
  perform pg_temp.ck('1 module group_sessions is off', 'false', (select is_enabled::text from public.platform_modules where key = 'group_sessions'));
  perform pg_temp.ck('1 the migration approved no template', '0', (select count(*)::text from public.challenge_templates where status <> 'proposed'));
  perform pg_temp.ck('1 seven templates are seeded', '7', (select count(*)::text from public.challenge_templates));
  perform pg_temp.ck('1 the go-live guard exists and is off', 'false', (select is_on::text from public.go_live_guards where key = 'community_cohorts_enabled'));
  perform pg_temp.ck('1 a real patient is refused while closed (create)', 'ERR:P0001:community_closed',
    pg_temp.q_as(v_real, $q$select public.community_create('Grace Fellowship', 'church', true)::text$q$));
  perform pg_temp.ck('1 a real patient sees open=false', 'false', pg_temp.q_as(v_real, $q$select (public.community_status() ->> 'open')$q$));
  perform pg_temp.ck('1 a test account is open', 'true', pg_temp.q_as(v_out, $q$select (public.community_status() ->> 'open')$q$));
  perform pg_temp.ck('1 anon cannot call a community function', '42501', pg_temp.try_anon($q$select public.community_my_cohorts()$q$));
  perform pg_temp.ck('1 anon cannot read cohort members', '42501', pg_temp.try_anon($q$select count(*) from public.cohort_members$q$));
  perform pg_temp.ck('1 anon cannot read totals', '42501', pg_temp.try_anon($q$select count(*) from public.challenge_totals$q$));

  ---------------------------------------------------------------------------------------------------------------- 2. the guard
  perform pg_temp.ck('2 the guard has four conditions', '4', jsonb_array_length(private.go_live_conditions('community_cohorts_enabled', v_org))::text);
  perform pg_temp.act(v_admin);
  begin perform public.set_go_live_guard('community_cohorts_enabled', true, 'switching on for the proof'); t := 'on';
  exception when others then t := 'refused'; end;
  perform pg_temp.back();
  perform pg_temp.ck('2 the guard cannot be switched on with nothing signed or attested', 'refused', t);
  perform pg_temp.ck('2 a CMO-only signature: an admin cannot sign a template', 'ERR:42501:only the Chief Medical Officer can sign a challenge template',
    pg_temp.q_as(v_admin, $q$select public.sign_challenge_template('move_together', true, 'reviewed in the proof')::text$q$));
  perform pg_temp.ck('2 a patient cannot attest the DPIA', 'ERR:42501',
    substr(pg_temp.q_as(v_out, $q$select public.attest_go_live_condition('community_cohorts_enabled', 'dpia_recorded', true, 'a DPIA exists')::text$q$), 1, 9));

  -- the CMO signs the templates the proof uses (a simulated signature inside this rolled-back transaction, never a real one)
  foreach t in array array['move_together', 'low_salt_days', 'log_days'] loop
    perform pg_temp.q_as(v_cmo, format('select public.sign_challenge_template(%L, true, %L)::text', t, 'reviewed in the proof only'));
  end loop;
  perform pg_temp.ck('2 three templates are now approved', '3', (select count(*)::text from public.challenge_templates where status = 'approved'));
  perform pg_temp.ck('2 the template condition is met after signing', 'true',
    (select (c ->> 'met') from jsonb_array_elements(private.go_live_conditions('community_cohorts_enabled', v_org)) c where c ->> 'code' = 'challenge_templates_approved'));
  perform pg_temp.act(v_admin);
  begin perform public.set_go_live_guard('community_cohorts_enabled', true, 'switching on for the proof'); t := 'on'; exception when others then t := 'refused'; end;
  perform pg_temp.back();
  perform pg_temp.ck('2 still refused: the DPIA and counsel are not recorded', 'refused', t);
  perform pg_temp.q_as(v_admin, $q$select public.attest_go_live_condition('community_cohorts_enabled', 'dpia_recorded', true, 'DPIA v1 recorded by the founder for the proof')::text$q$);
  perform pg_temp.q_as(v_admin, $q$select public.attest_go_live_condition('community_cohorts_enabled', 'counsel_ndpa_confirmed', true, 'Counsel letter confirmed for the proof')::text$q$);
  -- module on, guard still off: a real patient stays closed
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_admin, activation_note = 'proof' where key = 'community_cohorts';
  perform pg_temp.ck('2 module on but guard off: a real patient is still closed', 'false', pg_temp.q_as(v_real, $q$select (public.community_status() ->> 'open')$q$));
  perform pg_temp.act(v_admin);
  begin perform public.set_go_live_guard('community_cohorts_enabled', true, 'switching on for the proof'); t := 'on'; exception when others then t := 'refused:' || sqlerrm; end;
  perform pg_temp.back();
  perform pg_temp.ck('2 with all conditions met an admin can switch the guard on', 'on', t);
  perform pg_temp.ck('2 now a real patient is open', 'true', pg_temp.q_as(v_real, $q$select (public.community_status() ->> 'open')$q$));

  ---------------------------------------------------------------------------------------------------------------- 3. names, invites
  perform pg_temp.ck('3 no consent, no cohort', 'ERR:P0001:consent_required', pg_temp.q_as(v_out, $q$select public.community_create('Peace Estate Group', 'estate', false)::text$q$));
  perform pg_temp.ck('3 a condition-themed name is refused (diabetes)', 'ERR:22023:cohort_name_not_allowed', pg_temp.q_as(v_out, $q$select public.community_create('Diabetes Warriors', 'church', true)::text$q$));
  perform pg_temp.ck('3 a condition-themed name is refused (blood pressure)', 'ERR:22023:cohort_name_not_allowed', pg_temp.q_as(v_out, $q$select public.community_create('Blood Pressure Club', 'union', true)::text$q$));
  perform pg_temp.ck('3 a weight-themed name is refused', 'ERR:22023:cohort_name_not_allowed', pg_temp.q_as(v_out, $q$select public.community_create('Weight Loss Crew', 'estate', true)::text$q$));
  perform pg_temp.ck('3 a bad kind is refused', 'ERR:22023:cohort_kind_invalid', pg_temp.q_as(v_out, $q$select public.community_create('Peace Estate Group', 'club', true)::text$q$));
  begin
    insert into public.community_cohorts (organisation_id, name, kind, created_by, is_test) values (v_org, 'Cancer Support', 'church', v_out, true);
    t := 'inserted';
  exception when sqlstate '22023' then t := 'refused'; end;
  perform pg_temp.ck('3 the trigger also refuses a condition name written around the function', 'refused', t);

  v_ma := pg_temp.mkuser(v_org, 'modA', 'patient'); v_mb := pg_temp.mkuser(v_org, 'modB', 'patient');
  v_mc := pg_temp.mkuser(v_org, 'modC', 'patient'); v_md := pg_temp.mkuser(v_org, 'modD', 'patient'); v_me := pg_temp.mkuser(v_org, 'modE', 'patient');
  v_ca := (pg_temp.j(v_ma, $q$select public.community_create('Grace Fellowship Group', 'church', true)::text$q$) ->> 'cohort_id')::uuid;
  v_cb := (pg_temp.j(v_mb, $q$select public.community_create('Peace Estate Residents', 'estate', true)::text$q$) ->> 'cohort_id')::uuid;
  v_cc := (pg_temp.j(v_mc, $q$select public.community_create('Unity Union Branch', 'union', true)::text$q$) ->> 'cohort_id')::uuid;
  v_cd := (pg_temp.j(v_md, $q$select public.community_create('Harmony Mosque Circle', 'mosque', true)::text$q$) ->> 'cohort_id')::uuid;
  v_ce := (pg_temp.j(v_me, $q$select public.community_create('Lagos Office Walkers', 'workplace', true)::text$q$) ->> 'cohort_id')::uuid;
  perform pg_temp.ck('3 five cohorts exist', '5', (select count(*)::text from public.community_cohorts where created_by in (v_ma, v_mb, v_mc, v_md, v_me)));
  perform pg_temp.ck('3 a cohort made by a test account is a test cohort', 'true', (select is_test::text from public.community_cohorts where id = v_ca));
  perform pg_temp.ck('3 the creator is the moderator and has not consented to totals', 'moderator|false',
    (select role || '|' || (consent_totals_at is not null)::text from public.cohort_members where cohort_id = v_ca and patient_id = v_ma));
  v_u := pg_temp.mkuser(v_org, 'serial', 'patient');
  perform pg_temp.j(v_u, $q$select public.community_create('Alpha Group One', 'church', true)::text$q$);
  perform pg_temp.j(v_u, $q$select public.community_create('Alpha Group Two', 'church', true)::text$q$);
  perform pg_temp.j(v_u, $q$select public.community_create('Alpha Group Three', 'church', true)::text$q$);
  perform pg_temp.ck('3 a fourth cohort by the same person is refused', 'ERR:P0001:too_many_cohorts', pg_temp.q_as(v_u, $q$select public.community_create('Alpha Group Four', 'church', true)::text$q$));

  -- invite: hash only, single use, expiring, identical failure
  v_tok := pg_temp.q_as(v_ma, format('select (public.community_create_invite(%L::uuid) ->> %L)', v_ca, 'token'));
  perform pg_temp.ck('3 the invite token is returned once', 'true', (length(v_tok) >= 40)::text);
  perform pg_temp.ck('3 only the hash is stored (the token itself is nowhere)', '0',
    (select count(*)::text from public.cohort_invites where token_hash = v_tok or token_hash = encode(convert_to(v_tok, 'UTF8'), 'hex')));
  perform pg_temp.ck('3 the stored hash is the SHA-256 of the token', '1', (select count(*)::text from public.cohort_invites where token_hash = private.circle_hash(v_tok)));
  v_first := pg_temp.mkuser(v_org, 'firstjoin', 'patient');
  perform pg_temp.ck('3 preview shows the name and kind only', 'Grace Fellowship Group|church',
    pg_temp.q_as(v_first, format('select (public.community_preview_invite(%L) ->> %L) || %L || (public.community_preview_invite(%L) ->> %L)', v_tok, 'name', '|', v_tok, 'kind')));
  perform pg_temp.ck('3 a plain member cannot make an invite', 'ERR:42501', substr(pg_temp.q_as(v_out, format('select public.community_create_invite(%L::uuid)::text', v_ca)), 1, 9));
  perform pg_temp.ck('3 joining without the yes is refused (identical failure)', '{"ok": false}', pg_temp.q_as(v_first, format('select public.community_join(%L, false)::text', v_tok)));
  perform pg_temp.ck('3 joining with the yes works', 'true', pg_temp.q_as(v_first, format('select (public.community_join(%L, true) ->> %L)', v_tok, 'ok')));
  perform pg_temp.ck('3 a used token fails the same way a bad one does', '{"ok": false}|{"ok": false}',
    pg_temp.q_as(v_out, format('select public.community_join(%L, true)::text', v_tok)) || '|' || pg_temp.q_as(v_out, $q$select public.community_join('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', true)::text$q$));
  perform pg_temp.ck('3 joining records two separate consents: join yes, totals not yet', 'true|false',
    (select (consent_join_at is not null)::text || '|' || (consent_totals_at is not null)::text from public.cohort_members where cohort_id = v_ca and patient_id = v_first));
  v_tok2 := pg_temp.q_as(v_ma, format('select (public.community_create_invite(%L::uuid) ->> %L)', v_ca, 'token'));
  update public.cohort_invites set expires_at = now() - interval '1 minute' where token_hash = private.circle_hash(v_tok2);
  perform pg_temp.ck('3 an expired token fails the same way', '{"ok": false}', pg_temp.q_as(v_out, format('select public.community_join(%L, true)::text', v_tok2)));
  v_tok2 := pg_temp.q_as(v_ma, format('select (public.community_create_invite(%L::uuid) ->> %L)', v_ca, 'token'));
  perform pg_temp.ck('3 someone already in the cohort cannot use a second token, and it is not spent', '{"ok": false}', pg_temp.q_as(v_first, format('select public.community_join(%L, true)::text', v_tok2)));
  perform pg_temp.ck('3 ...the token is still pending', '1', (select count(*)::text from public.cohort_invites where token_hash = private.circle_hash(v_tok2) and state = 'pending'));
  perform pg_temp.ck('3 a real person cannot use a test cohort token', '{"ok": false}', pg_temp.q_as(v_real, format('select public.community_join(%L, true)::text', v_tok2)));

  ---------------------------------------------------------------------------------------------------------------- build the cohorts
  -- A: moderator + first + 10 more = 12 contributors later, plus 4 restricted and 1 muted, 1 community-off, 1 leaver
  perform pg_temp.q_as(v_first, format('select public.community_set_totals_consent(%L::uuid, true)::text', v_ca));
  perform pg_temp.q_as(v_ma, format('select public.community_set_totals_consent(%L::uuid, true)::text', v_ca));
  v_a_members := array[v_ma, v_first];
  for v_i in 1..10 loop v_a_members := v_a_members || pg_temp.enrol(v_org, v_ca, v_ma, 'a' || v_i); end loop;
  perform pg_temp.q_as(v_mb, format('select public.community_set_totals_consent(%L::uuid, true)::text', v_cb)); v_b_members := array[v_mb];
  for v_i in 1..9 loop v_b_members := v_b_members || pg_temp.enrol(v_org, v_cb, v_mb, 'b' || v_i); end loop;
  perform pg_temp.q_as(v_mc, format('select public.community_set_totals_consent(%L::uuid, true)::text', v_cc)); v_c_members := array[v_mc];
  for v_i in 1..9 loop v_c_members := v_c_members || pg_temp.enrol(v_org, v_cc, v_mc, 'c' || v_i); end loop;
  perform pg_temp.q_as(v_md, format('select public.community_set_totals_consent(%L::uuid, true)::text', v_cd)); v_d_members := array[v_md];
  for v_i in 1..10 loop v_d_members := v_d_members || pg_temp.enrol(v_org, v_cd, v_md, 'd' || v_i); end loop;
  perform pg_temp.ck('3 cohort sizes: A 12, B 10, C 10, D 11', '12|11|10|10',
    (select string_agg(n::text, '|' order by cohort_name) from (select c.name cohort_name, count(*) n from public.cohort_members m join public.community_cohorts c on c.id = m.cohort_id
      where m.state = 'active' and c.id in (v_ca, v_cb, v_cc, v_cd) group by c.name) z)::text);

  ---------------------------------------------------------------------------------------------------------------- 4/5. roster and visibility
  r := pg_temp.j(v_first, format('select public.community_roster(%L::uuid)::text', v_ca));
  perform pg_temp.ck('5 the roster has the right number of people', '12', jsonb_array_length(r)::text);
  perform pg_temp.ck('5 the roster keys are exactly member_id, first_name, role, is_you', 'first_name,is_you,member_id,role',
    (select string_agg(k, ',' order by k) from (select distinct jsonb_object_keys(e) k from jsonb_array_elements(r) e) z));
  perform pg_temp.ck('5 the roster carries no profile id, full name or phone', 'false',
    (r::text ~ (v_first::text || '|Surname|\+234'))::text);
  perform pg_temp.ck('5 a non-member gets an empty roster', '[]', pg_temp.q_as(v_out, format('select public.community_roster(%L::uuid)::text', v_ca)));
  perform pg_temp.ck('5 the moderator sees the same list, nothing more', jsonb_array_length(r)::text, jsonb_array_length(pg_temp.j(v_ma, format('select public.community_roster(%L::uuid)::text', v_ca)))::text);

  -- a health row a member owns: the moderator cannot read it
  insert into public.nutrition_log_entries (organisation_id, patient_id, logged_at, meal_type, description) values (v_org, v_first, now(), 'breakfast', 'rice and beans');
  perform pg_temp.ck('5 the moderator reads none of a member''s health rows', '0', pg_temp.q_as(v_ma, $q$select count(*)::text from public.nutrition_log_entries$q$));
  perform pg_temp.ck('5 the moderator reads only their own membership row', '1', pg_temp.q_as(v_ma, $q$select count(*)::text from public.cohort_members$q$));
  perform pg_temp.ck('5 the moderator cannot read invites, reports or group sessions', '42501|42501|42501',
    (select string_agg(x, '|') from (select split_part(pg_temp.q_as(v_ma, 'select count(*)::text from public.' || tn.tname), ':', 2) x from unnest(array['cohort_invites', 'community_reports', 'group_sessions']) as tn(tname)) z));

  ---------------------------------------------------------------------------------------------------------------- 6. templates and challenges
  perform pg_temp.ck('6 a template not yet signed cannot start a challenge', 'ERR:P0001:template_not_approved',
    pg_temp.q_as(v_ma, format('select public.community_start_challenge(%L::uuid, %L, current_date, 14)::text', v_ca, 'regular_sleep')));
  perform pg_temp.ck('6 only approved templates are listed', '3', jsonb_array_length(pg_temp.j(v_ma, $q$select public.list_challenge_templates()::text$q$))::text);
  perform pg_temp.ck('6 a plain member cannot start a challenge', 'ERR:42501', substr(pg_temp.q_as(v_first, format('select public.community_start_challenge(%L::uuid, %L, current_date, 14)::text', v_ca, 'move_together')), 1, 9));
  perform pg_temp.ck('6 dates out of range are refused', 'ERR:22023:challenge_dates_invalid', pg_temp.q_as(v_ma, format('select public.community_start_challenge(%L::uuid, %L, current_date, 3)::text', v_ca, 'move_together')));
  v_chA := (pg_temp.j(v_ma, format('select public.community_start_challenge(%L::uuid, %L, (now() at time zone %L)::date, 14)::text', v_ca, 'move_together', 'Africa/Lagos')) ->> 'challenge_id')::uuid;
  v_chB := (pg_temp.j(v_mb, format('select public.community_start_challenge(%L::uuid, %L, (now() at time zone %L)::date, 14)::text', v_cb, 'move_together', 'Africa/Lagos')) ->> 'challenge_id')::uuid;
  v_chC := (pg_temp.j(v_mc, format('select public.community_start_challenge(%L::uuid, %L, (now() at time zone %L)::date, 14)::text', v_cc, 'move_together', 'Africa/Lagos')) ->> 'challenge_id')::uuid;
  v_chD := (pg_temp.j(v_md, format('select public.community_start_challenge(%L::uuid, %L, (now() at time zone %L)::date, 14)::text', v_cd, 'move_together', 'Africa/Lagos')) ->> 'challenge_id')::uuid;
  v_chSalt := (pg_temp.j(v_ma, format('select public.community_start_challenge(%L::uuid, %L, (now() at time zone %L)::date, 14)::text', v_ca, 'low_salt_days', 'Africa/Lagos')) ->> 'challenge_id')::uuid;
  perform pg_temp.ck('6 a third running challenge in one cohort is refused', 'ERR:P0001:too_many_challenges',
    pg_temp.q_as(v_ma, format('select public.community_start_challenge(%L::uuid, %L, (now() at time zone %L)::date, 14)::text', v_ca, 'log_days', 'Africa/Lagos')));

  ---------------------------------------------------------------------------------------------------------------- 7. the effort-only rule
  v_ins := pg_temp.enrol(v_org, v_ca, v_ma, 'restrIns'); v_preg := pg_temp.enrol(v_org, v_ca, v_ma, 'restrPreg');
  v_ckd := pg_temp.enrol(v_org, v_ca, v_ma, 'restrCkd'); v_ed := pg_temp.enrol(v_org, v_ca, v_ma, 'restrEd');
  insert into public.medications (organisation_id, patient_id, drug_name, is_active) values (v_org, v_ins, 'Insulin glargine', true);
  insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant) values (v_org, v_preg, true);
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, status) values (v_org, v_ckd, 'Chronic kidney disease stage 3', 'active');
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, status) values (v_org, v_ed, 'Eating disorder, history of', 'active');
  perform pg_temp.ck('7 a non-member gets the neutral answer', '{"ok": false, "reason": "not_available"}',
    pg_temp.q_as(v_out, format('select public.contribute_to_challenge(%L::uuid, null, 60)::text', v_chA)));
  foreach v_u in array array[v_ins, v_preg, v_ckd, v_ed] loop
    perform pg_temp.ck('7 a restricted member gets exactly the neutral answer for an activity challenge', '{"ok": false, "reason": "not_available"}',
      pg_temp.q_as(v_u, format('select public.contribute_to_challenge(%L::uuid, null, 60)::text', v_chA)));
  end loop;
  perform pg_temp.ck('7 a restricted member is refused the self-report challenge too', '{"ok": false, "reason": "not_available"}',
    pg_temp.q_as(v_ins, format('select public.contribute_to_challenge(%L::uuid, null, null)::text', v_chSalt)));
  perform pg_temp.ck('7 the view says only available=false for them', 'false',
    (select (e ->> 'available') from jsonb_array_elements(pg_temp.j(v_ins, format('select public.community_challenges(%L::uuid)::text', v_ca))) e where e ->> 'challenge_id' = v_chA::text));
  perform pg_temp.ck('7 the view reveals no reason (no insulin, pregnancy, kidney, eating)', 'false',
    (pg_temp.j(v_ins, format('select public.community_challenges(%L::uuid)::text', v_ca))::text ~* 'insulin|pregnan|kidney|eating|condition|medic')::text);
  perform pg_temp.ck('7 an unrestricted member is available', 'true',
    (select (e ->> 'available') from jsonb_array_elements(pg_temp.j(v_first, format('select public.community_challenges(%L::uuid)::text', v_ca))) e where e ->> 'challenge_id' = v_chA::text));

  ---------------------------------------------------------------------------------------------------------------- 8. consent gates, contributions
  v_wd := pg_temp.enrol(v_org, v_ca, v_ma, 'noTotals', false);
  perform pg_temp.ck('8 contributing needs the second consent', '{"ok": false, "reason": "consent_needed"}', pg_temp.q_as(v_wd, format('select public.contribute_to_challenge(%L::uuid, null, 60)::text', v_chA)));
  perform pg_temp.ck('8 minutes out of range are refused', 'ERR:22023:minutes_invalid', pg_temp.q_as(v_first, format('select public.contribute_to_challenge(%L::uuid, null, 999)::text', v_chA)));
  -- A: the moderator gives 163, everyone else of the 12 gives 150 => 1813 of 1800 goal
  perform pg_temp.q_as(v_a_members[1], format('select public.contribute_to_challenge(%L::uuid, null, 163)::text', v_chA));
  for v_i in 2..12 loop perform pg_temp.q_as(v_a_members[v_i], format('select public.contribute_to_challenge(%L::uuid, null, 150)::text', v_chA)); end loop;
  -- B: 10 contributors at 75; C: only 9 at 30 (the tenth is missing: below the floor); D: 11 members, one dominant
  for v_i in 1..10 loop perform pg_temp.q_as(v_b_members[v_i], format('select public.contribute_to_challenge(%L::uuid, null, 75)::text', v_chB)); end loop;
  for v_i in 1..9 loop perform pg_temp.q_as(v_c_members[v_i], format('select public.contribute_to_challenge(%L::uuid, null, 30)::text', v_chC)); end loop;
  perform pg_temp.q_as(v_d_members[1], format('select public.contribute_to_challenge(%L::uuid, null, 180)::text', v_chD));
  for v_i in 2..11 loop perform pg_temp.q_as(v_d_members[v_i], format('select public.contribute_to_challenge(%L::uuid, null, 10)::text', v_chD)); end loop;
  -- a logged metric counts only what is really logged: one member with a meal logged today, one with nothing
  v_u := pg_temp.enrol(v_org, v_cc, v_mc, 'logger'); v_bad := pg_temp.enrol(v_org, v_cc, v_mc, 'nolog');
  insert into public.nutrition_log_entries (organisation_id, patient_id, logged_at, meal_type, description) values (v_org, v_u, now(), 'lunch', 'yam');
  v_chLog := (pg_temp.j(v_mc, format('select public.community_start_challenge(%L::uuid, %L, (now() at time zone %L)::date, 14)::text', v_cc, 'log_days', 'Africa/Lagos')) ->> 'challenge_id')::uuid;
  perform pg_temp.ck('8 a logged metric: a member with a log today is counted', 'true', pg_temp.q_as(v_u, format('select (public.contribute_to_challenge(%L::uuid) ->> %L)', v_chLog, 'counted')));
  perform pg_temp.ck('8 a logged metric: a member with nothing logged is told nothing was counted', 'false', pg_temp.q_as(v_bad, format('select (public.contribute_to_challenge(%L::uuid) ->> %L)', v_chLog, 'counted')));
  perform pg_temp.ck('8 the logged metric stores a day count of 1, never a value from the log', '1', (select string_agg(value::text, ',') from public.challenge_participation where challenge_id = v_chLog));
  perform private.log_audit('community.run_error', 'challenge', v_chLog, jsonb_build_object('stage', 'proof', 'sqlstate', 'XX000'));
  perform pg_temp.ck('8 a run error is written to the audit log (never swallowed)', '1', (select count(*)::text from public.audit_log where action = 'community.run_error' and entity_id = v_chLog));
  perform pg_temp.ck('8 effort rows hold a count only (A has 12)', '12', (select count(*)::text from public.challenge_participation where challenge_id = v_chA));
  perform pg_temp.ck('8 a member reads only their own effort row', '1', pg_temp.q_as(v_first, $q$select count(*)::text from public.challenge_participation$q$));
  perform pg_temp.ck('8 the moderator reads only their own effort row (never the others)', '1', pg_temp.q_as(v_ma, $q$select count(*)::text from public.challenge_participation$q$));
  perform pg_temp.q_as(v_b_members[1], format('select public.contribute_to_challenge(%L::uuid, null, 75)::text', v_chB));
  perform pg_temp.ck('8 a repeat the same day is still one row for that member', '1', (select count(*)::text from public.challenge_participation where challenge_id = v_chB and patient_id = v_b_members[1]));
  -- weekly cap: 300 minutes a week across days
  perform pg_temp.ck('8 the activity day maximum holds', 'ERR:22023:minutes_invalid', pg_temp.q_as(v_first, format('select public.contribute_to_challenge(%L::uuid, null, 181)::text', v_chA)));

  ---------------------------------------------------------------------------------------------------------------- 9. totals: delay, floor, leave-one-out, rounding, no member id
  perform private.community_run();
  perform pg_temp.ck('9 snapshots exist for the test cohorts', '5', (select count(*)::text from public.challenge_totals where challenge_id in (v_chA, v_chB, v_chC, v_chD, v_chSalt)));
  perform pg_temp.ck('9 nothing is visible before the delay', 'pending',
    (select e #>> '{total,state}' from jsonb_array_elements(pg_temp.j(v_first, format('select public.community_challenges(%L::uuid)::text', v_ca))) e where e ->> 'challenge_id' = v_chA::text));
  perform pg_temp.ck('9 the totals table is unreadable before publication', '0', pg_temp.q_as(v_first, $q$select count(*)::text from public.challenge_totals$q$));
  begin update public.challenge_totals set total_rounded = 1 where challenge_id = v_chA; t := 'edited'; exception when sqlstate 'P0001' then t := 'refused'; end;
  perform pg_temp.ck('9 a snapshot is append only (an edit of a figure is refused)', 'refused', t);
  perform pg_temp.publish_all();
  r := pg_temp.j(v_first, format('select public.community_challenges(%L::uuid)::text', v_ca));
  perform pg_temp.ck('9 A total shown, rounded to 10 (1813 -> 1810)', '1810', (select e #>> '{total,total}' from jsonb_array_elements(r) e where e ->> 'challenge_id' = v_chA::text));
  perform pg_temp.ck('9 A goal reached', 'true', (select e #>> '{total,goal_reached}' from jsonb_array_elements(r) e where e ->> 'challenge_id' = v_chA::text));
  perform pg_temp.ck('9 A group size is a band, not a count', '10-19', (select e #>> '{total,group_size}' from jsonb_array_elements(r) e where e ->> 'challenge_id' = v_chA::text));
  perform pg_temp.ck('9 B (10 contributors, the floor) is shown', 'shown', (select e #>> '{total,state}' from jsonb_array_elements(pg_temp.j(v_b_members[2], format('select public.community_challenges(%L::uuid)::text', v_cb))) e where e ->> 'challenge_id' = v_chB::text));
  perform pg_temp.ck('9 C (9 contributors) is hidden', 'hidden', (select e #>> '{total,state}' from jsonb_array_elements(pg_temp.j(v_c_members[2], format('select public.community_challenges(%L::uuid)::text', v_cc))) e where e ->> 'challenge_id' = v_chC::text));
  perform pg_temp.ck('9 C reason is too_few', 'too_few', (select suppression_reason from public.challenge_totals where challenge_id = v_chC order by as_of desc limit 1));
  perform pg_temp.ck('9 D (one contributor holds most of the total) is hidden', 'dominant_contributor', (select suppression_reason from public.challenge_totals where challenge_id = v_chD order by as_of desc limit 1));
  perform pg_temp.ck('9 a hidden snapshot stores no figure at all', 'null|null|null',
    (select coalesce(total_rounded::text, 'null') || '|' || coalesce(progress_pct::text, 'null') || '|' || coalesce(contributor_band, 'null') from public.challenge_totals where challenge_id = v_chC order by as_of desc limit 1));
  perform pg_temp.ck('9 the totals table has no member id column', '0',
    (select count(*)::text from information_schema.columns where table_name = 'challenge_totals' and column_name ~ '(patient|member|profile|user)'));
  perform pg_temp.ck('9 a member of B can read B''s totals row and not A''s', 'true',
    (pg_temp.q_as(v_b_members[2], format('select count(*)::text from public.challenge_totals where challenge_id = %L', v_chB))::integer > 0
     and pg_temp.q_as(v_b_members[2], format('select count(*)::text from public.challenge_totals where challenge_id = %L', v_chA))::integer = 0)::text);
  -- C gets its tenth contributor: now shown
  v_u := pg_temp.enrol(v_org, v_cc, v_mc, 'c10'); perform pg_temp.q_as(v_u, format('select public.contribute_to_challenge(%L::uuid, null, 30)::text', v_chC));
  perform private.challenge_aggregate(v_chC, false); perform pg_temp.publish_all();
  perform pg_temp.ck('9 C with a tenth contributor is shown', 'shown', (select e #>> '{total,state}' from jsonb_array_elements(pg_temp.j(v_c_members[2], format('select public.community_challenges(%L::uuid)::text', v_cc))) e where e ->> 'challenge_id' = v_chC::text));
  -- D: spread the effort and the total shows
  update public.challenge_participation set value = 80 where challenge_id = v_chD and patient_id <> v_d_members[1];
  perform private.challenge_aggregate(v_chD, false); perform pg_temp.publish_all();
  perform pg_temp.ck('9 D with an even spread is shown (control)', 'shown', (select e #>> '{total,state}' from jsonb_array_elements(pg_temp.j(v_d_members[2], format('select public.community_challenges(%L::uuid)::text', v_cd))) e where e ->> 'challenge_id' = v_chD::text));

  ---------------------------------------------------------------------------------------------------------------- 10. individual values never appear
  r := pg_temp.j(v_first, format('select public.community_challenges(%L::uuid)::text', v_ca));
  v_keys := (select string_agg(k, ',' order by k) from (select distinct jsonb_object_keys(e) k from jsonb_array_elements(r) e) z);
  perform pg_temp.ck('10 the challenge view has a closed key set', 'available,challenge_id,contributing,ends_on,label,phase,starts_on,total,unit', v_keys);
  perform pg_temp.ck('10 the total object has a closed key set', 'as_of,final,goal_reached,group_size,progress_pct,state,total',
    (select string_agg(k, ',' order by k) from (select distinct jsonb_object_keys(e -> 'total') k from jsonb_array_elements(r) e where e #>> '{total,state}' = 'shown') z));
  -- everything every role can read about challenges, scanned for the distinctive individual value 163 and for any member id
  v_all := '';
  foreach v_u in array array[v_ma, v_first, v_a_members[5], v_out, v_ins] loop
    v_all := v_all || pg_temp.q_as(v_u, format('select public.community_challenges(%L::uuid)::text', v_ca))
                   || pg_temp.q_as(v_u, format('select public.community_board(%L::uuid)::text', v_chA))
                   || pg_temp.q_as(v_u, format('select public.community_my_cohorts()::text'))
                   || pg_temp.q_as(v_u, format('select public.community_roster(%L::uuid)::text', v_ca))
                   || pg_temp.q_as(v_u, format('select public.my_challenge_status(%L::uuid)::text', v_chA));
  end loop;
  perform pg_temp.ck('10 no view contains the individual value 163', 'false', (v_all ~ '(^|[^0-9a-fA-F])163([^0-9a-fA-F]|$)')::text);
  perform pg_temp.ck('10 no view contains any member''s profile id', 'false',
    (exists (select 1 from unnest(v_a_members) m where v_all like '%' || m::text || '%'))::text);
  perform pg_temp.ck('10 my_challenge_status is booleans only', 'available,contributing,did_today',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.j(v_first, format('select public.my_challenge_status(%L::uuid)::text', v_chA))) k));

  ---------------------------------------------------------------------------------------------------------------- 11. the board compares cohorts only
  r := pg_temp.j(v_first, format('select public.community_board(%L::uuid)::text', v_chA));
  perform pg_temp.ck('11 the board is shown with three or more cohorts', 'shown', r ->> 'state');
  perform pg_temp.ck('11 the board rows carry only label, rank, progress and whether it is yours', 'is_yours,label,progress_pct,rank',
    (select string_agg(k, ',' order by k) from (select distinct jsonb_object_keys(e) k from jsonb_array_elements(r -> 'rows') e) z));
  perform pg_temp.ck('11 exactly one row is "Your group"', '1', (select count(*)::text from jsonb_array_elements(r -> 'rows') e where e ->> 'label' = 'Your group'));
  perform pg_temp.ck('11 the board names no cohort and no member', 'false', (r::text ~* 'Grace|Peace|Unity|Harmony|Fellowship|Estate|Union|Mosque|Surname')::text);
  perform pg_temp.ck('11 A (goal reached) ranks first', '1', (select e ->> 'rank' from jsonb_array_elements(r -> 'rows') e where e ->> 'label' = 'Your group'));
  perform pg_temp.ck('11 a non-member sees nothing', 'hidden', pg_temp.q_as(v_out, format('select (public.community_board(%L::uuid) ->> %L)', v_chA, 'state')));
  -- a cohort that is hidden is not on the board: with C hidden again the board still has A, B, D (3)
  perform pg_temp.ck('11 three shown cohorts: A, B, C, D = 4 rows', '4', jsonb_array_length(r -> 'rows')::text);
  delete from public.challenge_participation where challenge_id = v_chB and patient_id in (select patient_id from public.challenge_participation where challenge_id = v_chB limit 3);
  perform private.challenge_aggregate(v_chB, false); perform pg_temp.publish_all();
  perform pg_temp.ck('11 with B now below the floor the board has 3 cohorts and still shows', '3', jsonb_array_length(pg_temp.j(v_first, format('select public.community_board(%L::uuid)::text', v_chA)) -> 'rows')::text);
  delete from public.challenge_participation where challenge_id = v_chC and patient_id in (select patient_id from public.challenge_participation where challenge_id = v_chC limit 3);
  perform private.challenge_aggregate(v_chC, false); perform pg_temp.publish_all();
  perform pg_temp.ck('11 with only two cohorts shown the board is not ready', 'not_ready', pg_temp.j(v_first, format('select public.community_board(%L::uuid)::text', v_chA)) ->> 'state');
  -- put B and C back
  insert into public.challenge_participation (organisation_id, challenge_id, patient_id, day, value, source)
  select v_org, v_chB, p, (now() at time zone 'Africa/Lagos')::date, 75, 'self_report' from unnest(v_b_members) p on conflict do nothing;
  insert into public.challenge_participation (organisation_id, challenge_id, patient_id, day, value, source)
  select v_org, v_chC, p, (now() at time zone 'Africa/Lagos')::date, 30, 'self_report' from unnest(v_c_members) p on conflict do nothing;

  ---------------------------------------------------------------------------------------------------------------- 12. notices and events (INV-07)
  v_mute := v_a_members[6]; v_off := v_a_members[7];
  perform pg_temp.q_as(v_mute, format('select public.community_set_muted(%L::uuid, true)::text', v_ca));
  perform pg_temp.q_as(v_off, $q$select public.set_community_off(true)::text$q$);
  perform pg_temp.ck('12 turning community off erased that member''s effort rows', '0', (select count(*)::text from public.challenge_participation where patient_id = v_off));
  perform pg_temp.ck('12 ...and withdrew their totals consent', 'false', (select (consent_totals_at is not null)::text from public.cohort_members where patient_id = v_off and cohort_id = v_ca));
  -- A had its goal reached in the snapshot made before the 12th row left: aggregate again and run
  perform private.challenge_aggregate(v_chA, false); perform pg_temp.publish_all();
  delete from public.notifications where template = 'community_update';
  perform private.community_run();
  perform pg_temp.ck('12 the goal-reached event carries ids and a milestone code only', 'challenge_id,cohort_id,kind',
    (select string_agg(k, ',' order by k) from (select jsonb_object_keys(payload) k from public.domain_events where event_type = 'challenge.progress' and aggregate_id = v_chA limit 3) z));
  perform pg_temp.ck('12 a test cohort''s event is a test event (INV-13)', 'true', (select bool_and(is_test)::text from public.domain_events where event_type = 'challenge.progress' and aggregate_id = v_chA));
  select count(*) into v_notif from public.notifications where template = 'community_update' and recipient_id = any (v_a_members);
  perform pg_temp.ck('12 the notice reached members through in-app and push, none muted or off', 'true', (v_notif > 0)::text);
  perform pg_temp.ck('12 the muted member got no notice', '0', (select count(*)::text from public.notifications where template = 'community_update' and recipient_id = v_mute));
  perform pg_temp.ck('12 the member with community off got no notice', '0', (select count(*)::text from public.notifications where template = 'community_update' and recipient_id = v_off));
  perform pg_temp.ck('12 every notice has an empty payload (no cohort, metric or figure)', '0', (select count(*)::text from public.notifications where template = 'community_update' and payload <> '{}'::jsonb));
  perform pg_temp.ck('12 only in_app and push channels are used', '2', (select count(distinct channel)::text from public.notifications where template = 'community_update'));
  perform pg_temp.ck('12 the notice is content class non_clinical', 'non_clinical', (select distinct content_class::text from public.notifications where template = 'community_update'));
  perform pg_temp.ck('12 the scheduled run reports no errors', '0', (private.community_run() ->> 'errors'));
  select count(*) into v_notif2 from public.notifications where template = 'community_update' and recipient_id = any (v_a_members);
  perform pg_temp.ck('12 running again sends nothing more (once per milestone)', v_notif::text, v_notif2::text);

  ---------------------------------------------------------------------------------------------------------------- 13. leaving, withdrawing, removing, reporting, freezing
  v_leaver := v_a_members[8]; v_wd := v_a_members[9]; v_bad := v_a_members[10]; v_reported := v_a_members[11];
  perform pg_temp.q_as(v_wd, format('select public.community_set_totals_consent(%L::uuid, false)::text', v_ca));
  perform pg_temp.ck('13 withdrawing the totals consent erases that member''s effort rows', '0|false',
    (select count(*)::text from public.challenge_participation where patient_id = v_wd) || '|' || (select (consent_totals_at is not null)::text from public.cohort_members where patient_id = v_wd and cohort_id = v_ca));
  perform pg_temp.q_as(v_leaver, format('select public.community_leave(%L::uuid)::text', v_ca));
  perform pg_temp.ck('13 leaving erases the effort rows', '0', (select count(*)::text from public.challenge_participation where patient_id = v_leaver));
  perform pg_temp.ck('13 ...state left', 'left', (select state from public.cohort_members where patient_id = v_leaver and cohort_id = v_ca));
  perform pg_temp.ck('13 a plain member cannot remove anyone', 'ERR:42501', substr(pg_temp.q_as(v_first, format('select public.community_remove_member(%L::uuid, %L::uuid)::text', v_ca, (select id from public.cohort_members where patient_id = v_bad and cohort_id = v_ca))), 1, 9));
  v_member_row := (select id from public.cohort_members where patient_id = v_reported and cohort_id = v_ca);
  perform pg_temp.ck('13 a member can report another (no free text)', 'true', pg_temp.q_as(v_first, format('select (public.community_report(%L::uuid, %L::uuid, %L) ->> %L)', v_ca, v_member_row, 'unwanted_contact', 'ok')));
  perform pg_temp.q_as(v_first, format('select public.community_report(%L::uuid, %L::uuid, %L)::text', v_ca, v_member_row, 'unwanted_contact'));
  perform pg_temp.ck('13 a repeat report does not double', '1', (select count(*)::text from public.community_reports where reported_member_id = v_member_row and state = 'open'));
  perform pg_temp.ck('13 the moderator sees the report without the reporter', 'reason,member_id,report_id,created_on',
    (select string_agg(k, ',' order by length(k), k) from (select distinct jsonb_object_keys(e) k from jsonb_array_elements(pg_temp.j(v_ma, format('select public.community_moderator_reports(%L::uuid)::text', v_ca))) e) z));
  perform pg_temp.ck('13 the report text never carries the reporter id', 'false', (pg_temp.j(v_ma, format('select public.community_moderator_reports(%L::uuid)::text', v_ca))::text like '%' || v_first::text || '%')::text);
  perform pg_temp.ck('13 the admin sees the open report', '1', jsonb_array_length(pg_temp.j(v_admin, $q$select public.admin_community_reports()::text$q$))::text);
  perform pg_temp.ck('13 a non-admin cannot read the admin queue', 'ERR:42501', substr(pg_temp.q_as(v_first, $q$select public.admin_community_reports()::text$q$), 1, 9));
  perform pg_temp.ck('13 the moderator removes the member', 'true', pg_temp.q_as(v_ma, format('select (public.community_remove_member(%L::uuid, %L::uuid) ->> %L)', v_ca, v_member_row, 'ok')));
  perform pg_temp.ck('13 removal closes the report and erases the effort', 'actioned|0',
    (select state from public.community_reports where reported_member_id = v_member_row) || '|' || (select count(*)::text from public.challenge_participation where patient_id = v_reported));
  perform pg_temp.ck('13 a moderator cannot remove a moderator', '{"ok": false}', pg_temp.q_as(v_ma, format('select public.community_remove_member(%L::uuid, %L::uuid)::text', v_ca, (select id from public.cohort_members where patient_id = v_ma and cohort_id = v_ca))));
  -- an admin removal can bar the person from rejoining
  v_member_row := (select id from public.cohort_members where patient_id = v_bad and cohort_id = v_ca);
  insert into public.community_reports (organisation_id, cohort_id, reporter_id, reported_member_id, reason, is_test) values (v_org, v_ca, v_first, v_member_row, 'concerning_behaviour', true);
  perform pg_temp.q_as(v_admin, format('select public.admin_community_resolve_report(%L::uuid, %L, true)::text', (select id from public.community_reports where reported_member_id = v_member_row), 'remove_member'));
  v_tok := pg_temp.q_as(v_ma, format('select (public.community_create_invite(%L::uuid) ->> %L)', v_ca, 'token'));
  perform pg_temp.ck('13 a barred member cannot rejoin with a fresh invite', '{"ok": false}', pg_temp.q_as(v_bad, format('select public.community_join(%L, true)::text', v_tok)));
  perform pg_temp.ck('13 a removed (not barred) member can be invited again and starts with no consent', 'true|false',
    pg_temp.q_as(v_reported, format('select (public.community_join(%L, true) ->> %L)', v_tok, 'ok')) || '|' ||
    (select (consent_totals_at is not null)::text from public.cohort_members where patient_id = v_reported and cohort_id = v_ca));
  -- freeze
  perform pg_temp.ck('13 only an admin can freeze', 'ERR:42501', substr(pg_temp.q_as(v_ma, format('select public.admin_community_freeze(%L::uuid, true, %L)::text', v_cb, 'trying it')), 1, 9));
  perform pg_temp.q_as(v_admin, format('select public.admin_community_freeze(%L::uuid, true, %L)::text', v_cb, 'proof freeze'));
  perform pg_temp.ck('13 a frozen cohort accepts no contribution (neutral)', '{"ok": false, "reason": "not_available"}', pg_temp.q_as(v_b_members[3], format('select public.contribute_to_challenge(%L::uuid, null, 40)::text', v_chB)));
  perform pg_temp.ck('13 a frozen cohort shows no challenges', '[]', pg_temp.q_as(v_b_members[3], format('select public.community_challenges(%L::uuid)::text', v_cb)));
  perform pg_temp.ck('13 a frozen cohort cannot make an invite', 'ERR:42501', substr(pg_temp.q_as(v_mb, format('select public.community_create_invite(%L::uuid)::text', v_cb)), 1, 9));
  perform pg_temp.ck('13 a frozen cohort can still be left', 'true', pg_temp.q_as(v_b_members[4], format('select (public.community_leave(%L::uuid) ->> %L)', v_cb, 'ok')));
  perform pg_temp.q_as(v_admin, format('select public.admin_community_freeze(%L::uuid, false, %L)::text', v_cb, 'proof unfreeze'));
  perform pg_temp.ck('13 unfreezing restores it', 'active', (select state from public.community_cohorts where id = v_cb));
  -- sole moderator leaves: the cohort closes (no stranger is promoted)
  perform pg_temp.q_as(v_me, format('select public.community_leave(%L::uuid)::text', v_ce));
  perform pg_temp.ck('13 when the only moderator leaves the cohort closes', 'closed', (select state from public.community_cohorts where id = v_ce));
  -- moderator closes cohort D: challenges cancelled, effort erased
  perform pg_temp.q_as(v_md, format('select public.community_close(%L::uuid)::text', v_cd));
  perform pg_temp.ck('13 closing a cohort cancels its challenges and erases the effort', 'closed|0',
    (select state from public.community_cohorts where id = v_cd) || '|' || (select count(*)::text from public.challenge_participation where challenge_id = v_chD));

  ---------------------------------------------------------------------------------------------------------------- 14. other roles read nothing
  foreach t in array array['community_cohorts', 'cohort_members', 'challenges', 'challenge_participation', 'challenge_totals', 'community_preferences'] loop
    perform pg_temp.ck('14 employer reads nothing from ' || t, '0', pg_temp.q_as(v_emp, 'select count(*)::text from public.' || t));
    perform pg_temp.ck('14 sponsor reads nothing from ' || t, '0', pg_temp.q_as(v_spo, 'select count(*)::text from public.' || t));
    perform pg_temp.ck('14 an unrelated clinician reads nothing from ' || t, '0', pg_temp.q_as(v_doc, 'select count(*)::text from public.' || t));
    perform pg_temp.ck('14 a non-member patient reads nothing from ' || t, '0', pg_temp.q_as(v_out, 'select count(*)::text from public.' || t));
  end loop;
  perform pg_temp.ck('14 the admin sees cohort rows', 'true', (pg_temp.q_as(v_admin, 'select count(*)::text from public.community_cohorts')::integer > 0)::text);
  perform pg_temp.ck('14 the admin reads no member, no effort and no total', '0|0|0',
    pg_temp.q_as(v_admin, 'select count(*)::text from public.cohort_members') || '|' || pg_temp.q_as(v_admin, 'select count(*)::text from public.challenge_participation') || '|' || pg_temp.q_as(v_admin, 'select count(*)::text from public.challenge_totals'));
  perform pg_temp.ck('14 an employer account is refused by the roster function', 'ERR:42501', substr(pg_temp.q_as(v_emp, format('select public.community_roster(%L::uuid)::text', v_ca)), 1, 9));
  perform pg_temp.ck('14 an employer account is refused as not a patient', 'ERR:42501', substr(pg_temp.q_as(v_emp, $q$select public.community_my_cohorts()::text$q$), 1, 9));

  ---------------------------------------------------------------------------------------------------------------- 15. group sessions are dormant
  perform pg_temp.ck('15 group_sessions: authenticated cannot read', '42501', split_part(pg_temp.q_as(v_doc, 'select count(*)::text from public.group_sessions'), ':', 2));
  begin
    insert into public.group_sessions (organisation_id, host_clinician_id, title, scheduled_for, duration_minutes, capacity) values (v_org, v_doc, 'Group talk', now() + interval '2 days', 30, 10);
    t := 'inserted';
  exception when sqlstate 'P0001' then t := 'refused'; end;
  perform pg_temp.ck('15 the dormant trigger refuses an insert', 'refused', t);
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_admin, activation_note = 'proof' where key = 'group_sessions';
  begin
    insert into public.group_sessions (organisation_id, host_clinician_id, title, scheduled_for, duration_minutes, capacity, recording_enabled) values (v_org, v_doc, 'Group talk', now() + interval '2 days', 30, 10, true);
    t := 'inserted';
  exception when check_violation then t := 'refused'; end;
  perform pg_temp.ck('15 a session can never be recorded (INV-11)', 'refused', t);
  begin
    insert into public.group_sessions (organisation_id, host_clinician_id, title, scheduled_for, duration_minutes, capacity, scribe_enabled) values (v_org, v_doc, 'Group talk', now() + interval '2 days', 30, 10, true);
    t := 'inserted';
  exception when check_violation then t := 'refused'; end;
  perform pg_temp.ck('15 a session can never use the scribe (INV-11)', 'refused', t);
  begin
    insert into public.group_sessions (organisation_id, host_clinician_id, title, scheduled_for, duration_minutes, capacity) values (v_org, v_doc, 'Group talk', now() + interval '2 days', 30, 25);
    t := 'inserted';
  exception when check_violation then t := 'refused'; end;
  perform pg_temp.ck('15 capacity is capped at 20', 'refused', t);
  update public.platform_modules set is_enabled = false, enabled_at = null, enabled_by = null, activation_note = null where key = 'group_sessions';

  ---------------------------------------------------------------------------------------------------------------- 16. global switch
  update public.platform_modules set is_enabled = false, enabled_at = null, enabled_by = null, activation_note = null where key = 'community_cohorts';
  perform pg_temp.ck('16 switch off: a real patient is closed again', 'false', pg_temp.q_as(v_real, $q$select (public.community_status() ->> 'open')$q$));
  perform pg_temp.ck('16 leaving still works with the switch off', 'true', pg_temp.q_as(v_b_members[5], format('select (public.community_leave(%L::uuid) ->> %L)', v_cb, 'ok')));
  perform pg_temp.ck('16 withdrawing consent still works with the switch off', 'true', pg_temp.q_as(v_b_members[6], format('select (public.community_set_totals_consent(%L::uuid, false) ->> %L)', v_cb, 'ok')));
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_admin, activation_note = 'proof' where key = 'community_cohorts';

  ---------------------------------------------------------------------------------------------------------------- 17. the solo wellness nudge is neutral
  insert into public.wellness_challenges (code, title, description, metric, target_count, duration_days) values ('s69_proof', '5-Day Vitals Streak S69', 'proof', 'vitals_logs', 5, 7);
  insert into public.patient_challenge_enrolments (organisation_id, patient_id, challenge_id, target_end_at)
  values (v_org, v_out, (select id from public.wellness_challenges where code = 's69_proof'), now() + interval '10 hours');
  delete from public.notifications where template = 'wellness_challenge_ending';
  perform private.queue_wellness_challenge_ending_nudges();
  perform pg_temp.ck('17 the nudge was queued (in-app and the reminder channel)', 'true', ((select count(*) from public.notifications where template = 'wellness_challenge_ending' and recipient_id = v_out) >= 1)::text);
  perform pg_temp.ck('17 the nudge payload is empty (no title, no progress, no target)', '0', (select count(*)::text from public.notifications where template = 'wellness_challenge_ending' and payload <> '{}'::jsonb));

  perform pg_temp.setf('ma', v_ma); perform pg_temp.setf('first', v_first); perform pg_temp.setf('out', v_out); perform pg_temp.setf('ins', v_ins); perform pg_temp.setf('cA', v_ca);
  perform pg_temp.setf('chA', v_chA); perform pg_temp.setf('chC', v_chC); perform pg_temp.setf('chD', v_chD); perform pg_temp.setf('org', v_org); perform pg_temp.setf('cc', v_cc);
  perform pg_temp.setf('m5', v_a_members[5]); perform pg_temp.setf('cMember', v_c_members[2]); perform pg_temp.setf('cmod', v_mc); perform pg_temp.setf('dmod', v_md);
end $$;

---------------------------------------------------------------------------------------------------------------------------------------------------
-- SABOTAGE: break each protection in turn; the matching check must flip
---------------------------------------------------------------------------------------------------------------------------------------------------
-- (S1) the floor lowered to 2: a 9-contributor cohort (C, after taking one out) would show a total
do $$
declare v_chC uuid := pg_temp.f('chC'); v_cmember uuid := pg_temp.f('cMember'); v_state text;
begin
  -- make C genuinely small (4 contributors), then aggregate with the REAL rules and with a floor of 2
  delete from public.challenge_participation where challenge_id = v_chC and patient_id in (select patient_id from public.challenge_participation where challenge_id = v_chC order by patient_id limit 7);
  perform private.challenge_aggregate(v_chC, false);
  perform pg_temp.ck('S1 real: a 4-contributor cohort is hidden', 'too_few', (select suppression_reason from public.challenge_totals where challenge_id = v_chC order by as_of desc limit 1));
  create or replace function private.community_rules() returns jsonb language sql stable security definer set search_path = ''
    as $f$ select (rules || '{"min_contributors": 2}'::jsonb) from public.community_config where is_active $f$;
  perform private.challenge_aggregate(v_chC, false);
  perform pg_temp.sab('S1 a floor of 2 hides a 4-contributor cohort', 'too_few', coalesce((select suppression_reason from public.challenge_totals where challenge_id = v_chC order by as_of desc limit 1), 'shown'));
  create or replace function private.community_rules() returns jsonb language sql stable security definer set search_path = ''
    as $f$ select rules from public.community_config where is_active $f$;
end $$;

-- (S2) leave-one-out disabled (a share cap of 100): a cohort of 11 contributors with one dominant would show its total
do $$
declare v_org uuid := pg_temp.f('org'); v_mod uuid; v_co uuid; v_ch uuid; v_u uuid; v_i integer;
begin
  v_mod := pg_temp.mkuser(v_org, 'modS', 'patient');
  v_co := (pg_temp.j(v_mod, $q$select public.community_create('Sabotage Dominant Group', 'workplace', true)::text$q$) ->> 'cohort_id')::uuid;
  v_ch := (pg_temp.j(v_mod, format('select public.community_start_challenge(%L::uuid, %L, (now() at time zone %L)::date, 14)::text', v_co, 'move_together', 'Africa/Lagos')) ->> 'challenge_id')::uuid;
  for v_i in 1..11 loop
    v_u := pg_temp.enrol(v_org, v_co, v_mod, 's' || v_i);
    insert into public.challenge_participation (organisation_id, challenge_id, patient_id, day, value, source)
    values (v_org, v_ch, v_u, (now() at time zone 'Africa/Lagos')::date, case when v_i = 1 then 180 else 10 end, 'self_report');
  end loop;
  perform private.challenge_aggregate(v_ch, false);
  perform pg_temp.ck('S2 real: a dominant contributor hides the total', 'dominant_contributor', (select suppression_reason from public.challenge_totals where challenge_id = v_ch order by as_of desc limit 1));
  create or replace function private.community_rules() returns jsonb language sql stable security definer set search_path = ''
    as $f$ select (rules || '{"max_single_share_pct": 100}'::jsonb) from public.community_config where is_active $f$;
  perform private.challenge_aggregate(v_ch, false);
  perform pg_temp.sab('S2 with leave-one-out off the dominant total is hidden', 'dominant_contributor', coalesce((select suppression_reason from public.challenge_totals where challenge_id = v_ch order by as_of desc limit 1), 'shown'));
  create or replace function private.community_rules() returns jsonb language sql stable security definer set search_path = ''
    as $f$ select rules from public.community_config where is_active $f$;
end $$;

-- (S3) the effort-only rule disabled: the insulin user could join an activity challenge
do $$
begin
  perform pg_temp.ck('S3 real: the insulin user is refused', '{"ok": false, "reason": "not_available"}', pg_temp.q_as(pg_temp.f('ins'), format('select public.contribute_to_challenge(%L::uuid, null, 60)::text', pg_temp.f('chA'))));
  create or replace function private.community_effort_only(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $f$ select false $f$;
  perform pg_temp.sab('S3 with the rule off the insulin user is refused', '{"ok": false, "reason": "not_available"}', pg_temp.q_as(pg_temp.f('ins'), format('select public.contribute_to_challenge(%L::uuid, null, 60)::text', pg_temp.f('chA'))));
end $$;

-- (S4) a challenge view that adds the caller's own value: the "no individual value" scan must catch it
do $$
declare v_txt text;
begin
  perform pg_temp.q_as(pg_temp.f('first'), format('select public.contribute_to_challenge(%L::uuid, null, 123)::text', pg_temp.f('chA')));
  create or replace function private.community_challenge_view(p_challenge public.challenges, p_patient uuid) returns jsonb language sql stable security definer set search_path = ''
    as $f$ select jsonb_build_object('challenge_id', p_challenge.id, 'label', 'x', 'unit', 'minutes', 'starts_on', p_challenge.starts_on, 'ends_on', p_challenge.ends_on, 'phase', 'active', 'available', true, 'contributing', true,
      'total', jsonb_build_object('state', 'pending'), 'yours', (select value from public.challenge_participation where challenge_id = p_challenge.id and patient_id = p_patient limit 1)) $f$;
  v_txt := pg_temp.q_as(pg_temp.f('first'), format('select public.community_challenges(%L::uuid)::text', pg_temp.f('cA')));
  perform pg_temp.sab('S4 a view that leaks the caller''s own value', 'false', (v_txt ~ '(^|[^0-9a-fA-F])123([^0-9a-fA-F]|$)')::text);
end $$;

-- (S5) the participation RLS opened: the moderator would read other members' effort rows
do $$
begin
  perform pg_temp.ck('S5 real: the moderator reads one effort row', '1', pg_temp.q_as(pg_temp.f('ma'), $q$select count(*)::text from public.challenge_participation$q$));
  drop policy challenge_participation_own on public.challenge_participation;
  create policy challenge_participation_open on public.challenge_participation for select to authenticated using (true);
  perform pg_temp.sab('S5 with the policy opened the moderator reads one row', '1', pg_temp.q_as(pg_temp.f('ma'), $q$select count(*)::text from public.challenge_participation$q$));
end $$;

-- (S6) a notice that carries the cohort name: the payload check must catch it
do $$
declare v_u uuid := pg_temp.f('first');
begin
  delete from public.notifications where template = 'community_update';
  create or replace function private.community_notify(p_recipient uuid, p_org uuid, p_source_table text, p_source uuid) returns void language plpgsql security definer set search_path = '' as $f$
  begin
    insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
    values (p_recipient, p_org, 'in_app', 'community_update', jsonb_build_object('cohort', 'Grace Fellowship Group'), 'pending', 'non_clinical', 'routine'::public.notification_priority, p_source_table, p_source);
  end $f$;
  perform private.community_notify(v_u, pg_temp.f('org'), 'challenges', gen_random_uuid());
  perform pg_temp.sab('S6 a notice carrying the cohort name', '0', (select count(*)::text from public.notifications where template = 'community_update' and payload <> '{}'::jsonb));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S69 proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 6 then raise exception 'VACUOUS TEST: the sabotage flipped % of 6 checks (%)', v_caught,
    (select string_agg(check_name || ' => ' || expected || ' vs ' || coalesce(actual, 'null'), '; ') from results where phase = 'sabotaged'); end if;
end $$;

select phase, check_name, expected, actual,
       case when phase = 'real' then case when expected = actual then 'PASS' else 'FAIL' end
            else case when expected is distinct from actual then 'FLIPPED' else 'NOT-CAUGHT' end end as result
from results order by phase desc, check_name;

rollback;
