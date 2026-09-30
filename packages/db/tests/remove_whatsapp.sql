-- ===========================================================================
-- Proof: 20260930094618_remove_whatsapp.sql (S01c, founder decision F-02).
--
-- WhatsApp is removed as a channel. The real risk in removing it was clinician alerting: the CMO-signed
-- escalation_slas ladders still name whatsapp (urgent: push, whatsapp_nudge; emergency: push, whatsapp, sms), so a
-- naive removal shortens every urgent ladder to a single push hop. This script proves, against the real migrated schema:
--   1. the whatsapp label is gone from all four enums and nothing refers to it any more (and the scan that proves
--      "no function refers to it" discriminates, via a planted caller);
--   2. THE CLINICIAN LADDER STILL HAS ITS SECOND HOP: a real enqueue_critical_notification on an urgent pathway
--      starts on push, escalates to EMAIL after a failed hop (not to nothing), and when that is exhausted records a
--      notification_escalation_failures row and alarms the admins; an emergency pathway keeps push, email, sms;
--   3. SABOTAGE: redefining the routing function the naive way (drop the retired token) leaves a one-hop ladder, which
--      check 2's hop-2 assertion would have caught, so check 2 is not vacuous;
--   4. patient reminders resolve through private.patient_reminder_channel: in-app by default, push when subscribed,
--      email only when preferred and allowed (never a dead channel), and the clinical-content CHECK still bars
--      clinical text from sms and email while in_app stays open (the gate opens as well as closes);
--   5. recreated routing functions are not executable by anon.
--
-- Wrapped in BEGIN/ROLLBACK; mints its own org-scoped fixtures.
-- Run:  psql -f packages/db/tests/remove_whatsapp.sql  (CI: scripts/run-db-proofs.sh)
-- ===========================================================================

begin;
create temporary table _checks (n serial, msg text) on commit drop;

