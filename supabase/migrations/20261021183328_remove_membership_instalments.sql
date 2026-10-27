-- Remove "pay the annual Membership in parts" (S25b, PR #1251, migration 20261021104312_s25b_membership_instalments.sql).
--
-- FOUNDER DECISION 2026-10-21: "we are not doing installment payment again, we now have only free, membership and membership plus."
-- The Membership is one yearly payment. This undoes S25b completely, using the reusable removal pattern in CLAUDE.md.
--
-- LIVE COUNTS READ 2026-10-21 BEFORE WRITING (project koiplnmbgnqnbywhpjlf), so no data conversion step exists and none is needed:
--   order_instalment_plans 0 | order_instalments 0 | order_instalment_attempts 0 | order_instalment_reminders 0
--   refunds with payment_id 0 | refunds with refund_group 0 | refunds in total 0 | orders in total 0 | payments in total 0
--   finance_journal_entries with source_ref like 'orderpart:%' 0 | notifications using the three instalment templates 0
--   platform_modules.membership_instalments exists, is_enabled = false (it was never switched on) | instalment_policy_config 1 row (the shipped schedule)
--   data_registry rows for order_instalment_plans 1 | cron job instalments-hourly 1 | notification_templates instalment_* 3
-- The tables, the two refunds columns and the module row therefore hold nothing a person could lose. Nothing here converts money.
--
-- WHAT IT DOES (code was removed first, in the same pull request: the checkout choice, the plan card, the receipts and refund-dialog part
-- logic, the /admin/instalments page and its search entry, the order-checkout instalment branch, the strings, the proposed-config entry
-- instalments.membership_schedule with its drift test, and the two instalment-only money-reconciliation kinds; the old edge function
-- never sends an instalment field when the module is off, so schema second is safe):
--   1. Puts every function S25b rewrote back to its behaviour from before S25b.
--        Thirteen are restored whole from the last definition that preceded S25b (20261021091357_s26b for the refund trio, the s25 / s25b-ledger /
--        s71 files for the order and ledger functions). The live body of each was checked equal (md5 of pg_proc.prosrc) to what S25b shipped.
--        Four others have been patched on the live project since S25b (the Evergreen ladder: tier stamping in record_order_payment, the
--        upgrade-plus ledger schedule in post_order_to_ledger, the upgrade tier revert in decide_order_refund) or are new
--        (private.money_mismatches): those are patched from their LIVE definition by removing only the instalment fragments, each fragment
--        checked to match the stated number of times, so the ladder work survives in either merge order.
--   2. Drops the cron job, the functions, the four tables and the policy table, the two refunds columns, the module row, the templates and
--      the data_registry row. refunds_one_live goes back to one live refund per order.
--   3. Ends in a DO block that proves it: nothing is left, nothing still names a removed object, anon still cannot execute the payment function.
-- S25b's own migration file stays in the history (it was applied live); this migration undoes it forward.
-- ROLLBACK: there is none worth running. Re-apply 20261021104312_s25b_membership_instalments.sql to restore the feature (it is idempotent
-- enough only on a database that no longer has these objects); there is no data to restore.

-- ---------------------------------------------------------------------------
-- 1. Restore the functions S25b rewrote (whole, from the definition before S25b)
-- ---------------------------------------------------------------------------
create or replace function private.refund_step_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders%rowtype;
  v_step text;
  v_template text;
  v_payload jsonb;
  v_rules jsonb := private.entitlement_policy('refund_rules');
  v_bank text := (v_rules ->> 'bank_days_min') || ' to ' || (v_rules ->> 'bank_days_max');
begin
  if tg_op = 'INSERT' then
    v_step := 'requested';
  elsif new.state is distinct from old.state then
    v_step := case
      when old.state = 'failed' and new.state = 'approved' then 'retrying'
      else case new.state when 'approved' then 'approved' when 'rejected' then 'declined' when 'processing' then 'sending'
                          when 'completed' then 'completed' when 'failed' then 'problem' end end;
  end if;
  if v_step is null then return null; end if;

  insert into public.refund_status_events (refund_id, organisation_id, step) values (new.id, new.organisation_id, v_step);

  v_template := case v_step when 'requested' then 'order_refund_requested' when 'approved' then 'order_refund_approved'
                            when 'declined' then 'order_refund_declined' when 'completed' then 'order_refund_completed'
                            when 'problem' then 'order_refund_problem' end;
  if v_template is not null then
    -- a message that cannot be queued must not stop the money state moving; it is logged where an admin looks
    begin
      select * into o from public.orders where id = new.order_id;
      v_payload := jsonb_build_object('refund_id', new.id, 'order_id', new.order_id, 'sla_days', (v_rules ->> 'decision_sla_days'), 'bank_days', v_bank,
                                      'amount', 'NGN ' || to_char(new.amount_kobo / 100.0, 'FM999,999,999,990.00'));
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values (new.organisation_id, o.buyer_profile_id, private.patient_reminder_channel(o.buyer_profile_id), 'pending', v_template, v_payload);
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (new.organisation_id, 'refund.notify_error', 'refund', new.id, jsonb_build_object('step', v_step, 'error', sqlerrm));
    end;
  end if;
  return null;
end $$;

create or replace function public.refunds_needing_reconcile(p_limit integer default 100)
returns table (id uuid, state text, amount_kobo bigint, provider_reference text, charge_reference text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'not_authorised' using errcode = '42501'; end if;
  return query
    select rf.id, rf.state, rf.amount_kobo, rf.provider_reference,
           (select p.provider_reference from public.payments p where p.order_id = rf.order_id and p.status = 'success' limit 1)
      from public.refunds rf
     where rf.is_test = false and rf.state in ('processing', 'completed', 'failed')
       and (rf.provider_status is distinct from 'matched' or rf.provider_checked_at < now() - interval '60 days')
     order by rf.provider_checked_at nulls first, rf.created_at
     limit greatest(least(coalesce(p_limit, 100), 500), 1);
end $$;

create or replace function public.claim_refund_for_provider(p_refund uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.refunds%rowtype;
  v_ref text;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'refund_not_authorised' using errcode = '42501'; end if;
  select * into r from public.refunds where id = p_refund for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.state <> 'approved' then return jsonb_build_object('result', 'not_claimable', 'state', r.state); end if;
  select p.provider_reference into v_ref from public.payments p where p.order_id = r.order_id and p.status = 'success' and p.provider = 'paystack' limit 1;
  if v_ref is null then return jsonb_build_object('result', 'no_payment'); end if;
  update public.refunds set state = 'processing', attempts = attempts + 1, processing_started_at = now(), last_error_code = null where id = p_refund;
  return jsonb_build_object('result', 'claimed', 'refund_id', r.id, 'order_id', r.order_id, 'organisation_id', r.organisation_id,
                            'amount_kobo', r.amount_kobo, 'charge_reference', v_ref, 'is_test', r.is_test);
end $$;

create or replace function private.post_unposted_orders(p_include_test boolean default false) returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0;
begin
  for r in
    select o.id from public.orders o
     where o.state in ('paid', 'refunded') and (p_include_test or not o.is_test)
       and not exists (select 1 from public.finance_journal_entries e where e.source = 'payment' and e.source_ref = 'order:' || o.id)
     order by o.paid_at limit 200
  loop
    if private.post_order_safely(r.id, p_include_test) then n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function private.post_refund_reversal(p_refund uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r public.refunds%rowtype;
  s public.revenue_recognition_schedules%rowtype;
  v_unrec bigint;
  v_date date := (now() at time zone 'Africa/Lagos')::date;
begin
  select * into r from public.refunds where id = p_refund;
  if not found then return null; end if;
  select * into s from public.revenue_recognition_schedules where source_kind = 'order' and source_id = r.order_id;
  if not found then return null; end if;
  if not exists (select 1 from public.finance_journal_entries where source = 'payment' and source_ref = 'order:' || r.order_id) then return null; end if;
  v_unrec := least(s.total_minor - s.recognized_minor, r.amount_kobo);
  if v_unrec <= 0 then return null; end if;
  return private.finance_post_journal(v_date, 'NGN', 'adjustment', 'refund_deferred_release:' || r.id, 'Refund: release unrecognised deferred revenue',
    jsonb_build_array(
      jsonb_build_object('account_code', '2000', 'debit_minor', v_unrec, 'credit_minor', 0, 'organisation_id', r.organisation_id),
      jsonb_build_object('account_code', '4900', 'debit_minor', 0, 'credit_minor', v_unrec, 'organisation_id', r.organisation_id)), null);
end $$;

create or replace function private.orders_cancel_schedule_on_refund() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.state = 'refunded' and old.state is distinct from 'refunded' then
    update public.revenue_recognition_schedules
       set status = 'cancelled',
           cancelled_reason = 'Order ' || new.id || ' was refunded on ' || to_char(now() at time zone 'Africa/Lagos', 'YYYY-MM-DD') || '; no more revenue is recognised against it.'
     where source_kind = 'order' and source_id = new.id and status = 'active';
  end if;
  return new;
end $$;

create or replace function public.flag_order_payment_mismatch(
  p_reference text,
  p_reason text,
  p_amount_kobo bigint,
  p_total_kobo bigint,
  p_source text,
  p_event_key text default null,
  p_fee_kobo bigint default 0,
  p_raw jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare o public.orders%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into o from public.orders where paystack_reference = p_reference for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if o.state in ('paid', 'refunded') then return jsonb_build_object('result', 'replay', 'order_id', o.id); end if;
  return private.record_order_mismatch(o, left(coalesce(p_reason, 'unknown'), 40), p_amount_kobo, greatest(coalesce(p_fee_kobo, 0), 0), p_total_kobo, p_source, p_event_key, coalesce(p_raw, '{}'::jsonb));
end $$;

create or replace function public.order_for_checkout(p_reference text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare o public.orders%rowtype; it public.catalog_items%rowtype;
begin
  select * into o from public.orders where paystack_reference = p_reference
     and (buyer_profile_id = (select auth.uid()) or beneficiary_patient_id = (select auth.uid()));
  if not found then return null; end if;
  select * into it from public.catalog_items where id = o.catalog_item_id;
  return jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'state', o.state, 'amount_kobo', o.amount_kobo,
    'fee_kobo', o.fee_kobo, 'total_kobo', o.total_kobo, 'code', it.code, 'kind', it.kind, 'name_key', it.name_key,
    'beneficiary_patient_id', o.beneficiary_patient_id, 'paid_at', o.paid_at);
end $$;

create or replace function public.set_order_checkout_url(p_reference text, p_url text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  update public.orders set checkout_url = p_url where paystack_reference = p_reference and state = 'created';
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function public.orders_needing_reconcile(p_limit integer default 50)
returns table (reference text, order_id uuid, expired boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  return query
    select o.paystack_reference, o.id, o.expires_at < now()
      from public.orders o
     where o.state = 'created' and o.created_at < now() - interval '2 minutes' and o.created_at > now() - interval '3 days'
     order by o.created_at limit least(greatest(p_limit, 1), 200);
end $$;

create or replace function public.close_unpaid_order(p_reference text, p_reason text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  update public.orders set state = case when p_reason = 'expired' then 'cancelled' else 'failed' end,
         cancelled_at = case when p_reason = 'expired' then now() end, failure_reason = left(p_reason, 200)
   where paystack_reference = p_reference and state = 'created';
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function public.cancel_order(p_order uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  update public.orders set state = 'cancelled', cancelled_at = now()
   where id = p_order and buyer_profile_id = (select auth.uid()) and state = 'created';
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function public.request_order_refund(p_order uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  o public.orders%rowtype;
  v_refund uuid;
  v_member boolean;
  v_days integer;
begin
  if v_uid is null then raise exception 'refund_not_authorised' using errcode = '42501'; end if;
  select * into o from public.orders where id = p_order and buyer_profile_id = v_uid;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if o.state <> 'paid' then return jsonb_build_object('result', 'order_not_paid', 'state', o.state); end if;
  if o.amount_kobo = 0 then return jsonb_build_object('result', 'covered_by_sponsor'); end if;
  v_member := exists (select 1 from public.catalog_items ci where ci.id = o.catalog_item_id and ci.kind = 'membership');
  v_days := case when v_member then private.membership_refund_window_days() else private.order_refund_cooling_off_days() end;
  if o.paid_at is null or now() > o.paid_at + make_interval(days => v_days) then
    return jsonb_build_object('result', 'outside_refund_window', 'window_days', v_days);
  end if;
  if length(coalesce(p_reason, '')) < 5 then return jsonb_build_object('result', 'reason_too_short'); end if;
  insert into public.refunds (organisation_id, order_id, amount_kobo, reason, requested_by, is_test)
  values (o.organisation_id, o.id, o.amount_kobo, p_reason, v_uid, o.is_test)
  on conflict (order_id) where state in ('pending', 'approved', 'processing', 'completed') do nothing
  returning id into v_refund;
  if v_refund is null then return jsonb_build_object('result', 'already_requested'); end if;
  return jsonb_build_object('result', 'requested', 'refund_id', v_refund,
                            'decision_sla_days', (private.entitlement_policy('refund_rules') ->> 'decision_sla_days')::integer);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Patch the four that other work has touched since: remove only the instalment fragments from the LIVE definition
-- ---------------------------------------------------------------------------
create or replace function pg_temp.patch_fn(p_sig regprocedure, p_pairs text[], p_counts integer[] default null) returns void language plpgsql as $f$
declare d text := pg_get_functiondef(p_sig); i integer := 1; n integer; want integer;
begin
  while i < array_length(p_pairs, 1) loop
    n := (length(d) - length(replace(d, p_pairs[i], ''))) / length(p_pairs[i]);
    want := coalesce(p_counts[(i + 1) / 2], 1);
    if n <> want then raise exception 'instalment removal patch of % expected % match(es) for [%], found %', p_sig, want, p_pairs[i], n; end if;
    d := replace(d, p_pairs[i], p_pairs[i + 1]);
    i := i + 2;
  end loop;
  execute d;
end $f$;

-- record_order_payment: no part routing, no plan-order mismatch branch
select pg_temp.patch_fn('public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure, array[
$p$  v_part jsonb;
$p$, '',
$p$  -- S25b: a reference that belongs to one part of a pay-in-parts plan is recorded by the plan code. NULL means "not a part".
  v_part := private.record_instalment_payment(p_reference, p_amount_kobo, p_fee_kobo, p_total_kobo, p_currency, p_status, p_source, p_event_key, p_paid_at, p_raw, p_processor_fee_kobo);
  if v_part is not null then return v_part; end if;

$p$, '',
$p$  -- S25b: a plan order is paid only through its parts. A charge on the order's own reference (it was never offered to Paystack) is money to give
  -- back, never a full-price payment: it is a visible mismatch plus an incident, not a paid order with no ledger entry.
  if exists (select 1 from public.order_instalment_plans where order_id = o.id) then
    return private.record_instalment_mismatch(o, p_reference, 'plan_order_reference', p_amount_kobo, p_fee_kobo, p_total_kobo, p_source, p_event_key, p_raw);
  end if;
$p$, '']);

-- post_order_to_ledger: a paid order is posted whole again
select pg_temp.patch_fn('private.post_order_to_ledger(uuid,boolean)'::regprocedure, array[
$p$  -- S25b: a plan order received cash a part at a time. Each part is posted by private.post_instalment_to_ledger (orderpart:<payment id>).
  if exists (select 1 from public.order_instalment_plans where order_id = p_order) then return null; end if;
$p$, '']);

-- decide_order_refund: one refund row per order again
select pg_temp.patch_fn('public.decide_order_refund(uuid,boolean,text)'::regprocedure, array[
$p$  pl public.order_instalment_plans%rowtype;
  pay record;
$p$, '',
$p$  v_total bigint;
$p$, '',
$p$where (id = p_refund or (r.refund_group is not null and refund_group = r.refund_group)) and state = 'pending';$p$,
$p$where id = p_refund and state = 'pending';$p$,
$p$  -- plan first (the same lock order as a part payment: plan, then order), so a payment cannot slip in between the decision and the cancel
  select * into pl from public.order_instalment_plans where order_id = r.order_id for update;
  if pl.id is not null then
    -- a part paid after the request was made is refunded too: every successful payment of the order ends up with a refund row. They are
    -- written BEFORE the group is approved, so the one approval message already states the whole amount.
    for pay in select p.id, p.amount_kobo from public.payments p
                where p.order_id = r.order_id and p.status = 'success'
                  and not exists (select 1 from public.refunds x where x.payment_id = p.id and x.state in ('pending', 'approved', 'processing', 'completed')) loop
      insert into public.refunds (organisation_id, order_id, amount_kobo, reason, state, requested_by, decided_by, decided_at, decision_note, is_test, payment_id, refund_group)
      values (r.organisation_id, r.order_id, pay.amount_kobo, r.reason, 'approved', r.requested_by, v_uid, now(), p_note, r.is_test, pay.id, coalesce(r.refund_group, r.id));
    end loop;
  end if;
$p$, '',
$p$  if pl.id is not null then
    update public.order_instalments set state = 'cancelled' where plan_id = pl.id and state = 'pending';
    update public.order_instalment_attempts set state = 'closed'
     where state = 'open' and instalment_id in (select id from public.order_instalments where plan_id = pl.id);
    if pl.state in ('awaiting_first', 'active', 'lapsed') then
      update public.order_instalment_plans set state = 'cancelled' where id = pl.id;
    end if;
  end if;
$p$, '',
$p$  select coalesce(sum(amount_kobo), 0) into v_total from public.refunds
   where (id = p_refund or (r.refund_group is not null and refund_group = r.refund_group)) and state in ('approved', 'processing', 'completed');
$p$, '',
$p$'amount_kobo', v_total,$p$, $p$'amount_kobo', r.amount_kobo,$p$],
  array[1, 1, 2, 1, 1, 1, 1]);

-- money_mismatches (the money reconciliation screen): the two instalment-only kinds and their carve-outs go
select pg_temp.patch_fn('private.money_mismatches(boolean,integer,integer)'::regprocedure, array[
$p$
     and not exists (select 1 from public.order_instalments ip where ip.payment_id = p.id)   -- a part is compared with its own part amount (kind below)$p$, '',
$p$
     and not exists (select 1 from public.order_instalment_plans pl where pl.order_id = o.id)   -- a plan order is posted per part (kind below)$p$, '',
$p$coalesce((select p.provider_reference from public.payments p where p.id = r.payment_id),
                                       (select p.provider_reference from public.payments p where p.order_id = r.order_id and p.status = 'success' limit 1))$p$,
$p$(select p.provider_reference from public.payments p where p.order_id = r.order_id and p.status = 'success' limit 1)$p$,
$p$in ('order:' || o.id, 'orderpart:' || coalesce(r.payment_id::text, ''))$p$, $p$= 'order:' || o.id$p$,
$p$  union all
  -- 23. A paid instalment part whose payment is not the amount of that part.
  select 'instalment_payment_differs_from_part', 'high', i.organisation_id, 'payment', p.id, 'order', i.order_id,
         p.amount_kobo - i.amount_kobo, p.created_at, 'finance',
         'Part ' || i.seq || ' is ' || i.amount_kobo || ' kobo but the payment recorded for it is ' || p.amount_kobo || ' kobo.'
    from public.order_instalments i join public.payments p on p.id = i.payment_id
   where i.state = 'paid' and p.amount_kobo <> i.amount_kobo and (p_include_test or not i.is_test)
  union all
  -- 24. A paid instalment part that never reached the ledger (journal reference orderpart:<payment id>).
  select 'instalment_paid_no_journal', 'high', i.organisation_id, 'payment', p.id, 'order', i.order_id,
         i.amount_kobo, p.created_at, 'finance', 'Part ' || i.seq || ' is paid but has no part payment journal entry in the general ledger.'
    from public.order_instalments i join public.payments p on p.id = i.payment_id
   where i.state = 'paid' and not i.is_test
     and p.created_at < now() - make_interval(mins => p_grace_minutes)
     and not exists (select 1 from public.finance_journal_entries je where je.source = 'payment' and je.source_ref = 'orderpart:' || i.payment_id)
$p$, '']);

-- ---------------------------------------------------------------------------
-- 3. Remove the feature: job, functions, tables, columns, module, templates, registry row
-- ---------------------------------------------------------------------------
select cron.unschedule('instalments-hourly') where exists (select 1 from cron.job where jobname = 'instalments-hourly');

drop function public.create_instalment_order(text, uuid, integer);
drop function public.prepare_instalment_payment(uuid);
drop function public.my_instalment_plans();
drop function public.admin_instalment_overview();
drop function public.instalment_policy_public();
drop function private.instalments_hourly();
drop function private.sweep_instalment_lapses();
drop function private.queue_instalment_reminders();
drop function private.instalment_ledger_catch_up();
drop function private.record_instalment_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb, bigint);
drop function private.record_instalment_mismatch(public.orders, text, text, bigint, bigint, bigint, text, text, jsonb);
drop function private.instalment_reply(public.orders, boolean);
drop function private.post_instalment_safely(uuid);
drop function private.post_instalment_to_ledger(uuid, boolean);

-- No CASCADE anywhere: if anything else still depends on these, the migration must stop and say so.
drop table public.order_instalment_reminders;
drop table public.order_instalment_attempts;
drop table public.order_instalments;
drop table public.order_instalment_plans;
drop function private.instalment_plans_guard();
drop function private.instalments_guard();
drop function private.instalments_sum_check();
drop table public.instalment_policy_config;
drop function private.instalment_policy();

-- Refunds: one live refund per order again (the shape request_order_refund's ON CONFLICT (order_id) needs).
drop index public.refunds_one_live;
drop index public.refunds_group_idx;
alter table public.refunds drop column payment_id;
alter table public.refunds drop column refund_group;
create unique index refunds_one_live on public.refunds (order_id)
  where state in ('pending', 'approved', 'processing', 'completed');

delete from public.notification_template_locales where template_key in ('instalment_reminder', 'instalment_lapsed', 'instalment_restored');
delete from public.notification_templates where key in ('instalment_reminder', 'instalment_lapsed', 'instalment_restored');
delete from public.data_registry where table_name = 'order_instalment_plans';
delete from public.platform_modules where key = 'membership_instalments';

-- ---------------------------------------------------------------------------
-- 4. Self-check: it is gone, nothing names it, and the money functions are still shut to the wrong roles
-- ---------------------------------------------------------------------------
do $$
declare v_left text;
begin
  if to_regclass('public.order_instalment_plans') is not null or to_regclass('public.order_instalments') is not null
     or to_regclass('public.order_instalment_attempts') is not null or to_regclass('public.order_instalment_reminders') is not null
     or to_regclass('public.instalment_policy_config') is not null then
    raise exception 'instalment removal: a table is still there';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'refunds' and column_name in ('payment_id', 'refund_group')) then
    raise exception 'instalment removal: a refunds column is still there';
  end if;
  if (select pg_get_indexdef(i.indexrelid) from pg_index i where i.indexrelid = 'public.refunds_one_live'::regclass) not like '%(order_id) WHERE%' then
    raise exception 'instalment removal: refunds_one_live is not one live refund per order';
  end if;
  if exists (select 1 from cron.job where jobname = 'instalments-hourly') then raise exception 'instalment removal: the cron job is still scheduled'; end if;
  if exists (select 1 from public.platform_modules where key = 'membership_instalments') then raise exception 'instalment removal: the module row is still there'; end if;
  if exists (select 1 from public.notification_templates where key like 'instalment\_%') then raise exception 'instalment removal: a template is still there'; end if;
  if exists (select 1 from public.data_registry where table_name like 'order\_instalment%') then raise exception 'instalment removal: a registry row is still there'; end if;
  select string_agg(n.nspname || '.' || p.proname, ', ') into v_left
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prokind = 'f'
     and (p.proname ~ '^(create_instalment_order|prepare_instalment_payment|my_instalment_plans|admin_instalment_overview|instalment_policy_public|instalment_policy|instalments_hourly|sweep_instalment_lapses|queue_instalment_reminders|instalment_ledger_catch_up|record_instalment_payment|record_instalment_mismatch|instalment_reply|post_instalment_safely|post_instalment_to_ledger|instalment_plans_guard|instalments_guard|instalments_sum_check)$'
          or p.prosrc ~* 'order_instalment|instalment_polic|membership_instalments|record_instalment|post_instalment|orderpart|refund_group|instalment_reply|sweep_instalment|queue_instalment|instalment_ledger|instalments_hourly|create_instalment_order|prepare_instalment|my_instalment_plans|admin_instalment');
  if v_left is not null then raise exception 'instalment removal: still present or still referenced by: %', v_left; end if;
  if has_function_privilege('anon', 'public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb, bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb, bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.decide_order_refund(uuid, boolean, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.request_order_refund(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cancel_order(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.claim_refund_for_provider(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_refund_for_provider(uuid)', 'EXECUTE') then
    raise exception 'instalment removal: a money function is callable by the wrong role';
  end if;
end $$;
