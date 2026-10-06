-- ===========================================================================
-- Proof: S38c notice + 20261007004233_s38d_care_circle_monthly_block.sql (OQ-252, Module 22.5, 22.9; INV-07, INV-10).
--
-- NOTICE
--   1. A neutral "monthly_report_ready" notice (in-app and push, routine, empty payload, non_clinical) is made once, only for the month
--      that just closed; older back-filled months and a second run make none; an unreadable adherence makes none (nothing is written).
-- CARE CIRCLE
--   2. Through circle_supporter_view a member with weekly_bp_trend sees the monthly average, direction and enough-readings flag, and NOT
--      adherence; a member with adherence_summary sees adherence and NOT the average; a member with neither sees no "monthly" key at all
--      (not shared is not zero); at most 3 months, newest first; no target numbers, week split or reading counts.
--   3. A supporter cannot read monthly_reports directly; an expired member and a paused circle get no block; the patient's own preview
--      shows exactly the same block.
-- EXPORT
--   4. log_outcome_export writes an audit row for an admin; a clinician is refused; anon cannot execute.
-- SABOTAGE: circle_view_blocks replaced by the S29 core alone (as a later migration might) must make the monthly checks fail.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

create temp table s38d_results (check_name text, observed text, expected text, verdict text);
grant all on s38d_results to public;

create function pg_temp.ago(k integer) returns timestamptz language sql as
  $$ select (((now() at time zone 'Africa/Lagos')::date - k)::timestamp + interval '12 hours') at time zone 'Africa/Lagos' $$;
create function pg_temp.at_day(d date) returns timestamptz language sql as
  $$ select (d::timestamp + interval '12 hours') at time zone 'Africa/Lagos' $$;
