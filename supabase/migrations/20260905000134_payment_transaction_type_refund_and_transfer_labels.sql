-- ===========================================================================
-- HIGH: refunds could never be recorded, so the refund posting branch was
-- unreachable and refunded money silently stayed on the books.
--
-- public.payment_transaction_type carried 16 labels and not one of them
-- contained "refund" — `select 'refund.processed'::payment_transaction_type`
-- raises 22P02. supabase/functions/paystack-webhook/index.ts writes
-- `event_type: event.event` verbatim, so a Paystack refund webhook made the
-- payment_transactions INSERT fail with 22P02; the handler only tolerates
-- 23505 (its idempotency conflict), so it logged, returned `record_failed`
-- and recorded NOTHING — no audit row, no posting, despite the file's own
-- header promising "every event is recorded to payment_transactions,
-- including ones it fails to process, so nothing is ever silently dropped."
--
-- private.finance_post_from_payment's refund branch keys on
-- `txn.event_type::text ilike '%refund%'` (Dr 4900 Refunds / Cr 1020 Cash),
-- so it could never fire. Net effect: a refunded ₦5,000 video visit left
-- ₦5,000 of cash and revenue on the ledger that is not in the bank, with no
-- record anywhere that would surface the discrepancy.
--
-- Adds the real Paystack event names for both money-out families. `transfer.*`
-- is included because it is the same failure mode waiting to happen: the
-- moment Tarragon settles a partner laboratory or pharmacy through Paystack
-- Transfers, those events hit the same insert and would be dropped the same
-- way.
--
-- No data migration: zero existing rows change. The enum only gains labels.
--
-- Assertions below read pg_enum by label text rather than casting a literal —
-- Postgres forbids USING a value added by ALTER TYPE ... ADD VALUE inside the
-- same transaction, and a Supabase migration is one transaction.
-- ===========================================================================

alter type public.payment_transaction_type add value if not exists 'refund.pending';
alter type public.payment_transaction_type add value if not exists 'refund.processed';
alter type public.payment_transaction_type add value if not exists 'refund.failed';
alter type public.payment_transaction_type add value if not exists 'transfer.success';
alter type public.payment_transaction_type add value if not exists 'transfer.failed';
alter type public.payment_transaction_type add value if not exists 'transfer.reversed';

do $$
declare
  v_missing text;
begin
  select string_agg(want, ', ') into v_missing
  from unnest(array[
    'refund.pending','refund.processed','refund.failed',
    'transfer.success','transfer.failed','transfer.reversed'
  ]) as want
  where not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'payment_transaction_type' and e.enumlabel = want
  );

  if v_missing is not null then
    raise exception 'payment_transaction_type is still missing: %', v_missing;
  end if;

  -- private.finance_post_from_payment's refund branch matches on
  -- ilike '%refund%'. If that stops being true the labels above stop
  -- reaching the ledger, so assert the contract rather than the spelling.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'finance_post_from_payment'
      and pg_get_functiondef(p.oid) ilike '%ilike ''%%refund%%''%'
  ) then
    raise exception 'private.finance_post_from_payment no longer classifies refunds by an ilike %%refund%% match — these labels would post nothing';
  end if;

  -- The safe fallback the webhook coerces an unknown event name to must
  -- exist, or that coercion turns a dropped event into a failed insert again.
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'payment_transaction_type' and e.enumlabel = 'other'
  ) then
    raise exception 'payment_transaction_type has no ''other'' label for the webhook to fall back to';
  end if;
end;
$$;
