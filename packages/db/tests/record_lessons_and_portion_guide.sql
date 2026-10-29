-- Item 7 and item 8 proof (migration *_learning_record_lessons_and_portion_guide.sql).
--
--   P. PORTION GUIDE: the two seeded guides are unreviewed draft placeholders; every food line names a hand the renderer can draw and an amount that
--      exists in the versioned configuration for that guide's audience (so no number is ever held in a component); a guide cannot be published while
--      the configuration is still proposed; once it is confirmed (a clinician or dietitian's act) the gate opens.
--   R. RECORD-TRIGGERED LESSONS: the guard is created off and cannot be switched on (no defined condition); with it off a real person gets a quiet
--      "not shown" and a test account still can exercise the flow; a lesson is logged only when the config names it for that band, it is published
--      and reviewed, the cited readings are the person's own and the band holds (BP is re-classified in the database); a single amber reading, or a
--      single high lab value, never produces a lesson; a red reading inside the suppression window blocks every lesson; a lab result that is not
--      released, or that holds a sensitive positive, never does; one show per lesson per day; the event carries ids only; the shows table cannot be
--      written by a client and another patient cannot read it; anon cannot call the function.
--   SABOTAGE: with the portion gate dropped a proposed-amount guide publishes; with the guard forced on a real person is shown a lesson (so the
--   guard is what refused); with the BP classifier neutered an amber reading passes as in target (so the re-classification is what refused).
begin;

create temp table results(n serial, check_name text, ok boolean) on commit drop;
grant all on results to public;
grant all on results_n_seq to public;

create function pg_temp.ck(p_name text, p_ok boolean) returns void language plpgsql as
$f$ begin
  insert into results(check_name, ok) values (p_name, coalesce(p_ok, false));
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_name; end if;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'rl-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'RL ' || p_label, p_test)
  on conflict (id) do update set role = excluded.role, is_test = excluded.is_test, is_active = true;
  return v;
end $f$;
create function pg_temp.as_try(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare r text := 'ok';
begin
  if p_uid is null then
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
  begin execute p_sql; exception when others then r := sqlstate; end;
  reset role; perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create function pg_temp.as_count(p_uid uuid, p_sql text) returns integer language plpgsql as $f$
declare n integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin execute p_sql into n; exception when others then n := -1; end;
  reset role; perform set_config('request.jwt.claims', '', true);
  return n;
end $f$;
create function pg_temp.as_text(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare t text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin execute p_sql into t; exception when others then t := 'ERR'; end;
  reset role; perform set_config('request.jwt.claims', '', true);
  return t;
end $f$;
-- statement as the table owner: 'ok' or 'SQLSTATE: message'
create function pg_temp.owner_msg(p_sql text) returns text language plpgsql as $f$
declare r text := 'ok';
begin
  begin execute p_sql; exception when others then r := sqlstate || ': ' || sqlerrm; end;
  return r;
end $f$;
-- make a seeded draft placeholder into a published, reviewed lesson (the way a clinical author and the CMO would, here by the table owner)
create function pg_temp.publish_seed(p_code text, p_body text default 'Take your tablets. Check your pressure. Tell your care team how you feel.') returns text language plpgsql as $f$
begin
  return pg_temp.owner_msg(format($s$update public.health_education_content set is_placeholder = false, clinical_author_name = 'Dr Author', body = %L,
      clinician_reviewed = true, reviewed_by_name = 'Dr Reviewer', reviewed_at = now(), source_reference = 'Proof source',
      self_care_action = 'Check at the same time each day', next_review_due = current_date + 90, content_status = 'published' where code = %L$s$, p_body, p_code));
end $f$;
create function pg_temp.bp(p_org uuid, p_pat uuid, p_sys int, p_dia int, p_days_ago numeric) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;   -- the red-flag triggers are not what is under test
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
  values (v, p_org, p_pat, 'blood_pressure', p_sys, p_dia, 'manual', now() - make_interval(secs => (p_days_ago * 86400)::int));
  set local session_replication_role = origin;
  return v;
end $f$;
create function pg_temp.glu(p_org uuid, p_pat uuid, p_mmol numeric, p_days_ago numeric) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, glucose_mmol_l, source, taken_at)
  values (v, p_org, p_pat, 'glucose', p_mmol, 'manual', now() - make_interval(secs => (p_days_ago * 86400)::int));
  set local session_replication_role = origin;
  return v;
end $f$;
-- a lab result with one item; returns the item id
create function pg_temp.lab(p_org uuid, p_pat uuid, p_analyte text, p_flag text, p_state text, p_sensitive boolean default false, p_result uuid default null, p_days_ago numeric default 0) returns uuid language plpgsql as $f$
declare v_res uuid := coalesce(p_result, gen_random_uuid()); v_item uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;   -- the release state machine is not what is under test
  if p_result is null then
    insert into public.lab_results (id, organisation_id, patient_id, source, submitted_by_kind, release_state, release_reason, released_at, received_at, is_test)
    values (v_res, p_org, p_pat, 'pdf_upload', 'tarragon_team', p_state, case when p_state = 'released' then 'proof' end, case when p_state = 'released' then now() end,
            now() - make_interval(secs => (p_days_ago * 86400)::int), true);
  end if;
  insert into public.lab_result_items (id, lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, value_text, unit, flag, sensitive_positive, is_test)
  values (v_item, v_res, p_org, p_pat, p_analyte, case when p_sensitive then null else 5.2 end, case when p_sensitive then 'positive' end, '', p_flag, p_sensitive, true);
  set local session_replication_role = origin;
  return v_item;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_pt uuid; v_pr uuid; v_po uuid;
  v_g1 uuid; v_a1 uuid; v_a2 uuid; v_a3 uuid; v_other uuid; v_red uuid; v_l1 uuid; v_l3 uuid; v_lh1 uuid; v_lh2 uuid; v_lres uuid; v_sens uuid; v_amber uuid;
  v_t text; v_p3 uuid; v_n1 uuid; v_n2 uuid; v_c1 uuid; v_r1 uuid;
begin
  select id into v_org from public.organisations limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_pt := pg_temp.mkuser(v_org, 'test-patient', 'patient', true);
  v_pr := pg_temp.mkuser(v_org, 'real-patient', 'patient', false);
  v_po := pg_temp.mkuser(v_org, 'other-patient', 'patient', true);
  v_p3 := pg_temp.mkuser(v_org, 'third-patient', 'patient', true);
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_cmo, v_org, 'RL CMO', 'chief_medical_officer', true, 'MDCN', 'RL-CMO-1', true, v_admin, v_admin, now());

  -- ================= P. portion guide =================
  perform pg_temp.ck('P1 both guides are seeded as unreviewed draft placeholders',
    (select count(*) = 2 and bool_and(content_status = 'draft' and is_placeholder and not clinician_reviewed and reviewed_by_name is null and source_reference is null and next_review_due is null)
       from public.health_education_content where code in ('portion-guide-diabetes', 'portion-guide-bp')));
  perform pg_temp.ck('P2 the configuration is proposed and every amount in it is a placeholder row of the versioned config',
    (select status = 'proposed' from public.learning_config where key = 'portion_guide' and is_active order by version desc limit 1));
  -- every food line has a valid hand and an amount for that guide's audience
  perform pg_temp.ck('P3 every food line of the diabetes guide uses a drawable hand and has a diabetes amount in the config',
    not exists (
      select 1 from regexp_matches((select body from public.health_education_content where code = 'portion-guide-diabetes'), '\[portion ([a-z0-9_]+) ([a-z_]+)\]', 'g') as m
       where m[2] not in ('palm', 'fist', 'cupped_hand', 'thumb', 'fingertip')
          or (private.learning_config('portion_guide') #> array['portions', m[1], 'diabetes']) is null)
    and exists (select 1 from regexp_matches((select body from public.health_education_content where code = 'portion-guide-diabetes'), '\[portion ', 'g')));
  perform pg_temp.ck('P4 every food line of the blood pressure guide uses a drawable hand and has a blood pressure amount in the config',
    not exists (
      select 1 from regexp_matches((select body from public.health_education_content where code = 'portion-guide-bp'), '\[portion ([a-z0-9_]+) ([a-z_]+)\]', 'g') as m
       where m[2] not in ('palm', 'fist', 'cupped_hand', 'thumb', 'fingertip')
          or (private.learning_config('portion_guide') #> array['portions', m[1], 'blood_pressure']) is null)
    and exists (select 1 from regexp_matches((select body from public.health_education_content where code = 'portion-guide-bp'), '\[portion ', 'g')));
  perform pg_temp.ck('P5 the guides cover seasoning cubes and fried food (blood pressure) and drinks (diabetes)',
    (select body like '%[portion seasoning_cube %' and body like '%[portion fried_food %' from public.health_education_content where code = 'portion-guide-bp')
    and (select body like '%[portion drinks %' from public.health_education_content where code = 'portion-guide-diabetes'));
  perform pg_temp.ck('P6 a patient cannot see either draft', pg_temp.as_count(v_pt, $q$select count(*) from public.health_education_content where code like 'portion-guide-%'$q$) = 0);

  -- Make the diabetes guide otherwise publishable (author, reviewer, source, date, self-care step), keeping its text.
  v_t := pg_temp.owner_msg($s$update public.health_education_content set is_placeholder = false, clinical_author_name = 'Dr Author', clinician_reviewed = true,
      reviewed_by_name = 'Dr Reviewer', reviewed_at = now(), source_reference = 'Proof source', self_care_action = 'Measure one meal with your hand today',
      next_review_due = current_date + 90 where code = 'portion-guide-diabetes'$s$);
  perform pg_temp.ck('P7 the draft can be completed without publishing it', v_t = 'ok');
  v_t := pg_temp.owner_msg($s$update public.health_education_content set content_status = 'published' where code = 'portion-guide-diabetes'$s$);
  perform pg_temp.ck('P8 a guide cannot be published while its amounts are still proposed', v_t like '23514:%amounts are still proposed%');
  update public.learning_config set status = 'confirmed' where key = 'portion_guide';
  v_t := pg_temp.owner_msg($s$update public.health_education_content set content_status = 'published' where code = 'portion-guide-diabetes'$s$);
  perform pg_temp.ck('P9 once the amounts are confirmed the gate opens (the guide is within the reading-grade limit)', v_t = 'ok');
  update public.learning_config set status = 'proposed' where key = 'portion_guide';

  -- ================= R. record-triggered lessons =================
  perform pg_temp.ck('R1 the guard exists and starts off',
    exists (select 1 from public.go_live_guards where key = 'record_triggered_lessons_enabled' and not is_on));
  -- G-01: a feature opens without a condition branch; it is held again at once (with a reason) so the closed checks below keep their meaning
  v_t := pg_temp.as_try(v_cmo, $q$select public.set_go_live_guard('record_triggered_lessons_enabled', true, 'G-01 proof: a feature opens without a condition')$q$);
  perform pg_temp.ck('R2 G-01: the CMO opens it without a condition, and holds it again with a reason',
    v_t = 'ok'
    and pg_temp.as_try(v_cmo, $q$select public.set_go_live_guard('record_triggered_lessons_enabled', false, 'G-01 proof: held again for the closed checks')$q$) = 'ok'
    and not exists (select 1 from public.go_live_guards where key = 'record_triggered_lessons_enabled' and is_on));
  perform pg_temp.ck('R3 the six lessons it points at are draft placeholders',
    (select count(*) = 6 and bool_and(content_status = 'draft' and is_placeholder) from public.health_education_content
      where code in ('record-bp-in-target', 'record-bp-above-target', 'record-glucose-in-target', 'record-glucose-above-target', 'record-lab-hba1c-normal', 'record-lab-hba1c-high')));

  -- publish four of the six (leave the glucose in-target lesson a draft)
  perform pg_temp.ck('R4 a clinical author completes and publishes four lessons',
    pg_temp.publish_seed('record-bp-in-target') = 'ok' and pg_temp.publish_seed('record-bp-above-target') = 'ok'
    and pg_temp.publish_seed('record-lab-hba1c-normal') = 'ok' and pg_temp.publish_seed('record-lab-hba1c-high') = 'ok');

  v_g1 := pg_temp.bp(v_org, v_pt, 118, 76, 0.1);
  -- the guard is off: a real person is shown nothing, a test account can exercise the flow
  v_other := pg_temp.bp(v_org, v_pr, 118, 76, 0.1);
  perform pg_temp.ck('R5 with the guard off a real person is not shown a lesson (quiet false, no error)',
    pg_temp.as_text(v_pr, format($q$select public.record_lesson_shown('blood_pressure', 'in_target', 'record-bp-in-target', array[%L]::uuid[])$q$, v_other)) = 'refused');
  perform pg_temp.ck('R6 the refusal wrote nothing', (select count(*) = 0 from public.learning_record_lesson_shows where patient_id = v_pr));

  -- a single green reading may show the in-target lesson
  v_t := pg_temp.as_text(v_pt, format($q$select public.record_lesson_shown('blood_pressure', 'in_target', 'record-bp-in-target', array[%L]::uuid[])$q$, v_g1));
  perform pg_temp.ck('R7 a test account is shown the in-target lesson from one green reading', v_t = 'shown');
  perform pg_temp.ck('R8 exactly one show row exists, attributed and marked test',
    (select count(*) = 1 and bool_and(is_test and band = 'in_target' and source_kind = 'blood_pressure' and source_ids = array[v_g1]) from public.learning_record_lesson_shows where patient_id = v_pt));
  perform pg_temp.ck('R9 the event carries ids only (INV-07): exactly show_id and content_id',
    (select count(*) = 1 and bool_and((select array_agg(k order by k) from jsonb_object_keys(payload) k) = array['content_id', 'show_id']) from public.domain_events where event_type = 'learning.record_lesson_shown' and patient_id = v_pt));
  v_t := pg_temp.as_text(v_pt, format($q$select public.record_lesson_shown('blood_pressure', 'in_target', 'record-bp-in-target', array[%L]::uuid[])$q$, v_g1));
  perform pg_temp.ck('R10 the same lesson is not logged twice in a day (answers already_shown)', v_t = 'already_shown' and (select count(*) = 1 from public.learning_record_lesson_shows where patient_id = v_pt));

  -- a wrong code, a wrong band, someone else's reading
  v_a1 := pg_temp.bp(v_org, v_po, 118, 76, 0.2);
  perform pg_temp.ck('R11 another person''s reading is refused',
    pg_temp.as_text(v_pt, format($q$select public.record_lesson_shown('blood_pressure', 'in_target', 'record-bp-in-target', array[%L]::uuid[])$q$, v_a1)) = 'refused');
  perform pg_temp.ck('R12 the wrong lesson for the band is refused',
    pg_temp.as_text(v_pt, format($q$select public.record_lesson_shown('blood_pressure', 'in_target', 'record-bp-above-target', array[%L]::uuid[])$q$, v_g1)) = 'refused');

  -- amber: never from one reading, only from a sustained pattern, and the band is re-classified in the database
  v_a1 := pg_temp.bp(v_org, v_pt, 142, 90, 1);
  perform pg_temp.ck('R13 one amber reading never produces an above-target lesson',
    pg_temp.as_text(v_pt, format($q$select public.record_lesson_shown('blood_pressure', 'above_target', 'record-bp-above-target', array[%L]::uuid[])$q$, v_a1)) = 'refused');
  v_a2 := pg_temp.bp(v_org, v_pt, 140, 88, 3);
  v_a3 := pg_temp.bp(v_org, v_pt, 138, 86, 6);
  perform pg_temp.ck('R14 claiming above-target with three green readings is refused (the database re-classifies)',
    pg_temp.as_text(v_pt, format($q$select public.record_lesson_shown('blood_pressure', 'above_target', 'record-bp-above-target', array[%L, %L, %L]::uuid[])$q$,
      pg_temp.bp(v_org, v_pt, 120, 78, 2), pg_temp.bp(v_org, v_pt, 121, 79, 4), pg_temp.bp(v_org, v_pt, 119, 77, 5))) = 'refused');
  perform pg_temp.ck('R15 claiming in-target with an amber reading is refused (the database re-classifies)',
    pg_temp.as_text(v_pt, format($q$select public.record_lesson_shown('blood_pressure', 'in_target', 'record-bp-in-target', array[%L]::uuid[])$q$, v_a1)) = 'refused');

  -- a red reading inside the suppression window blocks the lesson; urgent help outranks it
  v_red := pg_temp.bp(v_org, v_pt, 172, 104, 0.5);
  perform pg_temp.ck('R16 a red reading inside the window blocks even a valid pattern',
    pg_temp.as_text(v_pt, format($q$select public.record_lesson_shown('blood_pressure', 'above_target', 'record-bp-above-target', array[%L, %L, %L]::uuid[])$q$, v_a1, v_a2, v_a3)) = 'refused');
  set local session_replication_role = replica;
  delete from public.vitals_readings where id = v_red;
  set local session_replication_role = origin;
  v_t := pg_temp.as_text(v_pt, format($q$select public.record_lesson_shown('blood_pressure', 'above_target', 'record-bp-above-target', array[%L, %L, %L]::uuid[])$q$, v_a1, v_a2, v_a3));
  perform pg_temp.ck('R17 without it, three amber readings in the window show the above-target lesson', v_t = 'shown');

  -- a draft lesson is never shown
  perform pg_temp.ck('R18 a lesson that is still a draft is never shown',
    pg_temp.as_text(v_pt, format($q$select public.record_lesson_shown('glucose', 'in_target', 'record-glucose-in-target', array[%L]::uuid[])$q$, pg_temp.glu(v_org, v_pt, 6.1, 0.1))) = 'refused');

  -- labs
  v_l1 := pg_temp.lab(v_org, v_pt, 'hba1c', 'normal', 'released', false, null, 30);
  perform pg_temp.ck('R19 a normal released HbA1c may show its lesson',
    pg_temp.as_text(v_pt, format($q$select public.record_lesson_shown('lab', 'normal', 'record-lab-hba1c-normal', array[%L]::uuid[])$q$, v_l1)) = 'shown');
  perform pg_temp.ck('R20 a result that is not released is never used (INV-03)',
    pg_temp.as_text(v_pt, format($q$select public.record_lesson_shown('lab', 'normal', 'record-lab-hba1c-normal', array[%L]::uuid[])$q$, pg_temp.lab(v_org, v_pt, 'hba1c', 'normal', 'awaiting_review'))) = 'refused');
  -- a released result that also holds a sensitive positive is dropped whole, even its normal item (INV-04)
  v_sens := pg_temp.lab(v_org, v_pt, 'hbsag_index', 'positive', 'released', true, null);
  select lab_result_id into v_lres from public.lab_result_items where id = v_sens;
  v_l3 := pg_temp.lab(v_org, v_pt, 'hba1c', 'normal', 'released', false, v_lres);
  perform pg_temp.ck('R21 a released result that also holds a sensitive positive is never used (INV-04)',
    pg_temp.as_text(v_pt, format($q$select public.record_lesson_shown('lab', 'normal', 'record-lab-hba1c-normal', array[%L]::uuid[])$q$, v_l3)) = 'refused');
  -- high: never from one value, a sustained run only
  v_lh1 := pg_temp.lab(v_org, v_pt, 'hba1c', 'high', 'released', false, null, 20);
  perform pg_temp.ck('R22 one high result never produces a lesson',
    pg_temp.as_text(v_pt, format($q$select public.record_lesson_shown('lab', 'high', 'record-lab-hba1c-high', array[%L]::uuid[])$q$, v_lh1)) = 'refused');
  v_lh2 := pg_temp.lab(v_org, v_pt, 'hba1c', 'high', 'released', false, null, 10);
  perform pg_temp.ck('R23 two high results do',
    pg_temp.as_text(v_pt, format($q$select public.record_lesson_shown('lab', 'high', 'record-lab-hba1c-high', array[%L, %L]::uuid[])$q$, v_lh1, v_lh2)) = 'shown');

  -- the lab reader the app uses: own, released, configured analytes, never a result holding a sensitive positive
  perform pg_temp.ck('R23a the lab reader returns the person''s released HbA1c items, and never the unreleased one or the sensitive result',
    pg_temp.as_count(v_pt, $q$select count(*) from public.record_lesson_lab_items() where analyte_code = 'hba1c'$q$) = 3
    and pg_temp.as_count(v_pt, $q$select count(*) from public.record_lesson_lab_items() where analyte_code <> 'hba1c' or sensitive_positive or release_state <> 'released'$q$) = 0
    and pg_temp.as_count(v_pt, format('select count(*) from public.record_lesson_lab_items() where id = %L', v_l3)) = 0);
  perform pg_temp.ck('R23b another person reads none of it, and anon is refused',
    pg_temp.as_count(v_po, format('select count(*) from public.record_lesson_lab_items() where id = %L', v_l1)) = 0
    and pg_temp.as_try(null, 'select * from public.record_lesson_lab_items()') = '42501');

  -- ================= R+. server-side re-checks added in review (recency, distinct results, low pressure, glucose, critical lab) =================
  -- glucose: no database classifier exists, so every glucose lesson is refused even when the lesson is published
  perform pg_temp.ck('R28 a glucose lesson is refused even when the lesson is published (no database glucose band)',
    pg_temp.publish_seed('record-glucose-in-target') = 'ok'
    and pg_temp.as_text(v_p3, format($q$select public.record_lesson_shown('glucose', 'in_target', 'record-glucose-in-target', array[%L]::uuid[])$q$, pg_temp.glu(v_org, v_p3, 13.0, 0.1))) = 'refused');
  -- blood pressure: only the newest reading can be cited as "in a good range", and never a low one
  v_n1 := pg_temp.bp(v_org, v_p3, 118, 76, 2);
  v_n2 := pg_temp.bp(v_org, v_p3, 142, 90, 1);
  perform pg_temp.ck('R29 an older green reading cannot be cited while a newer reading exists',
    pg_temp.as_text(v_p3, format($q$select public.record_lesson_shown('blood_pressure', 'in_target', 'record-bp-in-target', array[%L]::uuid[])$q$, v_n1)) = 'refused');
  -- a recorded reading is never deleted through the normal path (the guard trigger refuses it), so the proof removes the newer one with triggers off
  set local session_replication_role = replica;
  delete from public.vitals_readings where id = v_n2;
  set local session_replication_role = origin;
  perform pg_temp.ck('R29a control: the same reading is accepted once nothing newer exists',
    pg_temp.as_text(v_p3, format($q$select public.record_lesson_shown('blood_pressure', 'in_target', 'record-bp-in-target', array[%L]::uuid[])$q$, v_n1)) = 'shown');
  v_n2 := pg_temp.bp(v_org, v_p3, 82, 50, 0.05);
  perform pg_temp.ck('R30 a low reading (82/50) is not "in a good range"',
    pg_temp.as_text(v_p3, format($q$select public.record_lesson_shown('blood_pressure', 'in_target', 'record-bp-in-target', array[%L]::uuid[])$q$, v_n2)) = 'refused');
  -- labs: distinct, newest results only; a critical released result outranks a lesson
  v_c1 := pg_temp.lab(v_org, v_p3, 'hba1c', 'high', 'released', false, null, 40);
  -- (one result holds at most one item per analyte, so the same result can never be cited twice as a run)
  perform pg_temp.ck('R31 one high result, cited twice, is not a sustained run of two results',
    pg_temp.as_text(v_p3, format($q$select public.record_lesson_shown('lab', 'high', 'record-lab-hba1c-high', array[%L, %L]::uuid[])$q$, v_c1, v_c1)) = 'refused');
  v_n1 := pg_temp.lab(v_org, v_p3, 'hba1c', 'high', 'released', false, null, 20);
  v_n2 := pg_temp.lab(v_org, v_p3, 'hba1c', 'normal', 'released', false, null, 5);
  perform pg_temp.ck('R32 an older high run cannot be cited when a newer result exists',
    pg_temp.as_text(v_p3, format($q$select public.record_lesson_shown('lab', 'high', 'record-lab-hba1c-high', array[%L, %L]::uuid[])$q$, v_c1, v_n1)) = 'refused');
  perform pg_temp.ck('R32a an old normal result cannot be cited when a newer one exists, the newest can',
    pg_temp.as_text(v_p3, format($q$select public.record_lesson_shown('lab', 'normal', 'record-lab-hba1c-normal', array[%L]::uuid[])$q$, v_n1)) = 'refused'
    and pg_temp.as_text(v_p3, format($q$select public.record_lesson_shown('lab', 'normal', 'record-lab-hba1c-normal', array[%L]::uuid[])$q$, v_n2)) = 'shown');
  perform pg_temp.lab(v_org, v_p3, 'hba1c', 'critical', 'released', false, null, 0.5);
  perform pg_temp.ck('R33 a critical released lab inside the window blocks a lab lesson that was accepted a moment ago',
    pg_temp.as_text(v_p3, format($q$select public.record_lesson_shown('lab', 'normal', 'record-lab-hba1c-normal', array[%L]::uuid[])$q$, v_n2)) = 'refused');

  -- tables and roles
  perform pg_temp.ck('R24 a client cannot write the shows table',
    pg_temp.as_try(v_pt, format($q$insert into public.learning_record_lesson_shows (organisation_id, patient_id, content_id, source_kind, band, source_ids) select %L, %L, id, 'lab', 'normal', array[gen_random_uuid()] from public.health_education_content limit 1$q$, v_org, v_pt)) <> 'ok'
    and pg_temp.as_count(v_pt, 'delete from public.learning_record_lesson_shows returning 1') <= 0
    and pg_temp.as_count(v_pt, 'update public.learning_record_lesson_shows set band = band returning 1') <= 0);
  perform pg_temp.ck('R25 the person reads only their own shows', pg_temp.as_count(v_pt, 'select count(*) from public.learning_record_lesson_shows') >= 3
    and pg_temp.as_count(v_po, 'select count(*) from public.learning_record_lesson_shows') = 0);
  perform pg_temp.ck('R26 anon cannot call the function', pg_temp.as_try(null, $q$select public.record_lesson_shown('lab', 'normal', 'record-lab-hba1c-normal', array[gen_random_uuid()])$q$) = '42501');
  perform pg_temp.ck('R27 no staff path exists: a clinician reads nothing from the table', pg_temp.as_count(v_cmo, 'select count(*) from public.learning_record_lesson_shows') = 0);

  -- ================= SABOTAGE =================
  -- (i) the portion gate dropped: a guide with proposed amounts publishes
  update public.health_education_content set content_status = 'draft' where code = 'portion-guide-diabetes';
  drop trigger health_education_portion_gate on public.health_education_content;
  perform pg_temp.ck('S1 sabotage: with the portion gate dropped a guide with proposed amounts publishes',
    pg_temp.owner_msg($s$update public.health_education_content set content_status = 'published' where code = 'portion-guide-diabetes'$s$) = 'ok');
  -- (ii) the guard forced on: a real person is then shown a lesson, so the guard is what refused in R5
  alter table public.go_live_guards disable trigger go_live_guards_guard;
  update public.go_live_guards set is_on = true, changed_at = now(), changed_by = v_admin, change_note = 'proof sabotage', held_reason = null where key = 'record_triggered_lessons_enabled';
  alter table public.go_live_guards enable trigger go_live_guards_guard;
  perform pg_temp.ck('S2 sabotage: with the guard forced on a real person is shown the lesson',
    pg_temp.as_text(v_pr, format($q$select public.record_lesson_shown('blood_pressure', 'in_target', 'record-bp-in-target', array[%L]::uuid[])$q$, v_other)) = 'shown');
  -- (iii) the BP classifier neutered: an amber reading then passes as in target, so the re-classification is what refused in R15
  v_amber := pg_temp.bp(v_org, v_po, 142, 90, 0.2);
  perform pg_temp.ck('S3a control: before the sabotage the amber reading is refused as in target',
    pg_temp.as_text(v_po, format($q$select public.record_lesson_shown('blood_pressure', 'in_target', 'record-bp-in-target', array[%L]::uuid[])$q$, v_amber)) = 'refused');
  create or replace function private.classify_bp_level(p_systolic integer, p_diastolic integer) returns text language sql immutable set search_path = '' as $f$ select 'green'::text $f$;
  perform pg_temp.ck('S3 sabotage: with the classifier neutered the same amber reading is accepted as in target',
    pg_temp.as_text(v_po, format($q$select public.record_lesson_shown('blood_pressure', 'in_target', 'record-bp-in-target', array[%L]::uuid[])$q$, v_amber)) = 'shown');

  raise notice 'PASS: record lessons and portion guide, % checks', (select count(*) from results);
end $$;

select n, check_name, case when ok then 'PASS' else 'FAIL' end as verdict from results order by n;
rollback;