create function pg_temp.rd(p uuid, t timestamptz, s integer, di integer) returns void language plpgsql as $$
begin
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values ((select organisation_id from public.profiles where id = p), p, 'blood_pressure', s, di, t, 'device');
end $$;
create function pg_temp.mkuser(p_role text, p_name text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_org uuid := (select id from public.organisations order by created_at limit 1);
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's38d-' || replace(v::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone)
  values (v, v_org, p_role::public.user_role, p_name, '+23480' || lpad((floor(random() * 99999999))::integer::text, 8, '0'))
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;
  return v;
end $$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_first date := date_trunc('month', (now() at time zone 'Africa/Lagos'))::date;
  v_m date := date_trunc('month', (now() at time zone 'Africa/Lagos')::date - interval '1 month')::date;
  v_now3 timestamptz; h uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; adm uuid; clin uuid; v_mem4 uuid;
  v_rep jsonb; v_view jsonb; v_n integer; i integer; v_txt text; v_ok boolean; v_ok2 boolean; v_ok3 boolean; k integer;
begin
  v_now3 := pg_temp.at_day(v_first + 2);
  h := pg_temp.mkuser('patient', 'S38d Patient');
  s1 := pg_temp.mkuser('patient', 'S38d Supporter BP');   s2 := pg_temp.mkuser('patient', 'S38d Supporter Adherence');
  s3 := pg_temp.mkuser('patient', 'S38d Supporter Appts'); s4 := pg_temp.mkuser('patient', 'S38d Supporter Both');
  adm := pg_temp.mkuser('admin', 'S38d Admin');           clin := pg_temp.mkuser('clinician', 'S38d Clinician');
  insert into public.patient_memberships (organisation_id, patient_id, source, starts_at) values (v_org, h, 'purchase', pg_temp.ago(200));
  -- readings in each of the last four months, 4 per month (so 4 reports exist and only 3 may be shared)
  for k in 1..4 loop
    for i in 4..7 loop
      perform pg_temp.rd(h, pg_temp.at_day((v_first - make_interval(months => k))::date + i), 150 - k * 3, 92 - k);
    end loop;
  end loop;

  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at) values
    (v_org, h, s1, 'daughter', array['weekly_bp_trend'], now() + interval '30 days'),
    (v_org, h, s2, 'son',      array['adherence_summary'], now() + interval '30 days'),
    (v_org, h, s3, 'friend',   array['appointments'], now() + interval '30 days'),
    (v_org, h, s4, 'spouse',   array['weekly_bp_trend', 'adherence_summary'], now() + interval '30 days');
  select id into v_mem4 from public.care_circle_members where patient_id = h and supporter_id = s4;

  -- =============================== 1. NOTICE ===============================
  update public.medicine_config set is_active = false where is_active;
  v_n := private.generate_monthly_reports(v_now3);
  select count(*) into v_n from public.notifications where recipient_id = h and template = 'monthly_report_ready';
  insert into s38d_results values ('1a unreadable adherence: no report and so no notice', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);
  update public.medicine_config set is_active = true where version = (select max(version) from public.medicine_config);

  v_n := private.generate_monthly_reports(v_now3);
  select count(*) into v_n from public.monthly_reports where patient_id = h;
  insert into s38d_results values ('1b four months of reports exist for the patient', v_n::text, '>=4', case when v_n >= 4 then 'PASS' else 'FAIL' end);
  select count(*), count(*) filter (where channel = 'in_app'), count(*) filter (where channel = 'push'), bool_and(payload = '{}'::jsonb), bool_and(content_class::text = 'non_clinical'), bool_and(priority::text = 'routine')
    into v_n, i, k, v_ok, v_ok2, v_ok3
    from public.notifications where recipient_id = h and template = 'monthly_report_ready';
  insert into s38d_results values ('1c exactly one in-app and one push notice, neutral and routine', v_n || '/' || i || '/' || k || '/' || v_ok,
    '2/1/1/true', case when v_n = 2 and i = 1 and k = 1 and v_ok and v_ok2 and v_ok3 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.notifications n join public.monthly_reports r on r.id = n.source_id
   where n.recipient_id = h and n.template = 'monthly_report_ready' and r.month = v_m;
  insert into s38d_results values ('1d the notice is for the month that just closed, not a back-filled one', v_n::text, '2', case when v_n = 2 then 'PASS' else 'FAIL' end);
  perform private.generate_monthly_reports(v_now3);
  select count(*) into v_n from public.notifications where recipient_id = h and template = 'monthly_report_ready';
  insert into s38d_results values ('1e a second run makes no further notice', v_n::text, '2', case when v_n = 2 then 'PASS' else 'FAIL' end);

  -- =============================== 2. CARE CIRCLE ===============================
  perform set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_view := public.circle_supporter_view(h);
  execute 'reset role';
  insert into s38d_results values ('2a weekly_bp_trend: monthly rows, newest first, at most 3', coalesce(jsonb_array_length(v_view -> 'monthly'), -1) || '/' || (v_view #>> '{monthly,0,month}' = v_m::text)::text, '3/true',
    case when jsonb_array_length(v_view -> 'monthly') = 3 and v_view #>> '{monthly,0,month}' = v_m::text then 'PASS' else 'FAIL' end);
  insert into s38d_results values ('2b the average is whole numbers with enough_readings and a direction', (v_view #>> '{monthly,0,average,systolic}') || '/' || (v_view #>> '{monthly,0,enough_readings}') || '/' || coalesce(v_view #>> '{monthly,0,direction}', 'none'),
    '147/true/similar', case when (v_view #>> '{monthly,0,average,systolic}') = '147' and (v_view #>> '{monthly,0,enough_readings}') = 'true' and v_view #>> '{monthly,0,direction}' = 'similar' then 'PASS' else 'FAIL' end);
  v_txt := (v_view -> 'monthly')::text;
  insert into s38d_results values ('2c a BP-only member sees no adherence', (v_txt ~ 'adherence')::text, 'false', case when v_txt !~ 'adherence' then 'PASS' else 'FAIL' end);
  insert into s38d_results values ('2d no target numbers, week split or reading counts are shared', (v_txt ~ '"(target|weeks|readings|days_logged|minimum_readings)"')::text, 'false',
    case when v_txt !~ '"(target|weeks|readings|days_logged|minimum_readings)"' then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', s2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_view := public.circle_supporter_view(h);
  execute 'reset role';
  v_txt := (v_view -> 'monthly')::text;
  insert into s38d_results values ('2e adherence_summary: adherence only, no average or direction', (v_txt ~ 'adherence_shared')::text || '/' || (v_txt ~ '(average|direction|enough_readings)')::text, 'true/false',
    case when v_txt ~ 'adherence_shared' and v_txt !~ '(average|direction|enough_readings)' then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', s3, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_view := public.circle_supporter_view(h);
  execute 'reset role';
  insert into s38d_results values ('2f neither tick: no monthly key at all (not shared is not zero)', (v_view ? 'monthly')::text, 'false', case when not (v_view ? 'monthly') then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', s4, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_view := public.circle_supporter_view(h);
  select count(*) into v_n from public.monthly_reports;
  execute 'reset role';
  insert into s38d_results values ('2g both ticks: both parts', ((v_view #>> '{monthly,0}')::jsonb ? 'average')::text || '/' || ((v_view #>> '{monthly,0}')::jsonb ? 'adherence_shared')::text, 'true/true',
    case when (v_view #>> '{monthly,0}')::jsonb ? 'average' and (v_view #>> '{monthly,0}')::jsonb ? 'adherence_shared' then 'PASS' else 'FAIL' end);
  insert into s38d_results values ('3a a supporter cannot read monthly_reports directly', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);

  -- the patient's own preview shows the same block
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_rep := public.circle_preview_member(v_mem4);
  execute 'reset role';
  insert into s38d_results values ('3b the patient''s preview shows the same monthly block', ((v_rep -> 'monthly') = (v_view -> 'monthly'))::text, 'true', case when (v_rep -> 'monthly') = (v_view -> 'monthly') then 'PASS' else 'FAIL' end);

  -- expired and paused
  update public.care_circle_members set expires_at = now() - interval '1 day' where id = v_mem4;
  perform set_config('request.jwt.claims', json_build_object('sub', s4, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.circle_supporter_view(h); insert into s38d_results values ('3c an expired member gets nothing', 'ran', 'refused', 'FAIL');
  exception when sqlstate 'P0002' then insert into s38d_results values ('3c an expired member gets nothing', 'refused', 'refused', 'PASS'); end;
  execute 'reset role';
  insert into public.care_circle_pauses (patient_id, organisation_id, paused_until) values (h, v_org, now() + interval '3 days');
  perform set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.circle_supporter_view(h); insert into s38d_results values ('3d a paused circle shows no monthly block', 'ran', 'refused', 'FAIL');
  exception when sqlstate 'P0002' then insert into s38d_results values ('3d a paused circle shows no monthly block', 'refused', 'refused', 'PASS'); end;
  execute 'reset role';
  delete from public.care_circle_pauses where patient_id = h;

  -- =============================== 4. EXPORT LOG ===============================
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.log_outcome_export(date '2026-07-01', date '2026-07-31');
  execute 'reset role';
  select count(*) into v_n from public.audit_log where actor_id = adm and action = 'outcomes.bp_control_export';
  insert into s38d_results values ('4a an admin export is written to the audit log', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);
  perform set_config('request.jwt.claims', json_build_object('sub', clin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.log_outcome_export(null, null); insert into s38d_results values ('4b a clinician is refused', 'ran', 'refused', 'FAIL');
  exception when insufficient_privilege then insert into s38d_results values ('4b a clinician is refused', 'refused', 'refused', 'PASS'); end;
  execute 'reset role';
  insert into s38d_results values ('4c anon cannot execute the export log', has_function_privilege('anon', 'public.log_outcome_export(date,date)', 'EXECUTE')::text, 'false',
    case when not has_function_privilege('anon', 'public.log_outcome_export(date,date)', 'EXECUTE') then 'PASS' else 'FAIL' end);

  -- =============================== SABOTAGE ===============================
  create or replace function private.circle_view_blocks(p_patient uuid, p_permissions text[]) returns jsonb language sql stable security definer set search_path = ''
    as $f$ select private.circle_view_blocks_core(p_patient, p_permissions) $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_view := public.circle_supporter_view(h);
  execute 'reset role';
  insert into s38d_results values ('5 SABOTAGE: a later redefinition without the monthly block loses it (2a would FAIL)', (v_view ? 'monthly')::text, 'false', case when not (v_view ? 'monthly') then 'PASS' else 'FAIL' end);
end $$;

select * from s38d_results order by check_name;

do $$
begin
  if exists (select 1 from s38d_results where verdict = 'FAIL') then
    raise exception 'S38d proof: % check(s) FAILED', (select count(*) from s38d_results where verdict = 'FAIL');
  end if;
end $$;

rollback;
