-- S70: a Withings slot in the wearable_provider enum. A cloud API slot ONLY: no connect flow, no webhook, no sync is switched on.
--
-- This is the one database piece of S70 (devices, wearables and data connections) that S70a (#1092) does not carry. Everything else S70 built
-- (cross-source de-duplication, plausibility, CGM sustained events, ECG results, recommended devices, pairing) is done by S70a; the choice of S70a
-- over S70 was made on 2026-10-13 (docs/design/S70.md, status note). S70's own alert record (device_alerts) was deliberately not carried over:
-- S70a already creates a clinician task for every sustained CGM event and every ECG result.
--
-- Adding an enum value is safe on its own: nothing here USES the new value, so it can sit in this transaction. Idempotent.
alter type public.wearable_provider add value if not exists 'withings';
