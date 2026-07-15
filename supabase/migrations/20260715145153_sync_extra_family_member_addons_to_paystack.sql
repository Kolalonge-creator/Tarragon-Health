-- Records the Paystack test-mode Plans already created for the two new
-- 'Extra Family Member' add-ons (Family Plus / Family Premium) introduced in
-- 20260715142113_doctor_led_pricing_v2_family_tiers.sql, and activates them
-- now that each has a real Paystack Plan behind it.
--
-- Reconstructed after-the-fact (2026-07-15): this file was applied directly
-- against the remote project without a committed migration, the same class
-- of drift CLAUDE.md's Current Sprint notes have flagged twice before. The
-- values below match the paystack_plan_code/is_active state already live on
-- koiplnmbgnqnbywhpjlf.

update add_ons set paystack_plan_code = 'PLN_lnjml37wflvqpvi', is_active = true where code = 'extra-family-member-plus';
update add_ons set paystack_plan_code = 'PLN_n9264gsjodthuil', is_active = true where code = 'extra-family-member-premium';
