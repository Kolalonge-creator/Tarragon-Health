drop view if exists lab_orders_patient;
create or replace function lab_orders_patient() returns table (
  id uuid, patient_id uuid, partner_id uuid, panel_code text,
  patient_price_minor int, ordered_at timestamptz, collected_at timestamptz, resulted_at timestamptz
) language sql stable security definer set search_path = public, pg_temp as $$
  select id, patient_id, partner_id, panel_code, patient_price_minor, ordered_at, collected_at, resulted_at
  from lab_orders
  where private.is_own_or_dependant(patient_id);
$$;
revoke all on function lab_orders_patient() from public;
grant execute on function lab_orders_patient() to authenticated;
revoke execute on function lab_orders_patient() from anon;

drop view if exists clinical_notes_summary;
create or replace function clinical_notes_summary() returns table (
  id uuid, patient_id uuid, clinician_id uuid, note_type text,
  linked_contact_id uuid, linked_classification_id uuid, signed_at timestamptz
) language sql stable security definer set search_path = public, pg_temp as $$
  select id, patient_id, clinician_id, note_type, linked_contact_id, linked_classification_id, signed_at
  from clinical_notes
  where private.actor_role() = 'coordinator' and private.can_see_patient(patient_id);
$$;
revoke all on function clinical_notes_summary() from public;
grant execute on function clinical_notes_summary() to authenticated;
revoke execute on function clinical_notes_summary() from anon;

-- confirm the anon-execute gotcha this project has hit repeatedly before is actually closed
select
  has_function_privilege('anon', 'lab_orders_patient()', 'execute') as anon_can_call_lab_fn,
  has_function_privilege('anon', 'clinical_notes_summary()', 'execute') as anon_can_call_notes_fn,
  has_function_privilege('authenticated', 'lab_orders_patient()', 'execute') as authenticated_can_call_lab_fn;

