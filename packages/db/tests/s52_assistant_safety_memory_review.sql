-- S52 proof: assistant memory (consent first, off by default), silence signal, on-call page, monthly review (migration *_s52_assistant_safety_memory_review.sql).
-- Spec B.7 7.8, 7.10, 7.12, 7.13; INV-05, INV-10, INV-11.
-- One rolled-back transaction. Sections:
--   1. Memory is OFF by default: consent refused while AI-020 is disabled, items refused without consent.
--   2. With AI-020 on: consent, goals and preferences accepted, clinical words refused, length and cap refused, attribution stamped.
--   3. Memory is patient-only (another patient, a clinician and anon see nothing) and the AI read path needs consent AND the kill switch.
--   4. View, edit, delete, delete-all and export; each is the patient's own; consent can be revoked and the AI read path then returns nothing.
--   5. Silence signal: a programme member gone quiet writes ONE event and ONE generic note per cooldown; non-members, closed-guard real patients are untouched.
--   6. On-call page for self-harm: one class 1 task under the shared crisis key, leadership alerted with nobody on call, once per conversation.
--   7. Monthly review: the sampler (reported plus random, idempotent), the reader door (CMO only, reason, audit), recording (needs a prior read, unsafe needs a note, opens an incident, final).
--   8. Grants.
--   9. SABOTAGE: the clinical-content check removed and the CMO check removed; the checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.q_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create function pg_temp.q_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's52-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S52 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test)
  on conflict (id) do update set role = excluded.role, is_test = excluded.is_test, is_active = true, phone = excluded.phone, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.n(p_sql text) returns text language plpgsql as $f$ declare r text; begin execute p_sql into r; return r; end $f$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
-- a statement that returns nothing (an insert) reads as 'ok' when it works, or ERR:sqlstate when refused
create function pg_temp.run_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql; r := 'ok'; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;

-- Fixtures -----------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_pat uuid; v_other uuid; v_doc uuid; v_cmo uuid; v_admin uuid; v_real uuid; v_sys uuid; v_int uuid; v_conv uuid; v_conv2 uuid; v_conv3 uuid; v_prev date;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient', true);
  v_other := pg_temp.mkuser(v_org, 'other', 'patient', true);
  v_real := pg_temp.mkuser(v_org, 'real', 'patient', false);
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician', true);
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician', true);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', true);
  perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('other', v_other); perform pg_temp.setf('real', v_real);
  perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('cmo', v_cmo); perform pg_temp.setf('admin', v_admin);
  set local session_replication_role = replica;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by,
      doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_cmo, 'S52 cmo', 'MDCN', 'S52-cmo', true, 'active', now(), v_admin, 'chief_medical_officer', 'employed', 2, true, v_admin, true),
         (v_org, v_doc, 'S52 doc', 'MDCN', 'S52-doc', true, 'active', now(), v_admin, 'medical_officer', 'employed', 1, true, v_admin, true);
  set local session_replication_role = origin;

  -- conversations in the previous Lagos month, with turns, one of them reported
  v_prev := date_trunc('month', (now() at time zone 'Africa/Lagos') - interval '1 month')::date;
  insert into public.ai_conversations (organisation_id, profile_id, messages) values
    (v_org, v_pat, '[{"id":"m1","role":"user","content":"hello there","created_at":"2020-01-01T00:00:00Z"},{"id":"m2","role":"assistant","content":"Hello","created_at":"2020-01-01T00:00:01Z"}]'::jsonb) returning id into v_conv;
  insert into public.ai_conversations (organisation_id, profile_id, messages) values (v_org, v_other, '[{"id":"m3","role":"user","content":"a second chat","created_at":"2020-01-01T00:00:00Z"}]'::jsonb) returning id into v_conv2;
  insert into public.ai_conversations (organisation_id, profile_id, messages) values (v_org, v_real, '[{"id":"m4","role":"user","content":"a third chat","created_at":"2020-01-01T00:00:00Z"}]'::jsonb) returning id into v_conv3;
  perform pg_temp.setf('conv', v_conv); perform pg_temp.setf('conv2', v_conv2); perform pg_temp.setf('conv3', v_conv3);
  select id into v_sys from public.ai_systems where system_code = 'AI-001';
  insert into public.ai_interaction_log (organisation_id, ai_system_id, model_identifier, subject_profile_id, input_category, status)
    values (v_org, v_sys, 'm', v_pat, 'patient_coach_message', 'completed') returning id into v_int;
  perform pg_temp.setf('int', v_int);
  insert into public.ai_assistant_turns (organisation_id, patient_id, conversation_id, interaction_type, final_action, status, interaction_id, created_at)
    values (v_org, v_pat, v_conv, 'chat_turn', 'replied', 'completed', v_int, (v_prev::timestamp at time zone 'Africa/Lagos') + interval '3 days'),
           (v_org, v_other, v_conv2, 'chat_turn', 'replied', 'completed', null, (v_prev::timestamp at time zone 'Africa/Lagos') + interval '4 days'),
           (v_org, v_real, v_conv3, 'chat_turn', 'replied', 'completed', null, (v_prev::timestamp at time zone 'Africa/Lagos') + interval '5 days');
  insert into public.ai_safety_incidents (organisation_id, ai_system_id, interaction_id, reported_by, reporter_kind, category, description, created_at)
    values (v_org, v_sys, v_int, v_pat, 'patient', 'incorrect_information', 'S52 proof: the patient reported this answer', (v_prev::timestamp at time zone 'Africa/Lagos') + interval '6 days');
  update public.ai_interaction_log set flagged_for_review = true where id = v_int;
