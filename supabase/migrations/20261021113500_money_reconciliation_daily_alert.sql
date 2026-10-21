-- Money reconciliation: a daily alert, and the hand-posting instruction on the two "settled by hand" refund messages.
--
-- (1) Alert. The money reconciliation screen (20261021110417) lists where the money records disagree, but nobody is told when it is not
-- empty. Once a day this counts the NON-TEST mismatches and, per organisation that has any, opens ONE ops incident through
-- private.order_incident (the same helper the refund and payment paths use): it opens a new incident only when none is open for that
-- reference, and otherwise just refreshes the open one's summary. It never fixes, posts, reverses or retries anything and stores no
-- balance (INV-09). It does not close an incident either: a person closes it after looking. A mismatch with no organisation is grouped
-- under the reference 'none' rather than dropped. The two windows are not constants in SQL: they are read from the active row of
-- money_reconciliation_alert_config, which mirrors the PROPOSED config key finance.reconciliation (a Jest test fails if they drift).
-- A failed scan raises, so cron.job_run_details shows it; a failed incident write for one organisation is logged to audit_log.
--
-- (2) Wording. The screen clears "completed refund with no cash entry" when finance posts the entry with the source_ref
-- refund:<refund id>. The two incident messages that tell a person to post that entry by hand (admin_settle_processing_refund and
-- service_refund_incident) did not say so. Both are replaced, with every other line copied unchanged from the live definition
-- (checked with pg_get_functiondef on 2026-10-21 before writing this).
--
-- Live row counts when written (2026-10-21): orders 0, payments 0, refunds 0, payouts 0, so the first run is expected to open nothing.

create table public.money_reconciliation_alert_config (
  version integer primary key,
  is_active boolean not null,
  effective_from date not null,
  rules jsonb not null
);
create unique index money_reconciliation_alert_config_one_active on public.money_reconciliation_alert_config (is_active) where is_active;
alter table public.money_reconciliation_alert_config enable row level security;
revoke all on public.money_reconciliation_alert_config from anon, authenticated;

-- money-reconciliation-alert-begin
insert into public.money_reconciliation_alert_config (version, is_active, effective_from, rules) values (1, true, '2026-10-21', $json$
{ "unsent_refund_minutes": 1440, "grace_minutes": 15 }
$json$::jsonb);
-- money-reconciliation-alert-end

create function private.money_reconciliation_daily_check() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_rules jsonb;
  v_n integer := 0;
