-- Tarragon Health
-- Live proof for 20260828230735_alert_type_code_message_safety_flag.sql +
-- 20260828230818_care_message_safety_screening.sql (Health Communication
-- Engine 17.12: patient message -> safety screening -> potential urgent
-- concern -> appropriate urgent pathway).
--
-- Four cases in one rolled-back transaction:
--   1. a danger-phrase patient message raises an emergency clinician_alerts
--      row, flags the message, and proactively pages a recipient
--   2. a benign patient message raises nothing and is not flagged
--   3. a danger-phrase message never blocks normal delivery — the message
--      still lands in the thread either way
--   4. a care-team (clinician) reply containing a danger phrase is NOT
--      screened — this is a patient-signal detector, not a content filter
--
-- Run: npx supabase db query --linked -f packages/db/tests/care_message_safety_screening.sql
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
  v_org         uuid;
  v_pat         uuid;
  v_clin        uuid;
  v_thread      uuid;
  v_msg_danger  uuid;
  v_msg_benign  uuid;
  v_msg_reply   uuid;
begin
  select organisation_id, id into v_org, v_pat from public.profiles where role = 'patient' limit 1;
  select id into v_clin from public.profiles where role = 'clinician' and organisation_id = v_org limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_pat)::text, true);
  v_thread := public.start_care_thread('Safety screen proof', 'opening message, nothing urgent here', null, null, null);

  -- ---------------------------------------------------------------------
  -- Case 1: danger phrase -> flagged, alert raised, someone paged
  -- ---------------------------------------------------------------------
  v_msg_danger := public.post_care_message(v_thread, 'I have severe chest pain and I cannot breathe properly');

  insert into test_result values (
    1, 'danger-phrase message -> flagged_potential_emergency',
    (select flagged_potential_emergency::text from public.care_messages where id = v_msg_danger),
    'expected: true'
  );
  insert into test_result values (
    2, 'danger-phrase message -> clinician_alerts level',
    (select level::text from public.clinician_alerts ca
       join public.care_messages cm on cm.flagged_alert_id = ca.id
       where cm.id = v_msg_danger),
    'expected: emergency'
  );
  insert into test_result values (
    3, 'danger-phrase message -> a notification was sent',
    (select count(*)::text from public.notifications n
       join public.care_messages cm on n.payload->>'thread_id' = cm.thread_id::text
       where cm.id = v_msg_danger and n.template = 'care_message_safety_flag'),
    'expected: >= 1 (either the auto-assigned owner or the admin fallback)'
  );
  insert into test_result values (
    4, 'danger-phrase message -> still delivered to the thread normally',
    (select (count(*) > 0)::text from public.care_messages where id = v_msg_danger),
    'expected: true (the screen never blocks normal delivery)'
  );

  -- ---------------------------------------------------------------------
  -- Case 2: benign message -> nothing raised
  -- ---------------------------------------------------------------------
  v_msg_benign := public.post_care_message(v_thread, 'When is my next refill due? Also, thank you for the last visit.');

  insert into test_result values (
    5, 'benign message -> flagged_potential_emergency',
    (select flagged_potential_emergency::text from public.care_messages where id = v_msg_benign),
    'expected: false'
  );
  insert into test_result values (
    6, 'benign message -> flagged_alert_id',
    coalesce((select flagged_alert_id::text from public.care_messages where id = v_msg_benign), 'null'),
    'expected: null'
  );

  -- ---------------------------------------------------------------------
  -- Case 3: a care-team reply is never screened, even if it quotes a
  -- danger phrase back (e.g. clinical documentation, not a patient signal)
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin)::text, true);
  v_msg_reply := public.post_care_message(v_thread, 'Noted your chest pain and breathing difficulty — please come in today.');

  insert into test_result values (
    7, 'care-team reply quoting a danger phrase -> not screened',
    (select flagged_potential_emergency::text from public.care_messages where id = v_msg_reply),
    'expected: false (only patient/sponsor-authored messages are screened)'
  );
end $$;

select * from test_result order by case_num;

rollback;
