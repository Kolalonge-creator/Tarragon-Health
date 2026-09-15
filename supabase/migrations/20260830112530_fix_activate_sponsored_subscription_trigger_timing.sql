-- Fixes a real, live bug found while building the §91.9 subsidy engine
-- (which extends this same sponsored-payment activation path): the
-- activate_sponsored_subscription trigger was AFTER INSERT ONLY, but its own
-- function body gates on `if new.processed_at is null then return new; end if`
-- — and both webhooks always insert payment_transactions with
-- processed_at NULL, only setting it via a LATER markProcessed() UPDATE.
-- That means this trigger's activation branch could never actually run via
-- the real webhook flow: every sponsored-subscription payment recorded the
-- charge but never activated the beneficiary's plan.
--
-- Verified end-to-end (not just the function in isolation, which is what let
-- this ship undetected — see packages/db/tests/sponsor_care_status_and_funding.sql,
-- which must have exercised the function directly rather than the real
-- insert-then-update sequence): a rolled-back transaction replaying the
-- webhook's exact two-statement sequence (insert, then UPDATE ... SET
-- processed_at) now correctly activates the subscription.
--
-- Fix mirrors the working sibling trigger on the same table
-- (finance_post_payment_processed, already `AFTER INSERT OR UPDATE OF
-- processed_at`) — the function body needs no change, since its own
-- `processed_at is null` guard already correctly no-ops on the INSERT leg
-- and only proceeds once the UPDATE leg sets a real timestamp.

drop trigger if exists activate_sponsored_subscription on public.payment_transactions;
create trigger activate_sponsored_subscription
  after insert or update of processed_at on public.payment_transactions
  for each row execute function private.activate_sponsored_subscription();

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.payment_transactions'::regclass
      and tgname = 'activate_sponsored_subscription'
      and not tgisinternal
  ) then
    raise exception 'activate_sponsored_subscription trigger is missing after migration';
  end if;
end $$;