end $$;

select pg_temp.ck('real', 'the governance trigger refuses to enable AI-020 while its criteria are outstanding', 'P0001',
  pg_temp.try_sql($q$update public.ai_systems set is_enabled = true where system_code = 'AI-020'$q$));
-- 1. Off by default -----------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'AI-020 is registered disabled', 'false', (select is_enabled::text from public.ai_systems where system_code = 'AI-020'));
select pg_temp.ck('real', 'the memory reads as unavailable', 'false', pg_temp.q_as(pg_temp.f('pat'), 'select public.assistant_memory_available()::text'));
select pg_temp.ck('real', 'consent is refused while it is off', 'ERR:55000', pg_temp.q_as(pg_temp.f('pat'), 'select public.assistant_memory_set_consent(true)::text'));
select pg_temp.ck('real', 'an item is refused without consent', 'ERR:42501',
  pg_temp.run_as(pg_temp.f('pat'), format($q$insert into public.assistant_memory_items (patient_id, kind, text) values (%L, 'goal', 'walk after dinner')$q$, pg_temp.f('pat'))));
select pg_temp.ck('real', 'the AI read path returns nothing', '[]', pg_temp.q_as(pg_temp.f('pat'), 'select public.assistant_memory_for_prompt()::text'));

-- 2. Switched on: consent first ------------------------------------------------------------------------------------------------------
-- the governance trigger refuses enabling AI-020 until its acceptance criteria are met (good); the proof flips it with triggers off
set local session_replication_role = replica; update public.ai_systems set is_enabled = true, lifecycle_status = 'live' where system_code = 'AI-020'; set local session_replication_role = origin;
select pg_temp.ck('real', 'consent is granted by the patient', 'true', pg_temp.q_as(pg_temp.f('pat'), 'select (public.assistant_memory_set_consent(true) ->> ''consented'')'));
select pg_temp.ck('real', 'the consent row names the wording version and the patient', 'mem-v1:true',
  (select text_version || ':' || (recorded_by = patient_id)::text from public.assistant_memory_consents where patient_id = pg_temp.f('pat') and revoked_at is null));
select pg_temp.ck('real', 'granting twice is a no-op', 'true', pg_temp.q_as(pg_temp.f('pat'), 'select (public.assistant_memory_set_consent(true) ->> ''consented'')'));
select pg_temp.ck('real', 'one active consent row only', '1', (select count(*)::text from public.assistant_memory_consents where patient_id = pg_temp.f('pat') and revoked_at is null));
select pg_temp.ck('real', 'a goal is accepted', 'ok',
  pg_temp.run_as(pg_temp.f('pat'), format($q$insert into public.assistant_memory_items (patient_id, kind, text) values (%L, 'goal', 'walk after dinner')$q$, pg_temp.f('pat'))));
select pg_temp.ck('real', 'a preference is accepted', 'ok',
  pg_temp.run_as(pg_temp.f('pat'), format($q$insert into public.assistant_memory_items (patient_id, kind, text) values (%L, 'preference', 'short messages please')$q$, pg_temp.f('pat'))));
select pg_temp.ck('real', 'both items are stored', '2', (select count(*)::text from public.assistant_memory_items where patient_id = pg_temp.f('pat')));
select pg_temp.ck('real', 'source and recorded_by name the patient', 'patient:true',
  (select source || ':' || (recorded_by = patient_id)::text from public.assistant_memory_items where patient_id = pg_temp.f('pat') order by created_at limit 1));
select pg_temp.ck('real', 'a clinical fact is refused (condition word)', 'ERR:23514',
  pg_temp.run_as(pg_temp.f('pat'), format($q$insert into public.assistant_memory_items (patient_id, kind, text) values (%L, 'goal', 'my diabetes is under control')$q$, pg_temp.f('pat'))));
select pg_temp.ck('real', 'a clinical fact is refused (reading)', 'ERR:23514',
  pg_temp.run_as(pg_temp.f('pat'), format($q$insert into public.assistant_memory_items (patient_id, kind, text) values (%L, 'goal', 'keep my blood pressure at 120/80')$q$, pg_temp.f('pat'))));
select pg_temp.ck('real', 'a medicine is refused', 'ERR:23514',
  pg_temp.run_as(pg_temp.f('pat'), format($q$insert into public.assistant_memory_items (patient_id, kind, text) values (%L, 'preference', 'I take metformin in the morning')$q$, pg_temp.f('pat'))));
select pg_temp.ck('real', 'too long is refused', 'ERR:22001',
  pg_temp.run_as(pg_temp.f('pat'), format($q$insert into public.assistant_memory_items (patient_id, kind, text) values (%L, 'goal', %L)$q$, pg_temp.f('pat'), repeat('walk ', 60))));
