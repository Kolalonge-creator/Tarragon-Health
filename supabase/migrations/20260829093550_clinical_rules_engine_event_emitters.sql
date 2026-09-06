-- Tarragon Health — Clinical Rules & Care Protocol Engine, part 4/6:
-- event emitters.
--
-- §32.7 lists the events the engine reacts to. This wires the first five of
-- them onto the real clinical tables that produce them.
--
-- SAFETY POSTURE — read this before adding a sixth. These are AFTER INSERT/
-- UPDATE triggers on live, patient-safety-critical tables (vitals_readings
-- is the table a dangerous BP reading arrives on). A trigger that raises
-- takes the parent INSERT down with it, which would mean the rules engine's
-- OBSERVABILITY layer could block a patient from recording a vital sign.
-- That trade is never acceptable, so every emitter below swallows its own
-- exceptions: a failed emit costs a missed rule evaluation, never a lost
-- clinical record. The engine is a consumer of clinical events, not a
-- gatekeeper of them, and these triggers are written to make that
-- structurally true rather than merely intended.
--
-- These emitters add rows to a queue. They do not, on their own, cause
-- anything to happen to a patient: every rule seeded in part 6 ships in
-- SHADOW mode, so the worker records what it would have done and stops
-- there. Nothing here changes existing behaviour.

-- ---------------------------------------------------------------------------
-- vitals_readings -> vital_recorded
-- ---------------------------------------------------------------------------

create or replace function private.emit_vital_recorded_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform private.emit_clinical_rule_event(
      new.organisation_id,
      new.patient_id,
      'vital_recorded',
      jsonb_strip_nulls(jsonb_build_object(
        'vital_type',        new.vital_type,
        'systolic',          new.systolic,
        'diastolic',         new.diastolic,
        'glucose_mmol_l',    new.glucose_mmol_l,
        'glucose_context',   new.glucose_context,
        'weight_kg',         new.weight_kg,
        'pulse_bpm',         new.pulse_bpm,
        'temperature_c',     new.temperature_c,
        'spo2_pct',          new.spo2_pct,
        'ketones_mmol_l',    new.ketones_mmol_l,
        'peak_flow_l_min',   new.peak_flow_l_min,
        'source',            new.source,
        'taken_at',          new.taken_at
      )),
      'db_trigger', 'vitals_readings', new.id, new.taken_at,
      -- One event per reading, so a re-run backfill or a retried insert
      -- cannot make the same reading evaluate twice.
      'vital_recorded:' || new.id::text
    );
  exception when others then
    -- Deliberate: the rules-engine queue must never be able to reject a
    -- vital sign. See the safety note at the top of this file.
    null;
  end;
  return null;
end;
$$;

create trigger vitals_readings_emit_rule_event
  after insert on public.vitals_readings
  for each row execute function private.emit_vital_recorded_event();

-- ---------------------------------------------------------------------------
-- screening_results -> screening_result_received
-- ---------------------------------------------------------------------------
--
-- Fires on insert and on a result_status transition, because a screening row
-- is routinely created as 'pending' and resulted later. The abnormal-result
-- pipeline that already exists (private.handle_abnormal_screening_result) is
-- untouched and remains the thing that actually escalates -- CLAUDE.md's
-- "never deprioritise or silently swallow an abnormal screening result"
-- rule is served by that trigger, not by this one, and this emitter is
-- additive observation alongside it.

create or replace function private.emit_screening_result_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if tg_op = 'UPDATE' and new.result_status is not distinct from old.result_status then
      return null;
    end if;

    perform private.emit_clinical_rule_event(
      new.organisation_id,
      new.patient_id,
      'screening_result_received',
      jsonb_strip_nulls(jsonb_build_object(
        'screen_type_code', new.screen_type_code,
        'result_status',    new.result_status,
        'abnormal_flags',   new.abnormal_flags,
        'follow_up_action', new.follow_up_action,
        'is_correction',    new.corrects_result_id is not null
      )),
      'db_trigger', 'screening_results', new.id, now(),
      -- Keyed by status as well as row id: the pending -> resulted
      -- transition is a genuinely different event from the row's creation,
      -- and both are worth evaluating.
      'screening_result:' || new.id::text || ':' || coalesce(new.result_status::text, 'null')
    );
  exception when others then
    null;
  end;
  return null;
