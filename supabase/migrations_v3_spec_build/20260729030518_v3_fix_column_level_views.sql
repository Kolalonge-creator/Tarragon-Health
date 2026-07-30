-- Fix: RLS is row-level only. A patient policy on the base lab_orders table would let a patient
-- select commission_minor directly, defeating "never shown to the patient" (spec §5.10). Same
-- issue on clinical_notes -- the coordinator policy I added grants coordinators the `body`
-- column too, defeating "no access to clinical_notes.body" (spec §6.1).
--
-- Correct pattern: the safe view is owned by the migration role (security_invoker = false, the
-- Postgres default) so it bypasses the base table's RLS entirely, and the view's own WHERE
-- clause becomes the sole access gate -- restricted to exactly the columns the view selects.
-- The base table gets NO policy for the restricted role, so direct queries against it return
-- zero rows for that role.

drop policy if exists lab_orders_patient_own on lab_orders;
drop view if exists lab_orders_patient;
create view lab_orders_patient as
  select id, patient_id, partner_id, panel_code, patient_price_minor, ordered_at, collected_at, resulted_at
  from lab_orders
  where private.is_own_or_dependant(patient_id);
grant select on lab_orders_patient to authenticated;

drop policy if exists clinical_notes_coordinator_metadata on clinical_notes;
drop view if exists clinical_notes_summary;
create view clinical_notes_summary as
  select id, patient_id, clinician_id, note_type, linked_contact_id, linked_classification_id, signed_at
  from clinical_notes
  where private.actor_role() = 'coordinator' and private.can_see_patient(patient_id);
grant select on clinical_notes_summary to authenticated;

