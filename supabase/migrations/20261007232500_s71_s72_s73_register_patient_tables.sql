-- S71, S72, S73: register the patient tables this stack adds in the data registry (S39d).
--
-- main-dev's two-tier registration assertion (20261013013700_two_tier_register_new_patient_tables.sql) stops the replay for any table with a patient_id and no data_registry
-- row. This sorts after the last of the three table-creating migrations (S72, 20261007231742) and after S39d (20261007164500). Default S39d classification, marked
-- unreviewed in `notes`: the retention class for eligibility checks, discount-code attempts and fund grants is a decision for the CMO and the data protection officer.
-- Idempotent: an existing (possibly reviewed) row is never overwritten.
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name, 'patient_id', private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       private.retention_class_for(t.table_name) <> 'audit',
       'Registered with the default S39d classification when the checkout, pricing and access-fund tables were added; awaiting review.'
  from unnest(array['discount_code_attempts', 'hmo_eligibility_checks', 'access_fund_grants']) as t(table_name)
 where to_regclass('public.' || t.table_name) is not null
on conflict (table_name) do nothing;
