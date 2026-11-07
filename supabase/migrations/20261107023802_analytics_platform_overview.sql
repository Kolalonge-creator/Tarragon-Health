-- Superadmin console homepage (docs/design/SUPERADMIN-CONSOLE.md, phase 2b): one read that gives the dashboard a chosen
-- period and the equal-length period before it, plus a live snapshot.
--
-- Read-only (STABLE), SECURITY DEFINER, analyst/admin only. A refused caller gets SQLSTATE 42501, never an empty
-- object, so the page can never draw a refused read as zeros. Test data is left out the same way every analytics_*
-- reader does it (analytics_clean views), and explicitly on the two tables read directly (patient_memberships.is_test,
-- payment_transactions.is_test).
--
-- Definitions, shown on the page beside each figure:
--   registrations           patient profiles created in the window.
--   memberships_started     patient_memberships whose starts_at falls in the window and has arrived (a queued year that
--                           starts later is not counted until it starts), split by source.
--   memberships_ended       ended or lapsed memberships whose end (ended_at, else ends_at) falls in the window.
--   collected_kobo          Paystack-confirmed money, from the two places a confirmed charge is recorded (they never overlap):
--                           catalogue orders, the current checkout including Membership: public.payments with status
--                           'success', by verified_at, total_kobo (what the payer was charged); every other flow:
--                           payment_transactions 'charge.success', no error, currency NGN (a row with no currency is left
--                           out, never assumed to be naira). The Paystack webhook returns from its order branch before
--                           writing payment_transactions (supabase/functions/paystack-webhook/handler.ts), which is why the
--                           order charges must be read from payments. Cash confirmed by the provider: not recognised
--                           revenue and not orders placed.
--   refunded_kobo           payment_transactions 'refund.processed', NGN, no error. Every Paystack refund lands here, order
--                           refunds included (the webhook writes them; the legacy refund jobs write the same idempotency
--                           key), so it is the complete, de-duplicated refund record. Net = collected - refunded.
--   failed_payments         payment_transactions 'charge.failed'/'invoice.payment_failed', plus catalogue orders that moved
--                           to 'failed' in the window (attempts, not people).
--   notifications_sent      notifications sent in the window (any channel); notifications_failed: failed_at in the window.
-- Snapshot (now): active memberships by source (state active, started, not past ends_at), registered patients, patients
-- with no active membership (Free), memberships ending in the next 30 days.
--
-- No row is written, nothing is switched on, no existing function is changed. ROLLBACK: drop function
-- public.analytics_platform_overview(timestamptz, timestamptz).

create or replace function public.analytics_platform_overview(p_from timestamptz, p_to timestamptz)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_prev_from timestamptz;
begin
  if not private.is_analyst() then
    raise exception 'analytics_platform_overview_not_authorised' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from >= p_to or p_to - p_from > interval '400 days' then
    raise exception 'analytics_platform_overview_bad_range' using errcode = '22023';
  end if;
  v_prev_from := p_from - (p_to - p_from);

  return jsonb_build_object(
    'window', jsonb_build_object('from', p_from, 'to', p_to, 'previous_from', v_prev_from, 'previous_to', p_from),
    'current', private.platform_overview_window(p_from, p_to),
    'previous', private.platform_overview_window(v_prev_from, p_from),
    'snapshot', (
      with active as (
        select m.source
          from public.patient_memberships m
          join analytics_clean.real_patient_ids rp on rp.patient_id = m.patient_id
         where not m.is_test and m.state = 'active' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
      ), patients as (
        select count(*) n from analytics_clean.profiles where role = 'patient'
      )
      select jsonb_build_object(
        'computed_at', now(),
        'registered_patients', (select n from patients),
        'active_memberships', (select count(*) from active),
        'active_by_source', (select coalesce(jsonb_object_agg(source, n), '{}'::jsonb) from (select source, count(*) n from active group by source) s),
        'free_patients', (
          select count(*) from analytics_clean.profiles p
           where p.role = 'patient'
             and not exists (
               select 1 from public.patient_memberships m
                where m.patient_id = p.id and not m.is_test and m.state = 'active' and m.starts_at <= now()
                  and (m.ends_at is null or m.ends_at > now()))
        ),
        'ending_next_30d', (
          select count(*) from public.patient_memberships m
            join analytics_clean.real_patient_ids rp on rp.patient_id = m.patient_id
           where not m.is_test and m.state = 'active' and m.ends_at > now() and m.ends_at <= now() + interval '30 days'
        )
      )
    )
  );
