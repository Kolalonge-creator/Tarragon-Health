-- §91.16 VAT calculation engine.
--
-- finance_tax_rates already existed live (Finance Dashboard v2, PR #157)
-- with a real seeded 7.5% Nigerian VAT standard rate — this was config data
-- waiting for a calculation engine to read it, not a gap to fill from
-- scratch. What was missing: any function that actually computes/splits VAT.
--
-- Ships dark by design: finance_accounts.vat_treatment defaults 'exempt' for
-- every real account today, and this migration changes zero live behavior
-- until a founder/tax-adviser decision flips a specific account to
-- 'standard' AND a caller passes p_apply_vat=true. Both gates must be true
-- for any VAT to ever be calculated — classifying which Tarragon services
-- are genuinely VAT-standard-rated under Nigerian law is a tax/legal
-- decision, not an engineering one, so it is deliberately left as a founder
-- decision rather than guessed at here (same precedent as the ₦500k
-- approval threshold and per-vendor WHT rate placeholders elsewhere in this
-- finance console).
--
-- IMPORTANT: this replaces private.finance_post_journal by DROP + CREATE,
-- not CREATE OR REPLACE — Postgres treats an added parameter as a different
-- function signature, so CREATE OR REPLACE would have left TWO overloaded
-- functions (the original 7-arg and a new 8-arg) and every existing 7-arg
-- positional caller would have started failing with "function ... is not
-- unique". Verified: every existing caller (webhook trigger functions, the
-- reward/redeem voucher triggers, etc.) calls with <= 7 positional args and
-- continues to resolve to this single function unchanged.

create or replace function private.finance_compute_vat(p_account_code text, p_gross_amount_kobo bigint)
returns table (vat_amount_kobo bigint, net_amount_kobo bigint, treatment text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_treatment text;
  v_rate_pct numeric;
  v_vat bigint;
begin
  select vat_treatment into v_treatment from public.finance_accounts where code = p_account_code;
  v_treatment := coalesce(v_treatment, 'exempt');

  if v_treatment <> 'standard' or p_gross_amount_kobo <= 0 then
    return query select 0::bigint, p_gross_amount_kobo, v_treatment;
    return;
  end if;

  select rate_pct into v_rate_pct from public.finance_tax_rates
    where tax_type = 'vat' and applies_to = 'standard' and is_active = true
      and effective_from <= current_date
    order by effective_from desc limit 1;

  if v_rate_pct is null then
    -- No configured rate — never guess. Behaves as exempt until finance sets one.
    return query select 0::bigint, p_gross_amount_kobo, v_treatment;
    return;
  end if;

  -- The charged/displayed price is VAT-inclusive: vat = gross * rate/(100+rate).
  v_vat := round(p_gross_amount_kobo * v_rate_pct / (100.0 + v_rate_pct));
  return query select v_vat, p_gross_amount_kobo - v_vat, v_treatment;
end;
$$;
revoke all on function private.finance_compute_vat(text, bigint) from public;

drop function if exists private.finance_post_journal(date, public.currency, text, text, text, jsonb, uuid);

create function private.finance_post_journal(
  p_entry_date date,
  p_currency public.currency,
  p_source text,
  p_source_ref text,
  p_memo text,
  p_lines jsonb,
  p_created_by uuid default null,
  p_apply_vat boolean default false
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date := date_trunc('month', p_entry_date)::date;
  v_status text;
  v_existing uuid;
  v_entry uuid;
  v_debits bigint;
  v_credits bigint;
  v_count int;
  v_lines jsonb := p_lines;
  v_expanded jsonb;
  v_line jsonb;
  v_vat record;
  v_gross bigint;
  v_is_credit boolean;
begin
  -- Idempotency: a source event posts exactly once.
  if p_source_ref is not null then
    select id into v_existing from public.finance_journal_entries
      where source = p_source and source_ref = p_source_ref;
    if v_existing is not null then return v_existing; end if;
  end if;

  -- Period gate: auto-create an open period, refuse if closed/locked.
  insert into public.finance_periods (period_month) values (v_period)
    on conflict (period_month) do nothing;
  select status into v_status from public.finance_periods where period_month = v_period;
  if v_status <> 'open' then
    raise exception 'accounting period % is % — cannot post', v_period, v_status
      using errcode = 'check_violation';
  end if;

  -- Optional VAT expansion — a line whose account is genuinely VAT-standard
  -- gets split into a net-revenue line plus an Output VAT payable (2200)
  -- line on the same side (debit/credit) as the original, so the entry's
  -- total on that side, and therefore its balance, is unchanged.
  if p_apply_vat then
    v_expanded := '[]'::jsonb;
    for v_line in select * from jsonb_array_elements(v_lines) loop
      v_gross := greatest(coalesce((v_line->>'debit_minor')::bigint, 0), coalesce((v_line->>'credit_minor')::bigint, 0));
      v_is_credit := coalesce((v_line->>'credit_minor')::bigint, 0) > 0;
      select * into v_vat from private.finance_compute_vat(v_line->>'account_code', v_gross);
      if v_vat.vat_amount_kobo > 0 then
        v_expanded := v_expanded || jsonb_build_array(
          v_line || jsonb_build_object(
            case when v_is_credit then 'credit_minor' else 'debit_minor' end, v_vat.net_amount_kobo
          ),
          jsonb_build_object(
            'account_code', '2200',
            'debit_minor', case when v_is_credit then 0 else v_vat.vat_amount_kobo end,
            'credit_minor', case when v_is_credit then v_vat.vat_amount_kobo else 0 end,
            'organisation_id', v_line->>'organisation_id',
            'memo', 'Output VAT'
          )
        );
      else
        v_expanded := v_expanded || jsonb_build_array(v_line);
      end if;
    end loop;
    v_lines := v_expanded;
  end if;

  -- Validate the balanced set of lines.
  select coalesce(sum((l->>'debit_minor')::bigint),0),
         coalesce(sum((l->>'credit_minor')::bigint),0),
         count(*)
    into v_debits, v_credits, v_count
  from jsonb_array_elements(v_lines) l;

  if v_count < 2 then
    raise exception 'a journal entry needs at least two lines' using errcode = 'check_violation';
  end if;
  if v_debits <> v_credits then
    raise exception 'unbalanced journal: debits % <> credits %', v_debits, v_credits
      using errcode = 'check_violation';
  end if;
  if v_debits = 0 then
    raise exception 'a journal entry cannot be zero-value' using errcode = 'check_violation';
  end if;

  insert into public.finance_journal_entries
    (entry_date, period_month, currency, source, source_ref, memo, created_by)
  values (p_entry_date, v_period, p_currency, p_source, p_source_ref, p_memo,
          coalesce(p_created_by, (select auth.uid())))
  returning id into v_entry;

  insert into public.finance_journal_lines
    (entry_id, line_no, account_code, debit_minor, credit_minor, currency, organisation_id, counterparty, memo, cost_center_code)
  select v_entry, row_number() over (),
         l->>'account_code',
         coalesce((l->>'debit_minor')::bigint,0),
         coalesce((l->>'credit_minor')::bigint,0),
         p_currency,
         nullif(l->>'organisation_id','')::uuid,
         l->>'counterparty',
         l->>'memo',
         nullif(l->>'cost_center_code','')
  from jsonb_array_elements(v_lines) l;

  return v_entry;
end; $$;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'finance_post_journal'
  ) then
    raise exception 'finance_post_journal is missing after migration';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'finance_post_journal') <> 1 then
    raise exception 'finance_post_journal has more than one overload — the old signature was not dropped cleanly';
  end if;
end $$;
