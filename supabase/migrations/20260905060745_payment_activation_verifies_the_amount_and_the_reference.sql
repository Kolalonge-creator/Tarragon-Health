-- ===========================================================================
-- Nothing in the payment path ever checks how much was actually paid.
--
-- TWO FUNCTIONS, THREE HOLES
--
-- private.apply_service_purchase_payment() activates a service_purchases row
-- on charge.success by matching pending_payment_provider_ref. It never looks
-- at new.amount_minor. Prices ARE pinned server-side at /transaction/
-- initialize (lib/billing/purchase-service-product.ts charges
-- service_purchases.payable_kobo, a generated column), so this is defence in
-- depth rather than a live exploit -- but an activation that never compares
-- what was charged against what is owed has no way to notice a provider-side
-- discrepancy, a replayed reference against a re-priced row, or a partial
-- capture.
--
-- private.activate_sponsored_service_purchase() is worse, and dormant, which
-- is the only reason it has not bitten:
--
--   1. AMOUNT-BLIND. It grants whatever service_products row the checkout
--      METADATA names, with no comparison against amount_minor at all.
--      Metadata is attacker-influenced in a way an amount is not.
--   2. NO PROVIDER-REFERENCE MATCH. It correlates only on
--      beneficiary_profile_id plus a profile_access 'manage' grant, so it has
--      no identity for the charge and no idempotency: Paystack retries a
--      webhook, and the same charge grants access twice.
--   3. RESETS INSTEAD OF EXTENDING. On an existing active purchase it set
--      `expires_at = now() + duration`. Paying again 60 days into a 90-day
--      pack SHORTENED the access the patient had already paid for.
--
-- WHAT THIS DOES
--
--   * Adds private.record_payment_integrity_flag() -- writes a
--     payment_reconciliation_flags row (the table and dashboard that already
--     exist for exactly this) and tells every admin in_app. Like
--     private.finance_record_posting_failure it can never raise, because it
--     runs inside webhook trigger code.
--   * apply_service_purchase_payment now refuses to activate when the amount
--     paid matches neither the purchase's payable_kobo nor its gross
--     amount_kobo, and flags the mismatch.
--   * activate_sponsored_service_purchase now requires a provider reference,
--     records it, refuses a reference it has already granted against, checks
--     amount and currency against the product's own price, EXTENDS rather
--     than resets an existing window, and routes its blanket exception
--     swallow into the flag table instead of returning silently.
--
-- WHY BOTH ACCEPT payable_kobo OR amount_kobo. payable_kobo is
-- amount_kobo minus whatever a promo or care voucher covered. A voucher
-- redeemed against a still-pending purchase AFTER checkout was initialised
-- lowers payable_kobo below the amount already being charged, so accepting
-- only the current payable_kobo would refuse a payment that is genuinely
-- correct. Accepting either bound still refuses every amount that is neither.
--
-- WHY REFUSAL AND NOT ACTIVATE-AND-FLAG. A payment-integrity control that
-- proceeds anyway is a log line, not a control. Refusing leaves the row at
-- 'pending_payment', which is a state the platform already handles end to end
-- -- the patient sees the payment-failure banner and a retry button, and the
-- flag lands on /finance/reconciliation for a human. Activating on an amount
-- nobody can account for would be the harder thing to undo.
-- ===========================================================================

