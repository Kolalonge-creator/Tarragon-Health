-- Care Vouchers: end-to-end proof, in one rolled-back transaction.
--
-- Every negative check is paired with a positive control in the same
-- transaction, because "the sponsor was refused" only means something once a
-- correctly-authorised caller completes the same action. A grant that blocked
-- everything would otherwise pass a negatives-only suite.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/care_vouchers.sql
--       (from the MAIN checkout, not a worktree — see
--        reference_supabase_cli_sql_access)
--
-- The whole file rolls back. Nothing here should survive.

begin;

-- Results land here so a run shows what it proved, not just that it did not
-- throw. Granted to authenticated because most checks run inside a simulated
-- patient session.
create temp table _checks (n serial, msg text) on commit drop;
grant insert on _checks to authenticated;
grant usage on sequence _checks_n_seq to authenticated;

do $$
declare
  c_org      constant uuid := '00000000-0000-0000-0000-000000000001';
  v_alice    uuid := gen_random_uuid();  -- beneficiary
  v_bob      uuid := gen_random_uuid();  -- sponsor (granted)
  v_carol    uuid := gen_random_uuid();  -- stranger (control)
  v_plan_complete       uuid;   -- complete_yearly: bought/paid off across sections 1-4
  v_plan_complete_price bigint;
  v_plan_essential      uuid;   -- essential_yearly: Bob's gift, a different plan
  v_bundle       uuid;   -- a real panel bundle, needed only for the lab-order fixtures in 4/6/7
  v_bundle_price bigint;
  v_voucher  uuid;
  v_reward   uuid;
  v_order2   uuid;
  v_res      jsonb;
  v_txt      text;
  v_status   text;
  v_paid     bigint;
  v_payable  bigint;
  v_expires  timestamptz;
  v_n        int;
