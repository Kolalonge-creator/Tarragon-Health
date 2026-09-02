-- Tarragon Health
-- Live proof for the Health Communication Engine's preference-respecting
-- migrations (20260828230423_communication_preferences_columns.sql,
-- 20260828230453_remap_notification_channel_respects_preference.sql,
-- 20260828230511_broadcast_marketing_consent.sql).
--
-- Four cases in one rolled-back transaction:
--   1. profiles.notification_channel_preference = 'sms' remaps a routine
--      whatsapp-queued notification to sms
--   2. a critical-priority row is left on whatsapp regardless of preference
--      (the escalation ladder must never be weakened by a personal setting)
--   3. no preference + no push subscription leaves a routine row on whatsapp
--      (existing default behaviour is unchanged)
--   4. a marketing broadcast (is_marketing=true) only resolves opted-in
--      patients; a non-marketing broadcast is unaffected by opt-in status
--
-- Run: npx supabase db query --linked -f packages/db/tests/communication_preferences_and_marketing_consent.sql
-- Nothing here persists — the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int,
  label text,
  outcome text,
  detail text
) on commit drop;

do $$
declare
  v_org      uuid;
  v_pat      uuid;
  v_pat2     uuid;
  v_admin    uuid;
  v_ch       public.notification_channel;
begin
  select organisation_id, id into v_org, v_pat from public.profiles where role = 'patient' limit 1;
  select id into v_pat2 from public.profiles where role = 'patient' and id <> v_pat limit 1;
  select id into v_admin from public.profiles where role = 'admin' limit 1;

  -- ---------------------------------------------------------------------
  -- Case 1: explicit sms preference remaps a routine whatsapp row
  -- ---------------------------------------------------------------------
  update public.profiles set notification_channel_preference = 'sms' where id = v_pat;

  insert into public.notifications (organisation_id, recipient_id, channel, template)
  values (v_org, v_pat, 'whatsapp', 'comm_pref_proof_case1')
  returning channel into v_ch;

  insert into test_result values (
    1, 'routine + sms preference -> remapped',
    v_ch::text, 'expected: sms'
  );

  -- ---------------------------------------------------------------------
  -- Case 2: critical priority ignores the same patient's sms preference
  -- ---------------------------------------------------------------------
  insert into public.notifications
    (organisation_id, recipient_id, channel, template, priority, escalation_pathway, escalation_alert_tier)
  values
    (v_org, v_pat, 'whatsapp', 'comm_pref_proof_case2', 'critical', 'screening_abnormal_result', 'urgent_escalation')
  returning channel into v_ch;

  insert into test_result values (
    2, 'critical + sms preference -> untouched',
    v_ch::text, 'expected: whatsapp (escalation ladder owns critical routing)'
  );

  update public.profiles set notification_channel_preference = null where id = v_pat;

  -- ---------------------------------------------------------------------
  -- Case 3: no preference, no push subscription -> default whatsapp
  -- ---------------------------------------------------------------------
  insert into public.notifications (organisation_id, recipient_id, channel, template)
  values (v_org, v_pat, 'whatsapp', 'comm_pref_proof_case3')
  returning channel into v_ch;

  insert into test_result values (
    3, 'no preference, no push subscription -> default',
    v_ch::text, 'expected: whatsapp (unchanged default behaviour)'
  );

  -- ---------------------------------------------------------------------
  -- Case 4: marketing broadcast only resolves opted-in patients
  -- ---------------------------------------------------------------------
  update public.profiles set marketing_opt_in = true where id = v_pat;
  update public.profiles set marketing_opt_in = false where id = v_pat2;

  insert into test_result values (
    4, 'marketing broadcast targets among 2 test patients',
    (select count(*)::text from private.broadcast_targets('all_patients', '{}'::jsonb, v_admin, true) t
      where t.recipient_id in (v_pat, v_pat2)),
    'expected: 1 (only the opted-in patient)'
  );

  insert into test_result values (
    5, 'non-marketing broadcast targets among 2 test patients',
    (select count(*)::text from private.broadcast_targets('all_patients', '{}'::jsonb, v_admin, false) t
      where t.recipient_id in (v_pat, v_pat2)),
    'expected: 2 (opt-in status irrelevant to a non-marketing send)'
  );
end $$;

select * from test_result order by case_num;

rollback;
