-- S67: register the pregnancy tables in the data registry (S39d).
--
-- Every table with a patient_id column must have a data_registry row, or main-dev's two-tier registration assertion
-- (20261013013700_two_tier_register_new_patient_tables.sql) stops the replay. This sorts just after S39d (20261007164500) and after the S67 tables exist.
-- The default S39d classification is used and the row says so in `notes`: it has NOT been reviewed. The retention class and the end-of-retention action for
-- pregnancy data are a decision for the CMO and the data protection officer, not for an agent, and the s39f proof checks that no such row claims to be reviewed.
-- Idempotent: an existing row (for example one a reviewer has already set) is never overwritten.
begin;

insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name, 'patient_id', private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       private.retention_class_for(t.table_name) <> 'audit',
       'Registered with the default S39d classification when the pregnancy tables were added; awaiting review.'
  from unnest(array['pregnancies', 'kick_counts', 'contractions', 'birth_plans']) as t(table_name)
 where to_regclass('public.' || t.table_name) is not null
on conflict (table_name) do nothing;

commit;
