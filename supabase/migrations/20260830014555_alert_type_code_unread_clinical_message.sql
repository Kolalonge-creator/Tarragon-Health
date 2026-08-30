-- Patient Communication Architecture (77.13) — missed-message escalation,
-- part 1/2: new enum value only. A freshly-added enum value can't be used in
-- the same transaction that adds it (same split this codebase always uses —
-- see 20260830002425_alert_type_code_message_safety_flag.sql for the most
-- recent precedent). See the companion migration for the alert_rules
-- governance entry and the sweep that raises this type.
alter type public.alert_type_code add value 'unread_clinical_care_message';
