-- ===========================================================================
-- Verification: 20260905060140_critical_notifications_without_a_pathway_reach
--               _the_dead_letter
--
-- THE GAP. private.notify_clinician_alert() writes every clinical page as
-- priority='critical' and has never set escalation_pathway, while
-- private.escalate_unconfirmed_critical_notifications() selected
-- `... and n.escalation_pathway is not null`. Measured live on 2026-09-05:
-- 148 critical notifications, all 148 with a null pathway, 97 of them
-- status='failed', and ZERO rows in notification_escalation_failures. The
-- dead-letter had never fired once in production.
--
-- This script proves, against the real engine:
--   * a failed, ladder-exhausted, UNPATHWAYED critical lands in
--     notification_escalation_failures and alerts every admin;
--   * the dead-letter records the absent pathway as null rather than
--     inventing a tier nobody triaged;
--   * a second run does not duplicate the row;
--   * a hop-1 row is HOPPED along the default push/whatsapp/sms ladder, not
--     dead-lettered early;
--   * CONTROL: a still-pending critical is neither hopped nor dead-lettered;
--   * CONTROL: the engine's own exhaustion alarm, even when failed, is not
--     itself escalated -- the guard against alarming about the alarms;
--   * SABOTAGE: putting the single removed predicate back makes the
--     dead-letter miss the row again, so the checks above test the fix and
--     not something incidental.
--
-- Wrapped in BEGIN/ROLLBACK -- a verification script, never seed data. The
-- sabotage section redefines the engine inside the transaction; the rollback
-- is what puts it back.
-- ===========================================================================

begin;

create temporary table p1(check_name text, observed text, expected text, verdict text) on commit drop;
create temporary table p1f(k text primary key, v uuid) on commit drop;

-- Builds its own recipient and admin rather than borrowing whatever the
-- project happens to hold. The first version selected an existing clinician
-- and required an admin to already exist, which is true of the live project
-- and false of a fresh `supabase db reset`, where it aborted with "no admin
-- profile". A proof that only runs against populated data is the problem
-- ci.excluded exists to describe, and this script is in ci.manifest.
--
-- The admin matters specifically: the exhaustion alarm fans out to every
-- admin, so with none present the "every admin is alerted" assertion would
-- pass vacuously at 0 = 0 while proving nothing.
do $$
declare
  v_org uuid;
  v_rec uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation exists at all -- the core migrations did not run'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_rec,   'dlq-recipient@example.invalid', 'x', now(), '{}', '{}'),
         (v_admin, 'dlq-admin@example.invalid',     'x', now(), '{}', '{}')
  on conflict (id) do nothing;

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_rec,   v_org, 'clinician', 'DLQ Test Clinician'),
         (v_admin, v_org, 'admin',     'DLQ Test Admin')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id,
        role = excluded.role,
        full_name = excluded.full_name;

  insert into p1f values ('org', v_org), ('rec', v_rec);
end $$;

-- ==========================================================================
-- 1. A failed, exhausted, unpathwayed critical reaches the dead-letter.
--    escalation_hop = 3 is the end of the default push/whatsapp/sms ladder.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from p1f where k = 'org');
  v_rec uuid := (select v from p1f where k = 'rec');
  v_n uuid;
  v_cnt int;
  v_pathway text;
  v_admin_alerts int;
  v_admins int;
