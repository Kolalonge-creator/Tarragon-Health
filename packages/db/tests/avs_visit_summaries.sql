-- AVS proof: the clinician-approved after-visit summary (migration *_avs_after_visit_summary.sql). INV-02, 07, 10, 11.
-- Proves in one rolled-back transaction:
--   1. Signature: a draft carries no signature; approval stamps the acting doctor and time (the caller cannot forge them); a care
--      coordinator cannot approve; an approved summary is frozen; the CHECK constraints refuse an unsigned approved row.
--   2. Deterministic assembly: the draft text starts from the signed note, the checklist from the signed prescription of that note;
--      only a signed note can have a summary; a second assemble keeps the draft.
--   3. Visibility (INV-11): a patient sees nothing while the summary is a draft; sees it once approved; a stranger sees nothing;
--      withdrawing hides it; an amendment (even an unsigned draft one) hides it until it is approved again; a note withdrawn as
--      entered in error hides it; a protected note stays hidden until the note's own release; the table has no staff policy.
--   4. Caregiver: only with the view_care_plan permission, never for a protected note.
--   5. Checklist: the patient ticks an item, turns it into a care task once (idempotent), ticking completes the task; a stranger
--      cannot; the checklist is frozen after approval; the copy rules refuse a dash and "your doctor".
--   6. Events and notifications carry ids only; staff reads are audited; anon has no execute on anything.
--   7. SABOTAGE: the amendment guard and the protected-release guard are removed; both checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.next_as(p_uid uuid) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.queue_next(); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.next_task(p_uid uuid) returns uuid language sql as
$$ select (pg_temp.next_as(p_uid) -> 'task' ->> 'id')::uuid $$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'avs-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'AVS ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_comps text[], p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid; c text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'AVS ' || p_label, 'MDCN', 'AVS-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted', case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
      true, p_admin, true)
  returning id into s;
  foreach c in array p_comps loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, true);
  end loop;
  return v;
end $f$;
create function pg_temp.mkblock(p_org uuid, p_uid uuid) returns void language sql as
$$ insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
   values (p_org, p_uid, now() - interval '1 minute', now() + interval '2 hours', 'queue', true) $$;
create function pg_temp.clear_queue() returns void language plpgsql as
$f$ declare r record;
begin
  for r in select id from public.clinical_tasks where state not in ('completed', 'cancelled') loop
    update public.task_claims set ended_at = now(), end_reason = 'cancelled' where task_id = r.id and ended_at is null;
    perform private.apply_task_transition(r.id, 'cancelled', 'lead', null, 'proof cleanup of a fixture task');
  end loop;
end $f$;
-- the doctor holds a claim on the patient (the tie INV-12 needs), then writes and signs a note with the real functions
create function pg_temp.tie(p_doc uuid, p_patient uuid) returns void language plpgsql as
$f$ declare t uuid;
begin
  t := private.create_clinical_task(p_patient, 'async_question', null);
  if pg_temp.next_task(p_doc) is distinct from t then raise exception 'AVS proof: could not claim the fixture task'; end if;
end $f$;
create function pg_temp.signed_note(p_doc uuid, p_patient uuid, p_protected boolean default false) returns uuid language plpgsql as
$f$ declare v_note uuid;
begin
  perform pg_temp.act(p_doc);
  v_note := public.create_encounter_note(p_patient, 'phone', 'AVS proof note');
  if p_protected then perform public.set_note_protected(v_note, true); end if;
  perform public.update_encounter_note_draft(v_note, '{"assessment":"Your blood pressure was a little high today.","plan":"Take your tablet each morning and check again next week.","follow_up_instructions":"Come back in two weeks."}'::jsonb);
  perform public.finalize_encounter_note(v_note, 'continue_monitoring', true);
  perform pg_temp.back();
  return v_note;
end $f$;
create function pg_temp.summary_of(p_note uuid) returns uuid language sql as $$ select id from public.visit_summaries where note_id = p_note $$;
create function pg_temp.sees(p_uid uuid, p_summary uuid) returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select count(*)::text from public.visit_summaries where id = %L', p_summary)) $$;
create function pg_temp.rpc_has(p_uid uuid, p_summary uuid) returns text language sql as
$$ select (pg_temp.q_as(p_uid, 'select public.my_visit_summaries()::text') like '%' || p_summary::text || '%')::text $$;
create function pg_temp.cg_has(p_uid uuid, p_patient uuid, p_summary uuid) returns text language sql as
$$ select (pg_temp.q_as(p_uid, format('select public.my_visit_summaries(%L)::text', p_patient)) like '%' || p_summary::text || '%')::text $$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  update public.clinical_staff set active = false where is_test is not true;
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', '{adult_general}', v_admin));
  perform pg_temp.setf('doc2', pg_temp.mkdoc(v_org, 'doc2', 'senior_medical_officer', '{adult_general}', v_admin));
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', '{adult_general,on_call,prescribing,result_review,hypertension}', v_admin));
  perform pg_temp.setf('coord', pg_temp.mkdoc(v_org, 'coord', 'care_coordinator', '{}', v_admin));
  perform pg_temp.mkblock(v_org, pg_temp.f('doc'));
  perform pg_temp.mkblock(v_org, pg_temp.f('doc2'));
  perform pg_temp.mkblock(v_org, pg_temp.f('cmo'));
  perform pg_temp.setf('np', pg_temp.mkuser(v_org, 'np', 'patient'));
  perform pg_temp.setf('sp', pg_temp.mkuser(v_org, 'stranger', 'patient'));
  perform pg_temp.setf('cg', pg_temp.mkuser(v_org, 'caregiver', 'patient'));
  perform pg_temp.setf('cg2', pg_temp.mkuser(v_org, 'caregiver-narrow', 'patient'));
  -- two caregivers: one with care plan, medication and results permissions; one with the care plan permission only
  -- written as an owner-run fixture (triggers off): the real route is the patient's own session, and the consent triggers reset clinical_access otherwise
  set local session_replication_role = replica;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access, permissions)
  values (pg_temp.f('np'), pg_temp.f('cg'), 'view', pg_temp.f('np'), true, array['view_care_plan','view_medication','view_results']::public.caregiver_permission[]),
         (pg_temp.f('np'), pg_temp.f('cg2'), 'view', pg_temp.f('np'), true, array['view_care_plan']::public.caregiver_permission[]);
  set local session_replication_role = origin;
