-- S23x (S11-S15 package P4): the scribe consent rule (CMO decision Q18: explicit, recorded consent for EACH encounter) enforced in the
-- database on the two rows that carry a consent id, not only in the scribe-draft function.
--
-- What already held: scribe-draft refuses a consent that is missing, declined, revoked or recorded for another encounter, and
-- public.attach_scribe_draft_to_note (S23c) refuses the same when it sets clinical_encounter_notes.scribe_consent_id.
-- What did not: (1) scribe_transcripts_insert_staff lets any org staff insert a transcript row pointing at ANY existing consent
-- (the foreign key only proves the consent exists, so a declined, revoked or other-encounter consent was accepted); (2) a plain UPDATE of
-- clinical_encounter_notes.scribe_consent_id (a clinician can update their own draft note) bypassed attach_scribe_draft_to_note.
-- Row counts before (live, 2026-10-13): scribe_transcripts 0, scribe_consents 0, so nothing is converted or backfilled.
--
-- Rules (both triggers, invoker-independent: they read the consent as the table owner):
--   * the consent must exist, be granted, not revoked, and belong to the same organisation;
--   * if the consent is tied to a note (encounter_note_id), the row must be that note: a transcript's encounter_note_id, or the note itself;
--   * a note's consent must be for the same patient.
-- The note trigger fires only when scribe_consent_id is set or changed, so reading, signing or amending an old note whose consent was
-- later revoked is not blocked (history is kept; revoking a consent deletes the transcript, S21g).

create function private.require_active_scribe_consent_for_transcript() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare c public.scribe_consents%rowtype;
begin
  select * into c from public.scribe_consents where id = new.scribe_consent_id;
  if not found or not c.granted or c.revoked_at is not null then
    raise exception 'scribe_consent_not_active' using errcode = '42501';
  end if;
  if c.organisation_id <> new.organisation_id then
    raise exception 'scribe_consent_other_organisation' using errcode = '42501';
  end if;
  if c.encounter_note_id is not null and new.encounter_note_id is distinct from c.encounter_note_id then
    raise exception 'scribe_consent_other_encounter' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.require_active_scribe_consent_for_transcript() from public, anon, authenticated;
create trigger scribe_transcripts_require_active_consent before insert on public.scribe_transcripts
  for each row execute function private.require_active_scribe_consent_for_transcript();

create function private.require_active_scribe_consent_for_note() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare c public.scribe_consents%rowtype;
begin
  if new.scribe_consent_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.scribe_consent_id is not distinct from old.scribe_consent_id then return new; end if;
  select * into c from public.scribe_consents where id = new.scribe_consent_id;
  if not found or not c.granted or c.revoked_at is not null then
    raise exception 'scribe_consent_not_active' using errcode = '42501';
  end if;
  if c.patient_id <> new.patient_id or c.organisation_id <> new.organisation_id then
    raise exception 'scribe_consent_other_patient' using errcode = '42501';
  end if;
  if c.encounter_note_id is not null and c.encounter_note_id <> new.id then
    raise exception 'scribe_consent_other_encounter' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.require_active_scribe_consent_for_note() from public, anon, authenticated;
create trigger clinical_encounter_notes_require_active_scribe_consent before insert or update of scribe_consent_id on public.clinical_encounter_notes
  for each row execute function private.require_active_scribe_consent_for_note();

do $$
begin
  if has_function_privilege('anon', 'private.require_active_scribe_consent_for_transcript()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.require_active_scribe_consent_for_transcript()', 'EXECUTE')
     or has_function_privilege('anon', 'private.require_active_scribe_consent_for_note()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.require_active_scribe_consent_for_note()', 'EXECUTE') then
    raise exception 'S23x assertion: a scribe consent trigger function is callable by a client';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.scribe_transcripts'::regclass and tgname = 'scribe_transcripts_require_active_consent')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.clinical_encounter_notes'::regclass and tgname = 'clinical_encounter_notes_require_active_scribe_consent') then
    raise exception 'S23x assertion: a scribe consent trigger is missing';
  end if;
end $$;
