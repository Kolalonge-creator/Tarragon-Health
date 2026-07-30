-- ---------------------------------------------------------------------------
-- The I1-I10 invariant suite, ported from
-- reference/tarragon-control/supabase/tests/invariants_test.sql (the v3
-- build's failing-first invariant tests, per that spec's §18.1: "one failing-
-- first test per invariant") and ADAPTED to the platform's actual schema.
--
-- The two schemas do not share table names. v3 has readings/
-- triage_classifications/notification_templates/consent_records; the
-- platform has vitals_readings/escalations/clinician_alerts/notifications/
-- profile_access. Every check below is re-derived against the real platform
-- table, not copy-pasted, and each is proven live rather than assumed —
-- either as a genuine PASS (the platform enforces it) or as a genuine GAP
-- (the platform currently allows what the invariant says it must not).
--
-- HONESTY CONVENTION, carried over from the source file: a fake pass is worse
-- than no test. The source file explicitly left I2/I6/I7/I10/I11/I12/I13
-- untested at v3 M1 because the functionality didn't exist yet, and said so
-- in a comment rather than inventing a pass. This file follows the same
-- rule for the platform: where an invariant is a genuine, proven GAP, the
-- check below PROVES the gap live (the "should be rejected" case currently
-- SUCCEEDS) rather than silently passing or being omitted. That is more
-- valuable than either — it turns CLAUDE.md's "PORT IT IN" banner text into
-- a concrete, always-rerunnable regression check: the day someone builds the
-- real enforcement, this file's GAP checks start failing in the good sense,
-- and should be flipped to expect-rejection at that point (see each check's
-- own comment for what "fixed" looks like).
--
-- Run inside a transaction that is ROLLED BACK. Nothing here persists.
--   npx supabase db query --linked -f packages/db/tests/i1_i10_invariants_platform.sql
--
-- Mapping summary (see each section for the full reasoning):
--   I1  no clinical content on an open rail            -> GAP  (notifications has no content-class column at all)
--   I2  every reading resolves to exactly one           -> N/A (platform has no rigid classification-join
--       classification                                        table; the abnormal-result pipeline is the
--                                                               functional analogue but a different shape)
--   I3  no unknown source path on a reading              -> PASS (vitals_readings.source is NOT NULL)
--   I4  consent checked at query time, revoke is          -> PASS (profile_access + RLS; DELETE the grant,
--       immediate, no cache                                     the very next query sees nothing)
--   I5  urgent/emergency cannot be closed by a            -> GAP  (escalations has no synchronous-contact
--       text-only note                                          gate on resolution at all)
--   I6  escalation counts never compensation-reachable    -> N/A (no compensation model exists on the
--                                                                 platform tying pay to escalation counts)
--   I7  export always available regardless of             -> VERIFIED SEPARATELY (an app-layer absence-of-
--       subscription                                            gate fact, not a DB-level invariant — see
--                                                                 the note at the bottom of this file)
--   I8  no capitation billing structure may exist          -> PASS (outcomes_contract_type has no
--                                                                 'capitation' value; casting is rejected)
--   I9  institution admin returns zero rows on every       -> PASS (corporate_admin/hmo_admin excluded from
--       patient-scoped table                                     private.is_org_staff since 20260729124330)
--   I10 every clinical action writes a proof record        -> PARTIAL (8 high-risk trigger paths — red-flag
--                                                                 events, emergency events, lab results,
--                                                                 hospital admissions, obesity ED screens —
--                                                                 write audit_log automatically; this is not
--                                                                 yet the universal guarantee v3 envisioned)
--   I14 a device-linked reading cannot be edited by a      -> GAP  (vitals_readings_update lets a patient
--       patient (tested in the source file alongside I1-I9)      edit ANY of their own rows, source-blind)
-- ---------------------------------------------------------------------------

begin;

create temp table invariant_result(
  ord        int primary key,
  invariant  text,
  verdict    text,        -- PASS / GAP / PARTIAL / N/A
  check_name text,
  expected   text,
  observed   text
) on commit drop;

-- ===========================================================================
-- I3 — no unknown source path on a vitals reading.
-- v3's readings.source_detail NOT NULL maps directly onto
-- vitals_readings.source (manual/device/wearable), which is NOT NULL.
-- ===========================================================================
do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_pat uuid;
  v_rejected boolean := false;
begin
  select id into v_pat from public.profiles where role='patient' and organisation_id=v_org limit 1;

  begin
    insert into public.vitals_readings
      (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
    values (v_org, v_pat, 'blood_pressure', 120, 80, now(), null);
  exception
    when not_null_violation then
      v_rejected := true;
  end;

  insert into invariant_result values (
    3, 'I3', case when v_rejected then 'PASS' else 'FAIL' end,
    'vitals_readings insert with source = null is rejected',
    'not_null_violation', case when v_rejected then 'rejected' else 'accepted — REAL REGRESSION' end
  );
end $$;

-- ===========================================================================
-- I4 — consent (profile_access) is checked at query time; revocation takes
-- effect on the very next query, no cache-invalidation step needed.
-- Platform equivalent of v3's consent_records grant/revoke/re-read pattern,
-- using profiles_select's profile_access clause (20260729194127 preserved
-- it verbatim — see that migration's own assertion block).
-- ===========================================================================
do $$
declare
  v_org      uuid := '00000000-0000-0000-0000-000000000001';
  v_owner    uuid;
  v_grantee  uuid;
  v_grant_id uuid;
  n_before   int;
  n_after    int;
begin
  select id into v_owner   from public.profiles where role='patient' and organisation_id=v_org order by id limit 1;
  select id into v_grantee from public.profiles where role='patient' and organisation_id=v_org and id<>v_owner order by id limit 1;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_owner, v_grantee, 'view', v_owner)
  returning id into v_grant_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_grantee, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n_before from public.profiles where id = v_owner;
  perform set_config('role', 'postgres', true);

  delete from public.profile_access where id = v_grant_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_grantee, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n_after from public.profiles where id = v_owner;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into invariant_result values
    (41, 'I4', case when n_before = 1 then 'PASS' else 'FAIL' end,
        'grantee reads the owner profile while the grant is active',
        '1', n_before::text),
    (42, 'I4', case when n_after = 0 then 'PASS' else 'FAIL' end,
        'grantee reads nothing in the very next query after revocation, no cache clear',
        '0', n_after::text);
end $$;

-- ===========================================================================
-- I8 — no capitation billing structure may exist. Already closed live by
-- 20260729122912_remove_hmo_capitation_i8 — proving the enum itself has no
-- such value, so casting the string is rejected before any row is touched,
-- exactly as the source file tests it.
-- ===========================================================================
do $$
declare
  v_rejected boolean := false;
begin
  begin
    perform 'capitation'::public.outcomes_contract_type;
  exception
    when invalid_text_representation then
      v_rejected := true;
  end;

  insert into invariant_result values (
    8, 'I8', case when v_rejected then 'PASS' else 'FAIL' end,
    'outcomes_contract_type has no capitation value',
    'invalid_text_representation', case when v_rejected then 'rejected' else 'accepted — REAL REGRESSION' end
  );
end $$;

-- ===========================================================================
-- I9 — institution admin (corporate_admin/hmo_admin, the platform's
-- "institution admin" concept per I9's own migration comment) returns zero
-- rows on every patient-scoped table. Proven directly on vitals_readings and
-- profiles, with a clinician control in the same organisation so a "zero
-- rows because the table is empty" false pass is ruled out.
-- ===========================================================================
do $$
declare
  v_org       uuid := '00000000-0000-0000-0000-000000000001';
  v_corp      uuid;
  v_hmo       uuid;
  v_clin      uuid;
  v_pat       uuid;
  n_corp_vit  int;
  n_hmo_vit   int;
  n_corp_prof int;
  n_clin_vit  int;
begin
  select id into v_corp from public.profiles where role='corporate_admin' and organisation_id=v_org limit 1;
  select id into v_hmo  from public.profiles where role='hmo_admin'       and organisation_id=v_org limit 1;
  select id into v_clin from public.profiles where role='clinician'       and organisation_id=v_org limit 1;
  select id into v_pat  from public.profiles where role='patient'         and organisation_id=v_org limit 1;

  insert into public.vitals_readings
    (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (v_org, v_pat, 'blood_pressure', 150, 95, now(), 'manual');

  perform set_config('request.jwt.claims', json_build_object('sub', v_corp, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n_corp_vit  from public.vitals_readings;
  select count(*) into n_corp_prof from public.profiles;
  perform set_config('role', 'postgres', true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_hmo, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n_hmo_vit from public.vitals_readings;
  perform set_config('role', 'postgres', true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n_clin_vit from public.vitals_readings;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into invariant_result values
    (91, 'I9', case when n_corp_vit = 0 then 'PASS' else 'FAIL' end,
        'corporate_admin reads zero vitals_readings rows',
        '0', n_corp_vit::text),
    (92, 'I9', case when n_hmo_vit = 0 then 'PASS' else 'FAIL' end,
        'hmo_admin reads zero vitals_readings rows',
        '0', n_hmo_vit::text),
    (93, 'I9', case when n_corp_prof = 1 then 'PASS' else 'FAIL' end,
        'corporate_admin reads zero OTHER profiles (only itself)',
        '1', n_corp_prof::text),
    (94, 'I9', case when n_clin_vit >= 1 then 'PASS' else 'FAIL' end,
        'CONTROL — a real clinician in the same org still reads the vitals row',
        '>=1', n_clin_vit::text);
end $$;

-- ===========================================================================
-- I1 — no clinical content on an open rail (whatsapp/sms/email). GAP.
-- v3 enforces this with a CHECK on notification_templates/notification_sends
-- keyed to a content_class column. The platform's public.notifications table
-- has NO content_class column and no equivalent CHECK at all — this is
-- structural, not a missing row, so the "test" is proving the column's
-- absence rather than inserting a bad row. Confirmed live via
-- information_schema, not assumed from a migration diff.
--
-- This IS enforced today by CONVENTION (Non-Negotiable Business Rules: every
-- WhatsApp/SMS/email template in this codebase is deliberately non-clinical —
-- confirmations, reminders, alerts). What's missing is the DB-level backstop
-- CLAUDE.md's pivot banner names explicitly: "I1 ... as a real DB CHECK
-- rather than a convention." Fixed = a content_class column (or equivalent)
-- with a CHECK forbidding clinical + (whatsapp|sms|email) on this table.
-- ===========================================================================
do $$
declare
  v_has_content_class boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='notifications'
      and column_name in ('content_class', 'clinical_content')
  ) into v_has_content_class;

  insert into invariant_result values (
    1, 'I1', case when v_has_content_class then 'PASS' else 'GAP' end,
    'notifications carries a content-class distinction enforced by a CHECK',
    'a content_class column + CHECK exists',
    case when v_has_content_class then 'exists' else 'NO SUCH COLUMN — enforced by convention only, not by the DB' end
  );
end $$;

-- ===========================================================================
-- I5 — urgent/emergency classification cannot be closed by a text-only note;
-- closure requires a linked synchronous contact (voice call / video
-- consult). GAP.
--
-- Platform equivalent of "urgent/emergency": clinician_alerts.level =
-- 'emergency' (the highest of routine/clinician_review/urgent_escalation/
-- emergency). Platform equivalent of "closed by a text-only note":
-- escalations.status -> 'resolved' with only resolution_note set. There is
-- no trigger or CHECK on escalations requiring a linked video_consultations
-- row (the platform's synchronous-contact table) before that transition is
-- allowed — proven live: the resolve succeeds with nothing but a note.
--
-- Fixed = a BEFORE UPDATE trigger on escalations, mirroring
-- enforce_medication_confirm_only's shape, that raises when status is being
-- set to 'resolved' on an escalation linked to an 'emergency'-level alert
-- unless a video_consultations row for the same patient exists with
-- started_at between the escalation's creation and now.
-- ===========================================================================
do $$
declare
  v_org         uuid := '00000000-0000-0000-0000-000000000001';
  v_pat         uuid;
  v_clin        uuid;
  v_alert_id    uuid;
  v_esc_id      uuid;
  v_resolved    boolean := false;
begin
  select id into v_pat  from public.profiles where role='patient'   and organisation_id=v_org limit 1;
  select id into v_clin from public.profiles where role='clinician' and organisation_id=v_org limit 1;

  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title)
  values (v_org, v_pat, 'emergency', 'open', 'I5 GAP-PROOF FIXTURE — emergency alert')
  returning id into v_alert_id;

  insert into public.escalations
    (organisation_id, patient_id, clinician_alert_id, status, raised_by, reason)
  values (v_org, v_pat, v_alert_id, 'open', v_clin, 'I5 gap-proof fixture')
  returning id into v_esc_id;

  -- The forbidden path: close a text-only note on an EMERGENCY escalation,
  -- with zero linked synchronous contact of any kind.
  update public.escalations
  set status = 'resolved',
      resolution_note = 'Text-only closure with no call, no video consult, nothing synchronous',
      reviewed_by = v_clin,
      reviewed_at = now()
  where id = v_esc_id;

  select (status = 'resolved') into v_resolved from public.escalations where id = v_esc_id;

  insert into invariant_result values (
    5, 'I5', case when v_resolved then 'GAP' else 'PASS' end,
    'an emergency-level escalation can be resolved by a text-only note with no synchronous contact',
    'rejected (requires a linked voice/video contact)',
    case when v_resolved then 'ACCEPTED — REAL GAP, matches CLAUDE.md PORT IT IN list' else 'rejected' end
  );
end $$;

-- ===========================================================================
-- I14 — a device-linked reading cannot be edited by a patient (tested
-- alongside I1-I9 in the source file, same "no unknown mutation path"
-- family as I3). GAP, and a genuine new finding — not previously named in
-- CLAUDE.md.
--
-- v3 has no UPDATE policy for patients on readings at all (a correction is
-- always a new row). The platform's vitals_readings_update RLS policy is
-- source-blind: `patient_id = auth.uid() OR is_org_staff(...)`, with no
-- clause distinguishing source='device' from source='manual'. Proven live: a
-- patient session can flip the systolic value on their own device-sourced
-- reading.
--
-- Fixed = either (a) tighten vitals_readings_update's WITH CHECK to also
-- require source = 'manual' (or NOT be updating a device/wearable-sourced
-- row), or (b) a founder decision that patient edit of device readings is
-- intentional platform behaviour and I14 does not apply here — this is a
-- product question, not purely an engineering one, since it changes real
-- patient-facing behaviour rather than closing a pure oversight.
-- ===========================================================================
do $$
declare
  v_org      uuid := '00000000-0000-0000-0000-000000000001';
  v_pat      uuid;
  v_dev_id   uuid;
  v_affected int;
begin
  select id into v_pat from public.profiles where role='patient' and organisation_id=v_org limit 1;

  insert into public.vitals_readings
    (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (v_org, v_pat, 'blood_pressure', 118, 76, now(), 'device')
  returning id into v_dev_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.vitals_readings set systolic = 999 where id = v_dev_id;
  get diagnostics v_affected = row_count;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into invariant_result values (
    14, 'I14', case when v_affected = 0 then 'PASS' else 'GAP' end,
    'a patient can directly edit their own device-sourced vitals_readings row',
    '0 rows affected (device readings immutable by the patient)',
    case when v_affected = 0 then '0 rows affected' else v_affected::text || ' row(s) affected — REAL GAP, product decision needed' end
  );
end $$;

select ord, invariant, verdict, check_name, expected, observed
from invariant_result order by ord;

-- This file intentionally does NOT raise on GAP/PARTIAL/N/A — those are
-- documented, expected states, not a bug in this test. It DOES raise if a
-- PASS-track check flips to FAIL, which would mean something already-proven
-- regressed.
do $$
declare
  v_failed text;
begin
  select string_agg(ord::text || ' (' || check_name || ')', '; ' order by ord)
    into v_failed
  from invariant_result where verdict = 'FAIL';

  if v_failed is not null then
    raise exception 'invariant suite REGRESSED on check(s): %', v_failed;
  end if;
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- I7 — export always available regardless of subscription. Verified
-- separately, not in the SQL above: this is an absence-of-gate fact in
-- application code, not a DB-level invariant. Confirmed by reading
-- apps/web/src/app/api/patient/health-passport/pdf/route.ts, which contains
-- no requireEntitlement/has_feature_access call — Health Passport export is
-- reachable by every patient regardless of plan. Contrast with
-- apps/web/src/app/api/patient/quarterly-report/pdf/route.ts, which
-- correctly DOES gate on has_feature_access('quarterly_report') — that one
-- is a genuinely paid, tier-specific report (Complete Care+), not the same
-- "always-available export" I7 protects. If a future change adds an
-- entitlement check to the health-passport route, that is the moment to
-- re-check this invariant.
--
-- I2, I6, I11, I12, I13 — unchanged from the source file's own deferral,
-- confirmed still accurate against the current platform:
--   I2  needs a rigid one-reading-to-one-classification join the platform
--       does not have; the abnormal-result Cat2->1 pipeline is the real
--       functional analogue but a structurally different shape, not a
--       faithful port of this invariant.
--   I6  no compensation model on the platform ties pay to escalation counts
--       at all (checked: no code path references clinician pay/comp
--       alongside escalations/clinician_alerts) — vacuously true, nothing
--       to test either way.
--   I11/I12/I13  Phase 2 concepts (ai_drafts, titration_proposals, research
--       export governance) with no platform tables yet.
-- ---------------------------------------------------------------------------