create or replace function private.record_payment_integrity_flag(
  p_txn_id uuid,
  p_flag_type text,
  p_provider_reference text,
  p_local_amount_minor bigint,
  p_provider_amount_minor bigint,
  p_note text
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  txn public.payment_transactions%rowtype;
  v_ref text;
begin
  begin
    select * into txn from public.payment_transactions where id = p_txn_id;
    if txn.id is null then return; end if;

    -- provider_reference is NOT NULL on the flag table. When the refusal is
    -- precisely "this event carried no usable reference", the transaction's
    -- own id is the only identity there is, and it is a real handle a human
    -- can look the event up by.
    v_ref := coalesce(nullif(trim(p_provider_reference), ''), p_txn_id::text);

    insert into public.payment_reconciliation_flags
      (organisation_id, provider, flag_type, provider_reference, payment_transaction_id,
       local_amount_minor, provider_amount_minor, local_status, provider_status, currency, detail)
    values
      (txn.organisation_id, txn.provider, p_flag_type, v_ref, txn.id,
       p_local_amount_minor, coalesce(p_provider_amount_minor, txn.amount_minor),
       'refused', txn.event_type::text, txn.currency,
       jsonb_build_object('note', p_note, 'raised_by', 'payment activation trigger'))
    -- payment_reconciliation_flags_open_unique is PARTIAL (`where status =
    -- 'open'`), so the conflict target has to carry the same predicate or
    -- Postgres cannot infer the index. A flag a human already resolved
    -- therefore does not conflict, and a recurrence correctly raises a fresh
    -- row rather than silently reopening the closed one.
    on conflict (provider, provider_reference, flag_type) where status = 'open' do update
      set payment_transaction_id  = excluded.payment_transaction_id,
          local_amount_minor      = excluded.local_amount_minor,
          provider_amount_minor   = excluded.provider_amount_minor,
          local_status            = excluded.local_status,
          provider_status         = excluded.provider_status,
          detail                  = excluded.detail,
          detected_at             = now();

    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload, content_class, priority)
    select
      txn.organisation_id, p.id, 'in_app', 'payment_integrity_flag_raised',
      jsonb_build_object(
        'payment_transaction_id', txn.id,
        'provider_reference', v_ref,
        'flag_type', p_flag_type,
        'note', p_note,
        'local_amount_minor', p_local_amount_minor,
        'provider_amount_minor', coalesce(p_provider_amount_minor, txn.amount_minor)
      ),
      'non_clinical', 'routine'
    from public.profiles p
    where p.role = 'admin'
      and not exists (
        select 1 from public.notifications n
         where n.template = 'payment_integrity_flag_raised'
           and n.recipient_id = p.id
           and n.payload->>'provider_reference' = v_ref
           and n.payload->>'flag_type' = p_flag_type
           and n.created_at > now() - interval '1 day'
      );
  exception when others then
    raise warning 'record_payment_integrity_flag: could not flag % for txn % (%)',
      p_flag_type, p_txn_id, sqlerrm;
  end;
end;
$function$;

comment on function private.record_payment_integrity_flag(uuid, text, text, bigint, bigint, text) is
  'Records a refused payment activation as a payment_reconciliation_flags row and alerts every admin in_app. Called from inside payment webhook triggers, so it never raises.';

-- ---------------------------------------------------------------------------
-- Service purchase activation: verify the amount before granting.
-- ---------------------------------------------------------------------------
create or replace function private.apply_service_purchase_payment()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_kind text;
  v_ref text;
  v_purchase public.service_purchases%rowtype;
  v_product public.service_products%rowtype;
  v_expected_net bigint;
  v_expected_gross bigint;
begin
  if new.event_type not in ('charge.success', 'checkout.session.completed') then
    return new;
  end if;

  v_kind := coalesce(
    new.raw_payload -> 'data' -> 'metadata' ->> 'kind',
    new.raw_payload -> 'data' -> 'object' -> 'metadata' ->> 'kind'
  );
  if v_kind is distinct from 'service_purchase' then
    return new;
  end if;

  v_ref := coalesce(
    new.raw_payload -> 'data' ->> 'reference',
    new.raw_payload -> 'data' -> 'object' ->> 'id'
  );
  if v_ref is null then
    return new;
  end if;

  select * into v_purchase from public.service_purchases
    where pending_payment_provider_ref = v_ref and status = 'pending_payment'
    for update;
  if not found then
    return new;
  end if;

  select * into v_product from public.service_products where id = v_purchase.service_product_id;

  -- The amount assertion. Skipped only when the provider event carries no
  -- amount at all -- refusing on a null would strand a legitimate payment
  -- over a payload shape rather than over a discrepancy.
  if new.amount_minor is not null then
    v_expected_net   := coalesce(v_purchase.payable_kobo, v_purchase.amount_kobo);
    v_expected_gross := v_purchase.amount_kobo;
    if new.amount_minor <> v_expected_net and new.amount_minor <> v_expected_gross then
      perform private.record_payment_integrity_flag(
        new.id, 'amount_mismatch', v_ref, v_expected_net, new.amount_minor,
        format('Refused to activate service purchase %s: charged %s, owed %s (gross %s). Left at pending_payment.',
               v_purchase.id, new.amount_minor, v_expected_net, v_expected_gross));
      return new;
    end if;
    if new.currency is not null and new.currency <> v_purchase.currency then
      perform private.record_payment_integrity_flag(
        new.id, 'amount_mismatch', v_ref, v_expected_net, new.amount_minor,
        format('Refused to activate service purchase %s: paid in %s, priced in %s.',
               v_purchase.id, new.currency, v_purchase.currency));
      return new;
    end if;
  end if;

  update public.service_purchases
    set status = 'active',
        payment_provider = new.provider,
        payment_provider_ref = v_ref,
        pending_payment_provider_ref = null,
        purchased_at = now(),
        expires_at = case when v_product.access_duration_days is null then null
                          else now() + (v_product.access_duration_days || ' days')::interval end
    where id = v_purchase.id;

  return new;
