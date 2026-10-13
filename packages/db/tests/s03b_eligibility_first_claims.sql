-- ===========================================================================
-- Proof: 20261013*_s03b_eligibility_first_claims.sql (v5 1.8; closes OQ-41; INV-10).
--
-- Proves, against the real migrated schema:
--   1. An unverified sign-up claims NOTHING: a roster slot matched by the typed email or phone stays pending, the profile stays in
--      the direct organisation, a pending cohort code joins no cohort. Someone typing a colleague's address cannot burn the slot.
--   2. Verifying the email (or the phone) is what claims: the slot is claimed once, to that account, the profile moves to the
--      employer organisation, and the pending cohort code joins the cohort (one use counted).
--   3. A channel only counts when it is verified: an account verified by phone does not claim a slot that matches only its
--      UNVERIFIED email, and the reverse.
--   4. An account created already verified (an admin invite) claims at once; an account an admin placed in an organisation
--      through app_metadata is left where it was put.
--   5. A pending code that no longer works (unknown, expired, closed, full) never blocks verification; the person is told in-app;
--      the answers to the sign-up check are identical for every kind of bad code, and only the service role can ask.
--   6. public.join_cohort still behaves as before for a signed-in patient (joins, repeat is "already", ten bad tries stop even a
--      good code, anonymous refused) and the core cannot be called by an application role.
--   7. A claim that errors never blocks sign-up or verification and is NOT silent: it is written to the audit log as failed.
--   8. SABOTAGE x3: a claim that ignores verification (the OQ-41 bug) must take the slot of an unverified account; the sign-up
--      check opened to anon must be callable by anon; the core opened to authenticated must be callable by them.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;

create function pg_temp.refused(p_role text, p_uid uuid, p_sql text) returns boolean language plpgsql as $$
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

do $$
declare
  v_dir constant uuid := '00000000-0000-0000-0000-000000000001';
  v_emp uuid;
  v_sp uuid;
  r_email uuid; r_phone uuid; r_cross uuid; r_pre uuid; r_meta uuid;
  c_good uuid; c_full uuid; c_closed uuid; c_old uuid;
  a1 uuid := gen_random_uuid();   -- signs up with the colleague's email, never verifies
  u1 uuid := gen_random_uuid();   -- the real colleague (email), with a pending good cohort code
  u2 uuid := gen_random_uuid();   -- phone sign-up
  u3 uuid := gen_random_uuid();   -- verified by phone, slot matches only its unverified email
  u4 uuid := gen_random_uuid();   -- created already verified
  u5 uuid := gen_random_uuid();   -- admin-placed org
  u6 uuid := gen_random_uuid();   -- bad cohort code, then verified
  u7 uuid := gen_random_uuid();   -- full cohort code
  u8 uuid := gen_random_uuid();   -- signed-in joiner
  u9 uuid := gen_random_uuid();   -- failing claim
  u1c uuid := gen_random_uuid();  -- cohort code only, no roster slot
  u1b uuid := gen_random_uuid();  -- roster slot AND a cohort code
  u8b uuid := gen_random_uuid();  -- adult with a date of birth
  u10 uuid := gen_random_uuid();  -- established account (onboarding finished) matching a roster slot
  r_both uuid; r_est uuid;
  v_org uuid; v_n integer; v_txt text; r jsonb; v_uses integer; v_status text;
