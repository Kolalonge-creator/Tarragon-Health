-- Tarragon Health
-- Wires clinical_encounter_notes into the unified patient_timeline feed
-- (20260717221852), same pattern as every other source table there: a
-- SECURITY DEFINER trigger writes a short display summary via
-- private.record_timeline_event, source data stays authoritative in the
-- originating table. Fires only on the draft->finalized transition -- a
-- draft being edited is not yet a clinical event worth surfacing, and a
-- finalized note can never change again (enforced by
-- private.enforce_clinical_encounter_note_attribution), so this can only
-- ever fire once per note.

create or replace function private.timeline_from_encounter_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'finalized' and old.status is distinct from 'finalized' then
    perform private.record_timeline_event(
      new.organisation_id, new.patient_id, 'encounter_documented',
      'clinical_encounter_notes', new.id,
      'Clinical note finalized',
      coalesce(nullif(new.diagnosis, ''), new.reason_for_encounter),
      new.finalized_at,
      new.finalized_by_staff,
      jsonb_build_object(
        'encounter_type', new.encounter_type,
        'video_consultation_id', new.video_consultation_id,
        'escalation_id', new.escalation_id
      )
    );
  end if;
  return new;
end;
$$;

comment on function private.timeline_from_encounter_note() is
  'Writes a patient_timeline entry when a clinical_encounter_notes row transitions draft -> finalized. Can only fire once per note, since a finalized note is immutable.';

drop trigger if exists clinical_encounter_notes_timeline on public.clinical_encounter_notes;
create trigger clinical_encounter_notes_timeline
  after update of status on public.clinical_encounter_notes
  for each row execute function private.timeline_from_encounter_note();

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.clinical_encounter_notes'::regclass
      and tgname = 'clinical_encounter_notes_timeline'
      and not tgisinternal
  ) then
    raise exception 'clinical_encounter_notes_timeline trigger missing';
  end if;

  raise notice 'PASS: clinical_encounter_notes wired into patient_timeline';
end $$;