end;
$function$;

comment on function private.apply_service_purchase_payment() is
  'Activates a pending service_purchases row on a matching charge.success. Verifies the charged amount against the purchase''s payable_kobo (or its gross amount_kobo, which a post-checkout voucher redemption can leave it at) and its currency before granting; a mismatch refuses activation and raises a payment_reconciliation_flags amount_mismatch row instead.';

-- ---------------------------------------------------------------------------
-- Sponsored activation: reference, amount, and extend-not-reset.
-- ---------------------------------------------------------------------------
create or replace function private.activate_sponsored_service_purchase()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_meta jsonb;
  v_ref text;
  v_beneficiary uuid;
  v_sponsor uuid;
  v_product record;
  v_org uuid;
  v_existing public.service_purchases%rowtype;
  v_until timestamptz;
begin
  if new.event_type::text not in ('charge.success', 'checkout.session.completed') then
    return new;
  end if;

  v_meta := coalesce(
    new.raw_payload -> 'data' -> 'metadata',
    new.raw_payload -> 'data' -> 'object' -> 'metadata',
    new.raw_payload -> 'metadata',
    '{}'::jsonb
  );

  if coalesce(v_meta ->> 'kind', '') <> 'sponsored_subscription' then
    return new;
  end if;

  begin
    v_ref := coalesce(
      new.raw_payload -> 'data' ->> 'reference',
      new.raw_payload -> 'data' -> 'object' ->> 'id'
    );

    -- Hole 2. Without a reference this grant has no identity: it cannot be
    -- correlated, reconciled, or made idempotent. Refuse rather than grant
    -- on metadata alone.
    if v_ref is null then
      perform private.record_payment_integrity_flag(
        new.id, 'status_mismatch', null, null, new.amount_minor,
        'Refused a sponsored service grant: the event carried no provider reference to correlate or dedupe against.');
      return new;
    end if;

    v_beneficiary := nullif(v_meta ->> 'beneficiary_profile_id', '')::uuid;
    v_sponsor     := nullif(v_meta ->> 'sponsor_profile_id', '')::uuid;

    select id, code, currency, price_kobo, access_duration_days
      into v_product
      from public.service_products
     where code = v_meta ->> 'plan_code';

    if v_beneficiary is null or v_sponsor is null or v_product.id is null then
      return new;
    end if;

    -- Idempotency. A Paystack retry of the same charge must not buy a second
    -- window. payment_provider_ref is the charge's own identity, so a row
    -- already carrying it has already been granted.
    if exists (
      select 1 from public.service_purchases
       where payment_provider_ref = v_ref
         and service_product_id = v_product.id
    ) then
      return new;
    end if;

    -- Hole 1. What the sponsor was actually charged has to be what the
    -- product costs. Metadata names the product; only the amount proves it
    -- was paid for.
    if new.amount_minor is not null and new.amount_minor <> v_product.price_kobo then
      perform private.record_payment_integrity_flag(
        new.id, 'amount_mismatch', v_ref, v_product.price_kobo, new.amount_minor,
        format('Refused a sponsored grant of %s: charged %s, priced %s.',
               v_product.code, new.amount_minor, v_product.price_kobo));
      return new;
    end if;
    if new.currency is not null and new.currency <> v_product.currency then
      perform private.record_payment_integrity_flag(
        new.id, 'amount_mismatch', v_ref, v_product.price_kobo, new.amount_minor,
        format('Refused a sponsored grant of %s: paid in %s, priced in %s.',
               v_product.code, new.currency, v_product.currency));
      return new;
    end if;

    if not exists (
      select 1 from public.profile_access pa
       where pa.profile_id = v_beneficiary
         and pa.grantee_user_id = v_sponsor
         and pa.permission_level = 'manage'
    ) then
      return new;
    end if;

    select organisation_id into v_org from public.profiles where id = v_beneficiary;

    select * into v_existing
      from public.service_purchases
     where patient_id = v_beneficiary
       and service_product_id = v_product.id
       and status = 'active'
     order by expires_at desc nulls first
     limit 1;

    if v_existing.id is not null then
      -- Hole 3. Extend from whichever is later: the access already paid for,
      -- or now. Never from now() alone, which shortens a window mid-term.
      if v_existing.expires_at is null then
        -- Already perpetual. Nothing a dated window can add.
        v_until := null;
      else
        v_until := greatest(v_existing.expires_at, now())
                   + (coalesce(v_product.access_duration_days, 30) || ' days')::interval;
      end if;

      update public.service_purchases
         set purchaser_profile_id = v_sponsor,
             payment_provider = new.provider,
             payment_provider_ref = v_ref,
             expires_at = v_until,
             updated_at = now()
       where id = v_existing.id;
    else
      insert into public.service_purchases
        (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
         amount_kobo, currency, purchased_at, expires_at, payment_provider, payment_provider_ref)
      values
        (v_org, v_beneficiary, v_sponsor, v_product.id, 'active',
         v_product.price_kobo, v_product.currency, now(),
         now() + (coalesce(v_product.access_duration_days, 30) || ' days')::interval,
         new.provider, v_ref);
    end if;

    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload, content_class)
    select v_org, x.recipient, c.channel, 'sponsored_plan_started',
           jsonb_build_object(
             'plan_name', v_product.code,
             'sponsor_name', (select coalesce(nullif(trim(full_name),''),'someone') from public.profiles where id = v_sponsor),
             'person_name', (select coalesce(nullif(trim(full_name),''),'someone') from public.profiles where id = v_beneficiary),
             'is_payer', x.recipient = v_sponsor
           ),
           'non_clinical'
      from (values (v_beneficiary), (v_sponsor)) as x(recipient)
      cross join (values ('in_app'::public.notification_channel),
                         ('email'::public.notification_channel)) as c(channel);

  exception when others then
    -- Never abort the payment record itself -- but no longer return in
    -- silence either. A sponsor was charged and got nothing; somebody has to
    -- be told.
    perform private.record_payment_integrity_flag(
      new.id, 'status_mismatch', v_ref, null, new.amount_minor,
      format('A sponsored service grant failed and was swallowed: %s', sqlerrm));
    return new;
  end;

  return new;
