-- Tarragon Health — financial fraud controls, phase 1 (spec §25.24).
--
-- Nothing in the codebase today watches for suspicious payment *patterns* —
-- payment_reconciliation_flags (20260812023750) only catches drift between
-- our own record and what Paystack/Stripe themselves say happened. This adds
-- a second, independent detection surface: duplicate charges, one patient
-- paying unusually fast/often, a concentration of refunds on one account,
-- and a single charge far outside an organisation's normal range. Same
-- deny-by-default posture and detection-only discipline as the
-- reconciliation flags this sits next to: nothing here blocks a payment or
-- auto-reverses anything — it surfaces a signal for a human on
-- /finance/fraud to review.
--
-- The actual scan runs in TypeScript (apps/web/src/lib/finance/fraud-sweep.ts,
-- invoked by the Vercel Cron route api/cron/detect-payment-fraud and callable
-- on demand from the finance console) because the four heuristics need to
-- correlate across payment_transactions, subscriptions, video_visit_requests,
-- lab/pharmacy/referral bookings and care_voucher_payments — sources with no
-- single shared key — which is far more legible as normalised rows in
-- application code than as a multi-CTE SQL statement. This migration only
-- owns the storage + the finance-facing read/resolve surface, mirroring
-- payment_reconciliation_flags' RPC shape exactly.

create table public.payment_fraud_signals (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid references public.organisations (id) on delete set null,
  patient_id              uuid references public.profiles (id) on delete set null,
  signal_type             text not null check (signal_type in
    ('duplicate_transaction', 'rapid_velocity', 'refund_concentration', 'unusual_amount')),
  severity                text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  -- Stable identity for a specific occurrence of a signal (e.g. one patient,
  -- one day, one heuristic) — see the sweep for how each signal_type builds
  -- it. A re-run that still sees the same problem updates detected_at
  -- instead of piling up duplicates; a fresh occurrence after resolution
  -- gets a new open row, same partial-unique-index idiom as
  -- payment_reconciliation_flags_open_unique below.
  dedupe_key              text not null,
  payment_transaction_id  uuid references public.payment_transactions (id) on delete set null,
  amount_minor            bigint,
  currency                public.currency,
  detail                  jsonb not null default '{}'::jsonb,
  status                  text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  resolved_by             uuid references public.profiles (id),
  resolved_at             timestamptz,
  resolved_note           text,
  detected_at             timestamptz not null default now(),
  created_at              timestamptz not null default now()
);

create unique index payment_fraud_signals_open_unique
  on public.payment_fraud_signals (dedupe_key)
  where status = 'open';

create index payment_fraud_signals_status_idx
  on public.payment_fraud_signals (status, detected_at desc);

create index payment_fraud_signals_patient_idx
  on public.payment_fraud_signals (patient_id)
  where patient_id is not null;

alter table public.payment_fraud_signals enable row level security;
-- Deny-by-default: RLS enabled, zero policies. The sweep writes via the
-- service-role client (bypasses RLS, same as every other cron route in this
-- codebase); every other access goes through the SECURITY DEFINER RPCs
-- below, gated by private.is_finance().

