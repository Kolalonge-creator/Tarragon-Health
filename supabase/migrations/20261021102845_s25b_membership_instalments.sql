-- S25b: pay the annual Membership in parts (founder decision 2026-10-20, against INV-09; credit risk accepted by the founder).
--
-- WHAT THIS IS. A patient may split the one-year Membership price into a few payments. Access unlocks after the FIRST part and its 365
-- days run from the first part. A later part that is still unpaid after its due date plus a grace period LAPSES the Membership (access
-- ends, nothing is deleted); paying the overdue part restores it. It is DORMANT: the platform module `membership_instalments` defaults
-- OFF and nothing in this migration switches it on. See docs/design/S25b.md and OQ-715 .. OQ-718 in docs/OPEN-QUESTIONS.md.
--
-- WHAT IT IS NOT. There is no wallet and no stored balance (INV-09 is brushed, not broken): every part is its own Paystack payment
-- against one order, in integer kobo, and the parts add up to the order price exactly. Nothing is charged by us; the patient pays each
-- part. There is no card on file and no auto-debit. One Membership at a time still holds (create_order refuses a second one).
--
-- THE SHAPE.
--   order_instalment_plans    one per order (the schedule snapshot, the state: awaiting_first | active | lapsed | completed | cancelled)
--   order_instalments         one per part (amount, due date, state: pending | paid | cancelled); a deferred trigger proves sum = price
--   order_instalment_attempts one per Paystack reference (a part may be tried more than once); the reference maps back to the part
--   order_instalment_reminders one per part and step, so a reminder is sent once
-- A part's payment is recorded by the SAME entry point as any order payment, public.record_order_payment (so the webhook, the return
-- page and the sweeper work unchanged): a reference that belongs to a part is handed to private.record_instalment_payment, which
-- locks the plan, is idempotent on the reference, and refuses (as a visible mismatch plus an incident, never silently) a wrong
-- amount, a part already paid, or a part whose plan was closed.
--
-- MONEY. Each part is Dr 1020 / Cr 2000 for that part (journal source_ref 'orderpart:<payment id>') with its own straight-line
-- recognition schedule from the day it was paid to the end of the access window, so revenue is never recognised ahead of cash. The
-- full-price posting private.post_order_to_ledger is skipped for a plan order. A refund of a partly paid order is one refund row per
-- paid part (refunds.payment_id, grouped by refunds.refund_group), each sent back against its own Paystack charge, so exactly what was
-- paid is returned and nothing else; the deferred revenue released and the consultation share reversed follow the same rows.
-- ACCESS. Membership works as normal while the plan is not lapsed. Doctor time is not pro-rated by the fraction paid (OQ-716).
--
-- Live counts read 2026-10-21 before writing: orders 0 plan-eligible, refunds 0, so the unique-index swap on refunds converts no data.
-- Definitions of record_order_payment, post_order_to_ledger, post_refund_reversal, orders_needing_reconcile, close_unpaid_order,
-- order_for_checkout, set_order_checkout_url, flag_order_payment_mismatch, claim_refund_for_provider and
-- orders_cancel_schedule_on_refund were read from the live project with pg_get_functiondef (not from files); request_order_refund,
-- decide_order_refund, refund_step_notice come from 20261021091357_s26b (the live definitions equal the file, verified).
-- ROLLBACK: restore those function bodies from the files named above; drop the four new tables; drop the two new refunds columns and
-- recreate refunds_one_live on (order_id); delete the platform_modules row and the templates.

-- ---------------------------------------------------------------------------
-- 1. The dormant switch
-- ---------------------------------------------------------------------------
insert into public.platform_modules (key, label, description)
values ('membership_instalments', 'Membership pay in parts',
        'Lets a patient pay the annual Membership in a few parts. Access unlocks after the first part and lapses if a later part is missed. Defaults OFF. A founder decision against INV-09 (no stored balance) that carries credit risk; counsel questions are OQ-715 to OQ-718. Needs v5_checkout on as well.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The schedule (PROPOSED, versioned, mirrored in packages/shared/src/proposed-config/registry.ts with a drift test)
-- ---------------------------------------------------------------------------
create table public.instalment_policy_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null check (version > 0) unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null check (jsonb_typeof(rules) = 'object'),
  created_at     timestamptz not null default now()
);
create unique index instalment_policy_config_one_active on public.instalment_policy_config ((true)) where is_active;
alter table public.instalment_policy_config enable row level security;
revoke all on public.instalment_policy_config from public, anon, authenticated;

-- instalments-schedule-begin (mirrored as instalments.membership_schedule in packages/shared/src/proposed-config/registry.ts)
insert into public.instalment_policy_config (version, is_active, effective_from, rules)
values (1, true, date '2026-10-20',
        $json${"parts":3,"due_offsets_days":[0,30,60],"grace_days":5,"reminder_days_before":[3,0]}$json$::jsonb);
-- instalments-schedule-end

-- The active rules, or the shipped defaults when no row is active (a missing config never changes a rule).
create function private.instalment_policy() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce((select rules from public.instalment_policy_config where is_active),
                  '{"parts":3,"due_offsets_days":[0,30,60],"grace_days":5,"reminder_days_before":[3,0]}'::jsonb)
$$;
revoke all on function private.instalment_policy() from public, anon, authenticated;

-- What the checkout and the receipt quote, so no screen hard-codes a number of parts or days. `open` is the module switch.
create function public.instalment_policy_public() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select private.instalment_policy()
         || jsonb_build_object('open', coalesce((select is_enabled from public.platform_modules where key = 'membership_instalments'), false))
$$;
revoke all on function public.instalment_policy_public() from public, anon;
grant execute on function public.instalment_policy_public() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------
create table public.order_instalment_plans (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  order_id        uuid not null unique references public.orders (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  parts           integer not null check (parts between 2 and 12),
  price_kobo      bigint not null check (price_kobo > 0 and price_kobo <= 100000000000),
  schedule        jsonb not null check (jsonb_typeof(schedule) = 'object'),
  schedule_version integer not null,
  state           text not null default 'awaiting_first' check (state in ('awaiting_first', 'active', 'lapsed', 'completed', 'cancelled')),
  first_paid_at   timestamptz,
  lapsed_at       timestamptz,
  restored_at     timestamptz,
  -- true when the lapse itself ended the entitlement; a restore reopens only an entitlement the lapse closed, never one closed for another reason
  lapse_revoked   boolean not null default false,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (state in ('awaiting_first', 'cancelled') or first_paid_at is not null)
);
create index order_instalment_plans_state_idx on public.order_instalment_plans (state);
create index order_instalment_plans_patient_idx on public.order_instalment_plans (patient_id);

create table public.order_instalments (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  plan_id         uuid not null references public.order_instalment_plans (id) on delete restrict,
  order_id        uuid not null references public.orders (id) on delete restrict,
  seq             integer not null check (seq >= 1),
  amount_kobo     bigint not null check (amount_kobo > 0),
  due_at          timestamptz,
  state           text not null default 'pending' check (state in ('pending', 'paid', 'cancelled')),
  paid_at         timestamptz,
  payment_id      uuid unique references public.payments (id) on delete restrict,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (plan_id, seq),
  check ((state = 'paid') = (paid_at is not null and payment_id is not null))
);
create index order_instalments_due_idx on public.order_instalments (due_at) where state = 'pending';
create index order_instalments_order_idx on public.order_instalments (order_id);

create table public.order_instalment_attempts (
  reference       text primary key check (reference ~ '^[A-Za-z0-9._=-]{8,100}$'),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  instalment_id   uuid not null references public.order_instalments (id) on delete restrict,
  state           text not null default 'open' check (state in ('open', 'paid', 'closed')),
  checkout_url    text check (checkout_url is null or checkout_url ~ '^https://'),
  created_at      timestamptz not null default now()
);
create index order_instalment_attempts_inst_idx on public.order_instalment_attempts (instalment_id, state);

create table public.order_instalment_reminders (
  instalment_id   uuid not null references public.order_instalments (id) on delete cascade,
  step_days       integer not null check (step_days >= 0),
  notification_id uuid,
  created_at      timestamptz not null default now(),
  primary key (instalment_id, step_days)
);

-- RLS: the buyer, the beneficiary and org admins read; nobody writes directly (every write is a SECURITY DEFINER function).
alter table public.order_instalment_plans enable row level security;
alter table public.order_instalments enable row level security;
alter table public.order_instalment_attempts enable row level security;
alter table public.order_instalment_reminders enable row level security;
revoke all on public.order_instalment_plans, public.order_instalments, public.order_instalment_attempts, public.order_instalment_reminders from public, anon, authenticated;
grant select on public.order_instalment_plans, public.order_instalments to authenticated;

create policy order_instalment_plans_read on public.order_instalment_plans for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_instalment_plans.order_id
                   and (o.buyer_profile_id = (select auth.uid()) or o.beneficiary_patient_id = (select auth.uid())
                        or (private.is_admin() and o.organisation_id = (select organisation_id from public.profiles where id = (select auth.uid()))))));
create policy order_instalments_read on public.order_instalments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_instalments.order_id
                   and (o.buyer_profile_id = (select auth.uid()) or o.beneficiary_patient_id = (select auth.uid())
                        or (private.is_admin() and o.organisation_id = (select organisation_id from public.profiles where id = (select auth.uid()))))));

