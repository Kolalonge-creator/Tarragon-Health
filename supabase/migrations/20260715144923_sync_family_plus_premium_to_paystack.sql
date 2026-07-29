-- Records the Paystack test-mode Plans already created for the two new NGN
-- family tiers introduced in 20260715142113_doctor_led_pricing_v2_family_tiers.sql,
-- and activates them now that each has a real Paystack Plan behind it — same
-- pattern as 20260715142500_sync_gbp_diaspora_plans_to_stripe.sql for the GBP
-- side.
--
-- Reconstructed after-the-fact (2026-07-15): this file was applied directly
-- against the remote project without a committed migration, the same class
-- of drift CLAUDE.md's Current Sprint notes have flagged twice before. The
-- values below match the paystack_plan_code/is_active state already live on
-- koiplnmbgnqnbywhpjlf.

update subscription_plans set paystack_plan_code = 'PLN_scwj3ajvfg7lt1g', is_active = true where code = 'family_plus';
update subscription_plans set paystack_plan_code = 'PLN_wz7yxm3mxwk5oo7', is_active = true where code = 'family_premium';
