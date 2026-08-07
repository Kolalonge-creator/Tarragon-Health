-- Health Passport as a verifiable credential — the security model, proven live
-- in a rolled-back transaction.
--
-- This is the second surface on the platform readable with no account at all
-- (the first being the emergency card), so every claim made about it is checked
-- here rather than asserted in a comment. Every negative is paired with a
-- positive control: "anon sees no clinical content" only means something once
-- "anon with a real reference sees the verification answer" also passes.
--
-- The single most important assertion in this file is §4. If the public
-- verification payload ever grows a clinical key, a reference in a URL stops
-- being a question about a document and becomes a health-record disclosure.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/health_passport_verification.sql
-- (from the MAIN checkout — see reference_supabase_cli_sql_access)

begin;

-- `db query` discards RAISE NOTICE, so progress is collected in a table and
-- selected at the end. It needs an explicit grant: most of this script runs
-- under `set local role authenticated`/`anon`, and a temp table created by the
-- connection role is not reachable from either without one.
create temp table result (seq int generated always as identity, line text) on commit drop;
grant insert, select on result to authenticated, anon;
grant usage, select on all sequences in schema pg_temp to authenticated, anon;

-- The test key. Inserted before any `set local role`, because there is
-- deliberately no insert policy on this table — registration goes through an
-- admin-gated RPC in real life.
insert into public.passport_signing_keys (kid, public_key_spki, activated_at)
values ('thp-selftest', repeat('A', 44), now());

do $$
declare
  v_patient  uuid;
  v_other    uuid;
  v_org      uuid;
  v_dob      date;
  v_name     text;
  v_mint     jsonb;
  v_mint2    jsonb;
  v_id       uuid;
  v_serial   text;
  v_payload  jsonb;
  v_count    integer;
  v_failed   boolean;
  v_status   text;
  v_req      uuid;
