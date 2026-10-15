-- ===========================================================================
-- Proof: S75 A5 (CMO decision S-21): the monthly report reaches a Care Circle supporter only when the patient turns it on for that supporter.
--   1. A supporter with the weekly ticks and the default flag sees NO monthly block (an existing supporter loses it until opted in).
--   2. The patient turns the flag on for that supporter: the supporter sees the monthly block. Off again: gone.
--   3. The flag does not widen permission: flag on but no weekly tick shows nothing; only the ticked part appears.
--   4. The patient's "see what they see" preview follows the flag.
--   5. Only the patient can set it, and only on their own active member; the supporter, a stranger and anon are refused.
--   6. my_care_circle returns the flag per member.
--   7. SABOTAGE: circle_monthly_block ignoring the flag shows the block to a supporter who was never opted in (check 1 would FAIL).
-- BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================
begin;
create temp table s75a5_results (check_name text, observed text, expected text, verdict text);
grant all on s75a5_results to public;

create function pg_temp.mkuser(p_role text, p_name text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_org uuid := (select id from public.organisations order by created_at limit 1);
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's75a5-' || replace(v::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone)
  values (v, v_org, p_role::public.user_role, p_name, '+23480' || lpad((floor(random() * 99999999))::integer::text, 8, '0'))
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;
  return v;
end $$;
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); end $$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_m date := date_trunc('month', (now() at time zone 'Africa/Lagos')::date - interval '1 month')::date;
  h uuid; s1 uuid; s2 uuid; st uuid; mem1 uuid; mem2 uuid; v_view jsonb; v_prev jsonb; v_b boolean; v_cfg integer; v_txt text;
