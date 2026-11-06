-- Diagnostic directory P5 follow-up: register public.diagnostic_order_suggestions (created by 20261105093851) in the two
-- registries every patient table must be in. CI's proof run caught both gaps:
--   * s39d: every public table with a patient_id column has a data_registry row (retention, export, purge).
--   * rls_shape_gate: every table whose read policy calls a staff-capable helper has a staff_read_scope row (S39b, INV-12).
-- The read policy is private.staff_may_read(patient_id, organisation_id, 'labs_results'), so the scope is tied, labs_results.

insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values ('diagnostic_order_suggestions', 'patient_id', 'clinical_record', 'review', true, false,
        'Where a clinician suggested the patient takes a lab or imaging request (directory P5), with who suggested it, when, and any withdrawal. Class assigned by the migration author, not yet reviewed by the CMO and DPO.')
on conflict (table_name) do nothing;

insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason)
values ('diagnostic_order_suggestions', 'tied', 'patient_id', 'labs_results',
        'A suggested place for a lab or imaging request; read with the request it belongs to, under labs_results.')
on conflict (table_name) do nothing;

do $$
begin
  if not exists (select 1 from public.data_registry where table_name = 'diagnostic_order_suggestions') then
    raise exception 'diagnostic_order_suggestions missing from data_registry';
  end if;
  if not exists (select 1 from public.staff_read_scope where table_name = 'diagnostic_order_suggestions' and mode = 'tied') then
    raise exception 'diagnostic_order_suggestions missing from staff_read_scope';
  end if;
end $$;
