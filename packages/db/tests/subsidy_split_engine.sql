-- subsidy_split_engine: end-to-end proof, in one rolled-back transaction.
--
-- §91.9 two-simultaneous-charges subsidy mechanic: a sponsor with a manage
-- grant over a patient starts a subsidized checkout on one real order; the
-- split (percentage or fixed-copay) is computed server-side; the sponsor's
-- and patient's shares are two independent payment_transactions rows tied
-- together by one transaction_subsidies row; the underlying order only
-- flips to payment_confirmed once BOTH sides have paid — no partial-service-
-- for-partial-payment state. Institution access is aggregate-only (I9).
--
-- Run:  npx supabase db query --linked -f packages/db/tests/subsidy_split_engine.sql
--       (from the MAIN checkout, not a worktree — see reference_supabase_cli_sql_access)
--
-- The whole file rolls back. Nothing here should survive, including the
-- synthetic lab order, split rule, and profile_access grant.

begin;

create temp table _checks(n serial, msg text) on commit drop;
grant insert, select on _checks to authenticated;
grant usage, select on sequence _checks_n_seq to authenticated;

do $$
declare
  c_org constant uuid := '00000000-0000-0000-0000-000000000001';
  c_bundle constant uuid := '598ca582-41a5-4548-81ce-8a6eb86bd12d';
  c_provider constant uuid := 'd8d35107-4664-4191-8cf5-463ba746b332';
  v_beneficiary constant uuid := 'ef684028-c40f-4f64-bde9-f84150fb19fd';
  v_sponsor constant uuid := 'bb707ae8-1d0b-49c2-b990-1950de601db4';
  v_stranger constant uuid := '3bb0a97c-3cd5-49e7-ba74-23b1b37b9510';
  v_admin uuid;
  v_lab_order uuid;
  v_before_payable bigint;
  v_rule_id uuid;
  v_res jsonb;
  v_subsidy_id uuid;
  v_sponsor_contrib_id uuid;
  v_patient_contrib_id uuid;
  v_txn uuid;
