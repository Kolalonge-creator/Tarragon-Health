-- Two-tier build: register the new patient-keyed tables in the S39d data registry.
-- The registry (public.data_registry) lists every public table that holds a patient's rows, with its retention class and whether it is part of
-- the patient export. It was seeded once by S39d; a table created later must be added by the migration that creates it. The two-tier tables were
-- not, which the S39d proof (A1: every public table with a patient_id column is in the registry) caught on CI.
-- Classification is PROPOSED (reviewed = false) until the CMO and DPO confirm, exactly like the original rows: the class comes from the same
-- private.retention_class_for() rule, so nothing here is a new judgement. Operational notices (none of these) would be 'delete'; everything
-- below is clinical or entitlement history and is 'review' at end of retention. All are in the patient export.
-- LIVE COUNT BEFORE: none of these tables exists live yet (this chain creates them), so there are no rows to classify.
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name, 'patient_id', private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       private.retention_class_for(t.table_name) <> 'audit',
       'Two-tier build 2026-10-13: PROPOSED, to be confirmed by the CMO and DPO.'
  from (values
    ('testing_event_bookings'), ('poc_measurements'), ('poc_results'), ('poc_result_items'), ('poc_ecg_recordings'),
    ('member_followup_entitlements'), ('followup_offers'), ('followup_offer_slots'), ('free_red_events'), ('member_review_notes')
  ) as t(table_name)
 where to_regclass('public.' || t.table_name) is not null
on conflict (table_name) do nothing;

do $$
declare v_missing text;
begin
  select string_agg(c.table_name, ',') into v_missing
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
   where c.table_schema = 'public' and c.column_name = 'patient_id' and c.data_type = 'uuid'
     and c.table_name not in ('data_registry', 'staff_read_scope', 'staff_read_policy_backup')
     and not exists (select 1 from public.data_registry r where r.table_name = c.table_name);
  if v_missing is not null then raise exception 'two-tier: patient tables still missing from data_registry: %', v_missing; end if;
end $$;
