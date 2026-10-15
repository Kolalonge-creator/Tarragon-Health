-- FU-notify proof (migrations *_fu_notify_rules_v5_and_retention_config, *_fu_notify_no_sms_clinician_ladder_and_contact_copies,
-- *_fu_notify_canary_heartbeat; needs the S13 R4, S11 to S15 and two-tier chain).
--
-- One rolled-back transaction. Proves:
--   A/B/C  OQ-329/330/331: notifications.rules v5; a delivered push receipt no longer ends the unconfirmed-red wait; "I could not get
--          care" is recorded and shown to on-call but the call waits for the 30 minute rule. Controls flip each switch back.
--   D      OQ-332: no ladder hop is sms or voice (normalize drops them); the exhausted-ladder alarm still fires; INV-08 trigger unchanged.
--   E      OQ-333: the emergency contact gets push, in-app and email copies only, matched by one confirmed phone, with consent re-checked.
--   F      OQ-341: webhook inbox retention: count-first plan, purge OFF behind a flag, redaction keeps the hash, replay refused, unscheduled.
--   G      OQ-346: credential evidence retention recorded in config v6 only; the purge skips every evidence document.
--   H      OQ-316: the canary heartbeat returns only {ok, age_bucket}, service role only.
--   Sabotage (final column reads 'PASS (caught)'): delivered confirms, could-not-get-care opens at once, sms let through, consent test
--          removed, inbox guard off, licence-evidence skip removed, heartbeat ignoring age.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(label text primary key, id uuid) on commit drop;
grant all on fx to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select id from fx where label = p $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.try_msg(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'r4-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'R4 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid language plpgsql as
$f$ declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'R4 ' || p_label, 'MDCN', 'R4-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, true)
  returning id into v_staff;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, v_staff, 'on_call', p_admin, true);
  insert into public.on_call_readiness (clinician_id, checklist_version, organisation_id, items, is_test) values (v, private.readiness_version(), p_org, private.readiness_items(), true);
  return v;
end $f$;
create function pg_temp.ee(p_patient uuid) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status)
  select organisation_id, p_patient, 'bp_reading', 'proof reading', 'active' from public.profiles where id = p_patient returning id into v;
  return v;
end $f$;
create function pg_temp.watch(p_ee uuid) returns uuid language sql as
$$ select id from public.red_alert_watch where source_kind = 'emergency_event' and source_id = p_ee $$;
create function pg_temp.notif(p_org uuid, p_to uuid, p_channel text, p_status text, p_priority text, p_extra jsonb default '{}') returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, priority, sent_at, failed_at, escalation_hop, content_class)
  values (p_org, p_to, p_channel::public.notification_channel, p_status::public.notification_status, 'r4_proof', p_extra, p_priority::public.notification_priority,
          case when p_status = 'sent' then now() - interval '1 minute' end, case when p_status = 'failed' then now() end, 1, 'non_clinical')
  returning id into v;
  return v;
end $f$;


