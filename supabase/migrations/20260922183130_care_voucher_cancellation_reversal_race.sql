-- cancel_care_voucher (20260830103626) reverses the GL entry behind each
-- payment/issuance it cancels by calling private.finance_reverse_entry, but
-- it locates that entry with a PLAIN `select ... where is_reversed = false`
-- first -- no lock. 20260922181900 (finance reversal row locking) gave
-- finance_reverse_entry its own `select ... for update` and made it RAISE
-- 'entry already reversed' when a concurrent caller already reversed the
-- same row. Composed together, that turns a real, reachable race into an
-- opaque failure this function never used to be able to produce:
--
--   1. cancel_care_voucher's plain select reads is_reversed = false (a
--      genuinely concurrent, independent reversal of the SAME journal entry
--      -- a finance officer reversing that payment for an unrelated reason,
--      or approving a queued journal_reversal request against it -- is
--      still mid-transaction, not yet committed).
--   2. cancel_care_voucher calls private.finance_reverse_entry, whose own
--      `for update` blocks behind the other session's lock.
--   3. The other session commits (is_reversed now true). The blocked lock
--      is granted, finance_reverse_entry re-reads the committed row, and
--      raises 'entry already reversed'.
--   4. Nothing catches that. It propagates out of cancel_care_voucher's
--      whole PL/pgSQL body, aborting the ENTIRE transaction -- the voucher's
--      status update, its care_voucher_events row, and the
--      voucher_refund_queue insert for THIS SAME payment (already done
--      earlier in the same transaction, before the reversal loop reached
--      this entry) all roll back too. An admin cancelling a voucher sees a
--      bare "entry already reversed" and the voucher is left exactly as it
--      was -- not cancelled, no refund queued -- even though the only thing
--      that actually happened concurrently was someone else reversing the
--      SAME underlying charge, which is not a reason cancellation itself
--      should fail.
--
-- This is a genuinely different case from two concurrent attempts to cancel
-- the SAME voucher: that is already fully serialised by this function's own
-- `select * from care_vouchers where id = p_voucher for update` at the top
-- -- the second caller cannot even begin its own reversal loop until the
-- first has committed, and by then its own plain select of the (now
-- committed) entry already correctly finds is_reversed = true and skips it.
-- The race above only reaches this function through a lock on the SAME
-- finance_journal_entries row acquired by someone OTHER than a concurrent
-- cancel_care_voucher call on this voucher.
--
-- Fix: lock + recheck, the same pattern finance_reverse_journal itself uses
-- (see 20260922181900). Add `for update` to both of this function's target
-- lookups (the per-payment entry in the reversal loop, and the reward-
-- voucher issuance entry). Under Postgres's documented SELECT ... FOR UPDATE
-- behaviour, a lookup that blocks on a row a concurrent transaction is
-- reversing does not simply unblock and return that row once the lock is
-- released -- it RE-EVALUATES the WHERE clause against the now-committed
-- row first. Since `is_reversed = false` no longer holds once the other
-- session has committed, the row is excluded from the result outright:
-- v_entry stays NULL, private.finance_reverse_entry is never even called,
-- and no exception is raised. The cancellation proceeds and completes
-- normally -- it just doesn't reverse an entry someone else already
-- reversed, which is the correct outcome, not a failure. No exception
-- handling is needed or added: the lock+recheck closes the race at its
-- source rather than catching its symptom.
--
-- Standing regression coverage: a real two-connection proof, for the same
-- reason 20260922181900's own proof is a .sh and not a .sql (a single psql
-- session cannot hold a lock against itself to prove a second, independent
-- session actually blocks on it) --
-- packages/db/tests/care_voucher_cancellation_concurrent_reversal.sh,
-- registered in ci.manifest. It races a direct external reversal
-- (public.finance_reverse_journal, standing in for an unrelated finance
-- officer or an approved journal_reversal request against the same entry)
-- against public.cancel_care_voucher for the voucher backed by that same
-- entry, asserts the challenger was genuinely blocked (wall-clock >= 1s) and
-- then completes cleanly with the voucher cancelled and its refund queued,
-- and includes a sabotage phase that temporarily redeploys this exact
-- pre-fix (plain, unlocked select) body and shows the race reopens as the
-- unhandled 'entry already reversed' abort described above.

