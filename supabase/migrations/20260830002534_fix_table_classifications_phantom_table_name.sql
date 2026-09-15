-- Tarragon Health
-- Bug fix, caught while building the DSAR export route (§87.8): the
-- table_classifications seed migration (20260829223239) included a row for
-- table_name='patient_receipts' -- confirmed live via information_schema
-- that no such table exists anywhere on the project. It was an invented
-- name, not a real one checked against the schema first -- exactly the
-- mistake the registry exists to prevent. The real financial-transaction
-- record is payment_transactions (linked via subscription_id, not a direct
-- patient_id column), so this corrects the row to point at what actually
-- exists rather than leaving a phantom entry in a data-inventory registry
-- whose entire point is accuracy.

update public.table_classifications
set table_name = 'payment_transactions',
    sharing_note = 'Shared with the payment processor (Paystack/Stripe) at transaction time only. Linked to a patient via subscription_id, not a direct patient_id column.'
where table_name = 'patient_receipts';

do $$
begin
  if exists (select 1 from public.table_classifications where table_name = 'patient_receipts') then
    raise exception 'table_classifications still references the phantom patient_receipts table';
  end if;
  if not exists (select 1 from public.table_classifications where table_name = 'payment_transactions') then
    raise exception 'table_classifications correction did not land -- payment_transactions row missing';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'payment_transactions') then
    raise exception 'payment_transactions itself does not exist -- correction points at another phantom table';
  end if;
  raise notice 'PASS: table_classifications no longer references a non-existent table';
end $$;
