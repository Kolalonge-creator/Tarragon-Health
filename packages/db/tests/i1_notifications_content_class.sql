-- Tarragon Health
-- Live proof for 20260730094515_i1_notifications_content_class.sql
-- (the I1 v3-port fix). Five cases in one rolled-back transaction:
--   1-3. content_class = 'clinical' + channel in (whatsapp, sms, email) -> BLOCKED (23514)
--   4. content_class = 'clinical' + channel = 'in_app' -> ALLOWED
--   5. no content_class specified (every existing insert path's real
--      pattern) + channel = 'whatsapp' -> ALLOWED, defaults to
--      'non_clinical' -- proves zero regression for the ~25 existing
--      trigger functions that insert into notifications today.
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
begin
  select id into v_pat from public.profiles where role='patient' and organisation_id=v_org limit 1;

  v_blocked := false;
  begin
    insert into public.notifications (organisation_id, recipient_id, channel, template, content_class)
    values (v_org, v_pat, 'whatsapp', 'i1_proof_case1', 'clinical');
  exception when check_violation then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  insert into test_result values (1, 'clinical + whatsapp -> insert', case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, 'no exception'));

  v_blocked := false;
  begin
    insert into public.notifications (organisation_id, recipient_id, channel, template, content_class)
    values (v_org, v_pat, 'sms', 'i1_proof_case2', 'clinical');
  exception when check_violation then
    v_blocked := true;
  end;
  insert into test_result values (2, 'clinical + sms -> insert', case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, 'n/a');

  v_blocked := false;
  begin
    insert into public.notifications (organisation_id, recipient_id, channel, template, content_class)
    values (v_org, v_pat, 'email', 'i1_proof_case3', 'clinical');
  exception when check_violation then
    v_blocked := true;
  end;
  insert into test_result values (3, 'clinical + email -> insert', case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, 'n/a');

  insert into public.notifications (organisation_id, recipient_id, channel, template, content_class)
  values (v_org, v_pat, 'in_app', 'i1_proof_case4', 'clinical');
  insert into test_result values (4, 'clinical + in_app -> insert', 'ALLOWED (correct)', 'n/a');

  insert into public.notifications (organisation_id, recipient_id, channel, template)
  values (v_org, v_pat, 'whatsapp', 'i1_proof_case5_existing_pattern');
  insert into test_result values (5, 'default content_class + whatsapp -> insert (existing pattern)',
    (select content_class::text from public.notifications where template = 'i1_proof_case5_existing_pattern'),
    'expected: non_clinical (zero code changes needed anywhere)');
end $$;

select * from test_result order by case_num;

rollback;
