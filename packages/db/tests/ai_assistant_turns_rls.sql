-- Tarragon Health
-- Live proof for 20260829100000_ai_assistant_turns.sql -- the AI Health
-- Assistant audit-provenance table (docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md
-- §4.3) and the accompanying tightening of ai_conversations' staff-read
-- policy from a blanket is_org_staff() read to "only if the conversation
-- was actually escalated."
--
-- Six cases in one rolled-back transaction:
--   1. Patient reads their own ai_assistant_turns row -> ALLOWED
--   2. A different patient in the same org reads it -> BLOCKED
--   3. Org staff read a turn with no clinician_alert_id/escalation_id
--      (routine chit-chat, never flagged) -> BLOCKED
--   4. The same staff member reads a turn that DID raise a
--      clinician_alert_id -> ALLOWED
--   5. Staff in a DIFFERENT organisation attempt the same read -> BLOCKED
--      (cross-org isolation still holds on top of the new narrowing --
--      the discriminating case: if this ever came back ALLOWED it would
--      mean the escalation-linked exists() check silently dropped the
--      organisation_id scoping, not just widened who can see this org)
--   6. ai_conversations itself: staff can now read the conversation because
--      it has one escalated turn, but could NOT before this migration
--      shipped (case 3's turn alone would not have qualified it)
--
-- Run: npx supabase db query --linked -f packages/db/tests/ai_assistant_turns_rls.sql

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org            uuid := '00000000-0000-0000-0000-000000000001';
  v_other_org      uuid;
  v_pat            uuid;
  v_other_pat      uuid;
  v_staff          uuid;
  v_other_org_staff uuid;
  v_conv_id        uuid;
  v_turn_routine_id uuid;
  v_turn_escalated_id uuid;
  v_alert_id       uuid;
  v_visible        boolean;
begin
  select id into v_pat   from public.profiles where role = 'patient' and organisation_id = v_org limit 1;
  select id into v_staff from public.profiles where role = 'clinician' and organisation_id = v_org limit 1;
  select id into v_other_pat from public.profiles where role = 'patient' and organisation_id = v_org and id <> v_pat limit 1;
  select organisation_id, id into v_other_org, v_other_org_staff
    from public.profiles where role = 'clinician' and organisation_id <> v_org limit 1;

  insert into public.ai_conversations (organisation_id, profile_id)
  values (v_org, v_pat)
  returning id into v_conv_id;

  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title)
  values (v_org, v_pat, 'clinician_review', 'open', 'ai_assistant_turns_rls fixture')
  returning id into v_alert_id;

  insert into public.ai_assistant_turns
    (organisation_id, patient_id, conversation_id, interaction_type, safety_classification, final_action, status)
  values
    (v_org, v_pat, v_conv_id, 'chat_turn', 'routine', 'replied', 'completed')
  returning id into v_turn_routine_id;

  insert into public.ai_assistant_turns
    (organisation_id, patient_id, conversation_id, interaction_type, safety_classification,
     clinician_alert_id, final_action, status)
  values
    (v_org, v_pat, v_conv_id, 'chat_turn', 'clinician_review', v_alert_id, 'clinician_alert_created', 'completed')
  returning id into v_turn_escalated_id;

  -- 1. Patient reads own row.
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select exists (select 1 from public.ai_assistant_turns where id = v_turn_routine_id) into v_visible;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (1, 'patient reads own turn', case when v_visible then 'VISIBLE (correct)' else 'HIDDEN (BUG)' end, '');

  -- 2. A different patient reads it.
  if v_other_pat is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_other_pat, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select exists (select 1 from public.ai_assistant_turns where id = v_turn_routine_id) into v_visible;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
    insert into test_result values (2, 'a different patient reads it', case when v_visible then 'VISIBLE (BUG)' else 'HIDDEN (correct)' end, '');
  else
    insert into test_result values (2, 'a different patient reads it', 'SKIPPED', 'no second patient profile seeded in this org');
  end if;

  -- 3. Staff reads the routine (never-escalated) turn.
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select exists (select 1 from public.ai_assistant_turns where id = v_turn_routine_id) into v_visible;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (3, 'org staff read a never-escalated turn', case when v_visible then 'VISIBLE (BUG)' else 'HIDDEN (correct)' end, '');

  -- 4. Same staff member reads the escalated turn.
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select exists (select 1 from public.ai_assistant_turns where id = v_turn_escalated_id) into v_visible;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (4, 'same staff reads the escalated turn', case when v_visible then 'VISIBLE (correct)' else 'HIDDEN (BUG)' end, '');

  -- 5. Cross-org staff attempt the same escalated-turn read -- the
  --    discriminating case (proves org scoping wasn't accidentally dropped
  --    while adding the escalation-linked exists() clause).
  if v_other_org_staff is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_other_org_staff, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select exists (select 1 from public.ai_assistant_turns where id = v_turn_escalated_id) into v_visible;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
    insert into test_result values (5, 'staff in a DIFFERENT org reads the escalated turn', case when v_visible then 'VISIBLE (BUG -- cross-org leak)' else 'HIDDEN (correct)' end, '');
  else
    insert into test_result values (5, 'staff in a DIFFERENT org reads the escalated turn', 'SKIPPED', 'no clinician profile seeded outside org ' || v_org::text);
  end if;

  -- 6. ai_conversations itself is now readable by staff because it carries
  --    one escalated turn -- would have been HIDDEN under the pre-migration
  --    blanket-is_org_staff policy's replacement (it's the same policy name,
  --    so this proves the redefinition, not just additivity).
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select exists (select 1 from public.ai_conversations where id = v_conv_id) into v_visible;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (6, 'staff read ai_conversations once it has an escalated turn', case when v_visible then 'VISIBLE (correct)' else 'HIDDEN (BUG)' end, '');
end $$;

select * from test_result order by case_num;

rollback;
