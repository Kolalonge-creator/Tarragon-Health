-- S22e proof: the care-team inbox stays shared by every org staff account, and message bodies and attachments are opened only
-- through audited functions (migration *_s22e_audited_care_inbox.sql; OQ-157, founder decision 2026-10-06). Proves in one
-- rolled-back transaction: staff cannot read message or attachment rows directly (headers still work); open_care_thread_audited and
-- open_care_attachment_audited return the content and write one audit row per person per window; the patient reads their own
-- thread without an audit row; another patient and the scope lookup refuse a stranger; a confidential thread still opens for staff;
-- staff can still reply; the communication log keeps working and carries no body.
-- SABOTAGE: the old staff select policy restored, and the open function without its audit insert; both checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- run a statement as a user; returns 'ok' or the error message (the message is the stable queue_* code)
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- run a scalar query as a user; returns the value as text, or 'ERR:' || message
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- the same as anon
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
-- 'claimed', the error code, or the reason no task was given
create function pg_temp.next_outcome(p_uid uuid) returns text language sql as
$$ select coalesce(r ->> 'error', case when jsonb_typeof(r -> 'task') = 'object' then 'claimed' else r ->> 'reason' end)
     from (select pg_temp.next_as(p_uid) as r) x $$;
create function pg_temp.backdate(p_task uuid, p_set text) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.task_transition', 'on', true);
  execute format('update public.clinical_tasks set %s where id = %L', p_set, p_task);
  perform set_config('tarragon.task_transition', 'off', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's22-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S22 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_emp text, p_comps text[], p_admin uuid, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid; s uuid; c text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S22 ' || p_label, 'MDCN', 'S17-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, p_emp::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
      p_emp = 'contracted', case when p_emp = 'contracted' then p_admin else null end, p_test)
  returning id into s;
  foreach c in array p_comps loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, true);
  end loop;
  return v;
end $f$;
create function pg_temp.mkblock(p_org uuid, p_uid uuid) returns void language sql as
$$ insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
   values (p_org, p_uid, now() - interval '1 minute', now() + interval '2 hours', 'queue', true) $$;
create function pg_temp.mktask(p_patient uuid, p_type text, p_due integer default null) returns uuid language sql as
$$ select private.create_clinical_task(p_patient, p_type, p_due) $$;
-- fixture cleanup without deleting (the logs are append only): end any live claim and cancel what is left
create function pg_temp.clear_queue() returns void language plpgsql as
$f$ declare r record;
begin
  for r in select id from public.clinical_tasks where state not in ('completed', 'cancelled') loop
    update public.task_claims set ended_at = now(), end_reason = 'cancelled' where task_id = r.id and ended_at is null;
    perform private.apply_task_transition(r.id, 'cancelled', 'lead', null, 'proof cleanup of a fixture task');
  end loop;
end $f$;
create function pg_temp.state_of(p_task uuid) returns text language sql as $$ select state::text from public.clinical_tasks where id = p_task $$;
create function pg_temp.score_of(p_uid uuid) returns text language sql as $$ select reliability_score::text from public.clinical_staff where profile_id = p_uid $$;




-- S22b helpers
create function pg_temp.staff_of(p_uid uuid) returns uuid language sql as $$ select id from public.clinical_staff where profile_id = p_uid $$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.submit(p_uid uuid, p_q text, p_client uuid default null) returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select public.submit_written_question(%L, %L, null, %L)::text', 'symptom', p_q, p_client)) $$;
create function pg_temp.queue_as(p_uid uuid, p_types text) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin execute format('select public.queue_next(%s)', p_types) into r; exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;



create function pg_temp.consult_of(p_patient uuid) returns uuid language sql as
$$ select id from public.async_consults where patient_id = p_patient order by created_at desc limit 1 $$;



-- Fixtures -------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  update public.clinical_staff set active = false where is_test is not true;
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', 'contracted', '{adult_general}', v_admin));
  perform pg_temp.setf('doc2', pg_temp.mkdoc(v_org, 'doc2', 'senior_medical_officer', 'contracted', '{adult_general}', v_admin));
  perform pg_temp.setf('np', pg_temp.mkuser(v_org, 'np', 'patient'));
  perform pg_temp.setf('np2', pg_temp.mkuser(v_org, 'np2', 'patient'));
  perform pg_temp.setf('sup', pg_temp.mkuser(v_org, 'sup', 'patient'));
  perform pg_temp.setf('pat', pg_temp.f('np'));