-- extra helpers
create function pg_temp.act_service() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role service_role;
end $f$;
create function pg_temp.set_red(p_delivered boolean, p_now boolean) returns void language sql as
$$ update public.notification_rules_config
     set config = jsonb_set(config, '{redUnconfirmed}', (config -> 'redUnconfirmed') || jsonb_build_object('deliveredCountsAsConfirmed', p_delivered, 'couldNotGetCareOutreachNow', p_now))
   where is_active $$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_p uuid; v_b uuid; v_other uuid; clin uuid;
  mem uuid; mem2 uuid; mem3 uuid; e1 uuid; e2 uuid; e3 uuid; w1 uuid; w2 uuid; w3 uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_p := pg_temp.mkdoc(v_org, v_admin, 'primary', 'senior_medical_officer');
  v_b := pg_temp.mkdoc(v_org, v_admin, 'backup', 'senior_medical_officer');
  v_other := pg_temp.mkdoc(v_org, v_admin, 'other', 'senior_medical_officer');
  clin := v_other;
  insert into fx values ('org', v_org), ('admin', v_admin), ('cmo', v_cmo), ('clin', clin);

  -- A. notifications.rules v5 --------------------------------------------------------------------------------------
  perform pg_temp.rec('A1 the active rules are version 5 or later', 'true', (private.red_rules_version() >= 5)::text);
  perform pg_temp.rec('A2 a delivered push receipt does not confirm (OQ-329)', 'false', private.red_rule('deliveredCountsAsConfirmed'));
  perform pg_temp.rec('A3 "I could not get care" does not open the call at once (OQ-330)', 'false', private.red_rule('couldNotGetCareOutreachNow'));
  perform pg_temp.rec('A4 the 30 minute, 5 minute and 6 hour timings are kept (OQ-331)', '30,5,6',
    private.red_rule('unconfirmedMinutes') || ',' || private.red_rule('undeliveredMinutes') || ',' || private.red_rule('expireHours'));
  perform pg_temp.rec('A5 one active row, and the version 4 row is kept', 'true',
    ((select count(*) from public.notification_rules_config where is_active) = 1 and (select count(*) from public.notification_rules_config where version = 4) = 1)::text);

  -- the CMO confirms the outreach task type (what the sign-off hub does), so a task can be created
  perform pg_temp.act(v_cmo); perform public.confirm_task_type('red_patient_outreach', 'FU-notify proof'); perform pg_temp.back();

  -- B. a delivered push receipt does not end the wait ---------------------------------------------------------------
  mem := pg_temp.mkuser(v_org, 'member-d', 'patient'); mem2 := pg_temp.mkuser(v_org, 'member-d-control', 'patient'); mem3 := pg_temp.mkuser(v_org, 'member-c', 'patient');
  insert into public.patient_memberships (organisation_id, patient_id, source, state, granted_by, grant_reason, is_test)
    select v_org, x, 'granted', 'active', v_admin, 'FU proof: a Member', true from unnest(array[mem, mem2, mem3]) x;
  insert into public.push_subscriptions (organisation_id, profile_id, platform, expo_push_token)
    values (v_org, mem, 'android', 'ExponentPushToken[fu-d1]'), (v_org, mem2, 'android', 'ExponentPushToken[fu-d2]');
  e1 := pg_temp.ee(mem); w1 := pg_temp.watch(e1);
  update public.notifications set status = 'sent', sent_at = now() - interval '30 minutes', delivered_at = now() - interval '29 minutes' where source_id = w1 and channel = 'push';
  update public.red_alert_watch set due_at = now() - interval '1 minute', opened_at = now() - interval '31 minutes' where id = w1;
  perform private.sweep_unconfirmed_red_alerts();
  perform pg_temp.rec('B1 v5: a delivered push receipt does NOT confirm, the call is created', 'outreach_created',
    (select state from public.red_alert_watch where id = w1));
  -- control: with the old setting the same delivered receipt confirms
  perform pg_temp.set_red(true, false);
  e2 := pg_temp.ee(mem2); w2 := pg_temp.watch(e2);
  update public.notifications set status = 'sent', sent_at = now() - interval '30 minutes', delivered_at = now() - interval '29 minutes' where source_id = w2 and channel = 'push';
  update public.red_alert_watch set due_at = now() - interval '1 minute', opened_at = now() - interval '31 minutes' where id = w2;
  perform private.sweep_unconfirmed_red_alerts();
  perform pg_temp.rec('B2 CONTROL: with deliveredCountsAsConfirmed true the same receipt confirms', 'confirmed,push_receipt',
    (select state || ',' || coalesce(confirmed_via, '') from public.red_alert_watch where id = w2));
  insert into results values ('sabotaged', 'a delivered receipt does not confirm', 'outreach_created', (select state from public.red_alert_watch where id = w2));
  perform pg_temp.set_red(false, false);
  -- the patient's own opening of a notice still confirms
  e3 := pg_temp.ee(mem3); w3 := pg_temp.watch(e3);
  update public.notifications set opened_at = now() where source_id = w3 and channel = 'in_app';
  update public.red_alert_watch set due_at = now() - interval '1 minute', opened_at = now() - interval '31 minutes' where id = w3;
  perform private.sweep_unconfirmed_red_alerts();
  perform pg_temp.rec('B3 only the patient''s own action confirms: opening a notice still does', 'confirmed,opened',
    (select state || ',' || coalesce(confirmed_via, '') from public.red_alert_watch where id = w3));
end $$;

do $$
declare
  v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); mem uuid; mem2 uuid; e1 uuid; e2 uuid; w1 uuid; w2 uuid; ans uuid;
