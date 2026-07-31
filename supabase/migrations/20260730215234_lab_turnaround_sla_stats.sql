-- Tarragon Health — lab partner turnaround-time tracking + SLA scorecard.
--
-- Gap: the platform holds ITSELF to a 4-hour doctor-contact SLA on abnormal
-- results, but tracks no turnaround-time metric at all for the labs that
-- actually run the tests — if a lab is slow, nothing on the platform sees
-- it. Fixes that with (1) a real payment_confirmed_at timestamp so
-- "time from paid to resulted" is measurable per order, (2) an admin-facing
-- scorecard across every lab provider, and (3) a self-facing scorecard so a
-- lab partner can see (and be accountable for) their own numbers, matching
-- the platform's own "reviewed_by/reviewed_at" transparency discipline
-- turned outward onto a partner relationship instead of a clinician.

alter table public.lab_orders
  add column if not exists payment_confirmed_at timestamptz;

comment on column public.lab_orders.payment_confirmed_at is
  'Stamped once, the first time status enters payment_confirmed. Never overwritten again. Basis for lab turnaround-time (resulted_at - payment_confirmed_at).';

-- Stamp on both insert (a self-bookable order can be created already-paid)
-- and update (the normal pending_payment -> payment_confirmed path).
create or replace function private.stamp_lab_order_payment_confirmed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'payment_confirmed' and new.payment_confirmed_at is null then
    new.payment_confirmed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists lab_orders_stamp_payment_confirmed on public.lab_orders;
create trigger lab_orders_stamp_payment_confirmed
  before insert or update on public.lab_orders
  for each row execute function private.stamp_lab_order_payment_confirmed();

-- Best-effort backfill for existing paid orders from the commission that was
-- already booked at the payment_confirmed moment (commissions.earned_at
-- defaults to now() at insert time, and the commission trigger fires on
-- exactly that transition — see 20260715115451). Orders with no matching
-- commission row (shouldn't exist for a genuinely paid order, but this is a
-- backfill, not an invariant) simply stay null rather than guessing.
update public.lab_orders lo
set payment_confirmed_at = c.earned_at
from public.commissions c
where c.commission_type = 'lab'
  and c.source_id = lo.id
  and lo.payment_confirmed_at is null
  and lo.status not in ('pending_payment');

create index if not exists lab_orders_provider_turnaround_idx
  on public.lab_orders (provider_id, payment_confirmed_at)
  where payment_confirmed_at is not null;

-- Small-cell suppression floor for the admin-facing multi-provider view —
-- mirrors organisations.min_cohort_size's purpose (don't let a tiny sample
-- read as a real performance verdict on a partner), applied here since this
-- is now data one partner's numbers could be compared against another's.
-- A partner's OWN self-view (lab_partner_turnaround_stats) is not
-- suppressed — seeing your own small sample is not a privacy/fairness risk.
create or replace function public.lab_provider_turnaround_stats(p_days int default 90)
returns table (
  provider_id uuid,
  provider_name text,
  orders_resulted bigint,
  avg_turnaround_hours numeric,
  median_turnaround_hours numeric,
  pct_over_72h numeric,
  suppressed boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.is_admin() or private.has_permission('partners.labs.manage')) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return query
  with resulted as (
    select
      lo.provider_id,
      extract(epoch from (lo.resulted_at - lo.payment_confirmed_at)) / 3600.0 as hours
    from public.lab_orders lo
    where lo.status = 'resulted'
      and lo.payment_confirmed_at is not null
      and lo.resulted_at is not null
      and lo.resulted_at >= now() - make_interval(days => p_days)
  )
  select
    p.id,
    p.name,
    count(r.hours),
    round(avg(r.hours)::numeric, 1),
    round((percentile_cont(0.5) within group (order by r.hours))::numeric, 1),
    round((100.0 * count(*) filter (where r.hours > 72) / nullif(count(r.hours), 0))::numeric, 1),
    count(r.hours) < 5
  from public.lab_providers p
  left join resulted r on r.provider_id = p.id
  group by p.id, p.name
  order by p.name;
end;
$$;

-- A lab partner's own scorecard — same shape, one row, not suppressed.
create or replace function public.lab_partner_turnaround_stats(p_days int default 90)
returns table (
  orders_resulted bigint,
  avg_turnaround_hours numeric,
  median_turnaround_hours numeric,
  pct_over_72h numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*),
    round(avg(extract(epoch from (lo.resulted_at - lo.payment_confirmed_at)) / 3600.0)::numeric, 1),
    round((percentile_cont(0.5) within group (
      order by extract(epoch from (lo.resulted_at - lo.payment_confirmed_at)) / 3600.0
    ))::numeric, 1),
    round((100.0 * count(*) filter (
      where extract(epoch from (lo.resulted_at - lo.payment_confirmed_at)) / 3600.0 > 72
    ) / nullif(count(*), 0))::numeric, 1)
  from public.lab_orders lo
  where private.lab_partner_provider() is not null
    and lo.provider_id = private.lab_partner_provider()
    and lo.status = 'resulted'
    and lo.payment_confirmed_at is not null
    and lo.resulted_at is not null
    and lo.resulted_at >= now() - make_interval(days => p_days);
$$;

grant execute on function public.lab_provider_turnaround_stats(int) to authenticated;
grant execute on function public.lab_partner_turnaround_stats(int) to authenticated;

-- The real fix for the anon-execute gotcha this codebase got wrong four
-- times before (see feedback_supabase_anon_execute_gotcha / the migrations
-- it cites): anon inherits EXECUTE via the PUBLIC pseudo-grant, so
-- `revoke ... from anon` alone is a no-op. Revoke from PUBLIC.
revoke execute on function public.lab_provider_turnaround_stats(int) from public;
revoke execute on function public.lab_partner_turnaround_stats(int) from public;

do $$
begin
  if has_function_privilege('anon', 'public.lab_provider_turnaround_stats(int)', 'EXECUTE') then
    raise exception 'anon can still execute lab_provider_turnaround_stats';
  end if;
  if has_function_privilege('anon', 'public.lab_partner_turnaround_stats(int)', 'EXECUTE') then
    raise exception 'anon can still execute lab_partner_turnaround_stats';
  end if;
  if not has_function_privilege('authenticated', 'public.lab_provider_turnaround_stats(int)', 'EXECUTE') then
    raise exception 'authenticated should be able to execute lab_provider_turnaround_stats';
  end if;
end $$;