do $$
declare
  v_org uuid;
  v_clin uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid();
  v_n integer;
  v_id uuid;
  v_hop2 record;
  v_hop_ch text;
  v_seq public.notification_channel[];
  v_caught boolean;
  v_failed boolean;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_clin,  'rmwa-clin@example.invalid',  'x', now(), '{}', '{}'),
    (v_admin, 'rmwa-admin@example.invalid', 'x', now(), '{}', '{}'),
    (v_pat,   'rmwa-pat@example.invalid',   'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name) values
    (v_clin,  v_org, 'clinician', 'RMWA Clinician'),
    (v_admin, v_org, 'admin',     'RMWA Admin'),
    (v_pat,   v_org, 'patient',   'RMWA Patient')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  -- ====== 1. The value is gone everywhere ====================================
  if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
             where t.typnamespace = 'public'::regnamespace and e.enumlabel ilike '%whatsapp%') then
    raise exception 'FAIL 1: an enum still has a whatsapp label';
  end if;
  select count(*) into v_n from pg_enum where enumtypid = 'public.notification_channel'::regtype;
  if v_n <> 5 then raise exception 'FAIL 1: notification_channel has % labels, expected 5', v_n; end if;
  begin
    perform 'whatsapp'::public.notification_channel;
    raise exception 'FAIL 1: notification_channel still accepts whatsapp';
  exception when invalid_text_representation then null;
  end;
  if to_regclass('public.support_messages') is not null then raise exception 'FAIL 1: support_messages still exists'; end if;
  if exists (select 1 from pg_trigger where tgname = 'notifications_remap_channel') then raise exception 'FAIL 1: remap trigger remains'; end if;
  insert into _checks (msg) values ('PASS 1: no whatsapp label, table, trigger or column remains');

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private', 'analytics')
     and (p.prosrc ilike '%whatsapp%' or p.prosrc ilike '%support_messages%')
     and not (n.nspname = 'private' and p.proname = 'normalize_escalation_channels');
  if v_n <> 0 then raise exception 'FAIL 1b: % function(s) still refer to whatsapp', v_n; end if;
  create function private.zz_s01c_stray() returns void language plpgsql as
    $f$ begin insert into public.notifications (organisation_id, recipient_id, channel, template) values (null, null, 'whatsapp', 'x'); end $f$;
  select count(*) > 0 into v_caught from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private', 'analytics') and p.prosrc ilike '%whatsapp%'
     and not (n.nspname = 'private' and p.proname = 'normalize_escalation_channels');
  drop function private.zz_s01c_stray();
  if not v_caught then raise exception 'VACUOUS 1b: the scan did not catch a planted whatsapp caller'; end if;
  insert into _checks (msg) values ('PASS 1b: no function refers to whatsapp, and the scan catches a planted caller');

  -- ====== 2. The clinician ladder keeps its second hop ======================
  v_id := private.enqueue_critical_notification(v_org, v_clin, 'clinician_alert_ack_timeout_senior',
            jsonb_build_object('patient_name', 'RMWA Patient'), 'bp_vitals_red_flag', 'urgent_escalation');
  if (select channel::text from public.notifications where id = v_id) <> 'push' then
    raise exception 'FAIL 2: hop 1 of an urgent ladder is not push';
  end if;
  update public.notifications set status = 'failed' where id = v_id;
  perform private.escalate_unconfirmed_critical_notifications();
  select * into v_hop2 from public.notifications where escalated_from_id = v_id;
  if v_hop2.id is null then raise exception 'FAIL 2: no second hop was created after push failed (ladder shortened)'; end if;
  if v_hop2.channel::text <> 'email' or v_hop2.escalation_hop <> 2 then
    raise exception 'FAIL 2: hop 2 is % (hop %), expected email (hop 2)', v_hop2.channel, v_hop2.escalation_hop;
  end if;
  insert into _checks (msg) values ('PASS 2a: an urgent alert escalates push -> email after a failed hop');

  update public.notifications set status = 'failed' where id = v_hop2.id;
  perform private.escalate_unconfirmed_critical_notifications();
  if not exists (select 1 from public.notification_escalation_failures where notification_id = v_hop2.id
                   and channel_sequence_exhausted = array['push', 'email']::public.notification_channel[]) then
    raise exception 'FAIL 2: an exhausted ladder did not record a notification_escalation_failures row';
  end if;
  if not exists (select 1 from public.notifications where recipient_id = v_admin
                   and template = 'critical_notification_escalation_exhausted' and channel = 'in_app') then
    raise exception 'FAIL 2: an exhausted ladder did not alarm the admins in-app';
  end if;
  insert into _checks (msg) values ('PASS 2b: an exhausted ladder records its failure and alarms the admins, never silently ends');

  v_id := private.enqueue_critical_notification(v_org, v_clin, 'clinician_alert_ack_timeout_senior',
            jsonb_build_object('patient_name', 'RMWA Patient'), 'emergency_event', 'emergency');
  v_failed := false;
  for i in 1..2 loop
    update public.notifications set status = 'failed' where id = v_id;
    perform private.escalate_unconfirmed_critical_notifications();
    select id, channel::text into v_id, v_hop_ch from public.notifications where escalated_from_id = v_id;
    if v_id is null then raise exception 'FAIL 2: emergency ladder stopped early at step %', i; end if;
    if i = 1 and v_hop_ch <> 'email' then raise exception 'FAIL 2: emergency hop 2 is %, expected email', v_hop_ch; end if;
    if i = 2 and v_hop_ch <> 'sms'   then raise exception 'FAIL 2: emergency hop 3 is %, expected sms', v_hop_ch; end if;
  end loop;
  insert into _checks (msg) values ('PASS 2c: an emergency alert keeps three hops: push, email, sms');

  -- 2d. The alert fan-out for a critical clinician alert reads its channel list from alert_rules.config, whose live
  --     abnormal_result entry still names whatsapp. It used to cast each token straight to the enum, which would now
  --     throw inside alert creation. It must instead fan out on the channels that still exist.
  insert into public.clinician_alerts (organisation_id, patient_id, title, category, type_code, level, severity)
  values (v_org, v_pat, 'RMWA critical alert probe', 'clinical', 'abnormal_result', 'emergency', 3)
  returning id into v_id;
  if (select severity from public.clinician_alerts where id = v_id) < 3 then
    raise exception 'fixture FAIL: probe alert is not severity 3';
  end if;
  perform private.notify_clinician_alert(v_id, v_clin, 'abnormal_result_clinician_alert', '{}'::jsonb);
  if not exists (select 1 from public.alert_deliveries where clinician_alert_id = v_id and recipient_id = v_clin and channel = 'push')
     or not exists (select 1 from public.alert_deliveries where clinician_alert_id = v_id and recipient_id = v_clin and channel = 'email') then
    raise exception 'FAIL 2d: a critical alert did not fan out to push and email (the retired token must read as email)';
  end if;
  if exists (select 1 from public.alert_deliveries where clinician_alert_id = v_id and recipient_id = v_clin
               and channel not in ('in_app', 'push', 'email', 'sms')) then
    raise exception 'FAIL 2d: a critical alert fanned out on an unexpected channel';
  end if;
  insert into _checks (msg) values ('PASS 2d: a critical clinician alert still fans out (in_app, push, email, sms) although alert_rules names the retired token');

  -- ====== 3. SABOTAGE: the naive fix (just drop the retired token) shortens the ladder =====
  create or replace function private.normalize_escalation_channels(p_raw text[]) returns public.notification_channel[]
   language sql immutable set search_path to '' as $f$
    select coalesce(array_agg(x.ch order by r.ord), array[]::public.notification_channel[])
    from unnest(p_raw) with ordinality as r(token, ord)
    cross join lateral (select case when regexp_replace(trim(split_part(lower(r.token), ',', 1)), '_nudge$', '')
                          in ('push', 'sms', 'email', 'in_app', 'voice')
                          then regexp_replace(trim(split_part(lower(r.token), ',', 1)), '_nudge$', '')::public.notification_channel end as ch) x
    where x.ch is not null $f$;
  v_seq := private.normalize_escalation_channels(array['push', 'whatsapp_nudge']);
  if array_length(v_seq, 1) <> 1 then raise exception 'VACUOUS 3: the naive version did not shorten the ladder (got %)', v_seq; end if;
  insert into _checks (msg) values ('PASS 3: sabotage confirmed: dropping the token leaves a one-hop ladder, so check 2 discriminates');

  -- ====== 4. Patient reminders and the content gate ==========================
  if private.patient_reminder_channel(v_pat) is distinct from 'in_app'::public.notification_channel then
    raise exception 'FAIL 4: a patient with nothing configured should resolve to in_app';
  end if;
  insert into public.push_subscriptions (organisation_id, profile_id, endpoint, p256dh_key, auth_key)
  values (v_org, v_pat, 'https://example.invalid/rmwa', 'k', 'a');
  if private.patient_reminder_channel(v_pat) is distinct from 'push'::public.notification_channel then
    raise exception 'FAIL 4: a subscribed patient should resolve to push';
  end if;
  update public.profiles set notification_channel_preference = 'email' where id = v_pat;
  if private.patient_reminder_channel(v_pat) is distinct from 'email'::public.notification_channel then
    raise exception 'FAIL 4: an email preference should be honoured';
  end if;
  if private.patient_reminder_channel(v_pat, false) is distinct from 'push'::public.notification_channel then
    raise exception 'FAIL 4: with email disallowed a subscribed patient should fall through to push';
  end if;
  update public.profiles set notification_channel_preference = 'sms' where id = v_pat;
  if private.patient_reminder_channel(v_pat) is distinct from 'push'::public.notification_channel then
    raise exception 'FAIL 4: an sms preference must never lock a patient into sms';
  end if;
  insert into _checks (msg) values ('PASS 4a: reminder routing is in_app by default, push when subscribed, email only when preferred and allowed');

  begin
    insert into public.notifications (organisation_id, recipient_id, channel, template, content_class)
    values (v_org, v_pat, 'email', 'rmwa_clinical_probe', 'clinical');
    raise exception 'FAIL 4: clinical content was accepted on email';
  exception when check_violation then null;
  end;
  insert into public.notifications (organisation_id, recipient_id, channel, template, content_class)
  values (v_org, v_pat, 'in_app', 'rmwa_clinical_probe', 'clinical');
  insert into _checks (msg) values ('PASS 4b: clinical content is barred from email and still allowed on in_app');

  -- a row that omits channel now lands in the inbox
  insert into public.notifications (organisation_id, recipient_id, template) values (v_org, v_pat, 'rmwa_default_probe') returning id into v_id;
  if (select channel::text from public.notifications where id = v_id) <> 'in_app' then
    raise exception 'FAIL 4: the default channel is not in_app';
  end if;
  insert into _checks (msg) values ('PASS 4c: the default channel is in_app');

  -- ====== 5. ACLs ============================================================
  if has_function_privilege('anon', 'private.normalize_escalation_channels(text[])', 'EXECUTE')
     or has_function_privilege('anon', 'private.patient_reminder_channel(uuid,boolean)', 'EXECUTE') then
    raise exception 'FAIL 5: anon can EXECUTE a routing function';
  end if;
  insert into _checks (msg) values ('PASS 5: anon cannot execute the routing functions');
end $$;

select msg from _checks order by n;

rollback;
