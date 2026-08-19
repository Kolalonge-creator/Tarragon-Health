-- A doctor's plain-language interpretation of an uploaded lab result, and the
-- next steps if something needs attention, must:
--   1. never be markable "sent" with no interpretation text (constraint),
--   2. save atomically with an in-app clinical notification firing exactly
--      once in the same transaction, and
--   3. be frozen once sent — a correction goes through care_messages, not a
--      silent edit (packages/db/tests/blood_profile_provenance.sql's "every
--      negative needs a positive control" idiom, so the positive send in #2
--      is what proves #1 and #4 aren't just blocking everything).
--
-- Run:  npx supabase db query --linked -f packages/db/tests/lab_result_document_patient_interpretation.sql
-- (from the MAIN checkout — see reference_supabase_cli_sql_access)

begin;

do $$
declare
  v_patient uuid;
  v_org uuid;
  v_doc uuid;
  v_notif_count int;
  v_row public.lab_result_documents%rowtype;
  v_failed boolean;
begin
  select id, organisation_id into v_patient, v_org from public.profiles where role = 'patient' limit 1;
  if v_patient is null then raise exception 'SETUP: no patient found'; end if;

  insert into public.lab_result_documents
    (organisation_id, patient_id, file_path, original_filename, mime_type, source)
  values (v_org, v_patient, 'test/interp.pdf', 'interp.pdf', 'application/pdf', 'patient')
  returning id into v_doc;

  -- 1. NEGATIVE: cannot set interpretation_sent_at without text (constraint).
  v_failed := false;
  begin
    update public.lab_result_documents
    set interpretation_sent_at = now()
    where id = v_doc;
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 1: sent_at accepted with no interpretation text'; end if;
  raise notice 'PASS 1: constraint rejects sent_at with no text';

  -- 2. POSITIVE CONTROL: set both together -> frozen + notification fired.
  update public.lab_result_documents
  set patient_interpretation = 'Your cholesterol is a little high.',
      next_steps = 'Cut back on fried food and recheck in 3 months.',
      interpretation_sent_at = now()
  where id = v_doc;

  select * into v_row from public.lab_result_documents where id = v_doc;
  if v_row.patient_interpretation is distinct from 'Your cholesterol is a little high.' then
    raise exception 'FAIL 2: interpretation text did not save';
  end if;
  if v_row.interpretation_sent_at is null then
    raise exception 'FAIL 2b: interpretation_sent_at was not stamped';
  end if;
  raise notice 'PASS 2: interpretation + next_steps saved, sent_at stamped';

  -- 3. Exactly one in-app, clinical-content-class notification fired.
  select count(*) into v_notif_count from public.notifications
  where recipient_id = v_patient and template = 'result_interpretation_ready'
    and channel = 'in_app' and content_class = 'clinical'
    and payload->>'document_id' = v_doc::text;
  if v_notif_count <> 1 then
    raise exception 'FAIL 3: expected exactly 1 notification, got %', v_notif_count;
  end if;
  raise notice 'PASS 3: exactly one in-app clinical notification fired';

  -- 4. NEGATIVE: cannot edit after sent (frozen).
  update public.lab_result_documents
  set patient_interpretation = 'CHANGED', next_steps = 'CHANGED'
  where id = v_doc;
  select * into v_row from public.lab_result_documents where id = v_doc;
  if v_row.patient_interpretation = 'CHANGED' then
    raise exception 'FAIL 4: interpretation was editable after being sent';
  end if;
  raise notice 'PASS 4: interpretation frozen after sent';

  raise notice 'ALL LAB RESULT INTERPRETATION CHECKS PASSED';
end $$;

rollback;