begin
  -- C. "I could not get care" is recorded and shown to on-call but waits for the 30 minute rule ------------------------
  mem := pg_temp.mkuser(v_org, 'member-g', 'patient'); mem2 := pg_temp.mkuser(v_org, 'member-g-control', 'patient');
  insert into public.patient_memberships (organisation_id, patient_id, source, state, granted_by, grant_reason, is_test)
    select v_org, x, 'granted', 'active', v_admin, 'FU proof: a Member', true from unnest(array[mem, mem2]) x;
  e1 := pg_temp.ee(mem); w1 := pg_temp.watch(e1);
  perform pg_temp.act(mem);
  ans := public.record_red_care_response(gen_random_uuid(), 'could_not_get_care', e1, null, now());
  perform pg_temp.back();
  perform pg_temp.rec('C1 v5: the answer is stored and marked shown to the clinician', 'could_not_get_care,true',
    (select response || ',' || shown_to_clinician::text from public.red_care_responses where id = ans));
  perform pg_temp.rec('C2 v5: the answer does NOT open the call at once', 'watching,0',
    (select state from public.red_alert_watch where id = w1) || ',' || (select count(*)::text from public.clinical_tasks where patient_id = mem and type = 'red_patient_outreach'));
  update public.red_alert_watch set due_at = now() - interval '1 minute', opened_at = now() - interval '31 minutes' where id = w1;
  perform private.sweep_unconfirmed_red_alerts();
  perform pg_temp.rec('C3 v5: the 30 minute rule still brings the call (the answer is never a confirmation)', 'outreach_created',
    (select state from public.red_alert_watch where id = w1));
  -- control: the old setting brings it forward at once
  perform pg_temp.set_red(false, true);
  e2 := pg_temp.ee(mem2); w2 := pg_temp.watch(e2);
  perform pg_temp.act(mem2);
  ans := public.record_red_care_response(gen_random_uuid(), 'could_not_get_care', e2, null, now());
  perform pg_temp.back();
  perform pg_temp.rec('C4 CONTROL: with couldNotGetCareOutreachNow true the answer opens the call at once', 'outreach_created',
    (select state from public.red_alert_watch where id = w2));
  insert into results values ('sabotaged', 'the answer does not open the call at once', 'watching', (select state from public.red_alert_watch where id = w2));
  perform pg_temp.set_red(false, false);
end $$;

do $$
declare
  v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); clin uuid := pg_temp.f('clin');
  n1 uuid; n2 uuid; v_id uuid; v_sms integer; v_def text; v_out text;
begin
  -- D. no sms anywhere in the ladders (OQ-332) ---------------------------------------------------------------------
  perform pg_temp.rec('D1 normalize drops sms and voice from any sequence', '{push,email}',
    private.normalize_escalation_channels(array['push', 'whatsapp', 'sms', 'voice'])::text);
  n1 := pg_temp.notif(v_org, clin, 'push', 'failed', 'critical');
  perform private.escalate_unconfirmed_critical_notifications();
  select id into n2 from public.notifications where escalated_from_id = n1;
  update public.notifications set status = 'failed', failed_at = now() where id = n2;
  perform private.escalate_unconfirmed_critical_notifications();
  select count(*) into v_sms from public.notifications where recipient_id = clin and channel in ('sms', 'voice');
  perform pg_temp.rec('D2 the default clinician ladder is push, email: no sms hop is ever queued', '0,email,true',
    v_sms::text || ',' || (select channel::text from public.notifications where id = n2) || ',' ||
    exists (select 1 from public.notification_escalation_failures where notification_id = n2)::text);
  perform pg_temp.rec('D3 ...and the exhausted-ladder alarm still fires for the admins', 'true',
    exists (select 1 from public.notifications where template = 'critical_notification_escalation_exhausted' and recipient_id = v_admin and (payload ->> 'notification_id')::uuid = n2)::text);
  v_id := private.enqueue_critical_notification(v_org, clin, 'fu_proof', '{}', 'no_such_pathway', 'emergency', null, null);
  perform pg_temp.rec('D4 enqueue with no pathway starts on push', 'push', (select channel::text from public.notifications where id = v_id));
  -- the INV-08 trigger is unchanged: it still refuses to leave an sms or voice row pending
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, priority, content_class)
    values (v_org, clin, 'sms', 'pending', 'fu_proof', '{}', 'critical', 'non_clinical') returning id into n1;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, priority, content_class)
    values (v_org, clin, 'voice', 'pending', 'fu_proof', '{}', 'routine', 'non_clinical') returning id into n2;
  perform pg_temp.rec('D5 the INV-08 trigger still fails a critical sms and suppresses a routine voice row', 'failed,suppressed',
    (select status::text from public.notifications where id = n1) || ',' || (select status::text from public.notifications where id = n2));
  -- sabotage: a normalizer that lets sms through
  v_def := pg_get_functiondef('private.normalize_escalation_channels(text[])'::regprocedure);
  execute replace(v_def, 'in (''push'', ''email'', ''in_app'')', 'in (''push'', ''email'', ''in_app'', ''sms'')');
  v_out := private.normalize_escalation_channels(array['push', 'whatsapp', 'sms', 'voice'])::text;
  execute v_def;
  insert into results values ('sabotaged', 'normalize drops sms and voice', '{push,email}', v_out);
