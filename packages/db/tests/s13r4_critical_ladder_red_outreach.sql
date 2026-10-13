-- S13 R4 proof (migration *_s13r4_critical_ladder_and_red_outreach.sql; needs S12, S16, S18, S19 and the two-tier chain).
--
-- One rolled-back transaction. Proves:
--   A. Q10  A patient's critical ladder is push, email, in-app and never sms; a clinician's ladder is unchanged (control).
--           The in-app last hop finishes with the exhausted admin alert.
--   B.      A receipt error on a critical push fails the row; a second ticket still open, a delivered ticket, and a
--           routine row do not. Critical tickets are claimed for a receipt check from 2 minutes, routine ones not.
--   C. Q11  A Member red alert opens a watch and neutral notices; a Free one opens a skipped record and notifies no
--           clinician. Before the CMO confirms the task type nothing is created (said once). After: exactly one class 1
--           outreach task, one on-call alert, no duplicates on a repeat sweep, a second red merges into the same task.
--           Patient opening, patient acknowledging, or a clinician acknowledging closes it and cancels an unclaimed task.
--           A push receipt error pulls the call forward; the control with no error waits.
--   D. Q13  The answer is idempotent by client id, own events only, append only, readable by the patient only; the
--           on-call clinician (and CMO) can see it, an unpaged clinician cannot; it never acknowledges a page or stops the
--           paging ladder; "could not get care" brings the call forward and a later open does not cancel it; Free answers
--           are stored but never shown to a clinician.
--   E. OQ-94 A broadcast naming a condition is refused with the reason; a clean one is saved; the RPC is admin/service only.
--   F.      Test alert, grants and cron.
--   Sabotage: the patient filter removed, the Free gate stuck open, and a response that wrongly acknowledges the page.
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

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_p uuid; v_b uuid; v_other uuid;
  pat uuid; clin uuid; mem uuid; mem2 uuid; mem3 uuid; fre uuid; other_pat uuid;
  n1 uuid; n2 uuid; v_next text; v_hop text; r jsonb; t1 uuid; e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid;
  w1 uuid; w2 uuid; w3 uuid; w4 uuid; w5 uuid; v_task uuid; v_cnt text; v_rs uuid; v_te uuid; v_page uuid; v_ans uuid; v_ans2 uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_p := pg_temp.mkdoc(v_org, v_admin, 'primary', 'senior_medical_officer');
  v_b := pg_temp.mkdoc(v_org, v_admin, 'backup', 'senior_medical_officer');
  v_other := pg_temp.mkdoc(v_org, v_admin, 'other', 'senior_medical_officer');
  pat := pg_temp.mkuser(v_org, 'ladder-patient', 'patient');
  clin := v_other;
  mem := pg_temp.mkuser(v_org, 'member-1', 'patient'); mem2 := pg_temp.mkuser(v_org, 'member-2', 'patient'); mem3 := pg_temp.mkuser(v_org, 'member-3', 'patient');
  fre := pg_temp.mkuser(v_org, 'free-1', 'patient'); other_pat := pg_temp.mkuser(v_org, 'member-other', 'patient');
  insert into fx values ('admin', v_admin), ('cmo', v_cmo), ('primary', v_p), ('backup', v_b), ('other', v_other), ('mem', mem), ('mem2', mem2), ('mem3', mem3), ('free', fre), ('otherpat', other_pat);
  insert into public.patient_memberships (organisation_id, patient_id, source, state, granted_by, grant_reason, is_test)
  select v_org, x, 'granted', 'active', v_admin, 'R4 proof: a Member', true from unnest(array[mem, mem2, mem3, other_pat]) x;
  perform pg_temp.act(v_cmo);
  perform public.set_on_call_rota(now() - interval '1 minute', now() + interval '10 hours', v_p, v_b, null);
  perform pg_temp.back();

  -- A. Q10 ------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('A1 a patient default ladder is push,email,in_app', '{push,email,in_app}', private.patient_critical_channels(pat, array['push', 'email', 'sms']::public.notification_channel[])::text);
  perform pg_temp.rec('A2 a clinician ladder is returned unchanged', '{push,email,sms}', private.patient_critical_channels(clin, array['push', 'email', 'sms']::public.notification_channel[])::text);
  perform pg_temp.rec('A3 voice and a duplicate are dropped and in-app is last once', '{push,email,in_app}', private.patient_critical_channels(pat, array['voice', 'push', 'in_app', 'push', 'email']::public.notification_channel[])::text);
  -- end to end: a failed critical push walks the ladder hop by hop
  n1 := pg_temp.notif(v_org, pat, 'push', 'failed', 'critical');
  perform private.escalate_unconfirmed_critical_notifications();
  select channel::text into v_next from public.notifications where escalated_from_id = n1;
  perform pg_temp.rec('A4 patient hop 2 is email', 'email', v_next);
  select id into n2 from public.notifications where escalated_from_id = n1;
  update public.notifications set status = 'failed', failed_at = now() where id = n2;
  perform private.escalate_unconfirmed_critical_notifications();
  select channel::text into v_next from public.notifications where escalated_from_id = n2;
  perform pg_temp.rec('A5 patient hop 3 is in_app, not sms', 'in_app', v_next);
  perform pg_temp.rec('A6 no sms or voice row was ever queued for the patient chain', '0',
    (select count(*)::text from public.notifications where recipient_id = pat and channel in ('sms', 'voice')));
  select id into n1 from public.notifications where escalated_from_id = n2;
  update public.notifications set created_at = now() - interval '3 hours' where id = n1;
  perform private.escalate_unconfirmed_critical_notifications();
  perform pg_temp.rec('A7 the in-app last hop finishes with the exhausted record and an admin alert', '1,true',
    (select count(*)::text from public.notification_escalation_failures where notification_id = n1) || ',' ||
    exists (select 1 from public.notifications where template = 'critical_notification_escalation_exhausted' and recipient_id = v_admin and (payload ->> 'notification_id')::uuid = n1)::text);
  -- control: the clinician chain is the configured one, hop 3 is still sms
  n1 := pg_temp.notif(v_org, clin, 'push', 'failed', 'critical');
  perform private.escalate_unconfirmed_critical_notifications();
  select id into n2 from public.notifications where escalated_from_id = n1;
  update public.notifications set status = 'failed', failed_at = now() where id = n2;
  perform private.escalate_unconfirmed_critical_notifications();
  select channel::text into v_next from public.notifications where escalated_from_id = n2;
  perform pg_temp.rec('A8 CONTROL the clinician chain still reaches sms at hop 3', 'sms', v_next);
  -- the first hop also obeys it
  n1 := private.enqueue_critical_notification(v_org, pat, 'r4_proof', '{}', 'no_such_pathway', 'emergency', null, null);
  perform pg_temp.rec('A9 enqueue_critical_notification never starts a patient on sms', 'true', (select (channel <> 'sms')::text from public.notifications where id = n1));

  -- B. receipts -------------------------------------------------------------------------------------------------
  n1 := pg_temp.notif(v_org, pat, 'push', 'sent', 'critical');
  insert into public.notification_delivery_events (notification_id, organisation_id, event, provider, provider_ref) values (n1, v_org, 'receipt_pending', 'expo', 'r4-ref-1');
  perform public.record_notification_delivery_event(n1, 'failed', 'expo', 'r4-ref-1', '{"reason":"MessageRateExceeded"}');
  perform pg_temp.rec('B1 a receipt error fails a critical push row', 'failed', (select status::text from public.notifications where id = n1));
  n1 := pg_temp.notif(v_org, pat, 'push', 'sent', 'critical');
  insert into public.notification_delivery_events (notification_id, organisation_id, event, provider, provider_ref) values (n1, v_org, 'receipt_pending', 'expo', 'r4-ref-2'), (n1, v_org, 'receipt_pending', 'expo', 'r4-ref-3');
  perform public.record_notification_delivery_event(n1, 'token_dead', 'expo', 'r4-ref-2', '{}');
  perform pg_temp.rec('B2 a second ticket still open: the row is not failed yet', 'sent', (select status::text from public.notifications where id = n1));
  perform public.record_notification_delivery_event(n1, 'delivered', 'expo', 'r4-ref-3', '{}');
  perform pg_temp.rec('B3 one device delivered: the row stays sent', 'sent', (select status::text from public.notifications where id = n1));
  n1 := pg_temp.notif(v_org, pat, 'push', 'sent', 'routine');
  insert into public.notification_delivery_events (notification_id, organisation_id, event, provider, provider_ref) values (n1, v_org, 'receipt_pending', 'expo', 'r4-ref-4');
  perform public.record_notification_delivery_event(n1, 'failed', 'expo', 'r4-ref-4', '{}');
  perform pg_temp.rec('B4 a routine row is not failed by a receipt error', 'sent', (select status::text from public.notifications where id = n1));
  n1 := pg_temp.notif(v_org, pat, 'push', 'sent', 'critical');
  n2 := pg_temp.notif(v_org, pat, 'push', 'sent', 'routine');
  insert into public.notification_delivery_events (notification_id, organisation_id, event, provider, provider_ref, occurred_at)
  values (n1, v_org, 'receipt_pending', 'expo', 'r4-ref-5', now() - interval '3 minutes'), (n2, v_org, 'receipt_pending', 'expo', 'r4-ref-6', now() - interval '3 minutes');
  perform pg_temp.rec('B5 a 3 minute old critical ticket is claimed, a routine one is not', 'true,false',
    exists (select 1 from public.claim_expo_receipt_checks(500, 15, 24) c where c.provider_ref = 'r4-ref-5')::text || ',' ||
    exists (select 1 from public.claim_expo_receipt_checks(500, 15, 24) c where c.provider_ref = 'r4-ref-6')::text);

  -- C. the red timer --------------------------------------------------------------------------------------------
  e1 := pg_temp.ee(mem); w1 := pg_temp.watch(e1);
  perform pg_temp.rec('C1 a Member red alert opens a watching record due in about 30 minutes', 'watching,true',
    (select state || ',' || (due_at between now() + interval '29 minutes' and now() + interval '31 minutes')::text from public.red_alert_watch where id = w1));
  perform pg_temp.rec('C2 the Member is told on in-app and email, neutral, critical, never sms', 'email,in_app|critical|red_event_guidance_waiting',
    (select string_agg(channel::text, ',' order by channel::text) from public.notifications where source_id = w1) || '|' ||
    (select min(priority::text) from public.notifications where source_id = w1) || '|' || (select min(template) from public.notifications where source_id = w1));
  perform pg_temp.rec('C3 the email row carries only the patient address', 'true,1',
    (select (payload ? 'to_email')::text || ',' || (select count(*) from jsonb_object_keys(payload))::text from public.notifications where source_id = w1 and channel = 'email'));
  e2 := pg_temp.ee(fre); w2 := pg_temp.watch(e2);
  perform pg_temp.rec('C4 a Free red alert is recorded as skipped and tells nobody through this path', 'skipped_free,0',
    (select state from public.red_alert_watch where id = w2) || ',' || (select count(*)::text from public.notifications where source_id = w2));
  -- not yet due
  perform private.sweep_unconfirmed_red_alerts();
  perform pg_temp.rec('C5 before the time nothing is created', '0', (select count(*)::text from public.clinical_tasks where patient_id = mem and type = 'red_patient_outreach'));
  -- due but the CMO has not confirmed the task type
  update public.red_alert_watch set due_at = now() - interval '1 minute', opened_at = now() - interval '31 minutes' where id in (w1, w2);
  perform private.sweep_unconfirmed_red_alerts(); perform private.sweep_unconfirmed_red_alerts();
  perform pg_temp.rec('C6 an unconfirmed task type creates no task and says so once', '0,1',
    (select count(*)::text from public.clinical_tasks where patient_id = mem and type = 'red_patient_outreach') || ',' ||
    (select count(*)::text from public.audit_log where action = 'red_outreach.waiting_for_cmo' and entity_id = w1));
  -- the CMO confirms (what confirm_task_type does)
  perform pg_temp.act(v_cmo); perform public.confirm_task_type('red_patient_outreach', 'R4 proof'); perform pg_temp.back();
  perform private.sweep_unconfirmed_red_alerts();
  select count(*)::text into v_cnt from public.clinical_tasks where patient_id = mem and type = 'red_patient_outreach';
  select outreach_task_id into v_task from public.red_alert_watch where id = w1;
  perform pg_temp.rec('C7 after confirmation exactly one class 1 outreach task exists and the watch points at it', '1,1,outreach_created,true',
    v_cnt || ',' || (select priority_class::text from public.clinical_tasks where id = v_task) || ',' || (select state from public.red_alert_watch where id = w1) || ',' || (v_task is not null)::text);
  perform pg_temp.rec('C8 the on-call primary got one neutral critical alert on push, in-app and email', '3,red_event_outreach_task',
    (select count(*)::text from public.notifications where source_id = w1 and recipient_id = v_p) || ',' || (select min(template) from public.notifications where source_id = w1 and recipient_id = v_p));
  perform private.sweep_unconfirmed_red_alerts();
  perform pg_temp.rec('C9 a repeat sweep adds no task and no alert', '1,3',
    (select count(*)::text from public.clinical_tasks where patient_id = mem and type = 'red_patient_outreach') || ',' || (select count(*)::text from public.notifications where source_id = w1 and recipient_id = v_p));
  perform pg_temp.rec('C10 the Free alert created no task and no alert to any clinician', '0,0',
    (select count(*)::text from public.clinical_tasks where patient_id = fre) || ',' || (select count(*)::text from public.notifications where source_id = w2 and recipient_id <> fre));
  -- a second red for the same patient merges into the same open task
  e3 := pg_temp.ee(mem); w3 := pg_temp.watch(e3);
  update public.red_alert_watch set due_at = now() - interval '1 minute', opened_at = now() - interval '31 minutes' where id = w3;
  perform private.sweep_unconfirmed_red_alerts();
  perform pg_temp.rec('C11 a second red merges into the same task', 'true,1',
    (select (outreach_task_id = v_task)::text from public.red_alert_watch where id = w3) || ',' || (select count(*)::text from public.clinical_tasks where patient_id = mem and type = 'red_patient_outreach' and state not in ('completed', 'cancelled')));
  -- the patient opens the notice: confirmed, and the unclaimed task is cancelled
  update public.notifications set opened_at = now() where source_id = w1 and channel = 'in_app';
  perform private.sweep_unconfirmed_red_alerts();
  perform pg_temp.rec('C12 the patient opening the notice confirms that alert; the second alert still needs the call, so the shared task stays', 'confirmed,opened,open',
    (select state || ',' || confirmed_via from public.red_alert_watch where id = w1) || ',' || (select state::text from public.clinical_tasks where id = v_task));
  update public.notifications set opened_at = now() where source_id = w3 and channel = 'in_app';
  perform private.sweep_unconfirmed_red_alerts();
  perform pg_temp.rec('C12b once every alert is confirmed the unclaimed task is cancelled', 'cancelled', (select state::text from public.clinical_tasks where id = v_task));
  -- the patient acknowledges the guidance before the time
  e4 := pg_temp.ee(mem2); w4 := pg_temp.watch(e4);
  update public.emergency_events set acknowledged_at = now(), acknowledged_by = mem2 where id = e4;
  update public.red_alert_watch set due_at = now() - interval '1 minute' where id = w4;
  perform private.sweep_unconfirmed_red_alerts();
  perform pg_temp.rec('C13 the patient acknowledging the guidance confirms it and no task is made', 'confirmed,acknowledged_guidance,0',
    (select state || ',' || confirmed_via from public.red_alert_watch where id = w4) || ',' || (select count(*)::text from public.clinical_tasks where patient_id = mem2));
  -- a clinician acknowledges the alert after the task exists
  e5 := pg_temp.ee(mem3); w5 := pg_temp.watch(e5);
  update public.red_alert_watch set due_at = now() - interval '1 minute', opened_at = now() - interval '31 minutes' where id = w5;
  perform private.sweep_unconfirmed_red_alerts();
  select outreach_task_id into v_task from public.red_alert_watch where id = w5;
  update public.clinician_alerts set status = 'acknowledged' where id = (select clinician_alert_id from public.emergency_events where id = e5);
  perform private.sweep_unconfirmed_red_alerts();
  perform pg_temp.rec('C14 a clinician acknowledgement closes the watch and cancels the unclaimed task', 'clinician_acknowledged,cancelled',
    (select state from public.red_alert_watch where id = w5) || ',' || (select state::text from public.clinical_tasks where id = v_task));
  -- push receipt error pulls the call forward; control without an error waits
  declare pr uuid := pg_temp.mkuser(v_org, 'push-error', 'patient'); pc uuid := pg_temp.mkuser(v_org, 'push-ok', 'patient'); ee1 uuid; ee2 uuid; ww1 uuid; ww2 uuid; pn uuid;
  begin
    insert into public.patient_memberships (organisation_id, patient_id, source, state, granted_by, grant_reason, is_test)
    select v_org, x, 'granted', 'active', v_admin, 'R4 proof: a Member', true from unnest(array[pr, pc]) x;
    insert into public.push_subscriptions (organisation_id, profile_id, platform, expo_push_token) values (v_org, pr, 'android', 'ExponentPushToken[r4-err]'), (v_org, pc, 'android', 'ExponentPushToken[r4-ok]');
    ee1 := pg_temp.ee(pr); ee2 := pg_temp.ee(pc); ww1 := pg_temp.watch(ee1); ww2 := pg_temp.watch(ee2);
    update public.notifications set status = 'failed', failed_at = now() - interval '6 minutes' where source_id = ww1 and channel = 'push';
    update public.notifications set status = 'sent', sent_at = now() - interval '6 minutes' where source_id = ww2 and channel = 'push';
    update public.red_alert_watch set opened_at = now() - interval '10 minutes' where id in (ww1, ww2);
    perform private.sweep_unconfirmed_red_alerts();
    perform pg_temp.rec('C15 a push receipt error pulls the call forward (10 minutes in, not 30); the control waits', 'outreach_created,watching',
      (select state from public.red_alert_watch where id = ww1) || ',' || (select state from public.red_alert_watch where id = ww2));
  end;

  -- D. Q13 ------------------------------------------------------------------------------------------------------
  declare dm uuid := pg_temp.mkuser(v_org, 'answer-member', 'patient'); df uuid := pg_temp.mkuser(v_org, 'answer-free', 'patient'); te uuid; pg uuid; ede uuid; edf uuid; rid uuid;
  begin
    insert into public.patient_memberships (organisation_id, patient_id, source, state, granted_by, grant_reason, is_test)
    values (v_org, dm, 'granted', 'active', v_admin, 'R4 proof: a Member', true);
    insert into public.triage_rule_sets (code, version, status, rules, approved_by, approved_at, note)
      values ('r4test', 1, 'approved', '{"code":"r4test","version":1}'::jsonb, v_cmo, now(), 'R4 proof fixture') returning id into v_rs;
    insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, is_test, basis)
    values (v_org, dm, 'observation', gen_random_uuid(), 'red', 'R1', v_rs, 'r4test', 1, 'approved', '[{"kind":"page_on_call"}]'::jsonb, false, true, gen_random_uuid()::text)
    returning id into te;
    pg := public.create_red_page(te);
    insert into fx values ('page', pg), ('te', te), ('dm', dm), ('df', df);
    perform pg_temp.rec('D0 the triage red opened a watch too', '1', (select count(*)::text from public.red_alert_watch where source_kind = 'triage_event' and source_id = te));
    -- answers
    perform pg_temp.act(dm);
    v_ans := public.record_red_care_response('11111111-1111-4111-8111-111111111111', 'could_not_get_care', null, te, now());
    v_ans2 := public.record_red_care_response('11111111-1111-4111-8111-111111111111', 'could_not_get_care', null, te, now());
    perform pg_temp.rec('D1 the same client id returns the same row and stores one', 'true,1', (v_ans = v_ans2)::text || ',' || (select count(*)::text from public.red_care_responses where client_id = '11111111-1111-4111-8111-111111111111'));
    perform pg_temp.rec('D2 the patient reads their own answer', '1', (select count(*)::text from public.red_care_responses));
    perform pg_temp.rec('D3 a patient cannot answer for someone else''s event', '42501', pg_temp.try(format('select public.record_red_care_response(gen_random_uuid(), %L, %L, null)', 'sought_care', e1)));
    perform pg_temp.rec('D4 a bad answer is refused', '22023', pg_temp.try(format('select public.record_red_care_response(gen_random_uuid(), %L, null, %L)', 'maybe', te)));
    perform pg_temp.rec('D5 naming both events is refused', '22023', pg_temp.try(format('select public.record_red_care_response(gen_random_uuid(), %L, %L, %L)', 'sought_care', e1, te)));
    perform pg_temp.back();
    perform pg_temp.rec('D6 an answer cannot be edited (append only)', '42501', pg_temp.try('update public.red_care_responses set response = ''sought_care'''));
    perform pg_temp.act(other_pat);
    perform pg_temp.rec('D7 another patient reads none', '0', (select count(*)::text from public.red_care_responses));
    perform pg_temp.rec('D4b an answer when there is no red alert yet is retryable, not rejected', 'P0002', pg_temp.try(format('select public.record_red_care_response(gen_random_uuid(), %L, null, null)', 'sought_care')));
    perform pg_temp.back();
    perform pg_temp.act_anon();
    perform pg_temp.rec('D8 anon cannot read or answer', '42501,42501', pg_temp.try('select count(*) from public.red_care_responses') || ',' || pg_temp.try('select public.record_red_care_response(gen_random_uuid(), ''sought_care'', null, null)'));
    perform pg_temp.back();
    -- the clinician side
    perform pg_temp.act(v_p);
    perform pg_temp.rec('D9 the paged primary sees the answer and no patient identity', 'could_not_get_care,false',
      (public.latest_red_patient_response(pg, null) ->> 'response') || ',' || (public.latest_red_patient_response(pg, null) ? 'patient_id')::text);
    perform pg_temp.back();
    perform pg_temp.act(v_other);
    perform pg_temp.rec('D10 a clinician who was not paged is refused', '42501', pg_temp.try(format('select public.latest_red_patient_response(%L, null)', pg)));
    perform pg_temp.back();
    perform pg_temp.act(v_cmo);
    perform pg_temp.rec('D11 the CMO sees it', 'could_not_get_care', public.latest_red_patient_response(pg, null) ->> 'response');
    perform pg_temp.back();
    -- never stops paging
    perform pg_temp.rec('D12 the answer did not acknowledge or close the page', 'true,true',
      (select (acknowledged_at is null)::text || ',' || (closed_at is null)::text from public.pages where id = pg));
  end;

  -- the ladder: age the page by moving the guard flag the way the sweep proof does, then sweep and see it still escalates
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set sent_at = now() - interval '6 minutes' where id = pg_temp.f('page');
  perform set_config('tarragon.paging_write', 'off', true);
  perform private.sweep_pages();
  perform pg_temp.rec('D14 after the answer the backup is still paged at 5 minutes (the ladder runs)', '1',
    (select count(*)::text from public.pages where parent_page_id = pg_temp.f('page') and role = 'backup'));
  perform pg_temp.rec('D15 "could not get care" brought the call forward', 'outreach_created',
    (select state from public.red_alert_watch where source_kind = 'triage_event' and source_id = pg_temp.f('te')));
  -- an open notice afterwards must not cancel it
  update public.notifications set opened_at = now() where source_table = 'red_alert_watch' and source_id = (select id from public.red_alert_watch where source_kind = 'triage_event' and source_id = pg_temp.f('te'));
  perform private.sweep_unconfirmed_red_alerts();
  perform pg_temp.rec('D16 a later open does not cancel the call a "could not get care" brought forward', 'outreach_created',
    (select state from public.red_alert_watch where source_kind = 'triage_event' and source_id = pg_temp.f('te')));
  -- only a clinician acknowledgement stops it
  perform pg_temp.act(v_p);
  perform public.acknowledge_page(pg_temp.f('page'));
  perform pg_temp.back();
  perform private.sweep_unconfirmed_red_alerts();
  perform pg_temp.rec('D17 a clinician acknowledging the page stops it', 'clinician_acknowledged',
    (select state from public.red_alert_watch where source_kind = 'triage_event' and source_id = pg_temp.f('te')));
  -- Free: stored, never shown
  declare df uuid := pg_temp.f('df'); edf uuid; rid uuid;
  begin
    edf := pg_temp.ee(df);
    perform pg_temp.act(df);
    rid := public.record_red_care_response('22222222-2222-4222-8222-222222222222', 'could_not_get_care', null, null, null);
    perform pg_temp.back();
    perform pg_temp.rec('D18 a Free answer is stored but not shown to clinicians, and creates no task', 'false,0',
      (select shown_to_clinician::text from public.red_care_responses where id = rid) || ',' || (select count(*)::text from public.clinical_tasks where patient_id = df));
    perform pg_temp.rec('D19 an answer with no event id is linked to the latest alert of the day', edf::text,
      (select emergency_event_id::text from public.red_care_responses where id = rid));
  end;

  -- E. OQ-94 ----------------------------------------------------------------------------------------------------
  perform pg_temp.rec('E1 a broadcast naming a condition is refused', '22023',
    pg_temp.try(format('insert into public.notification_broadcasts (created_by, title, body, audience, channels) values (%L, %L, %L, ''all_patients'', array[''in_app'']::public.notification_channel[])', v_admin, 'Check day', 'Free blood pressure checks this Saturday')));
  perform pg_temp.rec('E2 a clean broadcast is saved', 'ok',
    pg_temp.try(format('insert into public.notification_broadcasts (created_by, title, body, audience, channels) values (%L, %L, %L, ''all_patients'', array[''in_app'']::public.notification_channel[])', v_admin, 'A new feature', 'Open the app to see what is new this week.')));
  perform pg_temp.rec('E3 the refusal text names the matched term', 'true',
    (pg_temp.try_msg(format('insert into public.notification_broadcasts (created_by, title, body, audience, channels) values (%L, %L, %L, ''all_patients'', array[''in_app'']::public.notification_channel[])', v_admin, 'Hello', 'Your sugar level')) like '%sugar%')::text);
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('E4 an admin can check text and gets the matches', 'true', (array_length(public.check_notification_text('diabetes and 120/80'), 1) >= 2)::text);
  perform pg_temp.back();
  perform pg_temp.act(pat);
  perform pg_temp.rec('E5 a patient cannot call the checker', '42501', pg_temp.try('select public.check_notification_text(''x'')'));
  perform pg_temp.back();

  -- F. test alert, grants, cron ----------------------------------------------------------------------------------
  perform pg_temp.act(pat);
  n1 := null; v_cnt := public.send_my_test_alert()::text;
  perform pg_temp.rec('F1 a test alert queues an in-app notice for the caller, critical, test_alert', '1,critical',
    v_cnt || ',' || (select min(priority::text) from public.notifications where recipient_id = pat and template = 'test_alert'));
  perform public.send_my_test_alert(); perform public.send_my_test_alert(); perform public.send_my_test_alert(); perform public.send_my_test_alert(); perform public.send_my_test_alert();
  perform pg_temp.rec('F2 the seventh test alert in a day is refused', '22023', pg_temp.try('select public.send_my_test_alert()'));
  perform pg_temp.back();
  perform pg_temp.rec('F3 a test alert is not laddered', '0',
    (select count(*)::text from public.notifications where recipient_id = pat and template = 'test_alert' and escalated_from_id is not null));
  perform pg_temp.rec('F4 authenticated can only select the two new tables; anon holds nothing', '0,0',
    (select count(*)::text from information_schema.role_table_grants where table_schema = 'public' and table_name in ('red_alert_watch', 'red_care_responses') and grantee = 'authenticated' and privilege_type <> 'SELECT') || ',' ||
    (select count(*)::text from information_schema.role_table_grants where table_schema = 'public' and table_name in ('red_alert_watch', 'red_care_responses') and grantee in ('anon', 'PUBLIC')));
  perform pg_temp.rec('F5 anon cannot run any new function', 'false,false,false,false,false',
    has_function_privilege('anon', 'public.record_red_care_response(uuid,text,uuid,uuid,timestamptz)', 'EXECUTE')::text || ',' ||
    has_function_privilege('anon', 'public.latest_red_patient_response(uuid,uuid)', 'EXECUTE')::text || ',' ||
    has_function_privilege('anon', 'public.check_notification_text(text)', 'EXECUTE')::text || ',' ||
    has_function_privilege('anon', 'public.send_my_test_alert()', 'EXECUTE')::text || ',' ||
    has_function_privilege('anon', 'private.sweep_unconfirmed_red_alerts()', 'EXECUTE')::text);
  perform pg_temp.rec('F6 the sweep is scheduled once, off the minute marks', '1,4-59/5 * * * *',
    (select count(*)::text from cron.job where jobname = 'sweep-unconfirmed-red-alerts') || ',' || (select schedule from cron.job where jobname = 'sweep-unconfirmed-red-alerts'));
  perform pg_temp.rec('F7 the active rules row carries the 30 minute value', '30,5',
    private.red_rule('unconfirmedMinutes') || ',' || private.red_rule('undeliveredMinutes'));
  perform pg_temp.rec('F8 both new tables are in the data registry and the dependant policy', '2,2',
    (select count(*)::text from public.data_registry where table_name in ('red_alert_watch', 'red_care_responses')) || ',' || (select count(*)::text from public.minor_dependant_table_policy where table_name in ('red_alert_watch', 'red_care_responses')));
