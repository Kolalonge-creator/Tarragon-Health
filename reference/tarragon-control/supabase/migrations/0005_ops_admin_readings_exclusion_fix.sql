-- Tarragon Control — M1: fix ops_admin readings exclusion
-- Found by the M1 RLS exit test against a real fixture, not by inspection.
-- §6.1 is explicit: ops_admin gets "non-clinical operational tables; no
-- clinical_notes, no readings values." readings_select_staff granted
-- ops_admin (and superadmin, correctly — break-glass) blanket read of
-- every reading's actual value, which is exactly "readings values".

drop policy readings_select_staff on readings;

create policy readings_select_staff on readings
  for select to authenticated
  using (
    private.current_role() = 'superadmin'
    or (private.current_role() in ('clinician','coordinator')
        and patient_id in (select private.queue_patient_ids()))
    or (private.current_role() = 'coordinator'
        and patient_id in (select private.coordinator_assigned_patient_ids()))
  );