-- Plans and parts never change what they are, and move only along the allowed states.
create function private.instalment_plans_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'instalment_immutable' using errcode = 'P0001'; end if;
  if new.order_id is distinct from old.order_id or new.price_kobo is distinct from old.price_kobo or new.parts is distinct from old.parts
     or new.patient_id is distinct from old.patient_id or new.schedule is distinct from old.schedule then
    raise exception 'instalment_immutable' using errcode = 'P0001';
  end if;
  if new.state is distinct from old.state and not (
       (old.state = 'awaiting_first' and new.state in ('active', 'cancelled'))
    or (old.state = 'active'         and new.state in ('lapsed', 'completed', 'cancelled'))
    or (old.state = 'lapsed'         and new.state in ('active', 'completed', 'cancelled'))
    or (old.state = 'cancelled'      and new.state = 'active')) then   -- a verified late first payment revives a closed plan
    raise exception 'instalment_bad_transition % to %', old.state, new.state using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger order_instalment_plans_guard before update or delete on public.order_instalment_plans
  for each row execute function private.instalment_plans_guard();

create function private.instalments_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'instalment_immutable' using errcode = 'P0001'; end if;
  if new.plan_id is distinct from old.plan_id or new.order_id is distinct from old.order_id or new.seq is distinct from old.seq
     or new.amount_kobo is distinct from old.amount_kobo then
    raise exception 'instalment_immutable' using errcode = 'P0001';
  end if;
  if new.state is distinct from old.state and not (
       (old.state = 'pending'   and new.state in ('paid', 'cancelled'))
    or (old.state = 'cancelled' and new.state = 'pending')) then
    raise exception 'instalment_bad_transition % to %', old.state, new.state using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger order_instalments_guard before update or delete on public.order_instalments
  for each row execute function private.instalments_guard();

-- The parts of a plan add up to its price EXACTLY and there are exactly `parts` of them. Checked at the end of the transaction that
-- creates them (deferred), so a plan can be written one part at a time but never left wrong.
create function private.instalments_sum_check() returns trigger language plpgsql set search_path = '' as $$
declare p public.order_instalment_plans%rowtype; v_sum bigint; v_n integer;
begin
  select * into p from public.order_instalment_plans where id = new.plan_id;
  select coalesce(sum(amount_kobo), 0), count(*) into v_sum, v_n from public.order_instalments where plan_id = new.plan_id;
  if v_n <> p.parts or v_sum <> p.price_kobo then
    raise exception 'instalment_sum_mismatch: % parts total % kobo, plan wants % parts and % kobo', v_n, v_sum, p.parts, p.price_kobo using errcode = 'P0001';
  end if;
  return null;
end $$;
create constraint trigger order_instalments_sum_check after insert on public.order_instalments
  deferrable initially deferred for each row execute function private.instalments_sum_check();