begin
  select rules into v_rules from public.money_reconciliation_alert_config where is_active;
  if v_rules is null then
    raise exception 'money_reconciliation_daily_check: no active money_reconciliation_alert_config row';
  end if;

  for r in
    select x.org, sum(x.n)::integer as total, min(x.oldest) as oldest,
           string_agg(x.kind || ' (' || x.n || ')', ', ' order by x.n desc, x.kind) as kinds
      from (select m.organisation_id as org, m.kind, count(*) as n, min(m.since) as oldest
              from private.money_mismatches(false, (v_rules ->> 'unsent_refund_minutes')::integer, (v_rules ->> 'grace_minutes')::integer) m
             group by m.organisation_id, m.kind) x
     group by x.org
  loop
    begin
      perform private.order_incident(r.org, 'money-reconciliation-daily:' || coalesce(r.org::text, 'none'),
        'Money records disagree: ' || r.total || ' open on the reconciliation screen',
        r.total || ' place(s) where the money records disagree, the oldest since ' || to_char(r.oldest at time zone 'Africa/Lagos', 'YYYY-MM-DD')
          || ': ' || left(r.kinds, 600) || '. Open Finance > Money reconciliation (/finance/money-reconciliation). Nothing is fixed automatically; '
          || 'close this incident once each item has been checked.');
      v_n := v_n + 1;
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (r.org, 'money_reconciliation.sweep_error', 'organisation', r.org, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  return v_n;
end $$;
revoke all on function private.money_reconciliation_daily_check() from public, anon, authenticated;

select cron.schedule('money-reconciliation-daily-check', '30 7 * * *', $$ select private.money_reconciliation_daily_check(); $$);

-- (2a) The admin "mark as sent" settle. Identical to the live definition except the final incident text.
create or replace function public.admin_settle_processing_refund(p_refund uuid, p_paid boolean, p_reference text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.refunds%rowtype;
  v_stuck integer := (private.entitlement_policy('refund_rules') ->> 'stuck_processing_hours')::integer;
  v jsonb;
begin
  if not private.is_admin() then raise exception 'refund_not_authorised' using errcode = '42501'; end if;
  select * into r from public.refunds where id = p_refund for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.state <> 'processing' then return jsonb_build_object('result', 'not_processing', 'state', r.state); end if;
  if r.processing_started_at > now() - make_interval(hours => v_stuck) then return jsonb_build_object('result', 'too_soon'); end if;
  v := private.apply_refund_provider_result(p_refund, p_paid, case when p_paid then coalesce(nullif(btrim(p_reference), ''), 'settled-by-hand') end,
         jsonb_build_object('settled_by_admin', true, 'error_code', 'settled_not_sent'));
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (r.organisation_id, (select auth.uid()), 'refund.settled_by_hand', 'refund', r.id, jsonb_build_object('paid', p_paid));
  if p_paid then
    perform private.order_incident(r.organisation_id, 'refund-cash-post:' || r.id, 'A refund was settled by hand: post its cash entry',
      'Refund ' || r.id || ' was marked sent by an admin. The automatic cash posting did not run: post Dr 4900 / Cr 1020 for ' || r.amount_kobo
      || ' kobo with the reference refund:' || r.id || '. The Money reconciliation screen clears this refund only when the entry carries that reference.');
  end if;
  return v;
end $$;
revoke all on function public.admin_settle_processing_refund(uuid, boolean, text) from public, anon;
grant execute on function public.admin_settle_processing_refund(uuid, boolean, text) to authenticated;

-- (2b) The edge function's incident writer. Identical to the live definition except the last branch's text.
create or replace function public.service_refund_incident(p_refund uuid, p_what text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.refunds%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'not_authorised' using errcode = '42501'; end if;
  select * into r from public.refunds where id = p_refund;
  if not found then return; end if;
  if p_what = 'record_failed' then
    perform private.order_incident(r.organisation_id, 'refund-record:' || r.id, 'A refund was sent to Paystack but not recorded',
      'Refund ' || r.id || ' was accepted by Paystack but the result could not be written here. It stays "processing". Check the Paystack dashboard, then settle it from the admin refunds screen.');
  elsif p_what = 'ambiguous_provider_outcome' then
    perform private.order_incident(r.organisation_id, 'refund-ambiguous:' || r.id, 'A refund may or may not have reached Paystack',
      'Refund ' || r.id || ' got no clear answer from Paystack (a timeout, a network failure or an already-reversed reply). It stays "processing" and is NOT retried. Check the Paystack dashboard, then settle it from the admin refunds screen.');
  else
    perform private.order_incident(r.organisation_id, 'refund-cash-post:' || r.id, 'A paid refund has no cash posting',
      'Refund ' || r.id || ' was sent to Paystack and recorded, but the cash posting failed (' || left(coalesce(p_what, 'unknown'), 200)
      || '). Post Dr 4900 / Cr 1020 by hand with the reference refund:' || r.id || ' (the Money reconciliation screen clears this refund only when the entry carries that reference), or re-run the refund.processed posting.');
  end if;
end $$;
revoke all on function public.service_refund_incident(uuid, text) from public, anon, authenticated;
grant execute on function public.service_refund_incident(uuid, text) to service_role;

do $$
begin
  if has_function_privilege('anon', 'private.money_reconciliation_daily_check()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.money_reconciliation_daily_check()', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_settle_processing_refund(uuid,boolean,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.service_refund_incident(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.service_refund_incident(uuid,text)', 'EXECUTE') then
    raise exception 'money reconciliation alert: wrong execute grants';
  end if;
  if has_table_privilege('authenticated', 'public.money_reconciliation_alert_config', 'SELECT')
     or has_table_privilege('anon', 'public.money_reconciliation_alert_config', 'SELECT') then
    raise exception 'money reconciliation alert: config table readable by clients';
  end if;
  if not exists (select 1 from cron.job where jobname = 'money-reconciliation-daily-check') then
    raise exception 'money reconciliation alert: cron job missing';
  end if;
  if pg_get_functiondef('public.admin_settle_processing_refund(uuid,boolean,text)'::regprocedure) not like '%reference refund:%'
     or pg_get_functiondef('public.service_refund_incident(uuid,text)'::regprocedure) not like '%reference refund:%' then
    raise exception 'money reconciliation alert: refund incident text missing the reference instruction';
  end if;
end $$;
