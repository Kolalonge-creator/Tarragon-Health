-- Money reconciliation: a cheap, honest count for the finance menu badge.
--
-- A badge polls (every 60 seconds per open tab), and the detector scans all history, so polling the detector would multiply the cost the
-- screen's own note warned about. Instead a job refreshes ONE row once an hour (the count of non-test mismatches, same detector, same
-- windows as the daily alert) and the badge reads that row. A date bound on the detector was rejected because it would hide old
-- mismatches; a plain cache was rejected because it can show an old "all clear". So the badge function REFUSES to answer when the row
-- is older than three hours or missing: the menu then shows its existing "could not load" dot instead of a number. The screen itself
-- stays live and exact. Nothing here writes money or stores a balance (INV-09); the single row is a count and a time.

create table public.money_reconciliation_snapshot (
  only_row boolean primary key default true check (only_row),
  mismatch_count bigint not null check (mismatch_count >= 0),
  computed_at timestamptz not null
);
alter table public.money_reconciliation_snapshot enable row level security;
revoke all on public.money_reconciliation_snapshot from anon, authenticated;

create function private.money_reconciliation_snapshot_refresh() returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_rules jsonb; v_n bigint;
begin
  select rules into v_rules from public.money_reconciliation_alert_config where is_active;
  if v_rules is null then
    raise exception 'money_reconciliation_snapshot_refresh: no active money_reconciliation_alert_config row';
  end if;
  select count(*) into v_n
    from private.money_mismatches(false, (v_rules ->> 'unsent_refund_minutes')::integer, (v_rules ->> 'grace_minutes')::integer);
  insert into public.money_reconciliation_snapshot (only_row, mismatch_count, computed_at) values (true, v_n, now())
  on conflict (only_row) do update set mismatch_count = excluded.mismatch_count, computed_at = excluded.computed_at;
  return v_n;
end $$;
revoke all on function private.money_reconciliation_snapshot_refresh() from public, anon, authenticated;

create function public.money_reconciliation_badge() returns bigint
language plpgsql stable security definer set search_path = ''
as $$
declare s public.money_reconciliation_snapshot%rowtype;
begin
  if (select auth.uid()) is null or not private.is_finance() then
    raise exception 'money_reconciliation_not_authorised' using errcode = '42501';
  end if;
  select * into s from public.money_reconciliation_snapshot;
  if not found then raise exception 'money_reconciliation_snapshot_missing' using errcode = 'P0001'; end if;
  if s.computed_at < now() - interval '3 hours' then raise exception 'money_reconciliation_snapshot_stale' using errcode = 'P0001'; end if;
  return s.mismatch_count;
end $$;
revoke all on function public.money_reconciliation_badge() from public, anon;
grant execute on function public.money_reconciliation_badge() to authenticated;

select private.money_reconciliation_snapshot_refresh();
select cron.schedule('money-reconciliation-snapshot', '10 * * * *', $$ select private.money_reconciliation_snapshot_refresh(); $$);

do $$
begin
  if has_function_privilege('anon', 'public.money_reconciliation_badge()', 'EXECUTE')
     or has_function_privilege('anon', 'private.money_reconciliation_snapshot_refresh()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.money_reconciliation_snapshot_refresh()', 'EXECUTE')
     or has_table_privilege('authenticated', 'public.money_reconciliation_snapshot', 'SELECT')
     or has_table_privilege('anon', 'public.money_reconciliation_snapshot', 'SELECT') then
    raise exception 'money reconciliation badge: wrong grants';
  end if;
  if not exists (select 1 from cron.job where jobname = 'money-reconciliation-snapshot') then
    raise exception 'money reconciliation badge: cron job missing';
  end if;
end $$;