end $$;

-- 1 and 2. Assembly, signature, approval -------------------------------------------------------------------------------
do $$
declare
  v_doc uuid := pg_temp.f('doc'); v_doc2 uuid := pg_temp.f('doc2'); v_coord uuid := pg_temp.f('coord'); v_np uuid := pg_temp.f('np');
  v_sp uuid := pg_temp.f('sp'); v_cg uuid := pg_temp.f('cg'); v_cg2 uuid := pg_temp.f('cg2'); v_org uuid := pg_temp.f('org');
  n uuid; nd uuid; s uuid; v_rx uuid; v_item uuid; v_task uuid; v_before integer; v_diag text; v_items jsonb;
begin
  perform pg_temp.clear_queue();
  perform pg_temp.tie(v_doc, v_np);
  perform pg_temp.tie(pg_temp.f('doc2'), v_np);

  n := pg_temp.signed_note(v_doc, v_np);
  perform pg_temp.setf('n1', n);
  perform pg_temp.act(v_doc);
  nd := public.create_encounter_note(v_np, 'phone', 'AVS proof draft note');
  perform pg_temp.back();

  -- a signed prescription of this note (signed through the stamp trigger as the doctor)
  perform pg_temp.act(v_doc);
  insert into public.prescriptions (organisation_id, patient_id, encounter_note_id, items, state)
  values (v_org, v_np, n, '[{"drug_name":"Amlodipine","dose":"5 mg","frequency":"once a day"}]'::jsonb, 'draft') returning id into v_rx;
  update public.prescriptions set state = 'signed' where id = v_rx;
  perform pg_temp.back();

  perform pg_temp.ck('a draft note cannot have a summary', 'visit_summary_note_unsigned',
    pg_temp.try_as(v_doc, format('select public.assemble_visit_summary(%L)', nd)));
  perform pg_temp.ck('a care coordinator cannot start a summary', 'true',
    (pg_temp.try_as(v_coord, format('select public.assemble_visit_summary(%L)', n)) like '%only a doctor%'
      or pg_temp.try_as(v_coord, format('select public.assemble_visit_summary(%L)', n)) like '%not authorised%')::text);
  perform pg_temp.ck('a patient cannot start a summary', 'true',
    (pg_temp.try_as(v_np, format('select public.assemble_visit_summary(%L)', n)) <> 'ok')::text);

  perform pg_temp.ck('the author assembles a draft from the signed note', 'ok',
    pg_temp.try_as(v_doc, format('select public.assemble_visit_summary(%L)', n)));
  s := pg_temp.summary_of(n);
  perform pg_temp.setf('s1', s);
  perform pg_temp.ck('...the draft text starts from the signed note', 'true',
    (select (summary_text like '%a little high today%' and summary_text like '%Come back in two weeks%')::text from public.visit_summaries where id = s));
  perform pg_temp.ck('...the checklist carries the signed prescription as a medicine step', '1:Amlodipine',
    (select count(*)::text || ':' || max(params ->> 'drug_name') from public.visit_summary_items where summary_id = s and kind = 'medicine'));
  perform pg_temp.ck('...a draft carries no signature', 'draft:true',
    (select state || ':' || (approved_by is null and approved_at is null and approved_by_staff is null)::text from public.visit_summaries where id = s));
  perform pg_temp.ck('a second assemble keeps the one draft and its items', '1:1',
    (select pg_temp.try_as(v_doc, format('select public.assemble_visit_summary(%L)', n)) is not null)::int::text || ':' ||
    (select count(*)::text from public.visit_summary_items where summary_id = s and kind = 'medicine'));
  perform pg_temp.ck('...still one summary for the note', '1', (select count(*)::text from public.visit_summaries where note_id = n));

  -- the patient and a stranger see nothing of a draft
  perform pg_temp.ck('the patient sees no row of a draft (table)', '0', pg_temp.sees(v_np, s));
  perform pg_temp.ck('the patient reads no draft through the function', 'false', pg_temp.rpc_has(v_np, s));
  perform pg_temp.ck('...nor the draft items', '0', pg_temp.q_as(v_np, 'select count(*)::text from public.visit_summary_items'));
  perform pg_temp.ck('a doctor has no direct table read either (audited function only)', '0', pg_temp.sees(v_doc, s));

  -- the review read is audited
  select count(*) into v_before from public.audit_log where action = 'staff.chart_read' and event ->> 'reason' = 'review visit summary';
  perform pg_temp.ck('the doctor reads the draft through the review function', 'true',
    (pg_temp.q_as(v_doc, format('select public.read_visit_summary_for_review(%L)::text', n)) like '%a little high today%')::text);
  perform pg_temp.ck('...which wrote an audit row', 'true',
    ((select count(*) from public.audit_log where action = 'staff.chart_read' and event ->> 'reason' = 'review visit summary') = v_before + 1)::text);


  -- copy rules and approval
  perform pg_temp.ck('a summary of 20 characters or less cannot be approved', 'visit_summary_text_needed',
    (select case when pg_temp.try_as(v_doc, format($q$select public.update_visit_summary_draft(%L, 'Too short.', null)$q$, s)) = 'ok'
                 then pg_temp.try_as(v_doc, format('select public.approve_visit_summary(%L)', s)) end));
  perform pg_temp.ck('a dash is refused at approval', 'visit_summary_copy_rules',
    (select case when pg_temp.try_as(v_doc, format($q$select public.update_visit_summary_draft(%L, 'Your care team checked your readings today ' || chr(8212) || ' all is well and steady.', null)$q$, s)) = 'ok'
                 then pg_temp.try_as(v_doc, format('select public.approve_visit_summary(%L)', s)) end));
  perform pg_temp.ck('"your doctor" is refused at approval', 'visit_summary_copy_rules',
    (select case when pg_temp.try_as(v_doc, format($q$select public.update_visit_summary_draft(%L, 'Please ask your doctor about the tablets and how to take them.', null)$q$, s)) = 'ok'
                 then pg_temp.try_as(v_doc, format('select public.approve_visit_summary(%L)', s)) end));
  perform pg_temp.ck('a dash inside one checklist step is refused too', 'visit_summary_copy_rules',
    (select case when pg_temp.try_as(v_doc, format($q$select public.update_visit_summary_draft(%L, 'Your blood pressure was a little high today. Take your tablet each morning.',
        jsonb_build_array(jsonb_build_object('kind','custom','custom_text','Rest ' || chr(8211) || ' then recheck')))$q$, s)) = 'ok'
                 then pg_temp.try_as(v_doc, format('select public.approve_visit_summary(%L)', s)) end));
  -- put the real medicine step back and write good plain text
  perform pg_temp.act(v_doc);
  perform public.assemble_visit_summary(n);
  perform pg_temp.back();
  perform pg_temp.ck('the draft keeps its source items on a second assemble (medicine step restored by the source key)', '1',
    (select count(*)::text from public.visit_summary_items where summary_id = s and source_table = 'prescriptions'));
  select id into v_item from public.visit_summary_items where summary_id = s and kind = 'medicine';
  perform pg_temp.setf('item_med', v_item);
  -- the items list is built as the table owner: the doctor has no read policy on checklist items (doctors read through the audited
  -- function), so a sub-select inside the doctor's own statement sees nothing and the function would leave the items untouched
  v_items := (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'params', params)), '[]'::jsonb)
                from public.visit_summary_items where summary_id = s and kind <> 'custom')
             || jsonb_build_array(jsonb_build_object('kind', 'recheck', 'custom_text', 'Check your blood pressure at home again.', 'due_on', '2026-11-03'));
  v_diag := pg_temp.try_as(v_doc, format($q$select public.update_visit_summary_draft(%L, 'Your blood pressure was a little high today. Your care team asked you to take your tablet each morning and to check again next week.', %L::jsonb)$q$, s, v_items::text));
  perform pg_temp.ck('a good plain-language text saves', 'ok', v_diag);

  -- a client cannot write the table or forge the signature
  perform pg_temp.ck('a doctor cannot update the table directly', 'true',
    (pg_temp.try_as(v_doc, format($q$update public.visit_summaries set state = 'approved' where id = %L$q$, s)) like 'permission denied%')::text);
  perform pg_temp.ck('a doctor cannot insert into the table directly', 'true',
    (pg_temp.try_as(v_doc, format($q$insert into public.visit_summaries (organisation_id, patient_id, note_id) values (%L, %L, %L)$q$, v_org, v_np, nd)) like 'permission denied%')::text);
  perform pg_temp.ck('a care coordinator cannot approve', 'true',
    (pg_temp.try_as(v_coord, format('select public.approve_visit_summary(%L)', s)) <> 'ok')::text);
  perform pg_temp.ck('the patient cannot approve their own summary', 'true',
    (pg_temp.try_as(v_np, format('select public.approve_visit_summary(%L)', s)) <> 'ok')::text);
  perform pg_temp.ck('a stranger patient sees nothing of the draft', '0', pg_temp.sees(v_sp, s));

  v_diag := pg_temp.try_as(v_doc, format('select public.approve_visit_summary(%L)', s));
  perform pg_temp.ck('the doctor approves', 'ok', v_diag);
  perform pg_temp.ck('...the signature is the acting doctor and a time, stamped by the database', 'true',
    (select (approved_by = v_doc and approved_at is not null and approved_by_staff = (select id from public.clinical_staff where profile_id = v_doc)
             and amendment_count_at_approval = 0 and state = 'approved')::text from public.visit_summaries where id = s));
  perform pg_temp.ck('...approval of an approved summary is refused', 'visit_summary_not_a_draft',
    pg_temp.try_as(v_doc, format('select public.approve_visit_summary(%L)', s)));
  perform pg_temp.ck('...the text is frozen', '42501',
    pg_temp.try_sql(format($q$update public.visit_summaries set summary_text = 'A different text that nobody signed here.' where id = %L$q$, s)));
  perform pg_temp.ck('...the signature cannot be moved', '42501',
    pg_temp.try_sql(format($q$update public.visit_summaries set approved_by = %L where id = %L$q$, v_doc2, s)));
  perform pg_temp.ck('...the checklist is frozen (edit)', '42501',
    pg_temp.try_sql(format($q$update public.visit_summary_items set custom_text = 'Changed after signing' where id = %L$q$, v_item)));
  perform pg_temp.ck('...the checklist is frozen (add)', '42501',
    pg_temp.try_sql(format($q$insert into public.visit_summary_items (summary_id, kind) values (%L, 'custom')$q$, s)));
  perform pg_temp.ck('...the checklist is frozen (remove)', '42501',
    pg_temp.try_sql(format($q$delete from public.visit_summary_items where id = %L$q$, v_item)));
  perform pg_temp.ck('...a draft cannot be edited through the draft function once approved', 'visit_summary_not_a_draft',
    pg_temp.try_as(v_doc, format($q$select public.update_visit_summary_draft(%L, 'Trying to edit an approved summary now.', null)$q$, s)));

  -- the CHECK constraints are the floor under the trigger
  alter table public.visit_summaries disable trigger visit_summaries_guard;
  perform pg_temp.ck('CHECK: an approved row with no signature is refused', '23514',
    pg_temp.try_sql(format($q$insert into public.visit_summaries (organisation_id, patient_id, note_id, state, summary_text) values (%L, %L, %L, 'approved', 'A text that is long enough to pass.')$q$, v_org, v_np, nd)));
  perform pg_temp.ck('CHECK: a draft row that carries a signature is refused', '23514',
    pg_temp.try_sql(format($q$insert into public.visit_summaries (organisation_id, patient_id, note_id, state, approved_by, approved_at) values (%L, %L, %L, 'draft', %L, now())$q$, v_org, v_np, nd, v_doc)));
  alter table public.visit_summaries enable trigger visit_summaries_guard;

  -- visibility once approved
  perform pg_temp.ck('the patient now sees the row', '1', pg_temp.sees(v_np, s));
  perform pg_temp.ck('...and through the function, with the doctor named', 'true',
    (pg_temp.q_as(v_np, 'select public.my_visit_summaries()::text') like '%AVS doc%')::text);
  perform pg_temp.ck('...and the items', '2', pg_temp.q_as(v_np, 'select count(*)::text from public.visit_summary_items'));
  perform pg_temp.ck('a stranger patient sees nothing (table)', '0', pg_temp.sees(v_sp, s));
  perform pg_temp.ck('a stranger patient sees nothing (function)', 'false', pg_temp.rpc_has(v_sp, s));
  perform pg_temp.ck('staff have no direct read of the table', '0', pg_temp.sees(v_doc2, s));
  perform pg_temp.ck('a caregiver with care plan, medication and results permissions sees it (table)', '1', pg_temp.sees(v_cg, s));
  perform pg_temp.ck('...and through the function', 'true', pg_temp.cg_has(v_cg, v_np, s));
  perform pg_temp.ck('a caregiver with the care plan permission only sees nothing (table)', '0', pg_temp.sees(v_cg2, s));
  perform pg_temp.ck('...nor through the function', 'false', pg_temp.cg_has(v_cg2, v_np, s));
  perform pg_temp.ck('a stranger cannot ask for someone else through the function', 'false', pg_temp.cg_has(v_sp, v_np, s));

  -- events and notifications: ids only
  perform pg_temp.ck('the approved event carries ids only', jsonb_build_object('summary_id', s, 'note_id', n)::text,
    (select payload::text from public.domain_events where event_type = 'visit_summary.approved' and aggregate_id = s limit 1));
  perform pg_temp.ck('the patient was told neutrally, once', '1',
    (select count(*)::text from public.notifications where recipient_id = v_np and template = 'visit_summary_ready'));
  perform pg_temp.ck('...the notification payload names only the summary', jsonb_build_object('summary_id', s)::text,
    (select payload::text from public.notifications where recipient_id = v_np and template = 'visit_summary_ready' limit 1));
  perform pg_temp.ck('reading the list writes nothing (no event, no audit row)', '0:0',
    (select count(*)::text from public.domain_events where event_type = 'visit_summary.viewed' and aggregate_id = s) || ':' ||
    (select count(*)::text from public.audit_log where action = 'visit_summary.patient_read' and entity_id = s));
  perform pg_temp.ck('the patient opens the summary', 'ok', pg_temp.try_as(v_np, format('select public.record_visit_summary_opened(%L)', s)));
  perform pg_temp.ck('...which raised the viewed event, ids only', jsonb_build_object('summary_id', s, 'note_id', n)::text,
    (select payload::text from public.domain_events where event_type = 'visit_summary.viewed' and aggregate_id = s limit 1));
  perform pg_temp.ck('...and one audit row', '1', (select count(*)::text from public.audit_log where action = 'visit_summary.patient_read' and entity_id = s));
  perform pg_temp.try_as(v_np, format('select public.record_visit_summary_opened(%L)', s));
  perform pg_temp.ck('opening it again the same day adds no row', '1:1',
    (select count(*)::text from public.audit_log where action = 'visit_summary.patient_read' and entity_id = s) || ':' ||
    (select count(*)::text from public.domain_events where event_type = 'visit_summary.viewed' and aggregate_id = s));
  perform pg_temp.ck('a stranger cannot record an opening', 'true', (pg_temp.try_as(v_sp, format('select public.record_visit_summary_opened(%L)', s)) like 'not found%')::text);
  perform pg_temp.ck('a caregiver with the full permissions can', 'ok', pg_temp.try_as(v_cg, format('select public.record_visit_summary_opened(%L)', s)));
  perform pg_temp.ck('a caregiver with the care plan permission only cannot', 'true', (pg_temp.try_as(v_cg2, format('select public.record_visit_summary_opened(%L)', s)) like 'not found%')::text);

  -- the checklist
  perform pg_temp.ck('the patient ticks a step', 'ok', pg_temp.try_as(v_np, format('select public.set_visit_summary_item_done(%L, true)', v_item)));
  perform pg_temp.ck('...it is stored', 'true', ((select done_at from public.visit_summary_item_progress where item_id = v_item) is not null)::text);
  perform pg_temp.ck('a stranger cannot tick it', 'true', (pg_temp.try_as(v_sp, format('select public.set_visit_summary_item_done(%L, true)', v_item)) like 'not found%')::text);
  perform pg_temp.ck('a caregiver cannot tick it (read only)', 'true', (pg_temp.try_as(v_cg, format('select public.set_visit_summary_item_done(%L, true)', v_item)) like 'not found%')::text);
  v_task := (pg_temp.q_as(v_np, format('select public.add_visit_summary_item_to_tasks(%L)::text', v_item)))::uuid;
  perform pg_temp.ck('the patient adds the step to their tasks', 'true',
    (select (patient_id = v_np and source = 'visit_summary' and owner_role = 'patient')::text from public.care_tasks where id = v_task));
  perform pg_temp.ck('...adding it again returns the same task', v_task::text, pg_temp.q_as(v_np, format('select public.add_visit_summary_item_to_tasks(%L)::text', v_item)));
  perform pg_temp.ck('...a stranger cannot add it', 'true', (pg_temp.try_as(v_sp, format('select public.add_visit_summary_item_to_tasks(%L)', v_item)) like 'not found%')::text);
  perform pg_temp.ck('...the step was already ticked, so the task is completed at once', 'completed', (select status::text from public.care_tasks where id = v_task));
  v_diag := pg_temp.try_as(v_np, format('select public.set_visit_summary_item_done(%L, false)', v_item));
  perform pg_temp.ck('...unticking reopens it', 'not_started',
    (select case when v_diag = 'ok' then (select status::text from public.care_tasks where id = v_task) else v_diag end));
  perform pg_temp.ck('the recheck step carries its date', '2026-11-03',
    (select due_on::text from public.visit_summary_items where summary_id = s and kind = 'recheck'));

  perform pg_temp.setf('s', s);
  perform pg_temp.setf('n', n);
