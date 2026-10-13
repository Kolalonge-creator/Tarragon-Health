-- S69: register the cohort and challenge tables that hold a patient_id in the data registry (S39d).
--
-- main-dev's two-tier registration assertion (20261013013700_two_tier_register_new_patient_tables.sql) stops the replay for any table with a patient_id and no
-- data_registry row. This sorts just after S39d (20261007164500) and after the S69 tables exist. Default S39d classification, marked unreviewed in `notes`:
-- the retention class for cohort membership and challenge participation is a decision for the CMO and the data protection officer, not an agent.
-- Idempotent: an existing (possibly reviewed) row is never overwritten.
begin;

insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name, 'patient_id', private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       private.retention_class_for(t.table_name) <> 'audit',
       'Registered with the default S39d classification when the cohort and challenge tables were added; awaiting review.'
  from unnest(array['cohort_members', 'cohort_preferences', 'challenge_participation']) as t(table_name)
 where to_regclass('public.' || t.table_name) is not null
on conflict (table_name) do nothing;

commit;
