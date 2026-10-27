-- S80 gap closure (25.6 finance): a daily settlement tie-out summary in three classes, posted to the finance queue.
--
-- Reconciled first, and this EXTENDS rather than duplicates. S14x (20261013223052) already stores Paystack's settlement report
-- (settlement_reports, settlement_lines), compares it with our ledger (reconcile_settlement_report, reconcile_unsettled_charges, using
-- private.ledger_charge_kobo) and opens breaks (reconciliation_breaks: missing_in_ledger, amount_mismatch, missing_at_provider, ...). Two
-- things were missing: (1) nothing counted the MATCHED lines, so a quiet day and a day nothing was fetched looked the same; (2) the break queue
-- is admin-only and no finance user and no daily item told anyone. This migration adds:
--   settlement_tieout_days        one row per settlement day: matched, missing in ledger, missing at Paystack (count and kobo), plus a
--                                 count of other breaks (amount mismatch and so on). Written only by private.settlement_tieout_run().
--   private.settlement_tieout_run(date)   recomputes the day, runs the S14x unsettled-charge check, and opens ONE ops incident (the finance
--                                 queue used by the money reconciliation alert) when any exception exists. It posts nothing to the ledger
--                                 and fixes nothing. Does nothing while the guard settlement_tieout_daily is off.
--   public.settlement_tieout_overview(days) / settlement_tieout_exceptions()   read-only for finance users (private.is_finance()).
--   cron job settlement-tieout-daily (06:10 UTC; harmless while the guard is off).
-- The three classes: matched = a settled line whose amount equals the ledger charge; missing_in_ledger = Paystack settled it and the ledger has
-- no such charge; missing_at_paystack = a paid, non-test charge of ours that no settlement lists after the S14x window. A settled line whose
-- amount differs from the ledger is NOT matched and is counted as "other" (it is neither missing nor matching).
-- What this does not do: it does not fetch from Paystack. The S14x edge function settlement-reconcile does, and its schedule and secret are
-- still a deploy step (see its handler header); until that runs there are no settlement lines and every day will show zero matched.
-- Counts when written (live, read only, 2026-10-27): finance_settlements 0 rows, payments 0 rows. Nothing is converted.
-- Platform-wide like the S14x tables (no organisation_id); the incident is filed under the oldest organisation, as the directory sweep does.

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('settlement_tieout_daily', 'Daily settlement tie-out', 'The daily job that counts matched and unmatched Paystack settlement lines and opens a finance incident when any are unmatched',
   'The settlement-reconcile edge function is scheduled with its secret and has fetched at least one real settlement; finance has agreed who owns the daily incident; admin confirmation', 'admin',
   array['private.settlement_tieout_run (daily job)'],
   'Reading the tie-out screen needs no guard. Nothing here posts to the ledger or moves money.');

create table public.settlement_tieout_days (
  settlement_date            date primary key,
  matched_count              integer not null check (matched_count >= 0),
  matched_kobo               bigint not null check (matched_kobo >= 0),
  missing_in_ledger_count    integer not null check (missing_in_ledger_count >= 0),
  missing_in_ledger_kobo     bigint not null check (missing_in_ledger_kobo >= 0),
  missing_at_paystack_count  integer not null check (missing_at_paystack_count >= 0),
  missing_at_paystack_kobo   bigint not null check (missing_at_paystack_kobo >= 0),
  other_break_count          integer not null check (other_break_count >= 0),
  incident_ref               text,
  computed_at                timestamptz not null default now()
);
alter table public.settlement_tieout_days enable row level security;
create policy settlement_tieout_days_finance_read on public.settlement_tieout_days for select to authenticated using (private.is_finance());
revoke all on public.settlement_tieout_days from anon, authenticated;
grant select on public.settlement_tieout_days to authenticated;
-- no write grant: private.settlement_tieout_run is the only writer

