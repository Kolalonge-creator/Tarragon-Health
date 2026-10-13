-- S53/S54c medicines and pharmacy: register the patient-keyed tables this branch adds in the S39d data registry.
-- S39d (20261007164500) seeds the registry once from the tables that existed then, and its proof (A1) fails for any later table with a uuid
-- patient_id column that has no row. This uses the same classification as that seed (private.retention_class_for, review-or-delete, exported
-- unless audit). The classification is PROPOSED: reviewed stays false until the CMO and DPO confirm it. Idempotent.
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name,
       'patient_id',
       private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       private.retention_class_for(t.table_name) <> 'audit',
       'Registered with the default S39d classification when S53/S54c medicines and pharmacy was added; awaiting review.'
  from unnest(array['medication_side_effect_notes', 'pharmacist_chat_threads', 'pharmacist_chat_messages', 'prescription_pharmacy_suggestions']) as t(table_name)
 where to_regclass('public.' || t.table_name) is not null
on conflict (table_name) do nothing;