begin
  insert into public.notifications
    (organisation_id, recipient_id, channel, template, payload, priority, status,
     escalation_hop, source_table)
  values (v_org, v_rec, 'sms', 'p1_baseline_page', '{}'::jsonb, 'critical', 'failed', 3, 'clinician_alerts')
  returning id into v_n;
  insert into p1f values ('baseline', v_n);

  perform private.escalate_unconfirmed_critical_notifications();

  select count(*) into v_cnt from public.notification_escalation_failures where notification_id = v_n;
  insert into p1 values
    ('a failed, exhausted, unpathwayed critical lands in notification_escalation_failures',
     v_cnt::text, '1', case when v_cnt = 1 then 'PASS' else 'FAIL' end);
  if v_cnt <> 1 then
    raise exception 'HOLE OPEN: the dead-letter does not catch an unpathwayed critical (got % rows)', v_cnt;
  end if;

  select escalation_pathway into v_pathway
    from public.notification_escalation_failures where notification_id = v_n;
  insert into p1 values
    ('the dead-letter records the missing pathway as null rather than inventing one',
     coalesce(v_pathway, '<null>'), '<null>', case when v_pathway is null then 'PASS' else 'FAIL' end);
  if v_pathway is not null then
    raise exception 'FAIL: dead-letter row recorded pathway=%', v_pathway;
  end if;

  select count(*) into v_admins from public.profiles where role = 'admin';
  select count(*) into v_admin_alerts
    from public.notifications
   where template = 'critical_notification_escalation_exhausted'
     and payload->>'notification_id' = v_n::text;
  insert into p1 values
    ('every admin is alerted about the exhausted chain',
     v_admin_alerts::text, v_admins::text,
     case when v_admin_alerts = v_admins then 'PASS' else 'FAIL' end);
  if v_admin_alerts <> v_admins then
    raise exception 'HOLE OPEN: exhausted chain raised % admin alerts, expected %', v_admin_alerts, v_admins;
  end if;
end $$;

-- ==========================================================================
-- 2. Re-running the same cron tick is idempotent.
-- ==========================================================================
do $$
declare v_n uuid := (select v from p1f where k = 'baseline'); v_cnt int;
begin
  perform private.escalate_unconfirmed_critical_notifications();
  select count(*) into v_cnt from public.notification_escalation_failures where notification_id = v_n;
  insert into p1 values
    ('re-running the engine does not duplicate the dead-letter row',
     v_cnt::text, '1', case when v_cnt = 1 then 'PASS' else 'FAIL' end);
  if v_cnt <> 1 then raise exception 'FAIL: duplicate dead-letter rows (%)', v_cnt; end if;
end $$;

-- ==========================================================================
-- 3. The default ladder is HOPPED, not skipped straight to the dead-letter.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from p1f where k = 'org');
  v_rec uuid := (select v from p1f where k = 'rec');
  v_n uuid; v_hop record; v_dead int;
begin
  insert into public.notifications
    (organisation_id, recipient_id, channel, template, payload, priority, status, escalation_hop)
  values (v_org, v_rec, 'push', 'p1_hop_page', '{}'::jsonb, 'critical', 'failed', 1)
  returning id into v_n;

  perform private.escalate_unconfirmed_critical_notifications();

  select channel::text as ch, escalation_hop as hop into v_hop
    from public.notifications where escalated_from_id = v_n;
  insert into p1 values
    ('hop 1 of an unpathwayed critical advances to the default ladder''s channel 2 (whatsapp)',
     coalesce(v_hop.ch, '<none>') || ' hop=' || coalesce(v_hop.hop::text, '<none>'),
     'whatsapp hop=2',
     case when v_hop.ch = 'whatsapp' and v_hop.hop = 2 then 'PASS' else 'FAIL' end);
  if v_hop.ch is distinct from 'whatsapp' or v_hop.hop is distinct from 2 then
    raise exception 'FAIL: hop went to % at hop %, expected whatsapp at hop 2', v_hop.ch, v_hop.hop;
  end if;

  select count(*) into v_dead from public.notification_escalation_failures where notification_id = v_n;
  insert into p1 values
    ('a hop-1 row is escalated, not dead-lettered (the ladder is used, not skipped)',
     v_dead::text, '0', case when v_dead = 0 then 'PASS' else 'FAIL' end);
  if v_dead <> 0 then raise exception 'FAIL: hop-1 row was dead-lettered immediately'; end if;
end $$;

