-- Tarragon Health
-- Live proof for 20260730095649_clinician_alert_override.sql (v3 port:
-- "deterministic always-classify with a clinician_override field").
-- Six cases in one rolled-back transaction:
--   1. A care_coordinator (no clinical_staff row) attempts an override -> BLOCKED (42501)
--   2. A real, active clinician overrides, with a spoofed overridden_by/at
--      in the SAME statement -> ALLOWED, but overridden_by/at are forced
--      to the real caller's own clinical_staff id + now()
--   3. The system's own `level` is left untouched by the override
--   4. An unrelated update (e.g. the real acknowledge-alert write) leaves
--      the override fields intact
--   5. Setting override_level with no override_reason (a real clinician
--      session, so the clinical-authority check passes) -> BLOCKED (23514,
--      the CHECK constraint)
--   6. Clearing override_level (set back to null) wipes override_reason/
--      overridden_by/overridden_at together
--
-- NOTE: as of 2026-07-30 the QA test accounts provisioned 2026-07-27 have
-- NO clinical_staff rows (only 1 row exists in the whole table -- the
-- founder's own, from the same-day Clinical Director provisioning) --
-- confirmed live, not assumed. This test therefore inserts its own
-- self-contained clinical_staff fixture rather than relying on a named
-- test account. If re-provisioning the QA roster, note this gap.
--
-- Run: npx supabase db query --linked -f packages/db/tests/clinician_alert_override.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org           uuid := '00000000-0000-0000-0000-000000000001';
  v_pat           uuid;
  v_coord         uuid;
  v_clin          uuid;
  v_clin_staff_id uuid;
  v_other_profile uuid := gen_random_uuid();
  v_other_staff_id uuid;
  v_alert_id      uuid;
  v_blocked       boolean;
  v_err           text;
begin
  select id into v_pat  from public.profiles where role='patient' and organisation_id=v_org limit 1;
  select id into v_coord from public.profiles where role='care_coordinator' and organisation_id=v_org limit 1;
  select id into v_clin from public.profiles where role='clinician' and organisation_id=v_org limit 1;

  -- A shared CI-fixture clinician now exists with its own clinical_staff row
  -- (clinical_staff.profile_id is unique) -- clear it first so this test's
  -- own fixture is the only thing the gate can see, same defensive pattern
  -- i1_i10_invariants_platform.sql's I5 section already uses for the
  -- identical reason.
  delete from public.clinical_staff where profile_id = v_clin;

  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at)
  values (v_org, v_clin, 'Override Test Clinician', true, now())
  returning id into v_clin_staff_id;

  -- "Someone else already overrode this" for case 4's control needs a
  -- second, distinct clinical_staff row with a real (non-null) profile_id
  -- of its own -- can't reuse v_coord for this, since case 1's whole point
  -- is that the care_coordinator has NO clinical_staff row at all.
  -- Self-provisioned rather than looked up ambiently: an ambient
  -- `where profile_id <> v_clin` pulled in whatever else happened to exist
  -- (or nothing, on a fresh database), making this control non-deterministic.
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_other_profile, 'clinician-override-other@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Override Test Other Clinician'
    where id = v_other_profile;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at)
  values (v_org, v_other_profile, 'Override Test Other Clinician', true, now())
  returning id into v_other_staff_id;

  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title)
  values (v_org, v_pat, 'urgent_escalation', 'open', 'clinician_override proof fixture')
  returning id into v_alert_id;

  v_blocked := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.clinician_alerts
    set override_level = 'clinician_review', override_reason = 'Coordinator attempting a clinical call'
    where id = v_alert_id;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (1, 'care_coordinator override attempt', case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err,''));

  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.clinician_alerts
  set override_level = 'emergency', override_reason = 'Patient called back, symptoms worse than the auto-triage caught',
      overridden_by = v_other_staff_id, overridden_at = now() - interval '10 days'
  where id = v_alert_id;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (2, 'clinician overrides (spoofed overridden_by/at in same statement)',
    (select case when overridden_by = v_clin_staff_id then 'overridden_by forced to real caller (correct)' else 'SPOOFED VALUE ACCEPTED (BUG): ' || coalesce(overridden_by::text,'null') end from public.clinician_alerts where id = v_alert_id),
    (select 'level=' || level::text || ' override_level=' || override_level::text || ' overridden_at_recent=' || (overridden_at > now() - interval '1 minute')::text from public.clinician_alerts where id = v_alert_id));

  insert into test_result values (3, 'system level preserved after override',
    (select level::text from public.clinician_alerts where id = v_alert_id), 'expected: urgent_escalation (unchanged)');

  update public.clinician_alerts set status = 'acknowledged', acknowledged_by = v_clin, acknowledged_at = now() where id = v_alert_id;
  insert into test_result values (4, 'unrelated (acknowledge) update leaves override intact',
    (select coalesce(override_level::text,'null') || '/' || coalesce((overridden_by = v_clin_staff_id)::text,'null') from public.clinician_alerts where id = v_alert_id),
    'expected: emergency/true');

  v_blocked := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.clinician_alerts set override_level = 'routine', override_reason = null where id = v_alert_id;
  exception when check_violation then
    v_blocked := true;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (5, 'override_level without override_reason (real clinician session)', case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, '');

  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.clinician_alerts set override_level = null where id = v_alert_id;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (6, 'clearing override_level clears reason/overridden_by/at',
    (select coalesce(override_reason,'null') || '/' || coalesce(overridden_by::text,'null') || '/' || coalesce(overridden_at::text,'null') from public.clinician_alerts where id = v_alert_id),
    'expected: null/null/null');
end $$;

select * from test_result order by case_num;

rollback;
