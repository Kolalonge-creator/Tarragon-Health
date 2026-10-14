-- S78a proof: the direct paging watchdog (INV-05), the page.unacknowledged event, the re-page of an acknowledged-but-unclosed page, and
-- the paging counts (migration *_s78a_paging_watchdog_and_repage.sql; needs S18 and S19).
--
-- Proves in one rolled-back transaction:
--   1. Config: version 2 is PROPOSED and inactive; the active row has none of the new keys, so the hard defaults apply and the re-page is off;
--      a bad optional key is refused by the database.
--   2. The outbox deliberately stopped (a red triage event, the subscriber never run): the watchdog pages it after the grace period, to the
--      rota's primary, audits it and opens one sev1 incident. Never before the grace period, never after the lookback.
--   3. Excluded: a shadow red event, a test red event, an event inside the grace period.
--   4. Idempotent: a second sweep, and the subscriber's own later call, create nothing more (one root, one set of notices, one audit row).
--   5. The configured grace period is read from the ACTIVE config.
--   6. page.unacknowledged is emitted once when a page first escalates; page.escalated is still emitted.
--   7. Re-page: off by default; with a configured interval an acknowledged, unclosed page pages the acknowledging clinician and the backup once.
--   8. paging_counts: right numbers for CMO and admin; patient and anon refused; test pages are not counted.
--   9. SABOTAGE: replace the watchdog with a no-op, and the unpaged red event stays unpaged (the checks above would have failed).
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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's78a-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'S78a ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test, 'en')
  on conflict (id) do update set role = excluded.role, is_test = p_test, is_active = true, phone = excluded.phone;
  -- two-tier (CMO 2026-10-08): a red event pages only for a Member, so every fixture patient here is one
  if p_role = 'patient' then
    insert into public.patient_memberships (organisation_id, patient_id, source, state, is_test) values (p_org, v, 'purchase', 'active', p_test);
  end if;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text, p_test boolean) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician', p_test); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S78a ' || p_label, 'MDCN', 'S78A-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, p_test)
  returning id into v_staff;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, v_staff, 'on_call', p_admin, p_test);
  insert into public.on_call_readiness (clinician_id, checklist_version, organisation_id, items, is_test) values (v, private.readiness_version(), p_org, private.readiness_items(), p_test);
  return v;
end $f$;
-- a red (or other) triage event written directly, as if graded p_age_seconds ago; the outbox subscriber is never run for it
create function pg_temp.event(p_patient uuid, p_set uuid, p_grade text, p_shadow boolean, p_test boolean, p_age_seconds integer) returns uuid language plpgsql as
$f$ declare v_id uuid; v_rs record;
begin
  select code, version, status into v_rs from public.triage_rule_sets where id = p_set;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code,
      rule_set_version, rule_set_status, actions, shadow, is_test, basis, created_at)
  select pr.organisation_id, p_patient, 'observation', gen_random_uuid(), p_grade, 'R1', p_set, v_rs.code, v_rs.version, v_rs.status,
         case when p_grade = 'red' then '[{"kind":"page_on_call"}]'::jsonb else '[]'::jsonb end, p_shadow, p_test, gen_random_uuid()::text,
         now() - make_interval(secs => p_age_seconds)
    from public.profiles pr where pr.id = p_patient
  returning id into v_id;
  return v_id;
end $f$;
create function pg_temp.age(p_page uuid, p_minutes integer) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set sent_at = now() - make_interval(mins => p_minutes) where id = p_page;
  perform set_config('tarragon.paging_write', 'off', true);