begin
  h := pg_temp.mkuser('patient', 'S75A5 Patient'); s1 := pg_temp.mkuser('patient', 'S75A5 Sup One'); s2 := pg_temp.mkuser('patient', 'S75A5 Sup Two');
  st := pg_temp.mkuser('patient', 'S75A5 Stranger');
  select min(version) into v_cfg from public.monthly_report_config;
  if v_cfg is null then raise exception 'fixture FAIL: no monthly_report_config'; end if;
  insert into public.monthly_reports (organisation_id, patient_id, month, payload, config_version, is_test)
  values (v_org, h, v_m, '{"enough_readings":true,"average":{"systolic":147,"diastolic":90,"versus_target":"above"},"direction_vs_last_month":"similar","adherence_pct":80}'::jsonb, v_cfg, true);

  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at) values
    (v_org, h, s1, 'daughter', array['weekly_bp_trend', 'adherence_summary'], now() + interval '30 days'),
    (v_org, h, s2, 'friend', array['appointments'], now() + interval '30 days');
  update public.care_circle_members set created_at = now() - interval '200 days' where patient_id = h;
  select id into mem1 from public.care_circle_members where patient_id = h and supporter_id = s1;
  select id into mem2 from public.care_circle_members where patient_id = h and supporter_id = s2;

  -- 1 default off
  perform pg_temp.as_user(s1); execute 'set local role authenticated';
  v_view := public.circle_supporter_view(h);
  execute 'reset role';
  insert into s75a5_results values ('1 default flag: a supporter with the weekly ticks sees no monthly block', (v_view ? 'monthly')::text, 'false', case when not (v_view ? 'monthly') then 'PASS' else 'FAIL' end);

  -- 5 who may set it
  perform pg_temp.as_user(s1); execute 'set local role authenticated';
  begin perform public.set_circle_monthly_report_share(mem1, true); insert into s75a5_results values ('5a the supporter cannot turn it on for themself', 'allowed', 'refused', 'FAIL');
  exception when sqlstate 'P0002' then insert into s75a5_results values ('5a the supporter cannot turn it on for themself', 'refused', 'refused', 'PASS'); end;
  execute 'reset role';
  perform pg_temp.as_user(st); execute 'set local role authenticated';
  begin perform public.set_circle_monthly_report_share(mem1, true); insert into s75a5_results values ('5b a stranger cannot', 'allowed', 'refused', 'FAIL');
  exception when sqlstate 'P0002' then insert into s75a5_results values ('5b a stranger cannot', 'refused', 'refused', 'PASS'); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  begin execute 'set local role anon'; perform public.set_circle_monthly_report_share(mem1, true); insert into s75a5_results values ('5c anon cannot', 'allowed', 'refused', 'FAIL');
  exception when others then insert into s75a5_results values ('5c anon cannot', 'refused', 'refused', 'PASS'); end;
  execute 'reset role';

  -- 2 patient turns it on
  perform pg_temp.as_user(h); execute 'set local role authenticated';
  v_b := public.set_circle_monthly_report_share(mem1, true);
  v_prev := public.circle_preview_member(mem1);
  execute 'reset role';
  insert into s75a5_results values ('2a the patient turns it on', v_b::text, 'true', case when v_b then 'PASS' else 'FAIL' end);
  perform pg_temp.as_user(s1); execute 'set local role authenticated';
  v_view := public.circle_supporter_view(h);
  execute 'reset role';
  insert into s75a5_results values ('2b the supporter now sees the monthly block with the average', coalesce(v_view #>> '{monthly,0,average,systolic}', 'none'), '147',
    case when v_view #>> '{monthly,0,average,systolic}' = '147' then 'PASS' else 'FAIL' end);
  insert into s75a5_results values ('4a the patient preview shows the same block when on', ((v_prev -> 'monthly') = (v_view -> 'monthly'))::text, 'true',
    case when (v_prev -> 'monthly') = (v_view -> 'monthly') and v_prev ? 'monthly' then 'PASS' else 'FAIL' end);

  -- 6 my_care_circle reports the flag per member
  perform pg_temp.as_user(h); execute 'set local role authenticated';
  select string_agg((x ->> 'relationship') || '=' || (x ->> 'monthly_report_shared'), ',' order by x ->> 'relationship') into v_txt
    from jsonb_array_elements(public.my_care_circle() -> 'members') x;
  execute 'reset role';
  insert into s75a5_results values ('6 my_care_circle returns the flag per member', v_txt, 'daughter=true,friend=false', case when v_txt = 'daughter=true,friend=false' then 'PASS' else 'FAIL' end);

  -- 3 the flag does not widen permission: friend has only the appointments tick
  perform pg_temp.as_user(h); execute 'set local role authenticated';
  perform public.set_circle_monthly_report_share(mem2, true);
  execute 'reset role';
  perform pg_temp.as_user(s2); execute 'set local role authenticated';
  v_view := public.circle_supporter_view(h);
  execute 'reset role';
  insert into s75a5_results values ('3a flag on but no weekly tick: still no monthly block', (v_view ? 'monthly')::text, 'false', case when not (v_view ? 'monthly') then 'PASS' else 'FAIL' end);
  -- only the ticked part appears
  update public.care_circle_members set permissions = array['adherence_summary'] where id = mem1;
  perform pg_temp.as_user(s1); execute 'set local role authenticated';
  v_view := public.circle_supporter_view(h);
  execute 'reset role';
  insert into s75a5_results values ('3b only the adherence tick: adherence shown, no average',
    ((v_view #>> '{monthly,0}')::jsonb ? 'adherence_pct')::text || '/' || ((v_view #>> '{monthly,0}')::jsonb ? 'average')::text, 'true/false',
    case when (v_view #>> '{monthly,0}')::jsonb ? 'adherence_pct' and not ((v_view #>> '{monthly,0}')::jsonb ? 'average') then 'PASS' else 'FAIL' end);
  update public.care_circle_members set permissions = array['weekly_bp_trend', 'adherence_summary'] where id = mem1;

  -- 2c off again
  perform pg_temp.as_user(h); execute 'set local role authenticated';
  perform public.set_circle_monthly_report_share(mem1, false);
  v_prev := public.circle_preview_member(mem1);
  execute 'reset role';
  perform pg_temp.as_user(s1); execute 'set local role authenticated';
  v_view := public.circle_supporter_view(h);
  execute 'reset role';
  insert into s75a5_results values ('2c turned off again: the monthly block is gone', (v_view ? 'monthly')::text, 'false', case when not (v_view ? 'monthly') then 'PASS' else 'FAIL' end);
  insert into s75a5_results values ('4b preview follows the flag when off', (v_prev ? 'monthly')::text, 'false', case when not (v_prev ? 'monthly') then 'PASS' else 'FAIL' end);

  -- 7 SABOTAGE: the block ignores the flag
  execute replace(pg_get_functiondef('private.circle_monthly_block(uuid,text[])'::regprocedure), 'not m.monthly_report_shared', 'false');
  perform pg_temp.as_user(s1); execute 'set local role authenticated';
  v_view := public.circle_supporter_view(h);
  execute 'reset role';
  insert into s75a5_results values ('7 SABOTAGE: ignoring the flag shows the block to a supporter who is opted out (1 would FAIL)', (v_view ? 'monthly')::text, 'true',
    case when v_view ? 'monthly' then 'PASS' else 'FAIL' end);
end $$;

select * from s75a5_results order by check_name;
do $$ begin
  if exists (select 1 from s75a5_results where verdict = 'FAIL') then raise exception 'S75 A5 proof: % check(s) FAILED', (select count(*) from s75a5_results where verdict = 'FAIL'); end if;
end $$;
rollback;
