-- The only service_purchases row that was ever USD/stripe is confirmed test data
-- (patient full_name = 'Test Diaspora Patient', $10.99). Deleting it now that the
-- Stripe integration is being removed entirely (2026-09-03) -- it was the reason
-- the Stripe library/webhook code was kept around for reconciliation; with it gone,
-- Stripe has zero live or historical data on this platform.

delete from public.service_purchases
 where id = '65cc4be3-8334-46e8-b899-a70526a21702'
   and currency = 'USD'
   and payment_provider = 'stripe';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.service_purchases where currency = 'USD' or payment_provider = 'stripe';
  if v_count <> 0 then
    raise exception 'FAIL: % USD/stripe service_purchases row(s) remain', v_count;
  end if;
end;
$$;
