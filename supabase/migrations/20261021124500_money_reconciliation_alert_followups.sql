-- Money reconciliation: review follow-ups on the daily alert (migration 20261021113500).
--
-- 1. An open daily incident whose mismatches have all cleared kept saying "N place(s) disagree". The check now rewrites the open incident's
--    summary to say the screen is empty (it still never closes an incident; a person does).
-- 2. A failed incident write for one organisation logged to audit_log, and if THAT insert failed too (for example a null organisation)
--    the whole loop aborted and later organisations got nothing that day. The log insert is now guarded, and a failure there raises a
--    WARNING instead of ending the run.
-- 3. The two "settled by hand" refund messages named the reference refund:<id> but not the journal source the screen accepts
--    (manual or refund), so a hand-posted entry with another source would never clear the item. Both now say so.
-- Both refund functions are otherwise identical to the definitions applied by 20261021113500.

create or replace function private.money_reconciliation_daily_check() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_rules jsonb;
  v_n integer := 0;
  v_seen text[] := '{}';
  v_ref text;
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
    v_ref := 'money-reconciliation-daily:' || coalesce(r.org::text, 'none');
    v_seen := v_seen || v_ref;
    begin
      perform private.order_incident(r.org, v_ref,
        'Money records disagree: ' || r.total || ' open on the reconciliation screen',
        r.total || ' place(s) where the money records disagree, the oldest since ' || to_char(r.oldest at time zone 'Africa/Lagos', 'YYYY-MM-DD')
          || ': ' || left(r.kinds, 600) || '. Open Finance > Money reconciliation (/finance/money-reconciliation). Nothing is fixed automatically; '
          || 'close this incident once each item has been checked.');
      v_n := v_n + 1;
    exception when others then
      begin
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (r.org, 'money_reconciliation.sweep_error', 'organisation', r.org, jsonb_build_object('error', sqlerrm));
      exception when others then
        raise warning 'money_reconciliation_daily_check: incident write failed for % and so did the audit log: %', v_ref, sqlerrm;
      end;
    end;
  end loop;

  -- Anything still open from an earlier day that no longer has a mismatch: say so, do not close it.
  update public.ops_incidents
     set summary = 'The Money reconciliation screen shows no open items as of ' || to_char(now() at time zone 'Africa/Lagos', 'YYYY-MM-DD')
                   || '. Every item that raised this incident has cleared. Close this incident once you have confirmed that on /finance/money-reconciliation.'
   where external_reference like 'money-reconciliation-daily:%'
     and status not in ('resolved', 'closed')
     and not (external_reference = any (v_seen));
  return v_n;
end $$;
revoke all on function private.money_reconciliation_daily_check() from public, anon, authenticated;

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
      || ' kobo with the journal source manual (or refund) and the reference refund:' || r.id || '. The Money reconciliation screen clears this refund only when the entry carries both.');
  end if;
  return v;
end $$;
revoke all on function public.admin_settle_processing_refund(uuid, boolean, text) from public, anon;
grant execute on function public.admin_settle_processing_refund(uuid, boolean, text) to authenticated;

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
      || '). Post Dr 4900 / Cr 1020 by hand with the journal source manual (or refund) and the reference refund:' || r.id || ' (the Money reconciliation screen clears this refund only when the entry carries both), or re-run the refund.processed posting.');
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
    raise exception 'money reconciliation alert follow-up: wrong execute grants';
  end if;
  if pg_get_functiondef('public.admin_settle_processing_refund(uuid,boolean,text)'::regprocedure) not like '%journal source manual%'
     or pg_get_functiondef('public.service_refund_incident(uuid,text)'::regprocedure) not like '%journal source manual%' then
    raise exception 'money reconciliation alert follow-up: refund text missing the journal source';
  end if;
end $$;
