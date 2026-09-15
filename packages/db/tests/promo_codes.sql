-- promo_codes: end-to-end proof, in one rolled-back transaction.
--
-- §91.8's discount system reuses the Care Voucher engine — redemption mints a
-- one-off reward_discount voucher (private.issue_reward_voucher, the same
-- choke point the referral/wellness-points rewards use) then redeems it via
-- the existing public.redeem_care_voucher. This test proves the promo layer's
-- own rules (limits, scope, no stacking) without re-testing the voucher
-- engine itself, which packages/db/tests/care_vouchers.sql already covers.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/promo_codes.sql
--       (from the MAIN checkout, not a worktree — see reference_supabase_cli_sql_access)
--
-- The whole file rolls back. Nothing here should survive.

begin;

create temp table _checks (n serial, msg text) on commit drop;
grant insert, select on _checks to authenticated;
grant usage, select on sequence _checks_n_seq to authenticated;

do $$
declare
  c_org      constant uuid := '00000000-0000-0000-0000-000000000001';
  -- A real partner-billed panel bundle + Synlab provider id, copied from the
  -- one real fulfilment='partner' lab order that has ever existed on this
  -- project — self-arranged (fulfilment='self_arranged') lab orders are
  -- structurally forbidden from carrying a price at all
  -- (private.enforce_lab_order_origin), so a priced fixture must use this
  -- shape, not an invented one.
  c_bundle   constant uuid := '598ca582-41a5-4548-81ce-8a6eb86bd12d';
  c_provider constant uuid := 'd8d35107-4664-4191-8cf5-463ba746b332';
  v_patient  constant uuid := 'ef684028-c40f-4f64-bde9-f84150fb19fd';
  v_stranger constant uuid := 'cb100ba5-204a-4048-a585-2634c27a4c46';
  v_admin    uuid;
  v_lab_order uuid;
  v_lab_order2 uuid;
  v_lab_order3 uuid;
  v_promo_id uuid;
  v_res      jsonb;
  v_before_payable bigint;
  v_payable  bigint;
  v_applied  uuid;
  v_expected_discount bigint;
