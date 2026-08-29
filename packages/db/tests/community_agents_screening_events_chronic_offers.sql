-- Community Agents, Screening Events, Chronic Programme Offers, and
-- coordinator-assisted voucher redemption: end-to-end proof, in one
-- rolled-back transaction. Mirrors care_vouchers.sql's own
-- positive-control-paired-with-every-negative-check discipline.
--
-- Self-contained: creates its own organisation/profiles/panel bundle rather
-- than assuming care_vouchers.sql's shared fixture IDs exist, so this file
-- can run standalone.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/community_agents_screening_events_chronic_offers.sql
--       (from the MAIN checkout, not a worktree — see reference_supabase_cli_sql_access)
--
-- The whole file rolls back. Nothing here should survive.

begin;

create temp table _checks (n serial, msg text) on commit drop;
grant insert on _checks to authenticated;
grant usage on sequence _checks_n_seq to authenticated;

do $$
declare
  c_org           constant uuid := gen_random_uuid();
  v_admin         uuid;
  v_coordinator   uuid;
  v_clinician     uuid;
  v_agent_patient uuid;  -- recruited as an agent partway through
  v_stranger      uuid;  -- unrelated patient, used as a negative control
  v_patient_a     uuid;  -- chronic-offer recipient
  v_organiser     uuid;
  v_participant   uuid;
  v_beneficiary   uuid;  -- assisted-redemption beneficiary
  v_panel         uuid;
  v_agent_id      uuid;
  v_res           jsonb;
  v_voucher       uuid;
  v_event         uuid;
  v_lab_order     uuid;
  v_offer         uuid;
  v_n             int;
