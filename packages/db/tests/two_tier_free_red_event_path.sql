-- Two-tier item 1 proof: the Free red-event path (migration *_two_tier_free_red_event_path.sql; needs S12, S16, S18, S19).
--
-- Proves in one rolled-back transaction:
--   1. Shape: free_red_events has RLS on and only the patient can read it; anon holds nothing; the config is valid.
--   2. A FREE patient's red event: no page, no clinical task, no clinician alert, no page.sent event; instead an emergency
--      event (the acknowledge-gated guidance), a Free record, a neutral critical in-app notice; the triage event is still there;
--      idempotent on a repeat.
--   3. The legacy path follows the same rule: an emergency event for a Free patient raises no clinician alert and opens the
--      Free record; for a Member it raises the alert and opens no Free record.
--   4. A MEMBER red event pages the rota primary exactly as before and creates its tasks; no Free record.
--   5. A patient whose membership cannot be worked out is PAGED (fail closed toward paging); an unknown patient too.
--   6. The check-in: not offered before it is due; offered after; only the owner can answer; bad answers refused; the answer
--      is stored once; no clinician or admin can read it (the answer is never shown to a doctor on Free).
--   7. The sweep sends the recheck and the check-in notices once each.
--   8. SABOTAGE: a gate stuck shut, a gate with no fail-closed handling, and a gate stuck open must each flip the matching check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(label text primary key, id uuid) on commit drop;
grant all on fx to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'tt-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'TT ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'TT ' || p_label, 'MDCN', 'TT-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, true)
  returning id into v_staff;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, v_staff, 'on_call', p_admin, true);
  insert into public.on_call_readiness (clinician_id, checklist_version, organisation_id, items, is_test) values (v, private.readiness_version(), p_org, private.readiness_items(), true);
  -- S19c (P9): objective readiness too: a working push subscription and an acknowledged test page (the email is already confirmed)
  insert into public.push_subscriptions (organisation_id, profile_id, endpoint, p256dh_key, auth_key) values (p_org, v, 'https://push.example.invalid/' || v, 'k', 'a');
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.page_tests (organisation_id, clinician_id, kind, acknowledged_at, delivered_at, is_test) values (p_org, v, 'readiness', now(), now(), true);
  perform set_config('tarragon.paging_write', 'off', true);
  return v;
end $f$;
-- a red triage event that asks to page and to open a blood pressure review task
create function pg_temp.red(p_patient uuid, p_set uuid) returns uuid language plpgsql as
$f$ declare v_id uuid; v_rs record;
begin
  select code, version, status into v_rs from public.triage_rule_sets where id = p_set;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code,
      rule_set_version, rule_set_status, actions, shadow, is_test, basis)
  select pr.organisation_id, p_patient, 'observation', gen_random_uuid(), 'red', 'R1', p_set, v_rs.code, v_rs.version, v_rs.status,
         '[{"kind":"page_on_call"},{"kind":"create_task","task":"bp_review","dueMinutes":60}]'::jsonb, false, true, gen_random_uuid()::text
    from public.profiles pr where pr.id = p_patient
  returning id into v_id;
  return v_id;