-- ---------------------------------------------------------------------------
-- Read RPC — mirrors finance_reconciliation_flags()'s own shape/gating.
-- ---------------------------------------------------------------------------
create or replace function public.finance_fraud_signals(p_status text default 'open')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_finance() then return '[]'::jsonb; end if;
  return coalesce(
    (
      select jsonb_agg(row_to_json(f) order by f.detected_at desc)
      from (
        select id, organisation_id, patient_id, signal_type, severity, dedupe_key,
               payment_transaction_id, amount_minor, currency, detail, status,
               detected_at, resolved_at, resolved_note
        from public.payment_fraud_signals
        where p_status is null or status = p_status
      ) f
    ),
    '[]'::jsonb
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Resolve RPC — a human marking a signal reviewed. Deliberately narrow, same
-- as finance_resolve_reconciliation_flag: only status/note/resolver change,
-- never the detected facts.
-- ---------------------------------------------------------------------------
create or replace function public.finance_resolve_fraud_signal(
  p_id uuid,
  p_status text,
  p_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_finance() then
    raise exception 'not authorised';
  end if;
  if p_status not in ('resolved', 'ignored') then
    raise exception 'invalid status: %, must be resolved or ignored', p_status;
  end if;

  update public.payment_fraud_signals
  set status = p_status,
      resolved_by = (select auth.uid()),
      resolved_at = now(),
      resolved_note = p_note
  where id = p_id and status = 'open';

  if not found then
    raise exception 'signal % not found or already resolved', p_id;
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  select organisation_id, (select auth.uid()), 'payment_fraud_signal.' || p_status,
         'payment_fraud_signals', id, jsonb_build_object('note', p_note)
  from public.payment_fraud_signals where id = p_id;
end;
$$;

grant select, insert on public.payment_fraud_signals to service_role;

-- Revoke the default PUBLIC execute before granting to authenticated —
-- otherwise anon inherits execute through the PUBLIC pseudo-role (the
-- gotcha this codebase has hit repeatedly; see the migration-replay CI
-- job note in 20260812041044_service_role_write_actor_attribution.sql).
-- private.is_finance() already denies anon at the row level, but the
-- grant itself should not admit an unauthenticated caller in the first
-- place.
revoke all on function public.finance_fraud_signals(text) from public;
revoke all on function public.finance_resolve_fraud_signal(uuid, text, text) from public;
grant execute on function public.finance_fraud_signals(text) to authenticated;
grant execute on function public.finance_resolve_fraud_signal(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Roll open signals into the existing "Needs attention" risk-flags strip
-- (apps/web/.../finance/_components/overview.tsx) — same idiom
-- payment_reconciliation_flags used: one more key, no new dashboard plumbing
-- beyond wiring it through client-side.
-- ---------------------------------------------------------------------------
create or replace function public.finance_risk_flags()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_finance() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'pending_approvals_count', (select count(*) from public.finance_approval_requests where status='pending'),
    'aged_unreconciled_count', (
      select count(*) from public.payment_transactions pt
      where pt.processed_at is not null and coalesce(pt.amount_minor,0) > 0
        and pt.event_type::text in ('charge.success','checkout.session.completed','invoice.payment_succeeded')
        and pt.processed_at < now() - interval '7 days'
        and not exists (select 1 from public.finance_settlement_matches m where m.payment_transaction_id = pt.id)),
    'reconciliation_flags_count', (select count(*) from public.payment_reconciliation_flags where status = 'open'),
    'fraud_signals_count', (select count(*) from public.payment_fraud_signals where status = 'open'),
    'ap_due_soon_count', (select count(*) from public.finance_bills where status='approved' and due_date is not null and due_date <= current_date + 7),
    'ap_overdue_count', (select count(*) from public.finance_bills where status='approved' and due_date is not null and due_date < current_date),
    'compliance_overdue_count', (
      select count(*) from jsonb_array_elements(public.finance_compliance_calendar(1)) x
      where x->>'status' = 'overdue')
  );
end; $$;

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'payment_fraud_signals'
  ) then
    raise exception 'FAIL: payment_fraud_signals was not created';
  end if;

  if not (
    select relrowsecurity from pg_class
    where oid = 'public.payment_fraud_signals'::regclass
  ) then
    raise exception 'FAIL: payment_fraud_signals does not have RLS enabled';
  end if;

  if exists (
    select 1 from pg_policies where tablename = 'payment_fraud_signals'
  ) then
    raise exception 'FAIL: payment_fraud_signals should have zero policies (deny-by-default, RPC-only access)';
  end if;

  if not exists (
    select 1 from pg_proc where proname = 'finance_risk_flags' and pronamespace = 'public'::regnamespace
      and pg_get_functiondef(oid) like '%fraud_signals_count%'
  ) then
    raise exception 'FAIL: finance_risk_flags was not extended with fraud_signals_count';
  end if;

  if not has_function_privilege('authenticated', 'public.finance_fraud_signals(text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute finance_fraud_signals';
  end if;
  if not has_function_privilege('authenticated', 'public.finance_resolve_fraud_signal(uuid,text,text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute finance_resolve_fraud_signal';
  end if;
  if has_function_privilege('anon', 'public.finance_fraud_signals(text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute finance_fraud_signals';
  end if;
  if has_function_privilege('anon', 'public.finance_resolve_fraud_signal(uuid,text,text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute finance_resolve_fraud_signal';
  end if;

  raise notice 'PASS: payment_fraud_signals created, RLS deny-by-default, risk flags extended, RPCs executable by authenticated, denied to anon';
end $$;
