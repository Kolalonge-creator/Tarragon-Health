-- ===========================================================================
-- Proof: W-11 Care Circle supporter view fixes. NOT EXECUTED LOCALLY when written (Docker was down); CI replay is the first run.
--   1. Weekly BP block: n=1 and n=2 give null averages (the count stays); n=3 gives the average. Every view_weeks week is listed (a gap has
--      readings 0). Direction is null unless BOTH the current and the previous calendar week have n >= 3; consecutive qualifying weeks give it;
--      non-consecutive weeks (a gap between) give none.
--   2. Monthly block: versus_target and direction are absent while sponsor_outcome_surfaces is off (checked first, default), present when on.
--   3. A supporter holding only appointments gets no bp_trend, adherence or monthly; a stranger and an expired supporter are refused.
--   4. Under 18, judged on the Africa/Lagos date: a new member and a new invite are refused (42501); an existing circle shows nothing through
--      the supporter view AND the S69b weekly digest (both read the shared gate private.circle_member_for); the one-time revoke ends active
--      members and pending invites and writes one audit row per patient, and a second run adds nothing. A null date of birth passes unless the
--      profile is a dependant account.
--   5. SABOTAGE (each must flip its check): the n >= 3 rule removed, the direction pair moved to non-adjacent weeks, the minor clause removed
--      from private.circle_member_for (digest no longer refused), the minor test removed from the revoke function (members stay active),
--      the module gate removed from the monthly block.
-- BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================
begin;
create temp table w11_results (check_name text, observed text, expected text, verdict text);
grant all on w11_results to public;

create function pg_temp.mkuser(p_name text, p_dob date default date '1970-01-01') returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_org uuid := (select id from public.organisations order by created_at limit 1);
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'w11-' || replace(v::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, v_org, 'patient'::public.user_role, p_name, '+23480' || lpad((floor(random() * 99999999))::integer::text, 8, '0'), p_dob, true)
  on conflict (id) do update set full_name = excluded.full_name, date_of_birth = excluded.date_of_birth, is_test = true;
  return v;
end $$;
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); end $$;
-- a reading k weeks back (k = 0: just now), mid-week in Lagos so it cannot slip into the neighbouring week
create function pg_temp.rd(p uuid, k integer, s integer, d integer) returns void language plpgsql as $$
declare v_wk0 date := date_trunc('week', ((now() at time zone 'Africa/Lagos')::date)::timestamp)::date; v_at timestamptz;
begin
  v_at := case when k = 0 then now() - interval '1 second' else (((v_wk0 - 7 * k + 2)::timestamp + interval '12 hours') at time zone 'Africa/Lagos') end;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values ((select organisation_id from public.profiles where id = p), p, 'blood_pressure', s, d, v_at, 'device');
end $$;
create function pg_temp.view_as(p_sup uuid, p_pat uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.as_user(p_sup); execute 'set local role authenticated';
  begin r := public.circle_supporter_view(p_pat);
  exception when others then execute 'reset role'; return jsonb_build_object('error', sqlstate);
  end;
  execute 'reset role';
  return r;
end $$;
create function pg_temp.digest_as(p_sup uuid, p_pat uuid) returns text language plpgsql as $$
begin
  perform pg_temp.as_user(p_sup); execute 'set local role authenticated';
  begin perform public.circle_weekly_digest(p_pat);
  exception when others then execute 'reset role'; return sqlstate;
  end;
  execute 'reset role';
  return 'ok';
end $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into w11_results values (p_name, p_actual, p_expected, case when p_actual is not distinct from p_expected then 'PASS' else 'FAIL' end) $$;
create function pg_temp.mkcircle(p_pat uuid, p_name text, p_perms text[], p_shared boolean default false) returns uuid language plpgsql as $$
declare s uuid := pg_temp.mkuser(p_name); v_org uuid := (select organisation_id from public.profiles where id = p_pat);
begin
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, monthly_report_shared)
  values (v_org, p_pat, s, 'daughter', p_perms, now() + interval '30 days', p_shared);
  update public.care_circle_members set created_at = now() - interval '200 days' where patient_id = p_pat and supporter_id = s;
  return s;
