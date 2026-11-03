-- ===========================================================================
-- Proof: a doctor's line for the family (20261103230825_family_doctor_note.sql).
--   1. Writing: the doctor who held this patient's completed consultation writes a note; organisation and test flag come from the patient,
--      never the caller. Refused: an unfinished consultation, another doctor, a care coordinator (even on their own completed
--      consultation), a doctor naming another doctor as author, the patient, a stranger, more than 280 characters. Nobody updates a note
--      (no grant, and a trigger refuses it even for the table owner).
--   2. Reading the table: the patient reads their own, the author reads theirs, a stranger, another doctor and every supporter read none.
--   3. Patient first: a new note reaches NO supporter until the patient shares that note (set_family_note_shared, patient only; a
--      supporter, the author and a stranger are refused); the patient sees every note first (my_family_notes) with the doctor's name
--      null-gated; family sees only the LATEST RELEASED note; un-sharing falls back to an older released note, then to none; "don't share"
--      is remembered. The trigger lets only the release columns change, and only from inside the function. A supporter without
--      doctor_note gets no block at all; the patient grants and revokes doctor_note; a paused circle shares nothing. A doctor in another
--      organisation who held the completed consultation may write (the assignment is the authority).
--   4. anon reaches nothing; signed-in users cannot set the organisation, test flag or release columns.
--   5. SABOTAGE (each must flip): permission test removed; writer test opened; release filter removed (an unreleased note reaches family);
--      the patient check removed from the release function; the release flag check removed from the trigger; organisation equality put
--      back (the assigned cross-organisation doctor is refused).
-- BEGIN/ROLLBACK; mints its own fixtures. Encounters and clinical_staff rows are fixture-written with triggers off (session_replication_role)
-- so the proof does not depend on booking and credentialing, which have their own proofs.
-- ===========================================================================
begin;
create temp table fn_results (check_name text, observed text, expected text, verdict text);
grant all on fn_results to public;

create function pg_temp.mkuser(p_name text, p_role text default 'patient') returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_org uuid := (select id from public.organisations order by created_at limit 1);
begin
  perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'fn-' || replace(v::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, v_org, 'patient'::public.user_role, p_name, '+23482' || lpad((floor(random() * 99999999))::integer::text, 8, '0'), date '1970-01-01', true)
  on conflict (id) do update set full_name = excluded.full_name, is_test = true;
  if p_role <> 'patient' then
    set local session_replication_role = replica;
    update public.profiles set role = p_role::public.user_role, receives_care = false where id = v;
    set local session_replication_role = origin;
  end if;
  return v;
