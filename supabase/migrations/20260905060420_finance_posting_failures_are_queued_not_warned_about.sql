-- ===========================================================================
-- A finance posting that fails is currently only a Postgres warning.
--
-- WHAT WAS WRONG
--
-- Four triggers post the general-ledger entry for a payment:
--
--   private.finance_on_payment_processed
--   private.finance_on_service_purchase_payment
--   private.finance_on_voucher_payment
--   private.finance_on_sponsored_subscription_payment
--
-- Every one of them wraps private.finance_post_from_payment() in
--
--     exception when others then raise warning '...'
--
-- Swallowing the exception is the right call -- a ledger problem must never
-- stop a paid-for service activating for a patient. `raise warning` as the
-- entire record of it is not: it lands in a Postgres log nobody reads and
-- nothing on the platform ever surfaces it.
--
-- The specific way this bites: private.finance_post_journal() raises
-- `check_violation` when the accounting period is not 'open'. A webhook that
-- arrives after month-end close -- a Paystack retry, a late settlement, a
-- reconciliation replay -- therefore activates the purchase and drops the GL
-- entry, and the revenue is permanently unrecorded. Nobody finds out. There
-- are 0 non-open finance_periods on the live project today, which is exactly
-- why this has not bitten yet and exactly why it should be closed before the
-- first close rather than after it.
--
-- WHAT THIS DOES
--
-- Adds public.finance_posting_failures -- a durable queue, one row per
-- (payment transaction, trigger), with an open/resolved/ignored lifecycle
-- like payment_reconciliation_flags -- and private.finance_record_posting_
-- failure() to write to it. Each of the four triggers now records the failure
-- there and raises an in_app notification to every admin, instead of only
-- warning. The swallow itself is unchanged: the payment still lands, the
-- purchase still activates. What changes is that somebody is told.
--
-- The recorder can never itself abort a webhook: it runs inside its own
-- BEGIN/EXCEPTION and, in the worst case where even the queue insert fails,
-- degrades to the `raise warning` this replaces.
--
-- The notification is priority 'routine' on purpose. Unrecorded revenue is
-- an accounting problem needing a person today, not a clinical page needing
-- one in 40 minutes -- and as of 20260905060140 a 'critical' row would be
-- picked up by the escalation engine and hopped onto whatsapp/sms.
-- ===========================================================================

create table public.finance_posting_failures (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations (id) on delete set null,
  -- The payment whose ledger entry never posted. Cascades: if the payment
  -- record is gone there is nothing left to post.
  payment_transaction_id uuid not null references public.payment_transactions (id) on delete cascade,
  -- Which of the four posting triggers failed. Part of the unique key
  -- because more than one of them can fire for the same transaction.
  trigger_name text not null,
  -- SQLSTATE and message exactly as raised. '23514'/check_violation is the
  -- closed-accounting-period case this table was built for.
  error_code text,
  error_message text not null,
  amount_minor bigint,
  currency public.currency,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  resolved_note text,
  created_at timestamptz not null default now(),
  -- A retried webhook re-fires the same trigger for the same transaction.
  -- One row, not a pile.
  unique (payment_transaction_id, trigger_name)
);

comment on table public.finance_posting_failures is
  'Durable queue of general-ledger postings that failed. Before 2026-09-05 the four finance posting triggers recorded a failure only as `raise warning`, so a payment arriving after an accounting period closed activated the purchase and silently dropped the revenue. Written only by private.finance_record_posting_failure (SECURITY DEFINER); never inserted from application code.';

create index finance_posting_failures_open_idx
  on public.finance_posting_failures (created_at desc)
  where status = 'open';

alter table public.finance_posting_failures enable row level security;

-- Read-only to admins, no write policy at all: the recorder is SECURITY
-- DEFINER and runs as postgres, and resolving a row is a finance action that
-- should go through a checked RPC when one is built, not a direct client
-- update. Same discipline as notification_escalation_failures.
create policy finance_posting_failures_select on public.finance_posting_failures
  for select
  using (private.is_admin());

