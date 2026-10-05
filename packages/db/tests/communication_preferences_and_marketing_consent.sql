-- Tarragon Health
-- Live proof for the Health Communication Engine's preference-respecting
-- migrations (20260828230423_communication_preferences_columns.sql,
-- 20260828230453_remap_notification_channel_respects_preference.sql,
-- 20260828230511_broadcast_marketing_consent.sql).
--
-- Re-expressed 2026-09-30 for the channel cleanup: the
-- push-first remap trigger is gone and routine reminders now ask
-- private.patient_reminder_channel(). Cases in one rolled-back transaction:
--   1. profiles.notification_channel_preference = 'email' is honoured for a
--      routine reminder (the helper returns email, and only when allowed)
--   2. a critical-priority page still opens on the escalation ladder's first
--      channel regardless of the personal preference (the ladder must never be
--      weakened by a personal setting)
--   3. no preference + no push subscription resolves to in_app (the safe default)
--   4. a marketing broadcast (is_marketing=true) only resolves opted-in
--      patients; 5. a non-marketing broadcast is unaffected by opt-in status
--   6. SABOTAGE: a helper that ignored the preference makes case 1 fail
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
  v_clin     uuid := gen_random_uuid();
  v_notif    uuid;
begin
  select organisation_id, id into v_org, v_pat from public.profiles where role = 'patient' limit 1;
  select id into v_pat2 from public.profiles where role = 'patient' and id <> v_pat limit 1;
  select id into v_admin from public.profiles where role = 'admin' limit 1;

  -- ---------------------------------------------------------------------
  -- Case 1: explicit email preference is honoured for a routine reminder
  -- ---------------------------------------------------------------------
  update public.profiles set notification_channel_preference = 'email' where id = v_pat;
  if not found then raise exception 'VACUOUS: the email preference was not applied'; end if;

  v_ch := private.patient_reminder_channel(v_pat);
  insert into test_result values (
    1, 'routine + email preference -> email',
    v_ch::text, 'expected: email'
  );
  if v_ch <> 'email' then raise exception 'FAIL 1: email preference gave %', v_ch; end if;

  -- ---------------------------------------------------------------------
  -- Case 2: a critical page ignores the same patient's preference
  -- ---------------------------------------------------------------------
  -- A minted clinician is the page's recipient (a critical page goes to staff).
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_clin, 'comm-pref-proof-clinician@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Comm Pref Proof Clinician',
         notification_channel_preference = 'email' where id = v_clin;
  v_notif := public.enqueue_critical_notification(
     v_org, v_clin, 'comm_pref_proof_case2', '{}'::jsonb,
     'screening_abnormal_result', 'emergency', 'clinician_alerts', gen_random_uuid());
  select channel into v_ch from public.notifications where id = v_notif;

  insert into test_result values (
    2, 'critical (clinician with email preference) -> first ladder channel',
    v_ch::text, 'expected: push (escalation ladder owns critical routing)'
  );
  if v_ch is distinct from 'push' then raise exception 'FAIL 2: critical page opened on % instead of the ladder''s first channel', v_ch; end if;

  update public.profiles set notification_channel_preference = null where id = v_pat;

  -- ---------------------------------------------------------------------
  -- Case 3: no preference, no push subscription -> in_app
  -- ---------------------------------------------------------------------
  delete from public.push_subscriptions where profile_id = v_pat;
  v_ch := private.patient_reminder_channel(v_pat);
  insert into test_result values (
    3, 'no preference, no push subscription -> default',
    v_ch::text, 'expected: in_app'
  );
  if v_ch <> 'in_app' then raise exception 'FAIL 3: default channel was %', v_ch; end if;

  -- ---------------------------------------------------------------------
  -- Case 6: SABOTAGE -- a helper ignoring the preference must fail case 1
  -- ---------------------------------------------------------------------
  update public.profiles set notification_channel_preference = 'email' where id = v_pat;
  begin
    create or replace function private.patient_reminder_channel(p_recipient uuid, p_allow_email boolean default true)
    returns public.notification_channel language sql stable as $f$ select 'in_app'::public.notification_channel $f$;
    v_ch := private.patient_reminder_channel(v_pat);
    raise exception 'sabotage_undo';
  exception when others then
    if sqlerrm <> 'sabotage_undo' then raise; end if;
  end;
  insert into test_result values (
    6, 'SABOTAGE: a helper ignoring the preference no longer returns email',
    v_ch::text, 'expected: in_app (proves case 1 discriminates)'
  );
  if v_ch = 'email' then raise exception 'VACUOUS TEST: sabotaged helper still returned email'; end if;
  update public.profiles set notification_channel_preference = null where id = v_pat;

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
  if (select outcome from test_result where case_num = 4) <> '1' then
    raise exception 'FAIL 4: marketing broadcast did not resolve exactly the opted-in patient';
  end if;

  insert into test_result values (
    5, 'non-marketing broadcast targets among 2 test patients',
    (select count(*)::text from private.broadcast_targets('all_patients', '{}'::jsonb, v_admin, false) t
      where t.recipient_id in (v_pat, v_pat2)),
    'expected: 2 (opt-in status irrelevant to a non-marketing send)'
  );
  if (select outcome from test_result where case_num = 5) <> '2' then
    raise exception 'FAIL 5: non-marketing broadcast should reach both patients';
  end if;
end $$;

select * from test_result order by case_num;

rollback;
