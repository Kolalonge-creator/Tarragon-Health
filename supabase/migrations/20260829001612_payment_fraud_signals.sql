-- Recovered migration file — this was applied live (schema_migrations
-- version 20260829001612) by a concurrent worktree session before this
-- branch existed, but had no committed local file, matching this project's
-- recurring "migration filename/version drift" pattern (see
-- reference_migration_filename_version_drift). Reconstructed losslessly from
-- the live table/function/index/constraint definitions via pg_get_*def()
-- introspection so this branch's migration history is self-contained and a
-- fresh `supabase db reset` doesn't come up missing this table. Content is
-- unmodified from what's live — do not "clean up" the signal_type list here
-- without checking supabase/migrations/<later>_fraud_sweep_and_chargeback_signal.sql,
-- which depends on it.
--
-- Same RLS discipline as payment_reconciliation_flags: enabled with ZERO
-- policies (fail-closed), all access via the two SECURITY DEFINER RPCs
-- below, gated by private.is_finance().

create table public.payment_fraud_signals (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations (id) on delete set null,
  patient_id uuid references public.profiles (id) on delete set null,
  signal_type text not null check (signal_type = any (array[
    'duplicate_transaction', 'rapid_velocity', 'refund_concentration', 'unusual_amount'
  ])),
  severity text not null default 'medium' check (severity = any (array['low', 'medium', 'high'])),
  dedupe_key text not null,
  payment_transaction_id uuid references public.payment_transactions (id) on delete set null,
  amount_minor bigint,
  currency public.currency,
  detail jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status = any (array['open', 'resolved', 'ignored'])),
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  resolved_note text,
  detected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.payment_fraud_signals enable row level security;

create unique index payment_fraud_signals_open_unique
  on public.payment_fraud_signals (dedupe_key) where (status = 'open');
create index payment_fraud_signals_status_idx
  on public.payment_fraud_signals (status, detected_at desc);
create index payment_fraud_signals_patient_idx
  on public.payment_fraud_signals (patient_id) where (patient_id is not null);

grant select on public.payment_fraud_signals to authenticated;

create or replace function public.finance_fraud_signals(p_status text default 'open')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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

create or replace function public.finance_resolve_fraud_signal(p_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

-- finance_risk_flags() already references payment_fraud_signals (live), so
-- no change needed here — it was updated in the same original session this
-- file recovers.
