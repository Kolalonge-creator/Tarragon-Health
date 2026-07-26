-- Fix: omit zero-value settlement lines (a zero net or zero fees line would
-- violate finance_journal_lines_one_side). gross = net + fees is guaranteed > 0,
-- so at least one debit line survives and the entry still balances.
create or replace function public.finance_post_settlement(p_settlement_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  st public.finance_settlements%rowtype;
  v_entry uuid;
  v_lines jsonb := '[]'::jsonb;
begin
  if not private.finance_can('finance.reconcile') then raise exception 'not authorised'; end if;
  select * into st from public.finance_settlements where id = p_settlement_id;
  if st.id is null then raise exception 'settlement not found'; end if;
  if st.status = 'reconciled' then return st.journal_entry_id; end if;
  if st.gross_minor <> st.net_minor + st.fees_minor then
    raise exception 'settlement does not balance: gross % <> net % + fees % (variance %)',
      st.gross_minor, st.net_minor, st.fees_minor, st.gross_minor - (st.net_minor + st.fees_minor)
      using errcode = 'check_violation';
  end if;
  if st.gross_minor <= 0 then
    raise exception 'settlement gross must be positive' using errcode = 'check_violation';
  end if;

  if st.net_minor > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', st.bank_account_code,
      'debit_minor', st.net_minor, 'credit_minor', 0, 'counterparty', st.provider::text);
  end if;
  if st.fees_minor > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '5000',
      'debit_minor', st.fees_minor, 'credit_minor', 0, 'counterparty', st.provider::text);
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', '1020',
    'debit_minor', 0, 'credit_minor', st.gross_minor, 'counterparty', st.provider::text);

  v_entry := private.finance_post_journal(
    st.settlement_date, st.currency, 'payment', 'settlement:' || st.id::text,
    'Settlement ' || st.provider::text || coalesce(' ' || st.external_ref, ''),
    v_lines, (select auth.uid()));

  update public.finance_settlements
    set status = 'reconciled', journal_entry_id = v_entry
    where id = st.id;
  return v_entry;
end; $$;
