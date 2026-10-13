-- S23x proof: the scribe consent rule (Q18) holds in the database, not only in scribe-draft (migration *_s23x_scribe_consent_database_enforcement.sql).
-- One rolled-back transaction. Proves, for scribe_transcripts and for clinical_encounter_notes.scribe_consent_id:
--   a granted, unrevoked consent for the same organisation (and note, and patient) is accepted; a missing, declined, revoked, other-
--   organisation, other-note or other-patient consent is refused; a note that already carries a consent that was LATER revoked can still
--   be edited (history is not blocked); the trigger functions are not callable by clients.
-- SABOTAGE: both triggers dropped; the refusals must stop happening (the refusal checks must flip).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;

create or replace function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's23x-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S23x ' || p_label, (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_org2 uuid; v_pat uuid; v_pat2 uuid; v_doc uuid := gen_random_uuid(); v_staff uuid := gen_random_uuid();
  v_note uuid := gen_random_uuid(); v_note2 uuid := gen_random_uuid(); v_nonote uuid := gen_random_uuid();
  c_ok uuid := gen_random_uuid(); c_declined uuid := gen_random_uuid(); c_revoked uuid := gen_random_uuid(); c_other_note uuid := gen_random_uuid();
  c_untied uuid := gen_random_uuid(); c_other_pat uuid := gen_random_uuid(); c_other_org uuid := gen_random_uuid();
  v_s text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, 'patient2', 'patient');
  select id into v_org2 from public.organisations where id <> v_org order by created_at limit 1;
  if v_org2 is null then v_org2 := gen_random_uuid(); end if;

  -- Fixtures are written with triggers and foreign keys off (replica mode); the rules under test are then switched back on.
  set local session_replication_role = replica;
  insert into public.clinical_encounter_notes (id, organisation_id, patient_id, encounter_type, reason_for_encounter) values
    (v_note, v_org, v_pat, 'other', 'proof note'), (v_note2, v_org, v_pat, 'other', 'proof note 2'), (v_nonote, v_org, v_pat, 'other', 'proof note 3');
  insert into public.scribe_consents (id, organisation_id, patient_id, encounter_note_id, clinician_staff_id, clinician_profile_id, granted, language, revoked_at) values
    (c_ok,         v_org,  v_pat,  v_note,  v_staff, v_doc, true,  'en-NG', null),
    (c_declined,   v_org,  v_pat,  v_note,  v_staff, v_doc, false, 'en-NG', null),
    (c_revoked,    v_org,  v_pat,  v_note,  v_staff, v_doc, true,  'en-NG', now()),
    (c_other_note, v_org,  v_pat,  v_note2, v_staff, v_doc, true,  'en-NG', null),
    (c_untied,     v_org,  v_pat,  null,    v_staff, v_doc, true,  'en-NG', null),
    (c_other_pat,  v_org,  v_pat2, v_note,  v_staff, v_doc, true,  'en-NG', null),
    (c_other_org,  v_org2, v_pat,  v_note,  v_staff, v_doc, true,  'en-NG', null);
  set local session_replication_role = origin;
  -- The note's other triggers (attribution, hash, timeline) are about who may write a note, not about consent: they are switched off
  -- for this rolled-back run so that only the consent rule under test decides the outcome.
  alter table public.clinical_encounter_notes disable trigger user;
  alter table public.clinical_encounter_notes enable trigger clinical_encounter_notes_require_active_scribe_consent;

  -- scribe_transcripts ---------------------------------------------------------------------------
  -- An accepted row passes the trigger and then meets the real foreign keys (the fixture note and consent exist; the staff row does not matter here).
  begin insert into public.scribe_transcripts (organisation_id, scribe_consent_id, encounter_note_id, segments_encrypted, duration_ms, language) values (v_org, c_ok, v_note, '\x00', 1, 'en-NG'); v_s := 'accepted'; exception when others then v_s := sqlstate; end;
  insert into results values ('real', 'transcript: granted, unrevoked, same note and organisation is accepted', 'accepted', v_s);
  begin insert into public.scribe_transcripts (organisation_id, scribe_consent_id, encounter_note_id, segments_encrypted, duration_ms, language) values (v_org, c_declined, v_note, '\x00', 1, 'en-NG'); v_s := 'accepted'; exception when others then v_s := sqlstate || ':' || sqlerrm; end;
  insert into results values ('real', 'transcript: a declined consent is refused', '42501:scribe_consent_not_active', v_s);
  begin insert into public.scribe_transcripts (organisation_id, scribe_consent_id, encounter_note_id, segments_encrypted, duration_ms, language) values (v_org, c_revoked, v_note, '\x00', 1, 'en-NG'); v_s := 'accepted'; exception when others then v_s := sqlstate || ':' || sqlerrm; end;
  insert into results values ('real', 'transcript: a revoked consent is refused', '42501:scribe_consent_not_active', v_s);
  begin insert into public.scribe_transcripts (organisation_id, scribe_consent_id, encounter_note_id, segments_encrypted, duration_ms, language) values (v_org, gen_random_uuid(), v_note, '\x00', 1, 'en-NG'); v_s := 'accepted'; exception when others then v_s := sqlstate || ':' || sqlerrm; end;
  insert into results values ('real', 'transcript: a consent that does not exist is refused', '42501:scribe_consent_not_active', v_s);
  begin insert into public.scribe_transcripts (organisation_id, scribe_consent_id, encounter_note_id, segments_encrypted, duration_ms, language) values (v_org, c_other_note, v_note, '\x00', 1, 'en-NG'); v_s := 'accepted'; exception when others then v_s := sqlstate || ':' || sqlerrm; end;
  insert into results values ('real', 'transcript: a consent recorded for another encounter is refused', '42501:scribe_consent_other_encounter', v_s);
  begin insert into public.scribe_transcripts (organisation_id, scribe_consent_id, encounter_note_id, segments_encrypted, duration_ms, language) values (v_org, c_ok, null, '\x00', 1, 'en-NG'); v_s := 'accepted'; exception when others then v_s := sqlstate || ':' || sqlerrm; end;
  insert into results values ('real', 'transcript: a transcript with no encounter cannot use a consent tied to one', '42501:scribe_consent_other_encounter', v_s);
  begin insert into public.scribe_transcripts (organisation_id, scribe_consent_id, encounter_note_id, segments_encrypted, duration_ms, language) values (v_org, c_other_org, v_note, '\x00', 1, 'en-NG'); v_s := 'accepted'; exception when others then v_s := sqlstate || ':' || sqlerrm; end;
  insert into results values ('real', 'transcript: a consent from another organisation is refused', '42501:scribe_consent_other_organisation', v_s);
  begin insert into public.scribe_transcripts (organisation_id, scribe_consent_id, encounter_note_id, segments_encrypted, duration_ms, language) values (v_org, c_untied, v_note2, '\x00', 1, 'en-NG'); v_s := 'accepted'; exception when others then v_s := sqlstate; end;
  insert into results values ('real', 'transcript: an untied granted consent is accepted for a note', 'accepted', v_s);

  -- clinical_encounter_notes.scribe_consent_id ----------------------------------------------------
  update public.clinical_encounter_notes set scribe_consent_id = c_ok where id = v_note;
  insert into results values ('real', 'note: the right consent can be attached', c_ok::text, (select scribe_consent_id::text from public.clinical_encounter_notes where id = v_note));
  begin update public.clinical_encounter_notes set scribe_consent_id = c_declined where id = v_note2; v_s := 'accepted'; exception when others then v_s := sqlstate || ':' || sqlerrm; end;
  insert into results values ('real', 'note: a declined consent cannot be attached', '42501:scribe_consent_not_active', v_s);
  begin update public.clinical_encounter_notes set scribe_consent_id = c_revoked where id = v_note2; v_s := 'accepted'; exception when others then v_s := sqlstate || ':' || sqlerrm; end;
  insert into results values ('real', 'note: a revoked consent cannot be attached', '42501:scribe_consent_not_active', v_s);
  begin update public.clinical_encounter_notes set scribe_consent_id = c_ok where id = v_note2; v_s := 'accepted'; exception when others then v_s := sqlstate || ':' || sqlerrm; end;
  insert into results values ('real', 'note: a consent for another encounter cannot be attached (a plain UPDATE no longer bypasses attach_scribe_draft_to_note)', '42501:scribe_consent_other_encounter', v_s);
  begin update public.clinical_encounter_notes set scribe_consent_id = c_other_pat where id = v_note; v_s := 'accepted'; exception when others then v_s := sqlstate || ':' || sqlerrm; end;
  insert into results values ('real', 'note: another patient''s consent cannot be attached', '42501:scribe_consent_other_patient', v_s);
  begin update public.clinical_encounter_notes set scribe_consent_id = c_other_org where id = v_note; v_s := 'accepted'; exception when others then v_s := sqlstate || ':' || sqlerrm; end;
  insert into results values ('real', 'note: another organisation''s consent cannot be attached', '42501:scribe_consent_other_patient', v_s);
  begin insert into public.clinical_encounter_notes (organisation_id, patient_id, encounter_type, reason_for_encounter, scribe_consent_id) values (v_org, v_pat, 'other', 'x', c_declined); v_s := 'accepted'; exception when others then v_s := sqlstate || ':' || sqlerrm; end;
  insert into results values ('real', 'note: a new note cannot be created carrying a declined consent', '42501:scribe_consent_not_active', v_s);
  -- later revocation does not freeze the note
  set local session_replication_role = replica;
  update public.scribe_consents set revoked_at = now() where id = c_ok;
  set local session_replication_role = origin;
  begin update public.clinical_encounter_notes set reason_for_encounter = 'edited after revocation' where id = v_note; v_s := 'accepted'; exception when others then v_s := sqlstate; end;
  insert into results values ('real', 'note: an edit to a note whose consent was later revoked is not blocked', 'accepted', v_s);
  begin update public.clinical_encounter_notes set scribe_consent_id = scribe_consent_id where id = v_note; v_s := 'accepted'; exception when others then v_s := sqlstate; end;
  insert into results values ('real', 'note: re-saving the same consent id is not blocked', 'accepted', v_s);

  insert into results values ('real', 'no client can execute the trigger functions', '0',
    (select count(*)::text from (values ('private.require_active_scribe_consent_for_transcript()'), ('private.require_active_scribe_consent_for_note()')) f(fn)
      where has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE')));

  -- SABOTAGE: both triggers dropped, the refusals must stop -------------------------------------------
  drop trigger scribe_transcripts_require_active_consent on public.scribe_transcripts;
  drop trigger clinical_encounter_notes_require_active_scribe_consent on public.clinical_encounter_notes;
  begin insert into public.scribe_transcripts (organisation_id, scribe_consent_id, encounter_note_id, segments_encrypted, duration_ms, language) values (v_org, c_declined, v_note, '\x00', 1, 'en-NG'); v_s := 'accepted'; exception when others then v_s := sqlstate || ':' || sqlerrm; end;
  insert into results values ('sabotaged', 'transcript: a declined consent is refused (trigger dropped)', '42501:scribe_consent_not_active', v_s);
  begin update public.clinical_encounter_notes set scribe_consent_id = c_declined where id = v_note2; v_s := 'accepted'; exception when others then v_s := sqlstate || ':' || sqlerrm; end;
  insert into results values ('sabotaged', 'note: a declined consent cannot be attached (trigger dropped)', '42501:scribe_consent_not_active', v_s);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S23x proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: expected both sabotages (triggers dropped) to fail their checks, only % did', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
