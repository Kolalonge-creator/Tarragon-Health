-- Registers feature_waitlist in the two registries every patient table must be in (rls_shape_gate and s39d_registry_purge_export fail
-- without them). It holds no health data: a patient's own note that they want to hear when a closed feature opens. 'operational' class,
-- included in the patient's own export (it is their data), not reviewed yet by the CMO and DPO. Staff read scope is 'tied'; the table has
-- no staff read policy at all, which is stricter than that, on purpose (see 20261029233636_feature_waitlist.sql).

insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values ('feature_waitlist', 'patient_id', 'operational', 'review', true, false,
        'Which closed features a patient asked to hear about. Class assigned by the migration author, not yet reviewed by the CMO and DPO.')
on conflict (table_name) do nothing;

insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason)
values ('feature_waitlist', 'tied', 'patient_id', 'medical_history', null)
on conflict (table_name) do nothing;

do $$
begin
  if not exists (select 1 from public.data_registry where table_name = 'feature_waitlist' and not reviewed) then
    raise exception 'feature_waitlist is not registered in data_registry as expected';
  end if;
  if not exists (select 1 from public.staff_read_scope where table_name = 'feature_waitlist' and mode = 'tied') then
    raise exception 'feature_waitlist is not registered in staff_read_scope as expected';
  end if;
end $$;
