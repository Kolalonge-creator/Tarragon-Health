-- S19 proof: red event paging and escalation (migration *_s19_red_event_paging.sql; needs the S18 rota).
--
-- Proves in one rolled-back transaction:
--   1. Shape: pages and paging_config have RLS on, authenticated only SELECT, anon nothing, the owner cannot write directly.
--   2. A shadow event, a green event and an unknown event never page (OQ-88).
--   3. A red event pages the rota's primary: push, in-app and email together, critical priority, neutral payload; one root per
--      event, idempotent on a repeat.
--   4. SAFETY CASE 8: unacknowledged at 5 minutes pages the backup and creates the class 1 task; at 10 minutes alerts the
--      clinical lead and ops and opens an incident; a repeat sweep adds nothing.
--   5. Acknowledgement stops the ladder; only the clinicians paged or the chief medical officer can; ops and patients cannot;
--      closing needs a note and the acknowledging clinician.
--   6. INV-12: an open page ties the paged clinician to the patient and a closed page does not; an old page closes itself.
--   7. SAFETY CASE 9: a red event with nobody on the rota goes to level 2 at once with a task, an incident and the lead alerted;
--      a primary who is no longer eligible hands the page to the backup, and with nobody else to page the lead is alerted at 5 minutes.
--   8. RLS, execute grants, neutral notices (INV-07).
--   9. SABOTAGE: drop the write guard, then make every account look like the chief medical officer; the matching checks must flip.
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
  values (v, 's19-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'S19 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S19 ' || p_label, 'MDCN', 'S19-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, true)
  returning id into v_staff;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, v_staff, 'on_call', p_admin, true);
  insert into public.on_call_readiness (clinician_id, checklist_version, organisation_id, items, is_test) values (v, private.readiness_version(), p_org, private.readiness_items(), true);
  return v;
end $f$;
create function pg_temp.red(p_patient uuid, p_set uuid, p_grade text, p_shadow boolean) returns uuid language plpgsql as
$f$ declare v_id uuid; v_rs record;
begin
  select code, version, status into v_rs from public.triage_rule_sets where id = p_set;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code,
      rule_set_version, rule_set_status, actions, shadow, is_test, basis)
  select pr.organisation_id, p_patient, 'observation', gen_random_uuid(), p_grade, 'R1', p_set, v_rs.code, v_rs.version, v_rs.status,
         case when p_grade = 'red' then '[{"kind":"page_on_call"}]'::jsonb else '[]'::jsonb end, p_shadow, true, gen_random_uuid()::text
    from public.profiles pr where pr.id = p_patient
  returning id into v_id;
  return v_id;
end $f$;
create function pg_temp.age_lead(p_page uuid, p_minutes integer) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set lead_alerted_at = now() - make_interval(mins => p_minutes), last_lead_alert_at = null where id = p_page;
  perform set_config('tarragon.paging_write', 'off', true);
