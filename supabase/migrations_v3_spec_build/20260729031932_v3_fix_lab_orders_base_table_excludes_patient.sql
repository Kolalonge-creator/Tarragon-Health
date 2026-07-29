-- can_see_patient() also returns true for a patient's own record (by design, it's reused by
-- tables patients ARE meant to read directly). lab_orders is deliberately NOT one of those --
-- patients must go through lab_orders_patient() so commission_minor is never exposed. The
-- previous policy accidentally let a patient role through the base table too.
drop policy lab_orders_staff_select on lab_orders;
create policy lab_orders_staff_select on lab_orders for select using (
  (private.actor_role() in ('clinician','coordinator') and private.can_see_patient(patient_id))
  or private.actor_role() in ('ops_admin','superadmin')
);
