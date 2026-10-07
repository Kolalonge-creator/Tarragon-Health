-- Tarragon Health — Platform Credit, part 2: payment_provider enum value.
--
-- service_purchases.payment_provider needs a value for "this was settled from
-- a patient's own platform credit balance, not a fresh Paystack charge" so a
-- credit-funded purchase is visible in the same column every other purchase
-- reports through. Split into its own migration because ALTER TYPE ... ADD
-- VALUE cannot run in the same transaction as anything that uses the new
-- value — a lesson this codebase has been bitten by before (see CLAUDE.md's
-- specialist-referral auto-matching entry, same root cause).

alter type public.payment_provider add value if not exists 'platform_credit';