end $f$;
create function pg_temp.ee(p_patient uuid) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status)
  select organisation_id, p_patient, 'bp_reading', 'proof reading', 'active' from public.profiles where id = p_patient returning id into v;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_p uuid; v_b uuid; v_other uuid;
  free1 uuid; free2 uuid; mem1 uuid; mem2 uuid; unk uuid; leg_free uuid; leg_mem uuid;
  v_rs uuid; e_free uuid; e_mem uuid; e_unk uuid; v_page uuid; v_fre uuid; v_ee uuid; v_rota jsonb; v_n text; v_sid uuid;
  v_orig text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_p := pg_temp.mkdoc(v_org, v_admin, 'primary', 'senior_medical_officer');
  v_b := pg_temp.mkdoc(v_org, v_admin, 'backup', 'senior_medical_officer');
  v_other := pg_temp.mkdoc(v_org, v_admin, 'other', 'senior_medical_officer');
  free1 := pg_temp.mkuser(v_org, 'free-1', 'patient'); free2 := pg_temp.mkuser(v_org, 'free-2', 'patient');
  mem1 := pg_temp.mkuser(v_org, 'member-1', 'patient'); mem2 := pg_temp.mkuser(v_org, 'member-2', 'patient');
  unk := pg_temp.mkuser(v_org, 'unknown', 'patient'); leg_free := pg_temp.mkuser(v_org, 'legacy-free', 'patient'); leg_mem := pg_temp.mkuser(v_org, 'legacy-member', 'patient');
  insert into fx values ('admin', v_admin), ('cmo', v_cmo), ('primary', v_p), ('backup', v_b), ('member', mem1), ('free', free1), ('unknown', unk), ('other', v_other), ('free2', free2), ('member2', mem2);

  insert into public.patient_memberships (organisation_id, patient_id, source, state, granted_by, grant_reason, is_test)
  values (v_org, mem1, 'granted', 'active', v_admin, 'two-tier proof: a Member', true),
         (v_org, mem2, 'granted', 'active', v_admin, 'two-tier proof: a Member', true),
         (v_org, leg_mem, 'granted', 'active', v_admin, 'two-tier proof: a Member', true);

  insert into public.triage_rule_sets (code, version, status, rules, approved_by, approved_at, note)
    values ('tttest', 1, 'approved', '{"code":"tttest","version":1}'::jsonb, v_cmo, now(), 'two-tier proof fixture') returning id into v_rs;

  -- 1. Shape ---------------------------------------------------------------------------------------------------
  perform pg_temp.rec('free_red_events and free_red_config have RLS on', '2',
    (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('free_red_events', 'free_red_config') and c.relrowsecurity));
  perform pg_temp.rec('authenticated can only SELECT free_red_events and nothing on the config', '0',
    (select count(*)::text from information_schema.role_table_grants where table_schema = 'public' and grantee = 'authenticated'
       and ((table_name = 'free_red_events' and privilege_type <> 'SELECT') or table_name = 'free_red_config')));
  perform pg_temp.rec('anon holds nothing', '0', (select count(*)::text from information_schema.role_table_grants where table_schema = 'public' and table_name in ('free_red_events', 'free_red_config') and grantee in ('anon', 'PUBLIC')));
  perform pg_temp.rec('the configured times are 30 and 360 minutes', '30,360', private.free_red_rule('recheck_minutes') || ',' || private.free_red_rule('checkin_minutes'));
  perform pg_temp.rec('a config whose check-in is before the recheck is refused', '23514', pg_temp.try($q$insert into public.free_red_config (version, effective_from, rules) values (98, current_date, '{"recheck_minutes":60,"checkin_minutes":30}')$q$));
  perform pg_temp.rec('a config with a text time is refused', '23514', pg_temp.try($q$insert into public.free_red_config (version, effective_from, rules) values (97, current_date, '{"recheck_minutes":"x","checkin_minutes":30}')$q$));
  perform pg_temp.rec('the sweep is scheduled', '1', (select count(*)::text from cron.job where jobname = 'sweep-free-red-events'));
  perform pg_temp.rec('anon cannot call the check-in RPCs', 'false,false',
    has_function_privilege('anon', 'public.my_free_red_checkin()', 'EXECUTE')::text || ',' || has_function_privilege('anon', 'public.answer_free_red_checkin(uuid,text)', 'EXECUTE')::text);

  -- the rota so a Member red event has someone to page
  perform pg_temp.act(v_cmo);
  v_rota := public.set_on_call_rota(now() - interval '1 minute', now() + interval '10 hours', v_p, v_b, null);
  perform pg_temp.back();

  -- 2. A FREE red event ----------------------------------------------------------------------------------------
  perform pg_temp.rec('a Free patient may not page a doctor', 'false', private.patient_may_page_doctor(free1)::text);
  e_free := pg_temp.red(free1, v_rs);
  perform pg_temp.rec('create_red_page returns null for a Free patient', 'null', coalesce(public.create_red_page(e_free)::text, 'null'));
  perform pg_temp.rec('no page exists', '0', (select count(*)::text from public.pages where patient_id = free1));
  perform pg_temp.rec('create_tasks_from_triage_event creates nothing for a Free red event', '0', public.create_tasks_from_triage_event(e_free)::text);
  perform pg_temp.rec('no clinical task exists', '0', (select count(*)::text from public.clinical_tasks where patient_id = free1));
  perform pg_temp.rec('no clinician alert exists', '0', (select count(*)::text from public.clinician_alerts where patient_id = free1));
  perform pg_temp.rec('no page.sent event was emitted', '0', (select count(*)::text from public.domain_events where event_type = 'page.sent' and patient_id = free1));
  perform pg_temp.rec('no notification went to any clinician about it', '0', (select count(*)::text from public.notifications where recipient_id in (v_p, v_b, v_cmo, v_other) and template in ('on_call_page', 'on_call_escalation')));
  perform pg_temp.rec('the triage event is still logged', '1', (select count(*)::text from public.triage_events where id = e_free and grade = 'red'));
  select id into v_ee from public.emergency_events where patient_id = free1 and source = 'triage_red';
  perform pg_temp.rec('an emergency event shows the acknowledge-gated guidance, with no clinician alert', 'active,true',
    (select status::text || ',' || (clinician_alert_id is null)::text from public.emergency_events where id = v_ee));
  perform pg_temp.rec('the Free record links the triage event and says no doctor was alerted', '1,true',
    (select count(*)::text || ',' || bool_and((triage_event_id = e_free) and (recheck_due_at < checkin_due_at))::text from public.free_red_events where patient_id = free1));
  perform pg_temp.rec('the audit line says doctor_alerted false', 'false', (select (event ->> 'doctor_alerted') from public.audit_log where action = 'free_red_event.recorded' and entity_id = (select id from public.free_red_events where patient_id = free1)));
  perform pg_temp.rec('the guidance notice is in-app, critical, non-clinical, with an empty payload (INV-07)', '1,critical,non_clinical,{}',
    (select count(*)::text || ',' || min(priority::text) || ',' || min(content_class::text) || ',' || min(payload::text) from public.notifications where recipient_id = free1 and template = 'free_red_guidance' and channel = 'in_app'));
  perform pg_temp.rec('a repeat adds nothing', '1,1,1',
    (public.create_red_page(e_free) is null)::int::text || ',' || (select count(*)::text from public.emergency_events where patient_id = free1 and source = 'triage_red') || ',' || (select count(*)::text from public.free_red_events where patient_id = free1));
  v_fre := (select id from public.free_red_events where patient_id = free1);

  -- 3. The legacy path follows the same rule ------------------------------------------------------------------
  perform pg_temp.ee(leg_free);
  perform pg_temp.rec('legacy: a Free emergency event raises no clinician alert', '0', (select count(*)::text from public.clinician_alerts where patient_id = leg_free));
  perform pg_temp.rec('legacy: ...and opens the Free record', '1', (select count(*)::text from public.free_red_events where patient_id = leg_free));
  perform pg_temp.ee(leg_mem);
  perform pg_temp.rec('legacy: a Member emergency event raises the Priority 1 alert', '1', (select count(*)::text from public.clinician_alerts where patient_id = leg_mem and level = 'emergency'));
  perform pg_temp.rec('legacy: ...and opens no Free record', '0', (select count(*)::text from public.free_red_events where patient_id = leg_mem));
  perform pg_temp.rec('the feature check agrees', 'false,true', private.patient_has_feature_access(free2, 'vitals_red_flag_doctor_escalation')::text || ',' || private.patient_has_feature_access(mem2, 'vitals_red_flag_doctor_escalation')::text);

  -- 4. A MEMBER red event pages as before -----------------------------------------------------------------------
  e_mem := pg_temp.red(mem1, v_rs);
  v_page := public.create_red_page(e_mem);
  perform pg_temp.rec('a Member red event pages the rota primary', v_p::text || ',primary,0',
    (select to_clinician_id::text || ',' || role::text || ',' || escalation_level::text from public.pages where id = v_page));
  perform pg_temp.rec('...with push, in-app and email', '3', (select count(*)::text from public.notifications where recipient_id = v_p and template = 'on_call_page' and source_id = v_page));
  perform pg_temp.rec('a Member red event creates its clinical task', '1', public.create_tasks_from_triage_event(e_mem)::text);
  perform pg_temp.rec('...and no Free record', '0', (select count(*)::text from public.free_red_events where patient_id = mem1));

  -- 5. Membership that cannot be worked out is PAGED -------------------------------------------------------------
  perform pg_temp.rec('an unknown patient is paged for', 'true', private.patient_may_page_doctor(null)::text);
  v_orig := pg_get_functiondef('private.patient_is_member(uuid)'::regprocedure);
  create or replace function private.patient_is_member(p_patient uuid) returns boolean language plpgsql as $f$ begin raise exception 'membership store unavailable'; end $f$;
  e_unk := pg_temp.red(unk, v_rs);
  perform pg_temp.rec('undeterminable membership: the gate says page', 'true', private.patient_may_page_doctor(unk)::text);
  perform pg_temp.rec('undeterminable membership: create_red_page pages', 'paged', case when public.create_red_page(e_unk) is not null then 'paged' else 'not paged' end);
  perform pg_temp.rec('undeterminable membership: no Free record', '0', (select count(*)::text from public.free_red_events where patient_id = unk));
  perform pg_temp.rec('undeterminable membership: the task is created', '1', public.create_tasks_from_triage_event(e_unk)::text);
  execute v_orig;

  -- 6. The check-in ---------------------------------------------------------------------------------------------
  perform pg_temp.act(free1);
  perform pg_temp.rec('the patient can read their own Free record', '1', (select count(*)::text from public.free_red_events));
  perform pg_temp.rec('no check-in is offered before it is due', '0', (select count(*)::text from public.my_free_red_checkin()));
  perform pg_temp.back();
  update public.free_red_events set checkin_due_at = now() - interval '1 minute', recheck_due_at = now() - interval '2 minutes' where id = v_fre;
  perform pg_temp.act(free1);
  perform pg_temp.rec('the check-in is offered once due', v_fre::text, (select id::text from public.my_free_red_checkin()));
  perform pg_temp.rec('a bad answer is refused', '22023', pg_temp.try(format('select public.answer_free_red_checkin(%L, ''fine'')', v_fre)));
  perform pg_temp.back();
  perform pg_temp.act(free2);
  perform pg_temp.rec('another patient cannot answer it', '42501', pg_temp.try(format('select public.answer_free_red_checkin(%L, ''got_care'')', v_fre)));
  perform pg_temp.rec('another patient cannot read it', '0', (select count(*)::text from public.free_red_events));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot answer', '42501', pg_temp.try(format('select public.answer_free_red_checkin(%L, ''got_care'')', v_fre)));
  perform pg_temp.back();
  perform pg_temp.act(free1);
  perform pg_temp.rec('the owner can answer', 'ok', pg_temp.try(format('select public.answer_free_red_checkin(%L, ''got_care'')', v_fre)));
  perform pg_temp.rec('a second answer changes nothing', 'ok', pg_temp.try(format('select public.answer_free_red_checkin(%L, ''not_yet'')', v_fre)));
  perform pg_temp.rec('the first answer is kept and no check-in is offered again', 'got_care,0',
    (select checkin_answer from public.free_red_events where id = v_fre) || ',' || (select count(*)::text from public.my_free_red_checkin()));
  perform pg_temp.back();
  perform pg_temp.act(v_p);
  perform pg_temp.rec('a clinician cannot read any Free record (the answer is never shown to a doctor)', '0', (select count(*)::text from public.free_red_events));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('the chief medical officer cannot either', '0', (select count(*)::text from public.free_red_events));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin cannot either', '0', (select count(*)::text from public.free_red_events));
  perform pg_temp.back();
  perform pg_temp.rec('no doctor-facing record of the answer was made', '0', ((select count(*) from public.clinician_alerts where patient_id = free1) + (select count(*) from public.clinical_tasks where patient_id = free1))::text);

  -- 7. The sweep: recheck and check-in notices once each, only while unanswered -------------------------------------
  update public.free_red_events set recheck_notified_at = null, checkin_notified_at = null, checkin_answer = null, checkin_answered_at = null where id = v_fre;
  update public.free_red_events set recheck_due_at = now() - interval '1 minute', checkin_due_at = now() - interval '1 minute' where patient_id = leg_free;
  v_n := private.sweep_free_red_events()::text;
  perform pg_temp.rec('the sweep sent the recheck and check-in notices for both unanswered records', '4', v_n);
  perform pg_temp.rec('...one recheck and one check-in each, neutral', '1,1,{}',
    (select count(*) filter (where template = 'free_red_recheck')::text || ',' || count(*) filter (where template = 'free_red_checkin')::text || ',' || min(payload::text) from public.notifications where recipient_id = free1 and channel = 'in_app' and template in ('free_red_recheck', 'free_red_checkin')));
  perform pg_temp.rec('a repeat sweep sends nothing', '0', private.sweep_free_red_events()::text);
  update public.free_red_events set checkin_answer = 'got_care', checkin_answered_at = now() where id = v_fre;

  -- keep the real definitions for the sabotage phase
  insert into fx values ('rs', v_rs);
