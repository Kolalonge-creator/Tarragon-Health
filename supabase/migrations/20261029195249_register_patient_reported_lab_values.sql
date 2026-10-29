-- Register patient_reported_lab_values (migration 20261029192438) in the two registries that every patient-data table must be in.
-- CI found the omission: rls_shape_gate (staff_read_not_registered) and s39d_registry_purge_export (A1) both failed on the new table.
--
--   * public.data_registry: retention and export class. Same class as its sibling lab tables (clinical_record, reviewed at the end of
--     the retention period, included in the patient's data export). reviewed is left FALSE on purpose: the CMO and DPO classified the
--     sibling tables on 2026-10-07; nobody has classified this one, and a registry that says "reviewed" for something nobody reviewed is
--     exactly what the registry exists to prevent. It is listed for their next review in docs/design/S39d-class-review.md.
--   * public.staff_read_scope: how staff may read it. 'tied' under labs_results, like lab_analyte_readings and lab_result_documents: a
--     clinician reads it only with a tie to the patient or through the audited open-record path. The table's own SELECT policy already
--     says the same (private.staff_may_read(..., 'labs_results')); this records it in the S39b register (INV-12).
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values ('patient_reported_lab_values', 'patient_id', 'clinical_record', 'review', true, false,
        'Numbers a patient confirmed from their own uploaded report (not part of the clinical record). Class assigned by the migration author, not yet reviewed by the CMO and DPO.')
on conflict (table_name) do nothing;

insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason)
values ('patient_reported_lab_values', 'tied', 'patient_id', 'labs_results', null)
on conflict (table_name) do nothing;

do $$
begin
  if not exists (select 1 from public.data_registry where table_name = 'patient_reported_lab_values' and retention_class = 'clinical_record' and in_export and not reviewed) then
    raise exception 'patient_reported_lab_values is not registered in data_registry as expected';
  end if;
  if not exists (select 1 from public.staff_read_scope where table_name = 'patient_reported_lab_values' and mode = 'tied' and category = 'labs_results') then
    raise exception 'patient_reported_lab_values is not registered in staff_read_scope as expected';
  end if;
end $$;