select pg_temp.ck('real', 'an item for another patient is refused', 'ERR:42501',
  pg_temp.run_as(pg_temp.f('pat'), format($q$insert into public.assistant_memory_items (patient_id, kind, text) values (%L, 'goal', 'walk after dinner')$q$, pg_temp.f('other'))));
update public.assistant_config set value = '{"max_items": 2, "max_chars": 200, "consent_text_version": "mem-v1"}'::jsonb where key = 'memory';
select pg_temp.ck('real', 'the cap is enforced', 'ERR:54000',
  pg_temp.run_as(pg_temp.f('pat'), format($q$insert into public.assistant_memory_items (patient_id, kind, text) values (%L, 'goal', 'a third thing to remember')$q$, pg_temp.f('pat'))));
update public.assistant_config set value = '{"max_items": 30, "max_chars": 200, "consent_text_version": "mem-v1"}'::jsonb where key = 'memory';

-- 3. Patient only -----------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'another patient sees none of it', '0', pg_temp.q_as(pg_temp.f('other'), 'select count(*)::text from public.assistant_memory_items'));
select pg_temp.ck('real', 'a clinician sees none of it', '0', pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.assistant_memory_items'));
select pg_temp.ck('real', 'the CMO sees none of it', '0', pg_temp.q_as(pg_temp.f('cmo'), 'select count(*)::text from public.assistant_memory_items'));
select pg_temp.ck('real', 'an admin sees none of it', '0', pg_temp.q_as(pg_temp.f('admin'), 'select count(*)::text from public.assistant_memory_items'));
select pg_temp.ck('real', 'anon is refused', 'ERR:42501', pg_temp.q_anon('select count(*)::text from public.assistant_memory_items'));
select pg_temp.ck('real', 'a clinician cannot read the consent record', '0', pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.assistant_memory_consents'));
select pg_temp.ck('real', 'the AI read path returns the two items for the patient', '2',
  pg_temp.q_as(pg_temp.f('pat'), 'select jsonb_array_length(public.assistant_memory_for_prompt())::text'));
select pg_temp.ck('real', 'it carries kind and text only', 'kind,text',
  pg_temp.q_as(pg_temp.f('pat'), $q$select (select string_agg(k, ',' order by k) from jsonb_object_keys(public.assistant_memory_for_prompt() -> 0) k)$q$));
select pg_temp.ck('real', 'another patient gets nothing from it', '[]', pg_temp.q_as(pg_temp.f('other'), 'select public.assistant_memory_for_prompt()::text'));
-- the governance trigger refuses enabling AI-020 until its acceptance criteria are met (good); the proof flips it with triggers off
set local session_replication_role = replica; update public.ai_systems set is_enabled = false where system_code = 'AI-020'; set local session_replication_role = origin;
select pg_temp.ck('real', 'the kill switch off: the AI read path returns nothing, the items stay', '[]:2',
  pg_temp.q_as(pg_temp.f('pat'), 'select public.assistant_memory_for_prompt()::text') || ':' || (select count(*)::text from public.assistant_memory_items where patient_id = pg_temp.f('pat')));
-- the governance trigger refuses enabling AI-020 until its acceptance criteria are met (good); the proof flips it with triggers off
set local session_replication_role = replica; update public.ai_systems set is_enabled = true, lifecycle_status = 'live' where system_code = 'AI-020'; set local session_replication_role = origin;

-- 4. View, edit, delete, export, revoke ------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'the patient edits an item', '1',
  pg_temp.q_as(pg_temp.f('pat'), $q$with u as (update public.assistant_memory_items set text = 'walk after supper' where text = 'walk after dinner' returning 1) select count(*)::text from u$q$));
select pg_temp.ck('real', 'the edit is stored', 'walk after supper', (select text from public.assistant_memory_items where text = 'walk after supper'));
select pg_temp.ck('real', 'an edit cannot smuggle in a clinical fact', 'ERR:23514',
  pg_temp.run_as(pg_temp.f('pat'), $q$update public.assistant_memory_items set text = 'my cholesterol is high' where text = 'walk after supper'$q$));
select pg_temp.ck('real', 'another patient cannot edit it', '0',
  pg_temp.q_as(pg_temp.f('other'), $q$with u as (update public.assistant_memory_items set text = 'hijacked' where text = 'walk after supper' returning 1) select count(*)::text from u$q$));
select pg_temp.ck('real', 'another patient cannot delete it', '0',
  pg_temp.q_as(pg_temp.f('other'), $q$with d as (delete from public.assistant_memory_items where text = 'walk after supper' returning 1) select count(*)::text from d$q$));
select pg_temp.ck('real', 'the export holds the items and the consent', '2:1',
  pg_temp.q_as(pg_temp.f('pat'), $q$select jsonb_array_length(public.assistant_memory_export() -> 'items')::text || ':' || jsonb_array_length(public.assistant_memory_export() -> 'consents')::text$q$));
select pg_temp.ck('real', 'the export is audited without the text', '2:0',
  (select count(*)::text from public.audit_log where action = 'assistant_memory.exported' and actor_id = pg_temp.f('pat')) || ':' ||
  (select count(*)::text from public.audit_log where action like 'assistant_memory.%' and event::text like '%walk after%'));
select pg_temp.ck('real', 'a patient deletes one item', '1',
  pg_temp.q_as(pg_temp.f('pat'), $q$with d as (delete from public.assistant_memory_items where text = 'short messages please' returning 1) select count(*)::text from d$q$));
select pg_temp.ck('real', 'revoking consent is recorded', '{"consented": false}', pg_temp.q_as(pg_temp.f('pat'), 'select public.assistant_memory_set_consent(false)::text'));
select pg_temp.ck('real', 'revoking FORGETS the list, so a later switch-on can never bring old items back', '0',
  (select count(*)::text from public.assistant_memory_items where patient_id = pg_temp.f('pat')));
select pg_temp.ck('real', 'after revoking, the AI read path returns nothing', '[]', pg_temp.q_as(pg_temp.f('pat'), 'select public.assistant_memory_for_prompt()::text'));
select pg_temp.ck('real', 'after revoking, a new item is refused', 'ERR:42501',
  pg_temp.run_as(pg_temp.f('pat'), format($q$insert into public.assistant_memory_items (patient_id, kind, text) values (%L, 'goal', 'walk after dinner')$q$, pg_temp.f('pat'))));
select pg_temp.ck('real', 'delete all reports what it removed (nothing left after a revoke)', '0', pg_temp.q_as(pg_temp.f('pat'), 'select public.assistant_memory_delete_all()::text'));
select pg_temp.ck('real', 'and nothing is left', '0', (select count(*)::text from public.assistant_memory_items where patient_id = pg_temp.f('pat')));
select pg_temp.ck('real', 'consent can be granted again later', '{"consented": true}', pg_temp.q_as(pg_temp.f('pat'), 'select public.assistant_memory_set_consent(true)::text'));
select pg_temp.ck('real', 'two consent rows now exist, one active', '2:1',
  (select count(*)::text from public.assistant_memory_consents where patient_id = pg_temp.f('pat')) || ':' || (select count(*)::text from public.assistant_memory_consents where patient_id = pg_temp.f('pat') and revoked_at is null));

-- 5. Silence signal ------------------------------------------------------------------------------------------------------------------------
-- the test patient is a programme member (an active care pack) whose last message was long ago; the real patient has no programme.
set local session_replication_role = replica;
insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, state, is_test)
  values (pg_temp.f('org'), pg_temp.f('pat'), gen_random_uuid(), 'care_pack', now() - interval '60 days', 'active', true),
         (pg_temp.f('org'), pg_temp.f('real'), gen_random_uuid(), 'consultation_credit', now() - interval '60 days', 'active', false);