begin
  -- Two real patients who can actually hold a passport. Discovered rather than
  -- hardcoded: pinned UUIDs rot every time the test accounts are rebuilt, and a
  -- test that silently stops covering anything is worse than no test.
  select id, organisation_id, date_of_birth, full_name
    into v_patient, v_org, v_dob, v_name
  from public.profiles
  where role = 'patient' and receives_care and organisation_id is not null
    and full_name is not null and date_of_birth is not null
  order by created_at
  limit 1;

  if v_patient is null then
    raise exception 'SETUP: no patient with an organisation, a name and a date of birth to test with';
  end if;

  select id into v_other
  from public.profiles
  where role = 'patient' and receives_care and organisation_id is not null
    and id <> v_patient
  limit 1;

  insert into result (line) values (format('SETUP: patient %s in org %s', v_patient, v_org));

  -- ------------------------------------------------------- 1. mint and seal
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_mint := public.mint_health_passport(null);
  v_id := (v_mint->>'id')::uuid;
  v_serial := v_mint->>'serial';

  if v_serial !~ '^THP(-[0-9A-HJKMNP-TV-Z]{4}){4}$' then
    raise exception 'FAIL 1: serial % is not in the printable reference format', v_serial;
  end if;

  -- The identity in the credential comes from the DATABASE, not from the
  -- caller. mint takes no name parameter at all, which is what makes it
  -- impossible for a tampered client to sign somebody else's name.
  if v_mint->>'subject_name' <> trim(v_name) then
    raise exception 'FAIL 1b: mint returned a name the profile does not hold';
  end if;

  select status::text into v_status from public.health_passport_issuances where id = v_id;
  if v_status <> 'unsigned' then
    raise exception 'FAIL 1c: a freshly minted passport must be unsigned until it is signed';
  end if;
  insert into result (line) values (format('PASS 1: minted %s, unsigned, identity from the DB', v_serial));

  -- ------------------------------- 2. an unsigned passport does not exist publicly
  reset role;
  perform set_config('request.jwt.claims', null, true);
  set local role anon;

  if public.health_passport_by_serial(v_serial) is not null then
    raise exception 'FAIL 2: an unsigned issuance resolved publicly — no such document can be in anyone''s hands';
  end if;
  insert into result (line) values ('PASS 2: an unsigned issuance does not resolve publicly');

  -- ------------------------------------------------------------- 3. seal it
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  perform public.seal_health_passport(
    v_id,
    jsonb_build_object('vitals', '[]'::jsonb, 'bmi', null),
    repeat('a', 64),
    '{"v":1}',
    repeat('S', 86),
    'thp-selftest'
  );

  select status::text into v_status from public.health_passport_issuances where id = v_id;
  if v_status <> 'valid' then
    raise exception 'FAIL 3: sealing did not make the passport valid';
  end if;
  insert into result (line) values ('PASS 3: sealing makes the passport valid');

  -- A malformed digest must be refused, not stored: the digest is printed on
  -- the document and compared by eye.
  v_failed := false;
  begin
    perform public.seal_health_passport(v_id, '{}'::jsonb, 'not-a-digest', '{}', repeat('S', 86), 'thp-selftest');
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 3b: a malformed content digest was accepted';
  end if;
  insert into result (line) values ('PASS 3b: a malformed content digest is refused');

  -- ------------------------------- 4. THE PAYLOAD CARRIES NO CLINICAL CONTENT
  reset role;
  perform set_config('request.jwt.claims', null, true);
  set local role anon;

  v_payload := public.health_passport_by_serial(v_serial);
  if v_payload is null then
    raise exception 'FAIL 4: anon with a real reference got nothing — the feature is useless';
  end if;

  -- Asserted as an exact key set so the dataset can never be widened silently.
  -- Every key here answers a question about a DOCUMENT. None of them is a
  -- vital, a diagnosis, a medicine or a result, and none ever may be.
  if exists (
    select 1 from jsonb_object_keys(v_payload) k
    where k not in ('serial','status','issuer','issuer_domain','issued_at','expires_at',
                    'revoked_at','content_digest','signature','signed_payload','signing_kid',
                    'signing_public_key','signing_algorithm','subject_name_masked',
                    'subject_year_of_birth','identity_confirmed','subject_name',
                    'subject_patient_number','attestation')
  ) then
    raise exception 'FAIL 4: the public payload exposes an unexpected key — the dataset has been widened';
  end if;
  if v_payload->>'status' <> 'valid' then
    raise exception 'FAIL 4b: a sealed, current passport did not report as valid';
  end if;
  insert into result (line) values ('PASS 4: public payload keys are exactly the intended non-clinical set');

  -- ------------------------------------------- 5. identity is released in stages
  if v_payload->>'subject_name' is not null then
    raise exception 'FAIL 5: the full name was released without the date-of-birth check';
  end if;
  if v_payload->>'subject_name_masked' is null then
    raise exception 'FAIL 5b: no masked name was offered, so a verifier cannot cross-check at all';
  end if;
  if position(split_part(trim(v_name), ' ', 2) in coalesce(v_payload->>'subject_name_masked','')) > 0
     and length(split_part(trim(v_name), ' ', 2)) > 1 then
    raise exception 'FAIL 5c: the masked name still contains a family name in full';
  end if;

  v_payload := public.health_passport_by_serial(v_serial, v_dob + 1);
  if (v_payload->>'identity_confirmed')::boolean then
    raise exception 'FAIL 5d: a WRONG date of birth confirmed the identity';
  end if;
  if v_payload->>'subject_name' is not null then
    raise exception 'FAIL 5e: a wrong date of birth still released the full name';
  end if;

  v_payload := public.health_passport_by_serial(v_serial, v_dob);
  if not (v_payload->>'identity_confirmed')::boolean then
    raise exception 'FAIL 5f: the CORRECT date of birth did not confirm the identity';
  end if;
  if v_payload->>'subject_name' is null then
    raise exception 'FAIL 5g: the correct date of birth did not release the full name';
  end if;
  insert into result (line) values ('PASS 5: full name released only to a caller who already knew the date of birth');

  -- ------------------------------------------- 6. a human can mistype the reference
  if public.health_passport_by_serial(lower(replace(v_serial, '-', ''))) is null then
    raise exception 'FAIL 6: a reference typed without dashes and in lower case did not resolve';
  end if;
  if public.health_passport_by_serial('THP-0000-0000-0000-0000') is not null then
    raise exception 'FAIL 6b: a made-up reference resolved';
  end if;
  if public.health_passport_by_serial('nonsense') is not null then
    raise exception 'FAIL 6c: junk resolved';
  end if;
  if public.health_passport_by_serial(null) is not null then
    raise exception 'FAIL 6d: a null reference resolved';
  end if;
  insert into result (line) values ('PASS 6: punctuation and case tolerated; junk and unknown references return nothing');

  -- --------------------------------------------- 7. anon cannot go around it
  v_failed := false;
  begin
    select count(*) into v_count from public.health_passport_issuances;
    if v_count > 0 then
      raise exception 'FAIL 7: anon read the issuances table directly';
    end if;
    v_failed := true;
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 7: anon reached health_passport_issuances';
  end if;

  v_failed := false;
  begin
    perform public.mint_health_passport(null);
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 7b: anon minted a passport';
  end if;

  v_failed := false;
  begin
    perform public.seal_health_passport(v_id, '{}'::jsonb, repeat('a',64), '{}', repeat('S',86), 'thp-selftest');
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 7c: anon sealed a passport';
  end if;
  insert into result (line) values ('PASS 7: anon can only ask about a reference — not read, mint or seal');

  -- ------------------------------------------------- 8. every check is logged
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count
  from public.health_passport_verifications where issuance_id = v_id;
  if v_count < 4 then
    raise exception 'FAIL 8: only % checks logged, so the patient cannot see who has been looking', v_count;
  end if;
  select verification_count into v_count from public.health_passport_issuances where id = v_id;
  if v_count < 4 then
    raise exception 'FAIL 8b: the issuance''s own check counter did not keep up';
  end if;
  insert into result (line) values (format('PASS 8: %s checks logged and counted back to the patient', v_count));

  -- ------------------------------------ 9. issuing a replacement supersedes
  v_mint2 := public.mint_health_passport(null);
  perform public.seal_health_passport(
    (v_mint2->>'id')::uuid,
    '{}'::jsonb, repeat('b', 64), '{"v":1}', repeat('T', 86), 'thp-selftest'
  );

  select status::text into v_status from public.health_passport_issuances where id = v_id;
  if v_status <> 'superseded' then
    raise exception 'FAIL 9: the previous passport was not superseded, so two documents both claim to be current';
  end if;

  reset role;
  set local role anon;
  v_payload := public.health_passport_by_serial(v_serial);
  if v_payload->>'status' <> 'superseded' then
    raise exception 'FAIL 9b: a superseded passport does not report as superseded';
  end if;
  -- Superseded is NOT revoked. That document was genuinely issued and is
  -- genuinely ours; telling a consulate otherwise would be both wrong and, for
  -- the patient, quietly catastrophic.
  if v_payload->>'status' = 'revoked' then
    raise exception 'FAIL 9c: a replaced passport was reported as withdrawn';
  end if;
  insert into result (line) values ('PASS 9: a replacement supersedes the old one, and superseded is distinct from withdrawn');

  -- ------------------------------------------------------ 10. revocation
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.revoke_health_passport((v_mint2->>'id')::uuid, 'test');

  reset role;
  set local role anon;
  v_payload := public.health_passport_by_serial(v_mint2->>'serial');
  if v_payload->>'status' <> 'revoked' then
    raise exception 'FAIL 10: a revoked passport still reports as current — revocation is the main control';
  end if;
  insert into result (line) values ('PASS 10: a revoked passport reports as withdrawn on the very next check');

  -- ------------------------- 11. one patient cannot act on another's passport
  if v_other is not null then
    reset role;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
    set local role authenticated;

    v_failed := false;
    begin
      perform public.seal_health_passport(v_id, '{}'::jsonb, repeat('c',64), '{}', repeat('U',86), 'thp-selftest');
    exception when others then v_failed := true;
    end;
    if not v_failed then
      raise exception 'FAIL 11: one patient sealed another patient''s passport';
    end if;

    v_failed := false;
    begin
      perform public.revoke_health_passport(v_id, 'not mine');
    exception when others then v_failed := true;
    end;
    if not v_failed then
      raise exception 'FAIL 11b: one patient revoked another patient''s passport';
    end if;
    insert into result (line) values ('PASS 11: a passport can only be sealed or revoked by its own patient (or org staff)');
  end if;

  -- ---------------------------- 12. attestation cannot exist without a number
  -- The constraint, tested directly rather than through the RPC, because it is
  -- the backstop that has to hold even if the RPC is ever bypassed. An attested
  -- passport that cannot name a registered doctor is exactly the unverifiable
  -- claim this whole feature exists to stop making.
  reset role;
  perform set_config('request.jwt.claims', null, true);

  v_failed := false;
  begin
    update public.health_passport_issuances
    set attested_by = v_patient, attested_at = now(),
        attesting_doctor_name = 'Someone', attesting_credential_type = 'MDCN',
        attesting_credential_number = null
    where id = v_id;
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 12: an attestation was stored with no registration number';
  end if;
  insert into result (line) values ('PASS 12: an attestation without a registration number is refused by the database itself');

  -- --------------------- 13. a patient cannot attest their own passport request
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_req := public.request_health_passport_attestation('Self-test purpose', null);
  if v_req is null then
    raise exception 'FAIL 13: a patient could not request an attestation';
  end if;

  v_failed := false;
  begin
    perform public.attest_health_passport_request(v_req, 'I attest my own record');
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 13b: a patient attested their own record';
  end if;
  insert into result (line) values ('PASS 13: a patient may request an attestation but never grant one');

  reset role;
  insert into result (line) values ('ALL HEALTH PASSPORT CHECKS PASSED');
end $$;

select line from result order by seq;

rollback;
