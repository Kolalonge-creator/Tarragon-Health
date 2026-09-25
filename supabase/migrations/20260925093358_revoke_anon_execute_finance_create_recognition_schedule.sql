-- Release Integrity CI (scripts/release-integrity/check-anon-security-definer-
-- execute.mjs) flagged private.finance_create_recognition_schedule(text, uuid,
-- uuid, uuid, text, currency, bigint, date, date, bigint) as anon-executable
-- and not on the allowlist. Confirmed live: proacl carries a bare `=X/postgres`
-- PUBLIC entry (no direct anon grant) and
-- has_function_privilege('anon', ..., 'EXECUTE') = true.
--
-- This is the well-documented "anon inherits EXECUTE via the PUBLIC pseudo-
-- role" gotcha — see the supabase-anon-execute-gotcha memory, recurred at
-- least 5 times before. The function's originating migration
-- (20260725230030_finance_revenue_recognition.sql) never revoked the default
-- PUBLIC grant before/after granting to authenticated, so anon inherited
-- EXECUTE through PUBLIC rather than any direct grant — `revoke ... from
-- anon` alone would be a no-op here, only `revoke ... from public` strips it.
--
-- A revenue-recognition-schedule creator is private accounting machinery
-- called only from other SECURITY DEFINER finance functions
-- (finance_post_from_payment, finance_post_platform_credit_ledger_entry,
-- finance_post_voucher_redeemed) — it has no legitimate direct caller other
-- than `authenticated` (via those wrappers) and `postgres`/`service_role`,
-- both of which already have their own grants untouched by this migration.

revoke all on function private.finance_create_recognition_schedule(
  text, uuid, uuid, uuid, text, public.currency, bigint, date, date, bigint
) from public, anon;

grant execute on function private.finance_create_recognition_schedule(
  text, uuid, uuid, uuid, text, public.currency, bigint, date, date, bigint
) to authenticated;

do $$
begin
  if has_function_privilege(
    'anon',
    'private.finance_create_recognition_schedule(text, uuid, uuid, uuid, text, public.currency, bigint, date, date, bigint)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: anon can still execute private.finance_create_recognition_schedule';
  end if;

  if not has_function_privilege(
    'authenticated',
    'private.finance_create_recognition_schedule(text, uuid, uuid, uuid, text, public.currency, bigint, date, date, bigint)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated lost execute on private.finance_create_recognition_schedule';
  end if;

  raise notice 'PASS: private.finance_create_recognition_schedule no longer anon-executable, authenticated retained';
end $$;
