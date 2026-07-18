-- Tarragon Health — Analytics Console: governance + investor + accounting tables.
--
-- All three are platform-level (no organisation_id) and, like the other
-- analytics surfaces, carry RLS ON with NO policies: the service role / the
-- analyst's SECURITY DEFINER RPCs are the only access paths. The analyst manages
-- the editable ones (finance inputs, risk register) through gated definer RPCs.

-- Admin/analyst-entered financials that the platform DB doesn't hold (ad spend,
-- opex, cash) — powers CAC / burn / runway / Rule-of-40. One row per month per
-- reporting currency. Mirrors the cohort_cost_model_constants pattern.
create table public.platform_finance_inputs (
  id                      uuid primary key default gen_random_uuid(),
  period_month            date not null,
  currency                public.currency not null default 'NGN',
  marketing_spend_minor   bigint not null default 0,
  operating_expense_minor bigint not null default 0,
  cash_balance_minor      bigint not null default 0,
  gross_margin_pct        numeric not null default 0,
  new_customers           integer,
  notes                   text,
  updated_at              timestamptz not null default now(),
  updated_by              uuid references public.profiles (id) on delete set null,
  unique (period_month, currency)
);
alter table public.platform_finance_inputs enable row level security;

-- Per-subscriber monthly MRR snapshots — the correct basis for NRR/GRR and the
-- MRR waterfall (the platform doesn't historise amount changes otherwise). A
-- monthly cron appends the current month; the block below backfills the last 12.
create table public.mrr_snapshots (
  id             uuid primary key default gen_random_uuid(),
  snapshot_month date not null,
  subscriber_id  uuid not null references public.profiles (id) on delete cascade,
  plan_code      text,
  currency       public.currency not null default 'NGN',
  mrr_minor      bigint not null default 0,
  created_at     timestamptz not null default now(),
  unique (snapshot_month, subscriber_id)
);
create index mrr_snapshots_month_idx on public.mrr_snapshots (snapshot_month);
alter table public.mrr_snapshots enable row level security;

-- Governance risk register (clinical / data-privacy / security / regulatory /
-- financial / operational). Analyst-managed via gated RPCs.
create table public.risk_register (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  category   text not null default 'operational',
  likelihood text not null default 'medium',
  impact     text not null default 'medium',
  status     text not null default 'open',
  owner      text,
  mitigation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint risk_register_likelihood_chk check (likelihood in ('low','medium','high')),
  constraint risk_register_impact_chk check (impact in ('low','medium','high')),
  constraint risk_register_status_chk check (status in ('open','mitigating','closed'))
);
alter table public.risk_register enable row level security;

-- Backfill MRR snapshots for the last 12 months (best-effort: uses each
-- subscription's current amount, since historical amounts aren't stored).
insert into public.mrr_snapshots (snapshot_month, subscriber_id, plan_code, currency, mrr_minor)
select gs::date, s.subscriber_id, pl.code, s.currency,
  (case when s.interval = 'yearly' then coalesce(s.amount_minor,0)/12 else coalesce(s.amount_minor,0) end)
from generate_series(
       date_trunc('month', now()) - interval '11 months',
       date_trunc('month', now()),
       interval '1 month') gs
join public.subscriptions s
  on s.started_at <= (gs + interval '1 month' - interval '1 second')
  and (s.cancelled_at is null or s.cancelled_at >= gs)
join public.subscription_plans pl on pl.id = s.plan_id
on conflict (snapshot_month, subscriber_id) do nothing;

-- Monthly cron: append the current month's snapshot on the 1st at 02:00.
select cron.schedule('mrr-snapshot-monthly', '0 2 1 * *', $cron$
  insert into public.mrr_snapshots (snapshot_month, subscriber_id, plan_code, currency, mrr_minor)
  select date_trunc('month', now())::date, s.subscriber_id, pl.code, s.currency,
    (case when s.interval = 'yearly' then coalesce(s.amount_minor,0)/12 else coalesce(s.amount_minor,0) end)
  from public.subscriptions s
  join public.subscription_plans pl on pl.id = s.plan_id
  where s.status in ('active','trialing')
  on conflict (snapshot_month, subscriber_id) do update
    set mrr_minor = excluded.mrr_minor, plan_code = excluded.plan_code, currency = excluded.currency;
$cron$);
