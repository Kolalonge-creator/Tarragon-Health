-- ===========================================================================
-- Verification: Specialist Care Coordination & Continuity Engine
-- (specialist_consultation_documents, specialist_consultation_extractions,
-- specialist_referral_action_items, confirm_specialist_consultation_extraction,
-- enforce_referral_closure).
--
-- Run via `supabase db query --linked -f <this file>`, `psql $DATABASE_URL -f
-- <this file>`, or the Supabase SQL editor. NOT YET EXECUTED against a live
-- database as of writing (no local Postgres/Docker and no migrations applied
-- to a remote project in this session) — run this before treating this
-- module's RLS/closure gating as proven, not just written to the same
-- pattern as a proven test (see packages/db/tests/ecg_report_rls.sql, which
-- this mirrors).
--
-- Wrapped in BEGIN/ROLLBACK — a verification script, not seed data; it
-- always leaves the database exactly as it found it.
--
-- WHY EVERY NEGATIVE IS PAIRED WITH A POSITIVE (checks 5/6 are the controls
-- for checks 3/4) — an always-empty table or an over-broad "nobody can read
-- anything" policy would otherwise score identically to a correct one.
--
-- This also end-to-end proves the whole point of the module (spec §70.12):
-- a referral cannot reach 'completed' with no plan on file (check 1), still
-- cannot with the plan filed but an action item still open (check 11), and
-- CAN once that item is resolved (check 12) — the exact AND-gate the spec
-- describes, not just "a trigger exists".
-- ===========================================================================

begin;

create temporary table scc_result(
  ord        int primary key,
  check_name text,
  expected   text,
  observed   text,
  verdict    text
) on commit drop;

do $$
declare
  v_org           uuid := '00000000-0000-0000-0000-000000000001';
  v_pat_a         uuid;
  v_pat_b         uuid;
  v_clin          uuid;
  v_staff         uuid;
  v_referral      uuid;
  v_doc_a         uuid;
  v_extraction    uuid;
  v_task_id       uuid;
  n_docs          int;
  n_docs_b        int;
  n_extractions   int;
  n_extractions_clin int;
  v_closure_blocked_empty boolean := false;
  v_action_insert_blocked boolean := false;
  v_confirm_result jsonb;
  v_treatment_plan_at timestamptz;
  v_plan_ack_at   timestamptz;
  v_plan_ack_by   uuid;
  n_action_items  int;
  v_linked_task   uuid;
  v_closure_blocked_open_item boolean := false;
  v_closed_status text;