end;
$function$;

-- The per-window counts, kept private so the window rule (from inclusive, to exclusive) lives in one place.
create or replace function private.platform_overview_window(p_from timestamptz, p_to timestamptz)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  with started as (
    select m.source
      from public.patient_memberships m
      join analytics_clean.real_patient_ids rp on rp.patient_id = m.patient_id
     where not m.is_test and m.starts_at >= p_from and m.starts_at < p_to and m.starts_at <= now() and m.state <> 'scheduled'
  ), money as (
    select t.event_type::text event_type, coalesce(t.amount_minor, 0)::bigint amount
      from analytics_clean.payment_transactions t
     where not t.is_test and t.error is null and t.created_at >= p_from and t.created_at < p_to
       and t.currency = 'NGN'
  ), order_paid as (
    select p.total_kobo::bigint amount
      from public.payments p
     where not p.is_test and p.status = 'success' and p.verified_at >= p_from and p.verified_at < p_to
  )
  select jsonb_build_object(
    'registrations', (select count(*) from analytics_clean.profiles where role = 'patient' and created_at >= p_from and created_at < p_to),
    'memberships_started', (select count(*) from started),
    'started_by_source', (select coalesce(jsonb_object_agg(source, n), '{}'::jsonb) from (select source, count(*) n from started group by source) s),
    'memberships_ended', (
      select count(*) from public.patient_memberships m
        join analytics_clean.real_patient_ids rp on rp.patient_id = m.patient_id
       where not m.is_test and m.state in ('ended', 'lapsed')
         and coalesce(m.ended_at, m.ends_at) >= p_from and coalesce(m.ended_at, m.ends_at) < p_to
    ),
    'collected_kobo', (select coalesce(sum(amount), 0) from money where event_type = 'charge.success')
                      + (select coalesce(sum(amount), 0) from order_paid),
    'collected_count', (select count(*) from money where event_type = 'charge.success') + (select count(*) from order_paid),
    'refunded_kobo', (select coalesce(sum(amount), 0) from money where event_type = 'refund.processed'),
    'refunded_count', (select count(*) from money where event_type = 'refund.processed'),
    'failed_payments', (
      select count(*) from analytics_clean.payment_transactions t
       where not t.is_test and t.event_type::text in ('charge.failed', 'invoice.payment_failed')
         and t.created_at >= p_from and t.created_at < p_to
    ) + (
      select count(*) from public.orders o
       where not o.is_test and o.state = 'failed' and o.updated_at >= p_from and o.updated_at < p_to
    ),
    'notifications_sent', (select count(*) from analytics_clean.notifications where sent_at >= p_from and sent_at < p_to),
    'notifications_failed', (select count(*) from analytics_clean.notifications where status = 'failed' and failed_at >= p_from and failed_at < p_to)
  );
$function$;

-- anon inherits EXECUTE through PUBLIC, so revoke from public (CLAUDE.md: the anon-execute gotcha).
revoke all on function public.analytics_platform_overview(timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_platform_overview(timestamptz, timestamptz) to authenticated, service_role;
revoke all on function private.platform_overview_window(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function private.platform_overview_window(timestamptz, timestamptz) to service_role;

-- Closing self-check: anon cannot reach either function, an authenticated session cannot call the private window
-- directly (it skips the analyst gate), and both are read-only.
do $$
begin
  if has_function_privilege('anon', 'public.analytics_platform_overview(timestamptz, timestamptz)', 'EXECUTE') then
    raise exception 'analytics_platform_overview: anon can execute';
  end if;
  if has_function_privilege('authenticated', 'private.platform_overview_window(timestamptz, timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'private.platform_overview_window(timestamptz, timestamptz)', 'EXECUTE') then
    raise exception 'platform_overview_window: callable without the analyst gate';
  end if;
  if exists (select 1 from pg_proc where oid in ('public.analytics_platform_overview(timestamptz, timestamptz)'::regprocedure,
        'private.platform_overview_window(timestamptz, timestamptz)'::regprocedure) and provolatile <> 's') then
    raise exception 'analytics_platform_overview: a function is not STABLE';
  end if;
end $$;