create or replace function private.finance_record_posting_failure(
  p_payment_transaction_id uuid,
  p_trigger_name text,
  p_error_code text,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_org uuid;
  v_amount bigint;
  v_currency public.currency;
begin
  begin
    select organisation_id, amount_minor, currency
      into v_org, v_amount, v_currency
      from public.payment_transactions
     where id = p_payment_transaction_id;

    insert into public.finance_posting_failures
      (organisation_id, payment_transaction_id, trigger_name, error_code, error_message,
       amount_minor, currency)
    values
      (v_org, p_payment_transaction_id, p_trigger_name, p_error_code, left(p_error_message, 2000),
       v_amount, v_currency)
    on conflict (payment_transaction_id, trigger_name) do update
      set error_code    = excluded.error_code,
          error_message = excluded.error_message,
          amount_minor  = excluded.amount_minor,
          currency      = excluded.currency,
          -- A failure that recurs after somebody closed it is open again.
          status        = 'open',
          resolved_by   = null,
          resolved_at   = null,
          created_at    = now();

    -- Tell the people who can act on it. in_app only: this is an internal
    -- accounting fact, and it carries no patient content.
    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload, content_class, priority)
    select
      v_org,
      p.id,
      'in_app',
      'finance_posting_failed',
      jsonb_build_object(
        'payment_transaction_id', p_payment_transaction_id,
        'trigger_name', p_trigger_name,
        'error_code', p_error_code,
        'error_message', left(p_error_message, 500),
        'amount_minor', v_amount,
        'currency', v_currency
      ),
      'non_clinical',
      'routine'
    from public.profiles p
    where p.role = 'admin'
      -- Do not re-notify for a failure already sitting open and already
      -- announced in the last day; a retrying webhook must not spam the bell.
      and not exists (
        select 1 from public.notifications n
         where n.template = 'finance_posting_failed'
           and n.recipient_id = p.id
           and n.payload->>'payment_transaction_id' = p_payment_transaction_id::text
           and n.payload->>'trigger_name' = p_trigger_name
           and n.created_at > now() - interval '1 day'
      );
  exception when others then
    -- Last resort only. If even the queue cannot be written we are back to
    -- where this migration started, but we are not going to take a payment
    -- webhook down over it.
    raise warning 'finance_record_posting_failure: could not record % failure for txn % (%)',
      p_trigger_name, p_payment_transaction_id, sqlerrm;
  end;
end;
$function$;

comment on function private.finance_record_posting_failure(uuid, text, text, text) is
  'Records a failed general-ledger posting in public.finance_posting_failures and alerts every admin in_app. Called from inside the four finance posting triggers'' exception handlers, so it must never raise -- it swallows its own errors down to a warning.';

-- ---------------------------------------------------------------------------
-- The four triggers. Only the exception handler changes in each.
-- ---------------------------------------------------------------------------

create or replace function private.finance_on_payment_processed()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.processed_at is not null and (tg_op = 'INSERT' or old.processed_at is null) then
    begin
      perform private.finance_post_from_payment(new.id);
    exception when others then
      perform private.finance_record_posting_failure(
        new.id, 'finance_on_payment_processed', sqlstate, sqlerrm);
    end;
  end if;
  return new;
end; $function$;

create or replace function private.finance_on_service_purchase_payment()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.event_type::text in ('charge.success', 'checkout.session.completed')
     and coalesce(new.raw_payload#>>'{data,metadata,kind}', new.raw_payload#>>'{metadata,kind}') = 'service_purchase'
  then
    begin
      perform private.finance_post_from_payment(new.id);
    exception when others then
      perform private.finance_record_posting_failure(
        new.id, 'finance_on_service_purchase_payment', sqlstate, sqlerrm);
    end;
  end if;
  return new;
end;
$function$;

create or replace function private.finance_on_voucher_payment()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.event_type::text in ('charge.success', 'checkout.session.completed')
     and coalesce(new.raw_payload#>>'{data,metadata,kind}', new.raw_payload#>>'{metadata,kind}') = 'voucher_payment'
  then
    begin
      perform private.finance_post_from_payment(new.id);
    exception when others then
      perform private.finance_record_posting_failure(
        new.id, 'finance_on_voucher_payment', sqlstate, sqlerrm);
    end;
  end if;
  return new;
end;
$function$;

create or replace function private.finance_on_sponsored_subscription_payment()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.event_type::text in ('charge.success', 'checkout.session.completed')
     and coalesce(new.raw_payload#>>'{data,metadata,kind}', new.raw_payload#>>'{metadata,kind}') = 'sponsored_subscription'
  then
    begin
      perform private.finance_post_from_payment(new.id);
    exception when others then
      perform private.finance_record_posting_failure(
        new.id, 'finance_on_sponsored_subscription_payment', sqlstate, sqlerrm);
    end;
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Assertions: "no longer only a warning" is provable, not hopeful.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
  v_missing text[] := '{}';
begin
  foreach v_fn in array array[
    'private.finance_on_payment_processed()',
    'private.finance_on_service_purchase_payment()',
    'private.finance_on_voucher_payment()',
    'private.finance_on_sponsored_subscription_payment()'
  ] loop
    if pg_get_functiondef(v_fn::regprocedure) not like '%finance_record_posting_failure%' then
      v_missing := v_missing || v_fn;
    end if;
    if pg_get_functiondef(v_fn::regprocedure) like '%raise warning%' then
      v_missing := v_missing || (v_fn || ' still only warns');
    end if;
  end loop;
  if array_length(v_missing, 1) is not null then
    raise exception 'FAIL: %', array_to_string(v_missing, ', ');
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'finance_posting_failures' and c.relrowsecurity
  ) then
    raise exception 'FAIL: finance_posting_failures exists without row level security';
  end if;

  if has_table_privilege('anon', 'public.finance_posting_failures', 'SELECT') then
    raise exception 'FAIL: anon can read finance_posting_failures';
  end if;
end $$;
