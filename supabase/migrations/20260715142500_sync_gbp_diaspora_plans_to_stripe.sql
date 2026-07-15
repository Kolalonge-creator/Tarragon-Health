-- Records the Stripe test-mode Products/Prices already created via the Stripe MCP
-- (account acct_1Tpg39E7JJdIgXQy, "Tarragon Health sandbox", livemode: false) for the
-- 6 GBP diaspora plan rows introduced in 20260715142113_doctor_led_pricing_v2_family_tiers.sql,
-- and activates them now that each has a real Stripe Price behind it.
-- family_gbp is deliberately left unsynced/inactive — the marketing pricing page has no
-- self-serve GBP Family Plan row (see DIASPORA_FAMILY_NOTE in _content/pricing.ts, a
-- "talk to us for a quote" case, not a Stripe checkout product).

update subscription_plans set stripe_product_id = 'prod_UtGHnUUilAJjig', stripe_price_id = 'price_1TtTl2E7JJdIgXQy4lb6cfkp', is_active = true where code = 'essential_gbp';
update subscription_plans set stripe_product_id = 'prod_UtGHuoOqOkjLuz', stripe_price_id = 'price_1TtTlOE7JJdIgXQy1p1BOWuJ', is_active = true where code = 'essential_yearly_gbp';
update subscription_plans set stripe_product_id = 'prod_UtGHnMIMjmIHBV', stripe_price_id = 'price_1TtTlPE7JJdIgXQyzrSiYhm2', is_active = true where code = 'complete_gbp';
update subscription_plans set stripe_product_id = 'prod_UtGHsry90XaQKP', stripe_price_id = 'price_1TtTlSE7JJdIgXQyN2Gvr49m', is_active = true where code = 'complete_yearly_gbp';
update subscription_plans set stripe_product_id = 'prod_UtGHF1nKFxmoau', stripe_price_id = 'price_1TtTlTE7JJdIgXQyU2x0zzO5', is_active = true where code = 'diaspora_premium_gbp';
update subscription_plans set stripe_product_id = 'prod_UtGHpXdS9hgtf0', stripe_price_id = 'price_1TtTlVE7JJdIgXQyC11wLP8l', is_active = true where code = 'diaspora_premium_yearly_gbp';
