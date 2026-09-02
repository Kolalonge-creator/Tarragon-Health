-- Tarragon Health
-- Live proof for 20260829092739_cds_recommendation_decisions.sql (Clinical
-- Decision Support §38.12 clinician override / §38.14 documented outcome).
-- Six cases in one rolled-back transaction:
--   1. A care_coordinator (active clinical_staff, tier = care_coordinator)
--      attempts to decide -> BLOCKED (42501)
--   2. A real, active clinician decides 'accepted', with spoofed
--      decided_by/decided_by_profile/decided_at in the SAME statement ->
--      ALLOWED, but attribution fields are forced to the real caller
--   3. An 'overridden' decision with no override_reason -> BLOCKED (23514,
--      the CHECK constraint)
--   4. An 'overridden' decision WITH a reason -> ALLOWED
--   5. A 'deferred' decision with no suppress_until -> BLOCKED (23514)
--   6. Attempting to insert against a patient in a DIFFERENT organisation
--      from the one named on the row -> BLOCKED (42501)
--   7. Sabotage control: temporarily disable the attribution trigger and
--      repeat case 1 (a care_coordinator deciding) -> now ALLOWED, proving
--      case 1 was actually discriminating on the trigger, not on something
--      else (e.g. RLS alone, which admits any org staff by design here).
--
-- Run: npx supabase db query --linked -f packages/db/tests/cds_recommendation_decisions.sql

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org             uuid := '00000000-0000-0000-0000-000000000001';
  v_other_org       uuid;
  v_pat             uuid;
  v_other_org_pat   uuid;
  v_coord_profile   uuid;
  v_coord_staff_id  uuid;
  v_clin            uuid;
  v_clin_staff_id   uuid;
  v_decision_id     uuid;
  v_blocked         boolean;
  v_err             text;
