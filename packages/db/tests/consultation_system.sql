-- Tarragon Health
-- Live proof for the Consultation System build (docs/source consultation
-- spec §9): consultation_follow_ups' clinical-tier/coordinator authority
-- split, clinical_encounter_notes' required outcome on finalize, and
-- consultation_feedback's ownership gate.
--
-- Every negative case is paired with a positive control on the same row/
-- action, per CLAUDE.md's own rule -- a blocked-everything bug would
-- otherwise pass a negatives-only test.
--
-- Cases:
--   1. Tier 2 doctor records a monitoring_schedule follow-up on their own
--      note                                              -> ALLOWED
--   2. Care Coordinator attempts the same on the same note -> BLOCKED (42501)
--      (control for 1: creating a follow-up instruction is a clinical act)
--   3. Care Coordinator actions an investigation follow-up via
--      action_consultation_follow_up                     -> ALLOWED
--      (logistics -- routes onto care_outreach_tasks)
--   4. Care Coordinator attempts to action the monitoring_schedule
--      follow-up via the same RPC                         -> BLOCKED (42501)
--   5. Tier 2 doctor actions the monitoring_schedule follow-up -> ALLOWED
--      (control for 4: same row, clinical-tier caller succeeds; also
--      proves the vitals_reminder_rules row is really created)
--   6. Any edit to the now-actioned monitoring_schedule follow-up -> BLOCKED
--      (immutability once resolved)
--   7. Finalizing a clinical_encounter_notes draft with NO outcome
--                                                          -> BLOCKED (CHECK)
--   8. Finalizing the same draft WITH an outcome           -> ALLOWED
--      (control for 7: same row, only the outcome differs)
--   9. Patient submits feedback for their OWN completed video consultation
--                                                          -> ALLOWED
--  10. A different patient attempts feedback on that same consultation
--                                                          -> BLOCKED (42501)
--      (control for 9: same consultation, only the caller differs)
--
-- Run: npx supabase db query --linked -f packages/db/tests/consultation_system.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int, label text, expected text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org         uuid := '00000000-0000-0000-0000-000000000001';
  v_pat         uuid;
  v_pat2        uuid;
  v_doc         uuid;  -- profile that will hold a Tier 2 clinical_staff row
  v_coord       uuid;  -- profile that will hold a Care Coordinator clinical_staff row
  v_note        uuid;
  v_fu_monitor  uuid;
  v_fu_invest   uuid;
  v_consult     uuid;
  v_blocked     boolean;
  v_err         text;
  v_status      text;
  v_linked_rule uuid;
  v_freq        int;
  v_outreach_id uuid;
  v_row_count   int;
