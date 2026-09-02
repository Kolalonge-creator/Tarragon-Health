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
-- the same trust boundary every other cron route already relies on.
-- A from-scratch environment's base Supabase template also grants EXECUTE
-- directly to authenticated at CREATE FUNCTION time (not only via the
-- PUBLIC pseudo-role anon inherits through) — revoke that explicitly too.
revoke all on function public.payments_with_payer_for_fraud_sweep(timestamptz, timestamptz) from public, anon, authenticated;

alter table public.payment_fraud_signals drop constraint payment_fraud_signals_signal_type_check;
alter table public.payment_fraud_signals add constraint payment_fraud_signals_signal_type_check
  check (signal_type = any (array[
    'duplicate_transaction', 'rapid_velocity', 'refund_concentration', 'unusual_amount', 'chargeback'
  ]));

do $$
declare
  v_proacl text;
  v_anon_rolsuper bool;
  v_anon_rolbypassrls bool;
  v_authenticated_rolsuper bool;
  v_default_acl text;
begin
  select proacl::text into v_proacl from pg_proc
   where oid = 'public.payments_with_payer_for_fraud_sweep(timestamptz, timestamptz)'::regprocedure;
  select rolsuper, rolbypassrls into v_anon_rolsuper, v_anon_rolbypassrls from pg_roles where rolname = 'anon';
  select rolsuper into v_authenticated_rolsuper from pg_roles where rolname = 'authenticated';
  select string_agg(format('role=%s type=%s acl=%s', coalesce(defaclrole::regrole::text,'(none)'), defaclobjtype, defaclacl::text), ' | ')
    into v_default_acl
    from pg_default_acl
   where defaclnamespace::regnamespace::text = 'public';

  raise exception 'DIAG proacl=% anon.rolsuper=% anon.rolbypassrls=% authenticated.rolsuper=% default_acl_public=% has_priv_anon=% has_priv_authenticated=%',
    v_proacl, v_anon_rolsuper, v_anon_rolbypassrls, v_authenticated_rolsuper, v_default_acl,
    has_function_privilege('anon', 'public.payments_with_payer_for_fraud_sweep(timestamptz, timestamptz)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.payments_with_payer_for_fraud_sweep(timestamptz, timestamptz)', 'EXECUTE');
end $$;
