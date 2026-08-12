-- Tarragon Health — Finance: a calendar-year variant of the statutory
-- compliance calendar, for the printable Government Filings pack
-- (finance/reports/print/[pack]?pack=government-filings&year=YYYY).
--
-- public.finance_compliance_calendar(p_months_ahead) is deliberately relative
-- to today (last month through N months ahead) — right for the day-to-day
-- Compliance calendar tab, wrong for "show me every 2025 filing": if today is
-- in 2026, that window never reaches back to January 2025. This function is
-- the same computation windowed by an explicit calendar year instead, so a
-- past or future financial year prints completely. Same obligation-types
-- catalogue, same status logic, same jsonb shape (complianceCalendarSchema on
-- the frontend parses either one).

create or replace function public.finance_compliance_calendar_for_year(p_year integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := current_date;
  v_result jsonb := '[]'::jsonb;
  ot record;
  v_month_start date;
  v_due date;
  v_period_label text;
  v_filing record;
  v_status text;
  v_month int;
begin
  if not private.is_finance() then return '[]'::jsonb; end if;

  for ot in select * from public.finance_compliance_obligation_types where is_active loop
    if ot.frequency = 'monthly' then
      for v_month in 1..12 loop
        v_month_start := make_date(p_year, v_month, 1);
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
      end loop;
    elsif ot.frequency = 'annual' then
      v_period_label := p_year::text;
      v_due := (make_date(p_year + 1, 1, 1) + make_interval(months => coalesce(ot.due_months_after_period_end, 6)) - interval '1 day')::date;
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

  return v_result;
end; $$;

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
