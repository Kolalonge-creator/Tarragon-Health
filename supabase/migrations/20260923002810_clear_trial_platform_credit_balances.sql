-- Platform Credit shipped 2026-09-17 (see 20260917100300_platform_credit_core_schema.sql) and
-- has never been used by a real patient: as of 2026-09-23, every row across
-- platform_credit_balances/_ledger_entries/_topup_intents belongs to exactly two
-- @tarragon.test QA accounts (patient.free.test, supporter.consent.test), the two
-- platform_credit_topup_intents rows are both status='cancelled' with no real
-- Paystack payment_provider_ref, and the only finance_journal_entries tied to
-- source='platform_credit' are explicitly labelled E2E-verification scaffolding
-- ("E2E verification of admin grant UI", "will correct back to 0 after") that
-- already nets to zero. Confirmed live via execute_sql before writing this
-- migration -- no real customer funds exist in these tables.
--
-- Founder instruction 2026-09-23: this is trial money, not real money, safe to
-- delete outright (distinct from the launch-scope audit's separate ask to gate
-- *new* top-ups behind a platform_modules kill switch, which is
-- 20260922185100_platform_credit_topups_kill_switch.sql -- that migration is
-- about future top-ups, this one is about clearing what already exists).
--
-- No feature/schema removal: the Platform Credit tables, triggers, and RPCs all
-- stay -- a real patient funding a real balance after launch works exactly as
-- before. This is a one-time data cleanup, not the "remove a shipped feature"
-- pattern (no enum value to delete, no dependent view/policy to rewrite).
--
-- No FK from any other table references platform_credit_balances or
-- platform_credit_topup_intents (confirmed via pg_constraint); the only FK
-- among these three tables is platform_credit_ledger_entries.topup_intent_id ->
-- platform_credit_topup_intents.id, so ledger_entries is deleted first.
-- finance_journal_entries.source_ref is a free-text label, not an FK, so this
-- delete cannot orphan any financial record.

delete from public.platform_credit_ledger_entries;
delete from public.platform_credit_topup_intents;
delete from public.platform_credit_balances;

do $$
declare
  v_balances int;
  v_ledger int;
  v_topups int;
begin
  select count(*) into v_balances from public.platform_credit_balances;
  select count(*) into v_ledger from public.platform_credit_ledger_entries;
  select count(*) into v_topups from public.platform_credit_topup_intents;

  if v_balances <> 0 or v_ledger <> 0 or v_topups <> 0 then
    raise exception 'clear_trial_platform_credit_balances: expected all three platform_credit tables empty after delete, got balances=%, ledger=%, topups=%',
      v_balances, v_ledger, v_topups;
  end if;
end $$;