create or replace function public.cancel_care_voucher(p_voucher uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_v public.care_vouchers%rowtype;
  v_cvp record;
  v_refund_count int := 0;
  v_entry uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if not (private.is_admin() or private.has_permission('vouchers.manage')) then
    raise exception 'not authorised to cancel a voucher' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;

  select * into v_v from public.care_vouchers where id = p_voucher for update;
  if not found then raise exception 'voucher not found'; end if;
  if v_v.status = 'redeemed' then raise exception 'a used voucher cannot be cancelled'; end if;

  update public.care_vouchers
     set status = 'cancelled', cancelled_at = now(), cancelled_reason = trim(p_reason)
   where id = p_voucher;

  insert into public.care_voucher_events
    (organisation_id, voucher_id, event_type, actor_profile_id, amount_kobo, note)
  values (v_v.organisation_id, p_voucher, 'cancelled', v_caller, v_v.amount_paid_kobo, trim(p_reason));

  -- Queue a real provider refund for every completed payment behind this
  -- voucher. A reward_discount voucher was never paid for, so it has no
  -- care_voucher_payments rows and this loop naturally does nothing for one
  -- — no special-casing by kind needed.
  for v_cvp in
    select * from public.care_voucher_payments
    where voucher_id = p_voucher and status = 'applied' and pending_provider_ref is not null
  loop
    insert into public.voucher_refund_queue
      (voucher_id, care_voucher_payment_id, provider, provider_reference, amount_minor, currency)
    values
      (p_voucher, v_cvp.id, v_cvp.provider, v_cvp.pending_provider_ref, v_cvp.amount_minor, v_cvp.currency::public.currency)
    on conflict (care_voucher_payment_id) do nothing;
    v_refund_count := v_refund_count + 1;

    -- Reverse the GL entry this specific payment posted (source='payment',
    -- source_ref=payment_transaction_id) — independent of whether the async
    -- refund has settled yet, so the ledger reflects the cancellation now.
    -- `for update`: lock + recheck against a concurrent reversal of this
    -- SAME entry by someone else (see this migration's header) — if the
    -- entry is (or becomes, while this blocks) already reversed, this
    -- simply finds no row rather than calling finance_reverse_entry and
    -- risking its 'entry already reversed' raise.
    if v_cvp.payment_transaction_id is not null then
      select id into v_entry from public.finance_journal_entries
        where source = 'payment' and source_ref = v_cvp.payment_transaction_id::text and is_reversed = false
        for update;
      if v_entry is not null then
        perform private.finance_reverse_entry(v_entry, 'Care voucher cancelled: ' || trim(p_reason), v_caller);
      end if;
    end if;
  end loop;

  -- A reward_discount voucher not yet redeemed still has its issuance entry
  -- (source='voucher', source_ref='reward:'||id) standing — reverse it too.
  -- Same lock+recheck as above.
  if v_v.kind = 'reward_discount' then
    select id into v_entry from public.finance_journal_entries
      where source = 'voucher' and source_ref = 'reward:' || p_voucher::text and is_reversed = false
      for update;
    if v_entry is not null then
      perform private.finance_reverse_entry(v_entry, 'Reward voucher cancelled: ' || trim(p_reason), v_caller);
    end if;
  end if;

  perform private.log_audit('care_vouchers.cancelled', 'care_vouchers', p_voucher,
    jsonb_build_object('reason', p_reason, 'amount_paid_kobo', v_v.amount_paid_kobo, 'refunds_queued', v_refund_count));

  return jsonb_build_object('ok', true, 'refunds_queued', v_refund_count);
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'cancel_care_voucher'
  ) then
    raise exception 'cancel_care_voucher went missing';
  end if;
  if has_function_privilege('anon', 'public.cancel_care_voucher(uuid, text)', 'EXECUTE') then
    raise exception 'anon must never execute cancel_care_voucher';
  end if;
end $$;