create function private.settlement_tieout_run(p_date date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_day     date := coalesce(p_date, (now() at time zone 'Africa/Lagos')::date - 1);
  v_org     uuid := (select id from public.organisations order by created_at limit 1);
  v_matched integer; v_matched_k bigint;
  v_mil integer; v_mil_k bigint;
  v_other integer;
  v_map integer; v_map_k bigint;
  v_ref text := 'settlement-tieout:' || v_day;
  v_exc integer;
begin
  if not private.go_live_guard_on('settlement_tieout_daily') then return null; end if;

  perform public.reconcile_unsettled_charges();

  select count(*) filter (where x.lg is not null and x.lg = l.amount_kobo), coalesce(sum(l.amount_kobo) filter (where x.lg is not null and x.lg = l.amount_kobo), 0),
         count(*) filter (where x.lg is null), coalesce(sum(l.amount_kobo) filter (where x.lg is null), 0),
         count(*) filter (where x.lg is not null and x.lg <> l.amount_kobo)
    into v_matched, v_matched_k, v_mil, v_mil_k, v_other
    from public.settlement_lines l
    join public.settlement_reports r on r.id = l.report_id
    cross join lateral (select private.ledger_charge_kobo(l.provider_reference) as lg) x
   where (r.settled_at at time zone 'Africa/Lagos')::date = v_day;

  select count(*), coalesce(sum(b.ledger_amount_kobo), 0) into v_map, v_map_k
    from public.reconciliation_breaks b where b.break_type = 'missing_at_provider' and b.status = 'open';

  v_other := v_other + (select count(*) from public.reconciliation_breaks b
                         join public.settlement_reports r on r.id = b.report_id
                        where b.status = 'open' and b.break_type in ('settlement_total_mismatch', 'reversal_unmatched')
                          and (r.settled_at at time zone 'Africa/Lagos')::date = v_day);

  v_exc := v_mil + v_map + v_other;

  insert into public.settlement_tieout_days (settlement_date, matched_count, matched_kobo, missing_in_ledger_count, missing_in_ledger_kobo,
                                             missing_at_paystack_count, missing_at_paystack_kobo, other_break_count, incident_ref, computed_at)
  values (v_day, v_matched, v_matched_k, v_mil, v_mil_k, v_map, v_map_k, v_other, case when v_exc > 0 then v_ref end, now())
  on conflict (settlement_date) do update set
    matched_count = excluded.matched_count, matched_kobo = excluded.matched_kobo,
    missing_in_ledger_count = excluded.missing_in_ledger_count, missing_in_ledger_kobo = excluded.missing_in_ledger_kobo,
    missing_at_paystack_count = excluded.missing_at_paystack_count, missing_at_paystack_kobo = excluded.missing_at_paystack_kobo,
    other_break_count = excluded.other_break_count, incident_ref = excluded.incident_ref, computed_at = now();

  if v_exc > 0 and v_org is not null then
    perform private.order_incident(v_org, v_ref, 'Paystack settlement does not tie out to the ledger for ' || v_day,
      v_matched || ' matched; ' || v_mil || ' settled by Paystack but missing in our ledger; ' || v_map || ' paid charges missing at Paystack; ' || v_other
      || ' other differences. Open Finance > Settlement tie-out (/finance/settlement-tieout). Nothing is fixed automatically; a person explains each break.');
  end if;
  return jsonb_build_object('date', v_day, 'matched', v_matched, 'missing_in_ledger', v_mil, 'missing_at_paystack', v_map, 'other', v_other);
end $$;
revoke all on function private.settlement_tieout_run(date) from public, anon, authenticated;

create function public.settlement_tieout_overview(p_days integer default 30)
returns table (
  settlement_date date, matched_count integer, matched_kobo bigint, missing_in_ledger_count integer, missing_in_ledger_kobo bigint,
  missing_at_paystack_count integer, missing_at_paystack_kobo bigint, other_break_count integer, computed_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_finance() then
    raise exception 'only a finance user can read the settlement tie-out' using errcode = '42501';
  end if;
  return query
    select d.settlement_date, d.matched_count, d.matched_kobo, d.missing_in_ledger_count, d.missing_in_ledger_kobo,
           d.missing_at_paystack_count, d.missing_at_paystack_kobo, d.other_break_count, d.computed_at
      from public.settlement_tieout_days d
     order by d.settlement_date desc
     limit least(greatest(coalesce(p_days, 30), 1), 120);
end $$;
revoke all on function public.settlement_tieout_overview(integer) from public, anon;
grant execute on function public.settlement_tieout_overview(integer) to authenticated;

-- open breaks for finance, read only; closing one stays an admin action (public.close_reconciliation_break)
create function public.settlement_tieout_exceptions()
returns table (break_id uuid, tieout_class text, provider_reference text, provider_amount_kobo bigint, ledger_amount_kobo bigint, difference_kobo bigint,
               detail text, first_seen_at timestamptz, age_hours integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_finance() then
    raise exception 'only a finance user can read the settlement tie-out' using errcode = '42501';
  end if;
  return query
    select b.id,
           case b.break_type when 'missing_in_ledger' then 'missing_in_ledger' when 'missing_at_provider' then 'missing_at_paystack' else 'other' end,
           b.provider_reference, b.provider_amount_kobo, b.ledger_amount_kobo, b.difference_kobo, b.detail, b.first_seen_at,
           (extract(epoch from (now() - b.first_seen_at)) / 3600)::integer
      from public.reconciliation_breaks b
     where b.status = 'open'
     order by b.first_seen_at, b.id
     limit 500;
end $$;
revoke all on function public.settlement_tieout_exceptions() from public, anon;
grant execute on function public.settlement_tieout_exceptions() to authenticated;

select cron.schedule('settlement-tieout-daily', '10 6 * * *', $c$select private.settlement_tieout_run()$c$);

-- registry entries (25.8): the job is listed with NO owner (nobody has been assigned; the owners screen flags it as unowned) and, in the
-- automation_jobs pause registry, as an ordinary (not safety-critical) pg_cron job.
insert into public.automations (name, kind, schedule, source_ref, expected_interval_minutes)
values ('cron:settlement-tieout-daily', 'pg_cron', '10 6 * * *', 'cron.job:settlement-tieout-daily', 1560) on conflict (name) do nothing;
insert into public.automation_jobs (job_name, schedule, source)
values ('settlement-tieout-daily', '10 6 * * *', 'pg_cron') on conflict (job_name) do nothing;

do $$
begin
  if has_function_privilege('anon', 'public.settlement_tieout_overview(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.settlement_tieout_exceptions()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.settlement_tieout_run(date)', 'EXECUTE')
     or has_function_privilege('anon', 'private.settlement_tieout_run(date)', 'EXECUTE') then
    raise exception 'settlement tie-out functions are executable by a role that must not run them';
  end if;
  if has_table_privilege('anon', 'public.settlement_tieout_days', 'SELECT') or has_table_privilege('authenticated', 'public.settlement_tieout_days', 'INSERT') then
    raise exception 'settlement_tieout_days has a grant it must not have';
  end if;
  if not exists (select 1 from public.go_live_guards where key = 'settlement_tieout_daily' and not is_on) then raise exception 'the settlement tie-out guard must exist and be off'; end if;
  if not exists (select 1 from cron.job where jobname = 'settlement-tieout-daily') then raise exception 'tie-out job not scheduled'; end if;
end $$;
