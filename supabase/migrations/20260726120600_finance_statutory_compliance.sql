-- Tarragon Health — Finance: Nigeria statutory compliance calendar.
--
-- A due-date tracker for the recurring filings a Nigerian employer/company
-- actually owes — VAT, WHT, PAYE, Pension (PRA 2014), NHF and annual CIT —
-- computed on read from a small editable cadence catalogue, not materialised.
-- "Mark as filed" records a real remittance reference + who/when, audit-
-- logged. Cadences are the standard statutory day-of-month figures as a
-- starting point; finance/the founder should confirm exact figures with a
-- tax adviser before relying on this for actual filing deadlines — this is a
-- tracker, not a filing engine, and never files anything with FIRS/PENCOM
-- itself (no such public API exists to integrate with).

insert into public.permissions (key, label, category, description) values
  ('finance.compliance.manage', 'Manage statutory compliance', 'Finance', 'Mark statutory filings as filed/remitted and adjust the compliance calendar catalogue.')
on conflict (key) do nothing;

create table public.finance_compliance_obligation_types (
  code                         text primary key,
  name                         text not null,
  agency                       text not null,
  frequency                    text not null check (frequency in ('monthly','annual')),
  due_day_of_month             integer,
  due_months_after_period_end integer,
  description                  text,
  is_active                    boolean not null default true
);
alter table public.finance_compliance_obligation_types enable row level security;

insert into public.finance_compliance_obligation_types (code, name, agency, frequency, due_day_of_month, description) values
  ('vat_monthly', 'VAT return & remittance', 'FIRS', 'monthly', 21,
    'Monthly VAT return — due 21st of the month following the tax period, filed via FIRS TaxPro-Max.'),
  ('wht_monthly', 'Withholding tax (WHT) remittance', 'FIRS', 'monthly', 21,
    'WHT deducted from partner/vendor/commission payments — due 21st of the following month.'),
  ('paye_monthly', 'PAYE remittance', 'State IRS', 'monthly', 10,
    'Employee income tax withheld from clinical/non-clinical staff pay — due 10th of the following month, to the relevant State IRS.'),
  ('pension_monthly', 'Pension contributions (PRA 2014)', 'PENCOM', 'monthly', 7,
    'Employer (min. 10%) + employee (min. 8%) pension remittance for employed staff — statutorily due within 7 WORKING days of the following month; day 7 is used here as an approximation, confirm the exact working-day count with payroll.'),
  ('nhf_monthly', 'National Housing Fund (NHF)', 'FMBN', 'monthly', 10,
    '2.5% of employee basic salary — due 10th of the following month, typically remitted alongside PAYE.')
on conflict (code) do nothing;

insert into public.finance_compliance_obligation_types (code, name, agency, frequency, due_months_after_period_end, description) values
  ('cit_annual', 'Companies Income Tax (CIT) return', 'FIRS', 'annual', 6,
    'Annual company income tax return — due 6 months after financial year end (calendar-year FY assumed).'),
  ('tet_annual', 'Tertiary Education Tax / Student Loan levy', 'FIRS', 'annual', 6,
    'Filed alongside the CIT return, same due date.')
on conflict (code) do nothing;

create table public.finance_filings (
  id                    uuid primary key default gen_random_uuid(),
  obligation_code       text not null references public.finance_compliance_obligation_types (code),
  period_label          text not null,
  due_date              date not null,
  filed_at              timestamptz,
  filed_by              uuid references public.profiles (id) on delete set null,
  remittance_reference  text,
  amount_minor          bigint,
  currency              public.currency not null default 'NGN',
  notes                 text,
  created_at            timestamptz not null default now(),
  unique (obligation_code, period_label)
);
alter table public.finance_filings enable row level security;