end $$;

-- 7b. Membership flips between the emergency-event insert and the Free-record look-up (review finding 6) ------------------
-- A patient who is a Member when the emergency event is inserted gets no Free record from the trigger; record_free_red_event must
-- still end with a Free record (guidance and check-in), never with none.
do $$
declare v_rs uuid; v_m uuid; v_te uuid; v_fre uuid;
begin
  select id into v_rs from fx where label = 'rs';
  select id into v_m from fx where label = 'member2';
  v_te := pg_temp.red(v_m, v_rs);
  v_fre := private.record_free_red_event(v_te);
  insert into results values ('real', 'a red event whose membership flipped still ends with a Free record', 'true',
    (v_fre is not null and exists (select 1 from public.free_red_events where id = v_fre and triage_event_id = v_te))::text);
  insert into results values ('real', 'and the guidance notice was queued', '1',
    (select count(*)::text from public.notifications where recipient_id = v_m and template = 'free_red_guidance'));
  -- calling it again is idempotent
  insert into results values ('real', 'a repeat call returns the same record', 'true', (private.record_free_red_event(v_te) = v_fre)::text);
end $$;

-- 8. SABOTAGE ------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid; v_rs uuid; v_p uuid; v_member uuid; v_free uuid; v_unk uuid; v_orig_gate text; v_orig_member text; v_e uuid; v_r text;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_rs from fx where label = 'rs';
  select id into v_member from fx where label = 'member';
  select id into v_free from fx where label = 'free';
  select id into v_unk from fx where label = 'unknown';
  v_orig_gate := pg_get_functiondef('private.patient_may_page_doctor(uuid)'::regprocedure);
  v_orig_member := pg_get_functiondef('private.patient_is_member(uuid)'::regprocedure);

  -- sabotage 1: the gate is stuck shut. A Member red event must then wrongly be refused a page.
  create or replace function private.patient_may_page_doctor(p_patient uuid) returns boolean language sql as $f$ select false $f$;
  insert into results values ('sabotaged', 'a Member red event pages', 'paged',
    case when public.create_red_page(pg_temp.red((select id from fx where label = 'member2'), v_rs)) is not null then 'paged' else 'not paged' end);
  execute v_orig_gate;

  -- sabotage 2: no fail-closed handling. Membership that cannot be worked out must then raise instead of paging.
  create or replace function private.patient_may_page_doctor(p_patient uuid) returns boolean language sql as $f$ select private.patient_is_member(p_patient) $f$;
  create or replace function private.patient_is_member(p_patient uuid) returns boolean language plpgsql as $f$ begin raise exception 'membership store unavailable'; end $f$;
  insert into results values ('sabotaged', 'undeterminable membership pages', 'paged',
    (select pg_temp.try(format('select public.create_red_page(%L)', pg_temp.red(v_unk, v_rs)))));
  execute v_orig_member;
  execute v_orig_gate;

  -- sabotage 3: the gate is stuck open. A Free red event must then wrongly page.
  create or replace function private.patient_may_page_doctor(p_patient uuid) returns boolean language sql as $f$ select true $f$;
  v_r := (select case when public.create_red_page(pg_temp.red((select id from fx where label = 'free2'), v_rs)) is null then 'null' else 'paged' end);
  insert into results values ('sabotaged', 'a Free red event does not page', 'null', v_r);
  execute v_orig_gate;

  -- sabotage 4: the explicit fallback removed. A flipped-membership red event must then end with no Free record.
  declare v_d text := pg_get_functiondef('private.record_free_red_event(uuid)'::regprocedure); v_te uuid; v_f uuid;
  begin
    if replace(v_d, 'if v_fre is null then', 'if false then') = v_d then raise exception 'VACUOUS TEST: fallback text not found'; end if;
    execute replace(v_d, 'if v_fre is null then', 'if false then');
    v_te := pg_temp.red((select id from fx where label = 'member'), v_rs);
    v_f := private.record_free_red_event(v_te);
    insert into results values ('sabotaged', 'a flipped-membership red event ends with a Free record', 'true', (v_f is not null)::text);
    execute v_d;
  end;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'Two-tier free red path proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then
    raise exception 'VACUOUS TEST: only % of 4 sabotage steps changed the matching check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to differ inside the DO block above and are deliberately not printed: the runner treats
-- any FAIL verdict in the output as a failed proof.

rollback;
