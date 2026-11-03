-- ===========================================================================
-- Proof: a doctor's line for the family (20261103230825_family_doctor_note.sql).
--   1. Writing: the doctor who held this patient's completed consultation writes a note; organisation and test flag come from the patient,
--      never the caller. Refused: an unfinished consultation, another doctor, a care coordinator (even on their own completed
--      consultation), a doctor naming another doctor as author, the patient, a stranger, more than 280 characters. Nobody updates a note
--      (no grant, and a trigger refuses it even for the table owner).
--   2. Reading the table: the patient reads their own, the author reads theirs, a stranger, another doctor and every supporter read none.
--   3. The supporter view: a supporter without doctor_note gets no doctor_note block at all; with it, only the LATEST note, the date,
--      and the doctor's name null-gated (an inactive author shows no name). The patient grants and revokes doctor_note through the
--      existing update_care_circle_member and the block appears and disappears. Nothing is shared while the circle is paused.
--   4. anon reaches nothing; signed-in users cannot set the organisation or test flag.
--   5. SABOTAGE (each must flip): the permission test removed from the block builder (the supporter without doctor_note sees the note);
--      the writer test opened up (another doctor can write).
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

  -- 3. the supporter view
  v := pg_temp.view_as(s_bp, pt);
  perform pg_temp.ck('3a supporter without doctor_note: no block at all', 'false/false', (v ? 'doctor_note')::text || '/' || (v::text like '%walking%')::text);
  perform pg_temp.ck('3a2 and the rest of their view still works', 'true', (v ? 'bp_trend')::text);
  perform pg_temp.ck('1m a second note through the screen''s call (a correction is a new row)', 'true',
    (pg_temp.q_as(doc, format('select public.write_family_note(%L::uuid, %L)::text', e_done, 'Correction: evening walks, and keep her water bottle close.')) ~ '^[0-9a-f-]{36}$')::text);
  v := pg_temp.view_as(s_note, pt);
  perform pg_temp.ck('3b supporter with doctor_note: only the latest note', 'true/false',
    ((v #>> '{doctor_note,body}') like 'Correction:%')::text || '/' || (v::text like '%did well today%')::text);
  perform pg_temp.ck('3c the doctor''s name and the date', 'Dr Amara Eze/true',
    coalesce(v #>> '{doctor_note,author_name}', 'none') || '/' || ((v #>> '{doctor_note,written_at}') is not null)::text);
  perform pg_temp.ck('3d the read is audited as a look', 'true',
    (exists (select 1 from public.care_access_events where patient_id = pt and actor_profile_id = s_note and kind = 'record_viewed'))::text);
  set local session_replication_role = replica;
  update public.clinical_staff set active = false where id = cs;
  set local session_replication_role = origin;
  v := pg_temp.view_as(s_note, pt);
  perform pg_temp.ck('3e null-gated: an inactive author shows no name or id, the note stays', 'null/null/true',
    coalesce(v #>> '{doctor_note,author_name}', 'null') || '/' || coalesce(v #>> '{doctor_note,author_staff_id}', 'null') || '/' || ((v #>> '{doctor_note,body}') is not null)::text);
  set local session_replication_role = replica;
  update public.clinical_staff set active = true where id = cs;
  set local session_replication_role = origin;
  -- the patient grants doctor_note to the BP supporter, then takes it away, with the existing settings call
  perform pg_temp.ck('3f the patient grants doctor_note', 'true',
    pg_temp.q_as(pt, format('select public.update_care_circle_member(%L::uuid, array[''weekly_bp_trend'', ''doctor_note''])::text', m_bp)));
  perform pg_temp.ck('3g ... and that supporter now sees the note', 'true', ((pg_temp.view_as(s_bp, pt) #>> '{doctor_note,body}') is not null)::text);
  perform pg_temp.ck('3h the patient revokes doctor_note', 'true',
    pg_temp.q_as(pt, format('select public.update_care_circle_member(%L::uuid, array[''weekly_bp_trend''])::text', m_bp)));
  perform pg_temp.ck('3i ... and the block is gone on the next read', 'false', (pg_temp.view_as(s_bp, pt) ? 'doctor_note')::text);
  perform pg_temp.ck('3j paused circle: the note is not shared', 'true/false',
    coalesce(pg_temp.q_as(pt, 'select (public.pause_care_circle(false) is not null)::text'), 'null') || '/' || (pg_temp.view_as(s_note, pt) ? 'doctor_note')::text);
  perform pg_temp.q_as(pt, 'select public.resume_care_circle()::text');
  perform pg_temp.ck('3k a stranger''s supporter view is refused', 'ERR:P0002', pg_temp.view_as(st, pt) ->> 'error');

  -- 4. grants
  perform pg_temp.ck('4a anon reaches nothing', 'false/false', has_table_privilege('anon', 'public.family_doctor_notes', 'SELECT')::text || '/' || has_table_privilege('anon', 'public.family_doctor_notes', 'INSERT')::text);
  perform pg_temp.ck('4b no update or delete grant', 'false/false', has_table_privilege('authenticated', 'public.family_doctor_notes', 'UPDATE')::text || '/' || has_table_privilege('authenticated', 'public.family_doctor_notes', 'DELETE')::text);

  -- 5. sabotage
  begin
    create or replace function private.circle_doctor_note_block(p_patient uuid, p_permissions text[]) returns jsonb
      language sql stable security definer set search_path = '' as
      $f$ select jsonb_build_object('doctor_note', (select jsonb_build_object('body', n.body) from public.family_doctor_notes n where n.patient_id = p_patient order by n.created_at desc limit 1)) $f$;
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
end $$;

select verdict, check_name, observed, expected from fn_results order by verdict, check_name;
do $$
declare n integer;
begin
  select count(*) into n from fn_results where verdict <> 'PASS';
  if n > 0 then raise exception 'family_doctor_note: % check(s) FAILED', n; end if;
  if (select count(*) from fn_results) < 30 then raise exception 'family_doctor_note: fewer checks ran than expected'; end if;
end $$;
rollback;
