-- S61/S62: register the patient-keyed tables the pathway engine adds in the S39d data registry (same default classification as the S39d seed;
-- reviewed stays false until the CMO and DPO confirm it). The two-tier replay assertion refuses any later table with a uuid patient_id and no
-- registry row. Idempotent: a table already registered is left alone.
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name,
       'patient_id',
       private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       private.retention_class_for(t.table_name) <> 'audit',
       'Registered with the default S39d classification when S61/S62 was added; awaiting review.'
  from unnest(array['pathway_baselines', 'pathway_milestones', 'pathway_lifecycle_events']) as t(table_name)
 where to_regclass('public.' || t.table_name) is not null
on conflict (table_name) do nothing;
