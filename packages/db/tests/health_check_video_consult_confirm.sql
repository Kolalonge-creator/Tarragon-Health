-- Proves public.confirm_health_check_video_slot, added by
-- 20260829140114_health_check_video_consult_all_tiers.sql: the patient's
-- missing half of the annual-review video-consult handshake. A clinician
-- offering slots is a plain RLS-permitted UPDATE (org staff already have
-- UPDATE on video_consultations), but a patient has no UPDATE grant on that
-- table at all (20260716110000_video_consultations.sql: "the patient never
-- writes to this table") -- until this RPC existed, nothing let a patient
-- pick one of the offered times, on any tier, ever.
--
-- No `set local role authenticated` here: confirm_health_check_video_slot is
-- security definer and checks auth.uid() itself, so the calling Postgres
-- role never touches RLS -- same shape as sign_alert_rules in
-- alert_system_governance_and_ack_escalation.sql. Only request.jwt.claims
-- needs setting.
--
--   npx supabase db query --linked -f packages/db/tests/health_check_video_consult_confirm.sql

begin;

create temp table results (check_name text, expected text, actual text) on commit drop;

do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_owner uuid;
  v_other uuid;
  v_slot1 timestamptz := now() + interval '3 days';
  v_slot2 timestamptz := now() + interval '4 days';
  v_unoffered timestamptz := now() + interval '10 days';
  v_consult uuid;
  v_blocked boolean;
begin
  select id into v_owner from public.profiles
    where id in (select id from auth.users where email = 'patient.complete.test@tarragon.test');
  select id into v_other from public.profiles
    where id in (select id from auth.users where email = 'patient.diaspora.test@tarragon.test');

  insert into public.video_consultations (organisation_id, patient_id, context, proposed_slots)
  values (v_org, v_owner, 'annual_review', array[v_slot1, v_slot2])
  returning id into v_consult;

  -- Control: a slot never offered is rejected.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_blocked := false;
  begin
    perform public.confirm_health_check_video_slot(v_consult, v_unoffered);
  exception when others then
    v_blocked := true;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into results values ('rejects a slot that was never offered', 'true', v_blocked::text);

  -- Control: a different patient cannot confirm someone else's consult.
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  v_blocked := false;
  begin
    perform public.confirm_health_check_video_slot(v_consult, v_slot1);
  exception when others then
    v_blocked := true;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into results values ('a different patient cannot confirm this consult', 'true', v_blocked::text);

  insert into results select 'still unconfirmed after both rejected attempts', 'true',
    (select scheduled_at is null and patient_confirmed_at is null
     from public.video_consultations where id = v_consult)::text;

  -- The real path: the owning patient confirms one of the offered slots.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform public.confirm_health_check_video_slot(v_consult, v_slot1);
  perform set_config('request.jwt.claims', '', true);

  insert into results select 'confirming sets scheduled_at to the chosen slot', v_slot1::text,
    (select scheduled_at::text from public.video_consultations where id = v_consult);
  insert into results select 'confirming stamps patient_confirmed_at', 'true',
    (select patient_confirmed_at is not null from public.video_consultations where id = v_consult)::text;

  -- Control: cannot re-confirm (pick a different time) once already scheduled.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_blocked := false;
  begin
    perform public.confirm_health_check_video_slot(v_consult, v_slot2);
  exception when others then
    v_blocked := true;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into results values ('cannot re-confirm an already-scheduled consult', 'true', v_blocked::text);
end $$;

select check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results order by check_name;

-- All 6 rows above should read PASS. Rolled back: no video_consultations
-- residue survives from this test.
rollback;
