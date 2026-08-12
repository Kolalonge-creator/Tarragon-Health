-- Tarragon Health — automated Paystack/Stripe reconciliation, phase 1.
--
-- Until now the only cross-check against Paystack/Stripe was a human typing
-- gross/fees/net from a monthly settlement report into
-- finance_import_settlement — nothing ever asked the providers themselves
-- "does this match what you actually recorded" on an individual charge.
-- This adds a flags table the daily reconciliation sweep (Next.js cron route
-- apps/web/src/app/api/cron/reconcile-payment-providers, see vercel.json)
-- writes into via the service-role client, plus the read/write RPCs the
-- finance console needs to review and resolve what it finds. Detection only
-- — nothing here auto-remediates a mismatch; see the route's own header for
-- why.
--
-- Same deny-by-default RLS idiom as finance_settlement_matches: RLS enabled,
-- zero policies, so no role can touch the table directly — every access
-- goes through a SECURITY DEFINER RPC gated by private.is_finance(). The
-- cron route also never touches it directly for gating purposes; it uses
-- the service-role client, which bypasses RLS entirely, same as every other
-- Vercel Cron route in this codebase (wearable-sync, video-visit-refunds).

create table public.payment_reconciliation_flags (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id),
  provider public.payment_provider not null,
  flag_type text not null check (flag_type in ('missing_locally', 'amount_mismatch', 'status_mismatch')),
  provider_reference text not null,
  payment_transaction_id uuid references public.payment_transactions(id),
  local_amount_minor bigint,
  provider_amount_minor bigint,
  local_status text,
  provider_status text,
  currency public.currency,
  detail jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  resolved_note text,
  detected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- One open flag per (provider, reference, kind of problem) — a re-run of the
-- sweep that still sees the same issue updates detected_at instead of
-- piling up duplicates. A flag already resolved/ignored falls outside this
-- partial index, so a *new* occurrence of the same reference after
-- resolution opens a fresh flag rather than silently reusing a closed one.
create unique index payment_reconciliation_flags_open_unique
  on public.payment_reconciliation_flags (provider, provider_reference, flag_type)
  where status = 'open';

create index payment_reconciliation_flags_status_idx
  on public.payment_reconciliation_flags (status, detected_at desc);

alter table public.payment_reconciliation_flags enable row level security;

-- ---------------------------------------------------------------------------
-- Read RPC — mirrors finance_reconciliation_summary()'s own shape/gating.
-- ---------------------------------------------------------------------------
create or replace function public.finance_reconciliation_flags(p_status text default 'open')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_finance() then return '[]'::jsonb; end if;
  return coalesce(
    (
      select jsonb_agg(row_to_json(f) order by f.detected_at desc)
      from (
        select id, provider, flag_type, provider_reference, payment_transaction_id,
               local_amount_minor, provider_amount_minor, local_status, provider_status,
               currency, detail, status, detected_at, resolved_at, resolved_note
        from public.payment_reconciliation_flags
        where p_status is null or status = p_status
      ) f
    ),
    '[]'::jsonb
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Resolve RPC — a human marking a flag reviewed. Deliberately narrow: only
-- status/note/resolver change, never the detected facts (local/provider
-- amount, status, reference) — those stay as evidence of what was actually
-- found, matching the finance module's audit-trail discipline elsewhere.
-- ---------------------------------------------------------------------------
create or replace function public.finance_resolve_reconciliation_flag(
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

  update public.payment_reconciliation_flags
  set status = p_status,
      resolved_by = (select auth.uid()),
      resolved_at = now(),
      resolved_note = p_note
  where id = p_id and status = 'open';

  if not found then
    raise exception 'flag % not found or already resolved', p_id;
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  select organisation_id, (select auth.uid()), 'payment_reconciliation_flag.' || p_status,
         'payment_reconciliation_flags', id, jsonb_build_object('note', p_note)
  from public.payment_reconciliation_flags where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Roll open flags into the existing risk-flags strip the finance dashboard
-- already renders (apps/web/.../finance/_components/overview.tsx's "Needs
-- attention" section) — same idiom, one more key, no new UI plumbing needed
-- beyond wiring the key through.
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
    'ap_due_soon_count', (select count(*) from public.finance_bills where status='approved' and due_date is not null and due_date <= current_date + 7),
    'ap_overdue_count', (select count(*) from public.finance_bills where status='approved' and due_date is not null and due_date < current_date),
    'compliance_overdue_count', (
      select count(*) from jsonb_array_elements(public.finance_compliance_calendar(1)) x
      where x->>'status' = 'overdue')
  );
end; $$;

-- New functions carry PUBLIC=X (revoked) by default and are not covered by
-- the one-time grant sweep above them in the earlier migration — each new
-- finance_* function needs its own explicit grant, same lesson as
-- reference_supabase_function_acl_verified.
grant execute on function public.finance_reconciliation_flags(text) to authenticated;
grant execute on function public.finance_resolve_reconciliation_flag(uuid, text, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'payment_reconciliation_flags'
  ) then
    raise exception 'FAIL: payment_reconciliation_flags was not created';
  end if;

  if not (
    select relrowsecurity from pg_class
    where oid = 'public.payment_reconciliation_flags'::regclass
  ) then
    raise exception 'FAIL: payment_reconciliation_flags does not have RLS enabled';
  end if;

  if exists (
    select 1 from pg_policies where tablename = 'payment_reconciliation_flags'
  ) then
    raise exception 'FAIL: payment_reconciliation_flags should have zero policies (deny-by-default, RPC-only access)';
  end if;

  if not exists (
    select 1 from pg_proc where proname = 'finance_risk_flags' and pronamespace = 'public'::regnamespace
      and pg_get_functiondef(oid) like '%reconciliation_flags_count%'
  ) then
    raise exception 'FAIL: finance_risk_flags was not extended with reconciliation_flags_count';
  end if;

  if not has_function_privilege('authenticated', 'public.finance_reconciliation_flags(text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute finance_reconciliation_flags';
  end if;
  if not has_function_privilege('authenticated', 'public.finance_resolve_reconciliation_flag(uuid,text,text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute finance_resolve_reconciliation_flag';
  end if;

  raise notice 'PASS: payment_reconciliation_flags created, RLS deny-by-default, risk flags extended, RPCs executable by authenticated';
end $$;