set local session_replication_role = origin;
select pg_temp.ck('real', 'the first run signals the programme member and queues one note', '{"signals": 1, "reengaged": 1}',
  pg_temp.q_service($q$select public.assistant_detect_silence(now())::text$q$));
select pg_temp.ck('real', 'one silence event was written, ids and days only', '1:true',
  (select count(*)::text from public.domain_events where event_type = 'assistant.silence_detected' and patient_id = pg_temp.f('pat')) || ':' ||
  (select (payload ?& array['days'] and not payload ? 'text')::text from public.domain_events where event_type = 'assistant.silence_detected' and patient_id = pg_temp.f('pat') limit 1));
select pg_temp.ck('real', 'one generic re-engagement note was queued', '1',
  (select count(*)::text from public.notifications where recipient_id = pg_temp.f('pat') and template = 'assistant_reengage'));
select pg_temp.ck('real', 'a second run is idempotent: no new event, no second note', '1:1',
  pg_temp.n($q$select (public.assistant_detect_silence(now()) ->> 'signals')$q$) || ':' ||
  (select count(*)::text from public.notifications where recipient_id = pg_temp.f('pat') and template = 'assistant_reengage'));
select pg_temp.ck('real', 'the event count is still one', '1', (select count(*)::text from public.domain_events where event_type = 'assistant.silence_detected' and patient_id = pg_temp.f('pat')));
select pg_temp.ck('real', 'a patient with no programme is not signalled', '0', (select count(*)::text from public.domain_events where event_type = 'assistant.silence_detected' and patient_id = pg_temp.f('real')));
select pg_temp.ck('real', 'the reengagement wording passes the INV-07 lint', '0',
  (select count(*)::text from public.notification_template_locales l where l.template_key = 'assistant_reengage' and cardinality(private.notification_text_violations(coalesce(l.subject, '') || ' ' || l.body)) > 0));
select pg_temp.ck('real', 'a patient cannot run the job', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat'), 'select public.assistant_detect_silence(now())::text'));

-- 6. On-call page for a self-harm message -----------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'a page is queued durably before it is attempted', 'ok',
  case when pg_temp.q_service(format($q$select public.assistant_page_enqueue(%L::uuid, %L::uuid)::text$q$, pg_temp.f('pat'), pg_temp.f('conv'))) like 'ERR:%' then 'refused' else 'ok' end);
