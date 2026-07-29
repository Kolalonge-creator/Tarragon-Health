-- I5: a clinical_notes row that closes (references) an urgent/emergency classification must be
-- linked to a voice or synchronous_in_app clinical_contacts row. Cannot be defeated via the API.
create or replace function private.enforce_urgent_closure_requires_contact() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_classification triage_class;
  v_contact_type contact_type;
begin
  if new.linked_classification_id is not null then
    select classification into v_classification
    from triage_classifications where id = new.linked_classification_id;

    if v_classification in ('urgent','emergency') then
      if new.linked_contact_id is null then
        raise exception 'I5: closing an urgent/emergency classification requires a linked voice or synchronous_in_app clinical_contacts row (got no linked_contact_id)';
      end if;
      select contact_type into v_contact_type
      from clinical_contacts where id = new.linked_contact_id;
      if v_contact_type not in ('voice','synchronous_in_app') then
        raise exception 'I5: closing an urgent/emergency classification requires contact_type voice or synchronous_in_app, got %', v_contact_type;
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_i5_urgent_closure
  before insert on clinical_notes
  for each row execute function private.enforce_urgent_closure_requires_contact();

-- I10: every clinical action writes a patient-visible proof_log row. Populated by triggers only,
-- so it can never be forgotten by application code.
create or replace function private.write_proof_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_patient_id uuid;
  v_actor_profile_id uuid;
  v_actor_display text;
  v_summary text;
  v_event_type text;
begin
  if tg_table_name = 'clinical_notes' then
    v_patient_id := new.patient_id;
    select p.id, ('Dr ' || p.full_name || ' (MDCN ' || new.mdcn_number_at_signing || ')')
      into v_actor_profile_id, v_actor_display
      from clinicians c join profiles p on p.id = c.profile_id where c.id = new.clinician_id;
    v_summary := coalesce(v_actor_display, 'Your care team') || ' completed a ' || new.note_type || ' note for you.';
    v_event_type := 'review_completed';

  elsif tg_table_name = 'triage_classifications' then
    v_patient_id := new.patient_id;
    v_actor_display := 'Tarragon Health';
    v_summary := 'A reading you logged was reviewed and classified as ' || new.classification || '.';
    v_event_type := 'reading_classified';

  elsif tg_table_name = 'escalations' then
    v_patient_id := new.patient_id;
    v_actor_profile_id := new.raised_by;
    v_actor_display := 'Tarragon Health';
    v_summary := 'Your care team was notified about a reading that needs attention (' || new.criticality || ').';
    v_event_type := 'escalation_raised';

  elsif tg_table_name = 'medication_dispenses' then
    v_patient_id := new.patient_id;
    v_actor_display := 'Tarragon Health';
    v_summary := 'Your medication was dispensed: ' || new.quantity || ' units, ' || new.days_supply || ' days supply, verification ' || new.verification || '.';
    v_event_type := 'contact_made';
  end if;

  insert into proof_log (patient_id, event_type, actor_profile_id, actor_display, summary, source_table, source_id)
  values (v_patient_id, v_event_type, v_actor_profile_id, coalesce(v_actor_display, 'Tarragon Health'), v_summary, tg_table_name, new.id);

  return new;
end;
$$;

create trigger proof_log_clinical_notes after insert on clinical_notes
  for each row execute function private.write_proof_log();
create trigger proof_log_triage_classifications after insert on triage_classifications
  for each row execute function private.write_proof_log();
create trigger proof_log_escalations after insert on escalations
  for each row execute function private.write_proof_log();
create trigger proof_log_medication_dispenses after insert on medication_dispenses
  for each row execute function private.write_proof_log();

