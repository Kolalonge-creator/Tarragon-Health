-- ===========================================================================
-- Proof: S38 independent review of 20261006210537_s38_outcome_snapshots_and_analytics.sql.
--
-- A second, separately written proof for the same migration (the first is s38_outcome_snapshots_and_analytics.sql). It uses
-- different fixtures and asks the same safety questions from outside, so a mistake shared by the migration and its own proof
-- would show up here. It proves:
--   1. Window and anchor: day 0 is the first 7 days from the membership start; day 30 the 7 days ending on it; too few
--      readings is insufficient_data (never controlled, no average stored); adherence with no doses is "no_doses".
--   2. Grace period: day 30 is not written until its window plus the grace days has passed; a reading that syncs late inside
--      the grace period is counted (without the grace it would have been insufficient_data).
--   3. Idempotent and append-only: a second run writes nothing; an UPDATE is refused even for the table owner.
--   4. Access: a patient reads only their own snapshots; a clinician, an unrelated patient and anon read none; no write.
--   5. Safety case 22 (INV-13): a test patient HAS snapshots but never appears in the de-identified view or in any report count.
--      The de-identified view has no patient id column.
--   6. Report: refused for a patient and for anon; with the cell floor lowered the strict headline counts a person with too
--      few readings in the denominator (1 controlled of 2 due = 50.0, not 100); change from day 0 is exact; a category of
--      1 to floor-1 withholds the whole cohort (no subtraction); a late reading is counted in the data-quality block.
--   7. SABOTAGE: the de-identified view rebuilt without the test filter (case 22 must flip) and the append-only trigger
--      dropped (the update refusal must flip).
--
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

create temp table s38i_results (check_name text, observed text, expected text, verdict text);
grant all on s38i_results to public;