begin
  -- ------------------------------------------------------------------------
  -- Fixtures (as the connecting superuser, RLS bypassed)
  -- ------------------------------------------------------------------------
  select id into v_pat_a from public.profiles
    where role = 'patient' and organisation_id = v_org order by id limit 1;
  select id into v_pat_b from public.profiles
    where role = 'patient' and organisation_id = v_org and id <> v_pat_a order by id limit 1;
  select id into v_clin from public.profiles
    where role = 'clinician' and organisation_id = v_org order by id limit 1;

  if v_pat_a is null or v_pat_b is null or v_clin is null then
    raise exception 'fixtures unavailable: need 2 patients and 1 clinician in org 0001';
  end if;

  select id into v_staff from public.clinical_staff where profile_id = v_clin;
  if v_staff is null then
    insert into public.clinical_staff
      (organisation_id, profile_id, full_name, doctor_tier, active,
       license_verified_at, verified_by)
    values
      (v_org, v_clin, 'VERIFY Specialist Coordination Clinician', 'tier_2', true, now(), v_pat_a)
    returning id into v_staff;
  else
    update public.clinical_staff
       set active = true, organisation_id = v_org, doctor_tier = 'tier_2'
     where id = v_staff;
  end if;

  insert into public.specialist_referrals
    (organisation_id, patient_id, specialist_type, status, fulfilment)
  values (v_org, v_pat_a, 'cardiology', 'booked', 'self_arranged')
  returning id into v_referral;

  -- ------------------------------------------------------------------------
  -- Check 1: closing a referral with NO plan on file at all is blocked.
  -- ------------------------------------------------------------------------
  begin
    update public.specialist_referrals set status = 'completed' where id = v_referral;
    v_closure_blocked_empty := false;
  exception when others then
    v_closure_blocked_empty := true;
  end;

  -- ------------------------------------------------------------------------
  -- Check 2-3: patient A uploads their own report against their own referral
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pat_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.specialist_consultation_documents
    (referral_id, file_path, mime_type, source)
  values (v_referral, v_pat_a::text || '/verify-report.pdf', 'application/pdf', 'patient')
  returning id into v_doc_a;

  select count(*) into n_docs from public.specialist_consultation_documents where id = v_doc_a;

  perform set_config('role', 'postgres', true);

  -- ------------------------------------------------------------------------
  -- Check 4: patient B cannot read patient A's document
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pat_b, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n_docs_b from public.specialist_consultation_documents where id = v_doc_a;

  perform set_config('role', 'postgres', true);

  -- ------------------------------------------------------------------------
  -- Fixture: a drafted extraction (as superuser — no insert policy on this
  -- table at all, service-role/RPC only, matching the real pipeline).
  -- ------------------------------------------------------------------------
  insert into public.specialist_consultation_extractions
    (organisation_id, patient_id, referral_id, document_id, status, model_id, diagnosis, recommendations)
  values (
    v_org, v_pat_a, v_referral, v_doc_a, 'extracted', 'verify-fixture', 'Stable angina',
    '[{"description":"Repeat ECG in 3 months","action_type":"follow_up_appointment","suggested_due_days":90,"confidence":"high"}]'::jsonb
  )
  returning id into v_extraction;

  -- ------------------------------------------------------------------------
  -- Check 5: patient A cannot read the unconfirmed extraction of their OWN report
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pat_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n_extractions from public.specialist_consultation_extractions where id = v_extraction;

  -- ------------------------------------------------------------------------
  -- Check 6 (negative, in patient A's session): a patient may not directly
  -- insert a specialist_referral_action_items row — only clinical-tier staff
  -- may (the routing trigger itself raises, RLS admits then the trigger
  -- narrows).
  -- ------------------------------------------------------------------------
  begin
    insert into public.specialist_referral_action_items (referral_id, action_type, description)
    values (v_referral, 'other', 'patient attempting to self-file an action item');
    v_action_insert_blocked := false;
  exception when others then
    v_action_insert_blocked := true;
  end;

  perform set_config('role', 'postgres', true);

  -- ------------------------------------------------------------------------
  -- Check 7 CONTROL: clinician CAN read the extraction draft.
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n_extractions_clin from public.specialist_consultation_extractions where id = v_extraction;

  -- ------------------------------------------------------------------------
  -- Check 8-10: clinician confirms the extraction — files the referral and
  -- creates + routes one action item.
  -- ------------------------------------------------------------------------
  select public.confirm_specialist_consultation_extraction(
    v_extraction,
    'Stable angina, on beta-blocker',
    '[{"description":"Repeat ECG in 3 months","action_type":"follow_up_appointment"}]'::jsonb,
    90,
    null
  ) into v_confirm_result;

  select treatment_plan_received_at, plan_acknowledged_at, plan_acknowledged_by
    into v_treatment_plan_at, v_plan_ack_at, v_plan_ack_by
  from public.specialist_referrals where id = v_referral;

  select count(*), max(linked_outreach_task_id) into n_action_items, v_linked_task
  from public.specialist_referral_action_items where referral_id = v_referral;

  -- ------------------------------------------------------------------------
  -- Check 11: closure is STILL blocked — the routed action item's downstream
  -- care_outreach_tasks row is still open.
  -- ------------------------------------------------------------------------
  begin
    update public.specialist_referrals set status = 'completed' where id = v_referral;
    v_closure_blocked_open_item := false;
  exception when others then
    v_closure_blocked_open_item := true;
  end;

  -- ------------------------------------------------------------------------
  -- Check 12-13: resolve the routed task, then closure succeeds.
  -- ------------------------------------------------------------------------
  update public.care_outreach_tasks set status = 'resolved' where id = v_linked_task;

  update public.specialist_referrals set status = 'completed' where id = v_referral;
  select status into v_closed_status from public.specialist_referrals where id = v_referral;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  -- ------------------------------------------------------------------------
  -- Results
  -- ------------------------------------------------------------------------
  insert into scc_result values
    (1, 'referral cannot close with no plan on file at all',
        'true', v_closure_blocked_empty::text,
        case when v_closure_blocked_empty then 'PASS' else 'FAIL' end),
    (2, 'patient A: own patient-sourced INSERT into specialist_consultation_documents succeeds',
        '1', n_docs::text,
        case when n_docs = 1 then 'PASS' else 'FAIL' end),
    (3, 'patient A: can read the document they just uploaded',
        '1', n_docs::text,
        case when n_docs = 1 then 'PASS' else 'FAIL' end),
    (4, 'patient B: cannot read patient A''s specialist_consultation_documents row',
        '0', n_docs_b::text,
        case when n_docs_b = 0 then 'PASS' else 'FAIL' end),
    (5, 'patient A: cannot read the unconfirmed extraction of their own report',
        '0', n_extractions::text,
        case when n_extractions = 0 then 'PASS' else 'FAIL' end),
    (6, 'patient session: direct INSERT into specialist_referral_action_items is blocked',
        'true', v_action_insert_blocked::text,
        case when v_action_insert_blocked then 'PASS' else 'FAIL' end),
    (7, 'CONTROL — clinician CAN read the extraction draft',
        '1', n_extractions_clin::text,
        case when n_extractions_clin = 1 then 'PASS' else 'FAIL' end),
    (8, 'confirm RPC reports 1 action item created',
        '1', coalesce((v_confirm_result->>'action_items_created'), 'null'),
        case when (v_confirm_result->>'action_items_created') = '1' then 'PASS' else 'FAIL' end),
    (9, 'confirm RPC stamps treatment_plan_received_at + plan_acknowledged_at/by (never client-trusted)',
        'not null/not null/' || v_clin::text,
        (v_treatment_plan_at is not null)::text || '/' || (v_plan_ack_at is not null)::text || '/' || coalesce(v_plan_ack_by::text, 'null'),
        case when v_treatment_plan_at is not null and v_plan_ack_at is not null and v_plan_ack_by = v_clin
          then 'PASS' else 'FAIL' end),
    (10, 'exactly 1 specialist_referral_action_items row created and routed to care_outreach_tasks',
        '1/not null', n_action_items::text || '/' || (v_linked_task is not null)::text,
        case when n_action_items = 1 and v_linked_task is not null then 'PASS' else 'FAIL' end),
    (11, 'referral still cannot close while the routed action item is unresolved',
        'true', v_closure_blocked_open_item::text,
        case when v_closure_blocked_open_item then 'PASS' else 'FAIL' end),
    (12, 'referral closes once the routed action item is resolved',
        'completed', v_closed_status,
        case when v_closed_status = 'completed' then 'PASS' else 'FAIL' end);
end $$;

select ord, verdict, check_name, expected, observed
from scc_result order by ord;

do $$
declare
  v_failed text;
begin
  select string_agg(ord::text || ' (' || check_name || ')', '; ' order by ord)
    into v_failed
  from scc_result where verdict = 'FAIL';

  if v_failed is not null then
    raise exception 'specialist care coordination verification FAILED on check(s): %', v_failed;
  end if;
end $$;

rollback;
