-- Tarragon Health — fix: finance_journal_entries.source's CHECK constraint
-- never included 'lab_refund' or 'pharmacy_refund'.
--
-- Found while live-testing the pharmacy refund engine
-- (20260829010156_pharmacy_billing_reconcile_settle_refund.sql): calling
-- approve_pharmacy_order_refund() in a rolled-back transaction failed with
-- a real constraint violation — private.finance_post_journal() was passed
-- p_source = 'pharmacy_refund', which finance_journal_entries_source_check
-- does not allow (('payment','commission','refund','wallet','voucher',
-- 'revenue_recognition','fx','manual','adjustment','opening') only).
--
-- The same test against approve_lab_order_refund() (2026-08-21,
-- 20260821192256_partner_billing_reconcile_settle_refund.sql), which posts
-- p_source = 'lab_refund', hits the identical violation — that function has
-- been live for over a week and would fail the same way the first time
-- anyone actually approved a real lab refund. There is no evidence it was
-- ever exercised for real: finance_journal_entries.source held only
-- 'voucher' rows before this session's own testing. Not this session's
-- migration to have introduced, but the fix is one constraint this
-- migration already needs to touch for pharmacy, so it is fixed for both
-- here rather than left broken for whoever hits it next.
alter table public.finance_journal_entries
  drop constraint finance_journal_entries_source_check;
alter table public.finance_journal_entries
  add constraint finance_journal_entries_source_check check (
    source = any (array[
      'payment', 'commission', 'refund', 'wallet', 'voucher',
      'revenue_recognition', 'fx', 'manual', 'adjustment', 'opening',
      'lab_refund', 'pharmacy_refund'
    ])
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.finance_journal_entries'::regclass
      and conname = 'finance_journal_entries_source_check'
      and pg_get_constraintdef(oid) like '%lab_refund%'
      and pg_get_constraintdef(oid) like '%pharmacy_refund%'
  ) then
    raise exception 'FAIL: finance_journal_entries_source_check was not widened';
  end if;
  raise notice 'PASS: finance_journal_entries.source now accepts lab_refund and pharmacy_refund';
end $$;
