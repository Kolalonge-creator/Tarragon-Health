-- Tarragon Health
-- Live proof for the Specialist Referral Engine closure/outcome series
-- (20260828030512 through 20260828033417) — task spec §11.13/§11.15.
--
-- Six cases in one rolled-back transaction. Every negative is paired with a
-- positive control, per CLAUDE.md's own rule (see
-- emergency_escalation_tier_gate.sql) — a blocked-everything trigger would
-- otherwise pass a negatives-only test:
--   1. Close a referral with NO outcome recorded            -> BLOCKED (23514, CHECK)
--   2. Tier 1 closes a referral WITH an outcome + note      -> ALLOWED, closed_by/closed_at stamped
--   3. Org staff with NO active clinical_staff row closes   -> BLOCKED (42501) even though outcome+note present
--      (control: outcome present alone is not sufficient — closing is gated to clinical tier, not just org-staff RLS)
--   4. Reopening an already-closed referral                 -> BLOCKED (42501)
--   5. Patient's document upload (service-role write, per   -> ALLOWED, outcome_document_uploaded_by
--      lib/referrals/actions.ts — specialist_referrals'         preserved from the explicit value the
--      UPDATE policy is staff-only, confirmed live)             app passed (auth.uid() is null under
--                                                                 service-role, so the trigger does not
--                                                                 overwrite it — see case 5 below)
--   6. Clinical Director (no doctor_tier, is_clinical_director) closes a fresh referral -> ALLOWED (control: the gate accepts either path, same as is_clinical_tier itself)
--
-- Only ONE clinical_staff row is guaranteed to exist platform-wide (per
-- emergency_escalation_tier_gate.sql's own note), so this test builds every
-- clinical_staff fixture it needs inline rather than relying on seed data.
--
-- TO CONFIRM THIS TEST DISCRIMINATES, break it on purpose: comment out the
-- `if v_staff_id is null then raise exception` block in
-- private.enforce_specialist_referral_outcome_and_closure. Case 3 must FAIL,
-- showing a non-clinical org-staff session closing a referral.
--
-- Run: npx supabase db query --linked -f packages/db/tests/specialist_referral_engine.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int, label text, expected text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org        uuid := '00000000-0000-0000-0000-000000000001';
  v_pat        uuid;
  v_t1         uuid;  -- profile that will hold a Tier 1 clinical_staff row
  v_noclin     uuid;  -- org-staff profile with NO clinical_staff row at all
  v_dir        uuid;  -- profile that will hold a Clinical Director row, no tier
  v_ref_a      uuid;
  v_ref_b      uuid;
  v_ref_c      uuid;
  v_blocked    boolean;
  v_err        text;
  v_closed_by  uuid;
  v_uploaded_by uuid;
begin
  select id into v_pat from public.profiles where role = 'patient' and organisation_id = v_org limit 1;
  if v_pat is null then
    raise exception 'no patient profile in org 0001 to build a fixture against';
  end if;

  select id into v_t1 from public.profiles
    where role::text in ('clinician', 'admin', 'doctor') and organisation_id = v_org
    order by created_at limit 1;
  select id into v_noclin from public.profiles
    where role::text in ('clinician', 'admin', 'doctor') and organisation_id = v_org and id <> v_t1
    order by created_at limit 1;
  select id into v_dir from public.profiles
    where role::text in ('clinician', 'admin', 'doctor') and organisation_id = v_org and id not in (v_t1, v_noclin)
    order by created_at limit 1;
  if v_noclin is null or v_dir is null then
    raise exception 'need at least 3 org-staff profiles (clinician/admin/doctor) in org 0001 to build this fixture';
  end if;

  -- Upsert rather than delete-then-insert: a real clinical_staff row can be
  -- referenced elsewhere (e.g. patient_timeline.actor_clinical_staff_id),
  -- which a plain DELETE would violate on live data with real history.
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier, is_clinical_director)
  values
    (v_org, v_t1,  'Referral Engine Tier One Fixture', true, now(), 'tier_1', false),
    (v_org, v_dir, 'Referral Engine Director Fixture',  true, now(), null,    true)
  on conflict (profile_id) do update set
    organisation_id = excluded.organisation_id,
    active = true,
    license_verified_at = now(),
    doctor_tier = excluded.doctor_tier,
    is_clinical_director = excluded.is_clinical_director;

  -- v_noclin must have NO ACTIVE clinical_staff row for case 3's negative
  -- control — deactivate rather than delete, for the same reason as above.
  update public.clinical_staff set active = false where profile_id = v_noclin;

  insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, referral_reason, status)
  values
    (v_org, v_pat, 'cardiology', 'referral engine proof: no outcome yet', 'completed'),
    (v_org, v_pat, 'endocrinology', 'referral engine proof: outcome present', 'completed'),
    (v_org, v_pat, 'nephrology', 'referral engine proof: director close', 'completed');

  select id into v_ref_a from public.specialist_referrals where referral_reason = 'referral engine proof: no outcome yet';
  select id into v_ref_b from public.specialist_referrals where referral_reason = 'referral engine proof: outcome present';
  select id into v_ref_c from public.specialist_referrals where referral_reason = 'referral engine proof: director close';

  ---------------------------------------------------------------------------
  -- 1. Close with no outcome recorded -> BLOCKED (23514, CHECK constraint)
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.specialist_referrals
      set status = 'closed', care_plan_update_note = 'no outcome on file'
      where id = v_ref_a;
  exception when check_violation then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (1, 'Close with no outcome recorded', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, 'no exception'));

  ---------------------------------------------------------------------------
  -- 2. Record an outcome, then Tier 1 closes with a care-plan note -> ALLOWED
  ---------------------------------------------------------------------------
  update public.specialist_referrals
    set treatment_plan_received_at = now(), treatment_plan_note = 'Started ACE inhibitor, review in 4 weeks'
    where id = v_ref_b;

  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.specialist_referrals
      set status = 'closed', care_plan_update_note = 'Added ACE inhibitor to care plan, monitoring cadence updated'
      where id = v_ref_b;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select closed_by into v_closed_by from public.specialist_referrals where id = v_ref_b;
  insert into test_result values (2, 'Tier 1 closes with outcome + care-plan note', 'ALLOWED',
    case when not v_blocked and v_closed_by = (select id from public.clinical_staff where profile_id = v_t1)
      then 'ALLOWED, closed_by correct (correct)' else 'FAILED (BUG)' end,
    'blocked=' || v_blocked || ' err=' || coalesce(v_err, 'none') || ' closed_by=' || coalesce(v_closed_by::text, 'null'));

  ---------------------------------------------------------------------------
  -- 3. Org staff with no active clinical_staff row closes -> BLOCKED (42501)
  --    even though an outcome + note are both present.
  ---------------------------------------------------------------------------
  update public.specialist_referrals
    set treatment_plan_received_at = now(), treatment_plan_note = 'Outcome on file for the negative-control referral'
    where id = v_ref_a;

  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_noclin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.specialist_referrals
      set status = 'closed', care_plan_update_note = 'attempted by non-clinical org staff'
      where id = v_ref_a;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (3, 'Non-clinical org staff closes (outcome+note present)', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, 'no exception'));

  ---------------------------------------------------------------------------
  -- 4. Reopening an already-closed referral -> BLOCKED (42501)
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.specialist_referrals set status = 'booked' where id = v_ref_b;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (4, 'Reopen an already-closed referral', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, 'no exception'));

  ---------------------------------------------------------------------------
  -- 5. Patient document upload, as the app actually does it: service-role
  --    write (no auth.uid() in scope) with outcome_document_uploaded_by
  --    passed explicitly, since specialist_referrals' UPDATE policy is
  --    staff-only even for a patient's own row (confirmed live — see the
  --    header note). No jwt/role impersonation here at all, same as a
  --    real service-role connection: the point is the trigger must
  --    PRESERVE the explicitly-passed value rather than nulling it out
  --    when auth.uid() is null.
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  begin
    update public.specialist_referrals
      set outcome_document_path = v_pat::text || '/proof-upload.pdf', outcome_document_uploaded_by = v_pat
      where id = v_ref_c;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;

  select outcome_document_uploaded_by into v_uploaded_by from public.specialist_referrals where id = v_ref_c;
  insert into test_result values (5, 'Patient outcome-document write (service-role, explicit uploaded_by)', 'ALLOWED',
    case when not v_blocked and v_uploaded_by = v_pat then 'ALLOWED, uploaded_by preserved (correct)' else 'FAILED (BUG)' end,
    'blocked=' || v_blocked || ' uploaded_by=' || coalesce(v_uploaded_by::text, 'null') || ' expected=' || v_pat::text);

  ---------------------------------------------------------------------------
  -- 6. Clinical Director (no doctor_tier, is_clinical_director) closes
  --    -> ALLOWED (control: is_clinical_tier's OR-branch)
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_dir, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.specialist_referrals
      set status = 'closed', care_plan_update_note = 'Director-authored care plan update'
      where id = v_ref_c;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (6, 'Clinical Director closes with outcome + note', 'ALLOWED',
    case when not v_blocked then 'ALLOWED (correct)' else 'FAILED (BUG): ' || coalesce(v_err, '') end,
    'blocked=' || v_blocked);
end $$;

select
  'CASE ' || case_num || ' [' || outcome || '] ' || label ||
    case when detail = '' then '' else ' -- ' || detail end as line
from test_result
order by case_num;

rollback;
