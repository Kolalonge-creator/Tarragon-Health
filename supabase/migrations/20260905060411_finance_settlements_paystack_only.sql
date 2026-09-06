-- Tarragon Health — stop the finance console posting settlements for a
-- payment rail that does not exist.
--
-- public.finance_import_settlement() casts whatever `p_provider` text it is
-- given straight to public.payment_provider, which still carries the value
-- 'stripe' from the retired diaspora billing model. The finance console
-- offered "stripe" in its provider dropdown and auto-selected GL account 1010
-- ("Bank — Stripe (diaspora) settlement") for it, so a finance user could
-- import and then post a settlement into a bank account for a rail Tarragon
-- has never had (no Stripe account was ever registered; the integration was
-- deleted from the codebase 2026-09-03). Paystack (NGN) is the only live
-- provider.
--
-- The UI dropdown is removed in the same change, but the RPC is the real
-- boundary: it is SECURITY DEFINER and callable directly by anyone holding
-- finance.reconcile, so the allow-list belongs here.
--
-- Live evidence (koiplnmbgnqnbywhpjlf):
--   public.finance_settlements       0 rows        -- nothing to correct
--   finance_journal_lines @ '1010'   0 rows        -- account never posted to
--   public.payment_transactions      3 rows, all provider='stripe', all with
--                                    a non-null `error` (failed test webhooks)
--
-- The 'stripe' enum VALUE is deliberately left in place: payment_transactions
-- still holds those three historical rows, and dropping an enum value out from
-- under real data would be a worse trade than gating the write path.

create or replace function public.finance_import_settlement(
  p_provider text,
  p_external_ref text,
  p_settlement_date date,
  p_currency text,
  p_gross bigint,
  p_fees bigint,
  p_net bigint,
  p_bank_account text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if not private.finance_can('finance.reconcile') then raise exception 'not authorised'; end if;

  -- Paystack (NGN) is the only live payment rail. A settlement for anything
  -- else cannot correspond to money that moved, so refuse it rather than let
  -- it reach the ledger.
  if coalesce(p_provider, '') <> 'paystack' then
    raise exception 'Settlements can only be imported for Paystack. % is not a live payment provider.', coalesce(nullif(p_provider,''), '(none)');
  end if;

  insert into public.finance_settlements
    (provider, external_ref, settlement_date, currency, gross_minor, fees_minor, net_minor,
     bank_account_code, notes, imported_by)
  values (p_provider::public.payment_provider, nullif(p_external_ref,''), p_settlement_date,
          coalesce(p_currency,'NGN')::public.currency, coalesce(p_gross,0), coalesce(p_fees,0),
          coalesce(p_net,0), coalesce(p_bank_account,'1000'), nullif(p_notes,''), (select auth.uid()))
  returning id into v_id;
  perform private.log_audit('finance.settlement.import', 'finance_settlements', v_id,
    jsonb_build_object('provider', p_provider, 'gross_minor', p_gross, 'fees_minor', p_fees, 'net_minor', p_net));
  return v_id;
end;
$$;

comment on function public.finance_import_settlement(text, text, date, text, bigint, bigint, bigint, text, text) is
  'Imports a Paystack payout batch. Refuses any other provider: Paystack (NGN) is the only live rail since Stripe was removed 2026-09-03.';

-- The Stripe settlement bank account has never been posted to and now cannot
-- be. Deactivated rather than deleted so the chart of accounts keeps its
-- history and the code is not silently reused for something else.
update public.finance_accounts
   set is_active = false,
       description = coalesce(nullif(description, ''), '')
         || case when coalesce(description,'') = '' then '' else ' ' end
         || 'Retired 2026-09-05: Stripe was never a live rail for Tarragon and the integration was removed 2026-09-03.'
 where code = '1010' and is_active;

-- ---------------------------------------------------------------------------
-- Prove it.
--
-- The behavioural half is limited by design: finance_import_settlement checks
-- private.finance_can('finance.reconcile') before anything else, and the
-- migration role does not hold it, so a call from here raises on the
-- authorisation gate and cannot by itself prove the provider gate. The
-- provider gate was proven separately against the live project in a rolled-
-- back transaction with finance_can stubbed to true: 'stripe' raised
-- "not a live payment provider", 'paystack' inserted one row, and removing the
-- guard made the 'stripe' case insert too (a deliberate sabotage run, so the
-- test is known to discriminate). What is asserted here is that the guard is
-- present in the shipped definition, that a call still refuses, and that
-- nothing was written.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_raised boolean;
  v_before bigint;
  v_after bigint;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'finance_import_settlement'
  limit 1;
  if v_def is null then
    raise exception 'finance_import_settlement is missing';
  end if;
  if v_def !~ 'is not a live payment provider' then
    raise exception 'finance_import_settlement has no provider allow-list';
  end if;

  select count(*) into v_before from public.finance_settlements;
  begin
    perform public.finance_import_settlement('stripe', 'assert', current_date, 'USD', 100, 0, 100, '1010', '');
    v_raised := false;
  exception when others then
    v_raised := true;
  end;
  select count(*) into v_after from public.finance_settlements;

  if not v_raised then
    raise exception 'a stripe settlement import did not raise';
  end if;
  if v_after <> v_before then
    raise exception 'a stripe settlement import wrote % row(s)', v_after - v_before;
  end if;

  if exists (select 1 from public.finance_accounts where code = '1010' and is_active) then
    raise exception 'the Stripe settlement bank account is still active';
  end if;
end;
$$;