select pg_temp.ck('real', 'queueing twice for the same conversation does not add a second pending row', '1',
  pg_temp.n(format($q$select (select count(*) from public.assistant_page_queue where conversation_id = %L and done_at is null)::text from (select public.assistant_page_enqueue(%L::uuid, %L::uuid)) x$q$, pg_temp.f('conv'), pg_temp.f('pat'), pg_temp.f('conv'))));
select pg_temp.ck('real', 'nobody on the rota: leadership is alerted and no_cover is reported', 'true',
  pg_temp.q_service(format($q$select (public.assistant_page_on_call(%L::uuid, %L::uuid) ->> 'no_cover')$q$, pg_temp.f('pat'), pg_temp.f('conv'))));
select pg_temp.ck('real', 'the admin and CMO got the critical neutral escalation notice (3 channels each)', '6',
  (select count(*)::text from public.notifications where template = 'on_call_escalation' and recipient_id in (pg_temp.f('admin'), pg_temp.f('cmo')) and priority = 'critical'));
select pg_temp.ck('real', 'the notice carries no patient and no text', '0',
  (select count(*)::text from public.notifications where template = 'on_call_escalation' and payload::text <> '{}'));
select pg_temp.ck('real', 'one class 1 task exists for the patient under the shared crisis key', '1',
  (select count(*)::text from public.clinical_tasks where patient_id = pg_temp.f('pat') and type = 'red_event_unacknowledged' and dedup_key = 'crisis:' || pg_temp.f('pat')));
select pg_temp.ck('real', 'a page that reached someone marks its queue row done', '0',
  (select count(*)::text from public.assistant_page_queue where conversation_id = pg_temp.f('conv') and done_at is null));
select pg_temp.ck('real', 'a second page for the same conversation within hours does nothing', 'true',
  pg_temp.q_service(format($q$select (public.assistant_page_on_call(%L::uuid, %L::uuid) ->> 'already')$q$, pg_temp.f('pat'), pg_temp.f('conv'))));
-- a page that was cut off: queued, never attempted, aged past two minutes; the retry finds it and pages
select pg_temp.q_service(format($q$select public.assistant_page_enqueue(%L::uuid, %L::uuid)::text$q$, pg_temp.f('pat'), pg_temp.f('conv2')));
select pg_temp.ck('real', 'a fresh queue row is not retried yet', '0',
  pg_temp.n($q$select (public.assistant_page_retry_due(10) ->> 'done')$q$));
update public.assistant_page_queue set created_at = now() - interval '10 minutes' where conversation_id = pg_temp.f('conv2');
select pg_temp.ck('real', 'the retry pages a cut-off page and reports it done', '1',
  pg_temp.q_service($q$select (public.assistant_page_retry_due(10) ->> 'done')$q$));
select pg_temp.ck('real', 'and the queue row is done with one attempt', 'true:1',
  (select (done_at is not null)::text || ':' || attempts::text from public.assistant_page_queue where conversation_id = pg_temp.f('conv2')));
select pg_temp.ck('real', 'a patient cannot retry pages or queue one', 'ERR:42501',
  pg_temp.q_as(pg_temp.f('pat'), $q$select public.assistant_page_retry_due(10)::text$q$));
select pg_temp.q_service(format($q$select public.assistant_page_on_call(%L::uuid, %L::uuid)::text$q$, pg_temp.f('pat'), pg_temp.f('conv2')));
select pg_temp.ck('real', 'still one live task after a second conversation', '1',
  (select count(*)::text from public.clinical_tasks where patient_id = pg_temp.f('pat') and type = 'red_event_unacknowledged' and dedup_key = 'crisis:' || pg_temp.f('pat')));
select pg_temp.ck('real', 'the page is audited', '1', (select count(*)::text from public.audit_log where action = 'assistant.on_call_paged' and entity_id = pg_temp.f('conv')));
create temp table paging_cfg_saved as select key, value, config_version from public.assistant_config where key = 'paging';
delete from public.assistant_config where key = 'paging';
select pg_temp.ck('real', 'a missing paging config row fails loudly instead of using a built-in window', 'ERR:55000',
  pg_temp.q_service(format($q$select public.assistant_page_on_call(%L::uuid, %L::uuid)::text$q$, pg_temp.f('pat'), pg_temp.f('conv3'))));
insert into public.assistant_config (key, value, config_version) select key, value, config_version from paging_cfg_saved;
insert into public.assistant_page_queue (organisation_id, patient_id, conversation_id) values (pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('conv3'));
select pg_temp.ck('real', 'two pending queue rows for one conversation are refused', '23505',
  pg_temp.try_sql(format($q$insert into public.assistant_page_queue (organisation_id, patient_id, conversation_id) values (%L, %L, %L)$q$, pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('conv3'))));
select pg_temp.ck('real', 'a patient cannot page', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.assistant_page_on_call(%L::uuid, %L::uuid)::text$q$, pg_temp.f('pat'), pg_temp.f('conv'))));

