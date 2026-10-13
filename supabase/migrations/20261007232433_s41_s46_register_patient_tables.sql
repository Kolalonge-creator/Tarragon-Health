-- S41 to S46: register the patient-keyed tables this branch adds in the S39d data registry.
-- S39d (20261007164500) seeds the registry once from the tables that existed then, and its proof (A1) fails for any later table with a uuid
-- patient_id column that has no row; main-dev's 20261013013700 also asserts it. This sorts right after the last table-creating migration of
-- the chain. It uses the same classification as the S39d seed (private.retention_class_for, review-or-delete, exported unless audit); the
-- classification is PROPOSED, reviewed stays false until the CMO and DPO confirm it. Idempotent.
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name,
       'patient_id',
       private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       private.retention_class_for(t.table_name) <> 'audit',
       'Registered with the default S39d classification when S41 to S46 were added; awaiting review.'
  from unnest(array['onboarding_answers', 'procedures', 'emergency_card_fields', 'consent_matrix_events', 'risk_assessments', 'dependant_handovers', 'screening_pathway_overrides', 'health_reports', 'external_exchange_consents', 'external_records', 'patient_item_notes', 'fhir_export_log']) as t(table_name)
 where to_regclass('public.' || t.table_name) is not null
on conflict (table_name) do nothing;
