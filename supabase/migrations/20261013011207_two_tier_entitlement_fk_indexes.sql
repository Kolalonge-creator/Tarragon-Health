-- Integration fix (two-tier + SR2c): the pricing migration added two foreign keys to public.entitlements (seat_price_id,
-- invoice_id) with no covering index, and the SR2c proof (sr2c_hot_table_indexes_and_initplan.sql) correctly refuses a hot table
-- carrying an uncovered foreign key. Each branch passed alone; only the merge breaks. Partial indexes: both columns are null for
-- every non-seat entitlement.
-- Rows in public.entitlements live before this change (read-only, 2026-10-12): 0, so a plain CREATE INDEX in the migration
-- transaction locks nothing that matters. ROLLBACK: drop index public.entitlements_seat_price_idx, public.entitlements_invoice_idx.
create index if not exists entitlements_seat_price_idx on public.entitlements (seat_price_id) where seat_price_id is not null;
create index if not exists entitlements_invoice_idx on public.entitlements (invoice_id) where invoice_id is not null;

do $$
begin
  if exists (
    select 1 from pg_constraint c
    where c.contype = 'f' and c.conrelid = 'public.entitlements'::regclass
      and c.conname in ('entitlements_seat_price_id_fkey', 'entitlements_invoice_id_fkey')
      and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indisvalid
                      and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey)
  ) then
    raise exception 'two-tier: an entitlements foreign key is still without a covering index';
  end if;
end $$;