-- 7. Monthly review ---------------------------------------------------------------------------------------------------------------------
-- the first part draws from REAL patients: the two proof patients are switched to real for this section (the test rule is proved in 7b)
update public.profiles set is_test = false where id in (pg_temp.f('pat'), pg_temp.f('other'));
create function pg_temp.prev() returns date language sql as $$ select date_trunc('month', (now() at time zone 'Africa/Lagos') - interval '1 month')::date $$;
select pg_temp.ck('real', 'the sampler takes the reported conversation and one random one', '{"month": "' || pg_temp.prev() || '", "random": 1, "reported": 1}',
  pg_temp.q_service(format($q$select public.assistant_sample_month(%L::date, 1)::text$q$, pg_temp.prev())));
select pg_temp.ck('real', 'the reported one carries its incident', 'reported:true',
  (select selection || ':' || (incident_id is not null)::text from public.assistant_review_samples where conversation_id = pg_temp.f('conv')));
select pg_temp.ck('real', 'two samples in all', '2', (select count(*)::text from public.assistant_review_samples where month = pg_temp.prev()));
select pg_temp.ck('real', 'the sampler is idempotent for the reported conversation', '1',
  pg_temp.n(format($q$select (select count(*) from public.assistant_review_samples where conversation_id = %L)::text from (select public.assistant_sample_month(%L::date, 0)) x$q$, pg_temp.f('conv'), pg_temp.prev())));
