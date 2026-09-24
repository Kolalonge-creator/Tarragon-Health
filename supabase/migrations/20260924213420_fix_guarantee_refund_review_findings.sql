-- Fixes to public.decide_purchase_guarantee_refund, found by /code-review high
-- on 20260924210805_first_purchase_guarantee_refunds.sql before it ever
-- reached a PR. Corrective migration, not an edit of the original file, per
-- this repo's own "never rewrite an applied migration" discipline.
--
-- 1. DOUBLE GL POSTING on a platform_credit-paid refund. The original
--    function called BOTH private.finance_reverse_entry (on the spend's
--    'spend-paid:'/'spend-promo:' journal entry, which itself correctly
--    contras the liability account 2100/2600 back up) AND
--    public.correct_platform_credit (whose admin_correction branch, per
--    private.finance_post_platform_credit_ledger_entry, ALSO posts
--    Dr 2100/2600 / Cr 2400 "Refunds payable" — a second, independent debit
--    to the SAME liability account for one restoration event). Traced
--    directly against private.platform_credit_apply's admin_correction
--    branch (20260917220507_platform_credit_admin_change_notifies_patient.sql)
--    before writing this: it always debits the named bucket account
--    regardless of the entry's own "increase" direction, and always adds to
--    lifetime_funded_kobo — this primitive was built for a manual,
--    approximate "flag for finance to settle out of band" correction (its
--    own header comment says exactly that), not a precise reversal of one
--    specific spend. Reversing the spend entry AND calling this primitive
--    double-debits the liability account. Fix: for a platform_credit-paid
--    purchase, correct_platform_credit is now the ONLY mechanism touching
--    the spend's liability/revenue posting — matching how the codebase
--    already treats any other admin_correction, and avoiding inventing a
--    new GL primitive to net the two calls together precisely.
--
-- 2. The Paystack transaction correlation (matching
--    service_purchases.payment_provider_ref against
--    payment_transactions.raw_payload) had no metadata.kind='service_purchase'
--    guard, unlike every other caller of this exact correlation idiom —
--    private.finance_post_from_payment's own service_purchase branch and
--    private.resolve_payment_payer both gate on it deliberately, per
--    resolve_payment_payer's own comment: "so this can never accidentally
--    match an unrelated transaction that happens to share a reference
--    string." Added here to match.
--
-- 3. If that correlation found no payment_transactions row at all (or found
--    one but no 'payment' journal entry was ever posted for it), the
--    original code silently skipped the GL reversal and proceeded to queue
--    a real Paystack refund anyway — reintroducing exactly the "phantom
--    revenue" class of bug 20260905204245_reverse_phantom_service_purchase_
--    revenue.sql exists to prevent, with no error surfaced to the approving
--    admin. Now raises rather than silently proceeding. An entry that WAS
--    found but is already reversed (is_reversed = true) is a legitimate
--    no-op, not an error.
--
-- 4. The refund amount queued for Paystack used
--    coalesce(payable_kobo, amount_kobo) — the nominal price — rather than
--    the amount actually charged. This Paystack account passes its
--    transaction fee on to the customer (documented in
--    20260910215431_service_purchase_activation_tolerates_customer_borne_fee.sql,
--    private.apply_service_purchase_payment activates on whatever
--    payment_transactions.amount_minor really was, which can be HIGHER than
--    payable_kobo/amount_kobo), so a guarantee refund could short the
--    patient by the fee amount — directly contradicting this feature's own
--    "refunding the FULL amount actually paid" promise. Now reads the real
--    payment_transactions.amount_minor for the Paystack queue row, falling
--    back to payable_kobo/amount_kobo only if that transaction is somehow
--    unavailable (which finding 3 above now makes impossible without
--    raising first).
--
-- 5. The revenue_recognition_schedules row was read with a plain SELECT, no
--    row lock, before deciding what to reverse and then cancelling it. The
--    monthly finance_recognize_revenue cron (0 3 1 * *) reads the same
--    'active' schedules and posts new tranches; without a lock, a tranche
--    recognised by that cron between this function's SELECT and its
--    'cancelled' UPDATE would never be swept into the reversal loop (which
--    already ran), leaving a small amount of recognised-but-unreversed
--    revenue on the books for a refunded purchase — exactly the same class
--    of bug 20260905204245 exists to prevent, and the same race
--    20260922181900_finance_reversal_row_locking.sql closed for
--    finance_reverse_entry itself. Added `for update`.

