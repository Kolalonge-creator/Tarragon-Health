-- CRITICAL, live production bug found while testing an unrelated PR against
-- the live project (koiplnmbgnqnbywhpjlf): every finance posting for a
-- booking, subscription, add_on, or service_purchase is currently failing
-- with a 42725 "function ... is not unique" error and being silently
-- swallowed into public.finance_posting_failures — the exact class of bug
-- CLAUDE.md's "adding a new overload to a function already called with
-- untyped literal arguments" lesson warns about, except here the ambiguity
-- is argument COUNT rather than literal type.
--
-- ROOT CAUSE. 20260924213634_fix_voucher_redemption_cross_voucher_double_
-- count_and_revrec_rounding.sql added a 10th parameter (p_promo_minor bigint
-- default 0) to private.finance_create_recognition_schedule, intending to
-- extend the existing function. `create or replace function` only replaces a
-- function with an IDENTICAL parameter list — since the new definition has a
-- different argument count (10 vs 9), Postgres created a SECOND, additional
-- overload instead of replacing the original. Confirmed live via pg_proc:
--   private.finance_create_recognition_schedule(text,uuid,uuid,uuid,text,
--     currency,bigint,date,date)              -- 9 args, no default
--   private.finance_create_recognition_schedule(text,uuid,uuid,uuid,text,
--     currency,bigint,date,date,bigint)        -- 10 args, 10th defaults to 0
-- Every existing call site (private.finance_post_from_payment,
-- private.finance_post_platform_credit_ledger_entry,
-- private.finance_post_voucher_redeemed — confirmed live via
-- pg_get_functiondef, not guessed from migration files, per CLAUDE.md's
-- "a migration file's committed body is not proof of what a live function
-- does") calls it with exactly 9 positional arguments, which now matches
-- BOTH overloads (the second via its defaulted 10th parameter) and Postgres
-- refuses to pick one.
--
-- IMPACT, confirmed live: a fresh service_purchase (any bounded-duration
-- product bought by card or platform credit), any booking, subscription, or
-- add_on payment landing after this ambiguity was introduced posts its
-- payment_transactions row successfully (that INSERT is unaffected) but
-- silently posts ZERO GL journal entries and ZERO revenue recognition
-- schedule — the exception is caught by finance_on_payment_processed/
-- finance_on_service_purchase_payment/etc.'s own `exception when others`
-- handler (built for exactly this kind of resilience — a payment must never
-- be blocked by an accounting failure) and recorded into
-- finance_posting_failures instead of raised, so nothing failed loudly.
--
-- FIX. Drop the original 9-argument overload. The 10-argument version's
-- 10th parameter defaults to 0 (no promotional split), which is exactly what
-- every pre-existing 9-argument call site already meant — this is not a
-- behavioural change for any caller, it only removes the ambiguity so
-- Postgres has exactly one candidate to resolve to.

drop function if exists private.finance_create_recognition_schedule(
  text, uuid, uuid, uuid, text, public.currency, bigint, date, date
);

do $$
declare
  v_count int;
begin
  select count(*) into v_count from pg_proc
    where proname = 'finance_create_recognition_schedule' and pronamespace = 'private'::regnamespace;
  if v_count <> 1 then
    raise exception 'FAIL: expected exactly one private.finance_create_recognition_schedule overload after the drop, found %', v_count;
  end if;
  raise notice 'PASS: finance_create_recognition_schedule overload ambiguity resolved (% definition remains)', v_count;
end $$;