begin
  select id into v_pat from public.profiles where role = 'patient' and organisation_id = v_org order by created_at limit 1;
  select id into v_pat2 from public.profiles where role = 'patient' and organisation_id = v_org and id <> v_pat order by created_at limit 1;
  if v_pat is null or v_pat2 is null then
    raise exception 'need at least 2 patient profiles in org 0001 to build this fixture';
  end if;

  select id into v_doc from public.profiles
    where role::text in ('clinician', 'admin', 'doctor') and organisation_id = v_org
    order by created_at limit 1;
  select id into v_coord from public.profiles
    where role::text in ('clinician', 'admin', 'doctor', 'care_coordinator') and organisation_id = v_org and id <> v_doc
    order by created_at limit 1;
  if v_doc is null or v_coord is null then
    raise exception 'need at least 2 org-staff profiles in org 0001 to build this fixture';
  end if;

  -- Clear any pre-existing clinical_staff rows for these two profiles for
  -- the life of this transaction, so the fixture is the only thing the
  -- authority checks can see.
  delete from public.clinical_staff where profile_id in (v_doc, v_coord);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier, is_clinical_director)
  values
    (v_org, v_doc,   'Consultation System Test: Tier 2 Doctor', true, now(), 'tier_2', false),
    (v_org, v_coord, 'Consultation System Test: Care Coordinator', true, now(), 'care_coordinator', false);

  ---------------------------------------------------------------------------
  -- Fixtures: one draft clinical_encounter_notes row (written as the
  -- doctor's own session, so authored_by_staff is genuinely server-derived,
  -- not injected), and one completed video_consultations row for the
  -- feedback tests.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.clinical_encounter_notes
    (organisation_id, patient_id, encounter_type, reason_for_encounter, plan)
  values
    (v_org, v_pat, 'in_person', 'Consultation System test fixture', 'Check BP twice weekly for 4 weeks')
  returning id into v_note;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into public.video_consultations
    (organisation_id, patient_id, context, status, scheduled_at, started_at, ended_at)
  values
    (v_org, v_pat, 'general_checkin', 'completed', now() - interval '1 hour', now() - interval '1 hour', now() - interval '45 minutes')
  returning id into v_consult;

  ---------------------------------------------------------------------------
  -- 1. Tier 2 doctor records a monitoring_schedule follow-up -> ALLOWED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.consultation_follow_ups (organisation_id, patient_id, encounter_note_id, action_type, description)
    values (v_org, v_pat, v_note, 'monitoring_schedule', 'Check BP twice weekly for 4 weeks')
    returning id into v_fu_monitor;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (1, 'Tier 2 doctor records monitoring_schedule follow-up', 'ALLOWED',
    case when not v_blocked and v_fu_monitor is not null then 'ALLOWED (correct)' else 'BLOCKED (BUG)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 2. CONTROL: Care Coordinator attempts to record a follow-up -> BLOCKED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.consultation_follow_ups (organisation_id, patient_id, encounter_note_id, action_type, description)
    values (v_org, v_pat, v_note, 'investigation', 'Repeat HbA1c in 3 months');
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (2, 'CONTROL Care Coordinator records a follow-up', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG -- coordinator can create clinical instructions)' end, coalesce(v_err, ''));

  -- Doctor creates the investigation follow-up case 3 needs (case 2 proved a
  -- coordinator can't, so this one is created by the doctor instead).
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.consultation_follow_ups (organisation_id, patient_id, encounter_note_id, action_type, description)
  values (v_org, v_pat, v_note, 'investigation', 'Repeat HbA1c in 3 months')
  returning id into v_fu_invest;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  ---------------------------------------------------------------------------
  -- 3. Care Coordinator actions the investigation follow-up -> ALLOWED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.action_consultation_follow_up(v_fu_invest, null, null, null);
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select status, linked_outreach_task_id into v_status, v_outreach_id from public.consultation_follow_ups where id = v_fu_invest;
  insert into test_result values (3, 'Care Coordinator actions investigation follow-up (logistics)', 'ALLOWED, linked to care_outreach_tasks',
    case when not v_blocked and v_status = 'actioned' and v_outreach_id is not null
      then 'ALLOWED (correct), status=' || v_status || ', outreach_task=' || v_outreach_id::text
      else 'FAILED (BUG): blocked=' || v_blocked::text || ' status=' || coalesce(v_status,'null') end,
    coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 4. Care Coordinator attempts to action the monitoring_schedule
  --    follow-up -> BLOCKED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.action_consultation_follow_up(v_fu_monitor, 3, null, null);
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (4, 'Care Coordinator actions monitoring_schedule follow-up', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG -- coordinator set a clinical monitoring cadence)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 5. CONTROL: Tier 2 doctor actions the same monitoring_schedule
  --    follow-up -> ALLOWED, and a real vitals_reminder_rules row exists.
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.action_consultation_follow_up(v_fu_monitor, 3, null, null);
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select status, linked_vitals_reminder_rule_id into v_status, v_linked_rule from public.consultation_follow_ups where id = v_fu_monitor;
  select frequency_days into v_freq from public.vitals_reminder_rules where id = v_linked_rule;
  insert into test_result values (5, 'CONTROL Tier 2 doctor actions monitoring_schedule follow-up', 'ALLOWED, vitals_reminder_rules.frequency_days=3',
    case when not v_blocked and v_status = 'actioned' and v_freq = 3
      then 'ALLOWED (correct), frequency_days=' || v_freq::text
      else 'FAILED (BUG): blocked=' || v_blocked::text || ' status=' || coalesce(v_status,'null') || ' freq=' || coalesce(v_freq::text,'null') end,
    coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 6. Any edit to the now-actioned monitoring_schedule follow-up -> BLOCKED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.consultation_follow_ups set description = 'edited after actioning' where id = v_fu_monitor;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (6, 'Edit an actioned (resolved) follow-up', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG -- resolved follow-up is not immutable)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 7. Finalize the note with NO outcome -> BLOCKED (CHECK constraint)
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.clinical_encounter_notes set status = 'finalized' where id = v_note;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (7, 'Finalize encounter note with no outcome', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG -- outcome not required to finalize)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 8. CONTROL: Finalize the same note WITH an outcome -> ALLOWED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.clinical_encounter_notes set status = 'finalized', outcome = 'continue_monitoring' where id = v_note;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select status into v_status from public.clinical_encounter_notes where id = v_note;
  insert into test_result values (8, 'CONTROL Finalize encounter note WITH an outcome', 'ALLOWED',
    case when not v_blocked and v_status = 'finalized' then 'ALLOWED (correct)' else 'FAILED (BUG)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 9. Patient submits feedback for their OWN completed consultation
  --    -> ALLOWED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.consultation_feedback (organisation_id, patient_id, video_consultation_id, overall_rating)
    values (v_org, v_pat, v_consult, 5);
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_row_count from public.consultation_feedback where video_consultation_id = v_consult and patient_id = v_pat;
  insert into test_result values (9, 'Patient submits feedback for their own completed consult', 'ALLOWED',
    case when not v_blocked and v_row_count = 1 then 'ALLOWED (correct)' else 'FAILED (BUG)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 10. CONTROL: A different patient attempts feedback on that same
  --     consultation -> BLOCKED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.consultation_feedback (organisation_id, patient_id, video_consultation_id, overall_rating)
    values (v_org, v_pat2, v_consult, 1);
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (10, 'CONTROL A different patient submits feedback on someone else''s consult', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG -- feedback ownership not enforced)' end, coalesce(v_err, ''));
end $$;

select case_num, label, expected, outcome, left(detail, 160) as detail
from test_result order by case_num;

rollback;