end $$;

-- ===================================== second pass (review findings) =====================================
do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_other uuid;
  gA uuid; gC uuid; gD uuid; gE uuid; gF uuid;
  eA uuid; eB uuid; e1 uuid; e2 uuid; eD uuid; eE uuid; eF uuid;
  wB uuid; w1 uuid; w2 uuid; wD uuid; wF uuid; t1 uuid; v_task uuid; v_def text; v_n integer; v_state text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.f('admin'); v_cmo := pg_temp.f('cmo'); v_other := pg_temp.f('other');
  gA := pg_temp.mkuser(v_org, 'g-a', 'patient'); gC := pg_temp.mkuser(v_org, 'g-c', 'patient'); gD := pg_temp.mkuser(v_org, 'g-d', 'patient');
  gE := pg_temp.mkuser(v_org, 'g-e', 'patient'); gF := pg_temp.mkuser(v_org, 'g-f', 'patient');
  insert into public.patient_memberships (organisation_id, patient_id, source, state, granted_by, grant_reason, is_test)
  select v_org, x, 'granted', 'active', v_admin, 'R4 proof: a Member', true from unnest(array[gA, gC, gD, gE, gF]) x;
  insert into public.push_subscriptions (organisation_id, profile_id, platform, expo_push_token) values (v_org, gD, 'android', 'ExponentPushToken[r4-gd]');

  -- G1 an answer to an EARLIER alert does not confirm a LATER one
  eA := pg_temp.ee(gA);
  perform pg_temp.act(gA);
  perform public.record_red_care_response(gen_random_uuid(), 'sought_care', eA, null, null);
  perform pg_temp.back();
  eB := pg_temp.ee(gA); wB := pg_temp.watch(eB);
  update public.red_alert_watch set opened_at = now() + interval '1 minute', due_at = now() - interval '1 second' where id = wB;
  perform private.sweep_unconfirmed_red_alerts();
  perform pg_temp.rec('G1 an earlier alert''s "sought care" does not confirm a later alert; its call is created', 'outreach_created',
    (select state from public.red_alert_watch where id = wB));

  -- G2 two alerts share one task: confirming one leaves the task for the other
  e1 := pg_temp.ee(gC); e2 := pg_temp.ee(gC); w1 := pg_temp.watch(e1); w2 := pg_temp.watch(e2);
  update public.red_alert_watch set due_at = now() - interval '1 minute', opened_at = now() - interval '31 minutes' where id in (w1, w2);
  perform private.sweep_unconfirmed_red_alerts();
  select outreach_task_id into v_task from public.red_alert_watch where id = w1;
  perform pg_temp.rec('G2a both alerts point at the same one task', 'true,1',
    (select (outreach_task_id = v_task)::text from public.red_alert_watch where id = w2) || ',' || (select count(*)::text from public.clinical_tasks where patient_id = gC and type = 'red_patient_outreach'));
  update public.notifications set opened_at = now() where source_id = w1 and channel = 'in_app';
  perform private.sweep_unconfirmed_red_alerts();
  perform pg_temp.rec('G2b one alert confirmed: the other still needs the call, so the task stays', 'confirmed,outreach_created,true',
    (select state from public.red_alert_watch where id = w1) || ',' || (select state from public.red_alert_watch where id = w2) || ',' ||
    (select (state not in ('cancelled', 'completed'))::text from public.clinical_tasks where id = v_task));
  update public.notifications set opened_at = now() where source_id = w2 and channel = 'in_app';
  perform private.sweep_unconfirmed_red_alerts();
  perform pg_temp.rec('G2c both confirmed: the task is cancelled', 'cancelled', (select state::text from public.clinical_tasks where id = v_task));

  -- G3 a late delivered push receipt never cancels a call that was already created
  eD := pg_temp.ee(gD); wD := pg_temp.watch(eD);
  update public.red_alert_watch set due_at = now() - interval '1 minute', opened_at = now() - interval '31 minutes' where id = wD;
  update public.notifications set status = 'sent', sent_at = now() - interval '30 minutes' where source_id = wD and channel = 'push';
  perform private.sweep_unconfirmed_red_alerts();
  select outreach_task_id into v_task from public.red_alert_watch where id = wD;
  update public.notifications set delivered_at = now() where source_id = wD and channel = 'push';
  perform private.sweep_unconfirmed_red_alerts();
  perform pg_temp.rec('G3 a delivered receipt after the call exists leaves the call standing', 'outreach_created,true',
    (select state from public.red_alert_watch where id = wD) || ',' || (select (state not in ('cancelled', 'completed'))::text from public.clinical_tasks where id = v_task));

  -- G4 telling the patient failing must not undo the watch
  v_def := pg_get_functiondef('private.red_patient_notify(public.red_alert_watch)'::regprocedure);
  execute 'create or replace function private.red_patient_notify(p_watch public.red_alert_watch) returns void language plpgsql as $f$ begin raise exception ''boom''; end $f$';
  eE := pg_temp.ee(gE);
  perform pg_temp.rec('G4 the notice failed but the watch exists and the failure is recorded', '1,1',
    (select count(*)::text from public.red_alert_watch where source_id = eE) || ',' || (select count(*)::text from public.audit_log where action = 'red_watch.notify_error' and event ->> 'error' = 'boom'));
  execute v_def;

  -- G5 an unconfirmed task type is loud, not silent
  update public.task_types set confirmed_at = null, confirmed_by = null where code = 'red_patient_outreach';
  eF := pg_temp.ee(gF); wF := pg_temp.watch(eF);
  update public.red_alert_watch set due_at = now() - interval '1 minute', opened_at = now() - interval '31 minutes' where id = wF;
  perform private.sweep_unconfirmed_red_alerts();
  perform pg_temp.rec('G5 no task, a sev1 incident for ops, and the watch still watching', '0,1,watching',
    (select count(*)::text from public.clinical_tasks where patient_id = gF) || ',' ||
    (select count(*)::text from public.ops_incidents where external_reference = 'red_outreach_task_type_unconfirmed' and status not in ('resolved', 'closed')) || ',' ||
    (select state from public.red_alert_watch where id = wF));
  update public.task_types set confirmed_at = now(), confirmed_by = v_cmo where code = 'red_patient_outreach';

  -- G6 a staff test alert is not laddered into email and sms
  perform pg_temp.act(v_other);
  perform public.send_my_test_alert();
  perform pg_temp.back();
  update public.notifications set status = 'sent', sent_at = now() - interval '3 hours' where recipient_id = v_other and template = 'test_alert';
  perform private.escalate_unconfirmed_critical_notifications();
  perform pg_temp.rec('G6 a clinician''s unopened test alert is not escalated', '0',
    (select count(*)::text from public.notifications where escalated_from_id in (select id from public.notifications where recipient_id = v_other and template = 'test_alert')));

  -- G7 an admin cannot read the answers row by row
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('G7 an admin reads no red answers', '0', (select count(*)::text from public.red_care_responses));
  perform pg_temp.back();
  -- G8 the response reader is limited to red task types
  t1 := private.create_clinical_task(gA, 'symptom_review', null, 'r4-g8', null, null, null, '{}');
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('G8 the CMO cannot read a patient answer through a task that is not a red alert task', '42501',
    pg_temp.try(format('select public.latest_red_patient_response(null, %L)', t1)));
  perform pg_temp.back();
