-- Tarragon Health
-- Data Governance gap-closure, item 4 of 7, step 1 of 2 (§87.8 DSAR export /
-- §87.12 third-party sharing). Adds the "use" event for a patient
-- exporting their own full data record, alongside the existing
-- record_viewed/receipt_generated/acted_for use-events. Split into its own
-- migration -- same enum-value transaction rule as every other enum-add
-- this pass.

alter type public.care_access_event_kind add value if not exists 'data_exported';