begin
  if not exists (select 1 from public.profiles where id in (v_beneficiary, v_sponsor, v_stranger)) then
    raise exception 'fixture QA profiles missing — is the seeded QA account set restored?';
  end if;

  select id into v_admin from public.profiles where role='admin' limit 1;

  -- =========================================================================
  -- 1. STRUCTURAL — a plain patient cannot create an org-wide split rule
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_beneficiary, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.create_subsidy_split_rule(c_org, 'percentage', 60);
    raise exception 'FAIL 1: a plain patient created a subsidy split rule';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks(msg) values ('PASS 1: a plain patient is refused create_subsidy_split_rule (' || sqlerrm || ')');
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_rule_id := public.create_subsidy_split_rule(c_org, 'percentage', 60, null, array['lab']);
  reset role;
  insert into _checks(msg) values ('PASS 2: admin created a 60% sponsor / 40% patient rule for lab orders');

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_beneficiary, v_sponsor, 'manage', v_beneficiary) on conflict do nothing;

  insert into public.lab_orders
    (organisation_id, patient_id, status, total_kobo, fulfilment, origin, panel_bundle_id, partner_cost_kobo, partner_cost_provider_id)
  values (c_org, v_beneficiary, 'pending_payment', 2000000, 'partner', 'patient_initiated', c_bundle, 1700000, c_provider)
  returning id into v_lab_order;
  select payable_kobo into v_before_payable from public.lab_orders where id = v_lab_order;

  -- =========================================================================
  -- 2. SABOTAGE — a stranger without a manage grant cannot sponsor
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.create_transaction_subsidy('lab', v_lab_order, v_stranger);
    raise exception 'FAIL 3: a stranger without a manage grant created a subsidy';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks(msg) values ('PASS 3: a stranger without a manage grant is refused create_transaction_subsidy (' || sqlerrm || ')');
  end;
  reset role;

  -- =========================================================================
  -- 3. POSITIVE — the real sponsor creates a subsidy; split math correct
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sponsor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.create_transaction_subsidy('lab', v_lab_order, v_sponsor);
  reset role;

  v_subsidy_id := (v_res->>'subsidy_id')::uuid;
  v_sponsor_contrib_id := (v_res->>'sponsor_contribution_id')::uuid;
  v_patient_contrib_id := (v_res->>'patient_contribution_id')::uuid;

  if (v_res->>'sponsor_amount_kobo')::bigint = round(v_before_payable * 0.6)
     and (v_res->>'patient_amount_kobo')::bigint = v_before_payable - round(v_before_payable * 0.6) then
    insert into _checks(msg) values ('PASS 4: 60/40 split computed correctly (sponsor=' || (v_res->>'sponsor_amount_kobo') || ', patient=' || (v_res->>'patient_amount_kobo') || ')');
  else
    raise exception 'FAIL 4: split math wrong — %', v_res;
  end if;

  -- =========================================================================
  -- 4. STRUCTURAL — no PMPM path: a second subsidy on the same order refused
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sponsor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.create_transaction_subsidy('lab', v_lab_order, v_sponsor);
    raise exception 'FAIL 5: a second subsidy was created for the same order';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks(msg) values ('PASS 5: a second subsidy on the same order is refused — no double-subsidizing (' || sqlerrm || ')');
  end;
  reset role;

  -- =========================================================================
  -- 5. Sponsor pays their share — order and subsidy must stay pending
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sponsor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_subsidy_contribution_pending_ref(v_sponsor_contrib_id, 'test-subsidy-sponsor-ref');
  reset role;

  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values (c_org, 'paystack', 'test-subsidy-sponsor-ref', 'charge.success', (v_res->>'sponsor_amount_kobo')::bigint, 'NGN',
    jsonb_build_object('data', jsonb_build_object('reference','test-subsidy-sponsor-ref','metadata',
      jsonb_build_object('kind','subsidy_contribution','subsidy_contribution_id',v_sponsor_contrib_id))))
  returning id into v_txn;

  perform 1 from public.lab_orders where id = v_lab_order and status = 'pending_payment';
  if found then
    insert into _checks(msg) values ('PASS 6: order stays pending_payment after only the sponsor''s side is paid');
  else
    raise exception 'FAIL 6: order flipped to paid before the patient''s share was collected';
  end if;

  perform 1 from public.transaction_subsidies where id = v_subsidy_id and status = 'pending';
  if found then
    insert into _checks(msg) values ('PASS 7: transaction_subsidies stays pending after only one side is paid');
  else
    raise exception 'FAIL 7: subsidy flipped to paid too early';
  end if;

  -- =========================================================================
  -- 6. Patient pays their share — this finalizes both
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_beneficiary, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_subsidy_contribution_pending_ref(v_patient_contrib_id, 'test-subsidy-patient-ref');
  reset role;

  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values (c_org, 'paystack', 'test-subsidy-patient-ref', 'charge.success', (v_res->>'patient_amount_kobo')::bigint, 'NGN',
    jsonb_build_object('data', jsonb_build_object('reference','test-subsidy-patient-ref','metadata',
      jsonb_build_object('kind','subsidy_contribution','subsidy_contribution_id',v_patient_contrib_id))));

  perform 1 from public.lab_orders where id = v_lab_order and status = 'payment_confirmed';
  if found then
    insert into _checks(msg) values ('PASS 8: order flips to payment_confirmed once BOTH sides are paid');
  else
    raise exception 'FAIL 8: order did not finalize after both sides paid';
  end if;

  perform 1 from public.transaction_subsidies where id = v_subsidy_id and status = 'paid';
  if found then
    insert into _checks(msg) values ('PASS 9: transaction_subsidies flips to paid once BOTH sides are paid');
  else
    raise exception 'FAIL 9: subsidy did not finalize';
  end if;

  -- =========================================================================
  -- 7. Both contributions posted their own payment-sourced GL entry
  -- =========================================================================
  perform 1 from public.finance_journal_entries je
    join public.payment_transactions pt on pt.id::text = je.source_ref
    where pt.provider_event_id in ('test-subsidy-sponsor-ref','test-subsidy-patient-ref') and je.source = 'payment';
  if found then
    insert into _checks(msg) values ('PASS 10: both contributions posted their own payment journal entry');
  else
    raise exception 'FAIL 10: no journal entries posted for the subsidy contributions';
  end if;

  -- =========================================================================
  -- 8. I9 — institution aggregate suppresses below cohort threshold
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.institution_subsidy_summary(c_org);
  reset role;
  if (v_res->>'suppressed')::boolean then
    insert into _checks(msg) values ('PASS 11: institution_subsidy_summary correctly suppresses below min_cohort_size (I9 small-cell protection)');
  else
    raise exception 'FAIL 11: expected suppression below cohort threshold, got %', v_res;
  end if;

  -- =========================================================================
  -- 9. STRUCTURAL — a random authenticated user cannot read the aggregate
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.institution_subsidy_summary(c_org);
    raise exception 'FAIL 12: a random authenticated user read the institution aggregate';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks(msg) values ('PASS 12: a random authenticated user is refused institution_subsidy_summary (' || sqlerrm || ')');
  end;
  reset role;

  -- =========================================================================
  -- 10. STRUCTURAL — the aggregate output never contains a profile-id-shaped
  --     field (I9: no patient-identifying leak, even when not suppressed)
  -- =========================================================================
  if v_res::text !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' then
    insert into _checks(msg) values ('PASS 13: institution_subsidy_summary output contains no uuid-shaped value anywhere (no patient-identifying leak)');
  else
    raise exception 'FAIL 13: aggregate output contains something uuid-shaped — possible identity leak';
  end if;

  -- =========================================================================
  -- 11. STRUCTURAL — no recurrence/monthly/period column exists anywhere on
  --     transaction_subsidies (I8: a standing PMPM row is inexpressible)
  -- =========================================================================
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='transaction_subsidies'
      and column_name in ('monthly_amount_kobo','starts_at','ends_at','recurrence','billing_cycle')
  ) then
    insert into _checks(msg) values ('PASS 14: transaction_subsidies has no recurrence/monthly/period columns — a standing PMPM arrangement is structurally inexpressible');
  else
    raise exception 'FAIL 14: transaction_subsidies has a recurrence-shaped column';
  end if;

  -- =========================================================================
  -- 12. STRUCTURAL — anon has no EXECUTE on any subsidy function
  -- =========================================================================
  if has_function_privilege('anon', 'public.create_transaction_subsidy(text, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.institution_subsidy_summary(uuid, date, date)', 'EXECUTE') then
    raise exception 'FAIL 15: anon has EXECUTE on a subsidy function';
  else
    insert into _checks(msg) values ('PASS 15: anon has no EXECUTE on any subsidy function');
  end if;

  -- private.compute_transaction_subsidy is an internal helper only ever
  -- called from within another SECURITY DEFINER function — no client role
  -- should reach it directly. It was found live with a stray direct
  -- `authenticated` grant immediately after creation (apparent schema-wide
  -- default-privileges drift on `private`, see
  -- 20260830115524_subsidy_engine_revoke_authenticated_execute_on_private_helper.sql
  -- and the flagged follow-up investigation) — this regression-tests the fix.
  if has_function_privilege('anon', 'private.compute_transaction_subsidy(uuid, text, bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.compute_transaction_subsidy(uuid, text, bigint)', 'EXECUTE') then
    raise exception 'FAIL 15b: anon/authenticated has EXECUTE on the private compute_transaction_subsidy helper';
  else
    insert into _checks(msg) values ('PASS 15b: private.compute_transaction_subsidy has no anon/authenticated EXECUTE');
  end if;

  -- =========================================================================
  -- 13. No active rule covers this org/order-type -> the computed sponsor
  --     share is zero — create_transaction_subsidy must refuse outright
  --     rather than create a subsidy that subsidizes nothing
  --     (20260830114742_subsidy_engine_refuse_zero_sponsor_share.sql).
  --     Deactivates the earlier lab-scoped rule from check 2 first, so no
  --     rule at all now covers a lab order.
  -- =========================================================================
  update public.subsidy_split_rules set is_active = false where id = v_rule_id;

  insert into public.lab_orders
    (organisation_id, patient_id, status, total_kobo, fulfilment, origin, panel_bundle_id, partner_cost_kobo, partner_cost_provider_id)
  values (c_org, v_beneficiary, 'pending_payment', 1000000, 'partner', 'patient_initiated', c_bundle, 800000, c_provider)
  returning id into v_lab_order;

  perform set_config('request.jwt.claims', json_build_object('sub', v_sponsor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.create_transaction_subsidy('lab', v_lab_order, v_sponsor);
    raise exception 'FAIL 16: a zero-share subsidy was created despite no rule covering this order type';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks(msg) values ('PASS 16: create_transaction_subsidy refuses when the split would leave the sponsor owing nothing (' || sqlerrm || ')');
  end;
  reset role;

  perform 1 from public.transaction_subsidies where order_type='lab' and order_id=v_lab_order;
  if not found then
    insert into _checks(msg) values ('PASS 17: no orphaned transaction_subsidies row left behind by the refused attempt');
  else
    raise exception 'FAIL 17: an orphaned subsidy row exists';
  end if;
end $$;

select msg from _checks order by n;

rollback;
