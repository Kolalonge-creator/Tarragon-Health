-- Tarragon Health
-- Live proof for 20260827204355_result_acknowledgement_status.sql — the
-- acknowledgement_status guard must be enforced by the trigger itself, not
-- merely by mark_result_document_action_completed's own check. RLS on
-- lab_result_documents (for update to authenticated using (is_org_staff))
-- has no column restriction, so any org-staff account can attempt a raw
-- UPDATE setting action_completed_at directly, skipping the RPC entirely.
--
-- Cases (each negative paired with a positive control):
--   1. Direct UPDATE spoofing acknowledgement_status='action_completed'
--      (no action_completed_at set)                  -> has NO effect, status stays 'new'
--   2. Direct UPDATE setting action_completed_at while status='new'
--      (skipping action_required)                     -> BLOCKED 22023
--   3. reviewed_at set with next_steps                 -> status becomes 'action_required'
--   4. From action_required, action_completed_at set   -> status becomes 'action_completed' (THE FIX)
--
-- TO CONFIRM THIS TEST DISCRIMINATES, break it on purpose: remove the
-- `if old.acknowledgement_status <> 'action_required' then raise exception`
-- guard from enforce_lab_result_document_update. Case 2 must FAIL, showing
-- a document jumping straight from 'new' to 'action_completed'.
--
-- Run: npx supabase db query --linked -f packages/db/tests/result_acknowledgement_status.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org     uuid := '00000000-0000-0000-0000-000000000001';
  v_pat     uuid;
  v_staff   uuid;
  v_doc     uuid;
  v_status  text;
  v_blocked boolean;
begin
  select id into v_pat from public.profiles
   where role = 'patient' and organisation_id = v_org limit 1;
  select p.id into v_staff from public.profiles p
   where p.organisation_id = v_org and p.role = 'clinician' and p.id <> v_pat
   limit 1;

  if v_pat is null or v_staff is null then
    raise exception 'Need one patient and one clinician-role profile in org %', v_org;
  end if;

  insert into public.lab_result_documents
    (organisation_id, patient_id, file_path, source, uploaded_by)
  values
    (v_org, v_pat, 'probe/ack-status.pdf', 'clinician', v_staff)
  returning id into v_doc;

  ---------------------------------------------------------------- case 1
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.lab_result_documents
    set acknowledgement_status = 'action_completed'
    where id = v_doc;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select acknowledgement_status::text into v_status from public.lab_result_documents where id = v_doc;
  insert into test_result values (1, 'Direct status spoof (no action_completed_at) -> has no effect',
    case when v_status = 'new' then 'PASS' else 'FAIL' end,
    'acknowledgement_status=' || v_status);

  ---------------------------------------------------------------- case 2
  v_blocked := false;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    update public.lab_result_documents
      set action_completed_at = now()
      where id = v_doc;
  exception when others then
    v_blocked := true;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select acknowledgement_status::text into v_status from public.lab_result_documents where id = v_doc;
  insert into test_result values (2, 'Direct action_completed_at from new -> BLOCKED',
    case when v_blocked and v_status = 'new' then 'PASS' else 'FAIL' end,
    'blocked=' || v_blocked || ' acknowledgement_status=' || v_status);

  ---------------------------------------------------------------- case 3
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.lab_result_documents
    set reviewed_at = now(), next_steps = 'Repeat FBC in 3 months'
    where id = v_doc;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select acknowledgement_status::text into v_status from public.lab_result_documents where id = v_doc;
  insert into test_result values (3, 'Reviewed with next_steps -> action_required',
    case when v_status = 'action_required' then 'PASS' else 'FAIL' end,
    'acknowledgement_status=' || v_status);

  ---------------------------------------------------------------- case 4
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.mark_result_document_action_completed(v_doc);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select acknowledgement_status::text into v_status from public.lab_result_documents where id = v_doc;
  insert into test_result values (4, 'mark_result_document_action_completed from action_required -> action_completed (THE FIX)',
    case when v_status = 'action_completed' then 'PASS' else 'FAIL' end,
    'acknowledgement_status=' || v_status);
end $$;

select
  'CASE ' || case_num || ' [' || outcome || '] ' || label ||
    case when detail = '' then '' else ' -- ' || detail end as line
from test_result
order by case_num;

rollback;
