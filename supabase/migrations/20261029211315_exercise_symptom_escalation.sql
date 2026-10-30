-- P4 follow-up: a symptom reported during exercise reaches the care team, on the same terms as every other dangerous patient-logged symptom.
--
-- Review finding on exercise_session_logs (20261029204012): symptom_during ("chest pain, dizziness or unusual breathlessness during it") was stored and
-- shown to tied staff, but nothing told anyone. This adds the missing route, following the existing symptom pipeline (private.handle_symptom_red_flag):
--   * Member (private.patient_has_feature_access 'vitals_red_flag_doctor_escalation', the same gate and the same fail-toward-escalating behaviour):
--     one clinician_alerts row, level clinician_review, type symptom_escalation, SLA from private.escalation_sla_minutes('symptom_red_flag',
--     'clinician_review') (data, not a number here). The existing classify/assign trigger routes it and marks repeats as duplicates via dedup_key.
--   * Everyone else: no doctor time (Free consumes none); the patient gets the same in-app self-care suggestion the symptom and vitals pipelines give.
-- Deliberately NOT a page: unlike a logged symptom there is no severity score, and one is not invented here. It is a queue item with an SLA.
-- The trigger is not wrapped in an exception handler: if the alert cannot be written, the log fails loudly and the patient is told to try again.

create or replace function private.exercise_symptom_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.symptom_during then
    return new;
  end if;

  if private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation') then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at, category, type_code, dedup_key)
    values (
      new.organisation_id,
      new.patient_id,
      'clinician_review',
      'open',
      'Symptom during exercise',
      format('Patient logged %s minutes of %s on %s and reported chest pain, dizziness or unusual breathlessness during it.%s',
             new.duration_minutes, new.kind, new.performed_on,
             case when new.note is not null then ' Note: ' || new.note else '' end),
      now() + (private.escalation_sla_minutes('symptom_red_flag', 'clinician_review') * interval '1 minute'),
      'clinical',
      'symptom_escalation',
      'exercise_symptom:' || new.patient_id::text
    );
  else
    perform private.raise_dangerous_reading_ai_suggestion(
      new.organisation_id, new.patient_id, 'chest pain, dizziness or breathlessness during exercise', 'Needs attention',
      'You told us you had chest pain, dizziness or unusual breathlessness while exercising. Please stop and rest. If it does not ease, or you feel faint, go to the nearest hospital now. Even if it passes, have it checked before your next session.'
    );
  end if;

  return new;
end $$;

revoke all on function private.exercise_symptom_escalation() from public, anon, authenticated;

create trigger exercise_session_logs_symptom_escalation
  after insert on public.exercise_session_logs
  for each row when (new.symptom_during)
  execute function private.exercise_symptom_escalation();

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.exercise_session_logs'::regclass and tgname = 'exercise_session_logs_symptom_escalation') then
    raise exception 'exercise symptom escalation trigger is missing';
  end if;
  if has_function_privilege('anon', 'private.exercise_symptom_escalation()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.exercise_symptom_escalation()', 'EXECUTE') then
    raise exception 'exercise_symptom_escalation is callable by an API role';
  end if;
end $$;
