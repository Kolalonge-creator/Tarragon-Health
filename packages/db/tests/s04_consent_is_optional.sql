-- ===========================================================================
-- Proof: 20261001*_s04_consent_is_optional.sql (v5 4.2 / function 1.13).
--
-- Proves private.has_required_consents:
--   1. is false for a patient who has accepted nothing and true once every REQUIRED current purpose is accepted;
--   2. is NOT blocked by an optional (is_optional = true) current purpose the patient has not accepted;
--   2b. a NEW current version of a required purpose, inserted the way every legal bump is (no is_optional given), still
--       gates: the default keeps it required (this failed under the first draft, where the default was optional);
--   3. goes false when a required acceptance is withdrawn, and true again after a later re-acceptance;
--   4. an optional withdrawal never affects it;
--   5. SABOTAGE: the pre-S04 definition (every current purpose gates) fails check 2, so check 2 can fail.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures. Timestamps are explicit because rows in one transaction share
-- now(), and the function orders by created_at.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  pat uuid := gen_random_uuid();
  v_opt uuid;
  v_t timestamptz := now();
  cv record;
  src text;
  n integer := 0;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data)
    values (pat, 's04c-pat@example.invalid', 'x', now(), now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone)
    values (pat, v_org, 'patient', 'S04C Patient', '+2348011150001')
  on conflict (id) do update set organisation_id = excluded.organisation_id;

  -- 1. nothing accepted
  if private.has_required_consents(pat) then raise exception 'FAIL 1a: true with nothing accepted'; end if;
  for cv in select id, consent_type, version from public.consent_versions where is_current and not is_optional loop
    n := n + 1;
    insert into public.patient_consents (patient_id, organisation_id, consent_type, version, consent_version_id, action, accepted_at, created_at)
      values (pat, v_org, cv.consent_type, cv.version, cv.id, 'accepted', v_t + make_interval(secs => n), v_t + make_interval(secs => n));
  end loop;
  if n < 1 then raise exception 'fixture FAIL: no required current consent versions'; end if;
  if not private.has_required_consents(pat) then raise exception 'FAIL 1b: false after accepting every required purpose'; end if;

  -- 2. an optional current purpose the patient has not accepted does not gate
  -- a research consent version now ships current (S83 fix); this proof makes its own, so demote the shipped one inside the rolled-back test
  update public.consent_versions set is_current = false where consent_type = 'research' and is_current;
  insert into public.consent_versions (consent_type, version, title, body, is_current, is_optional)
    values ('research', 'proof-v1', 'Proof optional', 'proof body', true, true) returning id into v_opt;
  if not private.has_required_consents(pat) then raise exception 'FAIL 2: an unaccepted OPTIONAL purpose blocked has_required_consents'; end if;

  -- 2b. publish a new current version of a required purpose with a plain INSERT, as every legal bump does
  declare v_old record; v_new uuid;
  begin
    select id, consent_type into v_old from public.consent_versions where is_current and not is_optional order by consent_type limit 1;
    update public.consent_versions set is_current = false where id = v_old.id;
    insert into public.consent_versions (consent_type, version, title, body, is_current)
      values (v_old.consent_type, 'proof-bump-v2', 'Proof bump', 'proof body', true) returning id into v_new;
    if (select is_optional from public.consent_versions where id = v_new) then raise exception 'FAIL 2b: a plain INSERT produced an optional version'; end if;
    if private.has_required_consents(pat) then raise exception 'FAIL 2b: a new required version did not gate until accepted'; end if;
    insert into public.patient_consents (patient_id, organisation_id, consent_type, version, consent_version_id, action, accepted_at, created_at)
      values (pat, v_org, v_old.consent_type, 'proof-bump-v2', v_new, 'accepted', v_t + interval '50 seconds', v_t + interval '50 seconds');
    if not private.has_required_consents(pat) then raise exception 'FAIL 2b: accepting the new required version did not reopen the gate'; end if;
  end;

  -- 3. withdrawing a required purpose closes the gate; a later re-acceptance reopens it
  select id, consent_type, version into cv from public.consent_versions where is_current and not is_optional order by consent_type limit 1;
  insert into public.patient_consents (patient_id, organisation_id, consent_type, version, consent_version_id, action, created_at)
    values (pat, v_org, cv.consent_type, cv.version, cv.id, 'withdrawn', v_t + interval '100 seconds');
  if private.has_required_consents(pat) then raise exception 'FAIL 3a: still true after a required purpose was withdrawn'; end if;
  insert into public.patient_consents (patient_id, organisation_id, consent_type, version, consent_version_id, action, accepted_at, created_at)
    values (pat, v_org, cv.consent_type, cv.version, cv.id, 'accepted', v_t + interval '200 seconds', v_t + interval '200 seconds');
  if not private.has_required_consents(pat) then raise exception 'FAIL 3b: false after re-accepting the withdrawn required purpose'; end if;

  -- 4. accepting then withdrawing the optional purpose never changes the gate
  insert into public.patient_consents (patient_id, organisation_id, consent_type, version, consent_version_id, action, accepted_at, created_at)
    values (pat, v_org, 'research', 'proof-v1', v_opt, 'accepted', v_t + interval '300 seconds', v_t + interval '300 seconds');
  insert into public.patient_consents (patient_id, organisation_id, consent_type, version, consent_version_id, action, created_at)
    values (pat, v_org, 'research', 'proof-v1', v_opt, 'withdrawn', v_t + interval '400 seconds');
  if not private.has_required_consents(pat) then raise exception 'FAIL 4: an optional withdrawal closed the gate'; end if;

  -- 5. SABOTAGE: drop the is_optional filter (the pre-S04 behaviour). Check 2 must then fail for a patient who has
  -- not accepted the optional purpose.
  select pg_get_functiondef('private.has_required_consents(uuid)'::regprocedure) into src;
  src := replace(src, E'      and not cv.is_optional\n', '');
  if src like '%not cv.is_optional%' then raise exception 'sabotage did not apply'; end if;
  execute src;
  declare pat2 uuid := gen_random_uuid(); ok boolean;
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data)
      values (pat2, 's04c-pat2@example.invalid', 'x', now(), now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name, phone)
      values (pat2, v_org, 'patient', 'S04C Patient Two', '+2348011150002') on conflict (id) do nothing;
    n := 0;
    for cv in select id, consent_type, version from public.consent_versions where is_current and not is_optional loop
      n := n + 1;
      insert into public.patient_consents (patient_id, organisation_id, consent_type, version, consent_version_id, action, accepted_at, created_at)
        values (pat2, v_org, cv.consent_type, cv.version, cv.id, 'accepted', v_t + make_interval(secs => n), v_t + make_interval(secs => n));
    end loop;
    ok := private.has_required_consents(pat2);
    if ok then raise exception 'SABOTAGE: without the is_optional filter an unaccepted optional purpose should block, so check 2 could not have caught a regression'; end if;
  end;
end $$;

rollback;