begin
  -- Self-provisioned fixtures (fresh-database pattern) -- these three are
  -- pure relationship roles (beneficiary/sponsor/stranger) for the
  -- profile_access / voucher-redemption checks below, so a plain patient
  -- profile is all each one needs -- no demographic fields matter here.
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_alice, 'care-vouchers-alice-beneficiary@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = c_org, role = 'patient', full_name = 'Care Vouchers Test Alice'
    where id = v_alice;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_bob, 'care-vouchers-bob-sponsor@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = c_org, role = 'patient', full_name = 'Care Vouchers Test Bob'
    where id = v_bob;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_carol, 'care-vouchers-carol-stranger@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = c_org, role = 'patient', full_name = 'Care Vouchers Test Carol'
    where id = v_carol;

  -- Every NGN paid tier (prevent/essential/complete, monthly and yearly) is
  -- currently is_active=false pending a Paystack "Sync now" re-sync after
  -- the 2026-08-05 price change
  -- (20260805201508_raise_ngn_tier_prices_and_fold_prevention_into_chronic_
  -- plans.sql) — a real, current, deliberate ops state, not a code defect.
  -- purchase_subscription_voucher() correctly refuses to sell a plan that is
  -- not on sale, so reactivate the two yearly NGN plans this file needs for
  -- the life of this rolled-back transaction only, to exercise the voucher
  -- machinery independent of that unrelated ops step.
  update public.subscription_plans set is_active = true
   where code in ('complete_yearly', 'essential_yearly');

  select id, price_minor into v_plan_complete, v_plan_complete_price
    from public.subscription_plans where code = 'complete_yearly';
  select id into v_plan_essential from public.subscription_plans where code = 'essential_yearly';
  if v_plan_complete is null or v_plan_essential is null then
    raise exception 'fixture plans missing — is the subscription price book restored?';
  end if;

  -- purchase_care_voucher (the panel-bundle prepaid path this file used to
  -- exercise) was permanently disabled 2026-08-03
  -- (20260803134416_self_arranged_consistency_sweep.sql) — Tarragon no
  -- longer takes payment for a lab test, so there is nothing left to prepay
  -- against. Its replacement is a subscription voucher (a year of a plan —
  -- purchase_subscription_voucher / redeem_subscription_voucher,
  -- 20260803141409_subscription_care_vouchers.sql), which is what every
  -- purchase/redemption below now exercises. A real panel bundle is still
  -- needed for sections 4/6/7, which prove a voucher cannot be spent against
  -- an unrelated lab order.
  select id, price_kobo into v_bundle, v_bundle_price
    from public.panel_bundles where price_kobo > 100000 order by price_kobo desc limit 1;
  if v_bundle is null then
    raise exception 'fixture bundle missing — is the clinical catalogue restored?';
  end if;

  -- Bob is a consented sponsor for Alice with full manage rights.
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_alice, v_bob, 'manage', v_alice)
  on conflict do nothing;

  -- =========================================================================
  -- 1. PURCHASE
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_res := public.purchase_subscription_voucher(v_alice, v_plan_complete, null);
  v_voucher := (v_res ->> 'voucher_id')::uuid;
  if (v_res ->> 'face_value_kobo')::bigint <> v_plan_complete_price then
    raise exception 'FAIL 1a: price was not pinned from the catalogue';
  end if;
  select status::text, amount_paid_kobo into v_status, v_paid
    from public.care_vouchers where id = v_voucher;
  if v_status <> 'reserved' or v_paid <> 0 then
    raise exception 'FAIL 1b: a new voucher must start reserved and unpaid, got % / %', v_status, v_paid;
  end if;
  insert into _checks (msg) values ('PASS 1: purchase reserves a voucher at the pinned catalogue price');

  -- 1c. A plan that is not in the catalogue at all cannot be voucherized.
  begin
    perform public.purchase_subscription_voucher(v_alice, gen_random_uuid(), null);
    raise exception 'FAIL 1c: a nonexistent plan was sold as a voucher';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 1c: only a real catalogue plan can be voucherized');
  end;

  -- =========================================================================
  -- 2. WHO MAY BUY FOR WHOM
  -- =========================================================================
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_carol, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.purchase_subscription_voucher(v_alice, v_plan_complete, 'from a stranger');
    raise exception 'FAIL 2a: a stranger bought a voucher for someone else';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 2a: a stranger cannot buy for someone who has not linked them');
  end;

  -- Control: the consented sponsor CAN. Same action, different person, a
  -- different plan.
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.purchase_subscription_voucher(v_alice, v_plan_essential, 'Get well soon, Mum');
  if (v_res ->> 'ok')::boolean is not true then
    raise exception 'FAIL 2b: the consented sponsor was refused';
  end if;
  insert into _checks (msg) values ('PASS 2b (control): a consented sponsor can buy a named plan as a gift');

  -- =========================================================================
  -- 3. LAYAWAY — instalments toward ONE named voucher
  -- =========================================================================
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Overpaying the outstanding balance is refused.
  begin
    perform public.record_voucher_payment_intent(
      v_voucher, v_plan_complete_price + 1, 'NGN', v_plan_complete_price + 1, 'paystack', 'ref-too-much');
    raise exception 'FAIL 3a: an instalment larger than the price was accepted';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 3a: cannot pay more than the voucher costs');
  end;

  perform public.record_voucher_payment_intent(
    v_voucher, v_plan_complete_price / 2, 'NGN', v_plan_complete_price / 2, 'paystack', 'ref-instalment-1');
  perform public.record_voucher_payment_intent(
    v_voucher, v_plan_complete_price - v_plan_complete_price / 2, 'NGN', v_plan_complete_price - v_plan_complete_price / 2,
    'paystack', 'ref-instalment-2');

  reset role;
  -- First instalment lands.
  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, amount_minor, currency,
     processed_at, raw_payload)
  values
    (c_org, 'paystack', 'evt-vch-1', 'charge.success', v_plan_complete_price / 2, 'NGN', now(),
     jsonb_build_object('data', jsonb_build_object(
        'reference', 'ref-instalment-1',
        'metadata', jsonb_build_object('kind', 'voucher_payment'))));

  select status::text, amount_paid_kobo into v_status, v_paid
    from public.care_vouchers where id = v_voucher;
  if v_status <> 'reserved' then
    raise exception 'FAIL 3b: a part-paid voucher must NOT be redeemable, got %', v_status;
  end if;
  if v_paid <> v_plan_complete_price / 2 then
    raise exception 'FAIL 3b: instalment not applied, paid = %', v_paid;
  end if;
  insert into _checks (msg) values ('PASS 3b: a part-paid voucher stays reserved, not redeemable');

  -- Second instalment completes it.
  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, amount_minor, currency,
     processed_at, raw_payload)
  values
    (c_org, 'paystack', 'evt-vch-2', 'charge.success', v_plan_complete_price - v_plan_complete_price / 2, 'NGN', now(),
     jsonb_build_object('data', jsonb_build_object(
        'reference', 'ref-instalment-2',
        'metadata', jsonb_build_object('kind', 'voucher_payment'))));

  select status::text, amount_paid_kobo, expires_at into v_status, v_paid, v_expires
    from public.care_vouchers where id = v_voucher;
  if v_status <> 'active' or v_paid <> v_plan_complete_price then
    raise exception 'FAIL 3c: paying in full should activate, got % / %', v_status, v_paid;
  end if;
  if v_expires < now() + interval '23 months' or v_expires > now() + interval '25 months' then
    raise exception 'FAIL 3c: expiry should be ~24 months from full payment, got %', v_expires;
  end if;
  insert into _checks (msg) values ('PASS 3c: paid in full activates the voucher, 24-month clock starts at full payment');

  -- =========================================================================
  -- 4. A SUBSCRIPTION VOUCHER IS ONLY REDEEMABLE THROUGH
  --    redeem_subscription_voucher() — the heart of it now
  -- =========================================================================
  -- The legacy lab-order single-purpose path (redeem_care_voucher) still
  -- exists for a panel-bundle voucher, but a subscription voucher has no
  -- panel_bundle_id at all (care_vouchers_one_sku enforces exactly one SKU),
  -- so it must refuse outright rather than silently activating itself
  -- against an unrelated lab order — two redemption mechanisms on the same
  -- table must never cross-contaminate.
  insert into public.lab_orders
    (organisation_id, patient_id, status, total_kobo, origin, panel_bundle_id)
  values (c_org, v_alice, 'pending_payment', v_bundle_price, 'patient_initiated', v_bundle)
  returning id into v_order2;

  perform set_config('request.jwt.claims', json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.redeem_care_voucher(v_voucher, 'lab', v_order2);
    raise exception 'FAIL 4a: a subscription voucher was spent through the legacy lab-order redemption path';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 4a: a subscription voucher cannot be redeemed via the lab-order path, even against a real order');
  end;

  -- Control: the same voucher redeems correctly through its real path.
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.redeem_subscription_voucher(v_voucher);
  if (v_res ->> 'ok')::boolean is not true then
    raise exception 'FAIL 4b: the matching subscription voucher was not redeemed by its own beneficiary';
  end if;
  insert into _checks (msg) values ('PASS 4b (control): the same voucher redeems through redeem_subscription_voucher');

  -- 4c. Used once, and only once.
  begin
    perform public.redeem_subscription_voucher(v_voucher);
    raise exception 'FAIL 4c: a voucher was redeemed twice';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 4c: a voucher cannot be used twice');
  end;

  -- =========================================================================
  -- 5. NON-TRANSFERABILITY
  -- =========================================================================
  reset role;
  begin
    update public.care_vouchers set beneficiary_profile_id = v_carol where id = v_voucher;
    raise exception 'FAIL 5a: a voucher was transferred to another person';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 5a: a voucher cannot be moved to another person, even as superuser');
  end;

  begin
    update public.care_vouchers set face_value_kobo = 1 where id = v_voucher;
    raise exception 'FAIL 5b: the terms of an issued voucher were rewritten';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 5b: issued voucher terms are frozen');
  end;

  -- =========================================================================
  -- 6. REWARD VOUCHERS — discount, separately accounted, never cash
  -- =========================================================================
  reset role;
  v_reward := private.issue_reward_voucher(v_alice, 50000, 'Referral reward', 'test');
  if v_reward is null then raise exception 'FAIL 6a: reward voucher was not issued'; end if;
  select status::text into v_status from public.care_vouchers where id = v_reward;
  if v_status <> 'active' then raise exception 'FAIL 6a: a reward should be usable immediately'; end if;
  if exists (select 1 from public.care_vouchers
             where id = v_reward and purchaser_profile_id is not null) then
    raise exception 'FAIL 6a: a reward must have no purchaser — nobody paid for it';
  end if;
  insert into _checks (msg) values ('PASS 6a: reward vouchers are issued active with no purchaser (not customer money)');

  -- A reward discounts a pricier order rather than settling it outright.
  insert into public.lab_orders
    (organisation_id, patient_id, status, total_kobo, origin, panel_bundle_id)
  values (c_org, v_alice, 'pending_payment', v_bundle_price, 'patient_initiated', v_bundle)
  returning id into v_order2;

  perform set_config('request.jwt.claims', json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.redeem_care_voucher(v_reward, 'lab', v_order2);
  if (v_res ->> 'fully_covered')::boolean is not false then
    raise exception 'FAIL 6b: a NGN 500 reward should not fully cover a pricier check (bundle price % kobo)', v_bundle_price;
  end if;
  select status::text, payable_kobo into v_status, v_payable from public.lab_orders where id = v_order2;
  if v_status <> 'pending_payment' or v_payable <> v_bundle_price - 50000 then
    raise exception 'FAIL 6b: expected a reduced payable amount, got % / %', v_status, v_payable;
  end if;
  insert into _checks (msg) values ('PASS 6b: a reward reduces what is payable and the rest is still owed');

  -- =========================================================================
  -- 7. SOMEONE ELSE'S VOUCHER
  -- =========================================================================
  reset role;
  v_reward := private.issue_reward_voucher(v_alice, 50000, 'Referral reward', 'test2');
  insert into public.lab_orders
    (organisation_id, patient_id, status, total_kobo, origin, panel_bundle_id)
  values (c_org, v_carol, 'pending_payment', v_bundle_price, 'patient_initiated', v_bundle)
  returning id into v_order2;

  perform set_config('request.jwt.claims', json_build_object('sub', v_carol, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.redeem_care_voucher(v_reward, 'lab', v_order2);
    raise exception 'FAIL 7a: a stranger spent someone else''s voucher';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 7a: a voucher cannot be spent by anyone but its beneficiary or a manage grantee');
  end;

  -- 7b. Even the real sponsor cannot point Alice's voucher at Carol's order.
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.redeem_care_voucher(v_reward, 'lab', v_order2);
    raise exception 'FAIL 7b: a real grant over one person became a lever onto another''s order';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 7b: a manage grant is not a lever onto a third party''s order');
  end;

  -- =========================================================================
  -- 8. EXPIRY AND EXTENSION
  -- =========================================================================
  reset role;
  update public.care_vouchers set expires_at = now() - interval '1 day' where id = v_reward;
  perform private.run_care_voucher_expiry();
  select status::text into v_status from public.care_vouchers where id = v_reward;
  if v_status <> 'expired' then
    raise exception 'FAIL 8a: an overdue voucher was not expired, got %', v_status;
  end if;
  insert into _checks (msg) values ('PASS 8a: the sweep expires an overdue, fully-paid, unused voucher');

  -- 8b. A voucher still being paid for is NEVER swept. Money has been taken
  --     toward it and silently forfeiting that is the behaviour we refuse.
  select id into v_voucher from public.care_vouchers
   where beneficiary_profile_id = v_alice and status = 'reserved' limit 1;
  update public.care_vouchers set expires_at = now() - interval '1 day' where id = v_voucher;
  perform private.run_care_voucher_expiry();
  select status::text into v_status from public.care_vouchers where id = v_voucher;
  if v_status <> 'reserved' then
    raise exception 'FAIL 8b: a part-paid voucher was forfeited, got %', v_status;
  end if;
  insert into _checks (msg) values ('PASS 8b: a voucher still being paid for is never expired automatically');

  -- 8c. Extension needs the capability, and works on an already-expired one.
  perform set_config('request.jwt.claims', json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.extend_care_voucher(v_reward, 'please');
    raise exception 'FAIL 8c: a patient extended their own voucher';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 8c: extending is a staff action, not a self-service one');
  end;

  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from public.profiles where role = 'admin' limit 1),
                      'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.extend_care_voucher(v_reward, 'customer asked');
  reset role;
  select status::text into v_status from public.care_vouchers where id = v_reward;
  if v_status <> 'active' then
    raise exception 'FAIL 8d: extension should reinstate an expired voucher, got %', v_status;
  end if;
  insert into _checks (msg) values ('PASS 8d (control): an admin can reinstate an expired voucher on request');

  -- =========================================================================
  -- 9. ACCOUNTING — customer money and marketing credit stay apart
  -- =========================================================================
  select count(*) into v_n
    from public.finance_journal_lines l
    join public.finance_journal_entries e on e.id = l.entry_id
   where e.source = 'voucher' and l.account_code = '2100';
  if v_n = 0 then raise exception 'FAIL 9a: no customer prepayment liability was posted'; end if;

  select count(*) into v_n
    from public.finance_journal_lines l
    join public.finance_journal_entries e on e.id = l.entry_id
   where e.source = 'voucher' and l.account_code = '2600';
  if v_n = 0 then raise exception 'FAIL 9b: no reward voucher liability was posted'; end if;

  -- The two must never appear on the same journal entry.
  select count(*) into v_n from (
    select l.entry_id from public.finance_journal_lines l
     where l.account_code in ('2100', '2600')
     group by l.entry_id having count(distinct l.account_code) > 1) x;
  if v_n <> 0 then
    raise exception 'FAIL 9c: customer money and promotional credit were commingled on % entries', v_n;
  end if;
  insert into _checks (msg) values ('PASS 9: prepayments (2100) and reward credit (2600) are posted, and never commingled');

  -- =========================================================================
  -- 10. NO CASH-OUT ROUTE EXISTS ANYWHERE
  -- =========================================================================
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.prosrc ilike '%care_vouchers%'
     and (p.prosrc ilike '%payout%' or p.prosrc ilike '%withdraw%' or p.prosrc ilike '%cash_out%');
  if v_n <> 0 then raise exception 'FAIL 10a: a cash-out path exists'; end if;

  select count(*) into v_n from pg_tables
   where schemaname = 'public' and (tablename like 'wallet%' or tablename = 'health_wallets');
  if v_n <> 0 then raise exception 'FAIL 10b: a stored-value wallet table still exists'; end if;
  insert into _checks (msg) values ('PASS 10: no cash-out route and no stored-value balance survives anywhere');

  insert into _checks (msg) values ('=== ALL CARE VOUCHER CHECKS PASSED ===');
end $$;

select msg from _checks order by n;

rollback;
