alter table public.lab_orders
  add column if not exists payment_confirmed_at timestamptz;

comment on column public.lab_orders.payment_confirmed_at is
  'Stamped once, the first time status enters payment_confirmed. Never overwritten again. Basis for lab turnaround-time (resulted_at - payment_confirmed_at).';

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
