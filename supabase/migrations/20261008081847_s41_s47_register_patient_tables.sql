-- S41 to S47: register the patient-keyed tables the stack adds in the S39d data registry (same default classification as the S39d
-- seed; reviewed stays false until the CMO and DPO confirm it). The two-tier replay assertion refuses any later table with a uuid
-- patient_id and no registry row, and the registry-driven export and purge read this table, so an unregistered patient table would
-- be missing from a patient's data download. Idempotent: a table already registered is left alone.
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name,
       'patient_id',
       private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       private.retention_class_for(t.table_name) <> 'audit',
       'Registered with the default S39d classification when S41 to S47 were added; awaiting review.'
  from unnest(array[
    'consent_matrix_events', 'dependant_handovers', 'emergency_card_fields', 'external_exchange_consents', 'external_records',
    'fhir_export_log', 'health_report_build_failures', 'health_reports', 'onboarding_answers', 'patient_item_notes', 'procedures',
    'risk_assessments', 'screening_care_team_flags', 'screening_pathway_overrides', 'screening_risk_flags'
  ]) as t(table_name)
 where to_regclass('public.' || t.table_name) is not null
on conflict (table_name) do nothing;
