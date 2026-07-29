-- M3: consent-before-measurement, enforced not just assumed (build spec v3 §8: "consent
-- (captured before any measurement)"). Same discipline as I5 (urgent closure requires a live
-- contact) and I1 (no clinical content on open rails): a sequencing rule this important is a DB
-- constraint, not a UI-ordering convention a rushed field operator could route around.
create or replace function private.enforce_screening_consent_before_measurement() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_consented boolean;
begin
  if new.source <> 'screening_day' then
    return new;
  end if;

  select consented into v_consented
  from screening_participants
  where screening_event_id = new.screening_event_id
    and patient_id = new.patient_id;

  if v_consented is null then
    raise exception 'M3: screening-day reading rejected -- no screening_participants row (screening_event_id=%, patient_id=%) exists for this patient at this event. Capture the participant (and their consent) before taking any measurement.', new.screening_event_id, new.patient_id
      using errcode = '23514';
  end if;

  if v_consented is not true then
    raise exception 'M3: screening-day reading rejected -- this participant has not consented (screening_participants.consented is not true). No measurement may proceed.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger enforce_screening_consent_before_measurement_trigger
  before insert on readings
  for each row execute function private.enforce_screening_consent_before_measurement();
