-- S23c: record, on a clinician's draft encounter note, that its text came from the AI scribe.
--
-- Encounter notes are closed to direct writes (S05d, INV-10): they are written only through audited functions. The scribe
-- needs one more: after a clinician has used an AI draft in the note form and is saving it, this attaches the consent the
-- draft was made under, the patient-facing summary and ai_drafted = true. It writes only to a DRAFT note the caller may work
-- on, and only while the consent is still granted, unrevoked and for this very note and patient (INV-11, safety case 14).
-- Signing stays the existing finalize_encounter_note path (outcome and identity confirmation still required).

begin;

create or replace function public.attach_scribe_draft_to_note(
  p_note uuid,
  p_consent uuid,
  p_patient_summary text,
  p_summary_language text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid;
  v_status  text;
  c         record;
begin
  v_patient := private.may_work_on_note(p_note);

  select status into v_status from public.clinical_encounter_notes where id = p_note;
  if v_status <> 'draft' then
    raise exception 'This encounter note is finalized and cannot be edited.' using errcode = '42501';
  end if;

  select * into c from public.scribe_consents where id = p_consent;
  if c.id is null
     or not c.granted
     or c.revoked_at is not null
     or c.encounter_note_id is distinct from p_note
     or c.patient_id <> v_patient then
    raise exception 'Scribe consent is not active for this encounter.' using errcode = '42501';
  end if;

  update public.clinical_encounter_notes
     set scribe_consent_id = p_consent,
         patient_summary = nullif(btrim(p_patient_summary), ''),
         patient_summary_language = p_summary_language,
         ai_drafted = true
   where id = p_note;
end;
$$;

comment on function public.attach_scribe_draft_to_note(uuid, uuid, text, text) is
  'Marks a draft encounter note as AI-scribe drafted: stores the consent it was made under, the patient summary and ai_drafted. Draft notes only, and only while the consent is granted, unrevoked and bound to this note and patient.';

revoke all on function public.attach_scribe_draft_to_note(uuid, uuid, text, text) from public, anon;
grant execute on function public.attach_scribe_draft_to_note(uuid, uuid, text, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.attach_scribe_draft_to_note(uuid, uuid, text, text)', 'EXECUTE') then
    raise exception 'anon can execute attach_scribe_draft_to_note';
  end if;
  if not has_function_privilege('authenticated', 'public.attach_scribe_draft_to_note(uuid, uuid, text, text)', 'EXECUTE') then
    raise exception 'authenticated cannot execute attach_scribe_draft_to_note';
  end if;
end $$;

commit;
