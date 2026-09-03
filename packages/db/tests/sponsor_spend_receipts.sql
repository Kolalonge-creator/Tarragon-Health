-- Proves private.notify_sponsors_of_wallet_spend does what its migration claims.
--
-- Rolled back, so it leaves nothing behind. Every fixture is resolved at runtime
-- rather than hardcoded, so this stays runnable against any environment.
--
-- What is being pinned down:
--   1. A person who funded the wallet gets a receipt, on exactly two channels.
--   2. That receipt is non_clinical, so it satisfies the I1 CHECK on email.
--   3. It names the service category and amount, never a result.
--   4. Someone holding a profile_access grant but who has never funded anything
--      gets nothing. Paying for care and reading it are different permissions.
--   5. The wallet owner topping up their own wallet does not make them their own
--      sponsor.
--   6. Non-spend ledger entries raise no receipt at all.
begin;

do $$
declare
  v_org        uuid;
  v_owner      uuid;
  v_sponsor    uuid;
  v_bystander  uuid;
  v_wallet     uuid;

  v_sponsor_rows    int;
  v_bystander_rows  int;
  v_owner_rows      int;
  v_channels        text;
  v_classes         text;
  v_payload         jsonb;
  v_after_credit    int;
begin
  select id, organisation_id into v_owner, v_org
    from public.profiles where role = 'patient' order by created_at limit 1;
  select id into v_sponsor
    from public.profiles where role = 'patient' and id <> v_owner order by created_at limit 1;
  select id into v_bystander
    from public.profiles where role = 'patient' and id not in (v_owner, v_sponsor)
    order by created_at limit 1;

  if v_owner is null or v_sponsor is null or v_bystander is null then
    raise exception 'need three patient profiles to run this test';
  end if;

  insert into public.health_wallets (organisation_id, profile_id, balance_kobo)
  values (v_org, v_owner, 0)
  on conflict (profile_id) do update set balance_kobo = excluded.balance_kobo
  returning id into v_wallet;

  -- A bystander with a real grant who has never put money in.
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_owner, v_bystander, 'view', v_owner)
  on conflict do nothing;

  -- The sponsor funds the wallet, and the owner also tops it up themselves.
  insert into public.wallet_ledger
    (organisation_id, wallet_id, entry_type, amount_kobo, balance_after_kobo, actor_profile_id)
  values
    (v_org, v_wallet, 'sponsor_topup', 5000000, 5000000, v_sponsor),
    (v_org, v_wallet, 'topup',         1000000, 6000000, v_owner);

  -- 6. A credit is not a spend, so nothing should have been raised yet.
  select count(*) into v_after_credit
    from public.notifications
   where template = 'sponsor_spend_receipt';
  if v_after_credit <> 0 then
    raise exception 'FAIL 6: a top-up raised % receipt(s); only a spend should', v_after_credit;
  end if;

  -- The spend itself.
  insert into public.wallet_ledger
    (organisation_id, wallet_id, entry_type, amount_kobo, balance_after_kobo,
     actor_profile_id, booking_order_type)
  values
    (v_org, v_wallet, 'spend', -800000, 5200000, v_owner, 'lab');

  select count(*) into v_sponsor_rows
    from public.notifications
   where template = 'sponsor_spend_receipt' and recipient_id = v_sponsor;
  if v_sponsor_rows <> 2 then
    raise exception 'FAIL 1: sponsor got % receipt row(s), expected 2', v_sponsor_rows;
  end if;

  select string_agg(channel::text, ',' order by channel::text) into v_channels
    from public.notifications
   where template = 'sponsor_spend_receipt' and recipient_id = v_sponsor;
  if v_channels <> 'email,in_app' then
    raise exception 'FAIL 1: receipt channels were %, expected email,in_app', v_channels;
  end if;

  select string_agg(distinct content_class::text, ',') into v_classes
    from public.notifications
   where template = 'sponsor_spend_receipt';
  if v_classes <> 'non_clinical' then
    raise exception 'FAIL 2: receipt content_class was %, expected non_clinical', v_classes;
  end if;

  select payload into v_payload
    from public.notifications
   where template = 'sponsor_spend_receipt' and recipient_id = v_sponsor
   limit 1;
  if v_payload->>'what' <> 'a lab test' then
    raise exception 'FAIL 3: receipt said "%", expected "a lab test"', v_payload->>'what';
  end if;
  if (v_payload->>'amount_kobo')::bigint <> 800000 then
    raise exception 'FAIL 3: receipt amount was %, expected 800000', v_payload->>'amount_kobo';
  end if;
  if (v_payload->>'balance_kobo')::bigint <> 5200000 then
    raise exception 'FAIL 3: receipt balance was %, expected 5200000', v_payload->>'balance_kobo';
  end if;

  select count(*) into v_bystander_rows
    from public.notifications
   where template = 'sponsor_spend_receipt' and recipient_id = v_bystander;
  if v_bystander_rows <> 0 then
    raise exception 'FAIL 4: a non-funding grantee got % receipt(s); expected 0', v_bystander_rows;
  end if;

  select count(*) into v_owner_rows
    from public.notifications
   where template = 'sponsor_spend_receipt' and recipient_id = v_owner;
  if v_owner_rows <> 0 then
    raise exception 'FAIL 5: the wallet owner got % receipt(s) for their own spend; expected 0',
      v_owner_rows;
  end if;

  raise notice 'PASS: sponsor received % rows on %, bystander 0, owner 0, credits raised none',
    v_sponsor_rows, v_channels;
end $$;

rollback;