end;
$$;

create trigger screening_results_emit_rule_event
  after insert or update of result_status on public.screening_results
  for each row execute function private.emit_screening_result_event();

-- ---------------------------------------------------------------------------
-- medications -> medication_prescribed
-- ---------------------------------------------------------------------------

create or replace function private.emit_medication_prescribed_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform private.emit_clinical_rule_event(
      new.organisation_id,
      new.patient_id,
      'medication_prescribed',
      jsonb_strip_nulls(jsonb_build_object(
        'drug_name',  new.drug_name,
        'dose',       new.dose,
        'frequency',  new.frequency,
        'route',      new.route,
        'indication', new.indication,
        'source',     new.source
      )),
      'db_trigger', 'medications', new.id, new.created_at,
      'medication_prescribed:' || new.id::text
    );
  exception when others then
    null;
  end;
  return null;
end;
$$;

create trigger medications_emit_rule_event
  after insert on public.medications
  for each row execute function private.emit_medication_prescribed_event();

-- ---------------------------------------------------------------------------
-- appointments -> appointment_completed / appointment_missed
-- ---------------------------------------------------------------------------

create or replace function private.emit_appointment_outcome_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.clinical_rule_event_type;
begin
  begin
    if new.status is not distinct from old.status then
      return null;
    end if;

    v_event := case new.status::text
                 when 'completed' then 'appointment_completed'::public.clinical_rule_event_type
                 when 'no_show'   then 'appointment_missed'::public.clinical_rule_event_type
                 else null
               end;
    if v_event is null then
      return null;
    end if;

    perform private.emit_clinical_rule_event(
      new.organisation_id,
      new.patient_id,
      v_event,
      jsonb_strip_nulls(jsonb_build_object(
        'appointment_type',    new.appointment_type,
        'consultation_method', new.consultation_method,
        'service',             new.service,
        'scheduled_for',       new.scheduled_for,
        'clinician_id',        new.clinician_id
      )),
      'db_trigger', 'appointments', new.id, now(),
      'appointment_outcome:' || new.id::text || ':' || new.status::text
    );
  exception when others then
    null;
  end;
  return null;
end;
$$;

create trigger appointments_emit_rule_event
  after update of status on public.appointments
  for each row execute function private.emit_appointment_outcome_event();

-- ---------------------------------------------------------------------------
-- patient_risk_scores -> risk_score_updated
-- ---------------------------------------------------------------------------

create or replace function private.emit_risk_score_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform private.emit_clinical_rule_event(
      new.organisation_id,
      new.patient_id,
      'risk_score_updated',
      jsonb_strip_nulls(jsonb_build_object(
        'score_type',    new.score_type,
        'score',         new.score,
        'risk_level',    new.risk_level,
        'model_version', new.model_version
      )),
      'db_trigger', 'patient_risk_scores', new.id, new.computed_at,
      'risk_score:' || new.id::text
    );
  exception when others then
    null;
  end;
  return null;
end;
$$;

create trigger patient_risk_scores_emit_rule_event
  after insert on public.patient_risk_scores
  for each row execute function private.emit_risk_score_event();

-- ---------------------------------------------------------------------------

revoke all on function private.emit_vital_recorded_event() from public, anon;
revoke all on function private.emit_screening_result_event() from public, anon;
revoke all on function private.emit_medication_prescribed_event() from public, anon;
revoke all on function private.emit_appointment_outcome_event() from public, anon;
revoke all on function private.emit_risk_score_event() from public, anon;

comment on function private.emit_vital_recorded_event() is
  'Additive AFTER INSERT emitter putting every vital sign onto the rules-engine queue (§32.7). Swallows its own exceptions by design: the queue must never be able to reject a clinical record. Does not replace or interact with the existing red-flag triggers on this table.';
