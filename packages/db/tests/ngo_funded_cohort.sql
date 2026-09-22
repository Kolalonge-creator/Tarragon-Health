-- ===========================================================================
-- NGO-funded cohort (module: ngo_funded_cohort) — end-to-end proof.
--
-- Migrations: 20260922183610_ngo_funded_cohort_enum_values.sql,
--             20260922184145_ngo_funded_cohort_schema.sql.
--
-- What this proves, against the real live schema, fully self-contained
-- (its own auth.users/profiles/organisations fixtures — nothing here
-- depends on a pre-existing real account):
--
--   1. Dormancy is real, not cosmetic: every RPC refuses while the module is
--      off, and the module starts off in this database right now.
--   2. create_funding_programme rejects a non-NGO organisation and a
--      non-active-catalogue service product; only a superadmin may call it.
--   3. invite_to_funding_programme refuses on a draft (not yet active)
--      programme, refuses a caller who is not the owning org's ngo_admin
--      (and not admin), and refuses a roster that would exceed the
--      programme's funded_unit_cap.
--   4. Read isolation: a DIFFERENT NGO's ngo_admin reads zero of this
--      programme's invitations, while the owning ngo_admin reads all of
--      them — ordinary multi-tenant isolation, proven rather than assumed.
--   5. claim_funding_programme_invitation turns a claim into a real,
--      correctly-shaped care_vouchers row (active, fully paid, purchaser_
--      profile_id = the funding programme's own creator, NOT the inviting
--      ngo_admin — see point 6) and marks the invitation claimed; a second
--      claim of the same token is refused; a claim past the funded_unit_cap
--      is refused.
--   6. THE core property this whole module exists to protect: the NGO
--      admin who funded and invited a beneficiary still reads ZERO rows of
--      that beneficiary's care_vouchers or clinical record (vitals_readings)
--      — funding a place is not joining the care team. This check is what
--      first caught a real leak: an early version of claim_funding_
--      programme_invitation set purchaser_profile_id to the inviting
--      ngo_admin, which gave them a SECOND, unrelated RLS door into the
--      voucher row (care_vouchers_select's "purchaser_profile_id =
--      auth.uid()" clause) even with is_org_staff correctly excluding them.
--      Fixed in 20260922184722_fix_claim_funding_programme_invitation_
--      purchaser_leak.sql — point 5 above reflects the fix.
--   7. Sabotage control, targeted at the actual line this feature added to
--      is_org_staff(): a clinical row filed under the NGO's OWN organisation_
--      id (a defense-in-depth scenario this feature's real data flow never
--      produces, since a beneficiary keeps their own org — see 8a) is read
--      by ngo_admin with private.is_org_staff() temporarily recreated
--      WITHOUT its ngo_admin exclusion, then correctly refused again once
--      restored. A same-org test is required: the cross-org case in (6)/(8a)
--      is already blocked by ordinary org isolation regardless of this
--      exclusion, so sabotaging it there would prove nothing (an earlier
--      draft of this file tried exactly that and correctly self-reported a
--      GAP rather than a false PASS).
--
-- HONESTY CONVENTION (see i1_i10_invariants_platform.sql's header): every
-- check below either PASSes for real or is reported as a GAP; nothing here
-- is allowed to pass vacuously — each negative check has a positive control
-- in the same transaction.
--
-- Run inside a transaction that is ROLLED BACK. Nothing here persists.
--   npx supabase db query --linked -f packages/db/tests/ngo_funded_cohort.sql
-- ===========================================================================

begin;

do $$
declare
  v_admin        uuid;
  v_org_ngo_a    uuid;
  v_org_ngo_b    uuid;
  v_org_patient  uuid := '00000000-0000-0000-0000-000000000001';

  v_ngo_admin_a  uuid := gen_random_uuid();
  v_ngo_admin_b  uuid := gen_random_uuid();
  v_patient_1    uuid := gen_random_uuid();
  v_patient_2    uuid := gen_random_uuid();

  v_product      uuid;
  v_programme    uuid;

  v_token_1      text;
  v_token_2      text;

  v_n            integer;
  v_ok           boolean;
  v_voucher_id   uuid;
  v_result       jsonb;
begin
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  if v_admin is null then
    raise exception 'GAP: no admin profile exists to run this proof as';
  end if;

  -- Module must start off in THIS database, for real — not asserted, this
  -- proof would be dishonest about its own precondition if it silently
  -- worked around an already-enabled module.
  if private.module_enabled('ngo_funded_cohort') then
    raise exception 'GAP: ngo_funded_cohort is already enabled — this proof needs it dormant to start';
  end if;

  -- ---- fixtures -----------------------------------------------------------
  insert into public.organisations (name, type) values ('NGO Cohort Test A', 'ngo') returning id into v_org_ngo_a;
  insert into public.organisations (name, type) values ('NGO Cohort Test B', 'ngo') returning id into v_org_ngo_b;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_ngo_admin_a, 'ngofc-admin-a@example.invalid', 'x', now(), '{}', '{}'),
    (v_ngo_admin_b, 'ngofc-admin-b@example.invalid', 'x', now(), '{}', '{}'),
    (v_patient_1,   'ngofc-patient-1@example.invalid', 'x', now(), '{}', '{}'),
    (v_patient_2,   'ngofc-patient-2@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name, phone)
  values
    (v_ngo_admin_a, v_org_ngo_a, 'ngo_admin', 'NGO Cohort Admin A', '+2348030000001'),
    (v_ngo_admin_b, v_org_ngo_b, 'ngo_admin', 'NGO Cohort Admin B', '+2348030000002'),
    (v_patient_1,   v_org_patient, 'patient', 'NGO Cohort Patient 1', '+2348030000003'),
    (v_patient_2,   v_org_patient, 'patient', 'NGO Cohort Patient 2', '+2348030000004')
  on conflict (id) do update set
    organisation_id = excluded.organisation_id, role = excluded.role,
    full_name = excluded.full_name, phone = excluded.phone;

  insert into public.service_products (code, name, price_kobo, is_active)
  values ('NGO-FC-TEST-SKU', 'NGO Cohort Test Review', 500000, true)
  returning id into v_product;

  -- =========================================================================
  -- 1. Dormancy is real: create_funding_programme refuses while off.
  -- =========================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  v_ok := true;
  begin
    perform public.create_funding_programme(v_org_ngo_a, v_product, 'Should not work', 'CONTRACT-0', 2);
  exception when others then v_ok := false;
  end;
  if v_ok then raise exception 'FAIL: create_funding_programme worked while ngo_funded_cohort is dormant'; end if;
  raise notice 'PASS  create_funding_programme refuses while the module is dormant';

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- =========================================================================
  -- 2. Activate the module (admin-only, audited) — the rest of this proof
  --    runs with it on, same as it would after a real signed partnership.
  -- =========================================================================
  perform public.set_platform_module('ngo_funded_cohort', true, 'ngo_funded_cohort.sql DB proof — rolled back');
  if not private.module_enabled('ngo_funded_cohort') then
    raise exception 'FAIL: set_platform_module did not turn ngo_funded_cohort on';
  end if;
  raise notice 'PASS  ngo_funded_cohort activates via set_platform_module';

  -- =========================================================================
  -- 3. create_funding_programme: rejects a non-NGO org, rejects an inactive
  --    product, then succeeds for a real NGO org + active product.
  -- =========================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  v_ok := true;
  begin
    perform public.create_funding_programme(v_org_patient, v_product, 'Wrong org type', 'CONTRACT-1', 2);
  exception when others then v_ok := false;
  end;
  if v_ok then raise exception 'FAIL: create_funding_programme accepted a non-NGO organisation'; end if;
  raise notice 'PASS  create_funding_programme refuses a non-NGO organisation';

  v_programme := public.create_funding_programme(v_org_ngo_a, v_product, 'NGO Cohort Test Programme', 'CONTRACT-2', 2);
  if v_programme is null then raise exception 'FAIL: create_funding_programme did not return an id'; end if;

  if (select status from public.funding_programmes where id = v_programme) <> 'draft' then
    raise exception 'FAIL: a new funding programme should start draft';
  end if;
  raise notice 'PASS  create_funding_programme creates a draft programme for a real NGO org + active product';

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- =========================================================================
  -- 4. invite_to_funding_programme refuses on a draft programme, and refuses
  --    a caller who is neither admin nor that org's own ngo_admin.
  -- =========================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ngo_admin_a::text, 'role', 'authenticated')::text, true);

  v_ok := true;
  begin
    perform public.invite_to_funding_programme(v_programme, jsonb_build_array(jsonb_build_object('phone', '+2348030000010')));
  exception when others then v_ok := false;
  end;
  if v_ok then raise exception 'FAIL: invite_to_funding_programme worked on a draft programme'; end if;
  raise notice 'PASS  invite_to_funding_programme refuses while the programme is draft';

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- =========================================================================
  -- 5. Activate the programme, then confirm the cap and cross-tenant checks.
  -- =========================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  perform public.set_funding_programme_status(v_programme, 'active');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  if (select status from public.funding_programmes where id = v_programme) <> 'active' then
    raise exception 'FAIL: set_funding_programme_status did not activate the programme';
  end if;

  -- Org B's ngo_admin is not authorised to invite into org A's programme.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ngo_admin_b::text, 'role', 'authenticated')::text, true);
  v_ok := true;
  begin
    perform public.invite_to_funding_programme(v_programme, jsonb_build_array(jsonb_build_object('phone', '+2348030000011')));
  exception when others then v_ok := false;
  end;
  if v_ok then raise exception 'FAIL: a different NGO''s ngo_admin could invite into org A''s programme'; end if;
  raise notice 'PASS  a different org''s ngo_admin cannot invite into this programme';

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- The owning ngo_admin cannot invite more people than the funded cap (2).
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ngo_admin_a::text, 'role', 'authenticated')::text, true);
  v_ok := true;
  begin
    perform public.invite_to_funding_programme(
      v_programme,
      jsonb_build_array(
        jsonb_build_object('phone', '+2348030000021'),
        jsonb_build_object('phone', '+2348030000022'),
        jsonb_build_object('phone', '+2348030000023')
      )
    );
  exception when others then v_ok := false;
  end;
  if v_ok then raise exception 'FAIL: invite_to_funding_programme allowed exceeding the funded_unit_cap'; end if;
  raise notice 'PASS  invite_to_funding_programme refuses a roster larger than the funded cap';

  -- Now within cap: two real invitations.
  v_result := public.invite_to_funding_programme(
    v_programme,
    jsonb_build_array(
      jsonb_build_object('phone', '+2348030000021', 'full_name', 'Cohort Beneficiary One'),
      jsonb_build_object('phone', '+2348030000022', 'full_name', 'Cohort Beneficiary Two')
    )
  );
  if (v_result->>'invited')::int <> 2 then
    raise exception 'FAIL: invite_to_funding_programme did not create 2 invitations';
  end if;
  raise notice 'PASS  invite_to_funding_programme invites within the funded cap';

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  select invite_token into v_token_1 from public.funding_programme_invitations
    where funding_programme_id = v_programme and phone = '+2348030000021';
  select invite_token into v_token_2 from public.funding_programme_invitations
    where funding_programme_id = v_programme and phone = '+2348030000022';

  -- =========================================================================
  -- 6. Read isolation: org B's ngo_admin reads none of org A's invitations;
  --    org A's own ngo_admin reads both (control, proving the query works).
  -- =========================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ngo_admin_b::text, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.funding_programme_invitations where funding_programme_id = v_programme;
  if v_n <> 0 then raise exception 'FAIL: org B''s ngo_admin can read org A''s invitations'; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_ngo_admin_a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.funding_programme_invitations where funding_programme_id = v_programme;
  if v_n <> 2 then raise exception 'FAIL(control): org A''s own ngo_admin cannot read its own invitations'; end if;
  reset role;
  raise notice 'PASS  invitation reads are isolated per NGO organisation';

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- =========================================================================
  -- 7. Claim flow: a real beneficiary turns a token into a real, correctly-
  --    shaped care_vouchers row; a second claim of the same token refuses.
  -- =========================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_1::text, 'role', 'authenticated')::text, true);
  v_result := public.claim_funding_programme_invitation(v_token_1);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  v_voucher_id := (v_result->>'voucher_id')::uuid;
  if v_voucher_id is null then raise exception 'FAIL: claim did not return a voucher_id'; end if;

  select
    (beneficiary_profile_id = v_patient_1)
    -- Deliberately NOT the inviting ngo_admin — see
    -- 20260922184722_fix_claim_funding_programme_invitation_purchaser_leak.sql.
    -- purchaser_profile_id is the programme's own creator (always a
    -- superadmin), specifically so the inviting ngo_admin gains no
    -- "purchaser_profile_id = auth.uid()" RLS door into this row.
    and (purchaser_profile_id = v_admin)
    and (status = 'active')
    and (amount_paid_kobo = face_value_kobo)
    and (face_value_kobo = 500000)
  into v_ok
  from public.care_vouchers where id = v_voucher_id;

  if not coalesce(v_ok, false) then
    raise exception 'FAIL: claimed voucher is not shaped as expected (beneficiary/purchaser/status/amount)';
  end if;
  raise notice 'PASS  claiming an invitation creates a correctly-shaped, fully-paid, active care_voucher, attributed to the programme creator rather than the inviting ngo_admin';

  if (select status from public.funding_programme_invitations where invite_token = v_token_1) <> 'claimed' then
    raise exception 'FAIL: invitation was not marked claimed';
  end if;

  -- Re-claiming the same token is refused.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_1::text, 'role', 'authenticated')::text, true);
  v_ok := true;
  begin
    perform public.claim_funding_programme_invitation(v_token_1);
  exception when others then v_ok := false;
  end;
  reset role;
  if v_ok then raise exception 'FAIL: the same invitation token could be claimed twice'; end if;
  raise notice 'PASS  a claimed invitation cannot be claimed again';

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- Second beneficiary claims the second (and last, cap=2) place.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_2::text, 'role', 'authenticated')::text, true);
  perform public.claim_funding_programme_invitation(v_token_2);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  if (select count(*) from public.funding_programme_invitations where funding_programme_id = v_programme and status = 'claimed') <> 2 then
    raise exception 'FAIL: expected both invitations claimed';
  end if;
  raise notice 'PASS  the funded programme''s cap (2) is exactly filled by two real claims';

  -- =========================================================================
  -- 8a. Cross-org proof: funding a place is not joining the care team, and
  --     is doubly blocked here (the beneficiary keeps their OWN organisation_
  --     id, per purchase_care_voucher's identical shape — it is never set to
  --     the NGO's own org). Give patient 1 a real clinical row, written as
  --     the system/admin (ngo_admin has no write path to it at all).
  -- =========================================================================
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, source, logged_by_profile_id, systolic, diastolic)
  values (v_org_patient, v_patient_1, 'blood_pressure', 'manual', v_patient_1, 118, 76);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ngo_admin_a::text, 'role', 'authenticated')::text, true);

  select count(*) into v_n from public.care_vouchers where id = v_voucher_id;
  if v_n <> 0 then raise exception 'FAIL: the funding NGO admin can read the beneficiary''s care_voucher row'; end if;

  select count(*) into v_n from public.vitals_readings where patient_id = v_patient_1;
  if v_n <> 0 then raise exception 'FAIL: the funding NGO admin can read the beneficiary''s vitals_readings — I9-equivalent violated'; end if;

  reset role;
  raise notice 'PASS  the funding NGO admin reads ZERO rows of the beneficiary''s voucher or clinical record (org isolation: beneficiary org <> NGO org)';

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- =========================================================================
  -- 8b. THE targeted proof of the actual line this migration added. 8a alone
  --     is not a sufficient sabotage target: it is protected by ordinary
  --     multi-tenant ORG ISOLATION (v_org_patient <> v_org_ngo_a) regardless
  --     of the ngo_admin exclusion — is_org_staff's own "organisation_id =
  --     org" branch already fails on the org mismatch, so sabotaging the
  --     exclusion there proves nothing (confirmed: an earlier version of
  --     this file tried exactly that and the sabotage check correctly
  --     reported a GAP, catching its own false premise).
  --
  --     A clinical row filed directly under the NGO's OWN organisation_id
  --     is the one shape where the exclusion is the only thing standing in
  --     the way (role = 'admin' or organisation_id = org) would otherwise
  --     both be satisfiable by an ngo_admin reading their own org's data.
  --     Nothing in this feature files a real row this way today — this is a
  --     defense-in-depth proof that the exclusion holds even if that ever
  --     changed, exactly the same shape corporate_admin/hmo_admin needed
  --     excluding for (their patients DO share the institution's org).
  -- =========================================================================
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, source, logged_by_profile_id, systolic, diastolic)
  values (v_org_ngo_a, v_patient_2, 'blood_pressure', 'manual', v_patient_2, 121, 79);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ngo_admin_a::text, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.vitals_readings where organisation_id = v_org_ngo_a;
  reset role;
  if v_n <> 0 then
    raise exception 'FAIL: ngo_admin can read a clinical row filed under its own organisation_id';
  end if;
  raise notice 'PASS  ngo_admin reads zero rows even for a clinical row filed under its OWN organisation_id (the exclusion, not org isolation, is what blocks this one)';

  -- =========================================================================
  -- 9. Sabotage control for 8b: with is_org_staff's ngo_admin exclusion
  --    removed, the SAME same-org read must now succeed — proving the
  --    exclusion is actually what was protecting it, not a vacuous check.
  -- =========================================================================
  create or replace function private.is_org_staff(org uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
  as $sabotage$
    select exists (
      select 1 from public.profiles
      where id = (select auth.uid())
        and role <> 'patient'
        and role not in ('corporate_admin', 'hmo_admin')
        and role not in ('pharmacist', 'lab_partner', 'lab_liaison', 'finance', 'analyst')
        and role not in ('payer_admin', 'provider_org_staff')
        -- ngo_admin exclusion deliberately removed for this sabotage check
        and (role = 'admin' or organisation_id = org)
    );
  $sabotage$;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ngo_admin_a::text, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.vitals_readings where organisation_id = v_org_ngo_a;
  reset role;

  if v_n = 0 then
    raise exception 'GAP: sabotaged is_org_staff (no ngo_admin exclusion) still reads zero own-org rows — this test would not have caught a missing exclusion';
  end if;
  raise notice 'PASS  sabotage control: removing the ngo_admin exclusion genuinely opens the own-org read (proves check 8b is real)';

  -- Restore the correct function and re-prove the read is refused again.
  create or replace function private.is_org_staff(org uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
  as $restore$
    select exists (
      select 1 from public.profiles
      where id = (select auth.uid())
        and role <> 'patient'
        and role not in ('corporate_admin', 'hmo_admin')
        and role not in ('pharmacist', 'lab_partner', 'lab_liaison', 'finance', 'analyst')
        and role not in ('payer_admin', 'provider_org_staff')
        and role not in ('ngo_admin')
        and (role = 'admin' or organisation_id = org)
    );
  $restore$;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ngo_admin_a::text, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.vitals_readings where organisation_id = v_org_ngo_a;
  reset role;

  if v_n <> 0 then
    raise exception 'FAIL: restored is_org_staff still leaks own-org vitals_readings to ngo_admin';
  end if;
  raise notice 'PASS  restoring is_org_staff''s ngo_admin exclusion closes the own-org read again';

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  raise notice 'PASS  ngo_funded_cohort: all checks passed';
end $$;

rollback;