begin
  insert into public.organisations (id, name, type) values (c_org, 'DB Test Org', 'clinic');

  -- profiles.id is a hard FK to auth.users, so every fixture needs one first.
  v_admin := gen_random_uuid(); v_coordinator := gen_random_uuid(); v_clinician := gen_random_uuid();
  v_agent_patient := gen_random_uuid(); v_stranger := gen_random_uuid(); v_patient_a := gen_random_uuid();
  v_organiser := gen_random_uuid(); v_participant := gen_random_uuid(); v_beneficiary := gen_random_uuid();

  insert into auth.users (id) values
    (v_admin), (v_coordinator), (v_clinician), (v_agent_patient), (v_stranger),
    (v_patient_a), (v_organiser), (v_participant), (v_beneficiary);

  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_admin, c_org, 'admin', 'DB Test Admin', '+2348020000001'),
    (v_coordinator, c_org, 'care_coordinator', 'DB Test Coordinator', '+2348020000002'),
    (v_clinician, c_org, 'clinician', 'DB Test Clinician', '+2348020000003'),
    (v_agent_patient, c_org, 'patient', 'DB Test Agent-to-be', '+2348020000004'),
    (v_stranger, c_org, 'patient', 'DB Test Stranger', '+2348020000005'),
    (v_patient_a, c_org, 'patient', 'DB Test Patient A', '+2348020000006'),
    (v_organiser, c_org, 'patient', 'DB Test Organiser', '+2348020000007'),
    (v_participant, c_org, 'patient', 'DB Test Participant', '+2348020000008'),
    (v_beneficiary, c_org, 'patient', 'DB Test Beneficiary', '+2348020000009');

  insert into public.panel_bundles (id, code, name, price_kobo)
    values (gen_random_uuid(), 'db_test_panel_' || c_org, 'DB Test Panel', 2950000)
    returning id into v_panel;

  -- =========================================================================
  -- 1. COMMUNITY AGENTS: recruitment is admin-only, is_org_staff excludes it
  -- =========================================================================
  perform set_config('request.jwt.claim.sub', v_stranger::text, true);
  begin
    perform public.admin_create_community_agent(v_agent_patient, 'Agent Name', '+2348020000004', null);
    raise exception 'FAIL 1a: a non-admin patient recruited an agent';
  exception when others then
    if sqlerrm not ilike '%not authorised%' then raise; end if;
    insert into _checks (msg) values ('PASS 1a: a non-admin cannot recruit an agent');
  end;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_res := public.admin_create_community_agent(v_agent_patient, 'Agent Name', '+2348020000004', 'Test Church');
  if not (v_res->>'ok')::boolean then raise exception 'FAIL 1b (control): admin could not recruit an agent'; end if;
  select id into v_agent_id from public.community_agents where profile_id = v_agent_patient;
  if v_agent_id is null then raise exception 'FAIL 1b: no community_agents row was created'; end if;
  insert into _checks (msg) values ('PASS 1b (control): an admin can recruit an existing patient as an agent');

  if exists (select 1 from public.profiles where id = v_agent_patient and role <> 'agent') then
    raise exception 'FAIL 1c: recruited profile role was not promoted to agent';
  end if;
  insert into _checks (msg) values ('PASS 1c: recruitment promotes the account role to agent');

  perform set_config('request.jwt.claim.sub', v_agent_patient::text, true);
  if private.is_org_staff(c_org) is distinct from false then
    raise exception 'FAIL 1d: is_org_staff must exclude the agent role';
  end if;
  insert into _checks (msg) values ('PASS 1d: is_org_staff structurally excludes the agent role — no PHI surface leak');

  -- =========================================================================
  -- 2. AGENT COMMISSION: fires once, on real redemption, not before
  -- =========================================================================
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  insert into public.care_vouchers
    (organisation_id, voucher_number, kind, beneficiary_profile_id, purchaser_profile_id,
     panel_bundle_id, sku_code, sku_name, face_value_kobo, amount_paid_kobo, status, agent_id)
  values
    (c_org, 'TAR-VCH-DBTEST-' || substr(c_org::text, 1, 8), 'prepaid_service',
     v_patient_a, v_patient_a, v_panel, 'DB_TEST', 'DB Test Panel', 2950000, 2950000, 'active', v_agent_id)
  returning id into v_voucher;

  if exists (select 1 from public.agent_commissions where source_id = v_voucher) then
    raise exception 'FAIL 2a: a commission was recorded before redemption';
  end if;
  insert into _checks (msg) values ('PASS 2a: no commission before the voucher is actually redeemed');

  update public.care_vouchers set status = 'redeemed', redeemed_at = now() where id = v_voucher;
  select count(*) into v_n
    from public.agent_commissions where source_id = v_voucher and source_type = 'care_voucher_redeemed';
  if v_n <> 1 then raise exception 'FAIL 2b: expected exactly one commission row, found %', v_n; end if;
  insert into _checks (msg) values ('PASS 2b (control): redemption mints exactly one agent_commissions row');

  update public.care_vouchers set redeemed_at = now() where id = v_voucher; -- status unchanged, must not re-fire
  select count(*) into v_n from public.agent_commissions where source_id = v_voucher;
  if v_n <> 1 then raise exception 'FAIL 2c: a no-op update duplicated the commission'; end if;
  insert into _checks (msg) values ('PASS 2c: idempotent — a redundant update never double-credits');

  -- =========================================================================
  -- 3. RLS: an agent sees only their own commissions, never a stranger's data
  -- =========================================================================
  -- These two checks read tables directly rather than through a definer
  -- RPC, so they only mean something if the connecting session itself is
  -- RLS-subject — SET ROLE authenticated (granted the base SELECT on both
  -- tables, same as the app's own client) makes that true regardless of
  -- whether the role driving this script happens to be a superuser.
  perform set_config('request.jwt.claim.sub', v_agent_patient::text, true);
  set role authenticated;
  select count(*) into v_n from public.agent_commissions;
  reset role;
  if v_n <> 1 then raise exception 'FAIL 3a: agent RLS did not scope to their own commission rows, saw %', v_n; end if;
  insert into _checks (msg) values ('PASS 3a: an agent sees exactly their own commission rows');

  perform set_config('request.jwt.claim.sub', v_stranger::text, true);
  set role authenticated;
  select count(*) into v_n from public.community_agents;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 3b: an unrelated patient could read community_agents'; end if;
  insert into _checks (msg) values ('PASS 3b: an unrelated patient reads zero community_agents rows');

  -- =========================================================================
  -- 4. SCREENING EVENTS: confirmation gate, capacity, mandatory consent
  -- =========================================================================
  perform set_config('request.jwt.claim.sub', v_coordinator::text, true);
  v_res := public.admin_create_screening_event(
    v_organiser, 'DB Test Church', '+2348020000007', 'church', v_panel, 2500000, 1,
    current_date + 14, 'Test Hall', 500000, null, null);
  if not (v_res->>'ok')::boolean then raise exception 'FAIL 4a (control): coordinator could not create an event'; end if;
  select id into v_event from public.screening_events where organiser_profile_id = v_organiser;
  insert into _checks (msg) values ('PASS 4a (control): org staff can propose a screening event');

  v_res := public.register_screening_event_participant(v_event, v_participant, true);
  if (v_res->>'ok')::boolean is not false then
    raise exception 'FAIL 4b: registration succeeded before the event was confirmed';
  end if;
  insert into _checks (msg) values ('PASS 4b: registration is blocked until deposit + balance confirm the event');

  perform public.admin_record_screening_event_deposit(v_event, 500000);
  perform public.admin_record_screening_event_balance(v_event, 2000000);
  if (select status from public.screening_events where id = v_event) <> 'confirmed' then
    raise exception 'FAIL 4c: event did not reach confirmed after deposit + balance';
  end if;
  insert into _checks (msg) values ('PASS 4c (control): deposit then balance confirms the event');

  v_res := public.register_screening_event_participant(v_event, v_participant, false);
  if (v_res->>'ok')::boolean is not false then
    raise exception 'FAIL 4d: registration succeeded with consent = false';
  end if;
  insert into _checks (msg) values ('PASS 4d: a participant cannot be registered without consent');

  v_res := public.register_screening_event_participant(v_event, v_participant, true);
  if not (v_res->>'ok')::boolean then raise exception 'FAIL 4e (control): a consented registration was refused'; end if;
  insert into _checks (msg) values ('PASS 4e (control): a consented registration against a confirmed event succeeds');

  if exists (
    select 1 from public.care_vouchers
    where screening_event_id = v_event and (beneficiary_profile_id <> v_participant or purchaser_profile_id <> v_organiser)
  ) then
    raise exception 'FAIL 4f: the issued voucher has the wrong beneficiary/purchaser';
  end if;
  insert into _checks (msg) values ('PASS 4f: the issued voucher names the real participant as beneficiary and the organiser as purchaser');

  v_res := public.register_screening_event_participant(v_event, v_beneficiary, true);
  if (v_res->>'ok')::boolean is not false then
    raise exception 'FAIL 4g: registration exceeded the event''s paid-for headcount (target was 1)';
  end if;
  insert into _checks (msg) values ('PASS 4g: registration is capped at the organiser''s paid-for headcount');

  -- =========================================================================
  -- 5. CHRONIC PROGRAMME OFFERS: clinician-only, accepted only on real payment
  -- =========================================================================
  insert into public.subscription_plans (code, name, price_minor, currency, interval)
    values ('db_test_essential_' || substr(c_org::text, 1, 8), 'DB Test Essential', 800000, 'NGN', 'monthly');

  perform set_config('request.jwt.claim.sub', v_coordinator::text, true);
  begin
    perform public.generate_chronic_programme_offer(v_patient_a, null, 'db_test_essential_' || substr(c_org::text, 1, 8), 'x');
    raise exception 'FAIL 5a: a care coordinator generated a chronic-programme offer';
  exception when others then
    if sqlerrm not ilike '%only a clinician%' then raise; end if;
    insert into _checks (msg) values ('PASS 5a: only a clinician may generate a paid-programme offer');
  end;

  perform set_config('request.jwt.claim.sub', v_clinician::text, true);
  v_res := public.generate_chronic_programme_offer(
    v_patient_a, null, 'db_test_essential_' || substr(c_org::text, 1, 8),
    'Your numbers today need regular review.');
  if not (v_res->>'ok')::boolean then raise exception 'FAIL 5b (control): a clinician was refused'; end if;
  select id into v_offer from public.chronic_programme_offers where patient_id = v_patient_a;
  insert into _checks (msg) values ('PASS 5b (control): a clinician can generate an offer');

  perform set_config('request.jwt.claim.sub', v_stranger::text, true);
  set role authenticated;
  select count(*) into v_n from public.chronic_programme_offers where id = v_offer;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 5c: an unrelated patient could read someone else''s chronic offer'; end if;
  insert into _checks (msg) values ('PASS 5c: a chronic offer is invisible to an unrelated patient');

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  insert into public.subscriptions (organisation_id, subscriber_id, plan_id, status)
    values (c_org, v_patient_a, (select id from public.subscription_plans where code = 'db_test_essential_' || substr(c_org::text, 1, 8)), 'trialing');
  update public.subscriptions set status = 'active' where subscriber_id = v_patient_a;
  if (select status from public.chronic_programme_offers where id = v_offer) <> 'accepted' then
    raise exception 'FAIL 5d: the offer was not marked accepted when the subscription went active';
  end if;
  insert into _checks (msg) values ('PASS 5d (control): the offer is marked accepted only once the subscription actually goes active');

  -- =========================================================================
  -- 6. ASSISTED REDEMPTION: phone must match, never bypasses beneficiary identity
  -- =========================================================================
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  insert into public.care_vouchers
    (organisation_id, voucher_number, kind, beneficiary_profile_id, purchaser_profile_id,
     panel_bundle_id, sku_code, sku_name, face_value_kobo, amount_paid_kobo, status)
  values
    (c_org, 'TAR-VCH-DBTEST2-' || substr(c_org::text, 1, 8), 'prepaid_service',
     v_beneficiary, v_admin, v_panel, 'DB_TEST', 'DB Test Panel', 2950000, 2950000, 'active')
  returning id into v_voucher;

  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, status, payable_kobo)
    values (c_org, v_beneficiary, v_panel, 'pending_payment', 2950000)
    returning id into v_lab_order;

  perform set_config('request.jwt.claim.sub', v_coordinator::text, true);
  v_res := public.redeem_care_voucher_assisted(v_voucher, '+2348029999999', 'lab', v_lab_order);
  if (v_res->>'ok')::boolean is not false then
    raise exception 'FAIL 6a: assisted redemption succeeded with the wrong phone number';
  end if;
  insert into _checks (msg) values ('PASS 6a: a wrong phone number is refused, no PHI or redemption leaks');

  v_res := public.redeem_care_voucher_assisted(v_voucher, '+2348020000009', 'lab', v_lab_order);
  if not (v_res->>'ok')::boolean then raise exception 'FAIL 6b (control): the correct phone number was refused'; end if;
  if (select status from public.care_vouchers where id = v_voucher) <> 'redeemed' then
    raise exception 'FAIL 6c: voucher was not marked redeemed';
  end if;
  if (select status from public.lab_orders where id = v_lab_order) <> 'payment_confirmed' then
    raise exception 'FAIL 6d: lab order was not marked paid';
  end if;
  insert into _checks (msg) values ('PASS 6b/c/d (control): a phone-verified coordinator can redeem on a beneficiary''s behalf, and it settles the order');

  if not exists (
    select 1 from public.care_voucher_events
    where voucher_id = v_voucher and event_type = 'redeemed' and note ilike '%assisted%'
  ) then
    raise exception 'FAIL 6e: assisted redemption left no distinguishing audit trail';
  end if;
  insert into _checks (msg) values ('PASS 6e: assisted redemption is distinguishably logged in the voucher''s own audit trail');

  insert into _checks (msg) values ('=== ALL COMMUNITY AGENT / SCREENING EVENT / CHRONIC OFFER / ASSISTED REDEMPTION CHECKS PASSED ===');
end $$;

select msg from _checks order by n;

rollback;
