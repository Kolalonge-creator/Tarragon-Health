-- Tarragon Health — Finance: revenue recognition (ASC 606 / IFRS 15 straight-line).
--
-- A subscription/add-on payment is CASH received now but revenue earned over the
-- billing period. At payment time the money lands in Deferred revenue (2000);
-- this module recognises it into revenue straight-line, one GL entry per elapsed
-- month, fully idempotent (a month recognises exactly once no matter how often
-- the recogniser runs). One-off bookings are recognised at point of sale (no
-- schedule) — handled directly by the payment posting.

create table public.revenue_recognition_schedules (
  id                     uuid primary key default gen_random_uuid(),
  source_kind            text not null check (source_kind in ('subscription','add_on')),
  source_id              uuid,
  payment_transaction_id uuid references public.payment_transactions (id) on delete set null,
  organisation_id        uuid references public.organisations (id) on delete set null,
  revenue_account_code   text not null references public.finance_accounts (code),
  deferred_account_code  text not null default '2000' references public.finance_accounts (code),
  currency               public.currency not null default 'NGN',
  total_minor            bigint not null,
  recognized_minor       bigint not null default 0,
  period_start           date not null,
  period_end             date not null,
  status                 text not null default 'active' check (status in ('active','completed','cancelled')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint revrec_period_valid check (period_end > period_start)
);
alter table public.revenue_recognition_schedules enable row level security;

create unique index revrec_payment_txn_uniq
  on public.revenue_recognition_schedules (payment_transaction_id)
  where payment_transaction_id is not null;
create index revrec_status_idx on public.revenue_recognition_schedules (status);

create trigger revrec_set_updated_at
  before update on public.revenue_recognition_schedules
  for each row execute function private.set_updated_at();

-- Create a schedule at payment time (idempotent per payment_transaction_id).
create or replace function private.finance_create_recognition_schedule(
  p_source_kind text, p_source_id uuid, p_payment_txn uuid, p_org uuid,
  p_revenue_account text, p_currency public.currency, p_total bigint,
  p_period_start date, p_period_end date
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_payment_txn is not null then
    select id into v_id from public.revenue_recognition_schedules where payment_transaction_id = p_payment_txn;
    if v_id is not null then return v_id; end if;
  end if;
  if p_total is null or p_total <= 0 or p_period_end <= p_period_start then return null; end if;
  insert into public.revenue_recognition_schedules
    (source_kind, source_id, payment_transaction_id, organisation_id, revenue_account_code,
     currency, total_minor, period_start, period_end)
  values (p_source_kind, p_source_id, p_payment_txn, p_org, p_revenue_account,
          p_currency, p_total, p_period_start, p_period_end)
  returning id into v_id;
  return v_id;
end; $$;

-- Recognise revenue straight-line up to p_as_of. For each active schedule, post
-- one GL entry per not-yet-recognised elapsed month; the final month carries the
-- rounding remainder so total recognised equals total_minor exactly.
create or replace function private.finance_recognize_revenue(p_as_of date default current_date)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s record;
  m date;
  v_last_month date;
  v_month_start date;
  v_month_end date;
  v_total_days numeric;
  v_amount bigint;
  v_entry_date date;
  v_posted int := 0;
  v_is_final boolean;
  v_source_ref text;
begin
  for s in
    select * from public.revenue_recognition_schedules
    where status = 'active' and recognized_minor < total_minor
  loop
    v_total_days := (s.period_end - s.period_start);
    -- last month we may recognise this run = month of min(as_of, period_end)
    v_last_month := date_trunc('month', least(p_as_of, s.period_end))::date;
    m := date_trunc('month', s.period_start)::date;
    while m <= v_last_month loop
      v_source_ref := 'revrec:' || s.id::text || ':' || to_char(m, 'YYYY-MM');
      -- skip months already recognised (idempotent)
      if not exists (
        select 1 from public.finance_journal_entries
        where source = 'revenue_recognition' and source_ref = v_source_ref
      ) then
        v_month_start := greatest(s.period_start, m);
        v_month_end   := least(s.period_end, (m + interval '1 month')::date);
        v_is_final    := (m = date_trunc('month', s.period_end)::date);
        if v_is_final then
          -- remainder so rounding never drifts the total
          v_amount := s.total_minor - s.recognized_minor;
        else
          v_amount := round(s.total_minor * (v_month_end - v_month_start) / v_total_days);
        end if;
        if v_amount > 0 then
          v_entry_date := least(p_as_of, (v_month_end - 1));
          perform private.finance_post_journal(
            v_entry_date, s.currency, 'revenue_recognition', v_source_ref,
            'Revenue recognition ' || to_char(m,'Mon YYYY') || ' — ' ||
              (select name from public.finance_accounts where code = s.revenue_account_code),
            jsonb_build_array(
              jsonb_build_object('account_code', s.deferred_account_code, 'debit_minor', v_amount, 'credit_minor', 0,
                                 'organisation_id', s.organisation_id),
              jsonb_build_object('account_code', s.revenue_account_code, 'debit_minor', 0, 'credit_minor', v_amount,
                                 'organisation_id', s.organisation_id)
            ),
            null);
          update public.revenue_recognition_schedules
            set recognized_minor = recognized_minor + v_amount
            where id = s.id;
          s.recognized_minor := s.recognized_minor + v_amount;
          v_posted := v_posted + 1;
        end if;
      end if;
      m := (m + interval '1 month')::date;
    end loop;
    -- mark complete once fully recognised
    update public.revenue_recognition_schedules
      set status = 'completed'
      where id = s.id and recognized_minor >= total_minor;
  end loop;
  return v_posted;
end; $$;

-- Monthly recogniser (1st at 03:00). Recognises everything elapsed to date.
select cron.schedule('finance-revenue-recognition-monthly', '0 3 1 * *', $cron$
  select private.finance_recognize_revenue(current_date);
$cron$);