end $f$;
-- fixture-only: move a page's clock (the guard allows it behind its own flag)
create function pg_temp.age(p_page uuid, p_minutes integer) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set sent_at = now() - make_interval(mins => p_minutes) where id = p_page;
  perform set_config('tarragon.paging_write', 'off', true);
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_p uuid; v_b uuid; v_x uuid; v_y uuid; v_other uuid;
  pt1 uuid; pt2 uuid; pt3 uuid; pt4 uuid; pt5 uuid; pt6 uuid; pt7 uuid;
  v_rs_ok uuid; v_rs_draft uuid; e_shadow uuid; e_green uuid; e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid; e6 uuid;
  v_root uuid; v_backup_page uuid; v_esc uuid; v_root2 uuid; v_root3 uuid; v_root4 uuid; v_root5 uuid; v_root6 uuid; v_txt text;
  v_forbidden text := 'blood|pressure|hypertens|diabet|result|reading|glucose|medicine|dose|symptom|S19 ';
  v_rota jsonb; pt8 uuid; pt9 uuid; pt10 uuid; e7 uuid; e9 uuid; e10 uuid; v_root9 uuid; v_root10 uuid; v_sweep jsonb; v_cnt integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;   -- only fixture clinicians may be paged
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_p := pg_temp.mkdoc(v_org, v_admin, 'primary', 'senior_medical_officer');
  v_b := pg_temp.mkdoc(v_org, v_admin, 'backup', 'senior_medical_officer');
  v_x := pg_temp.mkdoc(v_org, v_admin, 'x-primary', 'senior_medical_officer');
  v_y := pg_temp.mkdoc(v_org, v_admin, 'y-backup', 'senior_medical_officer');
  v_other := pg_temp.mkdoc(v_org, v_admin, 'other', 'senior_medical_officer');
  pt1 := pg_temp.mkuser(v_org, 'patient-1', 'patient'); pt2 := pg_temp.mkuser(v_org, 'patient-2', 'patient'); pt3 := pg_temp.mkuser(v_org, 'patient-3', 'patient');
  pt4 := pg_temp.mkuser(v_org, 'patient-4', 'patient'); pt5 := pg_temp.mkuser(v_org, 'patient-5', 'patient'); pt6 := pg_temp.mkuser(v_org, 'patient-6', 'patient');
  pt7 := pg_temp.mkuser(v_org, 'patient-7', 'patient'); pt8 := pg_temp.mkuser(v_org, 'patient-8', 'patient');
  pt9 := pg_temp.mkuser(v_org, 'patient-9', 'patient'); pt10 := pg_temp.mkuser(v_org, 'patient-10', 'patient');
  insert into fx values ('admin', v_admin), ('cmo', v_cmo), ('primary', v_p), ('backup', v_b);

  select id into v_rs_draft from public.triage_rule_sets where status = 'draft' order by version desc limit 1;
  insert into public.triage_rule_sets (code, version, status, rules, approved_by, approved_at, note)
    values ('s19test', 1, 'approved', '{"code":"s19test","version":1}'::jsonb, v_cmo, now(), 'S19 proof fixture') returning id into v_rs_ok;

  -- 1. Shape ---------------------------------------------------------------------------------------------------
  perform pg_temp.rec('pages and paging_config have RLS on', '2',
    (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('pages', 'paging_config') and c.relrowsecurity));
  perform pg_temp.rec('authenticated holds only SELECT', '0', (select count(*)::text from information_schema.role_table_grants where table_schema = 'public' and table_name in ('pages', 'paging_config') and grantee = 'authenticated' and privilege_type <> 'SELECT'));
  perform pg_temp.rec('anon holds nothing', '0', (select count(*)::text from information_schema.role_table_grants where table_schema = 'public' and table_name in ('pages', 'paging_config') and grantee in ('anon', 'PUBLIC')));
  perform pg_temp.rec('the configured times are the registry values 5 and 10', '5,10', (select (private.paging_rule('escalation_minutes') ->> 0) || ',' || (private.paging_rule('escalation_minutes') ->> 1)));

  perform pg_temp.rec('a paging config with one time is refused by the database', '23514', pg_temp.try($q$insert into public.paging_config (version, is_active, effective_from, rules) values (98, false, current_date, '{"escalation_minutes":[5],"lead_repeat_minutes":5,"lead_repeat_max":12,"unclosed_alert_minutes":60,"page_access_hours":24}')$q$));
  perform pg_temp.rec('a config whose times are not increasing is refused', '23514', pg_temp.try($q$insert into public.paging_config (version, is_active, effective_from, rules) values (97, false, current_date, '{"escalation_minutes":[10,5],"lead_repeat_minutes":5,"lead_repeat_max":12,"unclosed_alert_minutes":60,"page_access_hours":24}')$q$));
  perform pg_temp.rec('a config with a string time is refused', '23514', pg_temp.try($q$insert into public.paging_config (version, is_active, effective_from, rules) values (96, false, current_date, '{"escalation_minutes":["5","x"],"lead_repeat_minutes":5,"lead_repeat_max":12,"unclosed_alert_minutes":60,"page_access_hours":24}')$q$));
  perform pg_temp.rec('a config with no repeat cap is refused', '23514', pg_temp.try($q$insert into public.paging_config (version, is_active, effective_from, rules) values (94, false, current_date, '{"escalation_minutes":[5,10],"lead_repeat_minutes":5,"unclosed_alert_minutes":60,"page_access_hours":24}')$q$));
  perform pg_temp.rec('a valid new config is accepted', 'ok', pg_temp.try($q$insert into public.paging_config (version, is_active, effective_from, rules) values (95, false, current_date, '{"escalation_minutes":[3,6],"lead_repeat_minutes":2,"lead_repeat_max":5,"unclosed_alert_minutes":30,"page_access_hours":12}')$q$));

  -- the rota: primary and backup on call now (an employed clinician needs no declared hours)
  perform pg_temp.act(v_cmo);
  v_rota := public.set_on_call_rota(now() - interval '1 minute', now() + interval '10 hours', v_p, v_b, null);
  perform pg_temp.back();

  -- 2. Events that must not page --------------------------------------------------------------------------------
  e_shadow := pg_temp.red(pt1, v_rs_draft, 'red', true);
  e_green := pg_temp.red(pt1, v_rs_ok, 'green', false);
  perform pg_temp.rec('a shadow red event does not page (OQ-88)', 'null', coalesce(public.create_red_page(e_shadow)::text, 'null'));
  perform pg_temp.rec('a green event does not page', 'null', coalesce(public.create_red_page(e_green)::text, 'null'));
  perform pg_temp.rec('an unknown event is refused', '22023', pg_temp.try(format('select public.create_red_page(%L)', gen_random_uuid())));
  perform pg_temp.rec('no page exists yet', '0', (select count(*)::text from public.pages where patient_id = pt1));

  -- 3. A red event pages the primary ---------------------------------------------------------------------------
  e1 := pg_temp.red(pt1, v_rs_ok, 'red', false);
  v_root := public.create_red_page(e1);
  perform pg_temp.rec('the root page goes to the primary on call at level 0', v_p::text || ',primary,0', (select to_clinician_id::text || ',' || role::text || ',' || escalation_level::text from public.pages where id = v_root));
  perform pg_temp.rec('push, in-app and email all go out, critical', '3', (select count(*)::text from public.notifications where recipient_id = v_p and template = 'on_call_page' and priority = 'critical' and source_id = v_root and channel in ('push', 'in_app', 'email')));
  perform pg_temp.rec('a repeat returns the same page', v_root::text, public.create_red_page(e1)::text);
  perform pg_temp.rec('one root per event and no duplicate notices', '1,3', (select count(*)::text from public.pages where triage_event_id = e1) || ',' || (select count(*)::text from public.notifications where source_id = v_root));
  perform pg_temp.rec('page.sent was emitted urgent', 'true', (select (count(*) = 1 and bool_and(priority = 'urgent'))::text from public.domain_events where event_type = 'page.sent' and aggregate_id = v_root));
  perform pg_temp.act(v_p);
  perform pg_temp.rec('being paged is not enough for chart access: only acknowledging ties the clinician (INV-12)', 'false', private.clinician_has_patient_access(pt1)::text);
  perform pg_temp.back();
  perform pg_temp.act(v_other);
  perform pg_temp.rec('an unrelated clinician has no tie to the patient', 'false', private.clinician_has_patient_access(pt1)::text);
  perform pg_temp.back();

  -- 4. SAFETY CASE 8: the ladder -----------------------------------------------------------------------------------
  perform private.sweep_pages();
  perform pg_temp.rec('inside five minutes nothing escalates', '1', (select count(*)::text from public.pages where triage_event_id = e1));
  perform pg_temp.age(v_root, 6);
  perform private.sweep_pages();
  select id into v_backup_page from public.pages where parent_page_id = v_root and role = 'backup';
  perform pg_temp.rec('safety case 8: unacknowledged at five minutes pages the backup', v_b::text || ',1', (select to_clinician_id::text || ',' || escalation_level::text from public.pages where id = v_backup_page));
  perform pg_temp.rec('the backup gets push, in-app and email', '3', (select count(*)::text from public.notifications where recipient_id = v_b and template = 'on_call_page' and source_id = v_backup_page));
  perform pg_temp.rec('a class 1 task for the patient is open', 'open,1', (select state::text || ',' || priority_class::text from public.clinical_tasks where patient_id = pt1 and type = 'red_event_unacknowledged'));
  perform pg_temp.rec('the lead is not yet alerted at six minutes', 'true', (select (lead_alerted_at is null)::text from public.pages where id = v_root));
  perform private.sweep_pages();
  perform pg_temp.rec('a repeat sweep adds no second backup page or task', '1,1', (select count(*)::text from public.pages where parent_page_id = v_root and role = 'backup') || ',' || (select count(*)::text from public.clinical_tasks where patient_id = pt1 and type = 'red_event_unacknowledged'));
  perform pg_temp.age(v_root, 11);
  perform private.sweep_pages();
  select id into v_esc from public.pages where parent_page_id = v_root and role = 'escalation';
  perform pg_temp.rec('safety case 8: at ten minutes the clinical lead and ops are alerted', '3,3', (select count(*)::text from public.notifications where recipient_id = v_cmo and template = 'on_call_escalation' and source_id = v_esc) || ',' || (select count(*)::text from public.notifications where recipient_id = v_admin and template = 'on_call_escalation' and source_id = v_esc));
  perform pg_temp.rec('an incident stands for the unanswered page', '1', (select count(*)::text from public.ops_incidents where external_reference = 'page_unanswered:' || v_root and status not in ('resolved', 'closed')));
  perform pg_temp.rec('both escalations were emitted urgent', '2', (select count(*)::text from public.domain_events where event_type = 'page.escalated' and priority = 'urgent' and aggregate_id in (v_backup_page, v_esc)));
  perform private.sweep_pages();
  perform pg_temp.rec('a repeat sweep adds no second escalation', '1', (select count(*)::text from public.pages where parent_page_id = v_root and role = 'escalation'));

  -- the lead alert is repeated every few minutes until someone acknowledges
  perform pg_temp.age_lead(v_root, 6);
  perform private.sweep_pages();
  perform pg_temp.rec('the clinical lead is alerted again (push and in-app only, no second email) while nobody has acknowledged', '5', (select count(*)::text from public.notifications where recipient_id = v_cmo and template = 'on_call_escalation' and source_id = v_esc));
  perform private.sweep_pages();
  perform pg_temp.rec('and not again straight away', '5', (select count(*)::text from public.notifications where recipient_id = v_cmo and template = 'on_call_escalation' and source_id = v_esc));

  -- 5. Acknowledge and close ------------------------------------------------------------------------------------
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('ops cannot silence a page', '42501', pg_temp.try(format('select public.acknowledge_page(%L)', v_root)));
  perform pg_temp.back();
  perform pg_temp.act(v_other);
  perform pg_temp.rec('a clinician who was not paged cannot acknowledge', '42501', pg_temp.try(format('select public.acknowledge_page(%L)', v_root)));
  perform pg_temp.back();
  perform pg_temp.act(pt1);
  perform pg_temp.rec('a patient cannot acknowledge', '42501', pg_temp.try(format('select public.acknowledge_page(%L)', v_root)));
  perform pg_temp.back();
  perform pg_temp.act(v_b);
  perform pg_temp.rec('closing before acknowledging is refused', '22023', pg_temp.try(format('select public.close_page(%L, ''handled by phone call'')', v_backup_page)));
  perform public.acknowledge_page(v_backup_page);
  perform pg_temp.rec('the backup can acknowledge the whole page family', 'true', (select (count(*) = 3 and bool_and(acknowledged_by = v_b))::text from public.pages where coalesce(parent_page_id, id) = v_root));
  perform pg_temp.rec('acknowledging twice is harmless', 'ok', pg_temp.try(format('select public.acknowledge_page(%L)', v_root)));
  perform pg_temp.rec('the acknowledging clinician is now tied to the patient (INV-12)', 'true', private.clinician_has_patient_access(pt1)::text);
  perform pg_temp.rec('closing needs a written note', '22023', pg_temp.try(format('select public.close_page(%L, ''ok'')', v_root)));
  perform pg_temp.back();
  perform pg_temp.act(v_p);
  perform pg_temp.rec('only the acknowledging clinician or the CMO can close', '42501', pg_temp.try(format('select public.close_page(%L, ''closing someone else''''s page'')', v_root)));
  perform pg_temp.back();
  perform pg_temp.act(v_b);
  perform public.close_page(v_root, 'patient reached, advice given, follow-up task made');
  perform pg_temp.rec('close ends chart access for the acknowledging clinician', 'false', private.clinician_has_patient_access(pt1)::text);
  perform pg_temp.back();
  perform pg_temp.act(v_p);
  perform pg_temp.rec('close ends chart access for the first page recipient too', 'false', private.clinician_has_patient_access(pt1)::text);
  perform pg_temp.back();
  perform pg_temp.rec('acknowledging cancels the stale class 1 task', 'cancelled', (select state::text from public.clinical_tasks where patient_id = pt1 and type = 'red_event_unacknowledged'));
  perform pg_temp.rec('every page of the family is closed with the note', '3', (select count(*)::text from public.pages where coalesce(parent_page_id, id) = v_root and closed_at is not null and close_note like 'patient reached%'));

  -- acknowledgement stops the ladder
  e2 := pg_temp.red(pt2, v_rs_ok, 'red', false);
  v_root2 := public.create_red_page(e2);
  perform pg_temp.act(v_p); perform public.acknowledge_page(v_root2); perform pg_temp.back();
  perform pg_temp.age(v_root2, 11);
  perform private.sweep_pages();
  perform pg_temp.rec('an acknowledged page is never escalated', '1', (select count(*)::text from public.pages where coalesce(parent_page_id, id) = v_root2));
  -- the chief medical officer may acknowledge any page
  e3 := pg_temp.red(pt3, v_rs_ok, 'red', false);
  v_root3 := public.create_red_page(e3);
  perform pg_temp.act(v_cmo); perform public.acknowledge_page(v_root3); perform pg_temp.back();
  perform pg_temp.rec('the chief medical officer can acknowledge', v_cmo::text, (select acknowledged_by::text from public.pages where id = v_root3));

  -- 6. The access window ------------------------------------------------------------------------------------------
  e4 := pg_temp.red(pt4, v_rs_ok, 'red', false);
  v_root4 := public.create_red_page(e4);
  perform pg_temp.act(v_p);
  perform pg_temp.rec('a paged clinician who has not acknowledged has no chart access', 'false', private.clinician_has_patient_access(pt4)::text);
  perform public.acknowledge_page(v_root4);
  perform pg_temp.rec('after acknowledging the open page ties the clinician to the patient', 'true', private.clinician_has_patient_access(pt4)::text);
  perform pg_temp.back();
  perform pg_temp.age(v_root4, 25 * 60);
  e7 := pg_temp.red(pt8, v_rs_ok, 'red', false);
  perform public.create_red_page(e7);
  perform pg_temp.age((select id from public.pages where triage_event_id = e7 and parent_page_id is null), 25 * 60);
  perform private.sweep_pages();
  perform pg_temp.rec('an acknowledged page past the access window closes itself', 'true', (select (closed_at is not null)::text from public.pages where id = v_root4));
  perform pg_temp.rec('an UNACKNOWLEDGED page past the window is never closed quietly', 'true', (select (closed_at is null)::text from public.pages where triage_event_id = e7 and parent_page_id is null));
  perform pg_temp.act(v_p); perform pg_temp.rec('and the access of the closed one ends', 'false', private.clinician_has_patient_access(pt4)::text); perform pg_temp.back();
  -- settle e7 so it does not interfere: the paged primary acknowledges and closes it
  perform pg_temp.act(v_p);
  perform public.acknowledge_page((select id from public.pages where triage_event_id = e7 and parent_page_id is null));
  perform public.close_page((select id from public.pages where triage_event_id = e7 and parent_page_id is null), 'settled by the proof after the window check');
  perform pg_temp.back();

  -- 7. SAFETY CASE 9: no cover --------------------------------------------------------------------------------------
  perform pg_temp.act(v_cmo);
  perform public.cancel_on_call_rota((v_rota ->> 'id')::uuid, 'proof: take the cover away');
  perform pg_temp.back();
  e5 := pg_temp.red(pt5, v_rs_ok, 'red', false);
  v_root5 := public.create_red_page(e5);
  perform pg_temp.rec('safety case 9: no cover goes to level 2 immediately', 'escalation,2,true', (select role::text || ',' || escalation_level::text || ',' || no_cover::text from public.pages where id = v_root5));
  perform pg_temp.rec('the lead and ops are alerted at once', '3,3', (select count(*)::text from public.notifications where recipient_id = v_cmo and source_id = v_root5 and template = 'on_call_escalation') || ',' || (select count(*)::text from public.notifications where recipient_id = v_admin and source_id = v_root5 and template = 'on_call_escalation'));
  perform pg_temp.rec('a priority task is open so an on-call clinician can take it', 'true', (select (count(*) = 1)::text from public.clinical_tasks where patient_id = pt5 and type = 'red_event_unacknowledged'));
  perform pg_temp.rec('an incident stands for a red event with nobody on call', '1', (select count(*)::text from public.ops_incidents where external_reference = 'page_no_cover:' || v_root5 and status not in ('resolved', 'closed')));
  perform pg_temp.rec('the escalation is urgent', '1', (select count(*)::text from public.domain_events where event_type = 'page.escalated' and aggregate_id = v_root5 and priority = 'urgent'));
  perform private.sweep_pages();
  perform pg_temp.rec('the sweep never adds to a level 2 root', '1', (select count(*)::text from public.pages where coalesce(parent_page_id, id) = v_root5));
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('the CMO sees the level 2 row but not the patient until they acknowledge', '1,null',
    (select count(*)::text from public.my_active_pages() where root_id = v_root5) || ',' || (select coalesce(patient_id::text, 'null') from public.my_active_pages() where root_id = v_root5 limit 1));
  perform public.acknowledge_page(v_root5);
  perform pg_temp.rec('after acknowledging the CMO is tied to the patient', 'true', private.clinician_has_patient_access(pt5)::text);
  perform pg_temp.back();

  -- a primary who is no longer eligible hands the page to the backup, and with nobody else the lead is alerted at five minutes
  perform pg_temp.act(v_cmo);
  perform public.set_on_call_rota(now() - interval '1 minute', now() + interval '10 hours', v_x, v_y, null);
  perform pg_temp.back();
  update public.clinical_staff set license_expires_at = now() - interval '1 day' where profile_id = v_x;
  e6 := pg_temp.red(pt6, v_rs_ok, 'red', false);
  v_root6 := public.create_red_page(e6);
  perform pg_temp.rec('an ineligible primary is skipped: the backup is paged', v_y::text || ',primary,0', (select to_clinician_id::text || ',' || role::text || ',' || escalation_level::text from public.pages where id = v_root6));
  perform pg_temp.age(v_root6, 6);
  perform private.sweep_pages();
  perform pg_temp.rec('with nobody else to page, the lead is alerted at five minutes, not ten', 'true,0', (select (lead_alerted_at is not null)::text from public.pages where id = v_root6) || ',' || (select count(*)::text from public.pages where parent_page_id = v_root6 and role = 'backup'));

  -- 8. Access --------------------------------------------------------------------------------------------------------
  perform pg_temp.act(pt1);
  perform pg_temp.rec('a patient reads no pages', '0', (select count(*)::text from public.pages));
  perform pg_temp.rec('a patient cannot read the overview', '42501', pg_temp.try('select * from public.paging_overview()'));
  perform pg_temp.back();
  perform pg_temp.act(v_other);
  perform pg_temp.rec('an unrelated clinician reads no pages and has no open ones', '0,0', (select count(*)::text from public.pages) || ',' || (select count(*)::text from public.my_active_pages()));
  perform pg_temp.rec('an unrelated clinician cannot read the overview', '42501', pg_temp.try('select * from public.paging_overview()'));
  perform pg_temp.back();
  perform pg_temp.act(v_y);
  perform pg_temp.rec('the paged clinician sees their open page but not the patient until they acknowledge', 'true', (select (count(*) = 1 and bool_and(patient_id is null))::text from public.my_active_pages()));
  perform pg_temp.rec('and reads only their own pages', 'true', (select (count(*) >= 1 and bool_and(to_clinician_id = v_y or acknowledged_by = v_y))::text from public.pages));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('ops read every page and the overview, with no patient reference', 'true', (select (count(*) >= 5)::text from public.pages) );
  perform pg_temp.rec('the overview lists the pages', 'true', (select (count(*) >= 5)::text from public.paging_overview()));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon reads no pages', '42501', pg_temp.try('select count(*) from public.pages'));
  perform pg_temp.rec('anon cannot acknowledge', '42501', pg_temp.try(format('select public.acknowledge_page(%L)', v_root)));
  perform pg_temp.back();
  perform pg_temp.act(v_p);
  perform pg_temp.rec('a clinician cannot insert a page', '42501', pg_temp.try(format('insert into public.pages (organisation_id, patient_id, triage_event_id, role, to_clinician_id, escalation_level, config_version) values (%L, %L, %L, ''primary'', %L, 0, 1)', v_org, pt7, e1, v_p)));
  perform pg_temp.rec('a clinician cannot send a red page themselves', '42501', pg_temp.try(format('select public.create_red_page(%L)', e1)));
  perform pg_temp.back();
  perform pg_temp.rec('the owner cannot insert a page directly (guard)', '42501', pg_temp.try(format('insert into public.pages (organisation_id, patient_id, triage_event_id, role, to_clinician_id, escalation_level, config_version) values (%L, %L, %L, ''primary'', %L, 0, 1)', v_org, pt7, e1, v_p)));
  perform pg_temp.rec('anon and authenticated have no execute on the sender or the sweep', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where ((n.nspname = 'public' and p.proname = 'create_red_page') or (n.nspname = 'private' and p.proname in ('sweep_pages', 'page_notify', 'page_task', 'page_recipient')))
        and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))));
  perform pg_temp.rec('anon has no execute on the clinician functions', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('acknowledge_page', 'close_page', 'my_active_pages', 'paging_overview') and has_function_privilege('anon', p.oid, 'EXECUTE')));
  -- acknowledged is not handled: still unclosed an hour later, the lead and ops are told once
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set acknowledged_at = now() - interval '61 minutes' where coalesce(parent_page_id, id) = v_root2;
  perform set_config('tarragon.paging_write', 'off', true);
  perform private.sweep_pages();
  perform pg_temp.rec('an acknowledged page still open after an hour tells the lead and ops', '2,2', (select count(*)::text from public.notifications where recipient_id = v_cmo and template = 'on_call_unfinished' and source_id = v_root2) || ',' || (select count(*)::text from public.notifications where recipient_id = v_admin and template = 'on_call_unfinished' and source_id = v_root2));
  perform private.sweep_pages();
  perform pg_temp.rec('and only once', '2', (select count(*)::text from public.notifications where recipient_id = v_cmo and template = 'on_call_unfinished' and source_id = v_root2));
  -- the lead alert repeats a bounded number of times, then stops with an incident
  select id into v_esc from public.pages where parent_page_id = v_root6 and role = 'escalation';
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set lead_repeat_count = 11, last_lead_alert_at = now() - interval '6 minutes' where id = v_root6;
  perform set_config('tarragon.paging_write', 'off', true);
  perform private.sweep_pages();
  perform pg_temp.rec('the twelfth repeat opens a sev1 incident', '1', (select count(*)::text from public.ops_incidents where external_reference = 'page_unanswered_exhausted:' || v_root6 and status not in ('resolved', 'closed')));
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set last_lead_alert_at = now() - interval '6 minutes' where id = v_root6;
  perform set_config('tarragon.paging_write', 'off', true);
  select count(*) into v_cnt from public.notifications where recipient_id = v_cmo and source_id = v_esc and template = 'on_call_escalation';
  perform private.sweep_pages();
  perform pg_temp.rec('after the cap the sweep sends no more', v_cnt::text, (select count(*)::text from public.notifications where recipient_id = v_cmo and source_id = v_esc and template = 'on_call_escalation'));
  perform pg_temp.rec('INV-07: no paging notice carries a clinical word, a name or a reading', '0',
    (select count(*)::text from public.notifications n where n.template in ('on_call_page', 'on_call_escalation') and (n.payload::text ~* v_forbidden or n.payload - 'page_id' <> '{}'::jsonb)));
  -- one failing page must not stop the others (the sweep isolates each page) and must not pass unnoticed
  perform pg_temp.act(v_cmo);
  perform public.cancel_on_call_rota((select id from public.on_call_rota where cancelled_at is null and starts_at <= now() and ends_at > now() limit 1), 'proof: replace the shift for the isolation check');
  perform public.set_on_call_rota(now() - interval '1 minute', now() + interval '10 hours', v_p, v_b, null);
  perform pg_temp.back();
  insert into fx values ('poison', pt9);
  create function public.s19_poison() returns trigger language plpgsql as $f$
  begin
    if new.role = 'backup' and exists (select 1 from pg_temp.fx where label = 'poison' and id = new.patient_id) then raise exception 'poisoned page'; end if;
    return new;
  end $f$;
  create trigger s19_poison before insert on public.pages for each row execute function public.s19_poison();
  e9 := pg_temp.red(pt9, v_rs_ok, 'red', false); v_root9 := public.create_red_page(e9);
  e10 := pg_temp.red(pt10, v_rs_ok, 'red', false); v_root10 := public.create_red_page(e10);
  perform pg_temp.age(v_root9, 6); perform pg_temp.age(v_root10, 6);
  v_sweep := private.sweep_pages();
  drop trigger s19_poison on public.pages;
  perform pg_temp.rec('the failing page is reported, not hidden', 'true', ((v_sweep ->> 'errors')::integer >= 1)::text);
  perform pg_temp.rec('the other page was still escalated', '1', (select count(*)::text from public.pages where parent_page_id = v_root10 and role = 'backup'));
  perform pg_temp.rec('the failing page escalated nothing and rolled back cleanly', '0,true', (select count(*)::text from public.pages where parent_page_id = v_root9) || ',' || (select (backup_paged_at is null)::text from public.pages where id = v_root9));
  perform pg_temp.rec('an incident and an audit line record the failure', '1,true', (select count(*)::text from public.ops_incidents where external_reference = 'page_sweep_failed' and status not in ('resolved', 'closed')) || ',' || (select (count(*) >= 1)::text from public.audit_log where action = 'page_sweep.error' and entity_id = v_root9));
end $$;

-- 9. SABOTAGE ------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_rs uuid; v_p uuid; v_pt uuid; v_e uuid; v_root uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_admin from fx where label = 'admin';
  select id into v_p from fx where label = 'primary';
  select id into v_rs from public.triage_rule_sets where code = 's19test';
  v_pt := pg_temp.mkuser(v_org, 'patient-sabotage', 'patient');
  v_e := pg_temp.red(v_pt, v_rs, 'red', false);
  -- a covering shift for the sabotage page
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from fx where label = 'cmo'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.cancel_on_call_rota((select id from public.on_call_rota where cancelled_at is null and starts_at <= now() and ends_at > now() limit 1), 'proof: replace the shift');
  perform public.set_on_call_rota(now() - interval '1 minute', now() + interval '10 hours', v_p, (select id from fx where label = 'backup'), null);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  v_root := public.create_red_page(v_e);
  -- sabotage 1: drop the write guard; a direct insert must now succeed
  drop trigger pages_guard on public.pages;
  insert into results values ('sabotaged', 'the owner cannot insert a page directly (guard)', '42501',
    pg_temp.try(format('insert into public.pages (organisation_id, patient_id, triage_event_id, role, to_clinician_id, escalation_level, config_version, is_test) values (%L, %L, %L, ''primary'', %L, 0, 1, true)', v_org, v_pt, v_e, v_p)));
  -- sabotage 2: every account looks like the chief medical officer; ops could then silence a page
  create or replace function private.credential_is_cmo() returns boolean language sql as $f$ select true $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into results values ('sabotaged', 'ops cannot silence a page', '42501', pg_temp.try(format('select public.acknowledge_page(%L)', v_root)));
  reset role;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S19 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed the matching check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to differ inside the DO block above and are deliberately not printed: the runner treats
-- any FAIL verdict in the output as a failed proof.

rollback;
