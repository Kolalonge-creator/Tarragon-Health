-- S19c proof: red-event pager delivery hardening (migration *_s19c_pager_delivery_hardening.sql; S16-S20 review plan Stage 1).
--
-- Proves in one rolled-back transaction, each with a control or a sabotage that must flip the matching check:
--   P3   a page notification can never be an SMS or voice row (trigger); the older critical alert engine no longer climbs a page
--        to the next channel or re-notifies after an acknowledgement, while an ordinary critical row IS still escalated (control);
--        sabotage: the same page row with its source_table cleared is escalated, so the exclusion is what protects it.
--   P2   a page nudges the sender at once (pg_net request recorded), and a blood pressure reading is an URGENT bus event.
--   P8   a red triage event with no page after the grace period is paged by the reconciler (process-events "down"); a young
--        event and a Free patient's event are left alone; idempotent. Sabotage: reconciler replaced by a no-op, the sweep leaves
--        the event unpaged.
--   P4   a conflicted clinician or the patient themself is skipped (falls to the backup, or to level 2 when nobody is left), a
--        clinician who gains a conflict after acknowledging loses chart access (INV-12). Sabotage: has_conflict forced false.
--   P7   a clinician who is suspended after being paged cannot acknowledge.
--   P6   a repeat red event inside the window joins the open family (no new root, the acknowledging clinician is told); a family
--        past the window or expired is not joined. Sabotage: the window shrunk, the second event makes a second root.
--   9    delivered-ack: a page nobody has shown after 90 seconds pages the backup early; a shown page waits for 5 minutes; the
--        backup not shown after 90 seconds alerts the lead early. Only the clinician paged can record a receipt. Sabotage: the
--        early-advance window set huge, the early page does not happen.
--   exp  the last lead repeat expires the page: distinct alarm to the lead and ops, an ops incident, no automatic SMS; a late
--        acknowledgement still works. Sabotage: expire_page replaced by a no-op.
--   hb   sweep_pages and process-events heartbeats; a stale heartbeat and "nobody reachable on the rota" each open an incident.
--   P9   on-call needs a push subscription, a verified email and a test page acknowledged in the last 7 days (as well as the
--        checklist); the test page RPCs are rate limited and permissioned; the config switch turns the objective check off.
--   gen  grants, RLS, config validation.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(label text primary key, id uuid) on commit drop;
grant all on fx to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sab(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
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
  -- a leftover claim from an earlier act() would stop is_test being set (guard_is_test_flag)
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's19c-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'S19c ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  if p_role = 'patient' then
    insert into public.patient_memberships (organisation_id, patient_id, source, state, is_test) values (p_org, v, 'purchase', 'active', true);
  end if;
  return v;
end $f$;
-- p_ready: true = the full objective readiness (push subscription, acknowledged test page); false = checklist only
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text, p_ready boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S19c ' || p_label, 'MDCN', 'S19c-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, true)
  returning id into v_staff;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, v_staff, 'on_call', p_admin, true);
  insert into public.on_call_readiness (clinician_id, checklist_version, organisation_id, items, is_test) values (v, private.readiness_version(), p_org, private.readiness_items(), true);
  if p_ready then
    insert into public.push_subscriptions (organisation_id, profile_id, endpoint, p256dh_key, auth_key) values (p_org, v, 'https://push.example.invalid/' || v, 'k', 'a');
    perform set_config('tarragon.paging_write', 'on', true);
    insert into public.page_tests (organisation_id, clinician_id, kind, acknowledged_at, delivered_at, is_test) values (p_org, v, 'readiness', now(), now(), true);
    insert into public.page_delivered_acks (test_id, clinician_id, channel, device_id)
      select t.id, v, 'push', null from public.page_tests t where t.clinician_id = v;
    perform set_config('tarragon.paging_write', 'off', true);
  end if;
  return v;
end $f$;
create function pg_temp.red(p_patient uuid, p_set uuid, p_grade text, p_shadow boolean, p_age_seconds integer default 0) returns uuid language plpgsql as
$f$ declare v_id uuid; v_rs record;
begin
  select code, version, status into v_rs from public.triage_rule_sets where id = p_set;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code,
      rule_set_version, rule_set_status, actions, shadow, is_test, basis, created_at)
  select pr.organisation_id, p_patient, 'observation', gen_random_uuid(), p_grade, 'R1', p_set, v_rs.code, v_rs.version, v_rs.status,
         case when p_grade = 'red' then '[{"kind":"page_on_call"}]'::jsonb else '[]'::jsonb end, p_shadow, true, gen_random_uuid()::text,
         now() - make_interval(secs => p_age_seconds)
    from public.profiles pr where pr.id = p_patient
  returning id into v_id;
  return v_id;
end $f$;
-- fixture-only clock moves (the guard allows them behind its own flag)
create function pg_temp.age(p_page uuid, p_seconds integer) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set sent_at = now() - make_interval(secs => p_seconds) where id = p_page;
  perform set_config('tarragon.paging_write', 'off', true);
end $f$;
create function pg_temp.cancel_rota() returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.lead_write', 'on', true);
  update public.on_call_rota set cancelled_at = now(), cancelled_reason = 'proof' where cancelled_at is null;
  perform set_config('tarragon.lead_write', 'off', true);
end $f$;
create function pg_temp.set_rota(p_cmo uuid, p_primary uuid, p_backup uuid) returns void language plpgsql as
$f$ begin
  perform pg_temp.cancel_rota();
  perform pg_temp.act(p_cmo);
  perform public.set_on_call_rota(now() - interval '1 minute', now() + interval '10 hours', p_primary, p_backup, null);
  perform pg_temp.back();
end $f$;
create function pg_temp.set_dack(p_seconds integer) returns void language plpgsql as
$f$ begin
  update public.paging_delivery_config set rules = jsonb_set(rules, '{delivered_ack_seconds}', to_jsonb(p_seconds)) where is_active;
end $f$;
create function pg_temp.set_rule(p_key text, p_value integer) returns void language plpgsql as
$f$ begin
  update public.paging_delivery_config set rules = jsonb_set(rules, array[p_key], to_jsonb(p_value)) where is_active;
