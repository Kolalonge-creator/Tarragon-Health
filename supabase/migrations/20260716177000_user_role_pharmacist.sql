-- Tarragon Health — 'pharmacist' account role (medication pathway, Phase 8b)
--
-- Partner pharmacies that opt into the dashboard (pharmacy_partners
-- .uses_platform_login) get pharmacist logins. A pharmacist is NOT org staff —
-- they are an external partner with a deliberately narrow view (their own
-- orders' patients only), delivered exclusively through vetted SECURITY DEFINER
-- RPCs (see 20260716178000). This migration only adds the enum value; the link
-- column, helper, and RPCs live in the next migration so nothing uses the new
-- value in the same transaction. Idempotent via ADD VALUE IF NOT EXISTS.

alter type public.user_role add value if not exists 'pharmacist';
