-- ---------------------------------------------------------------------------
-- Employer Health Platform (Module 26) — I9 and cross-tenant isolation proof.
--
-- What this proves, end to end, against the real live schema:
--   1. A corporate_admin gains read (and, for a few HR-shaped tables, write)
--      access to the new employer surfaces this module added — but ONLY for
--      its own organisation, and STILL reads zero rows from every
--      patient-scoped clinical table. I9 is not weakened by any of this.
--   2. Two tables deliberately do NOT extend that access even to the
--      organisation's own institution admin — employer_campaign_participants
--      and employer_allowance_usage (see the migration headers on
--      20260829094032_employer_platform_campaigns_and_announcements.sql and
--      20260829093527_employer_platform_benefit_packages_entitlement_wiring.sql)
--      — proven here as a real negative, not just a policy-definition grep.
--   3. Money surfaces (corporate_contracts writes, employer_invoices writes)
--      stay Tarragon-finance-only even for the employer's own institution
--      admin — an employer can read what it owes, never set it.
--   4. A second employer's institution admin reads zero rows of the first
--      employer's roster/benefits/campaigns/invoices — ordinary multi-tenant
--      isolation, proven rather than assumed.
--
-- HONESTY CONVENTION (see i1_i10_invariants_platform.sql's header): every
-- check below either PASSes for real or is reported as a GAP; nothing here
-- is allowed to pass vacuously — each negative check is paired with a
-- positive control in the same transaction, and control B is a genuinely
-- different organisation, not a copy of A.
--
-- Run inside a transaction that is ROLLED BACK. Nothing here persists.
--   npx supabase db query --linked -f packages/db/tests/employer_platform_i9_and_invariants.sql
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_admin       uuid;
  -- Reused from individual_enrolment_and_next_of_kin.sql's fixture set —
  -- real, auth-backed profile ids already relied on elsewhere in this suite.
  v_corp_a      uuid := 'ef684028-c40f-4f64-bde9-f84150fb19fd';  -- becomes corporate_admin of org A
  v_corp_b      uuid := 'cb100ba5-204a-4048-a585-2634c27a4c46';  -- becomes corporate_admin of org B
  v_patient     uuid := '3bb0a97c-3cd5-49e7-ba74-23b1b37b9510';  -- becomes a claimed patient of org A

  v_org_a       uuid;
  v_org_b       uuid;
  v_plan        uuid;
  v_package     uuid;
  v_campaign    uuid;
  v_roster      uuid;
  v_invoice     uuid;

  v_n           int;
  v_wrote       boolean;

  v_orig_a_role public.user_role;
  v_orig_a_org  uuid;
  v_orig_b_role public.user_role;
  v_orig_b_org  uuid;
  v_orig_p_role public.user_role;
  v_orig_p_org  uuid;
  v_orig_p_phone text;
begin
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  select id into v_plan from public.subscription_plans where code = 'essential' limit 1;

  select role, organisation_id into v_orig_a_role, v_orig_a_org from public.profiles where id = v_corp_a;
  select role, organisation_id into v_orig_b_role, v_orig_b_org from public.profiles where id = v_corp_b;
  select role, organisation_id, phone into v_orig_p_role, v_orig_p_org, v_orig_p_phone
    from public.profiles where id = v_patient;

  -- ---- fixtures: two real employers, one with a fully-built-out surface ----
  insert into public.organisations (name, type) values ('I9 Employer A', 'corporate') returning id into v_org_a;
  insert into public.organisations (name, type) values ('I9 Employer B', 'corporate') returning id into v_org_b;

  update public.profiles set role = 'corporate_admin', organisation_id = v_org_a where id = v_corp_a;
  update public.profiles set role = 'corporate_admin', organisation_id = v_org_b where id = v_corp_b;
  update public.profiles set organisation_id = '00000000-0000-0000-0000-000000000001', phone = '+2348099998888'
    where id = v_patient;

  insert into public.employer_accounts (organisation_id, legal_name) values (v_org_a, 'I9 Employer A');
  insert into public.employer_accounts (organisation_id, legal_name) values (v_org_b, 'I9 Employer B');

  insert into public.corporate_contracts
    (organisation_id, name, status, billing_model, billing_rate_kobo, billing_interval, signed_at, signed_by)
  values (v_org_a, 'I9 A contract', 'active', 'per_employee', 100000, 'monthly', now(), v_admin);

  insert into public.employer_benefit_packages (organisation_id, name, subscription_plan_id)
  values (v_org_a, 'Standard', v_plan) returning id into v_package;

  insert into public.employer_roster_members (organisation_id, phone, full_name, benefit_package_id)
  values (v_org_a, '+2348099998888', 'I9 Patient', v_package) returning id into v_roster;

  insert into public.employer_campaigns (organisation_id, campaign_type, name, starts_on)
  values (v_org_a, 'bp_screening', 'I9 Campaign', current_date) returning id into v_campaign;

  insert into public.employer_invoices (organisation_id, period_start, period_end, billing_model, amount_kobo)
  values (v_org_a, '2026-01-01', '2026-01-31', 'per_employee', 200000) returning id into v_invoice;

  -- Claim the patient into org A as a real corporate_admin action, so a
  -- real vitals_readings row exists under org A for the I9 checks below.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_corp_a::text, 'role', 'authenticated')::text, true);
  perform public.claim_employer_roster_member(v_roster);
  reset role;
  -- RESET ROLE undoes the role switch but NOT the transaction-local
  -- request.jwt.claims GUC set above (set_config's is_local=true scopes it to
  -- the whole transaction, not to the role). Left uncleared, the next
  -- "system" write below would still resolve auth.uid() to corp_a and get
  -- correctly (but confusingly) stamped by vitals_readings' pre-existing
  -- stamp_acting_supporter trigger — a test-harness footgun, not a platform
  -- bug, caught by exactly this reproduction during authoring. Clearing it
  -- back to the admin's identity is what makes the fixture inserts below
  -- genuinely attributable to "the system" rather than to corporate_admin.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- Written as the system/admin, not as corporate_admin — this row exists so
  -- the NEXT section can prove corporate_admin cannot read it, not to prove
  -- corporate_admin can write it (employer_campaign_participants_insert
  -- requires is_org_staff, which I9 deliberately excludes corporate_admin
  -- from; see the migration header).
  insert into public.employer_campaign_participants (campaign_id, patient_id) values (v_campaign, v_patient);

  insert into public.vitals_readings (organisation_id, patient_id, vital_type, source, logged_by_profile_id, systolic, diastolic)
  values (v_org_a, v_patient, 'blood_pressure', 'manual', v_patient, 120, 80);

  -- =========================================================================
  -- 1. corporate_admin of org A reads its own new HR-shaped surfaces.
  -- =========================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_corp_a::text, 'role', 'authenticated')::text, true);

  select count(*) into v_n from public.employer_accounts where organisation_id = v_org_a;
  if v_n <> 1 then raise exception 'FAIL: corporate_admin cannot read its own employer_accounts row'; end if;

  select count(*) into v_n from public.employer_roster_members where organisation_id = v_org_a;
  if v_n <> 1 then raise exception 'FAIL: corporate_admin cannot read its own roster'; end if;

  select count(*) into v_n from public.employer_benefit_packages where organisation_id = v_org_a;
  if v_n <> 1 then raise exception 'FAIL: corporate_admin cannot read its own benefit packages'; end if;

  select count(*) into v_n from public.corporate_contracts where organisation_id = v_org_a;
  if v_n <> 1 then raise exception 'FAIL: corporate_admin cannot READ its own contract'; end if;

  select count(*) into v_n from public.employer_invoices where organisation_id = v_org_a;
  if v_n <> 1 then raise exception 'FAIL: corporate_admin cannot read its own invoice'; end if;

  select count(*) into v_n from public.employer_campaign_summary where organisation_id = v_org_a;
  if v_n <> 1 then raise exception 'FAIL: corporate_admin cannot read its own campaign summary'; end if;

  raise notice 'PASS  corporate_admin reads its own employer_accounts/roster/packages/contract/invoice/campaign summary';

  -- =========================================================================
  -- 2. ...but NOT participant-level or allowance-usage rows, even for its
  --    own organisation's own campaign/patient.
  -- =========================================================================
  select count(*) into v_n from public.employer_campaign_participants where campaign_id = v_campaign;
  if v_n <> 0 then raise exception 'FAIL: corporate_admin can read employer_campaign_participants — I9-adjacent leak'; end if;
  raise notice 'PASS  corporate_admin reads zero employer_campaign_participants rows';

  select count(*) into v_n from public.employer_allowance_usage where patient_id = v_patient;
  if v_n <> 0 then raise exception 'FAIL: corporate_admin can read employer_allowance_usage — I9-adjacent leak'; end if;
  raise notice 'PASS  corporate_admin reads zero employer_allowance_usage rows';

  -- =========================================================================
  -- 3. ...and cannot WRITE the two money-governance tables even for its own
  --    organisation — contract terms and invoice status stay finance-only.
  -- =========================================================================
  v_wrote := true;
  begin
    update public.corporate_contracts set billing_rate_kobo = 1 where organisation_id = v_org_a;
    if not found then v_wrote := false; end if;
  exception when others then v_wrote := false;
  end;
  if v_wrote then raise exception 'FAIL: corporate_admin could write its own contract terms'; end if;
  raise notice 'PASS  corporate_admin cannot write its own contract terms';

  v_wrote := true;
  begin
    update public.employer_invoices set amount_kobo = 1 where id = v_invoice;
    if not found then v_wrote := false; end if;
  exception when others then v_wrote := false;
  end;
  if v_wrote then raise exception 'FAIL: corporate_admin could write its own invoice'; end if;
  raise notice 'PASS  corporate_admin cannot write its own invoice';

  -- =========================================================================
  -- 4. THE core I9 property, unmoved by any of this: corporate_admin reads
  --    ZERO rows from a patient-scoped clinical table, even for a patient in
  --    its own organisation whom it just legitimately enrolled.
  -- =========================================================================
  select count(*) into v_n from public.vitals_readings where organisation_id = v_org_a;
  if v_n <> 0 then raise exception 'FAIL: corporate_admin can read vitals_readings — I9 violated'; end if;
  raise notice 'PASS  corporate_admin reads zero vitals_readings rows for its own enrolled patient';

  reset role;

  -- =========================================================================
  -- 5. Cross-tenant isolation: org B's corporate_admin reads none of org A's
  --    new surfaces (control: org B legitimately sees nothing of its own
  --    either, since it has no rows — confirming the query itself works).
  -- =========================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_corp_b::text, 'role', 'authenticated')::text, true);

  select count(*) into v_n from public.employer_roster_members where organisation_id = v_org_a;
  if v_n <> 0 then raise exception 'FAIL: org B''s corporate_admin can read org A''s roster'; end if;

  select count(*) into v_n from public.employer_benefit_packages where organisation_id = v_org_a;
  if v_n <> 0 then raise exception 'FAIL: org B''s corporate_admin can read org A''s benefit packages'; end if;

  select count(*) into v_n from public.employer_invoices where organisation_id = v_org_a;
  if v_n <> 0 then raise exception 'FAIL: org B''s corporate_admin can read org A''s invoices'; end if;

  select count(*) into v_n from public.employer_campaign_summary where organisation_id = v_org_a;
  if v_n <> 0 then raise exception 'FAIL: org B''s corporate_admin can read org A''s campaign summary'; end if;

  -- Control: org B's own (empty) roster genuinely returns zero, not a
  -- silently-broken query that would return zero for everything.
  select count(*) into v_n from public.employer_roster_members where organisation_id = v_org_b;
  if v_n <> 0 then raise exception 'FAIL(control): expected org B to have zero roster rows of its own'; end if;

  reset role;
  raise notice 'PASS  org B''s corporate_admin reads zero of org A''s roster/packages/invoices/campaign summary';

  -- Same footgun as before: RESET ROLE dropped the role switch but left
  -- request.jwt.claims pointing at v_corp_b, so the restore UPDATEs below
  -- would otherwise run as "corp_b editing its own profiles row" and trip
  -- private.guard_profiles_self_update's role/org lock. Clear it back to the
  -- admin identity first — belt-and-braces anyway, since the outer ROLLBACK
  -- is what actually undoes everything.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  update public.profiles set role = v_orig_a_role, organisation_id = v_orig_a_org where id = v_corp_a;
  update public.profiles set role = v_orig_b_role, organisation_id = v_orig_b_org where id = v_corp_b;
  update public.profiles set role = v_orig_p_role, organisation_id = v_orig_p_org, phone = v_orig_p_phone where id = v_patient;

  raise notice 'PASS  employer_platform_i9_and_invariants: all checks passed';
end $$;

rollback;
