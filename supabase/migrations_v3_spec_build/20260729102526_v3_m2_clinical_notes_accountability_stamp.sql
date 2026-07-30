-- M2: build spec v3 §4 requires "store the model in force on every signature row... so
-- historical notes remain interpretable after a switch". Stamping this from the client would
-- make it spoofable (and would require every future M8 note-writing screen to independently get
-- it right) -- same server-derived-never-client-supplied discipline as every other attribution
-- field in this codebase. Forces both columns from server truth on every insert, overriding
-- whatever the caller supplied (including NULL, which the NOT NULL constraints would otherwise
-- reject on their own).
create or replace function private.stamp_clinical_note_accountability() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select accountability_model into new.accountability_model_at_signing from app_config where id = true;
  select mdcn_number into new.mdcn_number_at_signing from clinicians where id = new.clinician_id;
  if new.mdcn_number_at_signing is null then
    raise exception 'ACTIVATION: clinical_notes.clinician_id % does not resolve to a clinicians row with an mdcn_number', new.clinician_id;
  end if;
  return new;
end;
$$;

create trigger stamp_clinical_note_accountability_trigger
  before insert on clinical_notes
  for each row execute function private.stamp_clinical_note_accountability();