select pg_temp.ck('real', 'a patient cannot run the sampler', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat'), 'select public.assistant_sample_month(null, 1)::text'));
select pg_temp.ck('real', 'a patient sees no sample row', '0', pg_temp.q_as(pg_temp.f('pat'), 'select count(*)::text from public.assistant_review_samples'));
select pg_temp.ck('real', 'a clinician below CMO sees no sample row', '0', pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.assistant_review_samples'));
select pg_temp.ck('real', 'a clinician below CMO cannot open the queue', 'ERR:42501', pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.assistant_review_queue()'));
select pg_temp.ck('real', 'the CMO opens the queue: two rows, no text', '2',
  pg_temp.q_as(pg_temp.f('cmo'), 'select count(*)::text from public.assistant_review_queue()'));
select pg_temp.ck('real', 'the queue has no message text column', '0',
  (select count(*)::text from information_schema.columns where table_name = 'assistant_review_samples' and column_name in ('messages', 'content', 'text')));
create function pg_temp.sample_of(p_conv uuid) returns uuid language sql as $$ select id from public.assistant_review_samples where conversation_id = p_conv $$;
-- the random pick is whichever eligible conversation the sampler drew, so the second sample is "the one that is not the reported one"
create function pg_temp.sample_other(p_conv uuid) returns uuid language sql as $$ select id from public.assistant_review_samples where conversation_id <> p_conv and month = pg_temp.prev() order by created_at limit 1 $$;
select pg_temp.ck('real', 'reading without a real reason is refused', 'ERR:22023',
  pg_temp.q_as(pg_temp.f('cmo'), format($q$select public.assistant_review_read(%L::uuid, 'no')::text$q$, pg_temp.sample_of(pg_temp.f('conv')))));
select pg_temp.ck('real', 'a clinician below CMO cannot read', 'ERR:42501',
  pg_temp.q_as(pg_temp.f('doc'), format($q$select public.assistant_review_read(%L::uuid, 'curious about this chat')::text$q$, pg_temp.sample_of(pg_temp.f('conv')))));
select pg_temp.ck('real', 'a patient cannot read through the door either', 'ERR:42501',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select public.assistant_review_read(%L::uuid, 'curious about this chat')::text$q$, pg_temp.sample_of(pg_temp.f('conv')))));
select pg_temp.ck('real', 'recording before reading is refused', 'ERR:42501',
  pg_temp.q_as(pg_temp.f('cmo'), format($q$select public.assistant_review_record(%L::uuid, 'appropriate', 'none')::text$q$, pg_temp.sample_of(pg_temp.f('conv')))));
select pg_temp.ck('real', 'the CMO reads with a reason and gets the messages', '2',
  pg_temp.q_as(pg_temp.f('cmo'), format($q$select jsonb_array_length(public.assistant_review_read(%L::uuid, 'Monthly clinical review of the assistant') -> 'messages')::text$q$, pg_temp.sample_of(pg_temp.f('conv')))));
select pg_temp.ck('real', 'the read is audited with the reason (INV-10)', '1',
  (select count(*)::text from public.audit_log where action = 'assistant_review.read' and actor_id = pg_temp.f('cmo') and event ->> 'reason' = 'Monthly clinical review of the assistant'));
select pg_temp.ck('real', 'the conversation read policy was not widened: the CMO still cannot select ai_conversations', '0',
  pg_temp.q_as(pg_temp.f('cmo'), format($q$select count(*)::text from public.ai_conversations where id = %L$q$, pg_temp.f('conv'))));
select pg_temp.ck('real', 'an unsafe verdict needs a note', 'ERR:22023',
  pg_temp.q_as(pg_temp.f('cmo'), format($q$select public.assistant_review_record(%L::uuid, 'unsafe', 'incorrect_information')::text$q$, pg_temp.sample_of(pg_temp.f('conv')))));
select pg_temp.ck('real', 'a verdict that is not appropriate needs a category', 'ERR:22023',
  pg_temp.q_as(pg_temp.f('cmo'), format($q$select public.assistant_review_record(%L::uuid, 'needs_improvement', 'none')::text$q$, pg_temp.sample_of(pg_temp.f('conv')))));
select pg_temp.ck('real', 'the CMO records an appropriate verdict', 'true',
  pg_temp.q_as(pg_temp.f('cmo'), format($q$select (public.assistant_review_record(%L::uuid, 'appropriate', 'none') ->> 'ok')$q$, pg_temp.sample_of(pg_temp.f('conv')))));
select pg_temp.ck('real', 'it is stored with the reviewer', 'reviewed:appropriate:true',
  (select state || ':' || verdict || ':' || (reviewed_by = pg_temp.f('cmo'))::text from public.assistant_review_samples where conversation_id = pg_temp.f('conv')));
select pg_temp.ck('real', 'a recorded review is final', 'ERR:22023',
  pg_temp.q_as(pg_temp.f('cmo'), format($q$select public.assistant_review_record(%L::uuid, 'unsafe', 'tone', 'changed my mind about this')::text$q$, pg_temp.sample_of(pg_temp.f('conv')))));
select pg_temp.ck('real', 'a direct update, even by the table owner, is refused', '42501',
  pg_temp.try_sql($q$update public.assistant_review_samples set verdict = 'unsafe'$q$));
select pg_temp.ck('real', 'a delete by any signed-in role is refused (no grant, no policy)', 'ERR:42501',
  pg_temp.run_as(pg_temp.f('cmo'), $q$delete from public.assistant_review_samples$q$));
select pg_temp.ck('real', 'the second sample: read, then an unsafe verdict opens an incident', 'true',
  pg_temp.q_as(pg_temp.f('cmo'), format($q$select (public.assistant_review_read(%L::uuid, 'Monthly clinical review of the assistant') is not null)::text$q$, pg_temp.sample_other(pg_temp.f('conv')))));
select pg_temp.ck('real', 'unsafe with a note records and returns the incident', 'true',
  pg_temp.q_as(pg_temp.f('cmo'), format($q$select ((public.assistant_review_record(%L::uuid, 'unsafe', 'dose_or_medicine_advice', 'It suggested a different dose.') ->> 'incident_id') is not null)::text$q$, pg_temp.sample_other(pg_temp.f('conv')))));
select pg_temp.ck('real', 'the review recorded is audited', '2', (select count(*)::text from public.audit_log where action = 'assistant_review.recorded' and actor_id = pg_temp.f('cmo')));

-- 7b. The random draw never takes a test account (INV-13) or a conversation that was already reviewed ----------------------------------------
create function pg_temp.prev2() returns date language sql as $$ select (pg_temp.prev() - interval '1 month')::date $$;
create function pg_temp.prev3() returns date language sql as $$ select (pg_temp.prev() - interval '2 months')::date $$;
create function pg_temp.prev4() returns date language sql as $$ select (pg_temp.prev() - interval '3 months')::date $$;
do $$
declare v_org uuid := pg_temp.f('org'); v_tst uuid; v_ok uuid; v_c1 uuid; v_c2 uuid; v_at timestamptz;
begin
  v_tst := pg_temp.mkuser(v_org, 'tst', 'patient', true);
  v_ok := pg_temp.mkuser(v_org, 'okp', 'patient', false);
  insert into public.ai_conversations (organisation_id, profile_id, messages) values (v_org, v_tst, '[]'::jsonb) returning id into v_c1;
  insert into public.ai_conversations (organisation_id, profile_id, messages) values (v_org, v_ok, '[]'::jsonb) returning id into v_c2;
  perform pg_temp.setf('tst_conv', v_c1); perform pg_temp.setf('ok_conv', v_c2);
  foreach v_at in array array[(pg_temp.prev2()::timestamp at time zone 'Africa/Lagos') + interval '2 days', (pg_temp.prev3()::timestamp at time zone 'Africa/Lagos') + interval '2 days', (pg_temp.prev4()::timestamp at time zone 'Africa/Lagos') + interval '2 days'] loop
    insert into public.ai_assistant_turns (organisation_id, patient_id, conversation_id, interaction_type, final_action, status, created_at) values
      (v_org, v_tst, v_c1, 'chat_turn', 'replied', 'completed', v_at),
      (v_org, v_ok, v_c2, 'chat_turn', 'replied', 'completed', v_at),
      -- a conversation that was reviewed last month and is active again: never drawn again
      (v_org, (select patient_id from public.assistant_review_samples where conversation_id = pg_temp.f('conv')), pg_temp.f('conv'), 'chat_turn', 'replied', 'completed', v_at);
  end loop;
  -- and a NEW answer in that already-reviewed chat, which its patient reports in the third month back
  declare v_sys uuid; v_pt uuid; v_i uuid;
  begin
    select id into v_sys from public.ai_systems where system_code = 'AI-001';
    select patient_id into v_pt from public.assistant_review_samples where conversation_id = pg_temp.f('conv');
    insert into public.ai_interaction_log (organisation_id, ai_system_id, model_identifier, subject_profile_id, input_category, status)
      values (v_org, v_sys, 'm', v_pt, 'patient_coach_message', 'completed') returning id into v_i;
    insert into public.ai_assistant_turns (organisation_id, patient_id, conversation_id, interaction_type, final_action, status, interaction_id, created_at)
      values (v_org, v_pt, pg_temp.f('conv'), 'chat_turn', 'replied', 'completed', v_i, (pg_temp.prev3()::timestamp at time zone 'Africa/Lagos') + interval '3 days');
    insert into public.ai_safety_incidents (organisation_id, ai_system_id, interaction_id, reported_by, reporter_kind, category, description, created_at)
      values (v_org, v_sys, v_i, v_pt, 'patient', 'incorrect_information', 'S52 proof: reported on a chat reviewed earlier', (pg_temp.prev3()::timestamp at time zone 'Africa/Lagos') + interval '4 days');
  end;
end $$;
select pg_temp.q_service(format($q$select public.assistant_sample_month(%L::date, 50)::text$q$, pg_temp.prev2()));
select pg_temp.ck('real', 'the draw takes the real patient only: not the test account, not a conversation already reviewed', '1:0:0',
  (select count(*) from public.assistant_review_samples where month = pg_temp.prev2() and conversation_id = pg_temp.f('ok_conv'))::text || ':' ||
  (select count(*) from public.assistant_review_samples where month = pg_temp.prev2() and conversation_id = pg_temp.f('tst_conv'))::text || ':' ||
  (select count(*) from public.assistant_review_samples where month = pg_temp.prev2() and conversation_id = pg_temp.f('conv'))::text);
select pg_temp.q_service(format($q$select public.assistant_sample_month(%L::date, 50)::text$q$, pg_temp.prev3()));
select pg_temp.ck('real', 'a patient report on a chat that was reviewed earlier still reaches the review', 'reported',
  (select selection from public.assistant_review_samples where month = pg_temp.prev3() and conversation_id = pg_temp.f('conv')));

select pg_temp.ck('real', 'erasure still works: deleting a sampled conversation is not blocked', 'ok',
  pg_temp.try_sql(format($q$delete from public.ai_conversations where id = %L$q$, pg_temp.f('conv'))));
select pg_temp.ck('real', 'and its sample went with it', '0', (select count(*)::text from public.assistant_review_samples where conversation_id = pg_temp.f('conv')));

-- 8. Grants ---------------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'anon has nothing on the memory functions', 'false', has_function_privilege('anon', 'public.assistant_memory_for_prompt()', 'EXECUTE')::text);
select pg_temp.ck('real', 'authenticated cannot run the silence job', 'false', has_function_privilege('authenticated', 'public.assistant_detect_silence(timestamptz)', 'EXECUTE')::text);
select pg_temp.ck('real', 'authenticated cannot run the sampler', 'false', has_function_privilege('authenticated', 'public.assistant_sample_month(date, integer)', 'EXECUTE')::text);
select pg_temp.ck('real', 'authenticated cannot insert a review sample', 'false', has_table_privilege('authenticated', 'public.assistant_review_samples', 'INSERT')::text);
select pg_temp.ck('real', 'authenticated cannot write a consent directly', 'false', has_table_privilege('authenticated', 'public.assistant_memory_consents', 'INSERT')::text);