end $$;
create function pg_temp.mkstaff(p_profile uuid, p_name text, p_tier text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.clinical_staff (id, organisation_id, profile_id, full_name, doctor_tier, active, license_verified_at, is_test)
  values (v, (select organisation_id from public.profiles where id = p_profile), p_profile, p_name, p_tier::public.doctor_tier, true, now(), true);
  set local session_replication_role = origin;
  return v;
end $$;
create function pg_temp.mkenc(p_pat uuid, p_clin uuid, p_status text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.encounters (id, organisation_id, patient_id, clinician_id, type, status, scheduled_at, started_at, ended_at, policy_version, is_test)
  values (v, (select organisation_id from public.profiles where id = p_pat), p_pat, p_clin, 'video', p_status, now() - interval '2 hours',
          now() - interval '2 hours', case when p_status = 'completed' then now() - interval '1 hour' end, 1, true);
  set local session_replication_role = origin;
  return v;
end $$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  execute 'set local role authenticated';
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claims', '', true);
  return r;
end $$;
create function pg_temp.write_as(p_uid uuid, p_pat uuid, p_author uuid, p_enc uuid, p_body text) returns text language sql as $$
  select pg_temp.q_as(p_uid, format('insert into public.family_doctor_notes (patient_id, author_staff_id, encounter_id, body) values (%L, %L, %L, %L) returning ''ok''',
                                    p_pat, p_author, p_enc, p_body))
$$;
create function pg_temp.view_as(p_sup uuid, p_pat uuid) returns jsonb language plpgsql as $$
declare r text := pg_temp.q_as(p_sup, format('select public.circle_supporter_view(%L::uuid)::text', p_pat));
begin
  return case when r like 'ERR:%' then jsonb_build_object('error', r) else r::jsonb end;
end $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into fn_results values (p_name, p_actual, p_expected, case when p_actual is not distinct from p_expected then 'PASS' else 'FAIL' end) $$;

do $$
declare
  pt uuid; doc uuid; doc2 uuid; coord uuid; st uuid; s_bp uuid; s_note uuid; m_bp uuid;
  cs uuid; cs2 uuid; cs_coord uuid; e_done uuid; e_live uuid; e_coord uuid; r text; v jsonb; v_org uuid;
  n1 uuid; n2 uuid; v_org2 uuid; doc3 uuid; cs3 uuid; e_x uuid;
begin
  pt := pg_temp.mkuser('Fn Patient'); st := pg_temp.mkuser('Fn Stranger');
  doc := pg_temp.mkuser('Fn Doctor', 'clinician'); doc2 := pg_temp.mkuser('Fn Other Doctor', 'clinician'); coord := pg_temp.mkuser('Fn Coordinator', 'clinician');
  cs := pg_temp.mkstaff(doc, 'Dr Amara Eze', 'senior_medical_officer'); cs2 := pg_temp.mkstaff(doc2, 'Dr Bayo Ade', 'senior_medical_officer');
  cs_coord := pg_temp.mkstaff(coord, 'Fn Coordinator', 'care_coordinator');
  e_done := pg_temp.mkenc(pt, doc, 'completed'); e_live := pg_temp.mkenc(pt, doc, 'in_progress'); e_coord := pg_temp.mkenc(pt, coord, 'completed');
  select organisation_id into v_org from public.profiles where id = pt;
  s_bp := pg_temp.mkuser('Fn Supporter BP'); s_note := pg_temp.mkuser('Fn Supporter Note');
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at)
  values (v_org, pt, s_bp, 'son', array['weekly_bp_trend'], now() + interval '30 days') returning id into m_bp;
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at)
  values (v_org, pt, s_note, 'daughter', array['doctor_note'], now() + interval '30 days');

  -- before any note: the block is present but empty for the permitted supporter (the screen's "no note yet")
  v := pg_temp.view_as(s_note, pt);
  perform pg_temp.ck('0a permitted supporter, no note yet: block present and null', 'true/null', (v ? 'doctor_note')::text || '/' || coalesce(v ->> 'doctor_note', 'null'));

  -- 1. writing
  perform pg_temp.ck('1a the doctor who held the completed consultation writes', 'ok', pg_temp.write_as(doc, pt, cs, e_done, 'Your mum did well today. Please help her keep walking each evening.'));
  perform pg_temp.ck('1b organisation and test flag come from the patient', 'true/true',
    (select (organisation_id = v_org)::text || '/' || is_test::text from public.family_doctor_notes where patient_id = pt limit 1));
  perform pg_temp.ck('1c an unfinished consultation is refused', 'ERR:42501', pg_temp.write_as(doc, pt, cs, e_live, 'x'));
  perform pg_temp.ck('1d another doctor is refused', 'ERR:42501', pg_temp.write_as(doc2, pt, cs2, e_done, 'x'));
  perform pg_temp.ck('1e a care coordinator is refused, even on their own consultation', 'ERR:42501', pg_temp.write_as(coord, pt, cs_coord, e_coord, 'x'));
  perform pg_temp.ck('1f naming another doctor as author is refused', 'ERR:42501', pg_temp.write_as(doc, pt, cs2, e_done, 'x'));
  perform pg_temp.ck('1g the patient cannot write one', 'ERR:42501', pg_temp.write_as(pt, pt, cs, e_done, 'x'));
  perform pg_temp.ck('1h a stranger cannot write one', 'ERR:42501', pg_temp.write_as(st, pt, cs, e_done, 'x'));
  perform pg_temp.ck('1i more than 280 characters is refused', 'ERR:23514', pg_temp.write_as(doc, pt, cs, e_done, repeat('a', 281)));
  perform pg_temp.ck('1j the author cannot update a note', 'ERR:42501', pg_temp.q_as(doc, 'update public.family_doctor_notes set body = ''changed'' returning ''ok'''));
  begin
    update public.family_doctor_notes set body = 'changed' where patient_id = pt;
    r := 'updated';
  exception when others then r := sqlstate;
  end;
  perform pg_temp.ck('1k even the table owner cannot update a note (correction is a new row)', '42501', r);
  perform pg_temp.ck('1l the organisation cannot be chosen by the caller', 'ERR:42501',
    pg_temp.q_as(doc, format('insert into public.family_doctor_notes (organisation_id, patient_id, author_staff_id, encounter_id, body) values (%L, %L, %L, %L, ''x'') returning ''ok''',
                              gen_random_uuid(), pt, cs, e_done)));

  -- the screen's one call (security invoker, so the same policy decides)
  perform pg_temp.ck('1n write_family_note: another doctor is refused', 'ERR:42501',
    pg_temp.q_as(doc2, format('select public.write_family_note(%L::uuid, ''x'')::text', e_done)));
  perform pg_temp.ck('1o write_family_note: the patient is refused', 'ERR:42501',
    pg_temp.q_as(pt, format('select public.write_family_note(%L::uuid, ''x'')::text', e_done)));
  perform pg_temp.ck('1p write_family_note: an unfinished consultation is refused', 'ERR:42501',
    pg_temp.q_as(doc, format('select public.write_family_note(%L::uuid, ''x'')::text', e_live)));
  perform pg_temp.ck('1q write_family_note is not a definer function', 'false',
    (select prosecdef::text from pg_proc where oid = 'public.write_family_note(uuid, text)'::regprocedure));

  -- 2. reading the table
  perform pg_temp.ck('2a the patient reads their own', '1', pg_temp.q_as(pt, 'select count(*)::text from public.family_doctor_notes'));
  perform pg_temp.ck('2b the author reads theirs', '1', pg_temp.q_as(doc, 'select count(*)::text from public.family_doctor_notes'));
  perform pg_temp.ck('2c another doctor reads none', '0', pg_temp.q_as(doc2, 'select count(*)::text from public.family_doctor_notes'));
  perform pg_temp.ck('2d a stranger reads none', '0', pg_temp.q_as(st, 'select count(*)::text from public.family_doctor_notes'));
  perform pg_temp.ck('2e a supporter WITH doctor_note still reads none from the table', '0', pg_temp.q_as(s_note, 'select count(*)::text from public.family_doctor_notes'));

  -- 3. the supporter view, patient first
  v := pg_temp.view_as(s_bp, pt);
  perform pg_temp.ck('3a supporter without doctor_note: no block at all', 'false/false', (v ? 'doctor_note')::text || '/' || (v::text like '%walking%')::text);
  perform pg_temp.ck('3a2 and the rest of their view still works', 'true', (v ? 'bp_trend')::text);
  perform pg_temp.ck('1m a second note through the screen''s call (a correction is a new row)', 'true',
    (pg_temp.q_as(doc, format('select public.write_family_note(%L::uuid, %L)::text', e_done, 'Correction: evening walks, and keep her water bottle close.')) ~ '^[0-9a-f-]{36}$')::text);
  select id into n1 from public.family_doctor_notes where patient_id = pt and body like 'Your mum%';
  select id into n2 from public.family_doctor_notes where patient_id = pt and body like 'Correction:%';
  v := pg_temp.view_as(s_note, pt);
  perform pg_temp.ck('3b PATIENT FIRST: two notes written, the permitted supporter still sees none', 'true/null/false/false',
    (v ? 'doctor_note')::text || '/' || coalesce(v ->> 'doctor_note', 'null') || '/' || (v::text like '%walking%')::text || '/' || (v::text like '%Correction%')::text);
  v := pg_temp.q_as(pt, 'select public.my_family_notes()::text')::jsonb;
  perform pg_temp.ck('3c the patient sees the latest note first, not shared, not yet answered, with the doctor''s name', '2/Correction/false/false/Dr Amara Eze',
    jsonb_array_length(v)::text || '/' || split_part(v -> 0 ->> 'body', ':', 1) || '/' || (v -> 0 ->> 'shared') || '/' || (v -> 0 ->> 'decided') || '/' || coalesce(v -> 0 ->> 'author_name', 'none'));
  perform pg_temp.ck('3c2 nobody else gets the patient''s note list', '[]/[]', pg_temp.q_as(s_note, 'select public.my_family_notes()::text') || '/' || pg_temp.q_as(doc, 'select public.my_family_notes()::text'));
  -- only the patient can release
  perform pg_temp.ck('3d a supporter cannot release a note', 'ERR:P0002', pg_temp.q_as(s_note, format('select public.set_family_note_shared(%L::uuid, true)::text', n1)));
  perform pg_temp.ck('3d2 the author cannot release a note', 'ERR:P0002', pg_temp.q_as(doc, format('select public.set_family_note_shared(%L::uuid, true)::text', n1)));
  perform pg_temp.ck('3d3 a stranger cannot release a note', 'ERR:P0002', pg_temp.q_as(st, format('select public.set_family_note_shared(%L::uuid, true)::text', n1)));
  perform pg_temp.ck('3d4 still nothing released', '0', (select count(*)::text from public.family_doctor_notes where patient_id = pt and released_at is not null));
  -- the trigger: release columns only, and only from inside the function
  begin
    update public.family_doctor_notes set released_at = now(), released_by = pt where id = n1;
    r := 'updated';
  exception when others then r := sqlstate;
  end;
  perform pg_temp.ck('3e the table owner cannot release a note directly', '42501', r);
  begin
    perform set_config('tarragon.family_note_release', 'on', true);
    update public.family_doctor_notes set body = 'changed' where id = n1;
    r := 'updated';
  exception when others then r := sqlstate;
  end;
  perform set_config('tarragon.family_note_release', 'off', true);
  perform pg_temp.ck('3e2 even with the release flag on, the body cannot change', '42501', r);
  -- the patient releases the older note: that is what family sees, never the unreleased newer one
  perform pg_temp.ck('3f the patient shares the first note', 'true', pg_temp.q_as(pt, format('select public.set_family_note_shared(%L::uuid, true)::text', n1)));
  v := pg_temp.view_as(s_note, pt);
  perform pg_temp.ck('3f2 family sees the released note, not the newer unreleased one', 'true/false', ((v #>> '{doctor_note,body}') like 'Your mum%')::text || '/' || (v::text like '%Correction%')::text);
  perform pg_temp.ck('3g the patient shares the newer note', 'true', pg_temp.q_as(pt, format('select public.set_family_note_shared(%L::uuid, true)::text', n2)));
  v := pg_temp.view_as(s_note, pt);
  perform pg_temp.ck('3g2 family sees only the latest released note', 'true/false', ((v #>> '{doctor_note,body}') like 'Correction:%')::text || '/' || (v::text like '%did well today%')::text);
  perform pg_temp.ck('3g3 the doctor''s name and the date', 'Dr Amara Eze/true',
    coalesce(v #>> '{doctor_note,author_name}', 'none') || '/' || ((v #>> '{doctor_note,written_at}') is not null)::text);
  perform pg_temp.ck('3g4 the release is recorded against the patient', 'true',
    (select (released_by = pt and released_at is not null and share_decided_at is not null)::text from public.family_doctor_notes where id = n2));
  perform pg_temp.ck('3h the read is audited as a look', 'true',
    (exists (select 1 from public.care_access_events where patient_id = pt and actor_profile_id = s_note and kind = 'record_viewed'))::text);
  -- un-share: family falls back to the older released note, then to none
  perform pg_temp.ck('3i the patient un-shares the newer note', 'false', pg_temp.q_as(pt, format('select public.set_family_note_shared(%L::uuid, false)::text', n2)));
  perform pg_temp.ck('3i2 family sees the older released note again', 'true', ((pg_temp.view_as(s_note, pt) #>> '{doctor_note,body}') like 'Your mum%')::text);
  perform pg_temp.ck('3i3 un-sharing the older one too leaves family nothing', 'false/null',
    pg_temp.q_as(pt, format('select public.set_family_note_shared(%L::uuid, false)::text', n1)) || '/' || coalesce(pg_temp.view_as(s_note, pt) ->> 'doctor_note', 'null'));
  v := pg_temp.q_as(pt, 'select public.my_family_notes()::text')::jsonb;
  perform pg_temp.ck('3i4 "don''t share" is remembered as answered, not shared', 'false/true', (v -> 0 ->> 'shared') || '/' || (v -> 0 ->> 'decided'));
  perform pg_temp.q_as(pt, format('select public.set_family_note_shared(%L::uuid, true)::text', n2));
  set local session_replication_role = replica;
  update public.clinical_staff set active = false where id = cs;
  set local session_replication_role = origin;
  v := pg_temp.view_as(s_note, pt);
  perform pg_temp.ck('3j null-gated: an inactive author shows no name or id, the note stays', 'null/null/true',
    coalesce(v #>> '{doctor_note,author_name}', 'null') || '/' || coalesce(v #>> '{doctor_note,author_staff_id}', 'null') || '/' || ((v #>> '{doctor_note,body}') is not null)::text);
  perform pg_temp.ck('3j2 null-gated for the patient too', 'null', coalesce(pg_temp.q_as(pt, 'select public.my_family_notes()::text')::jsonb -> 0 ->> 'author_name', 'null'));
  set local session_replication_role = replica;
  update public.clinical_staff set active = true where id = cs;
  set local session_replication_role = origin;
  -- the patient grants doctor_note to the BP supporter, then takes it away, with the existing settings call
  perform pg_temp.ck('3k the patient grants doctor_note', 'true',
    pg_temp.q_as(pt, format('select public.update_care_circle_member(%L::uuid, array[''weekly_bp_trend'', ''doctor_note''])::text', m_bp)));
  perform pg_temp.ck('3k2 ... and that supporter now sees the released note', 'true', ((pg_temp.view_as(s_bp, pt) #>> '{doctor_note,body}') is not null)::text);
  perform pg_temp.ck('3k3 the patient revokes doctor_note', 'true',
    pg_temp.q_as(pt, format('select public.update_care_circle_member(%L::uuid, array[''weekly_bp_trend''])::text', m_bp)));
  perform pg_temp.ck('3k4 ... and the block is gone on the next read', 'false', (pg_temp.view_as(s_bp, pt) ? 'doctor_note')::text);
  perform pg_temp.ck('3l paused circle: the note is not shared', 'true/false',
    coalesce(pg_temp.q_as(pt, 'select (public.pause_care_circle(false) is not null)::text'), 'null') || '/' || (pg_temp.view_as(s_note, pt) ? 'doctor_note')::text);
  perform pg_temp.q_as(pt, 'select public.resume_care_circle()::text');
  perform pg_temp.ck('3m a stranger''s supporter view is refused', 'ERR:P0002', pg_temp.view_as(st, pt) ->> 'error');

  -- 3n. the assignment is the authority, not organisation equality: a doctor whose staff row sits in ANOTHER organisation, assigned to
  -- this patient's completed consultation, may write; the note still takes the patient's organisation
  insert into public.organisations (name, type) values ('Fn Other Org', 'clinic') returning id into v_org2;
  doc3 := pg_temp.mkuser('Fn Cross Org Doctor', 'clinician');
  cs3 := pg_temp.mkstaff(doc3, 'Dr Chika Obi', 'senior_medical_officer');
  set local session_replication_role = replica;
  update public.clinical_staff set organisation_id = v_org2 where id = cs3;
  update public.profiles set organisation_id = v_org2 where id = doc3;
  set local session_replication_role = origin;
  e_x := pg_temp.mkenc(pt, doc3, 'completed');
  perform pg_temp.ck('3n a doctor in another organisation, assigned to this completed consultation, writes', 'ok', pg_temp.write_as(doc3, pt, cs3, e_x, 'Cross-organisation line.'));
  perform pg_temp.ck('3n2 ... and the note takes the patient''s organisation', 'true',
    (select (organisation_id = v_org)::text from public.family_doctor_notes where encounter_id = e_x));
  perform pg_temp.ck('3n3 that doctor is still refused on a consultation they did not hold', 'ERR:42501', pg_temp.write_as(doc3, pt, cs3, e_done, 'x'));
  perform pg_temp.ck('3n4 the new note is not shared until the patient says so', 'false', (pg_temp.view_as(s_note, pt)::text like '%Cross-organisation%')::text);

  -- 4. grants
  perform pg_temp.ck('4a anon reaches nothing', 'false/false/false/false', has_table_privilege('anon', 'public.family_doctor_notes', 'SELECT')::text || '/' || has_table_privilege('anon', 'public.family_doctor_notes', 'INSERT')::text
    || '/' || has_function_privilege('anon', 'public.set_family_note_shared(uuid, boolean)', 'EXECUTE')::text || '/' || has_function_privilege('anon', 'public.my_family_notes()', 'EXECUTE')::text);
  perform pg_temp.ck('4b no update or delete grant, release columns not insertable', 'false/false/false',
    has_table_privilege('authenticated', 'public.family_doctor_notes', 'UPDATE')::text || '/' || has_table_privilege('authenticated', 'public.family_doctor_notes', 'DELETE')::text
    || '/' || has_column_privilege('authenticated', 'public.family_doctor_notes', 'released_at', 'INSERT')::text);

  -- 5. sabotage: each block undoes itself by raising, keeping only the observed value
  begin
    create or replace function private.circle_doctor_note_block(p_patient uuid, p_permissions text[]) returns jsonb
      language sql stable security definer set search_path = '' as
      $f$ select jsonb_build_object('doctor_note', (select jsonb_build_object('body', n.body) from public.family_doctor_notes n where n.patient_id = p_patient and n.released_at is not null order by n.created_at desc limit 1)) $f$;
    v := pg_temp.view_as(s_bp, pt);
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.ck('5a SABOTAGE permission test removed: the supporter without doctor_note SEES the note (flips 3a)', 'true', (v ? 'doctor_note')::text);
  perform pg_temp.ck('5a after undo the block is gone again', 'false', (pg_temp.view_as(s_bp, pt) ? 'doctor_note')::text);
  begin
    create or replace function private.family_note_author_may_write(p_author uuid, p_patient uuid, p_encounter uuid, p_appointment uuid) returns boolean
      language sql stable security definer set search_path = '' as $f$ select true $f$;
    r := pg_temp.write_as(doc2, pt, cs2, e_done, 'x');
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.ck('5b SABOTAGE writer test opened: another doctor CAN write (flips 1d)', 'ok', r);
  begin
    create or replace function private.circle_doctor_note_block(p_patient uuid, p_permissions text[]) returns jsonb
      language sql stable security definer set search_path = '' as
      $f$ select case when not ('doctor_note' = any (p_permissions)) then '{}'::jsonb else jsonb_build_object('doctor_note', (select jsonb_build_object('body', n.body) from public.family_doctor_notes n where n.patient_id = p_patient order by n.created_at desc limit 1)) end $f$;
    v := pg_temp.view_as(s_note, pt);
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.ck('5c SABOTAGE release filter removed: the UNRELEASED newest note reaches family (flips 3n4)', 'true', (v::text like '%Cross-organisation%')::text);
  begin
    create or replace function public.set_family_note_shared(p_note uuid, p_share boolean) returns boolean
      language plpgsql security definer set search_path = '' as $f$
      begin
        perform set_config('tarragon.family_note_release', 'on', true);
        update public.family_doctor_notes set released_at = now(), released_by = patient_id, share_decided_at = now() where id = p_note;
        return found;
      end $f$;
    r := pg_temp.q_as(s_note, format('select public.set_family_note_shared(%L::uuid, true)::text', n1));
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.ck('5d SABOTAGE patient check removed: a supporter CAN release a note (flips 3d)', 'true', r);
  begin
    create or replace function private.family_doctor_notes_no_update() returns trigger
      language plpgsql set search_path = '' as $f$
      begin
        if (new.body, new.author_staff_id) is distinct from (old.body, old.author_staff_id) then raise exception 'x' using errcode = '42501'; end if;
        return new;
      end $f$;
    begin
      update public.family_doctor_notes set released_at = now(), released_by = pt where id = n1;
      r := 'updated';
    exception when others then r := sqlstate;
    end;
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.ck('5e SABOTAGE release flag check removed: the owner CAN release directly (flips 3e)', 'updated', r);
  begin
    create or replace function private.family_note_author_may_write(p_author uuid, p_patient uuid, p_encounter uuid, p_appointment uuid) returns boolean
      language sql stable security definer set search_path = '' as $f$
      select exists (select 1 from public.clinical_staff cs join public.profiles pt on pt.id = p_patient and pt.organisation_id = cs.organisation_id
                      where cs.id = p_author and cs.profile_id = (select auth.uid()) and cs.active and cs.doctor_tier <> 'care_coordinator')
         and exists (select 1 from public.encounters e where e.id = p_encounter and e.patient_id = p_patient and e.clinician_id = (select auth.uid()) and e.status = 'completed') $f$;
    r := pg_temp.write_as(doc3, pt, cs3, e_x, 'again');
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.ck('5f SABOTAGE organisation equality put back: the assigned cross-organisation doctor IS refused (flips 3n)', 'ERR:42501', r);
end $$;

-- only failing checks are printed (a passing run prints none), plus the count of checks that held
select check_name, observed, expected from fn_results where verdict <> 'PASS' order by check_name;
select count(*) as checks_held from fn_results where verdict = 'PASS';
do $$
declare n integer;
begin
  select count(*) into n from fn_results where verdict <> 'PASS';
  if n > 0 then raise exception 'family_doctor_note: % check(s) did not hold', n; end if;
  if (select count(*) from fn_results) < 50 then raise exception 'family_doctor_note: fewer checks ran than expected'; end if;
end $$;
rollback;