end $$;

-- 3. Amendment, withdrawal, entered in error, protected ---------------------------------------------------------------------
do $$
declare
  v_doc uuid := pg_temp.f('doc'); v_cmo uuid := pg_temp.f('cmo'); v_np uuid := pg_temp.f('np'); v_cg uuid := pg_temp.f('cg');
  n uuid := pg_temp.f('n'); s uuid := pg_temp.f('s');
  a uuid; n2 uuid; s2 uuid; n3 uuid; s3 uuid; n4 uuid; s4 uuid; v_rev integer; v_items jsonb; v_items2 jsonb; v_told integer; v_diag text;
  n6 uuid; s6 uuid; a1 uuid; a2 uuid; n7 uuid; s7 uuid; v_rx7 uuid;
begin
  -- an amendment still being written hides the summary
  perform pg_temp.act(v_doc);
  a := public.create_note_amendment(n, 'addendum', 'Adding something for the patient later');
  perform pg_temp.back();
  perform pg_temp.ck('an unsigned amendment hides the approved summary (table)', '0', pg_temp.sees(v_np, s));
  perform pg_temp.ck('...and through the function', 'false', pg_temp.rpc_has(v_np, s));
  perform pg_temp.ck('...the review read says it is stale', 'true',
    (pg_temp.q_as(v_doc, format('select public.read_visit_summary_for_review(%L)::text', n)) like '%"stale": true%')::text);
  perform pg_temp.act(v_doc);
  perform public.update_encounter_note_draft(a, '{"plan":"Take the tablet at night instead."}'::jsonb);
  perform public.finalize_encounter_note(a, 'continue_monitoring', true);
  perform pg_temp.back();
  perform pg_temp.ck('...a signed amendment keeps it hidden until it is approved again', '0', pg_temp.sees(v_np, s));
  perform pg_temp.ck('assemble reopens the stale summary as revision 2', 'ok', pg_temp.try_as(v_doc, format('select public.assemble_visit_summary(%L)', n)));
  select revision into v_rev from public.visit_summaries where id = s;
  perform pg_temp.ck('...a draft again, with the old approval kept on record', '2:draft:1',
    v_rev::text || ':' || (select state from public.visit_summaries where id = s) || ':' || (select count(*)::text from public.visit_summary_revisions where summary_id = s));
  perform pg_temp.ck('...the draft carries no signature again', 'true',
    (select (approved_by is null and approved_at is null)::text from public.visit_summaries where id = s));
  perform pg_temp.ck('...and the patient still sees nothing', '0', pg_temp.sees(v_np, s));
  perform pg_temp.ck('...the tick-off survived the reopening', 'true',
    (exists (select 1 from public.visit_summary_item_progress where summary_id = s))::text);
  -- a step whose wording changes starts unticked; an unchanged step keeps its tick
  -- the items lists are built as the table owner: the doctor has no read policy on checklist items, so a sub-select inside the doctor's own statement is empty
  v_items := (select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'params', params, 'custom_text', custom_text, 'due_on', due_on)) from public.visit_summary_items where summary_id = s);
  v_items2 := (select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'params', params, 'custom_text', 'Take the tablet at night instead.', 'due_on', due_on)) from public.visit_summary_items where summary_id = s);
  perform pg_temp.ck('(reopened draft) an unchanged save keeps the tick', 'true',
    (pg_temp.try_as(v_doc, format($q$select public.update_visit_summary_draft(%L, null, %L::jsonb)$q$, s, v_items::text)) = 'ok'
     and exists (select 1 from public.visit_summary_item_progress where summary_id = s))::text);
  v_diag := pg_temp.try_as(v_doc, format($q$select public.update_visit_summary_draft(%L, null, %L::jsonb)$q$, s, v_items2::text));
  perform pg_temp.ck('...a changed wording clears the old tick', '0',
    (select case when v_diag = 'ok' then (select count(*)::text from public.visit_summary_item_progress where summary_id = s) else v_diag end));
  perform pg_temp.ck('approved again', 'ok', pg_temp.try_as(v_doc, format('select public.approve_visit_summary(%L)', s)));
  perform pg_temp.ck('...visible again, with the new count stamped', '1:1',
    pg_temp.sees(v_np, s) || ':' || (select amendment_count_at_approval::text from public.visit_summaries where id = s));

  -- withdrawal
  perform pg_temp.ck('a withdrawal needs a reason', 'visit_summary_reason_needed', pg_temp.try_as(v_doc, format($q$select public.withdraw_visit_summary(%L, 'oops')$q$, s)));
  perform pg_temp.ck('the doctor takes the summary back', 'ok', pg_temp.try_as(v_doc, format($q$select public.withdraw_visit_summary(%L, 'Wrong advice about the dose was written')$q$, s)));
  perform pg_temp.ck('...the patient sees nothing', '0', pg_temp.sees(v_np, s));
  perform pg_temp.ck('...and through the function', 'false', pg_temp.rpc_has(v_np, s));
  perform pg_temp.ck('...the patient was told neutrally', '1', (select count(*)::text from public.notifications where recipient_id = v_np and template = 'visit_summary_withdrawn'));
  perform pg_temp.ck('...a withdrawn summary cannot be approved without a new draft', 'visit_summary_not_a_draft',
    pg_temp.try_as(v_doc, format('select public.approve_visit_summary(%L)', s)));

  -- a note withdrawn as entered in error takes its summary with it
  perform pg_temp.clear_queue();   -- one active claim per doctor: release the earlier fixture claim before the next tie
  perform pg_temp.tie(v_doc, v_np);
  n2 := pg_temp.signed_note(v_doc, v_np);
  perform pg_temp.act(v_doc); perform public.assemble_visit_summary(n2); perform pg_temp.back();
  s2 := pg_temp.summary_of(n2);
  perform pg_temp.ck('a second summary is approved', 'ok', pg_temp.try_as(v_doc, format('select public.approve_visit_summary(%L)', s2)));
  perform pg_temp.ck('...and visible', '1', pg_temp.sees(v_np, s2));
  perform pg_temp.ck('the note is withdrawn as entered in error', 'ok',
    pg_temp.try_as(v_doc, format($q$select public.mark_note_entered_in_error(%L, 'Entered on the wrong patient chart')$q$, n2)));
  perform pg_temp.ck('...the summary goes with it', '0', pg_temp.sees(v_np, s2));
  perform pg_temp.ck('...and a withdrawn note cannot get a new draft', 'visit_summary_note_withdrawn', pg_temp.try_as(v_doc, format('select public.assemble_visit_summary(%L)', n2)));

  -- a protected note: hidden until the note itself is released, and never to a caregiver
  n3 := pg_temp.signed_note(v_doc, v_np, true);
  perform pg_temp.act(v_doc); perform public.assemble_visit_summary(n3); perform pg_temp.back();
  s3 := pg_temp.summary_of(n3);
  v_told := (select count(*) from public.notifications where recipient_id = v_np and template = 'visit_summary_ready');
  perform pg_temp.ck('a protected note summary is approved by the doctor', 'ok', pg_temp.try_as(v_doc, format('select public.approve_visit_summary(%L)', s3)));
  perform pg_temp.ck('...but the patient cannot see it before the note is released', '0', pg_temp.sees(v_np, s3));
  perform pg_temp.ck('...nor through the function', 'false', pg_temp.rpc_has(v_np, s3));
  perform pg_temp.ck('...the patient was not told', v_told::text, (select count(*)::text from public.notifications where recipient_id = v_np and template = 'visit_summary_ready'));
  perform pg_temp.ck('...the review read says so', 'true',
    (pg_temp.q_as(v_doc, format('select public.read_visit_summary_for_review(%L)::text', n3)) like '%"patient_can_see": false%')::text);
  perform pg_temp.ck('only the CMO can release a protected note', 'note_release_cmo_only',
    pg_temp.try_as(v_doc, format('select public.decide_note_release(%L, true, null)', n3)));
  perform pg_temp.tie(v_cmo, v_np);   -- the real release function checks the CMO's tie to the patient
  perform pg_temp.ck('the CMO releases it', 'ok', pg_temp.try_as(v_cmo, format('select public.decide_note_release(%L, true, null)', n3)));
  perform pg_temp.ck('...now the patient sees the summary', '1', pg_temp.sees(v_np, s3));
  perform pg_temp.ck('...but a caregiver still never does (table)', '0', pg_temp.sees(v_cg, s3));
  perform pg_temp.ck('...nor through the function', 'false', pg_temp.cg_has(v_cg, v_np, s3));

  -- an amendment of an amendment also hides the summary (the chain is walked, not only the first level)
  perform pg_temp.clear_queue();   -- one active claim per doctor: release the earlier fixture claim before the next tie
  perform pg_temp.tie(v_doc, v_np);
  n6 := pg_temp.signed_note(v_doc, v_np);
  perform pg_temp.act(v_doc); perform public.assemble_visit_summary(n6); perform pg_temp.back();
  s6 := pg_temp.summary_of(n6);
  perform pg_temp.try_as(v_doc, format('select public.approve_visit_summary(%L)', s6));
  perform pg_temp.act(v_doc);
  a1 := public.create_note_amendment(n6, 'addendum', 'First addition for the patient to read');
  perform public.update_encounter_note_draft(a1, '{"plan":"First amendment text."}'::jsonb);
  perform public.finalize_encounter_note(a1, 'continue_monitoring', true);
  perform public.assemble_visit_summary(n6);
  perform pg_temp.back();
  perform pg_temp.ck('(chain) approved again after the first amendment', 'ok', pg_temp.try_as(v_doc, format('select public.approve_visit_summary(%L)', s6)));
  perform pg_temp.ck('(chain) visible with one signed amendment stamped', '1:1',
    pg_temp.sees(v_np, s6) || ':' || (select amendment_count_at_approval::text from public.visit_summaries where id = s6));
  perform pg_temp.act(v_doc);
  a2 := public.create_note_amendment(a1, 'correction', 'Correcting the first addition as well');
  perform pg_temp.back();
  perform pg_temp.ck('(chain) a draft amendment of the amendment hides the summary', '0', pg_temp.sees(v_np, s6));
  perform pg_temp.act(v_doc);
  perform public.update_encounter_note_draft(a2, '{"plan":"Second amendment text."}'::jsonb);
  perform public.finalize_encounter_note(a2, 'continue_monitoring', true);
  perform pg_temp.back();
  perform pg_temp.ck('(chain) ...and still hides it once signed', '0', pg_temp.sees(v_np, s6));

  -- a cancelled prescription drops its step from what the patient sees
  n7 := pg_temp.signed_note(v_doc, v_np);
  perform pg_temp.act(v_doc);
  insert into public.prescriptions (organisation_id, patient_id, encounter_note_id, items, state)
  values (pg_temp.f('org'), v_np, n7, '[{"drug_name":"Losartan","dose":"50 mg","frequency":"once a day"}]'::jsonb, 'draft') returning id into v_rx7;
  update public.prescriptions set state = 'signed' where id = v_rx7;
  perform public.assemble_visit_summary(n7);
  perform pg_temp.back();
  s7 := pg_temp.summary_of(n7);
  perform pg_temp.try_as(v_doc, format('select public.approve_visit_summary(%L)', s7));
  perform pg_temp.ck('(source) the medicine step is visible while the prescription stands', '1',
    pg_temp.q_as(v_np, format('select count(*)::text from public.visit_summary_items where summary_id = %L', s7)));
  perform pg_temp.ck('(source) ...and in the function', 'true', (pg_temp.q_as(v_np, 'select public.my_visit_summaries()::text') like '%Losartan%')::text);
  perform pg_temp.ck('(source) the prescription is cancelled', 'ok', pg_temp.try_sql(format($q$update public.prescriptions set state = 'cancelled' where id = %L$q$, v_rx7)));
  perform pg_temp.ck('(source) the step is gone from the table', '0',
    pg_temp.q_as(v_np, format('select count(*)::text from public.visit_summary_items where summary_id = %L', s7)));
  perform pg_temp.ck('(source) ...and from the function', 'false', (pg_temp.q_as(v_np, 'select public.my_visit_summaries()::text') like '%Losartan%')::text);
  perform pg_temp.ck('(source) ...and the doctor is told the step is no longer in force', 'true',
    (pg_temp.q_as(v_doc, format('select public.read_visit_summary_for_review(%L)::text', n7)) like '%"source_ok": false%')::text);

  -- fixtures for the sabotage: an approved summary with a pending amendment, and an approved unreleased protected one
  n4 := pg_temp.signed_note(v_doc, v_np);
  perform pg_temp.act(v_doc); perform public.assemble_visit_summary(n4); perform pg_temp.back();
  s4 := pg_temp.summary_of(n4);
  perform pg_temp.try_as(v_doc, format('select public.approve_visit_summary(%L)', s4));
  perform pg_temp.act(v_doc); perform public.create_note_amendment(n4, 'addendum', 'Adding something for the patient later'); perform pg_temp.back();
  perform pg_temp.ck('(sabotage fixture) a pending amendment hides the summary', '0', pg_temp.sees(v_np, s4));
  perform pg_temp.setf('s4', s4);
  perform pg_temp.setf('n5', pg_temp.signed_note(v_doc, v_np, true));
  perform pg_temp.act(v_doc); perform public.assemble_visit_summary(pg_temp.f('n5')); perform pg_temp.back();
  perform pg_temp.setf('s5', pg_temp.summary_of(pg_temp.f('n5')));
  perform pg_temp.try_as(v_doc, format('select public.approve_visit_summary(%L)', pg_temp.f('s5')));
  perform pg_temp.ck('(sabotage fixture) an unreleased protected summary is hidden', '0', pg_temp.sees(v_np, pg_temp.f('s5')));