begin
  select id into v_pat  from public.profiles where role='patient' and organisation_id=v_org limit 1;
  select id into v_clin from public.profiles where role='clinician' and organisation_id=v_org limit 1;

  -- A profile from a different org, for the cross-org guard (case 6). Any
  -- other org with a patient will do; skip that case gracefully if the
  -- fixture data has only one org (checked in the test body below).
  select id into v_other_org
  from public.organisations where id <> v_org limit 1;
  if v_other_org is not null then
    select id into v_other_org_pat from public.profiles where role='patient' and organisation_id=v_other_org limit 1;
  end if;

  -- Self-contained fixtures: a real clinician (tiered) and a Care Coordinator
  -- (tier = care_coordinator), both active in v_org.
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
  values (v_org, v_clin, 'CDS Test Clinician', true, now(), 'tier_2')
  on conflict (profile_id) do update
    set organisation_id = excluded.organisation_id, active = true, doctor_tier = excluded.doctor_tier
  returning id into v_clin_staff_id;

  select id into v_coord_profile from public.profiles where role='care_coordinator' and organisation_id=v_org limit 1;
  if v_coord_profile is null then
    -- No provisioned care_coordinator account in this org's fixture data --
    -- reuse the patient's own auth identity as a stand-in profile purely to
    -- carry a distinct profile_id for the coordinator's clinical_staff row.
    -- (Never done for a real clinical actor -- test-only.)
    select id into v_coord_profile from public.profiles where organisation_id = v_org and id <> v_clin limit 1;
  end if;

  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
  values (v_org, v_coord_profile, 'CDS Test Coordinator', true, now(), 'care_coordinator')
  on conflict (profile_id) do update
    set organisation_id = excluded.organisation_id, active = true, doctor_tier = excluded.doctor_tier
  returning id into v_coord_staff_id;

  -- --- case 1: care_coordinator attempts to decide -> BLOCKED -------------
  v_blocked := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord_profile, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.cds_recommendation_decisions
      (organisation_id, patient_id, recommendation_key, recommendation_fingerprint,
       category, priority, title, trigger_text, source_label, decision)
    values
      (v_org, v_pat, 'bp_uncontrolled', 'fp1', 'monitoring', 'routine',
       'BP remains uncontrolled', 'Last 3 home BP readings above target', 'Tarragon HTN protocol', 'accepted');
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (1, 'care_coordinator decision attempt',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, ''));

  -- --- case 2: real clinician accepts, spoofed attribution in same statement
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.cds_recommendation_decisions
    (organisation_id, patient_id, recommendation_key, recommendation_fingerprint,
     category, priority, title, trigger_text, source_label, decision,
     decided_by, decided_by_profile, decided_at)
  values
    (v_org, v_pat, 'bp_uncontrolled', 'fp1', 'monitoring', 'routine',
     'BP remains uncontrolled', 'Last 3 home BP readings above target', 'Tarragon HTN protocol', 'accepted',
     v_coord_staff_id, v_coord_profile, now() - interval '10 days')
  returning id into v_decision_id;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (2, 'clinician accepts (spoofed decided_by/at in same statement)',
    (select case when decided_by = v_clin_staff_id and decided_by_profile = v_clin
      then 'attribution forced to real caller (correct)'
      else 'SPOOFED VALUE ACCEPTED (BUG): decided_by=' || decided_by::text end
     from public.cds_recommendation_decisions where id = v_decision_id),
    (select 'decided_at_recent=' || (decided_at > now() - interval '1 minute')::text
     from public.cds_recommendation_decisions where id = v_decision_id));

  -- --- case 3: overridden with no reason -> BLOCKED (CHECK) ---------------
  v_blocked := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.cds_recommendation_decisions
      (organisation_id, patient_id, recommendation_key, recommendation_fingerprint,
       category, priority, title, trigger_text, source_label, decision)
    values
      (v_org, v_pat, 'interaction:ace_inhibitor+arb', 'fp2', 'medication_safety', 'high',
       'Dual RAS blockade', 'Both an ACE inhibitor and an ARB are active', 'Curated drug-safety engine', 'overridden');
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (3, 'overridden with no reason',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, ''));

  -- --- case 4: overridden WITH a reason -> ALLOWED ------------------------
  v_blocked := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.cds_recommendation_decisions
      (organisation_id, patient_id, recommendation_key, recommendation_fingerprint,
       category, priority, title, trigger_text, source_label, decision, override_reason)
    values
      (v_org, v_pat, 'interaction:ace_inhibitor+arb', 'fp2', 'medication_safety', 'high',
       'Dual RAS blockade', 'Both an ACE inhibitor and an ARB are active', 'Curated drug-safety engine',
       'overridden', 'Patient is on a stable, monitored combination started by a nephrologist; continuing under specialist advice.');
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (4, 'overridden with a reason',
    case when not v_blocked then 'ALLOWED (correct)' else 'BLOCKED (BUG): ' || coalesce(v_err,'') end, '');

  -- --- case 5: deferred with no suppress_until -> BLOCKED (CHECK) ---------
  v_blocked := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.cds_recommendation_decisions
      (organisation_id, patient_id, recommendation_key, recommendation_fingerprint,
       category, priority, title, trigger_text, source_label, decision, override_reason)
    values
      (v_org, v_pat, 'monitoring_due:lipid_panel', 'fp3', 'monitoring', 'routine',
       'Repeat lab test may be required', 'Statin started with no baseline LFT on file', 'Drug-triggered lab monitoring',
       'deferred', 'Booking the lab visit next week');
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (5, 'deferred with no suppress_until',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, ''));

  -- --- case 6: patient/org mismatch -> BLOCKED -----------------------------
  if v_other_org_pat is not null then
    v_blocked := false;
    perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role','authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    begin
      insert into public.cds_recommendation_decisions
        (organisation_id, patient_id, recommendation_key, recommendation_fingerprint,
         category, priority, title, trigger_text, source_label, decision)
      values
        (v_org, v_other_org_pat, 'bp_uncontrolled', 'fp1', 'monitoring', 'routine',
         'BP remains uncontrolled', 'Last 3 home BP readings above target', 'Tarragon HTN protocol', 'accepted');
    exception when others then
      v_blocked := true;
      get stacked diagnostics v_err = message_text;
    end;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
    insert into test_result values (6, 'patient not in the stated organisation',
      case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, ''));
  else
    insert into test_result values (6, 'patient not in the stated organisation', 'SKIPPED (only one org in fixture data)', '');
  end if;

  -- --- case 7: sabotage control -- disable the trigger, repeat case 1 -----
  -- If this still shows BLOCKED, case 1 wasn't actually testing the trigger.
  alter table public.cds_recommendation_decisions disable trigger cds_recommendation_decisions_enforce_attribution;
  v_blocked := false;
  v_err := null; -- clear any stale message from an earlier case's exception
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord_profile, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.cds_recommendation_decisions
      (organisation_id, patient_id, recommendation_key, recommendation_fingerprint,
       category, priority, title, trigger_text, source_label, decision,
       decided_by, decided_by_profile)
    values
      (v_org, v_pat, 'bp_uncontrolled', 'fp1', 'monitoring', 'routine',
       'BP remains uncontrolled', 'Last 3 home BP readings above target', 'Tarragon HTN protocol', 'accepted',
       v_coord_staff_id, v_coord_profile);
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  alter table public.cds_recommendation_decisions enable trigger cds_recommendation_decisions_enforce_attribution;
  insert into test_result values (7, 'sabotage control: trigger disabled, care_coordinator retried',
    case when not v_blocked then 'ALLOWED once disabled (confirms case 1 discriminates)' else 'STILL BLOCKED (test is not isolating the trigger)' end,
    coalesce(v_err, ''));

end $$;

select * from test_result order by case_num;

rollback;
