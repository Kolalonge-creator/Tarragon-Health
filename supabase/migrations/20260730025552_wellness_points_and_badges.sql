-- Wellness gamification, part 1: points economy + badges (Healthy-365-style
-- engagement layer, explicit founder ask 2026-07-30).
--
-- Points reward ENGAGEMENT actions that currently earn nothing (logging,
-- streaks, education, challenges — wired in the companion
-- wellness_points_earning_triggers migration). Screening/vaccination/health-
-- check/referral events already pay real Health Wallet cash via
-- private.prevention_reward (20260723195211_referrals_and_prevention_rewards)
-- — deliberately NOT double-rewarded with points here, to avoid two parallel
-- incentive systems paying the same event.
--
-- Redemption is NOT a separate voucher/rewards-shop with its own funding
-- source (no such budget exists, and inventing one would be dishonest).
-- Points convert to Health Wallet balance at an admin-set rate, reusing the
-- wallet's existing ledger/spend machinery (private.wallet_apply) — a point
-- is only ever worth what it becomes in the wallet, spendable on real
-- Tarragon care exactly like every other wallet credit.
--
-- Balance uses a real mutable row + row lock (private.wellness_points_ledger
-- is append-only telemetry, same split as health_wallets/wallet_ledger) so
-- redemption can never double-spend under concurrent requests.

-- ---------------------------------------------------------------------------
-- Wallet plumbing: one new entry type for a traceable redemption line.
-- ---------------------------------------------------------------------------
alter type public.wallet_entry_type add value if not exists 'points_redemption';
;
