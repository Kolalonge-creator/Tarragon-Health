-- OQ-BPW-5: the blood pressure handler can resolve the "Missing expected blood-pressure readings" alert.
--
-- The first statement of private.handle_bp_reading_red_flag() resolves that alert with a bare `status = 'resolved'`. The check
-- clinician_alerts_resolution_requires_documentation refuses a resolved alert of severity 2 or more without resolution_action and
-- resolution_outcome, and the generator (20260720015541) inserts the alert at level 'clinician_review', which classifies as severity 2.
-- So if such an alert is ever open, the NEXT blood pressure insert for that patient raises 23514 and rolls back: the patient's reading
-- is refused. Found in the S07x review; the bp_cuffless_estimates_never_diagnostic proof worked around it by lowering the fixture's severity.
--
-- Live count of open alerts with that title when this was written (2026-10-30): 0, so nothing is failing today and no data needs converting.
--
-- The statement now also sets the two documentation columns, the way the other automatic resolvers already do
-- (chain_canary_evaluate, replace_my_result_document): a plain system sentence and the outcome 'no_action_needed'. Nothing a patient
-- sees changes, and the guard on estimates (`not private.bp_reading_is_estimate`) is untouched.
--
-- The live body is patched by text replacement rather than re-typed (it is about 250 lines and has been redefined many times). If the
-- anchor is not found the migration stops, so a body that moved on is never half-patched.

do $$
declare
  v_def text := pg_get_functiondef('private.handle_bp_reading_red_flag()'::regprocedure);
  v_old text := $q$  update public.clinician_alerts
    set status = 'resolved', updated_at = now()
  where patient_id = new.patient_id
    and status = 'open'
    and title = 'Missing expected blood-pressure readings'
    and not private.bp_reading_is_estimate(new.source::text);$q$;
  v_new text := $q$  update public.clinician_alerts
    set status = 'resolved', updated_at = now(),
        resolution_action = 'Resolved automatically: a new blood pressure reading arrived.',
        resolution_outcome = 'no_action_needed'
  where patient_id = new.patient_id
    and status = 'open'
    and title = 'Missing expected blood-pressure readings'
    and not private.bp_reading_is_estimate(new.source::text);$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'handle_bp_reading_red_flag: the missing-readings resolve statement was not found; the live body has moved on, stop and read it';
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) <> length(v_old) then
    raise exception 'handle_bp_reading_red_flag: the missing-readings resolve statement appears more than once';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- Self-check: the live body now documents the resolution.
do $$
begin
  if pg_get_functiondef('private.handle_bp_reading_red_flag()'::regprocedure) not like '%Resolved automatically: a new blood pressure reading arrived.%' then
    raise exception 'bp handler self-check: the resolution is not documented';
  end if;
end $$;