begin
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  if v_admin is null or not exists (select 1 from public.profiles where id = v_patient)
     or not exists (select 1 from public.profiles where id = v_stranger) then
    raise exception 'fixture QA profiles missing — is the seeded QA account set restored?';
  end if;

  -- =========================================================================
  -- 1. ADMIN CREATES A CODE; A PLAIN PATIENT CANNOT
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_promo_id := public.create_promo_code(
    'WELCOME20', 'percentage', 20, array['lab','pharmacy','referral'], 5, 1, 100000,
    now() - interval '1 day', now() + interval '30 days');
  reset role;
  insert into _checks (msg) values ('PASS 1: admin created a percentage promo code');

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.create_promo_code('HACK100', 'percentage', 100);
    raise exception 'FAIL 2: a plain patient created a promo code';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 2: a plain patient is refused create_promo_code (' || sqlerrm || ')');
  end;
  reset role;

  -- =========================================================================
  -- 2. FIXTURE: a real partner-billed, pending-payment lab order.
  -- =========================================================================
  insert into public.lab_orders
    (organisation_id, patient_id, status, total_kobo, fulfilment, origin, panel_bundle_id, partner_cost_kobo, partner_cost_provider_id)
  values
    (c_org, v_patient, 'pending_payment', 2000000, 'partner', 'patient_initiated', c_bundle, 1700000, c_provider)
  returning id into v_lab_order;

  select payable_kobo into v_before_payable from public.lab_orders where id = v_lab_order;
  v_expected_discount := round(v_before_payable * 0.20);

  -- =========================================================================
  -- 3. SABOTAGE — a stranger cannot discount someone else's order
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.redeem_promo_code('WELCOME20', 'lab', v_lab_order);
    raise exception 'FAIL 3: a stranger redeemed a code against someone else''s order';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 3: a stranger is refused redemption on someone else''s order (' || sqlerrm || ')');
  end;
  reset role;

  -- =========================================================================
  -- 4. POSITIVE — the patient redeems it themselves; code is case-insensitive
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.redeem_promo_code('welcome20', 'lab', v_lab_order);
  reset role;

  select payable_kobo, applied_voucher_id into v_payable, v_applied from public.lab_orders where id = v_lab_order;
  if (v_res ->> 'discount_kobo')::bigint = v_expected_discount
     and v_payable = (v_before_payable - v_expected_discount)
     and v_applied is not null then
    insert into _checks (msg) values ('PASS 4: 20% discount correctly computed and applied to the order');
  else
    raise exception 'FAIL 4: discount math or order update wrong — res=%, before=%, payable=%, applied=%',
      v_res, v_before_payable, v_payable, v_applied;
  end if;

  -- =========================================================================
  -- 5. NO STACKING — a second code against the same, now-discounted order
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.redeem_promo_code('WELCOME20', 'lab', v_lab_order);
    raise exception 'FAIL 5: the same order accepted a second discount (stacking)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 5: a second discount on the same order is refused (' || sqlerrm || ')');
  end;
  reset role;

  -- =========================================================================
  -- 6. PER-PROFILE LIMIT — a second, different order by the same patient
  -- =========================================================================
  insert into public.lab_orders
    (organisation_id, patient_id, status, total_kobo, fulfilment, origin, panel_bundle_id, partner_cost_kobo, partner_cost_provider_id)
  values
    (c_org, v_patient, 'pending_payment', 2000000, 'partner', 'patient_initiated', c_bundle, 1700000, c_provider)
  returning id into v_lab_order2;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.redeem_promo_code('WELCOME20', 'lab', v_lab_order2);
    raise exception 'FAIL 6: per_profile_limit=1 was not enforced on a second order';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 6: per_profile_limit=1 correctly refuses a second redemption by the same patient (' || sqlerrm || ')');
  end;
  reset role;

  -- =========================================================================
  -- 7. ORDER-TYPE SCOPE — a pharmacy-only code refuses a lab order
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.create_promo_code('PHARMONLY', 'fixed_amount', 500, array['pharmacy']);
  reset role;

  insert into public.lab_orders
    (organisation_id, patient_id, status, total_kobo, fulfilment, origin, panel_bundle_id, partner_cost_kobo, partner_cost_provider_id)
  values
    (c_org, v_stranger, 'pending_payment', 2000000, 'partner', 'patient_initiated', c_bundle, 1700000, c_provider)
  returning id into v_lab_order3;

  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.redeem_promo_code('PHARMONLY', 'lab', v_lab_order3);
    raise exception 'FAIL 7: a pharmacy-only code was accepted for a lab order';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 7: a pharmacy-only code correctly refuses a lab order (' || sqlerrm || ')');
  end;
  reset role;

  -- =========================================================================
  -- 8. SCOPE GUARD — subscriptions can never be named as an applicable type
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.create_promo_code('SUBTRY', 'percentage', 10, array['subscription']);
    raise exception 'FAIL 8: a promo code was created scoped to an unsupported order type (subscription)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 8: promo_codes structurally refuses an unsupported order type (' || sqlerrm || ')');
  end;
  reset role;

  -- =========================================================================
  -- 9. STRUCTURAL LOCKDOWN
  -- =========================================================================
  if has_function_privilege('anon', 'public.redeem_promo_code(text, text, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_promo_code(text, text, numeric, text[], integer, integer, bigint, timestamptz, timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_promo_code_active(uuid, boolean)', 'EXECUTE') then
    raise exception 'FAIL 9: anon has EXECUTE on a promo-code function';
  else
    insert into _checks (msg) values ('PASS 9: anon has no EXECUTE on any promo-code function');
  end if;
end $$;

select msg from _checks order by n;

rollback;
