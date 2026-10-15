-- S75 to S80: register the patient-keyed tables this branch adds in the S39d data registry.
-- S39d (20261007164500) seeds the registry once from the tables that existed then, and its proof (A1) fails for any later table with a uuid
-- patient_id column that has no row; main-dev's 20261013013700 also asserts it. This uses the same classification as that seed
-- (private.retention_class_for, review-or-delete, exported unless audit); the classification is PROPOSED, reviewed stays false until the CMO and
-- DPO confirm it. Idempotent (a table already registered, for example by another branch that creates the same table, is left alone).
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name,
       'patient_id',
       private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       private.retention_class_for(t.table_name) <> 'audit',
       'Registered with the default S39d classification when S75 to S80 were added; awaiting review.'
  from unnest(array['outcome_measure_snapshots', 'outcome_mh_snapshots', 'response_time_breaches', 'clinical_follow_ups', 'live_prompts']) as t(table_name)
 where to_regclass('public.' || t.table_name) is not null
on conflict (table_name) do nothing;