end $$;
-- the weeks array of a view, oldest first
create function pg_temp.wk(p_view jsonb, p_back integer) returns jsonb language sql as
$$ select (p_view #> '{bp_trend,weeks}') -> (jsonb_array_length(p_view #> '{bp_trend,weeks}') - 1 - p_back) $$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_m date := date_trunc('month', (now() at time zone 'Africa/Lagos')::date - interval '1 month')::date;
  v_cfg integer; v_weeks integer := (private.circle_rules() ->> 'view_weeks')::integer;
  hA uuid; hB uuid; hC uuid; hD uuid; hM uuid; hM2 uuid; hN uuid; hK uuid; sA uuid; sB uuid; sC uuid; sD uuid; sM uuid; sM2 uuid; sAppt uuid; sExp uuid; st uuid;
  v_view jsonb; v_off boolean; v_n integer; v_def text; v_txt text; v_audit integer;
begin
  select not is_enabled into v_off from public.platform_modules where key = 'sponsor_outcome_surfaces';
  perform pg_temp.ck('2a sponsor_outcome_surfaces exists and is OFF by default', 'true', coalesce(v_off::text, 'missing'));
  select min(version) into v_cfg from public.monthly_report_config;
  if v_cfg is null then raise exception 'fixture FAIL: no monthly_report_config'; end if;
  st := pg_temp.mkuser('W11 Stranger');

  -- 1 weekly rule. hA: current week n=1, previous n=3
  hA := pg_temp.mkuser('W11 Patient A'); sA := pg_temp.mkcircle(hA, 'W11 Sup A', array['weekly_bp_trend', 'adherence_summary'], true);
  perform pg_temp.rd(hA, 0, 120, 80); perform pg_temp.rd(hA, 1, 150, 90); perform pg_temp.rd(hA, 1, 152, 92); perform pg_temp.rd(hA, 1, 148, 88);
  insert into public.monthly_reports (organisation_id, patient_id, month, payload, config_version, is_test)
  values (v_org, hA, v_m, '{"enough_readings":true,"average":{"systolic":147,"diastolic":90,"versus_target":"above"},"direction_vs_last_month":"similar","adherence_pct":80}'::jsonb, v_cfg, true);
  v_view := pg_temp.view_as(sA, hA);
  perform pg_temp.ck('1a every view_weeks week is listed, gaps included', v_weeks::text, jsonb_array_length(v_view #> '{bp_trend,weeks}')::text);
  perform pg_temp.ck('1b n=1: null average, count kept', 'null/1', coalesce(pg_temp.wk(v_view, 0) ->> 'systolic', 'null') || '/' || (pg_temp.wk(v_view, 0) ->> 'readings'));
  perform pg_temp.ck('1c n=3: the average is shown', '150/3', (pg_temp.wk(v_view, 1) ->> 'systolic') || '/' || (pg_temp.wk(v_view, 1) ->> 'readings'));
  perform pg_temp.ck('1d a week with no readings is an explicit gap', 'null/0', coalesce(pg_temp.wk(v_view, 2) ->> 'systolic', 'null') || '/' || (pg_temp.wk(v_view, 2) ->> 'readings'));
  perform pg_temp.ck('1e direction is null when the current week lacks readings', 'null', coalesce(v_view #>> '{bp_trend,direction}', 'null'));
  -- 2 monthly gate (default off)
  v_txt := (v_view #> '{monthly,0}')::text;
  perform pg_temp.ck('2b module off: average kept, no versus_target, no direction', '147/false/false',
    coalesce(v_view #>> '{monthly,0,average,systolic}', 'none') || '/' || (v_txt ~ 'versus_target')::text || '/' || (v_txt ~ 'direction')::text);
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = (select id from public.profiles order by created_at limit 1) where key = 'sponsor_outcome_surfaces';
  v_view := pg_temp.view_as(sA, hA);
  perform pg_temp.ck('2c module on: versus_target and direction present', 'above/similar',
    coalesce(v_view #>> '{monthly,0,average,versus_target}', 'none') || '/' || coalesce(v_view #>> '{monthly,0,direction}', 'none'));
  update public.platform_modules set is_enabled = false where key = 'sponsor_outcome_surfaces';

  -- hB: n=2
  hB := pg_temp.mkuser('W11 Patient B'); sB := pg_temp.mkcircle(hB, 'W11 Sup B', array['weekly_bp_trend']);
  perform pg_temp.rd(hB, 0, 130, 85); perform pg_temp.rd(hB, 0, 132, 86);
  v_view := pg_temp.view_as(sB, hB);
  perform pg_temp.ck('1f n=2: null average, count 2', 'null/2', coalesce(pg_temp.wk(v_view, 0) ->> 'systolic', 'null') || '/' || (pg_temp.wk(v_view, 0) ->> 'readings'));
  -- hC: consecutive qualifying weeks
  hC := pg_temp.mkuser('W11 Patient C'); sC := pg_temp.mkcircle(hC, 'W11 Sup C', array['weekly_bp_trend']);
  perform pg_temp.rd(hC, 0, 150, 90); perform pg_temp.rd(hC, 0, 150, 90); perform pg_temp.rd(hC, 0, 150, 90);
  perform pg_temp.rd(hC, 1, 120, 80); perform pg_temp.rd(hC, 1, 120, 80); perform pg_temp.rd(hC, 1, 120, 80);
  v_view := pg_temp.view_as(sC, hC);
  perform pg_temp.ck('1g n=3 in the current week shows the average', '150', pg_temp.wk(v_view, 0) ->> 'systolic');
  perform pg_temp.ck('1h two consecutive qualifying weeks give a direction', 'higher', coalesce(v_view #>> '{bp_trend,direction}', 'null'));
  -- hD: non-consecutive (a gap week between two qualifying weeks)
  hD := pg_temp.mkuser('W11 Patient D'); sD := pg_temp.mkcircle(hD, 'W11 Sup D', array['weekly_bp_trend']);
  perform pg_temp.rd(hD, 0, 150, 90); perform pg_temp.rd(hD, 0, 150, 90); perform pg_temp.rd(hD, 0, 150, 90);
  perform pg_temp.rd(hD, 2, 120, 80); perform pg_temp.rd(hD, 2, 120, 80); perform pg_temp.rd(hD, 2, 120, 80);
  v_view := pg_temp.view_as(sD, hD);
  perform pg_temp.ck('1i non-consecutive weeks give no direction', 'null', coalesce(v_view #>> '{bp_trend,direction}', 'null'));

  -- 3 nothing ungranted
  sAppt := pg_temp.mkcircle(hA, 'W11 Sup Appts', array['appointments']);
  v_view := pg_temp.view_as(sAppt, hA);
  perform pg_temp.ck('3a a supporter with only appointments gets no bp_trend, adherence or monthly', 'false/false/false/true',
    (v_view ? 'bp_trend')::text || '/' || (v_view ? 'adherence')::text || '/' || (v_view ? 'monthly')::text || '/' || (v_view ? 'appointments')::text);
  perform pg_temp.ck('3b a stranger is refused', 'P0002', coalesce(pg_temp.view_as(st, hA) ->> 'error', 'allowed'));
  sExp := pg_temp.mkcircle(hA, 'W11 Sup Expired', array['weekly_bp_trend']);
  update public.care_circle_members set expires_at = now() - interval '1 day' where supporter_id = sExp;
  perform pg_temp.ck('3c an expired supporter is refused', 'P0002', coalesce(pg_temp.view_as(sExp, hA) ->> 'error', 'allowed'));

  -- 4 under 18
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = (select id from public.profiles order by created_at limit 1) where key = 'care_circle_digest';
  perform pg_temp.ck('4a an adult supporter can open the digest (control)', 'ok', pg_temp.digest_as(sA, hA));
  hM := pg_temp.mkuser('W11 Minor'); sM := pg_temp.mkcircle(hM, 'W11 Minor Sup', array['weekly_bp_trend', 'appointments']);
  insert into public.care_circle_invites (organisation_id, patient_id, invitee_kind, invitee_hash, invitee_hint, relationship, permissions, grant_days, token_hash, expires_at)
  values (v_org, hM, 'email', repeat('a', 64), 'x', 'aunt', array['appointments'], 30, repeat('b', 64), now() + interval '3 days');
  update public.profiles set date_of_birth = (((now() at time zone 'Africa/Lagos')::date) - interval '10 years')::date where id = hM;
  perform pg_temp.ck('4b the supporter view of an under-18 patient is refused', 'P0002', coalesce(pg_temp.view_as(sM, hM) ->> 'error', 'allowed'));
  perform pg_temp.ck('4c the weekly digest of an under-18 patient is refused (shared gate)', 'P0002', pg_temp.digest_as(sM, hM));
  begin
    insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at)
    values (v_org, hM, st, 'friend', array['appointments'], now() + interval '30 days');
    perform pg_temp.ck('4d a new member for an under-18 patient is refused', 'allowed', 'refused');
  exception when sqlstate '42501' then perform pg_temp.ck('4d a new member for an under-18 patient is refused', 'refused', 'refused'); end;
  begin
    insert into public.care_circle_invites (organisation_id, patient_id, invitee_kind, invitee_hash, invitee_hint, relationship, permissions, grant_days, token_hash, expires_at)
    values (v_org, hM, 'email', repeat('c', 64), 'x', 'aunt', array['appointments'], 30, repeat('d', 64), now() + interval '3 days');
    perform pg_temp.ck('4e a new invite for an under-18 patient is refused', 'allowed', 'refused');
  exception when sqlstate '42501' then perform pg_temp.ck('4e a new invite for an under-18 patient is refused', 'refused', 'refused'); end;
  v_n := private.circle_revoke_minor_memberships();
  perform pg_temp.ck('4f the one-time revoke ended the circle and the invite',
    '0/0', (select count(*)::text from public.care_circle_members where patient_id = hM and state = 'active') || '/' || (select count(*)::text from public.care_circle_invites where patient_id = hM and state = 'pending'));
  select count(*) into v_audit from public.audit_log where action = 'care_circle.minor_revoked' and subject_patient_id = hM;
  perform pg_temp.ck('4g one audit row for that patient', '1', v_audit::text);
  v_n := private.circle_revoke_minor_memberships();
  select count(*) into v_audit from public.audit_log where action = 'care_circle.minor_revoked' and subject_patient_id = hM;
  perform pg_temp.ck('4h a second run adds nothing', '1', v_audit::text);
  hN := pg_temp.mkuser('W11 No DOB', null);
  perform pg_temp.ck('4i an unknown date of birth passes unless a dependant account', 'false', private.circle_patient_is_minor(hN)::text);
  update public.profiles set is_dependent_account = true where id = hN;
  perform pg_temp.ck('4j a dependant account with no date of birth is refused', 'true', private.circle_patient_is_minor(hN)::text);
  hK := pg_temp.mkuser('W11 Exactly Eighteen', (((now() at time zone 'Africa/Lagos')::date) - interval '18 years')::date);
  perform pg_temp.ck('4k a patient who turns 18 today is an adult', 'false', private.circle_patient_is_minor(hK)::text);

  -- 5 SABOTAGE
  v_def := pg_get_functiondef('private.circle_view_blocks_core(uuid,text[])'::regprocedure);
  execute replace(v_def, 'case when coalesce(w.n, 0) >= v_min then w.sys end', 'w.sys');
  v_view := pg_temp.view_as(sA, hA);
  perform pg_temp.ck('5a SABOTAGE: without the n >= 3 rule a single reading shows as an average (1b would FAIL)', '120', pg_temp.wk(v_view, 0) ->> 'systolic');
  execute v_def;   -- restore
  execute replace(v_def, '(v_bp -> -2 ->> ''systolic'')::numeric', '(v_bp -> -3 ->> ''systolic'')::numeric');
  v_view := pg_temp.view_as(sD, hD);
  perform pg_temp.ck('5b SABOTAGE: comparing non-adjacent weeks gives a direction across a gap (1i would FAIL)', 'higher', coalesce(v_view #>> '{bp_trend,direction}', 'null'));
  execute v_def;
  v_def := pg_get_functiondef('private.circle_member_for(uuid,text)'::regprocedure);
  execute replace(v_def, 'and not private.circle_patient_is_minor(m.patient_id)', '');
  update public.care_circle_members set state = 'active', revoked_at = null where patient_id = hM and supporter_id = sM;
  perform pg_temp.ck('5c SABOTAGE: without the minor clause in the shared gate the digest opens for an under-18 patient (4c would FAIL)', 'ok', pg_temp.digest_as(sM, hM));
  execute v_def;
  hM2 := pg_temp.mkuser('W11 Minor Two'); sM2 := pg_temp.mkcircle(hM2, 'W11 Minor Two Sup', array['appointments']);
  update public.profiles set date_of_birth = (((now() at time zone 'Africa/Lagos')::date) - interval '9 years')::date where id = hM2;
  v_def := pg_get_functiondef('private.circle_revoke_minor_memberships()'::regprocedure);
  execute replace(v_def, 'where private.circle_patient_is_minor(p.id)', 'where false and private.circle_patient_is_minor(p.id)');
  v_n := private.circle_revoke_minor_memberships();
  perform pg_temp.ck('5d SABOTAGE: with the minor test removed the revoke leaves the membership active (4f would FAIL)', '1',
    (select count(*)::text from public.care_circle_members where patient_id = hM2 and state = 'active'));
  execute v_def;
  v_def := pg_get_functiondef('private.circle_monthly_block(uuid,text[])'::regprocedure);
  execute replace(v_def, 'case when v_outcomes then r.payload #>> ''{average,versus_target}'' end', 'r.payload #>> ''{average,versus_target}''');
  v_view := pg_temp.view_as(sA, hA);
  perform pg_temp.ck('5e SABOTAGE: without the module gate versus_target shows with the module off (2b would FAIL)', 'above', coalesce(v_view #>> '{monthly,0,average,versus_target}', 'none'));
end $$;

select * from w11_results order by check_name;
do $$ begin
  if exists (select 1 from w11_results where verdict = 'FAIL') then raise exception 'W-11 proof: % check(s) FAILED', (select count(*) from w11_results where verdict = 'FAIL'); end if;
end $$;
rollback;
