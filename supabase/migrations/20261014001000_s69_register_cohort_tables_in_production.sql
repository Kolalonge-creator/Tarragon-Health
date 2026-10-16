-- S69: register the three cohort and challenge tables in the data registry (S39d), as a migration the production apply workflow can run.
--
-- 20261007164506_s69_register_cohort_tables.sql did exactly this but manages its own transaction (begin; ... commit;), which the production apply workflow refuses ("apply it by
-- hand"), so after #1091 merged the cohort tables existed in production without their data_registry rows. This repeats the same insert with no transaction statements. On a fresh
-- replay the earlier migration already registered them and this does nothing. Default S39d classification, marked unreviewed in `notes`: the retention class for cohort
-- membership and challenge participation is a decision for the CMO and the data protection officer. Idempotent: an existing (possibly reviewed) row is never overwritten.
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name, 'patient_id', private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       private.retention_class_for(t.table_name) <> 'audit',
       'Registered with the default S39d classification when the cohort and challenge tables were added; awaiting review.'
  from unnest(array['cohort_members', 'cohort_preferences', 'challenge_participation']) as t(table_name)
 where to_regclass('public.' || t.table_name) is not null
on conflict (table_name) do nothing;
