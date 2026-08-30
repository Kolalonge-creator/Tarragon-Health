-- activate_sponsored_subscription trigger timing fix: end-to-end proof, in
-- one rolled-back transaction.
--
-- The bug: the trigger was AFTER INSERT ONLY, but its function body gates on
-- `processed_at is not null` — a condition that can only become true via a
-- LATER UPDATE (webhooks always insert with processed_at NULL, then a
-- separate markProcessed() statement sets it). Every real sponsored-
-- subscription payment recorded the charge but never activated the plan.
-- This test replays the webhook's exact two-statement sequence rather than
-- calling the function directly, which is what let the original bug ship
-- undetected.
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
  -- 1. POSITIVE — the real insert-then-update sequence now activates the plan
  -- =========================================================================
  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values (
    c_org, 'paystack', 'test-evt-sponsor-activation-fixed', 'charge.success', 500000, 'NGN',
    jsonb_build_object('data', jsonb_build_object('reference', 'test-evt-sponsor-activation-fixed', 'metadata',
      jsonb_build_object('kind', 'sponsored_subscription', 'beneficiary_profile_id', v_beneficiary,
                          'sponsor_profile_id', v_sponsor, 'plan_code', v_plan_code)))
  )
  returning id into v_txn;

  -- The INSERT alone must not yet activate anything — processed_at is still null.
  select exists(
    select 1 from public.subscriptions where subscriber_id = v_beneficiary and paid_by_profile_id = v_sponsor and status = 'active'
  ) into v_activated;
  if v_activated then
    raise exception 'FAIL 1a: activation happened on the bare INSERT, before processed_at was ever set — unexpected';
  else
    insert into _checks (msg) values ('PASS 1a: the bare INSERT (processed_at still null) correctly does not activate yet');
  end if;

  update public.payment_transactions set processed_at = now() where id = v_txn;

  select exists(
    select 1 from public.subscriptions where subscriber_id = v_beneficiary and paid_by_profile_id = v_sponsor and status = 'active'
  ) into v_activated;
  if v_activated then
    insert into _checks (msg) values ('PASS 1b: the UPDATE that sets processed_at now correctly activates the sponsored plan');
  else
    raise exception 'FAIL 1b: still not activating after the trigger fix';
  end if;

  -- =========================================================================
  -- 2. SABOTAGE — a revoked grant at the moment money lands still blocks
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
  )
  returning id into v_txn;
  update public.payment_transactions set processed_at = now() where id = v_txn;

  select exists(
    select 1 from public.subscriptions where subscriber_id = v_beneficiary and paid_by_profile_id = v_stranger and status = 'active'
  ) into v_activated;
  if v_activated then
    raise exception 'FAIL 2: a sponsor with no manage grant activated a plan anyway';
  else
    insert into _checks (msg) values ('PASS 2: a sponsor with no manage grant still cannot activate a plan (money-lands re-authorization intact)');
  end if;
end $$;

select msg from _checks order by n;

rollback;
