-- OQ-431: nothing scheduled the two S72 expiry functions, so a pledge or grant past its date, and an idle payment link, kept their stored status for ever
-- (reads already treat them as lapsed or expired, but the stored status is what reports and the fund overview count).
-- Checked against the live project 2026-10-23: the S74 jobs (partner-quality-sweep, partner-settlement-run) and the S71 order expiry (order-expire-stale,
-- which cancels stale orders and so releases their sponsor reservations through the orders trigger) ARE scheduled. Only these two were missing.
--
-- pg_cron runs with no signed-in session, so public.expire_access_fund() and public.expire_payment_requests() (admin or service role only) would refuse it.
-- The work moves into private functions with no caller check; the public functions keep their check and call them, so their behaviour for an admin or the
-- service role is unchanged. Nothing here switches on any guarded feature: expiring dead rows is safe with every module off.

create function private.expire_access_fund_core() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_pl integer; v_gr integer; g record;
begin
  update public.donations set state = 'lapsed' where state = 'pledged' and pledge_expires_at <= now();
  get diagnostics v_pl = row_count;
  v_gr := 0;
  for g in select * from public.access_fund_grants where status = 'approved' and expires_at <= now()
           and not exists (select 1 from public.sponsor_reservations r where r.programme_id = access_fund_grants.programme_id and r.state = 'reserved') for update loop
    update public.access_fund_grants set status = 'expired' where id = g.id;
    update public.sponsor_programmes set status = 'closed' where id = g.programme_id;
    v_gr := v_gr + 1;
  end loop;
  return jsonb_build_object('pledges_lapsed', v_pl, 'grants_expired', v_gr);
end $$;
revoke all on function private.expire_access_fund_core() from public, anon, authenticated;

create function private.expire_payment_requests_core() returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  update public.payment_requests set status = 'expired' where status = 'open' and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.expire_payment_requests_core() from public, anon, authenticated;

-- The public functions: same check, same result, now delegating (CREATE OR REPLACE keeps their grants).
create or replace function public.expire_access_fund() returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not (private.is_admin() or coalesce((select auth.role()), '') = 'service_role') then raise exception 'access_fund_not_authorised' using errcode = '42501'; end if;
  return private.expire_access_fund_core();
end $$;

create or replace function public.expire_payment_requests() returns integer
language plpgsql security definer set search_path = ''
as $$
begin
  if not (private.is_admin() or coalesce((select auth.role()), '') = 'service_role') then raise exception 'request_not_authorised' using errcode = '42501'; end if;
  return private.expire_payment_requests_core();
end $$;

-- Hourly, off the other jobs' minutes. Idempotent: an existing job of the same name is replaced.
do $$
begin
  perform cron.unschedule(jobname) from cron.job where jobname in ('expire-access-fund', 'expire-payment-requests');
  perform cron.schedule('expire-access-fund', '27 * * * *', $c$select private.expire_access_fund_core()$c$);
  perform cron.schedule('expire-payment-requests', '33 * * * *', $c$select private.expire_payment_requests_core()$c$);
  if (select count(*) from cron.job where jobname in ('expire-access-fund', 'expire-payment-requests')) <> 2 then raise exception 'S72 expiry jobs were not scheduled'; end if;
  if has_function_privilege('anon', 'private.expire_access_fund_core()', 'EXECUTE') or has_function_privilege('authenticated', 'private.expire_payment_requests_core()', 'EXECUTE') then
    raise exception 'the expiry cores must not be callable by a signed-in role';
  end if;
  if has_function_privilege('anon', 'public.expire_access_fund()', 'EXECUTE') or has_function_privilege('anon', 'public.expire_payment_requests()', 'EXECUTE') then
    raise exception 'anon can run an expiry function';
  end if;
end $$;
