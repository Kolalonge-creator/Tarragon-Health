-- Tarragon Health — §91.11 wire real refunds into Care Voucher cancellation.
--
-- cancel_care_voucher() previously only flipped a status — its own comment
-- said "cancellation deliberately moves no money... any refund is a provider
-- refund against the original charge," done by a human separately. This adds
-- that missing half without weakening any of the four Care Voucher
-- guarantees (single-purpose, non-transferable, never cash-redeemable,
-- 24-month expiry): no payout function is added anywhere, only a queue that
-- calls the SAME provider refund APIs already used for video-visit refunds
-- (refundTransaction) — money goes back to the original card, never to a
-- Tarragon-controlled balance.
--
-- A voucher can have more than one care_voucher_payments row (layaway), so
-- this queues one refund PER completed payment, not one per voucher — each
-- queue row maps 1:1 to a real prior charge. A reward_discount voucher was
-- never paid for and has zero care_voucher_payments rows, so cancelling one
-- naturally queues nothing; no special-casing by kind is needed.
--
-- Also reverses the GL entries the cancelled money represented — the payment
-- entry behind each queued refund, and (for a not-yet-redeemed reward
-- voucher) its issuance entry — independent of whether the async refund has
-- actually settled with the provider yet, so the ledger reflects the
-- cancellation immediately.

create table public.voucher_refund_queue (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.care_vouchers (id) on delete restrict,
  care_voucher_payment_id uuid not null references public.care_voucher_payments (id) on delete restrict,
  provider public.payment_provider not null,
  provider_reference text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency public.currency not null,
  status text not null default 'due' check (status in ('due', 'refunded', 'failed')),
  provider_refund_ref text,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (care_voucher_payment_id)
);
alter table public.voucher_refund_queue enable row level security;
create index voucher_refund_queue_status_idx on public.voucher_refund_queue (status);
create trigger voucher_refund_queue_set_updated_at before update on public.voucher_refund_queue
  for each row execute function private.set_updated_at();

-- Read via RLS, same split as every other finance-adjacent table here —
-- writes are RPC/cron (service-role) only.
create policy voucher_refund_queue_select on public.voucher_refund_queue
  for select to authenticated
  using (private.is_admin() or private.has_permission('vouchers.manage'));
grant select on public.voucher_refund_queue to authenticated;

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
    if v_cvp.payment_transaction_id is not null then
      select id into v_entry from public.finance_journal_entries
        where source = 'payment' and source_ref = v_cvp.payment_transaction_id::text and is_reversed = false;
      if v_entry is not null then
        perform private.finance_reverse_entry(v_entry, 'Care voucher cancelled: ' || trim(p_reason), v_caller);
      end if;
    end if;
  end loop;

  -- A reward_discount voucher not yet redeemed still has its issuance entry
  -- (source='voucher', source_ref='reward:'||id) standing — reverse it too.
  if v_v.kind = 'reward_discount' then
    select id into v_entry from public.finance_journal_entries
      where source = 'voucher' and source_ref = 'reward:' || p_voucher::text and is_reversed = false;
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
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'voucher_refund_queue') then
    raise exception 'voucher_refund_queue was not created';
  end if;
  if has_function_privilege('anon', 'public.cancel_care_voucher(uuid, text)', 'EXECUTE') then
    raise exception 'anon must never execute cancel_care_voucher';
  end if;
end $$;