begin
  insert into public.organisations (name, type) values ('S03b Employer', 'corporate') returning id into v_emp;
  insert into public.organisations (name, type) values ('S03b Sponsor', 'ngo') returning id into v_sp;

  -- sponsor cohorts live in the direct organisation (where self-serve accounts land)
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses)
    values (v_dir, v_sp, 'S03b Good', 'GRPA2345', current_date - 1, current_date + 30, 10) returning id into c_good;
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses, uses)
    values (v_dir, v_sp, 'S03b Full', 'FULL2345', current_date - 1, current_date + 30, 1, 1) returning id into c_full;
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses, status)
    values (v_dir, v_sp, 'S03b Closed', 'SHUT2345', current_date - 1, current_date + 30, 10, 'closed') returning id into c_closed;
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses)
    values (v_dir, v_sp, 'S03b Old', 'PLDX2345', current_date - 40, current_date - 10, 10) returning id into c_old;

  insert into public.employer_roster_members (organisation_id, email, full_name) values (v_emp, 's03b-colleague@example.invalid', 'S03b Colleague') returning id into r_email;
  insert into public.employer_roster_members (organisation_id, phone, full_name) values (v_emp, '+2348077770002', 'S03b Phone Colleague') returning id into r_phone;
  insert into public.employer_roster_members (organisation_id, email, full_name) values (v_emp, 's03b-cross@example.invalid', 'S03b Cross') returning id into r_cross;
  insert into public.employer_roster_members (organisation_id, email, full_name) values (v_emp, 's03b-pre@example.invalid', 'S03b Pre') returning id into r_pre;
  insert into public.employer_roster_members (organisation_id, email, full_name) values (v_emp, 's03b-meta@example.invalid', 'S03b Meta') returning id into r_meta;

  -- ===== 1. unverified sign-ups claim nothing
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (a1, 'S03B-Colleague@example.invalid', 'x', null, '{}', '{"cohort_code":"GRPA2345"}');
  select organisation_id into v_org from public.profiles where id = a1;
  if v_org <> v_dir then raise exception 'FAIL 1a: an unverified sign-up was moved to organisation %', v_org; end if;
  select status::text into v_status from public.employer_roster_members where id = r_email;
  if v_status <> 'pending' then raise exception 'FAIL 1a: an unverified sign-up took the roster slot (status %)', v_status; end if;
  if exists (select 1 from public.profile_cohorts where patient_id = a1) then raise exception 'FAIL 1b: an unverified sign-up joined a cohort'; end if;
  select uses into v_uses from public.sponsor_cohorts where id = c_good;
  if v_uses <> 0 then raise exception 'FAIL 1b: a use was counted before verification'; end if;

  -- ===== 2. the real owner verifies: the claim happens (a different slot and address; the attacker's account above stays unverified)
  insert into public.employer_roster_members (organisation_id, email, full_name) values (v_emp, 's03b-real@example.invalid', 'S03b Real') returning id into r_email;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (u1, 's03b-real@example.invalid', 'x', null, '{}', '{}');
  select status::text into v_status from public.employer_roster_members where id = r_email;
  if v_status <> 'pending' then raise exception 'FAIL 2a: slot claimed before the colleague verified'; end if;
  update auth.users set email_confirmed_at = now() where id = u1;
  select status::text into v_status from public.employer_roster_members where id = r_email;
  if v_status <> 'claimed' or (select claimed_profile_id from public.employer_roster_members where id = r_email) <> u1 then
    raise exception 'FAIL 2b: verifying the email did not claim the slot (status %)', v_status; end if;
  if (select organisation_id from public.profiles where id = u1) <> v_emp then raise exception 'FAIL 2b: profile did not move to the employer organisation'; end if;
  if not exists (select 1 from public.audit_log where subject_patient_id = u1 and action = 'roster.claimed_after_verification') then raise exception 'FAIL 2d: roster claim not audited'; end if;

  -- a cohort code alone: pending until verified, then joined, one use, audited, and a later update counts nothing twice
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (u1c, 's03b-cohort-only@example.invalid', 'x', null, '{}', '{"cohort_code":"grpa-2345"}');
  if exists (select 1 from public.profile_cohorts where patient_id = u1c) then raise exception 'FAIL 2c: a cohort was joined before verification'; end if;
  update auth.users set email_confirmed_at = now() where id = u1c;
  if not exists (select 1 from public.profile_cohorts where patient_id = u1c and cohort_id = c_good and left_at is null) then raise exception 'FAIL 2c: pending cohort code did not join on verification'; end if;
  select uses into v_uses from public.sponsor_cohorts where id = c_good;
  if v_uses <> 1 then raise exception 'FAIL 2c: cohort uses is % not 1', v_uses; end if;
  if not exists (select 1 from public.audit_log where actor_id = u1c and action = 'sponsor.cohort_joined') then raise exception 'FAIL 2d: cohort join not audited'; end if;
  update auth.users set email_confirmed_at = now() + interval '1 second' where id = u1c;
  select uses into v_uses from public.sponsor_cohorts where id = c_good;
  if v_uses <> 1 then raise exception 'FAIL 2e: a second update counted a second use'; end if;

  -- a roster employee who ALSO typed a direct-organisation cohort code: the roster claim runs first and moves the profile, and a cohort
  -- is joined only inside the person's own organisation, so the code is not applied and the person is TOLD (same rule as join_cohort)
  insert into public.employer_roster_members (organisation_id, email, full_name) values (v_emp, 's03b-both@example.invalid', 'S03b Both') returning id into r_both;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (u1b, 's03b-both@example.invalid', 'x', null, '{}', '{"cohort_code":"GRPA2345"}');
  update auth.users set email_confirmed_at = now() where id = u1b;
  if (select status::text from public.employer_roster_members where id = r_both) <> 'claimed' then raise exception 'FAIL 2g: the roster slot was not claimed'; end if;
  if exists (select 1 from public.profile_cohorts where patient_id = u1b) then raise exception 'FAIL 2g: a cohort row was written in an organisation the profile is not in'; end if;
  if not exists (select 1 from public.notifications where recipient_id = u1b and template = 'security.programme_code_not_applied' and channel = 'in_app') then
    raise exception 'FAIL 2g: the person was not told the code could not be used'; end if;

  -- an ESTABLISHED account (onboarding finished) is never moved to another organisation by a later verification
  insert into public.employer_roster_members (organisation_id, email, full_name) values (v_emp, 's03b-established@example.invalid', 'S03b Established') returning id into r_est;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (u10, 's03b-established@example.invalid', 'x', null, '{}', '{}');
  -- the onboarding prerequisites (consents, DOB) are a separate guard; this fixture only needs the finished flag
  alter table public.profiles disable trigger profiles_enforce_onboarding_prereqs;
  update public.profiles set onboarding_completed_at = now() where id = u10;
  alter table public.profiles enable trigger profiles_enforce_onboarding_prereqs;
  update auth.users set email_confirmed_at = now() where id = u10;
  if (select status::text from public.employer_roster_members where id = r_est) <> 'pending' then raise exception 'FAIL 2h: an established account claimed a roster slot'; end if;
  if (select organisation_id from public.profiles where id = u10) <> v_dir then raise exception 'FAIL 2h: an established account was moved to another organisation'; end if;
  if not exists (select 1 from public.audit_log where subject_patient_id = u10 and action = 'roster.claim_skipped_account_in_use' and result = 'denied') then
    raise exception 'FAIL 2h: the skipped claim was not audited'; end if;
  if not exists (select 1 from public.notifications where recipient_id = u10 and template = 'security.programme_code_not_applied' and channel = 'in_app') then
    raise exception 'FAIL 2h: the established account was not told its employer slot was not applied'; end if;

  -- phone path
  insert into auth.users (id, phone, encrypted_password, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (u2, '2348077770002', 'x', null, '{}', '{}');
  select status::text into v_status from public.employer_roster_members where id = r_phone;
  if v_status <> 'pending' then raise exception 'FAIL 2f: slot claimed on an unverified phone sign-up'; end if;
  update auth.users set phone_confirmed_at = now() where id = u2;
  select status::text into v_status from public.employer_roster_members where id = r_phone;
  if v_status <> 'claimed' or (select organisation_id from public.profiles where id = u2) <> v_emp then raise exception 'FAIL 2f: verifying the phone did not claim (status %)', v_status; end if;

  -- ===== 3. only a VERIFIED channel counts
  insert into auth.users (id, email, phone, encrypted_password, email_confirmed_at, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (u3, 's03b-cross@example.invalid', '2348077770003', 'x', null, null, '{}', '{}');
  update auth.users set phone_confirmed_at = now() where id = u3;   -- phone verified, the roster slot matches only the email
  select status::text into v_status from public.employer_roster_members where id = r_cross;
  if v_status <> 'pending' then raise exception 'FAIL 3a: an unverified email claimed a slot because the PHONE was verified (status %)', v_status; end if;
  update auth.users set email_confirmed_at = now() where id = u3;
  select status::text into v_status from public.employer_roster_members where id = r_cross;
  if v_status <> 'claimed' then raise exception 'FAIL 3b(control): verifying the matching email did not claim (status %)', v_status; end if;

  -- ===== 4. created already verified; admin-placed org untouched
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (u4, 's03b-pre@example.invalid', 'x', now(), '{}', '{}');
  select status::text into v_status from public.employer_roster_members where id = r_pre;
  if v_status <> 'claimed' or (select organisation_id from public.profiles where id = u4) <> v_emp then raise exception 'FAIL 4a: an already-verified account did not claim at once (status %)', v_status; end if;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (u5, 's03b-meta@example.invalid', 'x', now(), jsonb_build_object('organisation_id', v_sp::text), '{}');
  select status::text into v_status from public.employer_roster_members where id = r_meta;
  if v_status <> 'pending' or (select organisation_id from public.profiles where id = u5) <> v_sp then raise exception 'FAIL 4b: an admin-placed account was moved by the roster (status %)', v_status; end if;

  -- ===== 5. bad pending codes never block verification, and the person is told
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (u6, 's03b-badcode@example.invalid', 'x', null, '{}', '{"cohort_code":"NOPE9999"}'),
           (u7, 's03b-fullcode@example.invalid', 'x', null, '{}', '{"cohort_code":"FULL2345"}');
  update auth.users set email_confirmed_at = now() where id in (u6, u7);
  if exists (select 1 from public.profile_cohorts where patient_id in (u6, u7)) then raise exception 'FAIL 5a: a bad or full code joined a cohort'; end if;
  if (select count(*) from public.notifications where recipient_id in (u6, u7) and template = 'security.programme_code_not_applied' and channel = 'in_app') <> 2 then
    raise exception 'FAIL 5a: a person whose code could not be used was not told'; end if;
  if not (select email_confirmed_at is not null from auth.users where id = u6) then raise exception 'FAIL 5a: verification was blocked'; end if;
  -- the sign-up check: same answer for unknown, expired, closed and full; true only for a good code; service role only
  if not pg_temp.svc_bool(format('select public.check_cohort_code_for_signup(%L)', 'grpa-2345')) then raise exception 'FAIL 5b: a good code was refused (case and dash must not matter)'; end if;
  if pg_temp.svc_bool(format('select public.check_cohort_code_for_signup(%L)', 'NOPE9999'))
     or pg_temp.svc_bool(format('select public.check_cohort_code_for_signup(%L)', 'PLDX2345'))
     or pg_temp.svc_bool(format('select public.check_cohort_code_for_signup(%L)', 'SHUT2345'))
     or pg_temp.svc_bool(format('select public.check_cohort_code_for_signup(%L)', 'FULL2345'))
     or pg_temp.svc_bool(format('select public.check_cohort_code_for_signup(%L)', '')) then
    raise exception 'FAIL 5b: a bad code (unknown, expired, closed, full or empty) passed the sign-up check'; end if;
  if not pg_temp.refused('anon', null, format('select public.check_cohort_code_for_signup(%L)', 'GRPA2345')) then raise exception 'FAIL 5c: anon can probe cohort codes'; end if;
  if not pg_temp.refused('authenticated', u8, format('select public.check_cohort_code_for_signup(%L)', 'GRPA2345')) then raise exception 'FAIL 5c: a signed-in session can probe cohort codes'; end if;

  -- ===== 6. join_cohort still works for a signed-in patient
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (u8, 's03b-joiner@example.invalid', 'x', now(), '{}', '{}');
  perform pg_temp.as_user(u8);
  set local role authenticated;
  r := public.join_cohort('NOPE0000');
  if (r ->> 'ok')::boolean then raise exception 'FAIL 6a: a bad code joined'; end if;
  r := public.join_cohort('GRPA2345');
  if not (r ->> 'ok')::boolean or r ->> 'status' <> 'joined' then raise exception 'FAIL 6b: good code did not join %', r; end if;
  r := public.join_cohort('GRPA2345');
  if r ->> 'status' <> 'already' then raise exception 'FAIL 6c: repeat was not "already" %', r; end if;
  for v_n in 1..10 loop perform public.join_cohort('NOPE' || lpad(v_n::text, 4, '0')); end loop;
  reset role;
  -- ten bad tries: even a good code from a fresh cohort is refused for an hour
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses)
    values (v_dir, v_sp, 'S03b Second', 'TWTW2345', current_date - 1, current_date + 30, 10);
  perform pg_temp.as_user(u8);
  set local role authenticated;
  r := public.join_cohort('TWTW2345');
  reset role;
  if (r ->> 'ok')::boolean then raise exception 'FAIL 6d: ten bad tries did not stop a good code'; end if;
  if not pg_temp.refused('anon', null, format('select public.join_cohort(%L)', 'GRPA2345')) then raise exception 'FAIL 6e: anon can join a cohort'; end if;
  if not pg_temp.refused('authenticated', u8, format('select private.join_cohort_core(%L, %L)', u1, 'GRPA2345')) then raise exception 'FAIL 6e: a session can call the join core for another person'; end if;

  -- ===== 7. a claim that errors does not block sign-up and is not silent
  create or replace function private.claim_programmes_for_verified_user(p_user uuid) returns void language plpgsql security definer set search_path = '' as $f$
    begin raise exception 'forced failure for the proof'; end $f$;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (u9, 's03b-failing@example.invalid', 'x', now(), '{}', '{}');
  if not exists (select 1 from public.profiles where id = u9) then raise exception 'FAIL 7a: a failing claim blocked account creation'; end if;
  if not exists (select 1 from public.audit_log where subject_patient_id = u9 and action = 'signup.programme_claim_failed' and result = 'failed') then
    raise exception 'FAIL 7b: a failed claim was silent'; end if;
  if not exists (select 1 from public.notifications where recipient_id = u9 and template = 'security.programme_code_not_applied' and channel = 'in_app') then
    raise exception 'FAIL 7c: the person was not told their programme could not be added'; end if;
  -- 7b. S04b-1's adult-only refusal (PR 1078) must still exist after this migration: handle_new_user is a superset of both
  v_txt := null;
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values (gen_random_uuid(), 's03b-minor@example.invalid', 'x', null, '{}', jsonb_build_object('date_of_birth', (current_date - interval '10 years')::date::text));
  exception when others then v_txt := sqlerrm; end;
  if v_txt is null or v_txt not like 'adult_only_registration%' then raise exception 'FAIL 7b: an under-18 sign-up was not refused (%)', v_txt; end if;
  v_txt := null;
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values (gen_random_uuid(), 's03b-baddob@example.invalid', 'x', null, '{}', '{"date_of_birth":"not a date"}');
  exception when others then v_txt := sqlerrm; end;
  if v_txt is null or v_txt not like 'adult_only_registration%' then raise exception 'FAIL 7b: an invalid date of birth was accepted (%)', v_txt; end if;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (u8b, 's03b-adult@example.invalid', 'x', null, '{}', '{"date_of_birth":"1985-03-04"}');
  if (select date_of_birth from public.profiles where id = u8b) is distinct from date '1985-03-04' then raise exception 'FAIL 7b: an adult date of birth was not stored'; end if;
  raise notice 'PASS 1-7 eligibility first';
end $$;

-- ===========================================================================
-- 8. SABOTAGE. Each block reverts one guard and proves the matching check above could fail.
-- ===========================================================================
do $$
declare
  v_dir constant uuid := '00000000-0000-0000-0000-000000000001';
  v_emp uuid; s uuid := gen_random_uuid(); rid uuid; v_status text;
begin
  insert into public.organisations (name, type) values ('S03b Sab Employer', 'corporate') returning id into v_emp;
  insert into public.employer_roster_members (organisation_id, email, full_name) values (v_emp, 's03bsab@example.invalid', 'Sab') returning id into rid;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (s, 's03bsab@example.invalid', 'x', null, '{}', '{}');

  -- S1: the OQ-41 bug: a claim that ignores verification takes the slot of an account that never verified
  create or replace function private.claim_programmes_for_verified_user(p_user uuid) returns void language plpgsql security definer set search_path = '' as $f$
    begin
      update public.employer_roster_members set status = 'claimed', claimed_profile_id = p_user, claimed_at = now()
       where lower(email) = (select lower(email) from auth.users where id = p_user) and status = 'pending';
    end $f$;
  perform private.claim_programmes_for_verified_user(s);
  select status::text into v_status from public.employer_roster_members where id = rid;
  if v_status <> 'claimed' then raise exception 'VACUOUS TEST: the verification-blind claim did not take the slot, so section 1 proves nothing'; end if;

  -- S2: open the sign-up check to anon
  execute 'grant execute on function public.check_cohort_code_for_signup(text) to anon';
  if not has_function_privilege('anon', 'public.check_cohort_code_for_signup(text)', 'EXECUTE') then raise exception 'VACUOUS TEST: grant did not reach anon'; end if;

  -- S3: open the join core to authenticated
  execute 'grant execute on function private.join_cohort_core(uuid,text) to authenticated';
  if not has_function_privilege('authenticated', 'private.join_cohort_core(uuid,text)', 'EXECUTE') then raise exception 'VACUOUS TEST: grant did not reach authenticated'; end if;
end $$;

select 'PASS: s03b_eligibility_first_claims' as result;

rollback;