end $$;

do $$
declare
  v_org uuid := pg_temp.f('org');
  pat uuid; contact uuid; contact2 uuid; ev uuid; ev2 uuid; v_phone text := '+2348055501234'; v_n integer; v_def text; v_out text;
begin
  -- E. the emergency contact: push, in-app, email only (OQ-333) ----------------------------------------------------
  pat := pg_temp.mkuser(v_org, 'ec-patient', 'patient');
  contact := pg_temp.mkuser(v_org, 'ec-contact', 'patient');
  update public.profiles set phone = v_phone where id = contact;
  update auth.users set phone = '2348055501234', phone_confirmed_at = now() where id = contact;
  update public.profiles set emergency_contact_phone = v_phone, emergency_contact_name = 'Contact', emergency_contact_consent = true, full_name = 'EC Patient' where id = pat;
  insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status, created_at)
    values (v_org, pat, 'bp_reading', 'proof reading', 'active', now() - interval '20 minutes') returning id into ev;
  perform private.notify_unacknowledged_emergencies();
  perform pg_temp.rec('E1 a reachable contact gets push, in-app and email copies and no sms', 'email,in_app,push|0',
    (select string_agg(channel::text, ',' order by channel::text) from public.notifications where recipient_id = contact and template = 'emergency_contact_alert') || '|' ||
    (select count(*)::text from public.notifications where template = 'emergency_contact_alert' and channel in ('sms', 'voice')));
  perform pg_temp.rec('E2 the copies carry the patient id (for the consent re-check) and no clinical content', 'true,false',
    (select bool_and(payload ->> 'patient_id' = pat::text)::text || ',' || bool_or(payload::text ~* 'hypertension|reading|182')::text from public.notifications where recipient_id = contact and template = 'emergency_contact_alert'));
  perform pg_temp.rec('E3 the event is stamped notified', 'true', (select (contact_notified_at is not null)::text from public.emergency_events where id = ev));
  perform private.notify_unacknowledged_emergencies();
  perform pg_temp.rec('E4 a repeat run queues nothing more', '3', (select count(*)::text from public.notifications where recipient_id = contact and template = 'emergency_contact_alert'));
  -- refusals
  insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status, suppress_contact_notify)
    values (v_org, pat, 'exposure_report', 'x', 'active', true) returning id into ev2;
  perform pg_temp.rec('E5 a confidential (suppressed) event queues nothing', '0', private.alert_emergency_contact_copies(ev2)::text);
  update public.profiles set emergency_contact_consent = false where id = pat;
  insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status) values (v_org, pat, 'bp_reading', 'x', 'active') returning id into ev2;
  perform pg_temp.rec('E6 without the patient''s consent nothing is queued', '0', private.alert_emergency_contact_copies(ev2)::text);
  -- sabotage: the consent test removed
  v_def := pg_get_functiondef('private.alert_emergency_contact_copies(uuid)'::regprocedure);
  if replace(v_def, ' or p.emergency_contact_consent is not true', '') = v_def then raise exception 'VACUOUS TEST: consent test text not found'; end if;
  execute replace(v_def, ' or p.emergency_contact_consent is not true', '');
  v_out := private.alert_emergency_contact_copies(ev2)::text;
  delete from public.notifications where recipient_id = contact and payload ->> 'source_notification_id' = ev2::text;
  execute v_def;
  insert into results values ('sabotaged', 'without consent nothing is queued', '0', v_out);
  update public.profiles set emergency_contact_consent = true where id = pat;
  update auth.users set phone_confirmed_at = null where id = contact;
  perform pg_temp.rec('E7 an unconfirmed phone number matches nobody', '0', private.alert_emergency_contact_copies(ev2)::text);
  update auth.users set phone_confirmed_at = now() where id = contact;
  contact2 := pg_temp.mkuser(v_org, 'ec-contact-2', 'patient');
  update public.profiles set phone = v_phone where id = contact2;
  -- auth.users.phone is unique, so two accounts cannot both hold a confirmed number: a second profile that merely lists the number
  -- (no confirmed auth phone) must not be alerted and must not make the match ambiguous.
  perform pg_temp.rec('E8 a profile that only lists the number is never alerted; the confirmed account still is', '3,0',
    private.alert_emergency_contact_copies(ev2)::text || ',' || (select count(*)::text from public.notifications where recipient_id = contact2 and template = 'emergency_contact_alert'));
  delete from public.notifications where recipient_id = contact and payload ->> 'source_notification_id' = ev2::text;
  -- the button wrapper
  perform pg_temp.act(pat);
  perform pg_temp.rec('E9 a signed-in patient cannot call the service-role wrapper', '42501', pg_temp.try(format('select public.alert_emergency_contact(%L, %L)', ev2, pat)));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('E10 anon cannot either', '42501', pg_temp.try(format('select public.alert_emergency_contact(%L, %L)', ev2, pat)));
  perform pg_temp.back();
  insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status) values (v_org, pat, 'bp_reading', 'x', 'active') returning id into ev2;
  perform pg_temp.act_service();
  v_n := public.alert_emergency_contact(ev2, pat);
  perform pg_temp.back();
  perform pg_temp.rec('E11 the service-role button path queues the copies and stamps the event', '3,true', v_n::text || ',' || (select (contact_notified_at is not null)::text from public.emergency_events where id = ev2));
  perform pg_temp.rec('E12 the SMS question function is gone and its guard row stays, born off', 'true,false',
    (to_regprocedure('public.sms_emergency_contact_open()') is null)::text || ',' ||
    coalesce((select is_on::text from public.go_live_guards where key = 'sms_emergency_contact_enabled'), 'missing'));
