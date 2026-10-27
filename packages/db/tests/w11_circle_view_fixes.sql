-- ===========================================================================
-- Proof: W-11 Care Circle supporter view fixes. NOT EXECUTED LOCALLY when written (Docker was down); CI replay is the first run.
--   1. A week with fewer than min_readings readings returns null averages (the count n stays); a week with enough returns its average.
--   2. Direction is null unless both of the last two weeks have enough readings.
--   3. Monthly block: versus_target and direction are absent while sponsor_outcome_surfaces is off, present when on; the average stays.
--   4. sponsor_outcome_surfaces exists and is OFF by default (checked before the proof turns it on).
--   5. An under-18 patient: a new member / invite is refused (42501) and an old row shows nothing (P0002).
--   6. "sponsor RPC returns nothing ungranted": a supporter holding only `appointments` gets no bp_trend, adherence or monthly; a stranger
--      and an expired supporter get circle_not_found.
--   7. SABOTAGE: the weekly null rule removed shows a single-reading average (check 1 would FAIL); the module gate removed shows
--      versus_target with the module off (check 3 would FAIL).
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
create function pg_temp.rd(p uuid, k integer, s integer, d integer) returns void language plpgsql as $$
begin
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values ((select organisation_id from public.profiles where id = p), p, 'blood_pressure', s, d, now() - make_interval(days => k), 'device');
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

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_m date := date_trunc('month', (now() at time zone 'Africa/Lagos')::date - interval '1 month')::date;
  v_cfg integer; h uuid; s1 uuid; s2 uuid; s3 uuid; st uuid; kid uuid; ksup uuid;
  v_view jsonb; v_wk jsonb; v_txt text; v_off boolean; v_def text; mem1 uuid;