end $f$;
create function pg_temp.age_ack(p_page uuid, p_minutes integer) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set acknowledged_at = now() - make_interval(mins => p_minutes) where coalesce(parent_page_id, id) = p_page and acknowledged_at is not null;
  perform set_config('tarragon.paging_write', 'off', true);
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_p uuid; v_b uuid; v_pt uuid; v_pt2 uuid; v_tpt uuid; v_set uuid; v_draft uuid;
  e_ok uuid; e_shadow uuid; e_test uuid; e_fresh uuid; e_old uuid; e_g uuid; e_cfg uuid; e_cfg2 uuid; e_pt2 uuid;
  v_root uuid; v_root2 uuid; v_sw jsonb; v_n integer; v_counts jsonb; v_backup_page uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', false);
  update public.clinical_staff set active = false where is_test is not true;   -- only fixture clinicians may be paged
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer', false);
  v_p := pg_temp.mkdoc(v_org, v_admin, 'primary', 'senior_medical_officer', false);
  v_b := pg_temp.mkdoc(v_org, v_admin, 'backup', 'senior_medical_officer', false);
  v_pt := pg_temp.mkuser(v_org, 'patient', 'patient', false);
  v_pt2 := pg_temp.mkuser(v_org, 'patient2', 'patient', false);
  v_tpt := pg_temp.mkuser(v_org, 'test-patient', 'patient', true);
  insert into fx values ('admin', v_admin), ('cmo', v_cmo), ('primary', v_p), ('backup', v_b), ('patient', v_pt);

  select id into v_draft from public.triage_rule_sets where status = 'draft' order by version desc limit 1;
  insert into public.triage_rule_sets (code, version, status, rules, approved_by, approved_at, note)
    values ('s78atest', 1, 'approved', '{"code":"s78atest","version":1}'::jsonb, v_cmo, now(), 'S78a proof fixture') returning id into v_set;

  -- the rota: one real shift (a test event is never paged by the watchdog, so no test shift is needed)
  perform pg_temp.act(v_cmo);
  perform public.set_on_call_rota(now() - interval '1 minute', now() + interval '10 hours', v_p, v_b, null);
  perform pg_temp.back();

  -- 1. Config ----------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('version 2 exists and is inactive', 'false', (select is_active::text from public.paging_config where version = 2));
  perform pg_temp.rec('the active version is still 1', '1', (select version::text from public.paging_config where is_active));
  perform pg_temp.rec('the active config has no re-page interval: the re-page is off', 'null', coalesce(private.paging_rule('repage_after_ack_minutes')::text, 'null'));
  perform pg_temp.rec('a zero grace is refused by the database', '23514', pg_temp.try($q$insert into public.paging_config (version, is_active, effective_from, rules) values (90, false, current_date, '{"escalation_minutes":[5,10],"lead_repeat_minutes":5,"lead_repeat_max":12,"unclosed_alert_minutes":60,"page_access_hours":24,"watchdog_grace_seconds":0}')$q$));
  perform pg_temp.rec('a string re-page interval is refused', '23514', pg_temp.try($q$insert into public.paging_config (version, is_active, effective_from, rules) values (91, false, current_date, '{"escalation_minutes":[5,10],"lead_repeat_minutes":5,"lead_repeat_max":12,"unclosed_alert_minutes":60,"page_access_hours":24,"repage_after_ack_minutes":"soon"}')$q$));

  -- 2 and 3. The outbox is stopped: events exist, the subscriber never runs ---------------------------------------------------
  e_ok := pg_temp.event(v_pt, v_set, 'red', false, false, 90);
  e_shadow := pg_temp.event(v_pt, v_draft, 'red', true, false, 90);
  e_test := pg_temp.event(v_tpt, v_set, 'red', false, true, 90);
  e_fresh := pg_temp.event(v_pt2, v_set, 'red', false, false, 5);
  e_old := pg_temp.event(v_pt2, v_set, 'red', false, false, 60 * 60 * 24);
  e_g := pg_temp.event(v_pt, v_set, 'green', false, false, 90);
  perform pg_temp.rec('before the watchdog nothing is paged (the outbox is down)', '0', (select count(*)::text from public.pages where triage_event_id in (e_ok, e_shadow, e_test, e_fresh, e_old, e_g)));

  v_sw := private.sweep_unpaged_red_events();
  perform pg_temp.rec('the watchdog pages the one eligible event', '1', v_sw ->> 'created');
  select id into v_root from public.pages where triage_event_id = e_ok and parent_page_id is null;
  perform pg_temp.rec('it goes to the rota primary at level 0', v_p::text || ',primary,0', (select to_clinician_id::text || ',' || role::text || ',' || escalation_level::text from public.pages where id = v_root));
  perform pg_temp.rec('push, in-app and email all go out, critical', '3', (select count(*)::text from public.notifications where recipient_id = v_p and template = 'on_call_page' and priority = 'critical' and source_id = v_root));
  perform pg_temp.rec('page.sent was emitted', '1', (select count(*)::text from public.domain_events where event_type = 'page.sent' and aggregate_id = v_root));
  perform pg_temp.rec('the watchdog audited it', '1', (select count(*)::text from public.audit_log where action = 'page.watchdog_created' and entity_id = v_root));
  perform pg_temp.rec('an open sev1 incident says the outbox path stalled', '1,sev1', (select count(*)::text || ',' || min(severity::text) from public.ops_incidents where external_reference = 'page_outbox_stalled' and status not in ('resolved', 'closed')));
  perform pg_temp.rec('a shadow red event is never paged (OQ-88)', '0', (select count(*)::text from public.pages where triage_event_id = e_shadow));
  perform pg_temp.rec('a test red event is never paged by the watchdog', '0', (select count(*)::text from public.pages where triage_event_id = e_test));
  perform pg_temp.rec('an event inside the grace period waits', '0', (select count(*)::text from public.pages where triage_event_id = e_fresh));
  perform pg_temp.rec('an event older than the lookback is left alone', '0', (select count(*)::text from public.pages where triage_event_id = e_old));
  perform pg_temp.rec('a green event is not paged', '0', (select count(*)::text from public.pages where triage_event_id = e_g));

  -- 4. Idempotent ---------------------------------------------------------------------------------------------------------
  v_sw := private.sweep_unpaged_red_events();
  perform pg_temp.rec('a second sweep creates nothing', '0', v_sw ->> 'created');
  perform pg_temp.rec('the subscriber arriving late gets the same page', v_root::text, public.create_red_page(e_ok)::text);
  perform pg_temp.rec('one root, one set of notices, one audit row', '1,3,1',
    (select count(*)::text from public.pages where triage_event_id = e_ok) || ',' || (select count(*)::text from public.notifications where source_id = v_root and template = 'on_call_page')
    || ',' || (select count(*)::text from public.audit_log where action = 'page.watchdog_created' and entity_id = v_root));

  -- 5. The grace period comes from the ACTIVE config ----------------------------------------------------------------------
  update public.paging_config set is_active = false where is_active;
  insert into public.paging_config (version, is_active, effective_from, rules) values (3, true, current_date,
    '{"escalation_minutes":[5,10],"lead_repeat_minutes":5,"lead_repeat_max":12,"unclosed_alert_minutes":60,"page_access_hours":24,"watchdog_grace_seconds":120,"watchdog_lookback_minutes":360,"repage_after_ack_minutes":30}');
  e_cfg := pg_temp.event(v_pt2, v_set, 'red', false, false, 90);
  perform private.sweep_unpaged_red_events();
  perform pg_temp.rec('with a 120 second grace an event 90 seconds old still waits', '0', (select count(*)::text from public.pages where triage_event_id = e_cfg));
  e_cfg2 := pg_temp.event(v_pt2, v_set, 'red', false, false, 150);
  perform private.sweep_unpaged_red_events();
  perform pg_temp.rec('and one 150 seconds old is paged', '1', (select count(*)::text from public.pages where triage_event_id = e_cfg2));

  -- 6. page.unacknowledged -------------------------------------------------------------------------------------------------
  perform pg_temp.age(v_root, 6);
  perform private.sweep_pages();
  select id into v_backup_page from public.pages where parent_page_id = v_root and role = 'backup';
  perform pg_temp.rec('the S19 ladder still pages the backup at five minutes', v_b::text, (select to_clinician_id::text from public.pages where id = v_backup_page));
  perform pg_temp.rec('page.escalated is still emitted', '1', (select count(*)::text from public.domain_events where event_type = 'page.escalated' and aggregate_id = v_backup_page));
  v_sw := private.sweep_page_followups();
  perform pg_temp.rec('page.unacknowledged is emitted for the root page', '1', (select count(*)::text from public.domain_events where event_type = 'page.unacknowledged' and aggregate_id = v_root and (payload ->> 'page_id')::uuid = v_root));
  perform private.sweep_page_followups();
  perform pg_temp.rec('and only once', '1', (select count(*)::text from public.domain_events where event_type = 'page.unacknowledged' and aggregate_id = v_root));
  perform pg_temp.rec('a page that has not escalated has no such event', '0', (select count(*)::text from public.domain_events where event_type = 'page.unacknowledged' and aggregate_id in (select id from public.pages where triage_event_id = e_cfg2)));

  -- 7. Re-page (config version 3 above sets 30 minutes) ----------------------------------------------------------------------
  perform pg_temp.act(v_p);
  perform public.acknowledge_page(v_root);
  perform pg_temp.back();
  perform private.sweep_page_followups();
  perform pg_temp.rec('an acknowledged page inside the interval is not re-paged', 'null', coalesce((select repaged_at::text from public.pages where id = v_root), 'null'));
  perform pg_temp.age_ack(v_root, 45);
  select count(*) into v_n from public.notifications where source_id in (v_root, v_backup_page) and template = 'on_call_page';
  v_sw := private.sweep_page_followups();
  perform pg_temp.rec('acknowledged and unclosed past the interval: re-paged once', '1', v_sw ->> 'repaged');
  perform pg_temp.rec('the acknowledging clinician and the backup each got a new page notice (3 channels each)', (v_n + 6)::text,
    (select count(*)::text from public.notifications where source_id in (v_root, v_backup_page) and template = 'on_call_page'));
  perform pg_temp.rec('repaged_at is set and audited', 'true,1', (select (repaged_at is not null)::text from public.pages where id = v_root) || ',' || (select count(*)::text from public.audit_log where action = 'page.repaged' and entity_id = v_root));
  perform private.sweep_page_followups();
  perform pg_temp.rec('a second sweep does not re-page again', (v_n + 6)::text, (select count(*)::text from public.notifications where source_id in (v_root, v_backup_page) and template = 'on_call_page'));
  perform pg_temp.act(v_p);
  perform public.close_page(v_root, 'proof: handled in full');
  perform pg_temp.back();

  -- 8. Counts ---------------------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_cmo);
  v_counts := public.paging_counts(30);
  perform pg_temp.back();
  perform pg_temp.rec('counts: pages seen (two real roots, no test page)', '2', v_counts ->> 'pages');
  perform pg_temp.rec('counts: one acknowledged, one escalated to the backup, one re-paged, one by the watchdog (two roots were)', '1,1,1,2',
    (v_counts ->> 'acknowledged') || ',' || (v_counts ->> 'escalated_to_backup') || ',' || (v_counts ->> 'repaged') || ',' || (v_counts ->> 'created_by_watchdog'));
  perform pg_temp.rec('counts: no override (the paged clinician acknowledged)', '0', v_counts ->> 'overrides');
  -- an override: the chief medical officer acknowledges a page that was sent to someone else
  perform pg_temp.act(v_cmo);
  perform public.acknowledge_page((select id from public.pages where triage_event_id = e_cfg2 and parent_page_id is null));
  v_counts := public.paging_counts(30);
  perform pg_temp.back();
  perform pg_temp.rec('counts: an acknowledgement by the CMO counts as an override', '1', v_counts ->> 'overrides');
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('counts: admin may read', 'ok', pg_temp.try('select public.paging_counts(30)'));
  perform pg_temp.back();
  perform pg_temp.act(v_pt);
  perform pg_temp.rec('counts: a patient is refused', '42501', pg_temp.try('select public.paging_counts(30)'));
  perform pg_temp.back();
  perform pg_temp.act(v_p);
  perform pg_temp.rec('counts: an ordinary clinician is refused', '42501', pg_temp.try('select public.paging_counts(30)'));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('counts: anon is refused', '42501', pg_temp.try('select public.paging_counts(30)'));
  perform pg_temp.rec('the sweeps are not callable by anon', '42501', pg_temp.try('select private.sweep_unpaged_red_events()'));
  perform pg_temp.back();

  -- 9. SABOTAGE: remove the watchdog; an unpaged red event now persists ----------------------------------------------------------
  create or replace function private.sweep_unpaged_red_events() returns jsonb language sql as $f$ select '{"created":0,"errors":0}'::jsonb $f$;
  update public.paging_config set is_active = false where version = 3;
  update public.paging_config set is_active = true where version = 1;
  e_pt2 := pg_temp.event(v_pt2, v_set, 'red', false, false, 600);
  perform private.sweep_unpaged_red_events();
  insert into results values ('sabotaged', 'a red event with no outbox is paged by the watchdog', '1', (select count(*)::text from public.pages where triage_event_id = e_pt2));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S78a proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 1 then
    raise exception 'VACUOUS TEST: the sabotage step did not change the matching check';
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
