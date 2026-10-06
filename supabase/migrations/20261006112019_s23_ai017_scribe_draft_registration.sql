-- S23 step 4: register AI-017 scribeDraft in ai_systems
-- Registered DISABLED. The scribe stays off until OQ-96's STT vendor scoring
-- is complete and the founder enables it. Fail-closed: the fallback is the
-- existing manual note editor, which costs nothing.

begin;

insert into public.ai_systems (
  code, name, description,
  risk_class, autonomy_level,
  is_enabled, runtime_governed,
  fallback_behaviour
) values (
  'AI-017',
  'Scribe Draft',
  'Generates a structured clinical note draft from an STT transcript of a patient consultation. '
  || 'The clinician reviews and edits the draft before signing it into the patient record (INV-11). '
  || 'Never writes medications, doses or prescribing instructions (INV-02).',
  'high',
  'assistive',
  false,   -- disabled until STT vendor scoring (OQ-96)
  false,   -- no runtime governance until enabled and proven
  'Manual note entry via the existing clinical_encounter_notes editor. '
  || 'The pre-existing path; every consultation worked this way before the scribe.'
) on conflict (code) do nothing;

-- ── closing assertion: ai_systems row count must match system-codes.ts ──
-- system-codes.ts will have 17 keys after this session adds scribeDraft.
-- This assertion catches a mismatch between the DB and the code-side mirror.
do $$
declare
  db_count integer;
begin
  select count(*) into db_count from public.ai_systems;
  if db_count < 17 then
    raise exception 'ai_systems has % rows, expected at least 17 after AI-017 registration', db_count;
  end if;
end $$;

commit;
