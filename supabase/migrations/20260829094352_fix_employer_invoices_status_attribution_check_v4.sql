-- Fixes a real bug in part 6/6 (20260829094237), caught by a live smoke test.
--
-- employer_invoices_status_attribution was written as a biconditional,
-- `(status = 'issued') = (issued_at is not null)`. That's wrong: it demanded
-- issued_at become NULL again the moment status moved on to 'paid', which
-- public.employer_set_invoice_status() never does (paid correctly keeps the
-- issued_at it already has) — so the very first issued -> paid transition in
-- the smoke test tripped the CHECK it was meant to be validated by. The
-- actual invariant is one-directional: an invoice that is (or has been)
-- issued must carry an issued_at; 'paid' and 'void' are free to have kept
-- theirs from an earlier 'issued' state, or never had one if paid was set
-- directly from draft.

alter table public.employer_invoices drop constraint employer_invoices_status_attribution;

alter table public.employer_invoices
  add constraint employer_invoices_status_attribution
    check (status <> 'issued' or issued_at is not null);

-- Behavioural proof against a real organisation row (any will do — this
-- table has no per-row uniqueness on organisation_id alone), inserted and
-- deleted within this same migration transaction.
do $$
declare
  v_org uuid;
begin
  select id into v_org from public.organisations limit 1;

  begin
    insert into public.employer_invoices
      (organisation_id, period_start, period_end, billing_model, amount_kobo, status, issued_at)
    values (v_org, '1900-01-01', '1900-01-01', 'fixed_contract', 0, 'paid', now());
  exception when check_violation then
    raise exception 'FAIL: paid-with-issued_at-set was rejected: %', sqlerrm;
  end;
  delete from public.employer_invoices where period_start = '1900-01-01';

  begin
    insert into public.employer_invoices
      (organisation_id, period_start, period_end, billing_model, amount_kobo, status, issued_at)
    values (v_org, '1900-01-01', '1900-01-01', 'fixed_contract', 0, 'issued', null);
    raise exception 'FAIL: issued with no issued_at was accepted';
  exception when check_violation then
    null; -- expected
  end;
  delete from public.employer_invoices where period_start = '1900-01-01';

  raise notice 'PASS  employer_invoices_status_attribution: issued requires issued_at, paid may keep it';
end $$;
