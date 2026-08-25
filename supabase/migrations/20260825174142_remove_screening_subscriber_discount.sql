-- Removing the screening subscriber discount.
--
-- Founder decision, 2026-08-25, on seeing the number directly: a Core Screen
-- sold through Synlab clears the contract by 16.6% undiscounted (₦227,500
-- against a ₦189,800 cost). The 15% subscriber discount cut that to
-- ₦193,375 — a ₦3,575 margin, 1.6% of the price. A subscriber Core Screen
-- was, in effect, being given away.
--
-- This is a pricing decision, not a bug, so it is undone the same way it was
-- made: private.apply_screening_subscriber_discount stops writing a discount,
-- rather than deleting the column or the trigger. subscriber_discount_kobo
-- stays on the table (existing paid orders keep their true history — refunds
-- and statements against them still read correctly), payable_kobo's
-- generated formula is untouched (it already just subtracts whatever is
-- there, which is now always zero for a new order), and
-- private.enforce_lab_order_not_below_cost keeps working unchanged — it was
-- always "total minus subscriber_discount_kobo", and that is still true when
-- the second term is always zero.
--
-- Trigger wiring is untouched too: lab_orders_screening_subscriber_discount
-- still exists and still fires 'zz' still fires after it alphabetically. A
-- future subscriber incentive on a screening review is now free to reuse
-- either the trigger or the column without a second migration re-deriving
-- this ordering.
create or replace function private.apply_screening_subscriber_discount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- No subscriber discount on a priced screening review. Founder decision,
  -- 2026-08-25: on the first live margin figure, the 15% discount this
  -- function used to apply left a partner-billed Core Screen clearing its
  -- Synlab cost by about 1.6% — not a sustainable price for a subscriber to
  -- be offered. subscriber_discount_kobo is left in place as a column so a
  -- future, deliberately-priced subscriber incentive has somewhere to write
  -- to without a schema change; this trigger just never sets it.
  return new;
end;
$$;

revoke all on function private.apply_screening_subscriber_discount() from public;

do $$
begin
  if pg_get_functiondef('private.apply_screening_subscriber_discount()'::regprocedure) ilike '%0.15%' then
    raise exception 'the subscriber discount is still being computed somewhere in this function';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.lab_orders'::regclass
       and tgname = 'lab_orders_screening_subscriber_discount'
       and not tgisinternal
  ) then
    raise exception 'the subscriber-discount trigger was removed — it must stay wired for ordering, just neutered';
  end if;
end $$;