end $$;

-- ===================================== sabotage =====================================
do $$
declare
  v_org uuid; pat uuid; n1 uuid; n2 uuid; v_next text; v_orig text; v_d text; mem uuid; free2 uuid; e uuid; w uuid; v_task_count integer; pg uuid; te uuid; v_rs uuid; dm uuid; v_cmo uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  pat := pg_temp.mkuser(v_org, 'sab-patient', 'patient');
  -- 1. the patient filter removed: hop 3 for a patient must wrongly be sms
  v_orig := pg_get_functiondef('private.patient_critical_channels(uuid,public.notification_channel[])'::regprocedure);
  execute 'create or replace function private.patient_critical_channels(p_recipient uuid, p_channels public.notification_channel[]) returns public.notification_channel[] language sql as $f$ select p_channels $f$';
  n1 := pg_temp.notif(v_org, pat, 'push', 'failed', 'critical');
  perform private.escalate_unconfirmed_critical_notifications();
  select id into n2 from public.notifications where escalated_from_id = n1;
  update public.notifications set status = 'failed', failed_at = now() where id = n2;
  perform private.escalate_unconfirmed_critical_notifications();
  select channel::text into v_next from public.notifications where escalated_from_id = n2;
  insert into results values ('sabotaged', 'a patient hop 3 is in_app', 'in_app', v_next);
  execute v_orig;

  -- 2. the Free gate stuck open: a Free red alert must then wrongly open a watching record
  free2 := pg_temp.mkuser(v_org, 'sab-free', 'patient');
  v_d := pg_get_functiondef('private.patient_may_page_doctor(uuid)'::regprocedure);
  execute 'create or replace function private.patient_may_page_doctor(p_patient uuid) returns boolean language sql as $f$ select true $f$';
  e := pg_temp.ee(free2);
  insert into results values ('sabotaged', 'a Free red alert is skipped', 'skipped_free', (select state from public.red_alert_watch where source_id = e));
  execute v_d;

  -- 3. a response that wrongly acknowledges the page
  dm := pg_temp.mkuser(v_org, 'sab-member', 'patient');
  insert into public.patient_memberships (organisation_id, patient_id, source, state, granted_by, grant_reason, is_test)
    select v_org, dm, 'granted', 'active', pg_temp.f('admin'), 'R4 proof: a Member', true;
  select id into v_rs from public.triage_rule_sets where code = 'r4test';
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, is_test, basis)
  values (v_org, dm, 'observation', gen_random_uuid(), 'red', 'R1', v_rs, 'r4test', 1, 'approved', '[{"kind":"page_on_call"}]'::jsonb, false, true, gen_random_uuid()::text)
  returning id into te;
  pg := public.create_red_page(te);
  create function pg_temp.bad_ack() returns trigger language plpgsql as
    $f$ begin perform set_config('tarragon.paging_write', 'on', true); update public.pages set acknowledged_at = now(), acknowledged_by = (select id from fx where label = 'primary') where id = (select id from public.pages where triage_event_id = new.triage_event_id and parent_page_id is null); return null; end $f$;
  create trigger sab_bad_ack after insert on public.red_care_responses for each row execute function pg_temp.bad_ack();
  perform pg_temp.act(dm);
  perform public.record_red_care_response('33333333-3333-4333-8333-333333333333', 'sought_care', null, te, null);
  perform pg_temp.back();
  insert into results values ('sabotaged', 'an answer leaves the page unacknowledged', 'true', (select (acknowledged_at is null)::text from public.pages where id = pg));
  drop trigger sab_bad_ack on public.red_care_responses;