create or replace function public.decide_purchase_guarantee_refund(
  p_claim_id uuid,
  p_approve boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_claim public.service_purchase_guarantee_claims%rowtype;
  v_purchase public.service_purchases%rowtype;
  v_amount_kobo bigint;
  v_txn_id uuid;
  v_txn_amount_minor bigint;
  v_paystack_refund_amount_kobo bigint;
  v_entry uuid;
  v_schedule record;
  v_recog record;
  v_ledger public.platform_credit_ledger_entries%rowtype;
  v_refund_mode text;
  v_reason text;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;
  if not private.is_admin() then
    raise exception 'not authorised to decide a guarantee refund' using errcode = '42501';
  end if;

  select * into v_claim from public.service_purchase_guarantee_claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found';
  end if;
  if v_claim.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_decided', 'status', v_claim.status);
  end if;

  if not p_approve then
    update public.service_purchase_guarantee_claims
      set status = 'denied', reviewed_by = v_caller, reviewed_at = now(), decision_note = p_note
      where id = p_claim_id;
    perform private.log_audit('service_purchase_guarantee.denied', 'service_purchase_guarantee_claims', p_claim_id,
      jsonb_build_object('note', p_note));
    return jsonb_build_object('ok', true, 'status', 'denied');
  end if;

  select * into v_purchase from public.service_purchases where id = v_claim.service_purchase_id for update;
  if not found then
    raise exception 'purchase not found for claim %', p_claim_id;
  end if;
  if v_purchase.status not in ('active', 'expired') then
    -- Race guard: something else (an expiry sweep, another admin) changed
    -- the purchase between request and decision.
    return jsonb_build_object('ok', false, 'reason', 'purchase_no_longer_refundable', 'status', v_purchase.status);
  end if;

  v_amount_kobo := coalesce(v_purchase.payable_kobo, v_purchase.amount_kobo);
  v_reason := 'First-purchase guarantee approved for service purchase ' || v_purchase.id::text;

  update public.service_purchases set status = 'refunded' where id = v_purchase.id;

  -- Give back any access this purchase granted. Re-derive via the same
  -- feature-access check the enrol-time trigger uses (now sees the
  -- 'refunded' status just written above) rather than hand-rolling a
  -- second "is another live purchase still granting this" query.
  if v_purchase.scoped_entity_type = 'chronic_programme_enrolments' and v_purchase.scoped_entity_id is not null then
    if not private.patient_has_feature_access(v_purchase.patient_id, 'chronic_doctor_supported_track') then
      update public.chronic_programme_enrolments
        set track = 'self_monitoring'
        where id = v_purchase.scoped_entity_id
          and status = 'enrolled'
          and track = 'doctor_supported';
    end if;
  end if;

  -- Wind down any revenue recognition schedule for this purchase — reverse
  -- every already-posted tranche, not just the original entry (see this
  -- migration's header and 20260905204245_reverse_phantom_service_purchase_
  -- revenue.sql for why), and lock the schedule row first so the monthly
  -- recogniser can't post a fresh tranche underneath this decision (finding
  -- 5 above).
  for v_schedule in
    select * from public.revenue_recognition_schedules
    where source_kind = 'service_purchase' and source_id = v_purchase.id and status = 'active'
    for update
  loop
    for v_recog in
      select id from public.finance_journal_entries
      where source = 'revenue_recognition'
        and source_ref like 'revrec:' || v_schedule.id::text || ':%'
        and is_reversed = false
    loop
      perform private.finance_reverse_entry(v_recog.id, v_reason, v_caller);
    end loop;

    update public.revenue_recognition_schedules
      set status = 'cancelled',
          cancelled_reason = 'Guarantee refund approved ' || to_char(now(), 'YYYY-MM-DD') ||
            ' for the service_purchase this schedule recognises revenue against (claim ' || p_claim_id::text || ').'
      where id = v_schedule.id;
  end loop;

  if v_purchase.payment_provider = 'paystack' then
    -- Correlate to the payment_transactions row the same way
    -- finance_post_from_payment/resolve_payment_payer do, INCLUDING their
    -- metadata.kind guard (finding 2), then reverse its GL entry.
    select id, amount_minor into v_txn_id, v_txn_amount_minor from public.payment_transactions
      where (raw_payload #>> '{data,reference}' = v_purchase.payment_provider_ref
          or raw_payload #>> '{data,object,id}' = v_purchase.payment_provider_ref)
        and coalesce(raw_payload #>> '{data,metadata,kind}', raw_payload #>> '{metadata,kind}') = 'service_purchase'
      order by created_at desc limit 1;

    if v_txn_id is null then
      raise exception 'could not correlate service purchase % to its payment_transactions row via reference % — refusing to approve a refund without a grounded GL reversal',
        v_purchase.id, v_purchase.payment_provider_ref;
    end if;

    -- The real amount Paystack charged can exceed payable_kobo when this
    -- account's processor fee is passed on to the customer (finding 4) —
    -- refund that, not the nominal price, so the guarantee is honoured in
    -- full.
    v_paystack_refund_amount_kobo := coalesce(v_txn_amount_minor, v_amount_kobo);

    if exists (select 1 from public.finance_journal_entries where source = 'payment' and source_ref = v_txn_id::text) then
      select id into v_entry from public.finance_journal_entries
        where source = 'payment' and source_ref = v_txn_id::text and is_reversed = false;
      if v_entry is not null then
        perform private.finance_reverse_entry(v_entry, v_reason, v_caller);
      end if;
      -- v_entry null here means it was already reversed by something else —
      -- a legitimate no-op, not an error.
    else
      raise exception 'no payment journal entry was ever posted for service purchase % (transaction %) — refusing to approve a refund without a grounded GL reversal',
        v_purchase.id, v_txn_id;
    end if;

    insert into public.service_purchase_refund_queue
      (service_purchase_id, guarantee_claim_id, provider, provider_reference, amount_minor, currency)
    values
      (v_purchase.id, p_claim_id, 'paystack', v_purchase.payment_provider_ref, v_paystack_refund_amount_kobo, v_purchase.currency)
    on conflict (guarantee_claim_id) do nothing;

    v_refund_mode := 'queued';

  elsif v_purchase.payment_provider = 'platform_credit' then
    select * into v_ledger from public.platform_credit_ledger_entries
      where service_purchase_id = v_purchase.id and entry_type = 'spend'
      order by created_at desc limit 1;

    if not found then
      raise exception 'no platform credit spend ledger entry found for service purchase %', v_purchase.id;
    end if;

    -- correct_platform_credit is the ONLY mechanism touching this spend's
    -- liability/revenue posting (finding 1) — it restores the patient's
    -- spendable balance AND posts its own GL correction; a separate
    -- finance_reverse_entry on the original spend entry would double-debit
    -- the same liability account. This does mean the original spend's
    -- revenue-side entry is left as posted rather than precisely reversed —
    -- an accepted imprecision matching correct_platform_credit's own
    -- documented purpose ("a flag for finance to settle out of band, rather
    -- than guessing whether real cash actually needs to move"), not unique
    -- to this feature.
    if v_ledger.paid_amount_kobo > 0 then
      perform public.correct_platform_credit(v_purchase.patient_id, 'paid', 'increase', v_ledger.paid_amount_kobo, v_reason);
    end if;
    if v_ledger.promo_amount_kobo > 0 then
      perform public.correct_platform_credit(v_purchase.patient_id, 'promo', 'increase', v_ledger.promo_amount_kobo, v_reason);
    end if;

    v_refund_mode := 'platform_credit_restored';
  else
    raise exception 'service purchase % has an unexpected payment_provider % for a guarantee refund',
      v_purchase.id, v_purchase.payment_provider;
  end if;

  update public.service_purchase_guarantee_claims
    set status = 'approved', reviewed_by = v_caller, reviewed_at = now(), decision_note = p_note
    where id = p_claim_id;

  perform private.log_audit('service_purchase_guarantee.approved', 'service_purchase_guarantee_claims', p_claim_id,
    jsonb_build_object('service_purchase_id', v_purchase.id, 'amount_kobo', v_amount_kobo, 'refund_mode', v_refund_mode));

  return jsonb_build_object('ok', true, 'status', 'approved', 'refund_mode', v_refund_mode, 'amount_kobo', v_amount_kobo);
end;
$$;

revoke execute on function public.decide_purchase_guarantee_refund(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.decide_purchase_guarantee_refund(uuid, boolean, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.decide_purchase_guarantee_refund(uuid, boolean, text)', 'EXECUTE') then
    raise exception 'FAIL: anon must never execute decide_purchase_guarantee_refund';
  end if;
  if not has_function_privilege('authenticated', 'public.decide_purchase_guarantee_refund(uuid, boolean, text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated must be able to execute decide_purchase_guarantee_refund';
  end if;
  raise notice 'PASS: decide_purchase_guarantee_refund review fixes applied, privileges intact';
end $$;
