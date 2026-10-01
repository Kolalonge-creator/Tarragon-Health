-- S05 follow-up (OQ-58, founder decision 2026-10-01): patients see the published consultation summary only, not the clinical note.
-- Reverses the patient policy added in 20261001004126. INV-11 still holds: no draft or AI draft is ever patient-visible, and the
-- patient's view of a consultation is consultation_patient_summaries, which a clinician publishes.
--
-- Counted first (live): clinical_encounter_notes 0 rows, so no patient access is withdrawn from anyone.

drop policy if exists clinical_encounter_notes_select_own_signed on public.clinical_encounter_notes;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clinical_encounter_notes'
               and cmd = 'SELECT' and qual ilike '%auth.uid%patient_id%' and qual not ilike '%is_org_staff%') then
    raise exception 'S05 assertion: a patient-readable policy remains on clinical_encounter_notes';
  end if;
end $$;