end $$;

-- 4. the shared-task guard removed: confirming one alert must then wrongly cancel the call the other still needs
do $$
declare
  v_org uuid; gs uuid; e1 uuid; e2 uuid; w1 uuid; w2 uuid; v_task uuid; v_def text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  gs := pg_temp.mkuser(v_org, 'sab-shared', 'patient');
  insert into public.patient_memberships (organisation_id, patient_id, source, state, granted_by, grant_reason, is_test)
    values (v_org, gs, 'granted', 'active', pg_temp.f('admin'), 'R4 proof: a Member', true);
  v_def := pg_get_functiondef('private.red_outreach_cancel_if_unclaimed(public.red_alert_watch,text)'::regprocedure);
  if replace(v_def, 'o.state = ''outreach_created'')', 'false)') = v_def then raise exception 'VACUOUS TEST: shared-task guard text not found'; end if;
  execute replace(v_def, 'o.state = ''outreach_created'')', 'false)');
  e1 := pg_temp.ee(gs); e2 := pg_temp.ee(gs); w1 := pg_temp.watch(e1); w2 := pg_temp.watch(e2);
  update public.red_alert_watch set due_at = now() - interval '1 minute', opened_at = now() - interval '31 minutes' where id in (w1, w2);
  perform private.sweep_unconfirmed_red_alerts();
  select outreach_task_id into v_task from public.red_alert_watch where id = w1;
  update public.notifications set opened_at = now() where source_id = w1 and channel = 'in_app';
  perform private.sweep_unconfirmed_red_alerts();
  insert into results values ('sabotaged', 'one confirmed alert leaves the task for the other', 'true', (select (state not in ('cancelled', 'completed'))::text from public.clinical_tasks where id = v_task));
  execute v_def;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S13 R4 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then
    raise exception 'VACUOUS TEST: only % of 4 sabotage steps changed the matching check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
