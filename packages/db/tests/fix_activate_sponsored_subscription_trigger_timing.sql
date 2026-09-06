-- activate_sponsored_subscription real-activation fix: end-to-end proof, in
-- one rolled-back transaction.
--
-- The bug had two layers, found in sequence while building on this same
-- payment path for the §91.9 subsidy engine:
--
--   1. The trigger was AFTER INSERT ONLY, but its function body gated on
--      `processed_at is not null` — a condition only a LATER UPDATE sets.
--      First fix attempt: made the trigger also fire on
--      UPDATE OF processed_at.
--   2. That still wasn't enough: the real webhook's charge.success /
--      checkout.session.completed switch has no case for
--      metadata.kind='sponsored_subscription' at all — it falls into the
--      generic else-branch, treats the unrecognised kind as an 'add_on'
--      checkout, finds no matching subscription_add_ons row (a sponsored-
--      subscription checkout never creates one), and calls markFailed(),
--      never markProcessed(). processed_at is NEVER set for this kind via
--      the real webhook code, so listening for its UPDATE doesn't help.
--
-- The actual fix mirrors private.apply_voucher_payment_from_transaction —
-- the other metadata-kind trigger deliberately designed to ship without
-- redeploying either webhook — which never depends on processed_at, only on
-- event_type. This test proves activation now happens on the bare INSERT
-- alone, exactly matching how the real webhook's insert-then-(failed)switch
-- sequence actually behaves for this kind.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/fix_activate_sponsored_subscription_trigger_timing.sql
--       (from the MAIN checkout, not a worktree — see reference_supabase_cli_sql_access)
--
-- The whole file rolls back. Nothing here should survive.

begin;

create temp table _checks (n serial, msg text) on commit drop;
grant insert, select on _checks to authenticated;
grant usage, select on sequence _checks_n_seq to authenticated;

do $$
declare
  c_org         constant uuid := '00000000-0000-0000-0000-000000000001';
  v_sponsor     constant uuid := 'bb707ae8-1d0b-49c2-b990-1950de601db4';
  v_beneficiary constant uuid := 'ef684028-c40f-4f64-bde9-f84150fb19fd';
  v_stranger    constant uuid := '3bb0a97c-3cd5-49e7-ba74-23b1b37b9510';
  v_plan_code   text;
  v_txn         uuid;
  v_activated   boolean;
begin
  if not exists (select 1 from public.profiles where id in (v_sponsor, v_beneficiary, v_stranger)) then
    raise exception 'fixture QA profiles missing — is the seeded QA account set restored?';
  end if;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_beneficiary, v_sponsor, 'manage', v_beneficiary)
  on conflict do nothing;

  select code into v_plan_code from public.subscription_plans where price_minor > 0 and currency = 'NGN' and is_active limit 1;
  if v_plan_code is null then
    raise exception 'fixture catalogue missing — no active paid NGN plan found';
  end if;

  -- =========================================================================
  -- 1. POSITIVE — the bare INSERT alone now activates the plan, matching
  --    exactly what the real webhook actually does for this metadata.kind
  --    (insert the row, then fail to match it as an add_on and never touch
  --    processed_at at all)
  -- =========================================================================
  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values (
    c_org, 'paystack', 'test-evt-sponsor-bare-insert', 'charge.success', 500000, 'NGN',
    jsonb_build_object('data', jsonb_build_object('reference', 'test-evt-sponsor-bare-insert', 'metadata',
      jsonb_build_object('kind', 'sponsored_subscription', 'beneficiary_profile_id', v_beneficiary,
                          'sponsor_profile_id', v_sponsor, 'plan_code', v_plan_code)))
  )
  returning id into v_txn;

  select exists(
    select 1 from public.subscriptions where subscriber_id = v_beneficiary and paid_by_profile_id = v_sponsor and status = 'active'
  ) into v_activated;
  if v_activated then
    insert into _checks (msg) values ('PASS 1: the bare INSERT alone now activates the sponsored plan (no processed_at dependency)');
  else
    raise exception 'FAIL 1: still not activating on bare insert';
  end if;

  -- =========================================================================
  -- 2. NEGATIVE — an event_type that is not a real money-in event never
  --    activates anything, even with correctly-shaped metadata
  -- =========================================================================
  delete from public.subscriptions where subscriber_id = v_beneficiary and paid_by_profile_id = v_sponsor;

  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values (
    c_org, 'paystack', 'test-evt-sponsor-wrong-event-type', 'invoice.create', 500000, 'NGN',
    jsonb_build_object('data', jsonb_build_object('reference', 'test-evt-sponsor-wrong-event-type', 'metadata',
      jsonb_build_object('kind', 'sponsored_subscription', 'beneficiary_profile_id', v_beneficiary,
                          'sponsor_profile_id', v_sponsor, 'plan_code', v_plan_code)))
  );

  select exists(
    select 1 from public.subscriptions where subscriber_id = v_beneficiary and paid_by_profile_id = v_sponsor and status = 'active'
  ) into v_activated;
  if v_activated then
    raise exception 'FAIL 2: a non-money-in event_type activated a plan';
  else
    insert into _checks (msg) values ('PASS 2: a non-money-in event_type (invoice.create) never activates anything');
  end if;

  -- =========================================================================
  -- 3. SABOTAGE — a revoked grant at the moment money lands still blocks
  --    activation (the existing re-authorization check, unaffected by this fix)
  -- =========================================================================
  delete from public.profile_access where profile_id = v_beneficiary and grantee_user_id = v_stranger;

  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values (
    c_org, 'paystack', 'test-evt-sponsor-no-grant', 'charge.success', 500000, 'NGN',
    jsonb_build_object('data', jsonb_build_object('reference', 'test-evt-sponsor-no-grant', 'metadata',
      jsonb_build_object('kind', 'sponsored_subscription', 'beneficiary_profile_id', v_beneficiary,
                          'sponsor_profile_id', v_stranger, 'plan_code', v_plan_code)))
  );

  select exists(
    select 1 from public.subscriptions where subscriber_id = v_beneficiary and paid_by_profile_id = v_stranger and status = 'active'
  ) into v_activated;
  if v_activated then
    raise exception 'FAIL 3: a sponsor with no manage grant activated a plan anyway';
  else
    insert into _checks (msg) values ('PASS 3: a sponsor with no manage grant still cannot activate a plan (money-lands re-authorization intact)');
  end if;
end $$;

select msg from _checks order by n;

rollback;
