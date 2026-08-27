-- Tarragon Health
-- Live proof for 20260827210136_care_team_handover_audit.sql.
--
-- hand_over_care carries its note into care_team_handovers via a session-
-- local GUC (app.care_team_handover_note) that the trigger reads then clears
-- immediately — the risky part to verify is that the clear actually happens,
-- so a later plain (non-RPC) reassignment in the SAME session doesn't
-- inherit a stale note from an earlier hand_over_care call.
--
-- Cases:
--   1. hand_over_care(..., 'reason') -> handovers row carries that note
--   2. Plain UPDATE care_team_assignment right after (no RPC) -> note is
--      NULL, not the leftover string from case 1 (THE RISK THIS PROVES)
--   3. clinician_id unchanged in an UPDATE -> no new handovers row at all
--
-- TO CONFIRM THIS TEST DISCRIMINATES, break it on purpose: delete the
-- `perform set_config('app.care_team_handover_note', '', true);` line at the
-- end of log_care_team_handover. Case 2 must FAIL, showing case 1's note
-- bleeding into an unrelated later reassignment.
--
-- Run: npx supabase db query --linked -f packages/db/tests/care_team_handover.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org      uuid := '00000000-0000-0000-0000-000000000001';
  v_pat      uuid;
  v_clin_a   uuid;
  v_clin_b   uuid;
  v_clin_c   uuid;
  v_note     text;
  v_count    int;
begin
  select id into v_pat from public.profiles
   where role = 'patient' and organisation_id = v_org limit 1;

  select id into v_clin_a from public.profiles
   where organisation_id = v_org and role = 'clinician' and id <> v_pat order by id limit 1;
  select id into v_clin_b from public.profiles
   where organisation_id = v_org and role = 'clinician' and id <> v_pat and id <> v_clin_a order by id limit 1;
  select id into v_clin_c from public.profiles
   where organisation_id = v_org and role = 'clinician' and id <> v_pat and id <> v_clin_a and id <> v_clin_b order by id limit 1;

  if v_pat is null or v_clin_a is null or v_clin_b is null or v_clin_c is null then
    raise exception 'Need one patient and 3 clinician-role profiles in org %', v_org;
  end if;

  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_clin_a, now())
  on conflict (patient_id) do update set clinician_id = v_clin_a;

  ---------------------------------------------------------------- case 1
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.hand_over_care(v_pat, 'clinician', v_clin_b, 'Going on leave, handing off to Dr B');
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select note into v_note from public.care_team_handovers
   where patient_id = v_pat and role = 'clinician' and to_profile_id = v_clin_b
   order by created_at desc limit 1;
  insert into test_result values (1, 'hand_over_care carries its note',
    case when v_note = 'Going on leave, handing off to Dr B' then 'PASS' else 'FAIL' end,
    'note=' || coalesce(v_note, 'null'));

  ---------------------------------------------------------------- case 2
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin_b, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.care_team_assignment set clinician_id = v_clin_c where patient_id = v_pat;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select note into v_note from public.care_team_handovers
   where patient_id = v_pat and role = 'clinician' and to_profile_id = v_clin_c
   order by created_at desc limit 1;
  insert into test_result values (2, 'Plain reassignment right after -> note NOT inherited from case 1',
    case when v_note is null then 'PASS' else 'FAIL' end,
    'note=' || coalesce(v_note, 'null'));

  ---------------------------------------------------------------- case 3
  select count(*) into v_count from public.care_team_handovers where patient_id = v_pat;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin_c, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.care_team_assignment set assigned_at = now() where patient_id = v_pat;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (3, 'Unrelated column change (clinician_id unchanged) -> no new row',
    case when (select count(*) from public.care_team_handovers where patient_id = v_pat) = v_count
      then 'PASS' else 'FAIL' end,
    'rows_before=' || v_count || ' rows_after=' || (select count(*) from public.care_team_handovers where patient_id = v_pat));
end $$;

select
  'CASE ' || case_num || ' [' || outcome || '] ' || label ||
    case when detail = '' then '' else ' -- ' || detail end as line
from test_result
order by case_num;

rollback;