end $$;

do $$
declare
  v_admin uuid := pg_temp.f('admin');
  rej_old uuid; rej_new uuid; ver_old uuid; ver_new uuid; v_plan jsonb; v_run jsonb; v_sab text;
begin
  -- F. webhook inbox retention (OQ-341) ----------------------------------------------------------------------------
  insert into public.provider_events (provider, event_type, idempotency_key, raw_body, content_sha256, signature_verified, status, received_at)
  values ('resend', 'fu.rejected', 'fu-rej-old', '{"to":"x@example.com"}', repeat('a', 64), false, 'rejected', now() - interval '40 days') returning id into rej_old;
  insert into public.provider_events (provider, event_type, idempotency_key, raw_body, content_sha256, signature_verified, status, received_at)
  values ('resend', 'fu.rejected', 'fu-rej-new', '{"to":"x@example.com"}', repeat('b', 64), false, 'rejected', now() - interval '3 days') returning id into rej_new;
  insert into public.provider_events (provider, event_type, idempotency_key, raw_body, content_sha256, signature_verified, status, received_at, processed_at)
  values ('resend', 'email.sent', 'fu-ver-old', '{"to":["customer@example.com"],"n":1}', repeat('c', 64), true, 'processed', now() - interval '100 days', now() - interval '100 days') returning id into ver_old;
  insert into public.provider_events (provider, event_type, idempotency_key, raw_body, content_sha256, signature_verified, status, received_at, processed_at)
  values ('resend', 'email.sent', 'fu-ver-new', '{"to":["fresh@example.com"],"n":2}', repeat('d', 64), true, 'processed', now() - interval '10 days', now() - interval '10 days') returning id into ver_new;

  perform pg_temp.rec('F1 the retention config is active and the purge is born OFF', 'false,30,90',
    private.provider_retention_rule('purgeEnabled') || ',' || private.provider_retention_rule('rejectedDays') || ',' || private.provider_retention_rule('verifiedRawBodyDays'));
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('F2 an admin can run neither the purge nor the plan (service role only)', '42501,42501', pg_temp.try('select public.run_provider_event_retention(false)') || ',' || pg_temp.try('select public.provider_event_retention_plan()'));
  perform pg_temp.back();
  perform pg_temp.act_service();
  v_plan := public.provider_event_retention_plan();
  perform pg_temp.back();
  perform pg_temp.rec('F3 the plan counts first and changes nothing', 'false,true,true', (v_plan ->> 'purge_enabled') || ',' || ((v_plan ->> 'rejected_due')::int >= 1)::text || ',' || ((v_plan ->> 'raw_bodies_due')::int >= 1)::text);
  perform pg_temp.act_service();
  v_run := public.run_provider_event_retention(true);
  perform pg_temp.rec('F4 a dry run reports and deletes nothing', 'true,4', (v_run ->> 'dry_run') || ',' || (select count(*)::text from public.provider_events where idempotency_key like 'fu-%'));
  perform pg_temp.rec('F5 with the flag off a real run is refused', '23514', pg_temp.try('select public.run_provider_event_retention(false)'));
  perform pg_temp.back();
  perform pg_temp.rec('F6 with the flag off nothing was deleted or redacted', '4,0',
    (select count(*)::text from public.provider_events where idempotency_key like 'fu-%') || ',' || (select count(*)::text from public.provider_events where raw_redacted_at is not null and idempotency_key like 'fu-%'));
  -- switch the purge on by publishing version 2 (what a DPO-approved change would be)
  update public.provider_event_retention_config set is_active = false where is_active;
  insert into public.provider_event_retention_config (version, is_active, config) values (2, true, '{"purgeEnabled":true,"rejectedDays":30,"verifiedRawBodyDays":90,"redactCustomerEmails":true,"batchLimit":500}');
  perform pg_temp.act_service();
  v_run := public.run_provider_event_retention(false);
  perform pg_temp.back();
  perform pg_temp.rec('F7 an old rejected row is deleted, a recent one stays', 'false,true',
    exists (select 1 from public.provider_events where id = rej_old)::text || ',' || exists (select 1 from public.provider_events where id = rej_new)::text);
  perform pg_temp.rec('F8 an old verified body loses its customer email, keeps its hash and status, and is stamped', 'true,true,true',
    (select (raw_body not like '%customer@example.com%' and raw_body like '%[email removed]%')::text || ',' || (content_sha256 = repeat('c', 64))::text || ',' || (raw_redacted_at is not null and status = 'processed')::text
       from public.provider_events where id = ver_old));
  perform pg_temp.rec('F9 a recent verified body is untouched', 'true,true',
    (select (raw_body like '%fresh@example.com%')::text || ',' || (raw_redacted_at is null)::text from public.provider_events where id = ver_new));
  perform pg_temp.act_service();
  v_run := public.run_provider_event_retention(false);
  perform pg_temp.back();
  perform pg_temp.rec('F10 a second run does nothing more', '0,0', (v_run ->> 'rejected_deleted') || ',' || (v_run ->> 'raw_bodies_redacted'));
  perform pg_temp.rec('F11 the raw body cannot be edited outside the redaction', '42501',
    pg_temp.try(format('update public.provider_events set raw_body = %L where id = %L', '{}', ver_new)));
  perform pg_temp.rec('F12 a redacted body cannot be edited again either', '42501',
    pg_temp.try(format('update public.provider_events set raw_body = %L, raw_redacted_at = now() where id = %L', '{}', ver_old)));
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('F13 a redacted event is never replayed, an ordinary one still is', '23514,ok',
    pg_temp.try(format('select public.replay_provider_event(%L, %L)', ver_old, 'proof: replay a redacted body')) || ',' ||
    pg_temp.try(format('select public.replay_provider_event(%L, %L)', ver_new, 'proof: replay an ordinary body')));
  perform pg_temp.back();
  perform pg_temp.rec('F14 nothing schedules the purge', '0', (select count(*)::text from cron.job where command ilike '%run_provider_event_retention%'));
  perform pg_temp.rec('F15 anon and authenticated cannot execute the retention functions', 'false,false,false',
    has_function_privilege('anon', 'public.run_provider_event_retention(boolean)', 'EXECUTE')::text || ',' || has_function_privilege('authenticated', 'public.run_provider_event_retention(boolean)', 'EXECUTE')::text || ',' ||
    has_function_privilege('anon', 'public.provider_event_retention_plan()', 'EXECUTE')::text);
  -- sabotage: the guard trigger off lets a raw body be rewritten
  alter table public.provider_events disable trigger provider_events_guard;
  v_sab := pg_temp.try(format('update public.provider_events set raw_body = %L where id = %L', '{"x":1}', ver_new));
  alter table public.provider_events enable trigger provider_events_guard;
  insert into results values ('sabotaged', 'the raw body cannot be edited outside the redaction', '42501', v_sab);