-- 9. SABOTAGE -----------------------------------------------------------------------------------------------------------------------------------
create or replace function private.assistant_memory_items_guard() returns trigger language plpgsql security definer set search_path = '' as
$$ begin new.patient_id := new.patient_id; select organisation_id into new.organisation_id from public.profiles where id = new.patient_id;
   new.consent_id := private.assistant_memory_consent_id(new.patient_id); new.recorded_by := new.patient_id; return new; end $$;
select pg_temp.ck('sabotaged', 'a clinical fact is refused', 'ERR:23514',
  pg_temp.run_as(pg_temp.f('pat'), format($q$insert into public.assistant_memory_items (patient_id, kind, text) values (%L, 'goal', 'my diabetes is under control')$q$, pg_temp.f('pat'))));
create or replace function public.assistant_review_queue() returns table (id uuid, month date, selection text, state text, verdict text, patient_ref text, turns integer, reported boolean)
language sql stable security definer set search_path = '' as
$$ select s.id, s.month, s.selection, s.state, s.verdict, left(s.patient_id::text, 8), 0, s.selection = 'reported' from public.assistant_review_samples s $$;
select pg_temp.ck('sabotaged', 'a clinician below CMO cannot open the queue', 'ERR:42501', pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.assistant_review_queue()'));
-- the sampler without its test-account exclusion must put the test conversation into the draw
do $f$ declare d text;
begin
  d := pg_get_functiondef('public.assistant_sample_month(date,integer)'::regprocedure);
  d := replace(d, 'not coalesce(p.is_test, false)', 'true');
  execute d;
end $f$;
select pg_temp.q_service(format($q$select public.assistant_sample_month(%L::date, 50)::text$q$, pg_temp.prev4()));
select pg_temp.ck('sabotaged', 'the draw never takes a test account', '0',
  (select count(*)::text from public.assistant_review_samples where month = pg_temp.prev4() and conversation_id = pg_temp.f('tst_conv')));

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S52 proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