-- ==========================================================================
-- 4. CONTROL: a critical that has not failed and was never sent is untouched.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from p1f where k = 'org');
  v_rec uuid := (select v from p1f where k = 'rec');
  v_n uuid; v_dead int; v_hops int;
begin
  insert into public.notifications
    (organisation_id, recipient_id, channel, template, payload, priority, status, escalation_hop)
  values (v_org, v_rec, 'sms', 'p1_control_pending', '{}'::jsonb, 'critical', 'pending', 3)
  returning id into v_n;

  perform private.escalate_unconfirmed_critical_notifications();

  select count(*) into v_dead from public.notification_escalation_failures where notification_id = v_n;
  select count(*) into v_hops from public.notifications where escalated_from_id = v_n;
  insert into p1 values
    ('CONTROL: a still-pending critical is neither hopped nor dead-lettered',
     'dead=' || v_dead || ' hops=' || v_hops, 'dead=0 hops=0',
     case when v_dead = 0 and v_hops = 0 then 'PASS' else 'FAIL' end);
  if v_dead <> 0 or v_hops <> 0 then
    raise exception 'FAIL: a pending critical was escalated -- the status filter is broken';
  end if;
end $$;

-- ==========================================================================
-- 5. CONTROL: the engine does not escalate its own exhaustion alarm.
--    Those rows are priority='critical' with no pathway too, so without the
--    template exclusion this fix would alarm about its own alarms forever.
-- ==========================================================================
do $$
declare
  v_n uuid := (select v from p1f where k = 'baseline');
  v_alarm uuid; v_dead int;
begin
  select id into v_alarm from public.notifications
   where template = 'critical_notification_escalation_exhausted'
     and payload->>'notification_id' = v_n::text limit 1;

  update public.notifications set status = 'failed' where id = v_alarm;
  perform private.escalate_unconfirmed_critical_notifications();

  select count(*) into v_dead from public.notification_escalation_failures where notification_id = v_alarm;
  insert into p1 values
    ('CONTROL: a FAILED admin alarm is not itself escalated (no alarm-about-the-alarm loop)',
     v_dead::text, '0', case when v_dead = 0 then 'PASS' else 'FAIL' end);
  if v_dead <> 0 then
    raise exception 'FAIL: the engine escalated its own exhaustion alarm -- infinite loop';
  end if;
end $$;

-- ==========================================================================
-- 6. SABOTAGE: put the one removed predicate back; the dead-letter must miss
--    the row again. If it still catches it, sections 1-3 prove nothing.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from p1f where k = 'org');
  v_rec uuid := (select v from p1f where k = 'rec');
  v_n uuid; v_dead int; v_def text;
begin
  v_def := pg_get_functiondef('private.escalate_unconfirmed_critical_notifications()'::regprocedure);
  if v_def not like '%and n.opened_at is null%' then
    raise exception 'SABOTAGE SETUP FAILED: the engine no longer contains the anchor this test patches';
  end if;
  execute replace(v_def,
    'and n.opened_at is null',
    'and n.opened_at is null and n.escalation_pathway is not null');

  insert into public.notifications
    (organisation_id, recipient_id, channel, template, payload, priority, status, escalation_hop)
  values (v_org, v_rec, 'sms', 'p1_sabotage_page', '{}'::jsonb, 'critical', 'failed', 3)
  returning id into v_n;

  perform private.escalate_unconfirmed_critical_notifications();

  select count(*) into v_dead from public.notification_escalation_failures where notification_id = v_n;
  insert into p1 values
    ('SABOTAGE: re-adding `escalation_pathway is not null` makes the dead-letter miss it again',
     v_dead::text, '0', case when v_dead = 0 then 'PASS' else 'FAIL' end);
  if v_dead <> 0 then
    raise exception 'VACUOUS TEST: the row dead-lettered even with the old guard restored -- sections 1-3 prove nothing';
  end if;
end $$;

select check_name, observed, expected, verdict from p1 order by verdict desc, check_name;

rollback;
