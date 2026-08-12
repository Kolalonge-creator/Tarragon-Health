-- Tarragon Health — Finance: company legal/registration profile, plus three
-- Nigeria statutory obligation types the compliance calendar was missing
-- (CAC annual return, NSITF, ITF). Both feed the new print-ready Reports &
-- Filings pack (apps/web/src/app/(dashboard)/finance/reports) — a letterhead
-- needs a real legal name/RC number/TIN to print against, and "everything the
-- company owes a government agency yearly" was incomplete without CAC/NSITF/
-- ITF alongside the VAT/WHT/PAYE/pension/NHF/CIT/TET rows already seeded in
-- 20260726120600_finance_statutory_compliance.sql.
--
-- This is reference data for humans to print and act on, not a filing engine
-- — same discipline as the compliance calendar it sits beside: it never
-- files anything with CAC/FIRS/NSITF/ITF itself.

-- ---------------------------------------------------------------------------
-- Company profile: one row, editable only by a true super admin (this is
-- legal/company-secretarial data — RC number, TIN, directors — not something
-- to delegate via the finance.* permission bundle). Finance (and admin) can
-- read it, same gate as the rest of the finance console, since every printed
-- report needs it for its letterhead.
-- ---------------------------------------------------------------------------
create table public.finance_company_profile (
  singleton                    boolean primary key default true check (singleton),
  legal_name                   text,
  trading_name                 text,
  rc_number                    text,
  tin                          text,
  vat_registration_number      text,
  nsitf_number                 text,
  itf_number                   text,
  pension_pfa_code             text,
  registered_address           text,
  principal_business_activity  text,
  incorporation_date           date,
  financial_year_end           text not null default '31 December',
  registered_email             text,
  registered_phone             text,
  directors_text               text,
  company_secretary_name       text,
  auditor_name                 text,
  bank_name                    text,
  bank_account_name            text,
  bank_account_number          text,
  updated_at                   timestamptz not null default now(),
  updated_by                   uuid references public.profiles (id) on delete set null
);
alter table public.finance_company_profile enable row level security;

insert into public.finance_company_profile (singleton) values (true)
on conflict (singleton) do nothing;

create or replace function public.finance_company_profile_get()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_finance() then coalesce((
    select to_jsonb(p) - 'singleton' from public.finance_company_profile p limit 1
  ), '{}'::jsonb) else '{}'::jsonb end;
$$;

create or replace function public.finance_company_profile_upsert(
  p_legal_name text, p_trading_name text, p_rc_number text, p_tin text,
  p_vat_registration_number text, p_nsitf_number text, p_itf_number text,
  p_pension_pfa_code text, p_registered_address text, p_principal_business_activity text,
  p_incorporation_date date, p_financial_year_end text, p_registered_email text,
  p_registered_phone text, p_directors_text text, p_company_secretary_name text,
  p_auditor_name text, p_bank_name text, p_bank_account_name text, p_bank_account_number text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'not authorised'; end if;

  update public.finance_company_profile set
    legal_name = nullif(p_legal_name, ''),
    trading_name = nullif(p_trading_name, ''),
    rc_number = nullif(p_rc_number, ''),
    tin = nullif(p_tin, ''),
    vat_registration_number = nullif(p_vat_registration_number, ''),
    nsitf_number = nullif(p_nsitf_number, ''),
    itf_number = nullif(p_itf_number, ''),
    pension_pfa_code = nullif(p_pension_pfa_code, ''),
    registered_address = nullif(p_registered_address, ''),
    principal_business_activity = nullif(p_principal_business_activity, ''),
    incorporation_date = p_incorporation_date,
    financial_year_end = coalesce(nullif(p_financial_year_end, ''), '31 December'),
    registered_email = nullif(p_registered_email, ''),
    registered_phone = nullif(p_registered_phone, ''),
    directors_text = nullif(p_directors_text, ''),
    company_secretary_name = nullif(p_company_secretary_name, ''),
    auditor_name = nullif(p_auditor_name, ''),
    bank_name = nullif(p_bank_name, ''),
    bank_account_name = nullif(p_bank_account_name, ''),
    bank_account_number = nullif(p_bank_account_number, ''),
    updated_at = now(),
    updated_by = (select auth.uid())
  where singleton;

  perform private.log_audit('finance.company_profile.upsert', 'finance_company_profile', null,
    jsonb_build_object('legal_name', p_legal_name, 'rc_number', p_rc_number, 'tin', p_tin));
end; $$;

-- ---------------------------------------------------------------------------
-- Three missing statutory obligation types. The compliance calendar RPC
-- (public.finance_compliance_calendar) computes due dates generically from
-- this catalogue, so adding rows here is the entire change — no function
-- code to touch, and finance_compliance_suggested_amount() already falls
-- back to manual entry for any code it doesn't specifically compute (same
-- as the existing cit_annual/tet_annual rows).
-- ---------------------------------------------------------------------------
insert into public.finance_compliance_obligation_types (code, name, agency, frequency, due_months_after_period_end, description) values
  ('cac_annual_return', 'CAC Annual Return', 'CAC', 'annual', 6,
    'Corporate Affairs Commission annual return (company particulars, not a tax return) — due 30 June for a calendar-year company under CAMA 2020, or 42 days after the AGM if later. Confirm the exact date and any late-filing penalty with your company secretary/adviser.')
on conflict (code) do nothing;

insert into public.finance_compliance_obligation_types (code, name, agency, frequency, due_day_of_month, description) values
  ('nsitf_monthly', 'NSITF Employees'' Compensation contribution', 'NSITF', 'monthly', 28,
    '1% of total monthly payroll under the Employees'' Compensation Act 2010. No single statutory day-of-month is fixed in the Act; day 28 is used here as a working approximation, confirm the expected cadence with NSITF/your payroll adviser. Zero while the platform employs no payroll staff.')
on conflict (code) do nothing;

insert into public.finance_compliance_obligation_types (code, name, agency, frequency, due_months_after_period_end, description) values
  ('itf_annual', 'ITF training contribution', 'ITF', 'annual', 3,
    '1% of annual payroll under the Industrial Training Fund Act, for employers with 5+ employees or NGN 50m+ turnover — due 1 April following the year, approximated here as 3 months after a 31 December year end. Zero while the platform employs no payroll staff or is below the threshold.')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Grant sweep — same belt-and-braces pattern every finance_* migration ends
-- with (see 20260726120700_finance_kpis_audit_log_and_grants.sql): PUBLIC/anon
-- carry no execute on any finance_* function, only authenticated does, and
-- the actual authorisation gate is private.is_finance()/private.is_admin()
-- inside each function body.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'finance\_%'
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