create or replace function public.finance_mark_filed(
  p_obligation_code text, p_period_label text, p_due_date date,
  p_remittance_reference text, p_amount_minor bigint, p_currency text, p_notes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.finance_can('finance.compliance.manage') then raise exception 'not authorised'; end if;
  insert into public.finance_filings
    (obligation_code, period_label, due_date, filed_at, filed_by, remittance_reference, amount_minor, currency, notes)
  values (p_obligation_code, p_period_label, p_due_date, now(), (select auth.uid()),
          nullif(p_remittance_reference,''), p_amount_minor, coalesce(p_currency,'NGN')::public.currency, p_notes)
  on conflict (obligation_code, period_label) do update set
    due_date = excluded.due_date, filed_at = now(), filed_by = (select auth.uid()),
    remittance_reference = excluded.remittance_reference, amount_minor = excluded.amount_minor,
    currency = excluded.currency, notes = excluded.notes
  returning id into v_id;
  perform private.log_audit('finance.compliance.mark_filed', 'finance_filings', v_id,
    jsonb_build_object('obligation_code', p_obligation_code, 'period_label', p_period_label,
      'remittance_reference', p_remittance_reference));
  return v_id;
end; $$;

create or replace function public.finance_unmark_filed(p_obligation_code text, p_period_label text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.finance_can('finance.compliance.manage') then raise exception 'not authorised'; end if;
  update public.finance_filings set filed_at = null, filed_by = null
    where obligation_code = p_obligation_code and period_label = p_period_label;
  perform private.log_audit('finance.compliance.unmark_filed', 'finance_filings', null,
    jsonb_build_object('obligation_code', p_obligation_code, 'period_label', p_period_label));
end; $$;

-- Computes due-date instances for each active obligation type across a
-- window (last month through p_months_ahead months from today), joined
-- against any recorded filing for that period.
create or replace function public.finance_compliance_calendar(p_months_ahead integer default 3)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := current_date;
  v_result jsonb := '[]'::jsonb;
  ot record;
  v_month_start date;
  v_end_month date;
  v_due date;
  v_period_label text;
  v_filing record;
  v_status text;
  v_year int;
begin
  if not private.is_finance() then return '[]'::jsonb; end if;

  v_end_month := (date_trunc('month', v_today)::date + make_interval(months => greatest(p_months_ahead,0)))::date;

  for ot in select * from public.finance_compliance_obligation_types where is_active loop
    if ot.frequency = 'monthly' then
      v_month_start := (date_trunc('month', v_today)::date - interval '1 month')::date;
      while v_month_start <= v_end_month loop
        v_period_label := to_char(v_month_start, 'YYYY-MM');
        v_due := (v_month_start + interval '1 month')::date + (coalesce(ot.due_day_of_month, 21) - 1);
        select * into v_filing from public.finance_filings
          where obligation_code = ot.code and period_label = v_period_label;
        v_status := case
          when v_filing.filed_at is not null then 'filed'
          when v_due < v_today then 'overdue'
          when v_due <= v_today + 7 then 'due_soon'
          else 'upcoming' end;
        v_result := v_result || jsonb_build_array(jsonb_build_object(
          'obligation_code', ot.code, 'obligation_name', ot.name, 'agency', ot.agency, 'frequency', ot.frequency,
          'period_label', v_period_label, 'due_date', v_due, 'status', v_status,
          'filed_at', v_filing.filed_at, 'remittance_reference', v_filing.remittance_reference,
          'amount_minor', v_filing.amount_minor, 'description', ot.description));
        v_month_start := (v_month_start + interval '1 month')::date;
      end loop;
    elsif ot.frequency = 'annual' then
      for v_year in extract(year from v_today)::int - 1 .. extract(year from v_today)::int + 1 loop
        v_period_label := v_year::text;
        v_due := (make_date(v_year + 1, 1, 1) + make_interval(months => coalesce(ot.due_months_after_period_end, 6)) - interval '1 day')::date;
        if v_due between (v_today - 60) and (v_end_month + 60) then
          select * into v_filing from public.finance_filings where obligation_code = ot.code and period_label = v_period_label;
          v_status := case
            when v_filing.filed_at is not null then 'filed'
            when v_due < v_today then 'overdue'
            when v_due <= v_today + 7 then 'due_soon'
            else 'upcoming' end;
          v_result := v_result || jsonb_build_array(jsonb_build_object(
            'obligation_code', ot.code, 'obligation_name', ot.name, 'agency', ot.agency, 'frequency', ot.frequency,
            'period_label', v_period_label, 'due_date', v_due, 'status', v_status,
            'filed_at', v_filing.filed_at, 'remittance_reference', v_filing.remittance_reference,
            'amount_minor', v_filing.amount_minor, 'description', ot.description));
        end if;
      end loop;
    end if;
  end loop;

  return v_result;
end; $$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text sig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'finance\_%'
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
