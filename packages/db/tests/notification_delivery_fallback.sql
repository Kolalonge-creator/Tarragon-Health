-- Tarragon Health — notification delivery-state + forced-channel fallback verification
--
-- Covers the six migrations that shipped 2026-07-30 (part 1/6-6/6, plus the
-- base-grants fix) with no SQL test in the worktree at merge time — this
-- closes that gap after the fact, matching this codebase's convention of a
-- rolled-back-transaction proof for every migration that touches RLS,
-- security-definer logic, or a clinical-safety pathway.
--
-- Proves: (1) escalation_channel_sequence resolves a real live pathway/tier
-- and fails loud on an unknown one; (2) normalize_escalation_channels maps
-- every real config token shape seen in escalation_slas (plain channel,
-- "_nudge" variant, "push, batched" digest form, and a non-channel mechanism
-- like next_of_kin_call_if_unacknowledged) to the right notification_channel
-- or drops it; (3) enqueue_critical_notification opens hop 1 correctly;
-- (4) the escalation engine's five real behaviours — opened rows never
-- escalate, a definitively-failed row escalates immediately with no wait, a
-- sent-but-unconfirmed row waits out its share of the SLA window before
-- advancing, an exhausted chain is recorded in
-- notification_escalation_failures + fans out one in_app row per admin, and
-- a second run of the same tick is idempotent (on conflict do nothing);
-- (5) the push-first channel remap (push subscription beats whatsapp, an
-- explicit voice preference beats push); (6) push_subscriptions RLS isolates
-- one patient's device registration from another's; (7) touch_last_active()
-- only ever touches the caller's own row.
--
-- Run inside a transaction that is always rolled back — nothing here should
-- ever be committed.

begin;

-- ---------------------------------------------------------------------------
-- Part 1: escalation_channel_sequence resolves a real config entry and fails
-- loud on an unknown (pathway, tier) — same discipline as
-- escalation_sla_minutes, now doing double duty as channel-routing config.
-- ---------------------------------------------------------------------------
do $$
declare
  v_seq text[];
begin
  v_seq := private.escalation_channel_sequence('screening_abnormal_result', 'emergency');
  if v_seq <> array['push', 'whatsapp', 'sms'] then
    raise exception 'FAIL: screening_abnormal_result/emergency channel_sequence = % (expected push,whatsapp,sms)', v_seq;
  end if;
  raise notice 'PASS 1a: escalation_channel_sequence resolves the live screening_abnormal_result/emergency ladder';

  begin
    perform private.escalation_channel_sequence('nonexistent_pathway', 'routine');
    raise exception 'FAIL: escalation_channel_sequence should have raised for an unknown pathway';
  exception
    when others then
      if sqlerrm not like 'No active escalation SLA configured%' then
        raise exception 'FAIL: wrong error for unknown pathway: %', sqlerrm;
      end if;
      raise notice 'PASS 1b: unknown (pathway, tier) fails loud, not silent null';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Part 2: normalize_escalation_channels maps every real token shape correctly.
-- ---------------------------------------------------------------------------
do $$
declare
  v_out public.notification_channel[];
begin
  v_out := private.normalize_escalation_channels(array['push', 'whatsapp', 'sms']);
  if v_out <> array['push', 'whatsapp', 'sms']::public.notification_channel[] then
    raise exception 'FAIL: plain channel tokens did not pass through unchanged: %', v_out;
  end if;

  v_out := private.normalize_escalation_channels(array['push', 'whatsapp_nudge']);
  if v_out <> array['push', 'whatsapp']::public.notification_channel[] then
    raise exception 'FAIL: whatsapp_nudge did not normalize to whatsapp: %', v_out;
  end if;

  v_out := private.normalize_escalation_channels(array['push, batched']);
  if v_out <> array['push']::public.notification_channel[] then
    raise exception 'FAIL: "push, batched" did not normalize to push: %', v_out;
  end if;

  v_out := private.normalize_escalation_channels(array['push, batched digest']);
  if v_out <> array['push']::public.notification_channel[] then
    raise exception 'FAIL: "push, batched digest" did not normalize to push: %', v_out;
  end if;

  -- next_of_kin_call_if_unacknowledged is a distinct mechanism (a real phone
  -- call driven by private.notify_unacknowledged_emergencies), not a
  -- notification_channel value — must be dropped, not mis-mapped.
  v_out := private.normalize_escalation_channels(array['push', 'whatsapp', 'sms', 'next_of_kin_call_if_unacknowledged']);
  if v_out <> array['push', 'whatsapp', 'sms']::public.notification_channel[] then
    raise exception 'FAIL: next_of_kin_call_if_unacknowledged was not dropped: %', v_out;
  end if;

  raise notice 'PASS 2: normalize_escalation_channels handles plain/nudge/batched/digest/non-channel tokens correctly';
