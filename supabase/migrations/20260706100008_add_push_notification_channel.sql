-- Tarragon Health — V1 consumer spec reconciliation (Phase 0)
-- 08 · Add 'push' to notification_channel
--
-- The existing enum (email/sms/in_app/whatsapp) is missing 'push', which
-- the V1 spec's reminder channel list needs. Additive only — no send
-- integration is built in this phase, and no existing row uses this value.

alter type public.notification_channel add value 'push';