do $$
declare
  v_org     uuid;
  v_day0    date := (now() at time zone 'Africa/Lagos')::date - 120;
  v_a       uuid := gen_random_uuid();
  v_b       uuid := gen_random_uuid();
  v_t       uuid := gen_random_uuid();
  v_pat2    uuid := gen_random_uuid();
  v_clin    uuid := gen_random_uuid();
  v_admin   uuid := gen_random_uuid();
  v_n       integer;
  v_row     record;
  v_rep     jsonb;
  i         integer;
  v_ok      boolean;
  v_txt     text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select x, 's38i-' || replace(x::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}'
    from unnest(array[v_a, v_b, v_t, v_pat2, v_clin, v_admin]) x;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_a,     v_org, 'patient',   'S38i A',     '+2348038100001'),
    (v_b,     v_org, 'patient',   'S38i B',     '+2348038100002'),
    (v_t,     v_org, 'patient',   'S38i Test',  '+2348038100003'),
    (v_pat2,  v_org, 'patient',   'S38i Two',   '+2348038100004'),
    (v_clin,  v_org, 'clinician', 'S38i Clin',  '+2348038100005'),
    (v_admin, v_org, 'admin',     'S38i Admin', '+2348038100006')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  update public.profiles set is_test = true where id = v_t;

  insert into public.patient_memberships (organisation_id, patient_id, source, starts_at)
  select v_org, p, 'purchase', ((v_day0)::timestamp + interval '12 hours') at time zone 'Africa/Lagos'
    from unnest(array[v_a, v_b, v_t]) p;

  -- A: day 0 four readings 150/96 (days 1-4); day 30 window is days 24-30: two now (25, 26) and one that syncs late;
  --    day 90 window is days 84-90: three at 128/80. B: two readings at day 0 only. T (test): four controlled at day 0.
  for i in 1..4 loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
    values (v_org, v_a, 'blood_pressure', 150, 96, ((v_day0 + i)::timestamp + interval '12 hours') at time zone 'Africa/Lagos', 'device');
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
    values (v_org, v_t, 'blood_pressure', 118, 76, ((v_day0 + i)::timestamp + interval '12 hours') at time zone 'Africa/Lagos', 'device');
  end loop;
  for i in 25..26 loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
    values (v_org, v_a, 'blood_pressure', 136, 86, ((v_day0 + i)::timestamp + interval '12 hours') at time zone 'Africa/Lagos', 'device');
  end loop;
  for i in 85..87 loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
    values (v_org, v_a, 'blood_pressure', 128, 80, ((v_day0 + i)::timestamp + interval '12 hours') at time zone 'Africa/Lagos', 'device');
  end loop;
  for i in 1..2 loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
    values (v_org, v_b, 'blood_pressure', 120, 78, ((v_day0 + i)::timestamp + interval '12 hours') at time zone 'Africa/Lagos', 'device');
  end loop;

  -- 2. grace: at day 31 only day 0 (window ends day 6, +3 grace = day 9) is due; day 30 is due on day 33.
  perform private.compute_outcome_snapshots(((v_day0 + 31)::timestamp + interval '12 hours') at time zone 'Africa/Lagos');
  select count(*) into v_n from public.outcome_snapshots where patient_id = v_a and day = 30;
  insert into s38i_results values ('2a day 30 not written inside the grace period', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.outcome_snapshots where patient_id = v_a and day = 0;
  insert into s38i_results values ('2b day 0 written once its window and grace passed', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);

  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (v_org, v_a, 'blood_pressure', 136, 86, ((v_day0 + 27)::timestamp + interval '12 hours') at time zone 'Africa/Lagos', 'device');
  perform private.compute_outcome_snapshots(((v_day0 + 34)::timestamp + interval '12 hours') at time zone 'Africa/Lagos');
  select * into v_row from public.outcome_snapshots where patient_id = v_a and day = 30;
  insert into s38i_results values ('2c late reading inside the grace period is counted',
    coalesce(v_row.bp_status, 'none') || '/' || coalesce(v_row.bp_readings_7d::text, '-'), 'controlled/3',
    case when v_row.bp_status = 'controlled' and v_row.bp_readings_7d = 3 then 'PASS' else 'FAIL' end);

  perform private.compute_outcome_snapshots(now());

  -- 1. content
  select * into v_row from public.outcome_snapshots where patient_id = v_a and day = 0;
  insert into s38i_results values ('1a A day 0: uncontrolled at 150.0/96.0 over 4 readings, default target recorded',
    v_row.bp_status || '/' || v_row.bp_avg_7d_sys || '/' || v_row.bp_avg_7d_dia || '/' || v_row.bp_readings_7d || '/' || v_row.target_source,
    'uncontrolled/150.0/96.0/4/default',
    case when v_row.bp_status = 'uncontrolled' and v_row.bp_avg_7d_sys = 150.0 and v_row.bp_avg_7d_dia = 96.0 and v_row.bp_readings_7d = 4 and v_row.target_source = 'default' then 'PASS' else 'FAIL' end);
  select * into v_row from public.outcome_snapshots where patient_id = v_b and day = 0;
  insert into s38i_results values ('1b B day 0: insufficient_data, controlled null, no average',
    v_row.bp_status || '/' || coalesce(v_row.controlled::text, 'null') || '/' || coalesce(v_row.bp_avg_7d_sys::text, 'null'), 'insufficient_data/null/null',
    case when v_row.bp_status = 'insufficient_data' and v_row.controlled is null and v_row.bp_avg_7d_sys is null then 'PASS' else 'FAIL' end);
  select * into v_row from public.outcome_snapshots where patient_id = v_a and day = 90;
  insert into s38i_results values ('1c A day 90 controlled, config version recorded (INV-16)',
    v_row.bp_status || '/' || v_row.config_version, 'controlled/1', case when v_row.bp_status = 'controlled' and v_row.config_version = 1 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.outcome_snapshots where patient_id = v_a and day = 180;
  insert into s38i_results values ('1d day 180 not written before it is due', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);
  select adherence_status into v_txt from public.outcome_snapshots where patient_id = v_a and day = 0;
  insert into s38i_results values ('1e no doses is recorded as no_doses, not as 0 percent', v_txt, 'no_doses', case when v_txt = 'no_doses' then 'PASS' else 'FAIL' end);

  -- 3. idempotent, append-only
  select count(*) into v_n from public.outcome_snapshots;
  perform private.compute_outcome_snapshots(now());
  insert into s38i_results values ('3a second run writes nothing', ((select count(*) from public.outcome_snapshots) - v_n)::text, '0',
    case when (select count(*) from public.outcome_snapshots) = v_n then 'PASS' else 'FAIL' end);
  begin
    update public.outcome_snapshots set adherence_pct = 77 where patient_id = v_a and day = 0;
    insert into s38i_results values ('3b update refused for the owner', 'updated', 'refused', 'FAIL');
  exception when others then
    -- only the append-only trigger counts; any other error (a CHECK, a typo) must not pass this check
    insert into s38i_results values ('3b update refused for the owner by the append-only trigger', sqlerrm, 'outcome_snapshots_append_only',
      case when sqlerrm = 'outcome_snapshots_append_only' then 'PASS' else 'FAIL' end);
  end;

  -- 4. access
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.outcome_snapshots;
  insert into s38i_results values ('4a patient reads own snapshots only (3: days 0, 30, 90)', v_n::text, '3', case when v_n = 3 then 'PASS' else 'FAIL' end);
  begin
    insert into public.outcome_snapshots (organisation_id, patient_id, day, anchor_date, window_start, window_end, bp_status, target_sys, target_dia, target_source, config_version)
    values (v_org, v_a, 180, v_day0, v_day0, v_day0, 'insufficient_data', 140, 90, 'default', 1);
    insert into s38i_results values ('4b patient cannot insert', 'inserted', 'refused', 'FAIL');
  exception when insufficient_privilege then
    insert into s38i_results values ('4b patient cannot insert', 'refused', 'refused', 'PASS');
  end;
  begin
    perform public.bp_control_report();
    insert into s38i_results values ('6a patient refused the report', 'ran', 'refused', 'FAIL');
  exception when insufficient_privilege then
    insert into s38i_results values ('6a patient refused the report', 'refused', 'refused', 'PASS');
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.outcome_snapshots;
  insert into s38i_results values ('4c clinician reads none', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.outcome_snapshots;
  insert into s38i_results values ('4d unrelated patient reads none', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  begin
    perform count(*) from public.outcome_snapshots;
    insert into s38i_results values ('4e anon cannot read', 'read', 'refused', 'FAIL');
  exception when insufficient_privilege then
    insert into s38i_results values ('4e anon cannot read', 'refused', 'refused', 'PASS');
  end;
  execute 'reset role';
  insert into s38i_results values ('6b anon cannot execute the report',
    has_function_privilege('anon', 'public.bp_control_report(date,date)', 'EXECUTE')::text, 'false',
    case when not has_function_privilege('anon', 'public.bp_control_report(date,date)', 'EXECUTE') then 'PASS' else 'FAIL' end);

  -- 5. Safety case 22
  select count(*) into v_n from public.outcome_snapshots where patient_id = v_t;
  insert into s38i_results values ('5a test patient has snapshots (so 5b is not vacuous)', v_n::text, '>0', case when v_n > 0 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from analytics.v_outcome_snapshots v join analytics.subjects s on s.subject_key = v.subject_key where s.patient_id = v_t;
  insert into s38i_results values ('5b CASE 22: test patient absent from the de-identified view', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from information_schema.columns where table_schema = 'analytics' and table_name = 'v_outcome_snapshots' and column_name = 'patient_id';
  insert into s38i_results values ('5c de-identified view has no patient id column', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);

  -- 6. report as admin. Default floor (11): nothing is shown for 2 people.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_rep := public.bp_control_report(v_day0, v_day0);
  execute 'reset role';
  insert into s38i_results values ('6c under the floor: suppressed, no counts',
    coalesce(v_rep #>> '{cohort_all_due,suppressed}', 'null') || '/' || (v_rep -> 'cohort_all_due' ? 'controlled')::text, 'true/false',
    case when v_rep #>> '{cohort_all_due,suppressed}' = 'true' and not (v_rep -> 'cohort_all_due' ? 'controlled') then 'PASS' else 'FAIL' end);

  update public.outcome_config set config = jsonb_set(config, '{min_cell}', '1') where is_active;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_rep := public.bp_control_report(v_day0, v_day0);
  execute 'reset role';
  insert into s38i_results values ('6d test patient excluded; strict headline counts the person with too few readings',
    (v_rep #>> '{cohort_all_due,n}') || '/' || (v_rep #>> '{cohort_all_due,controlled}') || '/' || (v_rep #>> '{cohort_all_due,insufficient_data}') || '/' || (v_rep #>> '{cohort_all_due,rate_strict_pct}'),
    '2/1/1/50.0',
    case when (v_rep #>> '{cohort_all_due,n}') = '2' and (v_rep #>> '{cohort_all_due,controlled}') = '1' and (v_rep #>> '{cohort_all_due,insufficient_data}') = '1'
         and (v_rep #>> '{cohort_all_due,rate_strict_pct}')::numeric = 50.0 then 'PASS' else 'FAIL' end);
  insert into s38i_results values ('6e change from day 0 is exact (-22.0 / -16.0)',
    (v_rep #>> '{change_among_measured,mean_systolic_change}') || '/' || (v_rep #>> '{change_among_measured,mean_diastolic_change}'), '-22.0/-16.0',
    case when (v_rep #>> '{change_among_measured,mean_systolic_change}')::numeric = -22.0 and (v_rep #>> '{change_among_measured,mean_diastolic_change}')::numeric = -16.0 then 'PASS' else 'FAIL' end);
  insert into s38i_results values ('6f late reading counted in data quality (the day-30 late reading is not day 90, so 0 here)',
    coalesce(v_rep #>> '{data_quality,readings_arriving_after_snapshot_pct}', 'null'), '0.0',
    case when (v_rep #>> '{data_quality,readings_arriving_after_snapshot_pct}')::numeric = 0.0 then 'PASS' else 'FAIL' end);

  -- a category of 1 to floor-1 withholds the whole cohort: floor 2, controlled = 1 is a small cell.
  update public.outcome_config set config = jsonb_set(config, '{min_cell}', '2') where is_active;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_rep := public.bp_control_report(v_day0, v_day0);
  execute 'reset role';
  insert into s38i_results values ('6g small category withholds the whole cohort (no subtraction)',
    coalesce(v_rep #>> '{cohort_all_due,suppressed}', 'null') || '/' || coalesce(v_rep #>> '{cohort_all_due,reason}', 'null'), 'true/small_cell',
    case when v_rep #>> '{cohort_all_due,suppressed}' = 'true' and v_rep #>> '{cohort_all_due,reason}' = 'small_cell' then 'PASS' else 'FAIL' end);
  update public.outcome_config set config = jsonb_set(config, '{min_cell}', '1') where is_active;

  -- a reading that syncs after the day 90 snapshot is flagged as late
  -- now() is frozen inside one transaction, so the late reading is stamped explicitly after the snapshot's computed_at
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, created_at, source)
  values (v_org, v_a, 'blood_pressure', 126, 80, ((v_day0 + 88)::timestamp + interval '12 hours') at time zone 'Africa/Lagos', now() + interval '1 minute', 'device');
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_rep := public.bp_control_report(v_day0, v_day0);
  execute 'reset role';
  insert into s38i_results values ('6h a reading that arrives after the day 90 snapshot is counted as late',
    coalesce(v_rep #>> '{data_quality,readings_arriving_after_snapshot_pct}', 'null'), '50.0',
    case when (v_rep #>> '{data_quality,readings_arriving_after_snapshot_pct}')::numeric = 50.0 then 'PASS' else 'FAIL' end);

  -- 7. SABOTAGE
  execute $v$
    create or replace view analytics.v_outcome_snapshots with (security_invoker = off) as
      select sub.subject_key, s.organisation_id, s.pathway_code, s.day, date_trunc('month', s.anchor_date)::date as enrolment_month,
             s.bp_avg_7d_sys, s.bp_avg_7d_dia, s.bp_readings_7d, s.bp_status, s.target_source, s.adherence_pct, s.adherence_doses_due,
             s.config_version, s.computed_at::date as computed_on
        from public.outcome_snapshots s join analytics.subjects sub on sub.patient_id = s.patient_id
       where s.is_test or not s.is_test
  $v$;
  select count(*) into v_n from analytics.v_outcome_snapshots v join analytics.subjects s on s.subject_key = v.subject_key where s.patient_id = v_t;
  insert into s38i_results values ('7a SABOTAGE: unfiltered view lets the test patient through (5b would FAIL)', v_n::text, '>0', case when v_n > 0 then 'PASS' else 'FAIL' end);

  drop trigger outcome_snapshots_append_only on public.outcome_snapshots;
  update public.outcome_snapshots set adherence_pct = 77 where patient_id = v_a and day = 0;
  select (adherence_pct = 77) into v_ok from public.outcome_snapshots where patient_id = v_a and day = 0;
  insert into s38i_results values ('7b SABOTAGE: without the trigger the update succeeds (3b would FAIL)', v_ok::text, 'true', case when v_ok then 'PASS' else 'FAIL' end);
end $$;

select * from s38i_results order by check_name;

do $$
begin
  if exists (select 1 from s38i_results where verdict = 'FAIL') then
    raise exception 'S38 independent proof: % check(s) FAILED', (select count(*) from s38i_results where verdict = 'FAIL');
  end if;
end $$;

rollback;
