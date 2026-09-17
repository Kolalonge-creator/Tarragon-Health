-- Tarragon Health
-- Live proof for the continuous clinical note auto-draft mechanism
-- (20260917031004_auto_generated_continuous_clinical_note.sql).
--
-- Cases:
--   1. Resolving an escalation auto-drafts a clinical_encounter_notes row,
--      auto_generated=true, correctly attributed to whichever doctor the
--      escalation actually ends up assigned to (private.auto_assign_
--      escalation already fills assigned_doctor_id at INSERT time in any
--      org with a qualifying active doctor -- see that migration's own
--      header -- so a "resolve while genuinely unassigned" scenario cannot
--      be constructed against a populated org; the null-guard in
--      auto_draft_note_from_escalation is trivially correct by inspection
--      and not separately exercised here)                       -> PASS
--   2. Re-resolving the same escalation does not create a second
--      auto-drafted note for it (idempotent)                    -> PASS
--      (control for 1: same escalation, proves no duplication rather than
--      just proving creation once)
--   3. A plain manual insert into clinical_encounter_notes, by the SAME
--      doctor, in the SAME transaction as case 1/2 above, claiming
--      auto_generated=true itself -> forced back to false (server-derived,
--      never client-supplied; also proves the trusted-author GUC set by
--      the trigger in case 1 does not leak into this later, unrelated
--      statement)                                                -> PASS
--
-- Run: npx supabase db query --linked -f packages/db/tests/auto_generated_continuous_clinical_note.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int, label text, expected text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org         uuid := '00000000-0000-0000-0000-000000000001';
  v_pat         uuid;
  v_doc         uuid; -- profile that will hold a Medical Officer clinical_staff row
  v_doc_staff   uuid;
  v_escalation  uuid;
  v_note_count  int;
  v_auto_gen    boolean;
  v_author      uuid;
begin
  select id into v_pat from public.profiles where role = 'patient' and organisation_id = v_org order by created_at limit 1;
  if v_pat is null then
    raise exception 'need at least 1 patient profile in org 0001 to build this fixture';
  end if;

  select id into v_doc from public.profiles
    where role::text in ('clinician', 'admin', 'doctor') and organisation_id = v_org
    order by created_at limit 1;
  if v_doc is null then
    raise exception 'need at least 1 org-staff profile in org 0001 to build this fixture';
  end if;

  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
  values (v_org, v_doc, 'Continuous Note Test: Medical Officer Doctor', true, now(), 'medical_officer')
  on conflict (profile_id) do update
    set organisation_id = excluded.organisation_id, full_name = excluded.full_name,
        active = excluded.active, license_verified_at = excluded.license_verified_at,
        doctor_tier = excluded.doctor_tier
  returning id into v_doc_staff;

  ---------------------------------------------------------------------------
  -- 1. Resolving an escalation auto-drafts a note, correctly attributed
  --    to whichever doctor it is actually assigned to -> PASS
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.escalations (organisation_id, patient_id, status, assigned_doctor_id, reason)
  values (v_org, v_pat, 'open', v_doc, 'Continuous Note Test: escalation fixture')
  returning id into v_escalation;

  update public.escalations set status = 'resolved', identity_confirmed = true where id = v_escalation;

  select count(*), bool_and(auto_generated), min(authored_by_staff::text)::uuid into v_note_count, v_auto_gen, v_author
    from public.clinical_encounter_notes
    where escalation_id = v_escalation;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (1, 'Resolving an escalation auto-drafts a note, correctly attributed', 'PASS',
    case when v_note_count = 1 and v_auto_gen and v_author = v_doc_staff then 'PASS' else 'FAIL' end,
    format('note_count=%s auto_generated=%s authored_by_staff_matches=%s', v_note_count, v_auto_gen, v_author = v_doc_staff));

  ---------------------------------------------------------------------------
  -- 2. CONTROL: re-resolving the same escalation does not duplicate -> PASS
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  update public.escalations set status = 'under_review' where id = v_escalation;
  update public.escalations set status = 'resolved', identity_confirmed = true where id = v_escalation;

  select count(*) into v_note_count from public.clinical_encounter_notes
    where escalation_id = v_escalation and auto_generated;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (2, 'Re-resolving the same escalation does not duplicate the auto-draft', 'PASS',
    case when v_note_count = 1 then 'PASS' else 'FAIL' end, format('note_count=%s (expected 1)', v_note_count));

  ---------------------------------------------------------------------------
  -- 3. A manual insert cannot self-claim auto_generated=true, and the
  --    trusted GUC set by case 1's trigger does not leak into it -> PASS
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.clinical_encounter_notes (
    organisation_id, patient_id, encounter_type, reason_for_encounter, auto_generated
  ) values (
    v_org, v_pat, 'other', 'Continuous Note Test: manual note claiming auto_generated', true
  )
  returning auto_generated into v_auto_gen;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (3, 'Manual insert cannot self-claim auto_generated=true (no GUC leak)', 'PASS',
    case when v_auto_gen = false then 'PASS' else 'FAIL' end, format('auto_generated=%s (expected false)', v_auto_gen));
end $$;

select case_num, label, expected, outcome, detail from test_result order by case_num;

do $$
begin
  if exists (select 1 from test_result where outcome <> 'PASS') then
    raise exception 'auto_generated_continuous_clinical_note.sql: one or more cases FAILED -- see the printed table above';
  end if;
end $$;

rollback;
