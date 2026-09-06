-- Episodic-fee rebuild, step 4/6.
--
-- Activates a programme_purchases row when its Paystack charge succeeds — via
-- an AFTER INSERT trigger on payment_transactions, matching metadata.kind =
-- 'programme_purchase', exactly the pattern
-- private.apply_voucher_payment_from_transaction (20260731215226) and
-- private.activate_sponsored_subscription (20260801092000) already use. The
-- deployed paystack-webhook Edge Function writes every verified charge into
-- payment_transactions before it ever branches on metadata.kind, so this needs
-- no change to that function and no redeploy — deliberate, per those two
-- functions' own header comments about the redeploy-drift risk this codebase
-- has already been bitten by twice. A 'programme_purchase' kind is simply one
-- the deployed webhook's own switch does not recognise: it falls into that
-- switch's default lookup, finds no matching row, and writes a harmless error
-- string to payment_transactions.error — the row itself (and its raw_payload,
-- which is all this trigger reads) is unaffected.

create or replace function private.activate_programme_purchase_from_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_ref text;
  v_purchase public.programme_purchases%rowtype;
begin
  if new.event_type not in ('charge.success', 'checkout.session.completed') then
    return new;
  end if;

  v_kind := coalesce(
    new.raw_payload -> 'data' -> 'metadata' ->> 'kind',
    new.raw_payload -> 'data' -> 'object' -> 'metadata' ->> 'kind'
  );
  if v_kind is distinct from 'programme_purchase' then return new; end if;

  v_ref := coalesce(
    new.raw_payload -> 'data' ->> 'reference',
    new.raw_payload -> 'data' -> 'object' ->> 'id'
  );
  if v_ref is null then return new; end if;

  begin
    select * into v_purchase from public.programme_purchases
     where pending_payment_provider_ref = v_ref and status = 'pending_payment' for update;
    if not found then return new; end if;

    update public.programme_purchases
       set status = 'active',
           starts_at = current_date,
           ends_at = current_date + (duration_weeks || ' weeks')::interval,
           purchased_at = now(),
           payment_provider = 'paystack',
           payment_provider_ref = v_ref,
           pending_payment_provider_ref = null
     where id = v_purchase.id;

    perform private.enrol_patient_in_purchased_programme(v_purchase.id);
  exception when others then
    -- Never abort the payment record itself over a downstream enrolment bug —
    -- same reasoning as activate_sponsored_subscription's guard.
    return new;
  end;

  return new;
end;
$$;

drop trigger if exists payment_transactions_activate_programme_purchase on public.payment_transactions;
create trigger payment_transactions_activate_programme_purchase
  after insert on public.payment_transactions
  for each row execute function private.activate_programme_purchase_from_transaction();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'payment_transactions_activate_programme_purchase') then
    raise exception 'FAIL: programme purchase activation trigger was not attached';
  end if;
end $$;
