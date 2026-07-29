-- Tarragon Health — Finance: tax configuration (Nigeria VAT + WHT).
--
-- Rates are DATA, editable by finance (never hard-coded) — seeded with the
-- current statutory Nigerian rates as a starting point the founder/tax adviser
-- confirms. VAT treatment per revenue account lives on finance_accounts
-- (default 'exempt': most medical/health services are VAT-exempt under the VAT
-- Act). Output VAT (2200), input VAT (1300) and WHT (2300) are real GL accounts,
-- so the tax period summary reads authoritative balances straight from the ledger.

create table public.finance_tax_rates (
  id             uuid primary key default gen_random_uuid(),
  jurisdiction   text not null default 'NG',
  tax_type       text not null check (tax_type in ('vat','wht')),
  name           text not null,
  rate_pct       numeric not null check (rate_pct >= 0),
  applies_to     text,                 -- wht: 'commission'/'professional_services'/'rent'; vat: 'standard'
  effective_from date not null default current_date,
  is_active      boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.finance_tax_rates enable row level security;

create trigger finance_tax_rates_set_updated_at
  before update on public.finance_tax_rates
  for each row execute function private.set_updated_at();

-- Statutory NG starting rates (2026) — finance confirms/adjusts before filing.
insert into public.finance_tax_rates (jurisdiction, tax_type, name, rate_pct, applies_to, effective_from, notes) values
  ('NG','vat','VAT (standard rate)', 7.5, 'standard', date '2020-02-01', 'Nigerian VAT standard rate. Most health/medical services are exempt — applied only to accounts marked standard-rated.'),
  ('NG','wht','WHT — commission (company)', 5, 'commission', date '2015-01-01', 'Withholding tax on commissions/fees paid to a company.'),
  ('NG','wht','WHT — commission (individual)', 10, 'commission', date '2015-01-01', 'Withholding tax on commissions/fees paid to an individual.'),
  ('NG','wht','WHT — professional services (company)', 10, 'professional_services', date '2015-01-01', 'Withholding tax on professional/consultancy services (company).')
on conflict do nothing;

create or replace function public.finance_upsert_tax_rate(
  p_id uuid, p_jurisdiction text, p_tax_type text, p_name text, p_rate_pct numeric,
  p_applies_to text, p_effective_from date, p_is_active boolean, p_notes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.finance_can('finance.tax.manage') then raise exception 'not authorised'; end if;
  if p_id is null then
    insert into public.finance_tax_rates (jurisdiction, tax_type, name, rate_pct, applies_to, effective_from, is_active, notes)
    values (coalesce(p_jurisdiction,'NG'), p_tax_type, p_name, p_rate_pct, p_applies_to,
            coalesce(p_effective_from, current_date), coalesce(p_is_active,true), p_notes)
    returning id into v_id;
  else
    update public.finance_tax_rates set
      jurisdiction=coalesce(p_jurisdiction,'NG'), tax_type=p_tax_type, name=p_name, rate_pct=p_rate_pct,
      applies_to=p_applies_to, effective_from=coalesce(p_effective_from,current_date),
      is_active=coalesce(p_is_active,true), notes=p_notes, updated_at=now()
    where id=p_id returning id into v_id;
  end if;
  return v_id;
end; $$;