end $$;

-- 4. Grants ---------------------------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.assemble_visit_summary(uuid)', 'public.update_visit_summary_draft(uuid,text,jsonb)', 'public.read_visit_summary_for_review(uuid)',
    'public.approve_visit_summary(uuid)', 'public.withdraw_visit_summary(uuid,text)', 'public.my_visit_summaries(uuid)',
    'public.record_visit_summary_opened(uuid)', 'public.set_visit_summary_item_done(uuid,boolean)', 'public.add_visit_summary_item_to_tasks(uuid)',
    'private.visit_summary_state_ok(uuid)', 'private.visit_summary_caregiver_ok(uuid)', 'private.visit_summary_caregiver_may(uuid)',
    'private.visit_summary_amend_counts(uuid)', 'private.visit_summary_item_source_ok(text,text)', 'private.avs_emit(text,uuid,text)', 'private.avs_assert_doctor(uuid)'
  ] loop
    perform pg_temp.ck('anon cannot execute ' || f, 'false', has_function_privilege('anon', f, 'EXECUTE')::text);
  end loop;
  perform pg_temp.ck('anon cannot read the summaries table', '42501', pg_temp.try_anon('select count(*) from public.visit_summaries'));
  perform pg_temp.ck('anon cannot call the patient function', '42501', pg_temp.try_anon('select public.my_visit_summaries()'));
  perform pg_temp.ck('authenticated has its select grants', 'true',
    (has_table_privilege('authenticated', 'public.visit_summaries', 'SELECT') and has_table_privilege('authenticated', 'public.visit_summary_items', 'SELECT')
     and has_table_privilege('authenticated', 'public.visit_summary_item_progress', 'SELECT'))::text);
  perform pg_temp.ck('authenticated has no write grant on any of them', 'false',
    (has_table_privilege('authenticated', 'public.visit_summaries', 'INSERT, UPDATE, DELETE') or has_table_privilege('authenticated', 'public.visit_summary_items', 'INSERT, UPDATE, DELETE')
     or has_table_privilege('authenticated', 'public.visit_summary_item_progress', 'INSERT, UPDATE, DELETE'))::text);
  perform pg_temp.ck('the revisions table has no client access at all', 'false',
    has_table_privilege('authenticated', 'public.visit_summary_revisions', 'SELECT')::text);
  perform pg_temp.ck('the four tables are in the data registry', '4',
    (select count(*)::text from public.data_registry where table_name in ('visit_summaries', 'visit_summary_items', 'visit_summary_item_progress', 'visit_summary_revisions')));
  perform pg_temp.ck('the three tables have row level security on', '3',
    (select count(*)::text from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relname in ('visit_summaries', 'visit_summary_items', 'visit_summary_item_progress') and c.relrowsecurity));
  perform pg_temp.ck('there is no staff or write policy on the summaries table', '0',
    (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'visit_summaries' and (cmd <> 'SELECT' or policyname not in ('visit_summaries_patient_select', 'visit_summaries_caregiver_select'))));
  perform pg_temp.ck('the INV-07 neutral templates name no clinical term', '0',
    (select count(*)::text from public.notification_template_locales l
      where l.template_key in ('visit_summary_ready', 'visit_summary_withdrawn')
        and (l.body ~* '(blood|pressure|diabet|medicine|result|tablet|reading|lab|doctor)' or l.subject ~* '(blood|pressure|diabet|medicine|result|tablet|reading|lab|doctor)')));
end $$;

-- 5. SABOTAGE: remove the amendment guard and the protected-release guard; both checks must flip ------------------------------
create or replace function private.visit_summary_state_ok(p_summary uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.visit_summaries s join public.clinical_encounter_notes n on n.id = s.note_id
     where s.id = p_summary and s.state = 'approved' and n.status = 'finalized' and n.patient_id = s.patient_id
       and not exists (select 1 from public.note_error_flags f where f.note_id = n.id)
  );
$$;

do $$
begin
  insert into results values ('sabotaged', 'a pending amendment hides the approved summary', '0', pg_temp.sees(pg_temp.f('np'), pg_temp.f('s4')));
  insert into results values ('sabotaged', 'an unreleased protected summary stays hidden', '0', pg_temp.sees(pg_temp.f('np'), pg_temp.f('s5')));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'AVS proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
  if (select count(*) from results where phase = 'real') < 90 then raise exception 'AVS proof ran too few checks'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
