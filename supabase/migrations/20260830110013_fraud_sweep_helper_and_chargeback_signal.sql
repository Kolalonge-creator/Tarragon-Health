-- §91.17 fraud detection foundation.
--
-- payment_fraud_signals + finance_fraud_signals()/finance_resolve_fraud_signal()
-- already existed live (see the recovered 20260829001612_payment_fraud_signals.sql
-- migration — built by a concurrent session, discovered via finance_risk_flags()
-- already referencing this table before this migration ran). What was still
-- missing: any function that actually WRITES a signal (zero rows existed),
-- a signal_type for a real dispute/chargeback webhook event, and the
-- service-role-only read helper the TypeScript sweep (fraud-sweep.ts) needs
-- to resolve each payment's payer without duplicating
-- private.resolve_payment_payer's join logic in JS.

create or replace function public.payments_with_payer_for_fraud_sweep(p_from timestamptz, p_to timestamptz)
returns table (
  id uuid,
  payer_profile_id uuid,
  organisation_id uuid,
  amount_minor bigint,
  currency public.currency,
  provider public.payment_provider,
  event_type text,
  processed_at timestamptz,
  error text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select pt.id, private.resolve_payment_payer(pt), pt.organisation_id, pt.amount_minor, pt.currency,
         pt.provider, pt.event_type::text, pt.processed_at, pt.error, pt.created_at
  from public.payment_transactions pt
  where pt.created_at >= p_from and pt.created_at <= p_to;
$$;

-- No grant to authenticated/anon at all — the cron route calls this only via
-- the service-role client, which bypasses PostgREST grant checks entirely,
-- the same trust boundary every other cron route already relies on. Both
-- anon and authenticated need an explicit revoke, not just public: Supabase
-- grants EXECUTE on every new function directly to both roles via a
-- default-privileges setting independent of the PUBLIC pseudo-role.
revoke all on function public.payments_with_payer_for_fraud_sweep(timestamptz, timestamptz) from public;
revoke all on function public.payments_with_payer_for_fraud_sweep(timestamptz, timestamptz) from anon;
revoke all on function public.payments_with_payer_for_fraud_sweep(timestamptz, timestamptz) from authenticated;

alter table public.payment_fraud_signals drop constraint payment_fraud_signals_signal_type_check;
alter table public.payment_fraud_signals add constraint payment_fraud_signals_signal_type_check
  check (signal_type = any (array[
    'duplicate_transaction', 'rapid_velocity', 'refund_concentration', 'unusual_amount', 'chargeback'
  ]));

do $$
begin
  if has_function_privilege('anon', 'public.payments_with_payer_for_fraud_sweep(timestamptz, timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.payments_with_payer_for_fraud_sweep(timestamptz, timestamptz)', 'EXECUTE') then
    raise exception 'authenticated/anon must never call payments_with_payer_for_fraud_sweep — service-role only';
  end if;
end $$;