end $$;

do $$
declare
  v_np uuid := pg_temp.f('np'); v_doc uuid := pg_temp.f('doc'); t text; tc text; m uuid; a uuid; v_org uuid := pg_temp.f('org');
begin
  t := pg_temp.q_as(v_np, $q$select public.start_care_thread('About my knee', 'My knee hurts today', null, null, null, 'general', false)::text$q$);
  perform pg_temp.ck('the patient starts a thread', 'true', (t ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.setf('t', t::uuid);
  tc := pg_temp.q_as(v_np, $q$select public.start_care_thread('A private matter', 'This one is confidential', null, null, null, 'general', true)::text$q$);
  perform pg_temp.ck('...and a confidential one', 'true', (tc ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.setf('tc', tc::uuid);
  select id into m from public.care_messages where thread_id = t::uuid order by created_at limit 1;
  insert into public.care_message_attachments (organisation_id, patient_id, thread_id, message_id, file_path, original_filename, mime_type, file_size_bytes)
  values (v_org, v_np, t::uuid, m, v_np::text || '/proof.jpg', 'proof.jpg', 'image/jpeg', 1000) returning id into a;
  perform pg_temp.setf('att', a);
end $$;

-- 1. Staff cannot read bodies or attachments directly; headers still work -----------------------------------------------
do $$
declare v_np uuid := pg_temp.f('np'); v_doc uuid := pg_temp.f('doc');
begin
  perform pg_temp.ck('the patient reads their own messages directly', '2', pg_temp.q_as(v_np, 'select count(*)::text from public.care_messages'));
  perform pg_temp.ck('a staff member reads none of the message rows directly', '0', pg_temp.q_as(v_doc, 'select count(*)::text from public.care_messages'));
  perform pg_temp.ck('...nor any attachment row', '0', pg_temp.q_as(v_doc, 'select count(*)::text from public.care_message_attachments'));
  perform pg_temp.ck('the patient reads their own attachment', '1', pg_temp.q_as(v_np, 'select count(*)::text from public.care_message_attachments'));
  perform pg_temp.ck('staff still see the thread headers (the inbox list works)', '2', pg_temp.q_as(v_doc, 'select count(*)::text from public.care_message_threads'));
  perform pg_temp.ck('no select policy on bodies or attachments names org staff', '0',
    (select count(*)::text from pg_policies where tablename in ('care_messages', 'care_message_attachments') and cmd = 'SELECT' and qual like '%is_org_staff%'));
end $$;

-- 2. Opening a thread: audited for staff, once per person per window ----------------------------------------------------
do $$
declare
  v_np uuid := pg_temp.f('np'); v_np2 uuid := pg_temp.f('np2'); v_doc uuid := pg_temp.f('doc'); v_doc2 uuid := pg_temp.f('doc2');
  t uuid := pg_temp.f('t'); tc uuid := pg_temp.f('tc'); r text;
begin
  r := pg_temp.q_as(v_doc, format('select public.open_care_thread_audited(%L)::text', t));
  perform pg_temp.ck('a staff member opens the thread and reads the message', 'true', (r like '%My knee hurts today%')::text);
  perform pg_temp.ck('...with its attachment listed', 'true', (r like '%proof.jpg%')::text);
  perform pg_temp.ck('...and the open is audited (INV-10)', '1',
    (select count(*)::text from public.audit_log where actor_id = v_doc and action = 'care_thread.open' and entity_id = t));
  perform pg_temp.ck('...against the patient', pg_temp.f('np')::text, (select subject_patient_id::text from public.audit_log where actor_id = v_doc and action = 'care_thread.open' and entity_id = t));
  perform pg_temp.q_as(v_doc, format('select public.open_care_thread_audited(%L)::text', t));
  perform pg_temp.ck('opening again inside the window adds no row', '1',
    (select count(*)::text from public.audit_log where actor_id = v_doc and action = 'care_thread.open' and entity_id = t));
  set local session_replication_role = replica;
  update public.audit_log set created_at = now() - interval '11 minutes' where actor_id = v_doc and action = 'care_thread.open' and entity_id = t;
  set local session_replication_role = origin;
  perform pg_temp.q_as(v_doc, format('select public.open_care_thread_audited(%L)::text', t));
  perform pg_temp.ck('after the window a new open is logged again', '2',
    (select count(*)::text from public.audit_log where actor_id = v_doc and action = 'care_thread.open' and entity_id = t));
  perform pg_temp.q_as(v_doc2, format('select public.open_care_thread_audited(%L)::text', t));
  perform pg_temp.ck('a second staff member is logged separately', '1',
    (select count(*)::text from public.audit_log where actor_id = v_doc2 and action = 'care_thread.open' and entity_id = t));

  r := pg_temp.q_as(v_np, format('select public.open_care_thread_audited(%L)::text', t));
  perform pg_temp.ck('the patient opens their own thread', 'true', (r like '%My knee hurts today%')::text);
  perform pg_temp.ck('...and is not written to the staff audit', '0', (select count(*)::text from public.audit_log where actor_id = v_np and action = 'care_thread.open'));
  perform pg_temp.ck('another patient is refused', 'ERR:not authorised for this thread',
    pg_temp.q_as(v_np2, format('select public.open_care_thread_audited(%L)::text', t)));
  perform pg_temp.ck('an unknown thread is not found', 'ERR:not found', pg_temp.q_as(v_doc, format('select public.open_care_thread_audited(%L)::text', gen_random_uuid())));
  r := pg_temp.q_as(v_doc, format('select public.open_care_thread_audited(%L)::text', tc));
  perform pg_temp.ck('a confidential thread still opens for staff (the shared inbox keeps its breadth)', 'true', (r like '%This one is confidential%')::text);
  perform pg_temp.ck('...logged as confidential', 'true',
    ((select event ->> 'confidential' from public.audit_log where actor_id = v_doc and action = 'care_thread.open' and entity_id = tc) = 'true')::text);
end $$;

-- 3. Attachments and the message scope ----------------------------------------------------------------------------------
do $$
declare
  v_np uuid := pg_temp.f('np'); v_np2 uuid := pg_temp.f('np2'); v_doc uuid := pg_temp.f('doc'); a uuid := pg_temp.f('att');
  t uuid := pg_temp.f('t'); m uuid;
begin
  perform pg_temp.ck('staff open an attachment and get its storage path', pg_temp.f('np')::text || '/proof.jpg',
    pg_temp.q_as(v_doc, format('select public.open_care_attachment_audited(%L)', a)));
  perform pg_temp.ck('...audited', '1', (select count(*)::text from public.audit_log where actor_id = v_doc and action = 'care_attachment.open' and entity_id = a));
  perform pg_temp.q_as(v_doc, format('select public.open_care_attachment_audited(%L)', a));
  perform pg_temp.ck('...once inside the window', '1', (select count(*)::text from public.audit_log where actor_id = v_doc and action = 'care_attachment.open' and entity_id = a));
  perform pg_temp.ck('the patient opens their own attachment, unaudited', 'true',
    (pg_temp.q_as(v_np, format('select public.open_care_attachment_audited(%L)', a)) = v_np::text || '/proof.jpg'
      and (select count(*) from public.audit_log where actor_id = v_np and action = 'care_attachment.open') = 0)::text);
  perform pg_temp.ck('another patient is refused the attachment', 'ERR:not authorised for this attachment', pg_temp.q_as(v_np2, format('select public.open_care_attachment_audited(%L)', a)));
  select id into m from public.care_messages where thread_id = t order by created_at limit 1;
  perform pg_temp.ck('staff get the scope of a message (no body)', 'true',
    (pg_temp.q_as(v_doc, format('select public.care_message_scope(%L)::text', m)) like '%' || t::text || '%'
      and pg_temp.q_as(v_doc, format('select public.care_message_scope(%L)::text', m)) not like '%knee%')::text);
  perform pg_temp.ck('another patient is refused the scope', 'ERR:not authorised for this message', pg_temp.q_as(v_np2, format('select public.care_message_scope(%L)::text', m)));
end $$;

-- 4. Staff can still reply, and the communication log keeps working with no body ----------------------------------------
do $$
declare v_np uuid := pg_temp.f('np'); v_np2 uuid := pg_temp.f('np2'); v_doc uuid := pg_temp.f('doc'); t uuid := pg_temp.f('t'); v_pa uuid;
begin
  perform pg_temp.ck('a staff member replies to the thread (the gate opens)', 'ok',
    pg_temp.try_as(v_doc, format($q$select public.post_care_message(%L, 'Please keep the knee raised and call us if it worsens.')$q$, t)));
  perform pg_temp.ck('...and the patient reads the reply', 'true',
    (pg_temp.q_as(v_np, format('select public.open_care_thread_audited(%L)::text', t)) like '%keep the knee raised%')::text);
  perform pg_temp.ck('...and staff see it when they open the thread', 'true',
    (pg_temp.q_as(v_doc, format('select public.open_care_thread_audited(%L)::text', t)) like '%keep the knee raised%')::text);
  perform pg_temp.ck('staff read the communication log', 'true', (pg_temp.q_as(v_doc, 'select count(*)::text from public.care_message_communication_log')::int = 3)::text);
  perform pg_temp.ck('the log has no body column', '0',
    (select count(*)::text from information_schema.columns where table_name = 'care_message_communication_log' and column_name = 'body'));
  perform pg_temp.ck('a patient sees only their own log rows', '0', pg_temp.q_as(v_np2, 'select count(*)::text from public.care_message_communication_log'));
  -- the AI draft's snapshot is the other place the last messages sit verbatim
  insert into public.care_message_draft_replies (organisation_id, patient_id, thread_id, status, model_id, draft_text, input_snapshot)
  values (pg_temp.f('org'), v_np, t, 'generated', 'proof-model', 'Please keep the knee raised.', '{"messages":[{"body":"My knee hurts today"}]}'::jsonb);
  perform pg_temp.ck('staff cannot read the draft input snapshot (the last messages, verbatim)', 'true',
    (pg_temp.q_as(v_doc, 'select input_snapshot::text from public.care_message_draft_replies limit 1') like 'ERR:permission denied%')::text);
  perform pg_temp.ck('...but still read the draft text they review', 'Please keep the knee raised.', pg_temp.q_as(v_doc, 'select draft_text from public.care_message_draft_replies limit 1'));
  -- a supporter with messaging access keeps the log (parity with the message policy); a stranger does not get it
  set local session_replication_role = replica;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access) values (v_np, pg_temp.f('sup'), 'view', v_np, true) returning id into v_pa;
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'messaging');
  set local session_replication_role = origin;
  perform pg_temp.ck('a supporter with messaging access reads the non-confidential log rows', '2', pg_temp.q_as(pg_temp.f('sup'), 'select count(*)::text from public.care_message_communication_log'));
  perform pg_temp.ck('...and still reads message rows directly under the policy branch that remains', '2', pg_temp.q_as(pg_temp.f('sup'), 'select count(*)::text from public.care_messages'));
end $$;

-- 5. SABOTAGE: the staff select policy restored, and the open function without its audit insert --------------------------
create policy care_messages_select_sabotage on public.care_messages for select to authenticated
  using (private.is_org_staff(organisation_id));
create or replace function public.open_care_thread_audited(p_thread uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return coalesce((select jsonb_agg(to_jsonb(m)) from public.care_messages m where m.thread_id = p_thread), '[]'::jsonb);
end $$;

do $$
declare v_doc2 uuid := pg_temp.f('doc2'); v_doc uuid := pg_temp.f('doc'); tc uuid := pg_temp.f('tc'); n integer;
begin
  insert into results values ('sabotaged', 'a staff member reads none of the message rows directly', '0', pg_temp.q_as(v_doc, 'select count(*)::text from public.care_messages'));
  select count(*) into n from public.audit_log where actor_id = v_doc2 and action = 'care_thread.open' and entity_id = tc;
  perform pg_temp.q_as(v_doc2, format('select public.open_care_thread_audited(%L)::text', tc));
  insert into results values ('sabotaged', 'opening a thread is audited', '1',
    ((select count(*) from public.audit_log where actor_id = v_doc2 and action = 'care_thread.open' and entity_id = tc) - n)::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S22e proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