end $$;

-- ---------------------------------------------------------------------------
-- Part 3-5: the engine end to end, against real fixture profiles + orgs.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  v_recipient uuid;
  v_other_patient uuid;
  v_recipient_profile uuid := gen_random_uuid();
  v_other_patient_profile uuid := gen_random_uuid();
  v_admin uuid;
  v_hop1_opened uuid;
  v_hop1_failed uuid;
  v_hop1_recent uuid;
  v_hop1_stale uuid;
  v_hop2_id uuid;
  v_hop3_id uuid;
  v_row record;
  v_admin_count_before int;
  v_admin_count_after int;
  v_fail_count int;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_admin from public.profiles where organisation_id = v_org and role = 'admin' limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_recipient_profile, 'notif-fallback-test-recipient@example.invalid', 'x', now(), '{}', '{}'),
    (v_other_patient_profile, 'notif-fallback-test-other@example.invalid', 'x', now(), '{}', '{}');

  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Notif Fallback Test Recipient'
    where id = v_recipient_profile;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Notif Fallback Test Other Patient'
    where id = v_other_patient_profile;
  v_recipient := v_recipient_profile;
  v_other_patient := v_other_patient_profile;

  -- ---- Part 3: enqueue_critical_notification opens hop 1 correctly. ----
  select public.enqueue_critical_notification(
    v_org, v_recipient, 'test_critical_template', '{}'::jsonb,
    'screening_abnormal_result', 'emergency', 'clinician_alerts', gen_random_uuid()
  ) into v_hop1_opened;

  select * into v_row from public.notifications where id = v_hop1_opened;
  if v_row.channel <> 'push' or v_row.priority <> 'critical' or v_row.escalation_hop <> 1
     or v_row.escalation_pathway <> 'screening_abnormal_result' or v_row.escalation_alert_tier <> 'emergency' then
    raise exception 'FAIL: enqueue_critical_notification did not open a correct hop-1 row: %', v_row;
  end if;
  raise notice 'PASS 3: enqueue_critical_notification opens hop 1 on channel_sequence[1] (push) with priority=critical';

  -- ---- Part 4a: an opened row is never escalated, regardless of status/age. ----
  update public.notifications set status = 'sent', sent_at = now() - interval '1 day', opened_at = now() - interval '12 hours'
    where id = v_hop1_opened;
  perform private.escalate_unconfirmed_critical_notifications();
  if exists (select 1 from public.notifications where escalated_from_id = v_hop1_opened) then
    raise exception 'FAIL: an opened critical notification was escalated anyway';
  end if;
  raise notice 'PASS 4a: an opened critical notification is never escalated';

  -- ---- Part 4b: a definitively-failed row escalates immediately, no wait. ----
  insert into public.notifications
    (organisation_id, recipient_id, channel, template, payload, priority, status, sent_at,
     escalation_pathway, escalation_alert_tier, escalation_hop)
  values
    (v_org, v_recipient, 'push', 'test_critical_template', '{}'::jsonb, 'critical', 'failed', now(),
     'screening_abnormal_result', 'emergency', 1)
  returning id into v_hop1_failed;

  perform private.escalate_unconfirmed_critical_notifications();
  select id, channel, escalation_hop into v_hop2_id, v_row.channel, v_row.escalation_hop
    from public.notifications where escalated_from_id = v_hop1_failed;
  if v_hop2_id is null or v_row.channel <> 'whatsapp' or v_row.escalation_hop <> 2 then
    raise exception 'FAIL: a failed hop-1 (push) row did not immediately escalate to hop 2 (whatsapp): id=% channel=% hop=%',
      v_hop2_id, v_row.channel, v_row.escalation_hop;
  end if;
  raise notice 'PASS 4b: a status=failed critical notification escalates immediately with no wait';

  -- ---- Part 4c: sent-but-unconfirmed waits out its share of the SLA window. ----
  -- screening_abnormal_result/emergency = 120 min over 3 hops -> 40 min/hop,
  -- floored/greatest(2, ...) unaffected. A row sent 5 minutes ago must NOT
  -- yet escalate.
  insert into public.notifications
    (organisation_id, recipient_id, channel, template, payload, priority, status, sent_at,
     escalation_pathway, escalation_alert_tier, escalation_hop)
  values
    (v_org, v_recipient, 'push', 'test_critical_template', '{}'::jsonb, 'critical', 'sent', now() - interval '5 minutes',
     'screening_abnormal_result', 'emergency', 1)
  returning id into v_hop1_recent;

  perform private.escalate_unconfirmed_critical_notifications();
  if exists (select 1 from public.notifications where escalated_from_id = v_hop1_recent) then
    raise exception 'FAIL: a sent-5-minutes-ago row escalated before its SLA-hop window elapsed';
  end if;
  raise notice 'PASS 4c: a sent-but-unconfirmed row within its SLA-hop window does not yet escalate';

  -- ---- Part 4d: once that window elapses, it does escalate. ----
  update public.notifications set sent_at = now() - interval '45 minutes' where id = v_hop1_recent;
  perform private.escalate_unconfirmed_critical_notifications();
  if not exists (select 1 from public.notifications where escalated_from_id = v_hop1_recent and channel = 'whatsapp' and escalation_hop = 2) then
    raise exception 'FAIL: a row past its SLA-hop window did not escalate to hop 2';
  end if;
  raise notice 'PASS 4d: a sent-but-unconfirmed row past its SLA-hop window escalates to the next channel';

  -- ---- Part 4e: exhausting the ladder records a failure + fans out to every admin, idempotently. ----
  select count(*) into v_admin_count_before from public.notifications
    where recipient_id = v_admin and template = 'critical_notification_escalation_exhausted';

  insert into public.notifications
    (organisation_id, recipient_id, channel, template, payload, priority, status, sent_at,
     escalation_pathway, escalation_alert_tier, escalation_hop)
  values
    (v_org, v_recipient, 'sms', 'test_critical_template', '{}'::jsonb, 'critical', 'failed', now(),
     'screening_abnormal_result', 'emergency', 3)
  returning id into v_hop3_id;

  perform private.escalate_unconfirmed_critical_notifications();

  select count(*) into v_fail_count from public.notification_escalation_failures where notification_id = v_hop3_id;
  if v_fail_count <> 1 then
    raise exception 'FAIL: exhausted hop-3 chain did not record exactly one notification_escalation_failures row (got %)', v_fail_count;
  end if;

  select count(*) into v_admin_count_after from public.notifications
    where recipient_id = v_admin and template = 'critical_notification_escalation_exhausted';
  if v_admin_count_after <> v_admin_count_before + 1 then
    raise exception 'FAIL: admin in_app fanout count wrong: before=% after=% (expected +1)', v_admin_count_before, v_admin_count_after;
  end if;
  if not exists (
    select 1 from public.notifications
    where recipient_id = v_admin and template = 'critical_notification_escalation_exhausted' and channel = 'in_app'
      and (payload->>'notification_id')::uuid = v_hop3_id
  ) then
    raise exception 'FAIL: admin fanout row does not reference the exhausted notification id';
  end if;

  -- Re-run the same tick: on-conflict-do-nothing must make this a no-op, not
  -- a duplicate failure row or a second admin ping.
  perform private.escalate_unconfirmed_critical_notifications();
  select count(*) into v_fail_count from public.notification_escalation_failures where notification_id = v_hop3_id;
  if v_fail_count <> 1 then
    raise exception 'FAIL: re-running the engine duplicated the notification_escalation_failures row (count=%)', v_fail_count;
  end if;
  select count(*) into v_admin_count_after from public.notifications
    where recipient_id = v_admin and template = 'critical_notification_escalation_exhausted';
  if v_admin_count_after <> v_admin_count_before + 1 then
    raise exception 'FAIL: re-running the engine sent a duplicate admin fanout (count=%)', v_admin_count_after - v_admin_count_before;
  end if;
  raise notice 'PASS 4e: an exhausted ladder records exactly one failure row + one admin fanout per admin, idempotent on re-run';

  -- ---------------------------------------------------------------------------
  -- Part 5: push-first channel remap trigger.
  -- ---------------------------------------------------------------------------
  -- 5a: no push subscription, no voice preference -> a queued whatsapp row
  -- stays whatsapp (unchanged default).
  insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
  values (v_org, v_recipient, 'whatsapp', 'test_remap_template', '{}'::jsonb)
  returning channel into v_row.channel;
  if v_row.channel <> 'whatsapp' then
    raise exception 'FAIL: whatsapp remained mis-remapped with no push subscription on file: %', v_row.channel;
  end if;

  -- 5b: an active push subscription beats whatsapp.
  insert into public.push_subscriptions (organisation_id, profile_id, endpoint, p256dh_key, auth_key)
  values (v_org, v_recipient, 'https://push.example.invalid/notif-fallback-test-endpoint', 'p256dh-test-key', 'auth-test-key');

  insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
  values (v_org, v_recipient, 'whatsapp', 'test_remap_template', '{}'::jsonb)
  returning channel into v_row.channel;
  if v_row.channel <> 'push' then
    raise exception 'FAIL: a queued whatsapp row was not remapped to push despite an active subscription: %', v_row.channel;
  end if;
  raise notice 'PASS 5a-5b: whatsapp stays whatsapp with no push subscription, remaps to push once one exists';

  -- 5c: an explicit voice preference wins over push, even with an active subscription on file.
  update public.profiles set preferred_reminder_channel = 'voice' where id = v_recipient;
  insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
  values (v_org, v_recipient, 'whatsapp', 'test_remap_template', '{}'::jsonb)
  returning channel into v_row.channel;
  if v_row.channel <> 'voice' then
    raise exception 'FAIL: an explicit voice preference did not win over an active push subscription: %', v_row.channel;
  end if;
  update public.profiles set preferred_reminder_channel = null where id = v_recipient;
  raise notice 'PASS 5c: an explicit voice preference wins over push';

  -- ---------------------------------------------------------------------------
  -- Part 6: push_subscriptions RLS isolates one patient's device from another's.
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_recipient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select count(*) from public.push_subscriptions where profile_id = v_recipient) <> 1 then
    raise exception 'FAIL: the recipient cannot see their own push_subscriptions row under RLS';
  end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_other_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select count(*) from public.push_subscriptions where profile_id = v_recipient) <> 0 then
    raise exception 'FAIL: a different patient session can see the recipient''s push_subscriptions row';
  end if;
  reset role;
  raise notice 'PASS 6: push_subscriptions RLS isolates one patient device from another';

  -- ---------------------------------------------------------------------------
  -- Part 7: touch_last_active() only ever touches the caller's own row.
  -- ---------------------------------------------------------------------------
  update public.profiles set app_last_active_at = null where id in (v_recipient, v_other_patient);
  perform set_config('request.jwt.claims', json_build_object('sub', v_recipient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.touch_last_active();
  reset role;

  if not exists (select 1 from public.profiles where id = v_recipient and app_last_active_at is not null) then
    raise exception 'FAIL: touch_last_active() did not stamp the caller''s own profile';
  end if;
  if exists (select 1 from public.profiles where id = v_other_patient and app_last_active_at is not null) then
    raise exception 'FAIL: touch_last_active() stamped a different profile';
  end if;
  raise notice 'PASS 7: touch_last_active() stamps only the calling session''s own profile';

  raise notice 'ALL NOTIFICATION-DELIVERY-FALLBACK CHECKS PASSED';
end $$;

rollback;