begin
  -- 4 default off, before anything else touches it
  select not is_enabled into v_off from public.platform_modules where key = 'sponsor_outcome_surfaces';
  insert into w11_results values ('4 sponsor_outcome_surfaces exists and is OFF', coalesce(v_off::text, 'missing'), 'true', case when v_off then 'PASS' else 'FAIL' end);

  h := pg_temp.mkuser('W11 Patient'); s1 := pg_temp.mkuser('W11 Sup BP'); s2 := pg_temp.mkuser('W11 Sup Appts'); s3 := pg_temp.mkuser('W11 Sup Expired');
  st := pg_temp.mkuser('W11 Stranger');
  -- readings: 3 in a week two weeks ago, 1 in a week one week ago (not enough)
  perform pg_temp.rd(h, 15, 150, 90); perform pg_temp.rd(h, 15, 152, 92); perform pg_temp.rd(h, 15, 148, 88);
  perform pg_temp.rd(h, 8, 120, 80);
  select min(version) into v_cfg from public.monthly_report_config;
  insert into public.monthly_reports (organisation_id, patient_id, month, payload, config_version, is_test)
  values (v_org, h, v_m, '{"enough_readings":true,"average":{"systolic":147,"diastolic":90,"versus_target":"above"},"direction_vs_last_month":"similar","adherence_pct":80}'::jsonb, v_cfg, true);
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, monthly_report_shared) values
    (v_org, h, s1, 'daughter', array['weekly_bp_trend', 'adherence_summary'], now() + interval '30 days', true),
    (v_org, h, s2, 'friend', array['appointments'], now() + interval '30 days', false),
    (v_org, h, s3, 'cousin', array['weekly_bp_trend'], now() + interval '30 days', false);
  update public.care_circle_members set created_at = now() - interval '200 days' where patient_id = h;
  update public.care_circle_members set expires_at = now() - interval '1 day', created_at = now() - interval '200 days' where patient_id = h and supporter_id = s3;

  -- 1 / 2 weekly rule
  v_view := pg_temp.view_as(s1, h);
  select jsonb_agg(w order by w ->> 'week_start') into v_wk from jsonb_array_elements(v_view #> '{bp_trend,weeks}') w;
  insert into w11_results values ('1a a week with enough readings keeps its average', coalesce((v_wk -> 0 ->> 'systolic'), 'null'), '150',
    case when (v_wk -> 0 ->> 'systolic') = '150' and (v_wk -> 0 ->> 'readings') = '3' then 'PASS' else 'FAIL' end);
  insert into w11_results values ('1b a week with one reading returns null average and keeps n=1',
    coalesce(v_wk -> 1 ->> 'systolic', 'null') || '/' || coalesce(v_wk -> 1 ->> 'readings', 'none'), 'null/1',
    case when (v_wk -> 1 -> 'systolic') = 'null'::jsonb and (v_wk -> 1 ->> 'readings') = '1' then 'PASS' else 'FAIL' end);
  insert into w11_results values ('2 direction is null when the latest week lacks readings', coalesce(v_view #>> '{bp_trend,direction}', 'null'), 'null',
    case when (v_view #> '{bp_trend,direction}') = 'null'::jsonb then 'PASS' else 'FAIL' end);

  -- 3 monthly gate
  v_txt := (v_view #> '{monthly,0}')::text;
  insert into w11_results values ('3a module off: average kept, no versus_target, no direction',
    coalesce(v_view #>> '{monthly,0,average,systolic}', 'none') || '/' || (v_txt ~ 'versus_target')::text || '/' || (v_txt ~ 'direction')::text, '147/false/false',
    case when v_view #>> '{monthly,0,average,systolic}' = '147' and v_txt !~ 'versus_target' and v_txt !~ 'direction' then 'PASS' else 'FAIL' end);
  update public.platform_modules set is_enabled = true where key = 'sponsor_outcome_surfaces';
  v_view := pg_temp.view_as(s1, h);
  insert into w11_results values ('3b module on: versus_target and direction present',
    coalesce(v_view #>> '{monthly,0,average,versus_target}', 'none') || '/' || coalesce(v_view #>> '{monthly,0,direction}', 'none'), 'above/similar',
    case when v_view #>> '{monthly,0,average,versus_target}' = 'above' and v_view #>> '{monthly,0,direction}' = 'similar' then 'PASS' else 'FAIL' end);
  update public.platform_modules set is_enabled = false where key = 'sponsor_outcome_surfaces';

  -- 6 nothing ungranted
  v_view := pg_temp.view_as(s2, h);
  insert into w11_results values ('6a a supporter with only appointments gets no bp_trend, adherence or monthly',
    (v_view ? 'bp_trend')::text || '/' || (v_view ? 'adherence')::text || '/' || (v_view ? 'monthly')::text, 'false/false/false',
    case when not (v_view ? 'bp_trend') and not (v_view ? 'adherence') and not (v_view ? 'monthly') and v_view ? 'appointments' then 'PASS' else 'FAIL' end);
  v_view := pg_temp.view_as(st, h);
  insert into w11_results values ('6b a stranger is refused', coalesce(v_view ->> 'error', 'allowed'), 'P0002', case when v_view ->> 'error' = 'P0002' then 'PASS' else 'FAIL' end);
  v_view := pg_temp.view_as(s3, h);
  insert into w11_results values ('6c an expired supporter is refused', coalesce(v_view ->> 'error', 'allowed'), 'P0002', case when v_view ->> 'error' = 'P0002' then 'PASS' else 'FAIL' end);

  -- 5 under 18
  kid := pg_temp.mkuser('W11 Kid', (current_date - interval '10 years')::date);
  ksup := pg_temp.mkuser('W11 Kid Supporter');
  begin
    insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at)
    values (v_org, kid, ksup, 'aunt', array['appointments'], now() + interval '30 days');
    insert into w11_results values ('5a a member for an under-18 patient is refused', 'allowed', 'refused', 'FAIL');
  exception when sqlstate '42501' then insert into w11_results values ('5a a member for an under-18 patient is refused', 'refused', 'refused', 'PASS'); end;
  begin
    insert into public.care_circle_invites (organisation_id, patient_id, invitee_kind, invitee_hash, invitee_hint, relationship, permissions, grant_days, token_hash, expires_at)
    values (v_org, kid, 'email', repeat('a', 64), 'x', 'aunt', array['appointments'], 30, repeat('b', 64), now() + interval '3 days');
    insert into w11_results values ('5b an invite for an under-18 patient is refused', 'allowed', 'refused', 'FAIL');
  exception when sqlstate '42501' then insert into w11_results values ('5b an invite for an under-18 patient is refused', 'refused', 'refused', 'PASS');
            when others then insert into w11_results values ('5b an invite for an under-18 patient is refused', sqlstate, '42501', 'FAIL'); end;
  -- a row that predates the trigger: insert as an adult, then the patient's date of birth is a minor's
  update public.profiles set date_of_birth = (current_date - interval '10 years')::date where id = h;
  v_view := pg_temp.view_as(s1, h);
  insert into w11_results values ('5c an existing circle for an under-18 patient shows nothing', coalesce(v_view ->> 'error', 'allowed'), 'P0002',
    case when v_view ->> 'error' = 'P0002' then 'PASS' else 'FAIL' end);
  update public.profiles set date_of_birth = date '1970-01-01' where id = h;

  -- 7 SABOTAGE
  v_def := pg_get_functiondef('private.circle_view_blocks_core(uuid,text[])'::regprocedure);
  execute replace(v_def, 'case when w.n >= v_min then w.sys end', 'w.sys');
  v_view := pg_temp.view_as(s1, h);
  select jsonb_agg(w order by w ->> 'week_start') into v_wk from jsonb_array_elements(v_view #> '{bp_trend,weeks}') w;
  insert into w11_results values ('7a SABOTAGE: without the null rule a single reading shows as an average (1b would FAIL)', coalesce(v_wk -> 1 ->> 'systolic', 'null'), '120',
    case when (v_wk -> 1 ->> 'systolic') = '120' then 'PASS' else 'FAIL' end);
  v_def := pg_get_functiondef('private.circle_monthly_block(uuid,text[])'::regprocedure);
  execute replace(v_def, 'case when v_outcomes then r.payload #>> ''{average,versus_target}'' end', 'r.payload #>> ''{average,versus_target}''');
  v_view := pg_temp.view_as(s1, h);
  insert into w11_results values ('7b SABOTAGE: without the module gate versus_target shows with the module off (3a would FAIL)', coalesce(v_view #>> '{monthly,0,average,versus_target}', 'none'), 'above',
    case when v_view #>> '{monthly,0,average,versus_target}' = 'above' then 'PASS' else 'FAIL' end);
end $$;

select * from w11_results order by check_name;
do $$ begin
  if exists (select 1 from w11_results where verdict = 'FAIL') then raise exception 'W-11 proof: % check(s) FAILED', (select count(*) from w11_results where verdict = 'FAIL'); end if;
end $$;
rollback;
