-- S05d part 2: close the direct path on clinical_encounter_notes (INV-10, INV-12). Apply only after the code that uses the S05d
-- functions has deployed (create_encounter_note, update_encounter_note_draft, finalize_encounter_note,
-- read_patient_encounter_notes_audited, my_pending_auto_drafted_notes).
--
-- Counted first (live): 0 rows. Readers and writers re-checked after the deploy: no `.from("clinical_encounter_notes")` remains in the
-- application; every staff read and write goes through the functions, which apply the tie; the auto-draft triggers, the timeline and
-- encounter-sync triggers and the amendment validator are SECURITY DEFINER.
-- The table keeps RLS on with no policy: the definer functions, the triggers and the service role are the only paths. A patient never
-- reads a clinical note (OQ-58: the consultation summary is what she sees).

drop policy if exists clinical_encounter_notes_select on public.clinical_encounter_notes;
drop policy if exists clinical_encounter_notes_insert on public.clinical_encounter_notes;
drop policy if exists clinical_encounter_notes_update on public.clinical_encounter_notes;
drop policy if exists clinical_encounter_notes_select_own_signed on public.clinical_encounter_notes;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clinical_encounter_notes') then
    raise exception 'S05d assertion: a policy remains on clinical_encounter_notes';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.clinical_encounter_notes'::regclass) then
    raise exception 'S05d assertion: RLS is off on clinical_encounter_notes';
  end if;
end $$;