end;
$function$;

comment on function private.activate_sponsored_service_purchase() is
  'Grants a sponsor-funded service_purchases row on a matching charge.success. Requires a provider reference (recorded, and deduped against so a webhook retry cannot buy a second window), verifies the charged amount and currency against the product''s own price, and EXTENDS an existing active window from its later of expiry/now rather than resetting it to now()+duration -- which used to shorten access a patient had already paid for.';

-- ---------------------------------------------------------------------------
-- Assertions.
-- ---------------------------------------------------------------------------
do $$
declare
  v_apply text := pg_get_functiondef('private.apply_service_purchase_payment()'::regprocedure);
  v_spon  text := pg_get_functiondef('private.activate_sponsored_service_purchase()'::regprocedure);
begin
  if v_apply not like '%new.amount_minor <> v_expected_net%' then
    raise exception 'FAIL: apply_service_purchase_payment does not compare the charged amount';
  end if;
  if v_spon not like '%new.amount_minor <> v_product.price_kobo%' then
    raise exception 'FAIL: activate_sponsored_service_purchase is still amount-blind';
  end if;
  if v_spon not like '%payment_provider_ref = v_ref%' then
    raise exception 'FAIL: activate_sponsored_service_purchase still has no provider-reference match';
  end if;
  if v_spon like '%expires_at = v_until,%' and v_spon not like '%greatest(v_existing.expires_at, now())%' then
    raise exception 'FAIL: activate_sponsored_service_purchase still resets expires_at instead of extending it';
  end if;
end $$;
