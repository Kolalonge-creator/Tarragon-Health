-- Tarragon Health
-- Live proof for 20260730094515_i1_notifications_content_class.sql
-- (the I1 v3-port fix), re-expressed 2026-09-30 after the retired chat channel was
-- removed (the open-rail CHECK now covers sms and email only). Six cases plus a
-- sabotage step, in one rolled-back transaction:
--   1-2. content_class = 'clinical' + channel in (sms, email) -> BLOCKED (23514)
--   3-4. content_class = 'clinical' + channel in (in_app, push) -> ALLOWED
--        (in_app and push are the rails that may carry clinical content)
--   5.   no content_class specified (every existing insert path's real
--        pattern) + channel = 'sms' -> ALLOWED, defaults to 'non_clinical'
--        -- proves zero regression for the many existing trigger functions
--        that insert into notifications today.
--   6.   SABOTAGE: drop the CHECK and case 1 must now be ALLOWED, proving
--        the BLOCKED result in case 1 is the constraint's doing.
-- The old chat-channel case is deleted: that enum value no longer exists.
--
-- Run: npx supabase db query --linked -f packages/db/tests/i1_notifications_content_class.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_pat uuid;
  v_blocked boolean;
  v_err text;
  v_cc text;
begin
  select id into v_pat from public.profiles where role='patient' and organisation_id=v_org limit 1;
  if v_pat is null then raise exception 'VACUOUS: no patient fixture found'; end if;

  v_blocked := false;
  begin
    insert into public.notifications (organisation_id, recipient_id, channel, template, content_class)
    values (v_org, v_pat, 'sms', 'i1_proof_case1', 'clinical');
  exception when check_violation then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  insert into test_result values (1, 'clinical + sms -> insert', case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, 'no exception'));
  if not v_blocked then raise exception 'FAIL 1: clinical content was accepted on sms'; end if;

  v_blocked := false;
  begin
    insert into public.notifications (organisation_id, recipient_id, channel, template, content_class)
    values (v_org, v_pat, 'email', 'i1_proof_case2', 'clinical');
  exception when check_violation then
    v_blocked := true;
  end;
  insert into test_result values (2, 'clinical + email -> insert', case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, 'n/a');
  if not v_blocked then raise exception 'FAIL 2: clinical content was accepted on email'; end if;

  insert into public.notifications (organisation_id, recipient_id, channel, template, content_class)
  values (v_org, v_pat, 'in_app', 'i1_proof_case3', 'clinical');
  insert into test_result values (3, 'clinical + in_app -> insert', 'ALLOWED (correct)', 'n/a');

  insert into public.notifications (organisation_id, recipient_id, channel, template, content_class)
  values (v_org, v_pat, 'push', 'i1_proof_case4', 'clinical');
  insert into test_result values (4, 'clinical + push -> insert', 'ALLOWED (correct)', 'n/a');

  insert into public.notifications (organisation_id, recipient_id, channel, template)
  values (v_org, v_pat, 'sms', 'i1_proof_case5_existing_pattern');
  select content_class::text into v_cc from public.notifications where template = 'i1_proof_case5_existing_pattern';
  insert into test_result values (5, 'default content_class + sms -> insert (existing pattern)', v_cc,
    'expected: non_clinical (zero code changes needed anywhere)');
  if v_cc is distinct from 'non_clinical' then
    raise exception 'FAIL 5: default content_class was %, expected non_clinical', v_cc;
  end if;

  -- 6. SABOTAGE: without the CHECK, clinical + sms would be accepted.
  alter table public.notifications drop constraint notifications_no_clinical_on_open_rail;
  v_blocked := false;
  begin
    insert into public.notifications (organisation_id, recipient_id, channel, template, content_class)
    values (v_org, v_pat, 'sms', 'i1_proof_case6_sabotage', 'clinical');
  exception when check_violation then
    v_blocked := true;
  end;
  insert into test_result values (6, 'SABOTAGE: CHECK dropped, clinical + sms -> insert', case when v_blocked then 'BLOCKED (VACUOUS)' else 'ALLOWED (proves case 1 discriminates)' end, 'n/a');
  if v_blocked then raise exception 'VACUOUS TEST: clinical + sms was still blocked with the CHECK dropped'; end if;
end $$;

select * from test_result order by case_num;

rollback;