end $$;

do $$
declare
  v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); u_old uuid; staff_id uuid; d_lic uuid; d_plain uuid; v_def text; v_def2 text; v_out text;
begin
  -- G. credential evidence retention: config only, purge off, evidence skipped (OQ-346) -------------------------------
  perform pg_temp.rec('G1 credentialing_config v6 records employment plus 6 years, inactive, purge off', '6,false,false',
    (select (rules ->> 'verification_evidence_retention_years_after_employment') || ',' || is_active::text || ',' || (rules ->> 'document_purge_enabled') from public.credentialing_config where version = 6));
  u_old := pg_temp.mkdoc(v_org, v_admin, 'leaver', 'senior_medical_officer');
  select id into staff_id from public.clinical_staff where profile_id = u_old;
  update public.clinical_staff set status = 'offboarded', active = false where id = staff_id;
  insert into public.clinician_documents (organisation_id, owner_profile_id, clinical_staff_id, kind, storage_path, mime_type, size_bytes, sha256, is_test, retain_until)
    values (v_org, u_old, staff_id, 'cv', v_org || '/' || u_old || '/lic.pdf', 'application/pdf', 1000, repeat('e', 64), true, current_date - 5) returning id into d_lic;
  insert into public.clinician_documents (organisation_id, owner_profile_id, clinical_staff_id, kind, storage_path, mime_type, size_bytes, sha256, is_test, retain_until)
    values (v_org, u_old, staff_id, 'cv', v_org || '/' || u_old || '/plain.pdf', 'application/pdf', 1000, repeat('f', 64), true, current_date - 5) returning id into d_plain;
  insert into public.clinician_licence_verifications (organisation_id, clinical_staff_id, checked_by, checked_on, folio, register_result, evidence_document_id, next_due, is_test)
    values (v_org, staff_id, v_admin, current_date - 30, 'FOLIO-FU-1', 'good_standing', d_lic, current_date + 300, true);
  perform pg_temp.rec('G2 the purge skips a document that backs a licence verification', '',
    coalesce((select private.credential_purge_reason(d) from public.clinician_documents d where d.id = d_lic), ''));
  perform pg_temp.rec('G3 ...but still applies to an ordinary document of the same owner', 'retention_elapsed',
    (select private.credential_purge_reason(d) from public.clinician_documents d where d.id = d_plain));
  perform pg_temp.rec('G4 the purge switch is off in the rules in force', 'false', coalesce((select private.credential_rule('document_purge_enabled') #>> '{}'), 'false'));
  -- sabotage: the licence-verification skip removed
  v_def := pg_get_functiondef('private.credential_purge_reason(public.clinician_documents)'::regprocedure);
  v_def2 := replace(v_def, E'    when exists (select 1 from public.clinician_licence_verifications v where v.evidence_document_id = d.id) then null\n', '');
  if v_def2 = v_def then raise exception 'VACUOUS TEST: licence evidence skip text not found'; end if;
  execute v_def2;
  v_out := coalesce((select private.credential_purge_reason(d) from public.clinician_documents d where d.id = d_lic), '');
  execute v_def;
  insert into results values ('sabotaged', 'the purge skips licence evidence', '', v_out);
end $$;

do $$
declare
  v_anon text; v_auth text; v_hb jsonb; v_ok text;
begin
  -- H. canary heartbeat (OQ-316). The runs table is append only; the prune switch lets this rolled-back proof clear it. -------
  perform set_config('tarragon.canary_prune', 'on', true);
  delete from public.chain_canary_runs;
  perform set_config('tarragon.canary_prune', 'off', true);
  perform pg_temp.act_service(); v_hb := public.canary_heartbeat(); perform pg_temp.back();
  perform pg_temp.rec('H1 no run yet: not ok, bucket never', 'false,never', (v_hb ->> 'ok') || ',' || (v_hb ->> 'age_bucket'));
  insert into public.chain_canary_runs (run_id, kind, at, config_version, passed) values (gen_random_uuid(), 'result', now() - interval '10 minutes', 1, true);
  perform pg_temp.act_service(); v_hb := public.canary_heartbeat(); perform pg_temp.back();
  perform pg_temp.rec('H2 a run 10 minutes ago: ok, bucket under_1h', 'true,under_1h', (v_hb ->> 'ok') || ',' || (v_hb ->> 'age_bucket'));
  perform pg_temp.rec('H3 the answer carries only ok and age_bucket', 'age_bucket,ok', (select string_agg(k, ',' order by k) from jsonb_object_keys(v_hb) k));
  perform set_config('tarragon.canary_prune', 'on', true); delete from public.chain_canary_runs; perform set_config('tarragon.canary_prune', 'off', true);
  insert into public.chain_canary_runs (run_id, kind, at, config_version, passed) values (gen_random_uuid(), 'result', now() - interval '3 hours', 1, true);
  perform pg_temp.act_service(); v_hb := public.canary_heartbeat(); perform pg_temp.back();
  perform pg_temp.rec('H4 a run 3 hours ago: not ok, bucket 3h_to_24h', 'false,3h_to_24h', (v_hb ->> 'ok') || ',' || (v_hb ->> 'age_bucket'));
  perform set_config('tarragon.canary_prune', 'on', true); delete from public.chain_canary_runs; perform set_config('tarragon.canary_prune', 'off', true);
  insert into public.chain_canary_runs (run_id, kind, at, config_version, passed) values (gen_random_uuid(), 'result', now() - interval '80 minutes', 1, true);
  perform pg_temp.act_service(); v_hb := public.canary_heartbeat(); perform pg_temp.back();
  perform pg_temp.rec('H5 80 minutes ago is still ok (the line is the 100 minutes the in-database incident uses)', 'true,1h_to_3h', (v_hb ->> 'ok') || ',' || (v_hb ->> 'age_bucket'));
  perform pg_temp.act_anon(); v_anon := pg_temp.try('select public.canary_heartbeat()'); perform pg_temp.back();
  perform pg_temp.act(pg_temp.f('admin')); v_auth := pg_temp.try('select public.canary_heartbeat()'); perform pg_temp.back();
  perform pg_temp.rec('H6 anon and signed-in users cannot call it', '42501,42501', v_anon || ',' || v_auth);
  -- sabotage: a heartbeat that ignores age
  v_ok := (select (replace(pg_get_functiondef('public.canary_heartbeat()'::regprocedure), 'v_age < make_interval(mins => v_stale)', 'true') <> pg_get_functiondef('public.canary_heartbeat()'::regprocedure))::text);
  if v_ok <> 'true' then raise exception 'VACUOUS TEST: heartbeat age test text not found'; end if;
  execute replace(pg_get_functiondef('public.canary_heartbeat()'::regprocedure), 'v_age < make_interval(mins => v_stale)', 'true');
  perform set_config('tarragon.canary_prune', 'on', true); delete from public.chain_canary_runs; perform set_config('tarragon.canary_prune', 'off', true);
  insert into public.chain_canary_runs (run_id, kind, at, config_version, passed) values (gen_random_uuid(), 'result', now() - interval '5 hours', 1, true);
  perform pg_temp.act_service(); v_hb := public.canary_heartbeat(); perform pg_temp.back();
  insert into results values ('sabotaged', 'a stale canary is not ok', 'false', v_hb ->> 'ok');
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'FU-notify proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 7 then
    raise exception 'VACUOUS TEST: only % of 7 sabotage steps changed the matching check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual,
       case when phase = 'sabotaged' then case when expected is distinct from actual then 'PASS (caught)' else 'FAIL' end
            when expected is not distinct from actual then 'PASS' else 'FAIL' end as result
from results order by phase desc, check_name;

rollback;