-- ---------------------------------------------------------------------------
-- 4. Refunds of a partly paid order: one refund row per paid part, each against its own Paystack charge
-- ---------------------------------------------------------------------------
alter table public.refunds add column payment_id uuid references public.payments (id) on delete restrict;
alter table public.refunds add column refund_group uuid;
create index refunds_group_idx on public.refunds (refund_group) where refund_group is not null;
drop index public.refunds_one_live;
create unique index refunds_one_live on public.refunds (order_id, (coalesce(payment_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  where state in ('pending', 'approved', 'processing', 'completed');
grant select (refund_group) on public.refunds to authenticated;

-- The patient is told once per refund request, not once per part: the first row of a group speaks for it, and says the whole amount.
create or replace function private.refund_step_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders%rowtype;
  v_step text;
  v_template text;
  v_payload jsonb;
  v_rules jsonb := private.entitlement_policy('refund_rules');
  v_bank text := (v_rules ->> 'bank_days_min') || ' to ' || (v_rules ->> 'bank_days_max');
  v_amount bigint;
  v_target uuid := new.id;
begin
  if tg_op = 'INSERT' then
    if new.refund_group is not null and new.refund_group <> new.id then return null; end if;
    v_step := 'requested';
  elsif new.state is distinct from old.state then
    v_step := case
      when old.state = 'failed' and new.state = 'approved' then 'retrying'
      else case new.state when 'approved' then 'approved' when 'rejected' then 'declined' when 'processing' then 'sending'
                          when 'completed' then 'completed' when 'failed' then 'problem' end end;
    if new.refund_group is not null then
      -- a group is one refund to the patient, told under the first row's id. The first row speaks for the decision and the sending; the group is
      -- COMPLETE only when every row is; and a part that failed or is being retried is told from whichever row it happened on, so a failure is never
      -- hidden behind a row that succeeded.
      v_target := new.refund_group;
      if v_step in ('approved', 'declined', 'sending') and new.refund_group <> new.id then return null; end if;
      if v_step = 'completed' and exists (select 1 from public.refunds x where x.refund_group = new.refund_group and x.state <> 'completed') then return null; end if;
    end if;
  end if;
  if v_step is null then return null; end if;

  insert into public.refund_status_events (refund_id, organisation_id, step) values (v_target, new.organisation_id, v_step);

  v_template := case v_step when 'requested' then 'order_refund_requested' when 'approved' then 'order_refund_approved'
                            when 'declined' then 'order_refund_declined' when 'completed' then 'order_refund_completed'
                            when 'problem' then 'order_refund_problem' end;
  if v_template is not null then
    begin
      select * into o from public.orders where id = new.order_id;
      v_amount := case when new.refund_group is null then new.amount_kobo
                       else (select sum(amount_kobo) from public.refunds where refund_group = new.refund_group) end;
      v_payload := jsonb_build_object('refund_id', v_target, 'order_id', new.order_id, 'sla_days', (v_rules ->> 'decision_sla_days'), 'bank_days', v_bank,
                                      'amount', 'NGN ' || to_char(v_amount / 100.0, 'FM999,999,999,990.00'));
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values (new.organisation_id, o.buyer_profile_id, private.patient_reminder_channel(o.buyer_profile_id), 'pending', v_template, v_payload);
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (new.organisation_id, 'refund.notify_error', 'refund', v_target, jsonb_build_object('step', v_step, 'error', sqlerrm));
    end;
  end if;
  return null;
end $$;

-- A reconcile row for a refund of one part is checked against that part's own charge.
create or replace function public.refunds_needing_reconcile(p_limit integer default 100)
returns table(id uuid, state text, amount_kobo bigint, provider_reference text, charge_reference text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'not_authorised' using errcode = '42501'; end if;
  return query
    select rf.id, rf.state, rf.amount_kobo, rf.provider_reference,
           (select p.provider_reference from public.payments p
             where p.order_id = rf.order_id and p.status = 'success' and (rf.payment_id is null or p.id = rf.payment_id) limit 1)
      from public.refunds rf
     where rf.is_test = false and rf.state in ('processing', 'completed', 'failed')
       and (rf.provider_status is distinct from 'matched' or rf.provider_checked_at < now() - interval '60 days')
     order by rf.provider_checked_at nulls first, rf.created_at
     limit greatest(least(coalesce(p_limit, 100), 500), 1);
end $$;

-- Claim: a refund of one part is sent against that part's own charge.
create or replace function public.claim_refund_for_provider(p_refund uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.refunds%rowtype;
  v_ref text;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'refund_not_authorised' using errcode = '42501'; end if;
  select * into r from public.refunds where id = p_refund for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.state <> 'approved' then return jsonb_build_object('result', 'not_claimable', 'state', r.state); end if;
  select p.provider_reference into v_ref from public.payments p
   where p.order_id = r.order_id and p.status = 'success' and p.provider = 'paystack' and (r.payment_id is null or p.id = r.payment_id) limit 1;
  if v_ref is null then return jsonb_build_object('result', 'no_payment'); end if;
  update public.refunds set state = 'processing', attempts = attempts + 1, processing_started_at = now(), last_error_code = null where id = p_refund;
  return jsonb_build_object('result', 'claimed', 'refund_id', r.id, 'order_id', r.order_id, 'organisation_id', r.organisation_id,
                            'amount_kobo', r.amount_kobo, 'charge_reference', v_ref, 'is_test', r.is_test);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Ledger: a plan order is posted part by part, never at full price
-- ---------------------------------------------------------------------------
create or replace function private.post_order_to_ledger(p_order uuid, p_include_test boolean default false) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders%rowtype;
  it public.catalog_items%rowtype;
  v_date date;
  v_ref text;
  v_entry uuid;
  v_gross bigint;
  v_lines jsonb := '[]'::jsonb;
begin
  select * into o from public.orders where id = p_order;
  if not found or o.state not in ('paid', 'refunded') then return null; end if;
  -- S25b: a plan order received cash a part at a time. Each part is posted by private.post_instalment_to_ledger (orderpart:<payment id>).
  if exists (select 1 from public.order_instalment_plans where order_id = p_order) then return null; end if;
  if o.is_test and not p_include_test then return null; end if;
  v_ref := 'order:' || o.id;
  if o.state = 'refunded' and not exists (select 1 from public.finance_journal_entries where source = 'payment' and source_ref = v_ref) then
    return null;
  end if;
  select * into it from public.catalog_items where id = o.catalog_item_id;
  v_date := (coalesce(o.paid_at, now()) at time zone 'Africa/Lagos')::date;
  if exists (select 1 from public.finance_periods where period_month = date_trunc('month', v_date)::date and status <> 'open') then
    v_date := (now() at time zone 'Africa/Lagos')::date;
  end if;
  v_gross := o.amount_kobo + o.sponsor_share_kobo;
  if v_gross <= 0 then return null; end if;

  if o.amount_kobo > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1020', 'debit_minor', o.amount_kobo, 'credit_minor', 0, 'organisation_id', o.organisation_id);
  end if;
  if o.sponsor_share_kobo > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1210', 'debit_minor', o.sponsor_share_kobo, 'credit_minor', 0, 'organisation_id', o.organisation_id);
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', case when it.duration_days is null then '4100' else '2000' end, 'debit_minor', 0, 'credit_minor', v_gross, 'organisation_id', o.organisation_id);
  v_entry := private.finance_post_journal(v_date, 'NGN', 'payment', v_ref, 'Order payment: ' || it.code, v_lines, null);

  if it.duration_days is not null then
    select entry_date into v_date from public.finance_journal_entries where id = v_entry;
    if o.state = 'paid' and not exists (select 1 from public.revenue_recognition_schedules where source_kind = 'order' and source_id = o.id) then
      perform private.finance_create_recognition_schedule('order', o.id, null, o.organisation_id, '4020', 'NGN', v_gross, v_date, v_date + it.duration_days);
    end if;
  end if;
  return v_entry;
end $$;

-- One part received: Dr 1020 / Cr 2000, then its own schedule to the end of the access window (earned over the time it pays for, never ahead
-- of cash). A part paid on the last day of access has no window left and is earned at once (Cr 4100).
create function private.post_instalment_to_ledger(p_payment uuid, p_include_test boolean default false) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  pay public.payments%rowtype;
  o public.orders%rowtype;
  e public.entitlements%rowtype;
  v_date date;
  v_end date;
  v_entry uuid;
  v_earned boolean;
begin
  select * into pay from public.payments where id = p_payment and status = 'success';
  if not found then return null; end if;
  select * into o from public.orders where id = pay.order_id;
  if not exists (select 1 from public.order_instalment_plans where order_id = o.id) then return null; end if;
  if o.is_test and not p_include_test then return null; end if;
  select * into e from public.entitlements where order_id = o.id;
  v_date := (pay.verified_at at time zone 'Africa/Lagos')::date;
  if exists (select 1 from public.finance_periods where period_month = date_trunc('month', v_date)::date and status <> 'open') then
    v_date := (now() at time zone 'Africa/Lagos')::date;
  end if;
  v_end := (e.ends_at at time zone 'Africa/Lagos')::date;
  v_earned := v_end is null or v_end <= v_date;
  v_entry := private.finance_post_journal(v_date, 'NGN', 'payment', 'orderpart:' || pay.id, 'Order part payment',
    jsonb_build_array(
      jsonb_build_object('account_code', '1020', 'debit_minor', pay.amount_kobo, 'credit_minor', 0, 'organisation_id', o.organisation_id),
      jsonb_build_object('account_code', case when v_earned then '4100' else '2000' end, 'debit_minor', 0, 'credit_minor', pay.amount_kobo, 'organisation_id', o.organisation_id)), null);
  if not v_earned and not exists (select 1 from public.revenue_recognition_schedules where source_kind = 'order' and source_id = pay.id) then
    select entry_date into v_date from public.finance_journal_entries where id = v_entry;
    perform private.finance_create_recognition_schedule('order', pay.id, null, o.organisation_id, '4020', 'NGN', pay.amount_kobo, v_date, v_end);
  end if;
  return v_entry;
end $$;
revoke all on function private.post_instalment_to_ledger(uuid, boolean) from public, anon, authenticated;

-- True only when an entry exists for the part after the call (a part that could not be posted, or is not to be posted, is not "done").
create function private.post_instalment_safely(p_payment uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid; v_entry uuid;
begin
  v_entry := private.post_instalment_to_ledger(p_payment);
  return v_entry is not null;
exception when others then
  select organisation_id into v_org from public.payments where id = p_payment;
  perform private.order_incident(v_org, 'orderpart-ledger:' || p_payment, 'A part payment could not be posted to the ledger',
    'Payment ' || p_payment || ' was received but its journal entry failed (' || left(sqlerrm, 300) || '). The hourly job retries; if it keeps failing, check the accounting period.');
  return false;
end $$;
revoke all on function private.post_instalment_safely(uuid) from public, anon, authenticated;

-- The hourly order catch-up (order-ledger-retry) looks for paid orders with no 'order:<id>' entry. A plan order is posted part by part under
-- 'orderpart:<payment id>', so it would be picked again every hour and, with enough of them, crowd out the ordinary orders that really need a retry.
create or replace function private.post_unposted_orders(p_include_test boolean default false)
returns integer language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0;
begin
  for r in
    select o.id from public.orders o
     where o.state in ('paid', 'refunded') and (p_include_test or not o.is_test)
       and not exists (select 1 from public.order_instalment_plans pl where pl.order_id = o.id)
       and not exists (select 1 from public.finance_journal_entries e where e.source = 'payment' and e.source_ref = 'order:' || o.id)
     order by o.paid_at limit 200
  loop
    if private.post_order_safely(r.id, p_include_test) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- A refunded part releases ITS OWN unrecognised deferred revenue. A refund with no payment_id is the old whole-order case, unchanged.
create or replace function private.post_refund_reversal(p_refund uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  r public.refunds%rowtype;
  s public.revenue_recognition_schedules%rowtype;
  v_unrec bigint;
  v_date date := (now() at time zone 'Africa/Lagos')::date;
begin
  select * into r from public.refunds where id = p_refund;
  if not found then return null; end if;
  if r.payment_id is not null then
    select * into s from public.revenue_recognition_schedules where source_kind = 'order' and source_id = r.payment_id;
    if not found then return null; end if;
    if not exists (select 1 from public.finance_journal_entries where source = 'payment' and source_ref = 'orderpart:' || r.payment_id) then return null; end if;
  else
    select * into s from public.revenue_recognition_schedules where source_kind = 'order' and source_id = r.order_id;
    if not found then return null; end if;
    if not exists (select 1 from public.finance_journal_entries where source = 'payment' and source_ref = 'order:' || r.order_id) then return null; end if;
  end if;
  v_unrec := least(s.total_minor - s.recognized_minor, r.amount_kobo);
  if v_unrec <= 0 then return null; end if;
  return private.finance_post_journal(v_date, 'NGN', 'adjustment', 'refund_deferred_release:' || r.id, 'Refund: release unrecognised deferred revenue',
    jsonb_build_array(
      jsonb_build_object('account_code', '2000', 'debit_minor', v_unrec, 'credit_minor', 0, 'organisation_id', r.organisation_id),
      jsonb_build_object('account_code', '4900', 'debit_minor', 0, 'credit_minor', v_unrec, 'organisation_id', r.organisation_id)), null);
end $$;

-- Refunding an order stops recognising revenue against it, including every part's own schedule.
create or replace function private.orders_cancel_schedule_on_refund() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.state = 'refunded' and old.state is distinct from 'refunded' then
    update public.revenue_recognition_schedules
       set status = 'cancelled',
           cancelled_reason = 'Order ' || new.id || ' was refunded on ' || to_char(now() at time zone 'Africa/Lagos', 'YYYY-MM-DD') || '; no more revenue is recognised against it.'
     where source_kind = 'order' and status = 'active'
       and (source_id = new.id or source_id in (select id from public.payments where order_id = new.id));
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Creating a plan order
-- ---------------------------------------------------------------------------
-- The reply for a plan order: the FIRST part is what gets paid, under its own reference.
create function private.instalment_reply(o public.orders, p_replay boolean) returns jsonb
language sql stable security definer set search_path = ''
as $$
  -- always a reference (the open attempt's, else the latest one), so a retry of a plan that has closed answers "this order has closed" and not a
  -- strange error; the hosted page is offered only while the attempt is still open
  select jsonb_build_object('order_id', o.id, 'reference', a.reference, 'amount_kobo', i.amount_kobo, 'state', o.state,
                            'checkout_url', case when a.state = 'open' then a.checkout_url end, 'replay', p_replay, 'instalments', true, 'parts', pl.parts, 'price_kobo', pl.price_kobo)
    from public.order_instalment_plans pl
    join public.order_instalments i on i.plan_id = pl.id and i.seq = 1
    left join lateral (select reference, checkout_url, state from public.order_instalment_attempts where instalment_id = i.id
                        order by (state = 'open') desc, created_at desc limit 1) a on true
   where pl.order_id = o.id
$$;
revoke all on function private.instalment_reply(public.orders, boolean) from public, anon, authenticated;

create function public.create_instalment_order(p_code text, p_client_key uuid default null, p_parts integer default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  pol jsonb;
  pr public.profiles%rowtype;
  it public.catalog_items%rowtype;
  o public.orders%rowtype;
  r jsonb;
  pl uuid := gen_random_uuid();
  v_parts integer;
  v_base bigint;
  v_rem bigint;
  v_seq integer;
  v_inst uuid;
begin
  if v_uid is null then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = v_uid and role = 'patient' and is_active;
  if not found then raise exception 'order_not_authorised' using errcode = '42501'; end if;

  -- a retry of the same tap answers with the first reply
  if p_client_key is not null then
    select * into o from public.orders where buyer_profile_id = v_uid and client_key = p_client_key;
    if found then
      if not exists (select 1 from public.order_instalment_plans where order_id = o.id) then raise exception 'instalment_order_mismatch' using errcode = 'P0001'; end if;
      return private.instalment_reply(o, true);
    end if;
  end if;

  if not coalesce((select is_enabled from public.platform_modules where key = 'membership_instalments'), false) then
    raise exception 'instalments_not_open' using errcode = 'P0001';
  end if;
  pol := private.instalment_policy();
  v_parts := (pol ->> 'parts')::integer;
  -- the screen names the number of parts it showed; a stale screen is refused, not silently given a different plan
  if p_parts is distinct from v_parts then raise exception 'instalment_schedule_invalid' using errcode = 'P0001'; end if;
  if jsonb_array_length(pol -> 'due_offsets_days') <> v_parts or (pol -> 'due_offsets_days' ->> 0)::integer <> 0 then
    raise exception 'instalment_schedule_invalid' using errcode = 'P0001';
  end if;

  select * into it from public.catalog_items where organisation_id = pr.organisation_id and code = p_code;
  if not found or it.kind <> 'membership' or it.duration_days is null then raise exception 'instalment_not_available' using errcode = 'P0001'; end if;
  -- the last part must fall inside the access it pays for, with its grace
  if (pol -> 'due_offsets_days' ->> (v_parts - 1))::integer + (pol ->> 'grace_days')::integer >= it.duration_days then
    raise exception 'instalment_schedule_invalid' using errcode = 'P0001';
  end if;

  -- the ordinary order machinery decides everything else (module, price, capacity, already a member, too many open orders). It runs in this
  -- same transaction, so refusing the order below rolls it back too.
  r := public.create_order(p_code, p_client_key);
  if (r ->> 'order_id') is null then return r; end if;
  select * into o from public.orders where id = (r ->> 'order_id')::uuid;
  -- a plan is for the buyer, at the full list price: no sponsor share, no code, no points, not for someone else
  if o.amount_kobo <= 0 or o.sponsor_share_kobo <> 0 or o.discount_kobo <> 0 or o.points_applied <> 0 or o.beneficiary_patient_id <> o.buyer_profile_id
     or o.amount_kobo <> coalesce(o.list_amount_kobo, o.amount_kobo) or o.state <> 'created' then
    raise exception 'instalment_not_available' using errcode = 'P0001';
  end if;

  insert into public.order_instalment_plans (id, organisation_id, order_id, patient_id, parts, price_kobo, schedule, schedule_version, is_test)
  values (pl, o.organisation_id, o.id, o.beneficiary_patient_id, v_parts, o.amount_kobo, pol,
          coalesce((select version from public.instalment_policy_config where is_active), 0), o.is_test);
  -- equal parts; the leftover kobo go on the FIRST part, so the parts add up to the price exactly
  v_base := o.amount_kobo / v_parts;
  v_rem := o.amount_kobo - v_base * v_parts;
  for v_seq in 1 .. v_parts loop
    insert into public.order_instalments (organisation_id, plan_id, order_id, seq, amount_kobo, is_test)
    values (o.organisation_id, pl, o.id, v_seq, v_base + case when v_seq = 1 then v_rem else 0 end, o.is_test)
    returning id into v_inst;
    if v_seq = 1 then
      insert into public.order_instalment_attempts (reference, organisation_id, instalment_id)
      values ('thi_' || replace(gen_random_uuid()::text, '-', ''), o.organisation_id, v_inst);
    end if;
  end loop;
  -- prove the sum now as well as at commit (the trigger is the backstop)
  if (select sum(amount_kobo) from public.order_instalments where plan_id = pl) <> o.amount_kobo then
    raise exception 'instalment_sum_mismatch' using errcode = 'P0001';
  end if;
  return private.instalment_reply(o, false);
end $$;
revoke all on function public.create_instalment_order(text, uuid, integer) from public, anon;
grant execute on function public.create_instalment_order(text, uuid, integer) to authenticated;

-- The next part to pay: a Paystack reference for it. A still-fresh open attempt with a hosted page is reused; otherwise a new reference.
create function public.prepare_instalment_payment(p_instalment uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  i public.order_instalments%rowtype;
  pl public.order_instalment_plans%rowtype;
  o public.orders%rowtype;
  e public.entitlements%rowtype;
  a public.order_instalment_attempts%rowtype;
  v_ref text;
begin
  if v_uid is null then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into i from public.order_instalments where id = p_instalment;
  if not found then raise exception 'instalment_not_found' using errcode = 'P0001'; end if;
  select * into o from public.orders where id = i.order_id and buyer_profile_id = v_uid;
  if not found then raise exception 'instalment_not_found' using errcode = 'P0001'; end if;
  select * into pl from public.order_instalment_plans where id = i.plan_id;
  -- a closed order (cancelled, failed, refunded) has no part left to pay; a failed first part starts again as a new plan
  if i.state <> 'pending' or pl.state in ('cancelled', 'completed') or o.state not in ('created', 'paid') then raise exception 'instalment_closed' using errcode = 'P0001'; end if;
  if exists (select 1 from public.order_instalments x where x.plan_id = i.plan_id and x.state = 'pending' and x.seq < i.seq) then
    raise exception 'pay_earlier_part_first' using errcode = 'P0001';
  end if;
  if i.seq > 1 then
    select * into e from public.entitlements where order_id = o.id;
    if e.ends_at is null or e.ends_at <= now() then raise exception 'instalment_plan_ended' using errcode = 'P0001'; end if;
  end if;
  select * into a from public.order_instalment_attempts
   where instalment_id = i.id and state = 'open' and checkout_url is not null and created_at > now() - interval '30 minutes'
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('instalment_id', i.id, 'order_id', o.id, 'seq', i.seq, 'reference', a.reference, 'amount_kobo', i.amount_kobo,
                              'checkout_url', a.checkout_url);
  end if;
  v_ref := 'thi_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.order_instalment_attempts (reference, organisation_id, instalment_id) values (v_ref, i.organisation_id, i.id);
  return jsonb_build_object('instalment_id', i.id, 'order_id', o.id, 'seq', i.seq, 'reference', v_ref, 'amount_kobo', i.amount_kobo, 'checkout_url', null);
end $$;
revoke all on function public.prepare_instalment_payment(uuid) from public, anon;
grant execute on function public.prepare_instalment_payment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Recording a part payment (reached only through record_order_payment)
-- ---------------------------------------------------------------------------
create function private.record_instalment_mismatch(o public.orders, p_ref text, p_reason text, p_amount bigint, p_fee bigint, p_total bigint,
                                                    p_source text, p_event_key text, p_raw jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.payments (organisation_id, order_id, provider_reference, amount_kobo, fee_kobo, total_kobo, status, mismatch_reason, source, event_key, raw, is_test)
  values (o.organisation_id, o.id, p_ref, greatest(coalesce(p_amount, 0), 0), greatest(coalesce(p_fee, 0), 0), greatest(coalesce(p_total, 0), 0),
          'mismatch', p_reason, p_source, p_event_key, coalesce(p_raw, '{}'), o.is_test)
  on conflict (provider, provider_reference, mismatch_reason, amount_kobo, total_kobo) where status = 'mismatch' do nothing;
  perform private.order_incident(o.organisation_id, 'order-mismatch:' || o.id, 'Payment did not match its order',
    'Paystack reported a part payment (' || p_ref || ') whose ' || p_reason || ' differs from what order ' || o.id || ' expects. It was NOT counted. If money was taken twice or after the plan closed, a refund is due: a person must check the Paystack dashboard.');
  return jsonb_build_object('result', 'mismatch', 'reason', p_reason, 'order_id', o.id);
end $$;
revoke all on function private.record_instalment_mismatch(public.orders, text, text, bigint, bigint, bigint, text, text, jsonb) from public, anon, authenticated;

-- Returns NULL when the reference is not a part's (the caller then takes the ordinary order path).
create function private.record_instalment_payment(p_ref text, p_amount bigint, p_fee bigint, p_total bigint, p_currency text, p_status text,
                                                   p_source text, p_event_key text, p_paid_at timestamptz, p_raw jsonb, p_processor_fee bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_inst uuid;
  i public.order_instalments%rowtype;
  pl public.order_instalment_plans%rowtype;
  o public.orders%rowtype;
  it public.catalog_items%rowtype;
  ent public.entitlements%rowtype;
  v_reason text;
  v_pay uuid;
  v_start timestamptz := coalesce(p_paid_at, now());
  v_offsets jsonb;
  v_grace integer;
  v_ent_new uuid;
  v_restored boolean := false;
begin
  select instalment_id into v_inst from public.order_instalment_attempts where reference = p_ref;
  if not found then return null; end if;

  -- one lock order everywhere: plan, then part, then order
  select * into i from public.order_instalments where id = v_inst;
  select * into pl from public.order_instalment_plans where id = i.plan_id for update;
  select * into i from public.order_instalments where id = v_inst for update;
  select * into o from public.orders where id = pl.order_id for update;

  if p_status is distinct from 'success' then return jsonb_build_object('result', 'not_paid', 'order_id', o.id); end if;
  if exists (select 1 from public.payments where provider = 'paystack' and provider_reference = p_ref and status = 'success') then
    return jsonb_build_object('result', 'replay', 'order_id', o.id);
  end if;

  v_reason := case
    when p_currency is distinct from 'NGN' then 'currency'
    when p_amount is distinct from i.amount_kobo then 'amount'
    when p_fee is null or p_fee < 0 or p_total is distinct from p_amount + p_fee then 'fee'
    when p_processor_fee is not null and p_fee > p_processor_fee then 'fee'
    else null end;
  if v_reason is null then
    -- a part is counted once. A second charge for a part that is already paid, or for a plan that was closed, is money we must give back: a
    -- visible mismatch and an incident, never a quiet second credit.
    if i.state = 'paid' then v_reason := 'duplicate_part';
    elsif i.state = 'cancelled' and not (i.seq = 1 and o.state in ('created', 'failed', 'cancelled')) then v_reason := 'instalment_closed';
    elsif o.state = 'refunded' then v_reason := 'instalment_closed'; end if;
  end if;
  if v_reason is not null then
    return private.record_instalment_mismatch(o, p_ref, v_reason, p_amount, p_fee, p_total, p_source, p_event_key, p_raw);
  end if;

  insert into public.payments (organisation_id, order_id, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, event_key, raw, verified_at, is_test)
  values (o.organisation_id, o.id, p_ref, p_amount, p_fee, p_total, 'success', p_source, p_event_key, coalesce(p_raw, '{}'), now(), o.is_test)
  on conflict (provider, provider_reference) where status = 'success' do nothing
  returning id into v_pay;
  if v_pay is null then return jsonb_build_object('result', 'replay', 'order_id', o.id); end if;

  update public.order_instalment_attempts set state = 'paid' where reference = p_ref;
  update public.order_instalment_attempts set state = 'closed' where instalment_id = i.id and state = 'open' and reference <> p_ref;
  -- a verified late first payment on a plan that was closed: the part is reopened first (cancelled cannot go straight to paid)
  if i.state = 'cancelled' then update public.order_instalments set state = 'pending' where id = i.id; end if;
  update public.order_instalments set state = 'paid', paid_at = v_start, payment_id = v_pay where id = i.id;

  select * into it from public.catalog_items where id = o.catalog_item_id;
  v_offsets := pl.schedule -> 'due_offsets_days';
  v_grace := coalesce((pl.schedule ->> 'grace_days')::integer, 5);

  if i.seq = 1 then
    -- The first part: the order is paid, access starts now, the 365 days run from here, and every other part gets its due date.
    if o.state in ('failed', 'cancelled') then
      perform private.order_incident(o.organisation_id, 'order-late-payment:' || o.id, 'A payment arrived for a closed order',
        'Order ' || o.id || ' was ' || o.state || ' when a verified first-part payment arrived. It was honoured as paid.');
    end if;
    if pl.state = 'cancelled' then
      update public.order_instalments set state = 'pending' where plan_id = pl.id and state = 'cancelled' and id <> i.id;
    end if;
    if o.state in ('created', 'failed', 'cancelled') then
      update public.orders set state = 'paid', paid_at = v_start, fee_kobo = p_fee, total_kobo = o.amount_kobo + p_fee, failure_reason = null where id = o.id;
    end if;
    update public.order_instalment_plans set state = 'active', first_paid_at = v_start where id = pl.id;
    update public.order_instalments set due_at = v_start + make_interval(days => (v_offsets ->> (seq - 1))::integer) where plan_id = pl.id;

    insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, is_test, acceptance)
    values (o.organisation_id, o.beneficiary_patient_id, o.id, it.kind, v_start, v_start + make_interval(days => it.duration_days), it.uses, o.is_test, 'not_needed')
    on conflict (order_id) do nothing
    returning id into v_ent_new;
    if v_ent_new is not null then
      update public.patient_memberships set state = 'ended', ended_at = now(), end_reason = 'Lapsed on its end date, closed automatically'
       where patient_id = o.beneficiary_patient_id and state = 'active' and ends_at is not null and ends_at <= now();
      if exists (select 1 from public.patient_memberships where patient_id = o.beneficiary_patient_id and state = 'active') then
        update public.patient_memberships set ends_at = greatest(ends_at, v_start) + make_interval(days => it.duration_days)
         where patient_id = o.beneficiary_patient_id and state = 'active' and ends_at is not null;
        perform private.order_incident(o.organisation_id, 'order-membership-overlap:' || o.id, 'A membership was paid for by someone who already had one',
          'Order ' || o.id || ' was paid while the patient already had an active membership. A dated one was extended by the paid period; check whether a refund is due.');
      else
        insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test)
        values (o.organisation_id, o.beneficiary_patient_id, 'purchase', v_start, v_start + make_interval(days => it.duration_days), o.is_test);
      end if;
      if it.grants_lead and not exists (select 1 from private.lead_candidates(o.beneficiary_patient_id, '{}', true)) then
        perform private.order_incident(o.organisation_id, 'order-no-lead-slot:' || o.id, 'A paid order has no lead clinician slot',
          'Order ' || o.id || ' was paid but no lead clinician has a free slot. Arrange a lead for this patient.');
      end if;
      perform private.emit_domain_event('order.paid', o.organisation_id,
        -- care_pack mirrors the ordinary path (an item that grants a lead clinician makes S18 assign one), so a Member who pays in parts gets the
        -- same lead clinician as one who pays in full; access is as normal while the plan is not lapsed (OQ-716)
        jsonb_build_object('order_id', o.id, 'care_pack', it.grants_lead, 'gift_pending', false, 'kind', it.kind, 'code', it.code, 'instalments', true),
        'order:' || o.id, o.beneficiary_patient_id, 'order', o.id);
    end if;
  else
    update public.orders set fee_kobo = coalesce(fee_kobo, 0) + p_fee, total_kobo = amount_kobo + coalesce(fee_kobo, 0) + p_fee where id = o.id;
    if pl.state = 'lapsed' then
      -- paying the overdue part restores access, once nothing is left overdue beyond its grace
      if not exists (select 1 from public.order_instalments x where x.plan_id = pl.id and x.state = 'pending' and x.due_at + make_interval(days => v_grace) < now()) then
        select * into ent from public.entitlements where order_id = o.id for update;
        if ent.id is not null and ent.state = 'revoked' and ent.ends_at > now() and pl.lapse_revoked then
          if exists (select 1 from public.patient_memberships where patient_id = o.beneficiary_patient_id and state = 'active') then
            perform private.order_incident(o.organisation_id, 'instalment-restore-conflict:' || pl.id, 'A lapsed plan was paid while a newer membership is active',
              'Plan ' || pl.id || ' was paid to date but the patient already has another active membership, so access was not restored twice. Decide whether to refund the parts paid.');
          else
            update public.entitlements set state = 'active' where id = ent.id;
            insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test)
            values (o.organisation_id, o.beneficiary_patient_id, 'purchase', now(), ent.ends_at, o.is_test);
            update public.order_instalment_plans set state = 'active', restored_at = now() where id = pl.id;
            v_restored := true;
          end if;
        end if;
      end if;
    end if;
  end if;

  if not exists (select 1 from public.order_instalments where plan_id = pl.id and state = 'pending')
     and exists (select 1 from public.order_instalment_plans where id = pl.id and state in ('active', 'lapsed')) then
    update public.order_instalment_plans set state = 'completed' where id = pl.id;
  end if;

  perform private.post_instalment_safely(v_pay);
  if v_restored then
    begin
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values (o.organisation_id, o.beneficiary_patient_id, private.patient_reminder_channel(o.beneficiary_patient_id), 'pending', 'instalment_restored', jsonb_build_object('plan_id', pl.id));
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (o.organisation_id, 'instalment.notify_error', 'order_instalment_plan', pl.id, jsonb_build_object('step', 'restored', 'error', sqlerrm));
    end;
  end if;
  return jsonb_build_object('result', 'paid', 'order_id', o.id, 'instalment_id', i.id, 'seq', i.seq, 'restored', v_restored);
end $$;
revoke all on function private.record_instalment_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb, bigint) from public, anon, authenticated;

-- The one entry point: the definition read from the live project, with one new first step.
create or replace function public.record_order_payment(p_reference text, p_amount_kobo bigint, p_fee_kobo bigint, p_total_kobo bigint, p_currency text, p_status text,
                                                       p_source text, p_event_key text default null, p_paid_at timestamptz default null, p_raw jsonb default '{}'::jsonb,
                                                       p_processor_fee_kobo bigint default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders%rowtype;
  it public.catalog_items%rowtype;
  v_reason text;
  v_ent uuid;
  v_start timestamptz := coalesce(p_paid_at, now());
  v_part jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  -- S25b: a reference that belongs to one part of a pay-in-parts plan is recorded by the plan code. NULL means "not a part".
  v_part := private.record_instalment_payment(p_reference, p_amount_kobo, p_fee_kobo, p_total_kobo, p_currency, p_status, p_source, p_event_key, p_paid_at, p_raw, p_processor_fee_kobo);
  if v_part is not null then return v_part; end if;

  select * into o from public.orders where paystack_reference = p_reference for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;

  if p_status is distinct from 'success' then return jsonb_build_object('result', 'not_paid', 'order_id', o.id); end if;
  -- S25b: a plan order is paid only through its parts. A charge on the order's own reference (it was never offered to Paystack) is money to give
  -- back, never a full-price payment: it is a visible mismatch plus an incident, not a paid order with no ledger entry.
  if exists (select 1 from public.order_instalment_plans where order_id = o.id) then
    return private.record_instalment_mismatch(o, p_reference, 'plan_order_reference', p_amount_kobo, p_fee_kobo, p_total_kobo, p_source, p_event_key, p_raw);
  end if;
  if o.state in ('paid', 'refunded') and exists (select 1 from public.payments where provider = 'paystack' and provider_reference = p_reference and status = 'success') then
    return jsonb_build_object('result', 'replay', 'order_id', o.id);
  end if;

  v_reason := case
    when p_currency is distinct from 'NGN' then 'currency'
    when p_amount_kobo is distinct from o.amount_kobo then 'amount'
    when p_fee_kobo is null or p_fee_kobo < 0 or p_total_kobo is distinct from p_amount_kobo + p_fee_kobo then 'fee'
    when p_processor_fee_kobo is not null and p_fee_kobo > p_processor_fee_kobo then 'fee'
    else null end;
  if v_reason is not null then
    return private.record_order_mismatch(o, v_reason, p_amount_kobo, p_fee_kobo, p_total_kobo, p_source, p_event_key, p_raw);
  end if;

  insert into public.payments (organisation_id, order_id, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, event_key, raw, verified_at, is_test)
  values (o.organisation_id, o.id, p_reference, p_amount_kobo, p_fee_kobo, p_total_kobo, 'success', p_source, p_event_key, coalesce(p_raw, '{}'), now(), o.is_test)
  on conflict (provider, provider_reference) where status = 'success' do nothing;

  if o.state in ('created', 'failed', 'cancelled') then
    update public.orders set state = 'paid', paid_at = v_start, fee_kobo = p_fee_kobo, total_kobo = p_total_kobo, failure_reason = null where id = o.id;
    if o.state in ('failed', 'cancelled') then
      perform private.order_incident(o.organisation_id, 'order-late-payment:' || o.id, 'A payment arrived for a closed order',
        'Order ' || o.id || ' was ' || o.state || ' when a verified payment arrived. It was honoured as paid.');
    end if;
  end if;

  select * into it from public.catalog_items where id = o.catalog_item_id;
  insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, is_test, acceptance)
  values (o.organisation_id, o.beneficiary_patient_id, o.id,
          case it.kind when 'consultation' then 'consultation_credit' else it.kind end, v_start,
          case when it.duration_days is not null then v_start + make_interval(days => it.duration_days) end,
          it.uses, o.is_test, case when (o.buyer_profile_id <> o.beneficiary_patient_id and it.grants_lead) then 'pending' else 'not_needed' end)
  on conflict (order_id) do nothing
  returning id into v_ent;

  if v_ent is not null and it.kind = 'membership' and not (o.buyer_profile_id <> o.beneficiary_patient_id and it.grants_lead) then
    update public.patient_memberships set state = 'ended', ended_at = now(), end_reason = 'Lapsed on its end date, closed automatically'
     where patient_id = o.beneficiary_patient_id and state = 'active' and ends_at is not null and ends_at <= now();
    if exists (select 1 from public.patient_memberships where patient_id = o.beneficiary_patient_id and state = 'active') then
      update public.patient_memberships
         set ends_at = greatest(ends_at, v_start) + make_interval(days => it.duration_days)
       where patient_id = o.beneficiary_patient_id and state = 'active' and ends_at is not null;
      perform private.order_incident(o.organisation_id, 'order-membership-overlap:' || o.id, 'A membership was paid for by someone who already had one',
        'Order ' || o.id || ' was paid while the patient already had an active membership. A dated one was extended by the paid period; check whether a refund is due.');
    else
      insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test)
      values (o.organisation_id, o.beneficiary_patient_id, 'purchase', v_start, v_start + make_interval(days => it.duration_days), o.is_test);
    end if;
  end if;

  if v_ent is not null and it.grants_lead and not (o.buyer_profile_id <> o.beneficiary_patient_id and it.grants_lead) and not exists (select 1 from private.lead_candidates(o.beneficiary_patient_id, '{}', true)) then
    perform private.order_incident(o.organisation_id, 'order-no-lead-slot:' || o.id, 'A paid order has no lead clinician slot',
      'Order ' || o.id || ' was paid but no lead clinician has a free slot. Arrange a lead for this patient.');
  end if;

  perform private.emit_domain_event('order.paid', o.organisation_id,
    jsonb_build_object('order_id', o.id, 'care_pack', it.grants_lead and not (o.buyer_profile_id <> o.beneficiary_patient_id and it.grants_lead), 'gift_pending', (o.buyer_profile_id <> o.beneficiary_patient_id and it.grants_lead), 'kind', it.kind, 'code', it.code),
    'order:' || o.id, o.beneficiary_patient_id, 'order', o.id);

  if v_ent is not null then perform private.post_order_safely(o.id); end if;

  return jsonb_build_object('result', case when v_ent is null then 'replay' else 'paid' end, 'order_id', o.id, 'entitlement_id', v_ent);
end $$;

-- ---------------------------------------------------------------------------
-- 8. The reference-based helpers learn about part references
-- ---------------------------------------------------------------------------
create or replace function public.flag_order_payment_mismatch(p_reference text, p_reason text, p_amount_kobo bigint, p_total_kobo bigint, p_source text,
                                                              p_event_key text default null, p_fee_kobo bigint default 0, p_raw jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare o public.orders%rowtype; v_inst uuid; v_att text;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select instalment_id, state into v_inst, v_att from public.order_instalment_attempts where reference = p_reference;
  if found then
    select o2.* into o from public.orders o2 join public.order_instalments i on i.order_id = o2.id where i.id = v_inst for update of o2;
    -- a reference already recorded as paid is a replay, not a new problem (the same rule the ordinary path applies to a paid order)
    if v_att = 'paid' then return jsonb_build_object('result', 'replay', 'order_id', o.id); end if;
    return private.record_instalment_mismatch(o, p_reference, left(coalesce(p_reason, 'unknown'), 40), p_amount_kobo, greatest(coalesce(p_fee_kobo, 0), 0), p_total_kobo, p_source, p_event_key, coalesce(p_raw, '{}'::jsonb));
  end if;
  select * into o from public.orders where paystack_reference = p_reference for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if o.state in ('paid', 'refunded') then return jsonb_build_object('result', 'replay', 'order_id', o.id); end if;
  return private.record_order_mismatch(o, left(coalesce(p_reason, 'unknown'), 40), p_amount_kobo, greatest(coalesce(p_fee_kobo, 0), 0), p_total_kobo, p_source, p_event_key, coalesce(p_raw, '{}'::jsonb));
end $$;

-- The return page reads an order by the reference Paystack sent back. For a part, "state" is the PART's state, so a verify of part 2 is not
-- short-circuited by the order already being paid.
create or replace function public.order_for_checkout(p_reference text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare o public.orders%rowtype; it public.catalog_items%rowtype; i public.order_instalments%rowtype;
begin
  select i2.* into i from public.order_instalments i2 join public.order_instalment_attempts a on a.instalment_id = i2.id where a.reference = p_reference;
  if found then
    select * into o from public.orders where id = i.order_id and (buyer_profile_id = (select auth.uid()) or beneficiary_patient_id = (select auth.uid()));
    if not found then return null; end if;
    select * into it from public.catalog_items where id = o.catalog_item_id;
    return jsonb_build_object('order_id', o.id, 'reference', p_reference, 'state', case i.state when 'paid' then 'paid' when 'cancelled' then 'cancelled' else 'created' end,
      'amount_kobo', i.amount_kobo, 'fee_kobo', (select p.fee_kobo from public.payments p where p.id = i.payment_id), 'total_kobo', (select p.total_kobo from public.payments p where p.id = i.payment_id),
      'code', it.code, 'kind', it.kind, 'name_key', it.name_key, 'beneficiary_patient_id', o.beneficiary_patient_id, 'paid_at', i.paid_at, 'instalment_seq', i.seq);
  end if;
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
  update public.order_instalment_attempts set checkout_url = p_url where reference = p_reference and state = 'open';
  get diagnostics n = row_count;
  if n = 1 then return true; end if;
  update public.orders set checkout_url = p_url where paystack_reference = p_reference and state = 'created';
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- The sweeper's list: ordinary unpaid orders as before (a plan order's own reference is never sent to Paystack, so it is left out), plus
-- every open part attempt.
create or replace function public.orders_needing_reconcile(p_limit integer default 50)
returns table(reference text, order_id uuid, expired boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  return query
    select x.reference, x.order_id, x.expired from (
      select o.paystack_reference as reference, o.id as order_id, o.expires_at < now() as expired, o.created_at as at
        from public.orders o
       where o.state = 'created' and o.created_at < now() - interval '2 minutes' and o.created_at > now() - interval '3 days'
         and not exists (select 1 from public.order_instalment_plans pl where pl.order_id = o.id)
      union all
      select a.reference, i.order_id,
             case when i.seq = 1 and o.state = 'created' then o.expires_at < now() else a.created_at < now() - interval '1 day' end, a.created_at
        from public.order_instalment_attempts a
        join public.order_instalments i on i.id = a.instalment_id
        join public.orders o on o.id = i.order_id
       where a.state = 'open' and i.state = 'pending' and a.created_at < now() - interval '2 minutes' and a.created_at > now() - interval '3 days'
    ) x order by x.at limit least(greatest(p_limit, 1), 200);
end $$;

create or replace function public.close_unpaid_order(p_reference text, p_reason text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n integer; a public.order_instalment_attempts%rowtype; i public.order_instalments%rowtype; o public.orders%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into a from public.order_instalment_attempts where reference = p_reference;
  if found then
    update public.order_instalment_attempts set state = 'closed' where reference = p_reference and state = 'open';
    get diagnostics n = row_count;
    select * into i from public.order_instalments where id = a.instalment_id;
    -- an abandoned or failed FIRST part closes the order AND its plan as an ordinary order is closed (the patient starts again with a new
    -- plan; a later verified payment on this one still revives it); a later part only loses the attempt, because the plan itself is still running
    if i.seq = 1 and i.state = 'pending' and not exists (select 1 from public.order_instalment_attempts x where x.instalment_id = i.id and x.state = 'open') then
      -- the same lock order as a part payment: plan first, then the order
      perform 1 from public.order_instalment_plans where order_id = i.order_id for update;
      select * into o from public.orders where id = i.order_id for update;
      if o.state = 'created' then
        update public.orders set state = case when p_reason = 'expired' then 'cancelled' else 'failed' end,
               cancelled_at = case when p_reason = 'expired' then now() end, failure_reason = left(p_reason, 200) where id = o.id;
        update public.order_instalment_plans set state = 'cancelled' where order_id = o.id and state = 'awaiting_first';
        update public.order_instalments set state = 'cancelled' where order_id = o.id and state = 'pending';
      end if;
    end if;
    return n = 1;
  end if;
  update public.orders set state = case when p_reason = 'expired' then 'cancelled' else 'failed' end,
         cancelled_at = case when p_reason = 'expired' then now() end, failure_reason = left(p_reason, 200)
   where paystack_reference = p_reference and state = 'created';
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- A patient who cancels an unpaid plan order cancels the plan and its parts too (otherwise the plan would still show a pay button).
create or replace function public.cancel_order(p_order uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  -- the same lock order as a part payment: plan first, then the order
  perform 1 from public.order_instalment_plans where order_id = p_order for update;
  update public.orders set state = 'cancelled', cancelled_at = now()
   where id = p_order and buyer_profile_id = (select auth.uid()) and state = 'created';
  get diagnostics n = row_count;
  if n = 1 then
    update public.order_instalment_plans set state = 'cancelled' where order_id = p_order and state = 'awaiting_first';
    update public.order_instalments set state = 'cancelled' where order_id = p_order and state = 'pending';
    update public.order_instalment_attempts set state = 'closed'
     where state = 'open' and instalment_id in (select id from public.order_instalments where order_id = p_order);
  end if;
  return n = 1;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Refund request and decision, aware of plans
-- ---------------------------------------------------------------------------
create or replace function public.request_order_refund(p_order uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  o public.orders%rowtype;
  v_refund uuid;
  v_member boolean;
  v_days integer;
  v_gid uuid := gen_random_uuid();
  pay record;
  v_first boolean := true;
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

  if exists (select 1 from public.order_instalment_plans where order_id = o.id) then
    -- a partly paid order: give back what was paid, part by part, each against its own charge; the unpaid parts are simply never charged
    -- the FIRST payment's row is the group's voice (id = group id) and is inserted LAST, so the one message the patient gets, which fires on
    -- that row, already sees the whole amount.
    begin
      for pay in select id, amount_kobo from public.payments where order_id = o.id and status = 'success' order by created_at, id offset 1 loop
        insert into public.refunds (organisation_id, order_id, amount_kobo, reason, requested_by, is_test, payment_id, refund_group)
        values (o.organisation_id, o.id, pay.amount_kobo, p_reason, v_uid, o.is_test, pay.id, v_gid);
        v_first := false;
      end loop;
      for pay in select id, amount_kobo from public.payments where order_id = o.id and status = 'success' order by created_at, id limit 1 loop
        insert into public.refunds (id, organisation_id, order_id, amount_kobo, reason, requested_by, is_test, payment_id, refund_group)
        values (v_gid, o.organisation_id, o.id, pay.amount_kobo, p_reason, v_uid, o.is_test, pay.id, v_gid);
        v_first := false;
      end loop;
    exception when unique_violation then
      return jsonb_build_object('result', 'already_requested');
    end;
    if v_first then return jsonb_build_object('result', 'order_not_paid', 'state', o.state); end if;
    return jsonb_build_object('result', 'requested', 'refund_id', v_gid,
                              'decision_sla_days', (private.entitlement_policy('refund_rules') ->> 'decision_sla_days')::integer);
  end if;

  begin
    insert into public.refunds (organisation_id, order_id, amount_kobo, reason, requested_by, is_test)
    values (o.organisation_id, o.id, o.amount_kobo, p_reason, v_uid, o.is_test)
    returning id into v_refund;
  exception when unique_violation then
    return jsonb_build_object('result', 'already_requested');
  end;
  return jsonb_build_object('result', 'requested', 'refund_id', v_refund,
                            'decision_sla_days', (private.entitlement_policy('refund_rules') ->> 'decision_sla_days')::integer);
end $$;
revoke all on function public.request_order_refund(uuid, text) from public, anon;
grant execute on function public.request_order_refund(uuid, text) to authenticated;

create or replace function public.decide_order_refund(p_refund uuid, p_approved boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r public.refunds%rowtype;
  o public.orders%rowtype;
  e public.entitlements%rowtype;
  pl public.order_instalment_plans%rowtype;
  pay record;
  m record;
  v_ended boolean := false;
  v_total bigint;
begin
  if not private.is_admin() then raise exception 'refund_not_authorised' using errcode = '42501'; end if;
  select * into r from public.refunds where id = p_refund for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.state <> 'pending' then return jsonb_build_object('result', 'already_decided', 'state', r.state); end if;
  if not p_approved then
    if char_length(btrim(coalesce(p_note, ''))) < 5 then return jsonb_build_object('result', 'reason_needed'); end if;
    update public.refunds set state = 'rejected', decided_by = v_uid, decided_at = now(), decision_note = btrim(p_note)
     where (id = p_refund or (r.refund_group is not null and refund_group = r.refund_group)) and state = 'pending';
    return jsonb_build_object('result', 'rejected', 'refund_id', p_refund);
  end if;
  -- plan first (the same lock order as a part payment: plan, then order), so a payment cannot slip in between the decision and the cancel
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
  update public.refunds set state = 'approved', decided_by = v_uid, decided_at = now(), decision_note = p_note
   where (id = p_refund or (r.refund_group is not null and refund_group = r.refund_group)) and state = 'pending';
  if pl.id is not null then
    update public.order_instalments set state = 'cancelled' where plan_id = pl.id and state = 'pending';
    update public.order_instalment_attempts set state = 'closed'
     where state = 'open' and instalment_id in (select id from public.order_instalments where plan_id = pl.id);
    if pl.state in ('awaiting_first', 'active', 'lapsed') then
      update public.order_instalment_plans set state = 'cancelled' where id = pl.id;
    end if;
  end if;
  select * into o from public.orders where id = r.order_id;
  select * into e from public.entitlements where order_id = r.order_id and state = 'active';
  if e.id is not null then
    update public.entitlements set state = 'revoked' where id = e.id;
  end if;
  if o.state = 'paid' then
    update public.orders set state = 'refunded' where id = o.id;
  end if;
  if e.id is not null then
    for m in select id from public.patient_memberships
              where patient_id = o.beneficiary_patient_id and state = 'active' and source in ('purchase', 'voucher') loop
      v_ended := private.end_membership_now(m.id, v_uid, 'Membership refunded (refund ' || p_refund || ')') or v_ended;
    end loop;
  end if;
  select coalesce(sum(amount_kobo), 0) into v_total from public.refunds
   where (id = p_refund or (r.refund_group is not null and refund_group = r.refund_group)) and state in ('approved', 'processing', 'completed');
  return jsonb_build_object('result', 'approved', 'refund_id', p_refund, 'order_id', o.id,
                            'entitlement_revoked', e.id is not null, 'membership_ended', v_ended, 'amount_kobo', v_total,
                            'paystack_reference', o.paystack_reference);
end $$;
revoke all on function public.decide_order_refund(uuid, boolean, text) from public, anon;
grant execute on function public.decide_order_refund(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. The patient's and the admin's view
-- ---------------------------------------------------------------------------
create function public.my_instalment_plans() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'plan_id', pl.id, 'order_id', pl.order_id, 'state', pl.state, 'parts', pl.parts, 'price_kobo', pl.price_kobo,
    'paid_kobo', coalesce((select sum(i.amount_kobo) from public.order_instalments i where i.plan_id = pl.id and i.state = 'paid'), 0),
    'grace_days', (pl.schedule ->> 'grace_days')::integer, 'first_paid_at', pl.first_paid_at, 'lapsed_at', pl.lapsed_at,
    'access_ends_at', (select e.ends_at from public.entitlements e where e.order_id = pl.order_id),
    'name_key', ci.name_key, 'is_buyer', o.buyer_profile_id = (select auth.uid()),
    'next_instalment_id', (select i.id from public.order_instalments i where i.plan_id = pl.id and i.state = 'pending' order by i.seq limit 1),
    'instalments', (select jsonb_agg(jsonb_build_object('id', i.id, 'seq', i.seq, 'amount_kobo', i.amount_kobo, 'due_at', i.due_at, 'state', i.state, 'paid_at', i.paid_at,
                      'overdue', i.state = 'pending' and i.due_at is not null and i.due_at < now()) order by i.seq)
                      from public.order_instalments i where i.plan_id = pl.id)) order by pl.created_at desc), '[]'::jsonb)
    from public.order_instalment_plans pl
    join public.orders o on o.id = pl.order_id
    join public.catalog_items ci on ci.id = o.catalog_item_id
   where (o.buyer_profile_id = (select auth.uid()) or o.beneficiary_patient_id = (select auth.uid()))
$$;
revoke all on function public.my_instalment_plans() from public, anon;
grant execute on function public.my_instalment_plans() to authenticated;

create function public.admin_instalment_overview() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid;
begin
  if not private.is_admin() then raise exception 'instalments_not_authorised' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = (select auth.uid());
  return jsonb_build_object(
    'module_on', coalesce((select is_enabled from public.platform_modules where key = 'membership_instalments'), false),
    'counts', coalesce((select jsonb_object_agg(state, n) from (select state, count(*) n from public.order_instalment_plans
                          where organisation_id = v_org and is_test = false group by state) c), '{}'::jsonb),
    'outstanding_kobo', coalesce((select sum(i.amount_kobo) from public.order_instalments i join public.order_instalment_plans pl on pl.id = i.plan_id
                                   where pl.organisation_id = v_org and pl.is_test = false and i.state = 'pending' and pl.state in ('active', 'lapsed')), 0),
    'overdue_kobo', coalesce((select sum(i.amount_kobo) from public.order_instalments i join public.order_instalment_plans pl on pl.id = i.plan_id
                               where pl.organisation_id = v_org and pl.is_test = false and i.state = 'pending' and pl.state in ('active', 'lapsed') and i.due_at < now()), 0),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('plan_id', pl.id, 'order_id', pl.order_id, 'state', pl.state, 'patient_name', p.full_name,
                'parts', pl.parts, 'paid_parts', (select count(*) from public.order_instalments i where i.plan_id = pl.id and i.state = 'paid'),
                'price_kobo', pl.price_kobo, 'next_due_at', (select min(i.due_at) from public.order_instalments i where i.plan_id = pl.id and i.state = 'pending'),
                'lapsed_at', pl.lapsed_at, 'first_paid_at', pl.first_paid_at) order by pl.created_at desc)
          from (select * from public.order_instalment_plans where organisation_id = v_org and is_test = false and state in ('awaiting_first', 'active', 'lapsed')
                 order by created_at desc limit 200) pl
          left join public.profiles p on p.id = pl.patient_id), '[]'::jsonb));
end $$;
revoke all on function public.admin_instalment_overview() from public, anon;
grant execute on function public.admin_instalment_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Lapse, reminders, ledger catch-up (hourly)
-- ---------------------------------------------------------------------------
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description)
values
  ('instalment_reminder', 'operational', 'important', 'patient', '{in_app,push,email}', 'immediate', 'A payment on a pay-in-parts plan is due soon or today.'),
  ('instalment_lapsed',   'operational', 'important', 'patient', '{in_app,push,email}', 'immediate', 'A payment was missed and access is paused until it is paid.'),
  ('instalment_restored', 'operational', 'important', 'patient', '{in_app,push,email}', 'immediate', 'The overdue payment arrived and access is back.')
on conflict (key) do nothing;

insert into public.notification_template_locales (template_key, locale, channel, subject, body)
values
  ('instalment_reminder', 'en', 'in_app', 'A payment is {{when}}', 'A payment of {{amount}} on your plan is {{when}} ({{due_on}}). Open the app to pay it in one tap. If it is not paid within {{grace_days}} days after the due date, your access pauses until it is.'),
  ('instalment_reminder', 'en', 'push',   'A payment is {{when}}', '{{amount}} is {{when}}. Open the app to pay it in one tap.'),
  ('instalment_reminder', 'en', 'email',  'A payment is {{when}}', E'Hi there,\n\nA payment of {{amount}} on your plan is {{when}} ({{due_on}}). You can pay it in one tap in the app. If it is not paid within {{grace_days}} days after the due date, your access pauses until it is paid. Nothing is charged to you automatically.\n\nYour care team'),
  ('instalment_lapsed', 'en', 'in_app', 'Your access is paused', 'A payment on your plan was not made in time, so your access is paused. Open the app and pay the overdue part to get it back straight away. Your records are kept.'),
  ('instalment_lapsed', 'en', 'push',   'Your access is paused', 'A payment was missed. Pay the overdue part in the app to get your access back.'),
  ('instalment_lapsed', 'en', 'email',  'Your access is paused', E'Hi there,\n\nA payment on your plan was not made in time, so your access is paused. Open the app and pay the overdue part and your access comes back straight away. Your records are kept and nothing is charged to you automatically.\n\nYour care team'),
  ('instalment_restored', 'en', 'in_app', 'Your access is back', 'Thank you. Your payment arrived and your access is back.'),
  ('instalment_restored', 'en', 'push',   'Your access is back', 'Your payment arrived and your access is back.'),
  ('instalment_restored', 'en', 'email',  'Your access is back', E'Hi there,\n\nThank you. Your payment arrived and your access is back.\n\nYour care team')
on conflict (template_key, locale, channel) do update set subject = excluded.subject, body = excluded.body;

-- Lapse: a part still unpaid after its due date plus the grace. One plan failing never stops the rest.
create function private.sweep_instalment_lapses() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  x record;
  pl public.order_instalment_plans%rowtype;
  o public.orders%rowtype;
  m record;
  v_grace integer;
  v_closed integer;
  n integer := 0;
begin
  for x in
    select distinct i.plan_id from public.order_instalments i join public.order_instalment_plans p on p.id = i.plan_id
     where p.state = 'active' and i.state = 'pending' and i.due_at is not null and i.seq > 1
       and i.due_at + make_interval(days => coalesce((p.schedule ->> 'grace_days')::integer, 5)) < now()
  loop
    begin
      select * into pl from public.order_instalment_plans where id = x.plan_id for update;
      if pl.state <> 'active' then continue; end if;
      v_grace := coalesce((pl.schedule ->> 'grace_days')::integer, 5);
      -- re-check under the lock: a payment may have just arrived
      if not exists (select 1 from public.order_instalments i where i.plan_id = pl.id and i.state = 'pending' and i.seq > 1
                        and i.due_at + make_interval(days => v_grace) < now()) then continue; end if;
      select * into o from public.orders where id = pl.order_id for update;
      update public.entitlements set state = 'revoked' where order_id = pl.order_id and state = 'active';
      get diagnostics v_closed = row_count;
      -- remember whether the lapse itself ended the entitlement: a restore reopens only that, never one ended for another reason
      update public.order_instalment_plans set state = 'lapsed', lapsed_at = now(), lapse_revoked = v_closed > 0 where id = pl.id;
      for m in select id from public.patient_memberships
                where patient_id = pl.patient_id and state = 'active' and source = 'purchase' loop
        perform private.end_membership_now(m.id, null, 'Membership paused: an instalment was not paid in time (plan ' || pl.id || ')');
      end loop;
      begin
        insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
        values (pl.organisation_id, pl.patient_id, private.patient_reminder_channel(pl.patient_id), 'pending', 'instalment_lapsed', jsonb_build_object('plan_id', pl.id));
      exception when others then
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (pl.organisation_id, 'instalment.notify_error', 'order_instalment_plan', pl.id, jsonb_build_object('step', 'lapsed', 'error', sqlerrm));
      end;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (pl.organisation_id, 'instalment.lapsed', 'order_instalment_plan', pl.id, jsonb_build_object('order_id', pl.order_id));
      n := n + 1;
    exception when others then
      perform private.order_incident((select organisation_id from public.order_instalment_plans where id = x.plan_id), 'instalment-lapse:' || x.plan_id, 'A plan could not be lapsed',
        'Plan ' || x.plan_id || ' has a payment overdue past its grace but could not be lapsed (' || left(sqlerrm, 300) || '). The next hourly run tries again.');
    end;
  end loop;
  return n;
end $$;
revoke all on function private.sweep_instalment_lapses() from public, anon, authenticated;

-- Reminders: the tightest step already entered, once per part and step (the row is claimed before the message is queued). The text names
-- no service (INV-07). The channel is private.patient_reminder_channel().
create function private.queue_instalment_reminders() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_steps integer[];
  v_step integer;
  v_claimed boolean;
  v_notif uuid;
  n integer := 0;
begin
  for r in
    select i.id, i.amount_kobo, i.due_at, p.schedule, p.id as plan_id, p.organisation_id, p.patient_id
      from public.order_instalments i join public.order_instalment_plans p on p.id = i.plan_id
     where p.state = 'active' and i.state = 'pending' and i.seq > 1 and i.due_at is not null
       and i.due_at + make_interval(days => coalesce((p.schedule ->> 'grace_days')::integer, 5)) > now()
  loop
    begin
      select array_agg(distinct d::integer order by d::integer desc) into v_steps from jsonb_array_elements_text(r.schedule -> 'reminder_days_before') d;
      -- the tightest step this part has entered (steps are longest first); none yet means it is not time
      select min(s) into v_step from unnest(coalesce(v_steps, '{3,0}'::integer[])) s where r.due_at - make_interval(days => s) <= now();
      if v_step is null then continue; end if;
      v_claimed := null;
      insert into public.order_instalment_reminders (instalment_id, step_days) values (r.id, v_step)
        on conflict do nothing returning true into v_claimed;
      if v_claimed is not true then continue; end if;
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values (r.organisation_id, r.patient_id, private.patient_reminder_channel(r.patient_id), 'pending', 'instalment_reminder',
              jsonb_build_object('instalment_id', r.id, 'step_days', v_step,
                                 'when', case when r.due_at < now() - interval '1 day' then 'overdue' when v_step = 0 then 'due today'
                                              when v_step = 1 then 'due tomorrow' else 'due in ' || v_step || ' days' end,
                                 'amount', 'NGN ' || to_char(r.amount_kobo / 100.0, 'FM999,999,999,990.00'),
                                 'due_on', to_char(r.due_at at time zone 'Africa/Lagos', 'DD Mon YYYY'),
                                 'grace_days', coalesce((r.schedule ->> 'grace_days')::integer, 5)))
      returning id into v_notif;
      update public.order_instalment_reminders set notification_id = v_notif where instalment_id = r.id and step_days = v_step;
      n := n + 1;
    exception when others then
      perform private.order_incident(r.organisation_id, 'instalment-reminder:' || r.id, 'A payment reminder could not be queued',
        'Part ' || r.id || ' could not be reminded (' || left(sqlerrm, 300) || '). Every other reminder was sent.');
    end;
  end loop;
  return n;
end $$;
revoke all on function private.queue_instalment_reminders() from public, anon, authenticated;

-- Catch-up for a part payment whose journal entry failed (a closed accounting period, say).
create function private.instalment_ledger_catch_up() returns integer
language plpgsql security definer set search_path = ''
as $$
declare x record; n integer := 0;
begin
  for x in
    select i.payment_id from public.order_instalments i join public.payments p on p.id = i.payment_id
     where i.state = 'paid' and p.is_test = false and p.created_at > now() - interval '90 days'
       and not exists (select 1 from public.finance_journal_entries j where j.source = 'payment' and j.source_ref = 'orderpart:' || i.payment_id)
     order by p.created_at desc   -- the newest first, so a few parts that keep failing (an incident is open for each) cannot crowd out new ones
     limit 200
  loop
    if private.post_instalment_safely(x.payment_id) then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function private.instalment_ledger_catch_up() from public, anon, authenticated;

create function private.instalments_hourly() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.sweep_instalment_lapses();
  perform private.queue_instalment_reminders();
  perform private.instalment_ledger_catch_up();
end $$;
revoke all on function private.instalments_hourly() from public, anon, authenticated;

select cron.schedule('instalments-hourly', '41 * * * *', $$ select private.instalments_hourly(); $$);

-- ---------------------------------------------------------------------------
-- 12. Self-check: the module is OFF, the grants are shut, the schedule is what the config says
-- ---------------------------------------------------------------------------
do $$
begin
  if coalesce((select is_enabled from public.platform_modules where key = 'membership_instalments'), true) then
    raise exception 'instalments: the module must default OFF';
  end if;
  if (private.instalment_policy() ->> 'parts')::integer <> 3 then raise exception 'instalments: unexpected shipped schedule'; end if;
  if has_function_privilege('anon', 'public.create_instalment_order(text, uuid, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.prepare_instalment_payment(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_instalment_plans()', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_instalment_overview()', 'EXECUTE')
     or has_function_privilege('anon', 'public.instalment_policy_public()', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb, bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb, bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.record_instalment_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb, bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.sweep_instalment_lapses()', 'EXECUTE') then
    raise exception 'instalments: a function is callable by the wrong role';
  end if;
  if has_table_privilege('anon', 'public.order_instalments', 'SELECT') or has_table_privilege('authenticated', 'public.order_instalments', 'INSERT')
     or has_table_privilege('authenticated', 'public.order_instalment_attempts', 'SELECT') then
    raise exception 'instalments: a table is open to the wrong role';
  end if;
end $$;
