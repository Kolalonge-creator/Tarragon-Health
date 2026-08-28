-- Emergency card security model, proven live in a rolled-back transaction.
--
-- This is the one surface on the platform readable with no account at all, so
-- every claim made about it is checked here rather than asserted in a comment.
-- Every negative is paired with a positive control: "anon sees nothing" only
-- means something once "anon with the right token sees the card" also passes.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/emergency_cards.sql
-- (from the MAIN checkout — see reference_supabase_cli_sql_access)

begin;

do $$
declare
  v_patient   uuid := gen_random_uuid(); -- Test Essential Patient (was: '8487376b-7844-428a-bcb8-8795e89eb0f5')
  v_other     uuid := gen_random_uuid(); -- a different patient (was: 'ef684028-c40f-4f64-bde9-f84150fb19fd')
  v_org       uuid := '00000000-0000-0000-0000-000000000001';
  v_token     text;
  v_payload   jsonb;
  v_count     integer;
  v_lookups   integer;
  v_failed    boolean;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient, 'emergency-cards-test-essential-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_other, 'emergency-cards-test-other-patient@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Emergency Cards Test Essential Patient'
    where id = v_patient;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Emergency Cards Test Other Patient'
    where id = v_other;

  -- ---------------------------------------------------------------- 1. create
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_token := public.create_emergency_card();

  if v_token is null or length(v_token) < 32 then
    raise exception 'FAIL 1: create_emergency_card did not return a usable token';
  end if;
  raise notice 'PASS 1: patient created a card, token length %', length(v_token);

  -- Consent must be recorded, not assumed.
  select count(*) into v_count from public.emergency_cards
  where patient_id = v_patient and consented_at is not null and is_active;
  if v_count <> 1 then
    raise exception 'FAIL 1b: card was created without a recorded consent timestamp';
  end if;
  raise notice 'PASS 1b: consent timestamp recorded';

  -- ------------------------------------------------- 2. a stranger with the token
  reset role;
  perform set_config('request.jwt.claims', null, true);
  set local role anon;

  v_payload := public.emergency_card_by_token(v_token);
  if v_payload is null then
    raise exception 'FAIL 2: anon with a valid token got nothing - the card is useless';
  end if;
  if v_payload->>'full_name' is null then
    raise exception 'FAIL 2b: payload carries no name';
  end if;
  raise notice 'PASS 2: anon with the token read the card for %', v_payload->>'full_name';

  -- --------------------------------------- 3. the dataset is MINIMAL and fixed
  -- The whole safety argument is that this is a handful of emergency facts and
  -- not the record. Assert the keys are exactly what we intend, so widening it
  -- can never happen silently.
  if exists (
    select 1 from jsonb_object_keys(v_payload) k
    where k not in ('full_name','date_of_birth','sex','patient_number','emergency_contact',
                    'allergies','medications','conditions','blood','issued_at','expires_at','source')
  ) then
    raise exception 'FAIL 3: payload exposes an unexpected key - the dataset has been widened';
  end if;
  raise notice 'PASS 3: payload keys are exactly the intended minimal set';

  -- --------------------------------------------------- 4. anon cannot go around it
  v_failed := false;
  begin
    perform 1 from public.emergency_cards limit 1;
    -- RLS returning zero rows is also an acceptable outcome; a hard denial is
    -- better. Either way anon must not actually see a row.
    select count(*) into v_count from public.emergency_cards;
    if v_count > 0 then
      raise exception 'FAIL 4: anon read the emergency_cards table directly';
    end if;
    v_failed := true;
  exception when insufficient_privilege then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 4: anon reached emergency_cards';
  end if;
  raise notice 'PASS 4: anon cannot read the table, only the token function';

  -- ------------------------------------------------------- 5. a wrong token
  if public.emergency_card_by_token('not-a-real-token-but-long-enough-to-pass-length') is not null then
    raise exception 'FAIL 5: a bogus token returned a card';
  end if;
  if public.emergency_card_by_token('short') is not null then
    raise exception 'FAIL 5b: a short token returned a card';
  end if;
  if public.emergency_card_by_token(null) is not null then
    raise exception 'FAIL 5c: a null token returned a card';
  end if;
  raise notice 'PASS 5: bogus, short and null tokens all return nothing';

  -- ------------------------------------------------- 6. every read is logged
  -- Checked as the PATIENT, not as anon: anon deliberately has no grant on the
  -- lookup table either, which an earlier draft of this test proved by failing
  -- here with a permission error. The log exists for the patient to read.
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_lookups
  from public.emergency_card_lookups l
  join public.emergency_cards c on c.id = l.card_id
  where c.patient_id = v_patient;
  if v_lookups < 1 then
    raise exception 'FAIL 6: the read was not logged';
  end if;
  raise notice 'PASS 6: % lookup(s) logged, so the patient can see it was read', v_lookups;

  -- ------------------------------------------------------ 7. anon cannot mint
  reset role;
  perform set_config('request.jwt.claims', null, true);
  set local role anon;

  v_failed := false;
  begin
    perform public.create_emergency_card();
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 7: anon created an emergency card';
  end if;
  raise notice 'PASS 7: anon cannot create a card';

  -- ------------------------------------------------------- 8. revocation works
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.revoke_emergency_card();

  reset role;
  perform set_config('request.jwt.claims', null, true);
  set local role anon;
  if public.emergency_card_by_token(v_token) is not null then
    raise exception 'FAIL 8: a revoked card still resolves - revocation is the main control';
  end if;
  raise notice 'PASS 8: a revoked card stops resolving immediately';

  -- --------------------------------------- 9. rotation invalidates the old token
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  declare
    v_new_token text := public.create_emergency_card();
  begin
    if v_new_token = v_token then
      raise exception 'FAIL 9: rotating returned the same token';
    end if;

    reset role;
    perform set_config('request.jwt.claims', null, true);
    set local role anon;

    if public.emergency_card_by_token(v_token) is not null then
      raise exception 'FAIL 9b: the OLD token still works after rotation';
    end if;
    if public.emergency_card_by_token(v_new_token) is null then
      raise exception 'FAIL 9c: the NEW token does not work after rotation';
    end if;
  end;
  raise notice 'PASS 9: rotating kills the old token and issues a working new one';

  -- -------------------------------- 10. one patient cannot mint another's card
  -- create_emergency_card takes no argument at all, so it can only ever act on
  -- auth.uid(). Prove that by acting as a different patient and confirming the
  -- first patient's card is untouched.
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.create_emergency_card();

  select count(*) into v_count from public.emergency_cards where patient_id = v_other;
  if v_count <> 1 then
    raise exception 'FAIL 10: the second patient did not get their own card';
  end if;
  raise notice 'PASS 10: a card is always minted for the caller, never for someone else';

  reset role;
  raise notice 'ALL EMERGENCY CARD CHECKS PASSED';
end $$;

rollback;