end $f$;
create function pg_temp.msg2b(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create function pg_temp.n(p_sql text) returns text language plpgsql as
$f$ declare v text; begin execute p_sql into v; return coalesce(v, 'null'); end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_p uuid; v_b uuid; v_c uuid; v_x uuid; v_late uuid; v_noready uuid; v_noready2 uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid; p7 uuid; p8 uuid; p9 uuid; p10 uuid; pfree uuid; pself uuid;
  v_rs uuid; e uuid; e2 uuid; e3 uuid; v_root uuid; v_root2 uuid; v_child uuid; v_back uuid; v_n0 bigint; v_n1 bigint; v_id uuid; v_t uuid; v_t2 uuid;
  v_rota_org uuid; v_txt text; v_dev text := 'device-s19c-0001'; v_def text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_p := pg_temp.mkdoc(v_org, v_admin, 'primary', 'senior_medical_officer');
  v_b := pg_temp.mkdoc(v_org, v_admin, 'backup', 'senior_medical_officer');
  v_c := pg_temp.mkdoc(v_org, v_admin, 'third', 'senior_medical_officer');
  v_x := pg_temp.mkdoc(v_org, v_admin, 'fourth', 'senior_medical_officer');
  v_noready := pg_temp.mkdoc(v_org, v_admin, 'noready', 'senior_medical_officer', false);
  v_noready2 := pg_temp.mkdoc(v_org, v_admin, 'noready2', 'senior_medical_officer', false);
  p1 := pg_temp.mkuser(v_org, 'p1', 'patient'); p2 := pg_temp.mkuser(v_org, 'p2', 'patient'); p3 := pg_temp.mkuser(v_org, 'p3', 'patient');
  p4 := pg_temp.mkuser(v_org, 'p4', 'patient'); p5 := pg_temp.mkuser(v_org, 'p5', 'patient'); p6 := pg_temp.mkuser(v_org, 'p6', 'patient');
  p7 := pg_temp.mkuser(v_org, 'p7', 'patient'); p8 := pg_temp.mkuser(v_org, 'p8', 'patient'); p9 := pg_temp.mkuser(v_org, 'p9', 'patient');
  p10 := pg_temp.mkuser(v_org, 'p10', 'patient'); pfree := pg_temp.mkuser(v_org, 'free', 'clinician');   -- no membership: a Free patient
  insert into fx values ('admin', v_admin), ('cmo', v_cmo), ('primary', v_p), ('backup', v_b);
  insert into public.triage_rule_sets (code, version, status, rules, approved_by, approved_at, note)
    values ('s19ctest', 1, 'approved', '{"code":"s19ctest","version":1}'::jsonb, v_cmo, now(), 'S19c proof fixture') returning id into v_rs;
  perform pg_temp.set_rota(v_cmo, v_p, v_b);

  -- gen. Shape, grants, config ----------------------------------------------------------------------------------------
  perform pg_temp.rec('the new tables have RLS on', '7',
    (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
      and c.relname in ('page_tests', 'page_delivered_acks', 'paging_heartbeats', 'on_call_device_seen', 'page_merged_events', 'paging_delivery_config', 'pages') and c.relrowsecurity));
  perform pg_temp.rec('anon holds nothing on them and authenticated only SELECT', '0',
    (select count(*)::text from information_schema.role_table_grants where table_schema = 'public'
      and table_name in ('page_tests', 'page_delivered_acks', 'paging_heartbeats', 'on_call_device_seen', 'page_merged_events', 'paging_delivery_config')
      and ((grantee in ('anon', 'PUBLIC')) or (grantee = 'authenticated' and privilege_type <> 'SELECT'))));
  perform pg_temp.rec('anon can execute none of the new public functions', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
      and p.proname in ('record_engine_heartbeat', 'paging_device_ping', 'record_page_delivered', 'record_notification_displayed', 'paging_health', 'send_test_page', 'acknowledge_test_page')
      and has_function_privilege('anon', p.oid, 'EXECUTE')));
  perform pg_temp.rec('the heartbeat writer is service role only', 'false,true',
    has_function_privilege('authenticated', 'public.record_engine_heartbeat(text)', 'EXECUTE')::text || ',' || has_function_privilege('service_role', 'public.record_engine_heartbeat(text)', 'EXECUTE')::text);
  perform pg_temp.rec('the default delivered-ack window is 90 seconds and the 5 and 10 minute timers are unchanged', '90,5,10',
    private.paging_delivery_rule('delivered_ack_seconds')::text || ',' || (private.paging_rule('escalation_minutes') ->> 0) || ',' || (private.paging_rule('escalation_minutes') ->> 1));
  perform pg_temp.rec('a delivery config with a zero window is refused', '23514',
    pg_temp.try($q$insert into public.paging_delivery_config (version, is_active, effective_from, rules) values (98, false, current_date, '{"delivered_ack_seconds":0,"reconcile_after_seconds":60,"reconcile_lookback_hours":24,"merge_window_minutes":30,"engine_heartbeat_stale_seconds":120,"device_seen_stale_minutes":10,"readiness_test_page_days":7,"test_page_min_interval_seconds":120,"objective_readiness_required":1}')$q$));
  perform pg_temp.rec('a delivery config missing a key is refused', '23514',
    pg_temp.try($q$insert into public.paging_delivery_config (version, is_active, effective_from, rules) values (97, false, current_date, '{"delivered_ack_seconds":90}')$q$));
  perform pg_temp.rec('a page table cannot be written directly', '42501',
    pg_temp.try(format('insert into public.page_tests (organisation_id, clinician_id) values (%L, %L)', v_org, v_p)));

  -- P3. No SMS, no legacy ladder for a page -----------------------------------------------------------------------------
  e := pg_temp.red(p1, v_rs, 'red', false);
  v_root := public.create_red_page(e);
  perform pg_temp.rec('P3: an sms row for a page is refused by the database', '23514',
    pg_temp.try(format('insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, priority, source_table, source_id) values (%L, %L, ''sms'', ''on_call_page'', ''{}'', ''pending'', ''critical'', ''pages'', %L)', v_p, v_org, v_root)));
  perform pg_temp.rec('P3: a voice row for a page is refused too', '23514',
    pg_temp.try(format('insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, priority, source_table, source_id) values (%L, %L, ''voice'', ''on_call_page'', ''{}'', ''pending'', ''critical'', ''pages'', %L)', v_p, v_org, v_root)));
  perform pg_temp.rec('P3: control: an sms row for something else is allowed', 'ok',
    pg_temp.try(format('insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, priority, source_table, source_id) values (%L, %L, ''sms'', ''booking_reminder'', ''{}'', ''pending'', ''routine'', null, null)', v_p, v_org)));
  -- make the page's three rows look "sent a long time ago, never opened" and add an ordinary critical row as the control
  update public.notifications set status = 'sent', sent_at = now() - interval '3 hours', created_at = now() - interval '3 hours' where source_table = 'pages' and source_id = v_root;
  insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, priority, sent_at, created_at)
    values (v_p, v_org, 'push', 'vitals_red_flag_clinician_alert', '{}', 'sent', 'critical', now() - interval '3 hours', now() - interval '3 hours') returning id into v_id;
  perform private.escalate_unconfirmed_critical_notifications();
  perform pg_temp.rec('P3: the legacy engine never touches a page notification (no next hop, no sms)', '0',
    (select count(*)::text from public.notifications n where n.escalated_from_id in (select id from public.notifications where source_table = 'pages' and source_id = v_root)));
  perform pg_temp.rec('P3: control: the same engine does escalate an ordinary critical notification', '1',
    (select count(*)::text from public.notifications n where n.escalated_from_id = v_id));
  -- acknowledged: still nothing re-notifies
  perform pg_temp.act(v_p); perform public.acknowledge_page(v_root); perform pg_temp.back();
  perform private.escalate_unconfirmed_critical_notifications();
  perform pg_temp.rec('P3: nothing re-notifies a page after it was acknowledged', '0',
    (select count(*)::text from public.notifications n where n.escalated_from_id in (select id from public.notifications where source_table = 'pages' and source_id = v_root)));
  -- sabotage: clear source_table on one page row; the engine then escalates it
  update public.notifications set source_table = null where id = (select id from public.notifications where source_table = 'pages' and source_id = v_root and channel = 'push' limit 1);
  perform private.escalate_unconfirmed_critical_notifications();
  perform pg_temp.sab('P3: the exclusion on source_table is what protects a page row', '0',
    (select count(*)::text from public.notifications n where n.escalated_from_id in (select id from public.notifications where source_id = v_root and template = 'on_call_page')));
  -- close this page family so it does not merge later
  perform pg_temp.act(v_p); perform public.close_page(v_root, 'proof: settled after the legacy engine check'); perform pg_temp.back();

  -- P2. Immediate nudge and an urgent first hop -------------------------------------------------------------------------
  begin
    perform vault.create_secret('https://example.invalid', 'project_url');
    perform vault.create_secret('k', 'edge_function_publishable_key');
    perform vault.create_secret('s', 'process_events_secret');
  exception when others then null;   -- already present on a stack that has them
  end;
  e := pg_temp.red(p2, v_rs, 'red', false);
  select count(*) into v_n0 from net.http_request_queue where url like '%send-pending-notifications%';
  v_root := public.create_red_page(e);
  select count(*) into v_n1 from net.http_request_queue where url like '%send-pending-notifications%';
  perform pg_temp.rec('P2: creating a page nudges the sender at once', 'true', (v_n1 > v_n0)::text);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
    values (v_org, p3, 'blood_pressure', 150, 95, 'manual', now()) returning id into v_id;
  perform pg_temp.rec('P2: a blood pressure reading outside the safe band is an urgent bus event (first hop)', 'urgent',
    (select priority from public.domain_events where event_type = 'observation.recorded' and aggregate_id = v_id));
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
    values (v_org, p3, 'blood_pressure', 120, 80, 'manual', now()) returning id into v_id;
  perform pg_temp.rec('P2: a reading inside the band stays on the 15 second cron (no flood on a bulk upload)', 'normal',
    (select priority from public.domain_events where event_type = 'observation.recorded' and aggregate_id = v_id));
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
    values (v_org, p3, 'blood_pressure', 85, 50, 'manual', now()) returning id into v_id;
  perform pg_temp.rec('P2: a low reading is outside the band too', 'urgent',
    (select priority from public.domain_events where event_type = 'observation.recorded' and aggregate_id = v_id));
  perform pg_temp.set_rule('first_hop_safe_systolic_min', 1);
  perform pg_temp.set_rule('first_hop_safe_systolic_max', 400);
  perform pg_temp.set_rule('first_hop_safe_diastolic_min', 1);
  perform pg_temp.set_rule('first_hop_safe_diastolic_max', 300);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
    values (v_org, p3, 'blood_pressure', 150, 95, 'manual', now()) returning id into v_id;
  perform pg_temp.sab('P2: with the band widened to everything a severe reading is no longer urgent', 'urgent',
    (select priority from public.domain_events where event_type = 'observation.recorded' and aggregate_id = v_id));
  perform pg_temp.set_rule('first_hop_safe_systolic_min', 100);
  perform pg_temp.set_rule('first_hop_safe_systolic_max', 139);
  perform pg_temp.set_rule('first_hop_safe_diastolic_min', 60);
  perform pg_temp.set_rule('first_hop_safe_diastolic_max', 89);
  perform pg_temp.act(v_p); perform public.acknowledge_page(v_root); perform public.close_page(v_root, 'proof: settled after the nudge check'); perform pg_temp.back();

  -- P8. Reconciler ------------------------------------------------------------------------------------------------------
  e := pg_temp.red(p4, v_rs, 'red', false, 120);                     -- two minutes old, never paged: process-events "is down"
  e2 := pg_temp.red(p5, v_rs, 'red', false, 5);                       -- five seconds old: still inside the grace period
  e3 := pg_temp.red(pfree, v_rs, 'red', false, 120);                  -- a Free patient's red event pages nobody by the two-tier rule
  perform pg_temp.rec('P8: before the reconciler none of them has a page', '0,0,0',
    (select count(*)::text from public.pages where triage_event_id = e) || ',' || (select count(*)::text from public.pages where triage_event_id = e2) || ',' || (select count(*)::text from public.pages where triage_event_id = e3));
  perform private.reconcile_red_pages();
  perform pg_temp.rec('P8: the old red event is paged by the reconciler, to the primary', v_p::text,
    (select to_clinician_id::text from public.pages where triage_event_id = e and parent_page_id is null));
  perform pg_temp.rec('P8: the young event is left to the normal path', '0', (select count(*)::text from public.pages where triage_event_id = e2));
  perform pg_temp.rec('P8: a Free patient is not paged, but the reconciler gives them the guidance record the stalled bus would have', '0,1',
    (select count(*)::text from public.pages where triage_event_id = e3) || ',' || (select count(*)::text from public.free_red_events where triage_event_id = e3));
  perform pg_temp.rec('P8: the recovery is audited and an incident points at the engine', '1,1',
    (select count(*)::text from public.audit_log where action = 'page.reconciled' and event ->> 'triage_event_id' = e::text) || ',' ||
    (select count(*)::text from public.ops_incidents where external_reference = 'page_reconciled' and status not in ('resolved', 'closed')));
  perform private.reconcile_red_pages();
  perform pg_temp.rec('P8: running it again changes nothing (idempotent)', '1', (select count(*)::text from public.pages where triage_event_id = e));
  -- through the sweep as well, and the sabotage: reconciler off, an old red event stays unpaged
  e2 := pg_temp.red(p6, v_rs, 'red', false, 120);
  perform private.sweep_pages();
  perform pg_temp.rec('P8: the 15 second sweep runs the reconciler too', '1', (select count(*)::text from public.pages where triage_event_id = e2));
  e3 := pg_temp.red(p7, v_rs, 'red', false, 120);
  v_def := pg_get_functiondef('private.reconcile_red_pages()'::regprocedure);
  create or replace function private.reconcile_red_pages() returns integer language sql as $f$ select 0 $f$;
  perform private.sweep_pages();
  perform pg_temp.sab('P8: with the reconciler removed an old red event stays unpaged', '1', (select count(*)::text from public.pages where triage_event_id = e3));
  execute v_def;   -- the real reconciler again, for the rest of the proof
  perform pg_temp.rec('P8: control: the real reconciler is back', 'true', (pg_get_functiondef('private.reconcile_red_pages()'::regprocedure) like '%page.reconciled%')::text);
  perform private.reconcile_red_pages();
  perform pg_temp.rec('P8: and it then recovers the event the sabotaged run left unpaged', '1', (select count(*)::text from public.pages where triage_event_id = e3));
  perform pg_temp.act(v_p);
  perform public.acknowledge_page((select id from public.pages where triage_event_id = e and parent_page_id is null));
  perform public.close_page((select id from public.pages where triage_event_id = e and parent_page_id is null), 'proof: settled reconciler page');
  perform public.acknowledge_page((select id from public.pages where triage_event_id = e2 and parent_page_id is null));
  perform public.close_page((select id from public.pages where triage_event_id = e2 and parent_page_id is null), 'proof: settled reconciler page');
  perform public.acknowledge_page((select id from public.pages where triage_event_id = e3 and parent_page_id is null));
  perform public.close_page((select id from public.pages where triage_event_id = e3 and parent_page_id is null), 'proof: settled reconciler page');
  perform pg_temp.back();

  -- P4. Conflicted clinician and the patient themself ---------------------------------------------------------------------
  insert into public.clinician_conflicts (organisation_id, clinician_id, patient_id, reason, source, status, declared_by, is_test)
    values (v_org, v_p, p8, 'proof: relative of the patient', 'self_declared', 'active', v_p, true);
  e := pg_temp.red(p8, v_rs, 'red', false);
  v_root := public.create_red_page(e);
  perform pg_temp.rec('P4: a conflicted primary is not paged: the backup is', v_b::text, (select to_clinician_id::text from public.pages where id = v_root));
  perform pg_temp.rec('P4: the conflicted clinician got no page notice', '0', (select count(*)::text from public.notifications where recipient_id = v_p and source_id = v_root));
  insert into public.clinician_conflicts (organisation_id, clinician_id, patient_id, reason, source, status, declared_by, is_test)
    values (v_org, v_b, p9, 'proof: colleague of the backup', 'self_declared', 'active', v_b, true);
  insert into public.clinician_conflicts (organisation_id, clinician_id, patient_id, reason, source, status, declared_by, is_test)
    values (v_org, v_p, p9, 'proof: relative of the primary', 'self_declared', 'active', v_p, true);
  e := pg_temp.red(p9, v_rs, 'red', false);
  v_root2 := public.create_red_page(e);
  perform pg_temp.rec('P4: with both conflicted there is no cover: level 2 at once, the lead alerted', 'true,2,true',
    (select (no_cover)::text || ',' || escalation_level::text || ',' || (to_clinician_id is null)::text from public.pages where id = v_root2));
  -- the patient is also a clinician on the rota
  -- (membership needs a patient-role profile, which a clinician has when their own access is paused and they are also a patient)
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  update public.profiles set role = 'patient' where id = v_p;
  insert into public.patient_memberships (organisation_id, patient_id, source, state, is_test) values (v_org, v_p, 'purchase', 'active', true);
  e := pg_temp.red(v_p, v_rs, 'red', false);
  v_id := public.create_red_page(e);
  update public.profiles set role = 'clinician' where id = v_p;
  perform pg_temp.rec('P4: a clinician is never paged about themself: the backup is', v_b::text, (select to_clinician_id::text from public.pages where id = v_id));
  -- a conflict that arises after the backup candidate was due
  perform pg_temp.set_rota(v_cmo, v_c, v_x);
  e := pg_temp.red(p10, v_rs, 'red', false);
  v_root := public.create_red_page(e);
  perform pg_temp.rec('P4: control: a clean rota pages its primary', v_c::text, (select to_clinician_id::text from public.pages where id = v_root));
  insert into public.clinician_conflicts (organisation_id, clinician_id, patient_id, reason, source, status, declared_by, is_test)
    values (v_org, v_x, p10, 'proof: conflict declared after the page', 'self_declared', 'active', v_x, true);
  perform pg_temp.age(v_root, 400);
  perform private.sweep_pages();
  perform pg_temp.rec('P4: the sweep does not page a backup who has a conflict: the lead is alerted at once', '0,true',
    (select count(*)::text from public.pages where parent_page_id = v_root and role = 'backup') || ',' || (select (lead_alerted_at is not null)::text from public.pages where id = v_root));
  -- INV-12: a conflict declared after acknowledging ends the chart access
  perform pg_temp.set_rota(v_cmo, v_p, v_b);
  update public.clinician_conflicts set status = 'lifted', lifted_at = now(), lifted_by = v_cmo where clinician_id = v_p and patient_id = p8;
  update public.clinician_conflicts set status = 'lifted', lifted_at = now(), lifted_by = v_cmo where clinician_id = v_p and patient_id = p9;
  update public.clinician_conflicts set status = 'lifted', lifted_at = now(), lifted_by = v_cmo where clinician_id = v_b and patient_id = p9;
  perform pg_temp.act(v_cmo); perform public.acknowledge_page(v_root2); perform public.close_page(v_root2, 'proof: settle the no-cover page'); perform pg_temp.back();
  update public.pages set closed_at = now() where false;   -- (no-op: keeps the block shape obvious)
  declare v_p11 uuid; v_pg uuid;
  begin
    v_p11 := pg_temp.mkuser(v_org, 'p11', 'patient');
    e := pg_temp.red(v_p11, v_rs, 'red', false);
    v_pg := public.create_red_page(e);
    perform pg_temp.act(v_p); perform public.acknowledge_page(v_pg);
    perform pg_temp.rec('P4: control: the acknowledging clinician has chart access', 'true', private.clinician_has_patient_access(v_p11)::text);
    perform pg_temp.back();
    insert into public.clinician_conflicts (organisation_id, clinician_id, patient_id, reason, source, status, declared_by, is_test)
      values (v_org, v_p, v_p11, 'proof: conflict found after acknowledging', 'cmo', 'active', v_cmo, true);
    perform pg_temp.act(v_p);
    perform pg_temp.rec('P4 / INV-12: a conflict ends the chart access an acknowledged page gave', 'false', private.clinician_has_patient_access(v_p11)::text);
    perform pg_temp.back();
    -- sabotage: has_conflict always false; the access returns
    v_def := pg_get_functiondef('private.has_conflict(uuid,uuid)'::regprocedure);
    create or replace function private.has_conflict(p_clinician uuid, p_patient uuid) returns boolean language sql as $f$ select false $f$;
    perform pg_temp.act(v_p);
    perform pg_temp.sab('P4 / INV-12: with has_conflict blinded the access is back', 'false', private.clinician_has_patient_access(v_p11)::text);
    perform pg_temp.back();
    execute v_def;
    -- a conflicted clinician cannot acknowledge either
    perform pg_temp.act(v_p);
    perform pg_temp.rec('P4: a conflicted clinician cannot acknowledge a page for that patient', '42501', pg_temp.try(format('select public.acknowledge_page(%L)', v_pg)));
    perform pg_temp.back();
  end;

  -- P7. Acknowledging needs a clinician who is still eligible ------------------------------------------------------------
  declare v_p12 uuid; v_pg uuid;
  begin
    v_p12 := pg_temp.mkuser(v_org, 'p12', 'patient');
    e := pg_temp.red(v_p12, v_rs, 'red', false);
    v_pg := public.create_red_page(e);
    perform pg_temp.rec('P7: control: the page went to the primary', v_p::text, (select to_clinician_id::text from public.pages where id = v_pg));
    update public.clinical_staff set status = 'suspended', active = false, suspended_at = now(), suspended_reason = 'proof: licence lapsed' where profile_id = v_p;
    perform pg_temp.act(v_p);
    perform pg_temp.rec('P7: a clinician suspended after being paged cannot acknowledge', '42501', pg_temp.try(format('select public.acknowledge_page(%L)', v_pg)));
    perform pg_temp.back();
    perform pg_temp.rec('P7: the page is still unacknowledged', 'null', (select coalesce(acknowledged_by::text, 'null') from public.pages where id = v_pg));
    update public.clinical_staff set status = 'active', active = true, suspended_at = null, suspended_reason = null where profile_id = v_p;
    update public.profiles set role = 'clinician' where id = v_p;
    perform pg_temp.act(v_p);
    perform pg_temp.rec('P7: control: once eligible again the same acknowledgement works', 'ok', pg_temp.try(format('select public.acknowledge_page(%L)', v_pg)));
    perform public.close_page(v_pg, 'proof: settled eligibility page');
    perform pg_temp.back();
    -- suspending a clinician takes them off the rota (S15/S18); put the shift back for the rest of the proof
    perform pg_temp.set_rota(v_cmo, v_p, v_b);
  end;

  -- P6. Repeat red events merge into one open family --------------------------------------------------------------------------
  declare v_pm uuid; v_pg uuid; v_ev1 uuid; v_ev2 uuid; v_ev3 uuid;
  begin
    v_pm := pg_temp.mkuser(v_org, 'merge', 'patient');
    v_ev1 := pg_temp.red(v_pm, v_rs, 'red', false);
    v_pg := public.create_red_page(v_ev1);
    v_ev2 := pg_temp.red(v_pm, v_rs, 'red', false);
    perform pg_temp.rec('P6: a second red event for the same patient joins the open family', v_pg::text, public.create_red_page(v_ev2)::text);
    perform pg_temp.rec('P6: no second root page, one merged record, the count is kept', '1,1,1',
      (select count(*)::text from public.pages where patient_id = v_pm and parent_page_id is null) || ',' || (select count(*)::text from public.page_merged_events where page_id = v_pg) ||
      ',' || (select merged_count::text from public.pages where id = v_pg));
    perform pg_temp.rec('P6: the merge is idempotent', v_pg::text, public.create_red_page(v_ev2)::text);
    perform private.reconcile_red_pages();
    perform pg_temp.rec('P6: the reconciler leaves a merged event alone', '0', (select count(*)::text from public.pages where triage_event_id = v_ev2));
    perform pg_temp.rec('P6: and it did not make a root for it', '0', (select count(*)::text from public.pages where triage_event_id = v_ev2));
    -- once acknowledged, a third event tells the clinician who took it
    perform pg_temp.act(v_p); perform public.acknowledge_page(v_pg); perform pg_temp.back();
    v_ev3 := pg_temp.red(v_pm, v_rs, 'red', false);
    perform public.create_red_page(v_ev3);
    perform pg_temp.rec('P6: the acknowledging clinician is told of the new event', '2',
      (select count(*)::text from public.notifications where recipient_id = v_p and template = 'on_call_page_update' and channel in ('push', 'in_app') and source_id = v_pg));
    -- sabotage: the merge window shrunk to one minute and the family older than that: the next event makes a new root
    perform pg_temp.age(v_pg, 600);
    perform pg_temp.set_rule('merge_window_minutes', 1);
    declare v_ev4 uuid; v_new uuid;
    begin
      v_ev4 := pg_temp.red(v_pm, v_rs, 'red', false);
      v_new := public.create_red_page(v_ev4);
      perform pg_temp.sab('P6: with the window shrunk the repeat event joins the old family (it should, so this flips)', 'true', (v_new = v_pg)::text);
      perform pg_temp.rec('P6: a family older than the window is not joined', 'false', (v_new = v_pg)::text);
      perform pg_temp.set_rule('merge_window_minutes', 30);
      perform pg_temp.act(v_p);
      perform public.acknowledge_page(v_new); perform public.close_page(v_new, 'proof: settled merge page'); perform public.close_page(v_pg, 'proof: settled merge family');
      perform pg_temp.back();
    end;
  end;

  -- 9. Delivered acknowledgement and the early advance ----------------------------------------------------------------------
  declare v_pd uuid; v_pg uuid; v_bk uuid;
  begin
    v_pd := pg_temp.mkuser(v_org, 'dack', 'patient');
    e := pg_temp.red(v_pd, v_rs, 'red', false);
    v_pg := public.create_red_page(e);
    perform pg_temp.age(v_pg, 100);
    perform private.sweep_pages();
    perform pg_temp.rec('9: a page not shown after 90 seconds pages the backup early (well before 5 minutes)', '1',
      (select count(*)::text from public.pages where parent_page_id = v_pg and role = 'backup'));
    perform pg_temp.rec('9: the early backup page records why', 'not_delivered',
      (select payload ->> 'reason' from public.domain_events where event_type = 'page.escalated' and aggregate_id = (select id from public.pages where parent_page_id = v_pg and role = 'backup')));
    perform pg_temp.rec('9: the 10 minute timer is not early: the lead is not alerted yet', 'true', (select (lead_alerted_at is null)::text from public.pages where id = v_pg));
    -- the backup was paged just now; make it 100 seconds old and not shown: the lead is alerted early
    select id into v_bk from public.pages where parent_page_id = v_pg and role = 'backup';
    perform set_config('tarragon.paging_write', 'on', true);
    update public.pages set sent_at = now() - interval '100 seconds' where id = v_bk;
    perform set_config('tarragon.paging_write', 'off', true);
    perform private.sweep_pages();
    perform pg_temp.rec('9: a backup page not shown after 90 seconds alerts the lead early', 'true',
      (select (lead_alerted_at is not null)::text from public.pages where id = v_pg));
    perform pg_temp.act(v_p); perform public.acknowledge_page(v_pg); perform public.close_page(v_pg, 'proof: settled dack page'); perform pg_temp.back();

    -- a page that WAS shown waits for the 5 minute timer
    v_pd := pg_temp.mkuser(v_org, 'dack2', 'patient');
    e := pg_temp.red(v_pd, v_rs, 'red', false);
    v_pg := public.create_red_page(e);
    perform pg_temp.act(v_b);
    perform pg_temp.rec('9: only the clinician paged can record a receipt', '42501', pg_temp.try(format('select public.record_page_delivered(%L, ''alarm'', %L)', v_pg, v_dev)));
    perform pg_temp.back();
    perform pg_temp.act(v_p);
    perform pg_temp.rec('9: the receipt is recorded the first time', 'true', public.record_page_delivered(v_pg, 'alarm', v_dev)::text);
    perform pg_temp.rec('9: ...and a repeat is harmless', 'false', public.record_page_delivered(v_pg, 'alarm', v_dev)::text);
    perform pg_temp.rec('9: a second channel is a second receipt', 'true', public.record_page_delivered(v_pg, 'push', null)::text);
    perform pg_temp.rec('9: an unknown channel is refused', '22023', pg_temp.try(format('select public.record_page_delivered(%L, ''smoke'', null)', v_pg)));
    perform pg_temp.back();
    perform pg_temp.age(v_pg, 100);
    perform private.sweep_pages();
    perform pg_temp.rec('9: a page that was shown does not advance early', '0', (select count(*)::text from public.pages where parent_page_id = v_pg));
    perform pg_temp.age(v_pg, 6 * 60);
    perform private.sweep_pages();
    perform pg_temp.rec('9: ...the 5 minute timer still pages the backup', '1', (select count(*)::text from public.pages where parent_page_id = v_pg and role = 'backup'));
    perform pg_temp.rec('9: the console learns the device was seen', '1', (select count(*)::text from public.on_call_device_seen where clinician_id = v_p and device_id = v_dev and last_delivered_at is not null));
    perform pg_temp.act(v_p); perform public.acknowledge_page(v_pg); perform public.close_page(v_pg, 'proof: settled dack2 page'); perform pg_temp.back();

    -- sabotage: the early window huge; the unshown page no longer pages early
    perform pg_temp.set_dack(100000);
    v_pd := pg_temp.mkuser(v_org, 'dack3', 'patient');
    e := pg_temp.red(v_pd, v_rs, 'red', false);
    v_pg := public.create_red_page(e);
    perform pg_temp.age(v_pg, 100);
    perform private.sweep_pages();
    perform pg_temp.sab('9: with the early-advance window removed an unshown page does not page the backup early', '1',
      (select count(*)::text from public.pages where parent_page_id = v_pg and role = 'backup'));
    perform pg_temp.set_dack(90);
    perform pg_temp.act(v_p); perform public.acknowledge_page(v_pg); perform public.close_page(v_pg, 'proof: settled dack3 page'); perform pg_temp.back();
  end;

  -- 9b. A clinician whose route cannot report receipts falls back to the 5 and 10 minute timers
  perform pg_temp.set_rule('objective_readiness_required', 0);
  perform pg_temp.set_rota(v_cmo, v_noready, v_noready2);
  perform pg_temp.set_rule('objective_readiness_required', 1);
  declare v_pq uuid; v_pg uuid;
  begin
    perform pg_temp.rec('9: a clinician with no receipt in the window is not receipt-capable', 'false,true',
      private.clinician_reports_delivery(v_noready)::text || ',' || private.clinician_reports_delivery(v_p)::text);
    v_pq := pg_temp.mkuser(v_org, 'noreceipt', 'patient');
    v_pg := public.create_red_page(pg_temp.red(v_pq, v_rs, 'red', false));
    perform pg_temp.rec('9: control: the page went to the clinician with no receipts', v_noready::text, (select to_clinician_id::text from public.pages where id = v_pg));
    perform pg_temp.age(v_pg, 100);
    perform private.sweep_pages();
    perform pg_temp.rec('9: silence of a route that cannot report never advances the ladder early', '0', (select count(*)::text from public.pages where parent_page_id = v_pg));
    perform pg_temp.age(v_pg, 6 * 60);
    perform private.sweep_pages();
    perform pg_temp.rec('9: ...the 5 minute timer still pages the backup for them', '1', (select count(*)::text from public.pages where parent_page_id = v_pg and role = 'backup'));
    perform pg_temp.act(v_noready2); perform public.acknowledge_page(v_pg); perform public.close_page(v_pg, 'proof: settled no-receipt page'); perform pg_temp.back();
  end;
  perform pg_temp.set_rota(v_cmo, v_p, v_b);

  -- exp. The expired state ---------------------------------------------------------------------------------------------------
  declare v_pe uuid; v_pg uuid; v_esc uuid; v_pe2 uuid; v_pg2 uuid;
  begin
    v_pe := pg_temp.mkuser(v_org, 'expire', 'patient');
    e := pg_temp.red(v_pe, v_rs, 'red', false);
    v_pg := public.create_red_page(e);
    perform pg_temp.age(v_pg, 700);
    perform private.sweep_pages();
    select id into v_esc from public.pages where parent_page_id = v_pg and role = 'escalation';
    perform pg_temp.rec('exp: before the last repeat the page is not expired', 'null', (select coalesce(expired_at::text, 'null') from public.pages where id = v_pg));
    -- one repeat left: age the repeat clock so the next sweep sends the final one
    perform set_config('tarragon.paging_write', 'on', true);
    update public.pages set lead_repeat_count = (private.paging_rule('lead_repeat_max') #>> '{}')::integer - 1, last_lead_alert_at = now() - interval '10 minutes' where id = v_pg;
    perform set_config('tarragon.paging_write', 'off', true);
    v_def := pg_get_functiondef('private.expire_page(uuid)'::regprocedure);
    create or replace function private.expire_page(p_root uuid) returns void language sql as $f$ select 1 $f$;
    perform private.sweep_pages();
    perform pg_temp.sab('exp: with expire_page removed the page is not expired', 'true', (select (expired_at is not null)::text from public.pages where id = v_pg));
    execute v_def;   -- the real function again
    perform private.expire_page(v_pg);
    perform pg_temp.rec('exp: the page is expired and not closed', 'true,true', (select (expired_at is not null)::text || ',' || (closed_at is null)::text from public.pages where id = v_pg));
    perform pg_temp.rec('exp: the lead and ops get the distinct alarm: push, in-app and email', '3,3',
      (select count(*)::text from public.notifications where recipient_id = v_cmo and template = 'on_call_expired' and source_id = v_esc) || ',' ||
      (select count(*)::text from public.notifications where recipient_id = v_admin and template = 'on_call_expired' and source_id = v_esc));
    perform pg_temp.rec('exp: an ops incident asks a named person to phone', '1',
      (select count(*)::text from public.ops_incidents where external_reference = 'page_expired:' || v_pg and status not in ('resolved', 'closed')));
    perform pg_temp.rec('exp: no sms or voice row exists for the page family at any point', '0',
      (select count(*)::text from public.notifications where channel in ('sms', 'voice') and source_table = 'pages' and source_id in (select id from public.pages where coalesce(parent_page_id, id) = v_pg)));
    perform pg_temp.act(v_cmo);
    perform pg_temp.rec('exp: the expired page is still shown to the lead (my_active_pages carries expired_at)', 'true',
      (select (expired_at is not null)::text from public.my_active_pages() where page_id = v_esc));
    perform pg_temp.back();
    -- a new red event for the same patient is NOT swallowed by an expired family
    v_pg2 := public.create_red_page(pg_temp.red(v_pe, v_rs, 'red', false));
    perform pg_temp.rec('exp: a new red event after an expiry rings again (new root)', 'true', (v_pg2 <> v_pg)::text);
    perform pg_temp.act(v_p);
    perform pg_temp.rec('exp: a late acknowledgement is still accepted', 'ok', pg_temp.try(format('select public.acknowledge_page(%L)', v_pg)));
    perform public.close_page(v_pg, 'proof: settled expired page'); perform public.acknowledge_page(v_pg2); perform public.close_page(v_pg2, 'proof: settled new root');
    perform pg_temp.back();
  end;

  -- hb. Heartbeats and the health sweep ------------------------------------------------------------------------------------------
  -- the real 'paging-health' cron job commits its own incidents on a stack where process-events never runs; start from a clean slate
  delete from public.ops_incidents where external_reference like 'paging_engine_stale:%' or external_reference like 'page_nobody_reachable:%';
  perform private.sweep_pages();
  perform pg_temp.rec('hb: sweep_pages records its heartbeat', 'true', (select (last_seen_at > now() - interval '5 seconds')::text from public.paging_heartbeats where component = 'sweep_pages'));
  perform pg_temp.rec('hb: the reconciler records its heartbeat', 'true', exists (select 1 from public.paging_heartbeats where component = 'reconciler')::text);
  perform pg_temp.rec('hb: process-events can record its heartbeat (service role path)', 'ok', pg_temp.try($q$select public.record_engine_heartbeat('process_events')$q$));
  perform pg_temp.rec('hb: an unknown component is refused', '22023', pg_temp.try($q$select public.record_engine_heartbeat('other')$q$));
  perform pg_temp.rec('hb: fresh heartbeats open no engine incident', '0',
    (select count(*)::text from public.ops_incidents where external_reference like 'paging_engine_stale:%' and status not in ('resolved', 'closed')));
  perform private.paging_heartbeat('sweep_pages');
  perform set_config('tarragon.paging_write', 'on', true);
  update public.paging_heartbeats set last_seen_at = now() - interval '10 minutes' where component = 'process_events';
  perform set_config('tarragon.paging_write', 'off', true);
  perform private.sweep_paging_health();
  perform pg_temp.rec('hb: a stale process-events heartbeat opens an incident', '1',
    (select count(*)::text from public.ops_incidents where external_reference = 'paging_engine_stale:process_events' and status not in ('resolved', 'closed')));
  perform pg_temp.rec('hb: ...and the fresh sweep_pages one does not', '0',
    (select count(*)::text from public.ops_incidents where external_reference = 'paging_engine_stale:sweep_pages' and status not in ('resolved', 'closed')));
  -- nobody reachable on a real rota
  select count(*) into v_n0 from public.ops_incidents where external_reference like 'page_nobody_reachable:%';
  perform pg_temp.cancel_rota();
  perform set_config('tarragon.lead_write', 'on', true);
  insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id, backup_clinician_id, built_by, is_test)
    values (v_org, now() - interval '1 hour', now() + interval '1 hour', v_noready, v_noready2, v_cmo, false);
  perform set_config('tarragon.lead_write', 'off', true);
  perform private.sweep_paging_health();
  perform pg_temp.rec('hb: a real shift whose clinicians have no push subscription opens a "nobody reachable" incident', 'true',
    (exists (select 1 from public.ops_incidents where external_reference = 'page_nobody_reachable:' || v_org and status not in ('resolved', 'closed')))::text);
  perform pg_temp.cancel_rota();
  perform set_config('tarragon.lead_write', 'on', true);
  delete from public.ops_incidents where external_reference = 'page_nobody_reachable:' || v_org;
  insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id, backup_clinician_id, built_by, is_test)
    values (v_org, now() - interval '1 hour', now() + interval '1 hour', v_p, v_b, v_cmo, false);
  perform set_config('tarragon.lead_write', 'off', true);
  perform private.sweep_paging_health();
  perform pg_temp.rec('hb: control: a real shift with a reachable clinician opens none', 'false',
    (exists (select 1 from public.ops_incidents where external_reference = 'page_nobody_reachable:' || v_org and status not in ('resolved', 'closed')))::text);
  perform pg_temp.cancel_rota();
  -- device ping and the reviewer health view
  perform pg_temp.act(v_p);
  perform pg_temp.rec('hb: a clinician device can ping', 'ok', pg_temp.try(format('select public.paging_device_ping(%L, ''web'')', 'device-s19c-0002')));
  perform pg_temp.rec('hb: a short device id is ignored without error', 'ok', pg_temp.try($q$select public.paging_device_ping('x', 'web')$q$));
  perform pg_temp.rec('hb: a clinician cannot read the health view', '42501', pg_temp.try($q$select public.paging_health()$q$));
  perform pg_temp.back();
  -- P9. Objective readiness and the test page ------------------------------------------------------------------------------
  perform pg_temp.cancel_rota();
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg2b(format('select public.set_on_call_rota(now() + interval ''1 day'', now() + interval ''1 day 8 hours'', %L, %L)', v_noready, v_p));
  perform pg_temp.rec('P9: a clinician with the checklist but no push subscription and no test page cannot be put on call', 'true,true,true',
    (v_txt like '22023:%not ready for on call%')::text || ',' || (v_txt like '%push_subscription%')::text || ',' || (v_txt like '%test_page%')::text);
  perform pg_temp.back();
  insert into public.push_subscriptions (organisation_id, profile_id, endpoint, p256dh_key, auth_key) values (v_org, v_noready, 'https://push.example.invalid/' || v_noready, 'k', 'a');
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg2b(format('select public.set_on_call_rota(now() + interval ''1 day'', now() + interval ''1 day 8 hours'', %L, %L)', v_noready, v_p));
  perform pg_temp.rec('P9: with a push subscription the missing test page still blocks', 'true,false',
    (v_txt like '%test_page%')::text || ',' || (v_txt like '%push_subscription%')::text);
  perform pg_temp.back();
  -- a clinician sends themself a test page: it is notified on push, in-app and email, never sms, and it is rate limited
  perform pg_temp.act(v_noready);
  v_t := public.send_test_page();
  perform pg_temp.rec('P9: a clinician can send themself a test page', 'true', (v_t is not null)::text);
  perform pg_temp.rec('P9: a second test page straight away is refused', '22023', pg_temp.try('select public.send_test_page()'));
  perform pg_temp.rec('P9: a clinician cannot send a test page to a colleague', '42501', pg_temp.try(format('select public.send_test_page(%L)', v_p)));
  perform pg_temp.rec('P9: a clinician cannot send a drill', '42501', pg_temp.try($q$select public.send_test_page(null, 'drill')$q$));
  perform pg_temp.back();
  perform pg_temp.rec('P9: the test page went out as push, in-app and email, critical, no sms', '3,0',
    (select count(*)::text from public.notifications where recipient_id = v_noready and template = 'on_call_test_page' and source_id = v_t and priority = 'critical' and channel in ('push', 'in_app', 'email')) || ',' ||
    (select count(*)::text from public.notifications where source_id = v_t and channel in ('sms', 'voice')));
  perform pg_temp.rec('P9: an unacknowledged test page does not make a clinician ready', 'true',
    (private.on_call_objective_gaps(v_noready) = array['test_page'])::text);
  perform pg_temp.act(v_noready);
  perform pg_temp.rec('P9: a test page nobody saw cannot be acknowledged (it would only prove a click)', '22023', pg_temp.try(format('select public.acknowledge_test_page(%L)', v_t)));
  perform public.record_page_delivered(v_t, 'alarm', 'device-s19c-0003');
  perform pg_temp.back();
  perform pg_temp.act(v_x);
  perform pg_temp.rec('P9: someone else cannot acknowledge or record a receipt for it', '42501,42501',
    pg_temp.try(format('select public.acknowledge_test_page(%L)', v_t)) || ',' || pg_temp.try(format('select public.record_page_delivered(%L, ''alarm'', null)', v_t)));
  perform pg_temp.back();
  perform pg_temp.act(v_noready);
  perform pg_temp.rec('P9: an alarm receipt alone still does not let the test page be acknowledged', '22023', pg_temp.try(format('select public.acknowledge_test_page(%L)', v_t)));
  perform pg_temp.rec('P9: the push receipt is recorded when the notification is shown', 'true', public.record_page_delivered(v_t, 'push', null)::text);
  perform public.acknowledge_test_page(v_t);
  perform pg_temp.rec('P9: my readiness shows no gaps and the time of the last test page', '0,true',
    jsonb_array_length(public.my_on_call_readiness() -> 'gaps')::text || ',' || ((public.my_on_call_readiness() ->> 'last_test_page_acknowledged_at') is not null)::text);
  perform pg_temp.back();
  perform set_config('tarragon.paging_write', 'on', true);
  update public.page_tests set sent_at = now() - interval '1 hour' where clinician_id = v_c;
  perform set_config('tarragon.paging_write', 'off', true);
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg2b(format('select public.set_on_call_rota(now() + interval ''1 day'', now() + interval ''1 day 8 hours'', %L, %L)', v_noready, v_p));
  perform pg_temp.rec('P9: after the push subscription and an acknowledged test page the clinician can be put on call', 'ok', v_txt);
  perform pg_temp.rec('P9: a reviewer can send a drill to a colleague', 'ok', pg_temp.try(format('select public.send_test_page(%L, ''drill'')', v_c)));
  perform pg_temp.rec('P9: the reviewer overview lists the gaps (none for the ready clinician)', 'true',
    (select bool_or(j.el ->> 'name' = 'S19c noready' and jsonb_array_length(j.el -> 'gaps') = 0) from jsonb_array_elements(public.on_call_readiness_overview()) as j(el))::text);
  perform pg_temp.back();
  -- a test page older than the configured days stops counting
  perform set_config('tarragon.paging_write', 'on', true);
  update public.page_tests set acknowledged_at = now() - interval '8 days' where clinician_id = v_x and acknowledged_at is not null;
  perform set_config('tarragon.paging_write', 'off', true);
  perform pg_temp.rec('P9: a test page acknowledged 8 days ago no longer counts', 'test_page', array_to_string(private.on_call_objective_gaps(v_x), ','));
  perform pg_temp.cancel_rota();
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg2b(format('select public.set_on_call_rota(now() + interval ''2 days'', now() + interval ''2 days 8 hours'', %L, %L)', v_x, v_p));
  perform pg_temp.rec('P9: so a clinician with a stale test page is refused', 'true', (v_txt like '22023:%test_page%')::text);
  perform pg_temp.back();
  -- the switch: objective readiness off, the checklist alone suffices; the same call now flips
  perform pg_temp.set_rule('objective_readiness_required', 0);
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg2b(format('select public.set_on_call_rota(now() + interval ''2 days'', now() + interval ''2 days 8 hours'', %L, %L)', v_x, v_p));
  perform pg_temp.sab('P9: with the objective check switched off the stale clinician is accepted', 'true', (v_txt like '22023:%test_page%')::text);
  perform pg_temp.back();
  perform pg_temp.set_rule('objective_readiness_required', 1);
  perform pg_temp.cancel_rota();

  -- the health view for a reviewer
  perform pg_temp.set_rota(v_cmo, v_p, v_b);
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('hb: the reviewer health view shows the engine, the rota and the on-call people', 'true,true',
    ((public.paging_health() -> 'rota_covered')::text = 'true')::text || ',' || (jsonb_array_length(public.paging_health() -> 'on_call') = 2)::text);
  perform pg_temp.back();

  -- RLS: each person reads their own receipts, test pages and device records; a colleague and a patient read none; a reviewer of the same organisation reads all
  perform pg_temp.act(v_x);
  perform pg_temp.rec('RLS: a clinician reads none of a colleague''s receipts, test pages or device records', '0,0,0',
    (select count(*)::text from public.page_delivered_acks where clinician_id = v_p) || ',' || (select count(*)::text from public.page_tests where clinician_id = v_noready) || ',' ||
    (select count(*)::text from public.on_call_device_seen where clinician_id = v_p));
  perform pg_temp.rec('RLS: ...nor the heartbeats or the merged-event records', '0,0',
    (select count(*)::text from public.paging_heartbeats) || ',' || (select count(*)::text from public.page_merged_events));
  perform pg_temp.back();
  perform pg_temp.act(v_p);
  perform pg_temp.rec('RLS: a clinician reads their own receipts and device records', 'true,true',
    ((select count(*) from public.page_delivered_acks where clinician_id = v_p) > 0)::text || ',' || ((select count(*) from public.on_call_device_seen where clinician_id = v_p) > 0)::text);
  perform pg_temp.back();
  perform pg_temp.act(p1);
  perform pg_temp.rec('RLS: a patient reads none of the paging tables', '0,0,0,0,0',
    (select count(*)::text from public.page_delivered_acks) || ',' || (select count(*)::text from public.page_tests) || ',' || (select count(*)::text from public.on_call_device_seen) || ',' ||
    (select count(*)::text from public.paging_heartbeats) || ',' || (select count(*)::text from public.page_merged_events));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('RLS: the chief medical officer reads receipts, test pages, device records and heartbeats of the organisation', 'true,true,true,true',
    ((select count(*) from public.page_delivered_acks) > 0)::text || ',' || ((select count(*) from public.page_tests) > 0)::text || ',' ||
    ((select count(*) from public.on_call_device_seen) > 0)::text || ',' || ((select count(*) from public.paging_heartbeats) > 0)::text);
  perform pg_temp.back();

  -- the service worker path: a notification id turns into a receipt only for the recipient's own page notification
  declare v_pn uuid; v_pg uuid; v_nid uuid;
  begin
    v_pn := pg_temp.mkuser(v_org, 'sw', 'patient');
    v_pg := public.create_red_page(pg_temp.red(v_pn, v_rs, 'red', false));
    select id into v_nid from public.notifications where recipient_id = v_p and source_id = v_pg and channel = 'push';
    perform pg_temp.act(v_b);
    perform pg_temp.rec('9: a colleague cannot turn someone else''s notification into a receipt', 'false', public.record_notification_displayed(v_nid)::text);
    perform pg_temp.back();
    perform pg_temp.act(v_p);
    perform pg_temp.rec('9: the recipient''s service worker records the push receipt', 'true', public.record_notification_displayed(v_nid)::text);
    perform pg_temp.back();
    perform pg_temp.rec('9: the page now counts as delivered', 'true', (select (delivered_at is not null)::text from public.pages where id = v_pg));
    perform pg_temp.act(v_p); perform public.acknowledge_page(v_pg); perform public.close_page(v_pg, 'proof: settled service worker page'); perform pg_temp.back();
  end;
end $$;

do $$
declare v_bad integer; v_caught integer; v_sab integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S19c proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_sab from results where phase = 'sabotaged';
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_sab < 7 or v_caught < v_sab then
    raise exception 'VACUOUS TEST: only % of % sabotage steps changed the matching check; unchanged: %', v_caught, v_sab,
      (select string_agg(check_name || ' expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'sabotaged' and expected = actual);
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
