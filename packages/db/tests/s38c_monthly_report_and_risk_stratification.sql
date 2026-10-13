-- ===========================================================================
-- Proof: 20261007103011_s38c_monthly_report_and_risk_stratification.sql (v5 S38, Module 22.3 and 22.5; INV-10, INV-12, INV-13, INV-16).
--
-- RISK
--   1. Exact scores and reasons: a high-BP person with a red event is 85/high with both reasons; a person in target is 0/low with no
--      reasons; a person who stopped logging is dropout 50/medium with no deterioration; a member who never logged is dropout 40.
--   2. The scoring function reads no spend, order, purchase, appointment or payment table (cost-as-proxy trap).
--   3. Idempotent per day; append-only; the score table and overrides are unreadable by every application role, including the patient.
--   4. Worklist: a tied clinician sees only their tied patients, high first, never a test account, and each read is written to audit_log
--      (INV-10, INV-12); a clinician tied to nobody sees nothing; a patient and anon are refused.
--   5. Override: needs a tie, a written reason and a bounded expiry; it moves the tier the clinician sees, marks it overridden, and leaves
--      the computed score untouched.
--   6. Fairness report: admin or CMO only; groups under the floor are withheld and, when exactly one is, the next smallest too; a test
--      account is never counted (INV-13).
-- MONTHLY REPORT
--   7. Not written before the grace days; written once (a second run writes nothing); exact numbers for a month; "not enough readings"
--      replaces the average when there are too few; direction against last month; the patient reads only their own; nothing about risk.
--   8. SABOTAGE: the tie function forced open (the worklist must then leak: check 4 flips) and the monthly append-only trigger dropped.
--
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

create temp table s38c_results (check_name text, observed text, expected text, verdict text);
grant all on s38c_results to public;

-- Lagos noon, k days before today
create function pg_temp.ago(k integer) returns timestamptz language sql as
  $$ select (((now() at time zone 'Africa/Lagos')::date - k)::timestamp + interval '12 hours') at time zone 'Africa/Lagos' $$;
create function pg_temp.at_day(d date) returns timestamptz language sql as
  $$ select (d::timestamp + interval '12 hours') at time zone 'Africa/Lagos' $$;

create function pg_temp.rd(p uuid, t timestamptz, s integer, di integer) returns void language plpgsql as $$
begin
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values ((select organisation_id from public.profiles where id = p), p, 'blood_pressure', s, di, t, 'device');
end $$;

-- A joined patient (membership from 120 days ago) with a pattern of recent readings.
create function pg_temp.mkp(p_state text, p_kind text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_org uuid := (select id from public.organisations order by created_at limit 1); i integer;
        v_rs uuid; v_code text; v_ver integer;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's38c-' || replace(v::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, state)
  values (v, v_org, 'patient', 'S38c ' || p_kind, '+23480' || lpad((floor(random() * 99999999))::integer::text, 8, '0'), p_state)
  on conflict (id) do update set state = excluded.state, role = 'patient';
  insert into public.patient_memberships (organisation_id, patient_id, source, starts_at) values (v_org, v, 'purchase', pg_temp.ago(120));
  if p_kind = 'high' then
    for i in 1..4 loop perform pg_temp.rd(v, pg_temp.ago(i), 165, 100); end loop;
    select id, code, version into v_rs, v_code, v_ver from public.triage_rule_sets order by created_at limit 1;
    insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_set_id, rule_set_code, rule_set_version,
                                      rule_set_status, actions, shadow, created_at)
    values (v_org, v, 'observation', gen_random_uuid(), 'red', v_rs, v_code, v_ver, 'approved', '[{"kind":"page_on_call"}]'::jsonb, false, pg_temp.ago(3));
  elsif p_kind = 'low' then
    for i in 1..4 loop perform pg_temp.rd(v, pg_temp.ago(i), 130, 82); end loop;
  elsif p_kind = 'silent' then
    for i in 1..3 loop perform pg_temp.rd(v, pg_temp.ago(11), 128, 80); end loop;
  end if;
  return v;
end $$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  h uuid; h2 uuid; l uuid; l2 uuid; d uuid; nn uuid; x uuid; y1 uuid; y2 uuid; t uuid; r uuid; f uuid; p0 uuid; p1 uuid;
  c uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); a uuid := gen_random_uuid();
  v_m date := date_trunc('month', (now() at time zone 'Africa/Lagos')::date - interval '1 month')::date;
  v_first date := date_trunc('month', (now() at time zone 'Africa/Lagos'))::date;
  v_now2 timestamptz; v_now3 timestamptz;
  v_o jsonb; pt uuid; lp uuid; s record; v_n integer; v_n2 integer; v_rep jsonb; v_row jsonb; v_txt text; v_id uuid; v_before integer; v_aud integer; v_ok boolean;
  i integer;
begin
  if not exists (select 1 from public.triage_rule_sets) then raise exception 'fixture FAIL: no triage_rule_sets row'; end if;
  v_now2 := pg_temp.at_day(v_first + 1);   -- the 2nd: inside the grace days
  v_now3 := pg_temp.at_day(v_first + 2);   -- the 3rd: grace passed

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select x1, 's38c-' || replace(x1::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[c, c2, a]) x1;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (c, v_org, 'clinician', 'S38c Clin', '+2348038200001'), (c2, v_org, 'clinician', 'S38c Clin Two', '+2348038200002'), (a, v_org, 'admin', 'S38c Admin', '+2348038200003')
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id;

  h  := pg_temp.mkp('Lagos', 'high');   h2 := pg_temp.mkp('Lagos', 'high');
  l  := pg_temp.mkp('Lagos', 'low');    l2 := pg_temp.mkp('Lagos', 'low');
  d  := pg_temp.mkp('Lagos', 'silent'); nn := pg_temp.mkp('Lagos', 'none');
  x  := pg_temp.mkp('Oyo', 'low');      y1 := pg_temp.mkp('Kano', 'low');  y2 := pg_temp.mkp('Kano', 'low');
  t  := pg_temp.mkp('Lagos', 'high');   update public.profiles set is_test = true where id = t;
  r  := pg_temp.mkp('Rivers', 'none');  f := pg_temp.mkp('Rivers', 'none');
  -- PT: has her own target 130/80 and readings at 152/88 (12 over the default, 22 over her own). LP: a membership that has ended.
  pt := pg_temp.mkp('Lagos', 'none');
  insert into public.patient_bp_targets (organisation_id, patient_id, home_systolic, home_diastolic, office_systolic, office_diastolic)
  values (v_org, pt, 130, 80, 130, 80);
  for i in 1..4 loop perform pg_temp.rd(pt, pg_temp.ago(i), 152, 88); end loop;
  lp := pg_temp.mkp('Lagos', 'high');
  update public.patient_memberships set state = 'ended', ended_at = now(), end_reason = 'ended for the proof run', ends_at = now() where patient_id = lp;
  p0 := gen_random_uuid(); p1 := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select x1, 's38c-' || replace(x1::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[p0, p1]) x1;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values (p0, v_org, 'patient', 'S38c Nobody', '+2348038200004'), (p1, v_org, 'patient', 'S38c Reader Only', '+2348038200005')
  on conflict (id) do update set role = 'patient';

  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, h, c), (v_org, l, c);

  -- monthly fixtures. H: 4 readings at 160/100 on days 4..7 of last month. R: 150/92 the month before, 138/86 last month. F: two readings. P1: readings, no membership.
  for i in 4..7 loop perform pg_temp.rd(h, pg_temp.at_day(v_m + i), 160, 100); end loop;
  for i in 5..7 loop perform pg_temp.rd(r, pg_temp.at_day((v_m - interval '1 month')::date + i), 150, 92); perform pg_temp.rd(r, pg_temp.at_day(v_m + i), 138, 86); end loop;
  for i in 5..7 loop perform pg_temp.rd(pt, pg_temp.at_day(v_m + i), 152, 88); end loop;
  for i in 5..6 loop perform pg_temp.rd(f, pg_temp.at_day(v_m + i), 135, 85); end loop;
  for i in 5..7 loop perform pg_temp.rd(p1, pg_temp.at_day(v_m + i), 125, 80); end loop;

  -- =============================== RISK ===============================
  v_n := private.compute_risk_scores(now());
  insert into s38c_results values ('1a scores written for every joined patient', v_n::text, '>=10', case when v_n >= 10 then 'PASS' else 'FAIL' end);
  select * into s from public.risk_scores where patient_id = h order by computed_on desc limit 1;
  insert into s38c_results values ('1b high BP + red event = 85, high, both reasons, config version recorded',
    s.deterioration_risk || '/' || s.dropout_risk || '/' || s.level || '/' || s.model_version || '/' || (s.reasons @> '[{"key":"bp_well_above_target"}]')::text || '/' || (s.reasons @> '[{"key":"recent_red_event"}]')::text,
    '85/0/high/1/true/true', case when s.deterioration_risk = 85 and s.dropout_risk = 0 and s.level = 'high' and s.model_version = 1
      and s.reasons @> '[{"key":"bp_well_above_target"}]' and s.reasons @> '[{"key":"recent_red_event"}]' then 'PASS' else 'FAIL' end);
  select * into s from public.risk_scores where patient_id = l order by computed_on desc limit 1;
  insert into s38c_results values ('1c in-target patient: 0/0/low, no reasons', s.deterioration_risk || '/' || s.dropout_risk || '/' || s.level || '/' || jsonb_array_length(s.reasons),
    '0/0/low/0', case when s.deterioration_risk = 0 and s.dropout_risk = 0 and s.level = 'low' and jsonb_array_length(s.reasons) = 0 then 'PASS' else 'FAIL' end);
  select * into s from public.risk_scores where patient_id = d order by computed_on desc limit 1;
  insert into s38c_results values ('1d stopped logging 11 days ago: dropout 50, deterioration 0, medium',
    s.deterioration_risk || '/' || s.dropout_risk || '/' || s.level, '0/50/medium', case when s.deterioration_risk = 0 and s.dropout_risk = 50 and s.level = 'medium' then 'PASS' else 'FAIL' end);
  select * into s from public.risk_scores where patient_id = nn order by computed_on desc limit 1;
  insert into s38c_results values ('1e member who never logged: dropout 40, medium', s.dropout_risk || '/' || s.level, '40/medium', case when s.dropout_risk = 40 and s.level = 'medium' then 'PASS' else 'FAIL' end);

  select * into s from public.risk_scores where patient_id = pt order by computed_on desc limit 1;
  insert into s38c_results values ('1f own target 130/80 is used: 152/88 is well above it (45, medium), not merely above the default',
    s.deterioration_risk || '/' || s.level || '/' || (s.reasons @> '[{"key":"bp_well_above_target"}]')::text || '/' || (s.inputs ->> 'target_source'), '45/medium/true/patient',
    case when s.deterioration_risk = 45 and s.level = 'medium' and s.reasons @> '[{"key":"bp_well_above_target"}]' and s.inputs ->> 'target_source' = 'patient' then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.risk_scores where patient_id = lp;
  insert into s38c_results values ('1g a member whose membership has ended is not scored (no dropout chasing of people who left)', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);

  select pg_get_functiondef('private.risk_compute(uuid,date)'::regprocedure) into v_txt;
  insert into s38c_results values ('2 scoring reads no spend, order, purchase, appointment or payment table',
    (v_txt ~* 'public\.(payments?|[a-z_]*orders?|invoices?|service_purchases|appointments|booking_requests|entitlements|patient_memberships|price|catalog)')::text, 'false',
    case when v_txt !~* 'public\.(payments?|[a-z_]*orders?|invoices?|service_purchases|appointments|booking_requests|entitlements|patient_memberships|price|catalog)' then 'PASS' else 'FAIL' end);

  v_n2 := private.compute_risk_scores(now());
  insert into s38c_results values ('3a second run the same day writes nothing', v_n2::text, '0', case when v_n2 = 0 then 'PASS' else 'FAIL' end);
  begin
    update public.risk_scores set dropout_risk = 99 where patient_id = h;
    insert into s38c_results values ('3b risk_scores update refused by the append-only trigger', 'updated', 'refused', 'FAIL');
  exception when others then
    insert into s38c_results values ('3b risk_scores update refused by the append-only trigger', sqlerrm, 'risk_scores_append_only', case when sqlerrm = 'risk_scores_append_only' then 'PASS' else 'FAIL' end);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform count(*) from public.risk_scores;
    insert into s38c_results values ('3c patient cannot read risk scores (not even their own)', 'read', 'refused', 'FAIL');
  exception when insufficient_privilege then
    insert into s38c_results values ('3c patient cannot read risk scores (not even their own)', 'refused', 'refused', 'PASS');
  end;
  begin
    perform count(*) from public.risk_overrides;
    insert into s38c_results values ('3d patient cannot read overrides', 'read', 'refused', 'FAIL');
  exception when insufficient_privilege then
    insert into s38c_results values ('3d patient cannot read overrides', 'refused', 'refused', 'PASS');
  end;
  begin
    perform public.clinician_risk_worklist();
    insert into s38c_results values ('4e patient refused the worklist', 'ran', 'refused', 'FAIL');
  exception when insufficient_privilege then
    insert into s38c_results values ('4e patient refused the worklist', 'refused', 'refused', 'PASS');
  end;
  execute 'reset role';
  insert into s38c_results values ('4f anon cannot execute the worklist, override or fairness report',
    (has_function_privilege('anon', 'public.clinician_risk_worklist(integer)', 'EXECUTE') or has_function_privilege('anon', 'public.override_patient_risk(uuid,text,text,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.risk_distribution_report()', 'EXECUTE'))::text, 'false',
    case when not (has_function_privilege('anon', 'public.clinician_risk_worklist(integer)', 'EXECUTE') or has_function_privilege('anon', 'public.override_patient_risk(uuid,text,text,integer)', 'EXECUTE')
                   or has_function_privilege('anon', 'public.risk_distribution_report()', 'EXECUTE')) then 'PASS' else 'FAIL' end);

  -- 4. worklist as the tied clinician
  select count(*) into v_before from public.audit_log where actor_id = c and action = 'staff.chart_read' and reason = 'risk worklist';
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_rep := public.clinician_risk_worklist();
  execute 'reset role';
  insert into s38c_results values ('4a worklist is exactly the two tied patients, high first',
    jsonb_array_length(v_rep -> 'rows') || '/' || (v_rep #>> '{rows,0,patient_id}' = h::text)::text || '/' || (v_rep #>> '{rows,1,patient_id}' = l::text)::text, '2/true/true',
    case when jsonb_array_length(v_rep -> 'rows') = 2 and v_rep #>> '{rows,0,patient_id}' = h::text and v_rep #>> '{rows,1,patient_id}' = l::text then 'PASS' else 'FAIL' end);
  select count(*) into v_aud from public.audit_log where actor_id = c and action = 'staff.chart_read' and reason = 'risk worklist';
  insert into s38c_results values ('4b each patient read is audited (INV-10)', (v_aud - v_before)::text, '2', case when v_aud - v_before = 2 then 'PASS' else 'FAIL' end);
  insert into s38c_results values ('4c reasons are keys only (no free text)', (v_rep #> '{rows,0,reasons}')::text, 'keys', case when (v_rep #> '{rows,0,reasons}')::text ~ '"key"' then 'PASS' else 'FAIL' end);
  perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_rep := public.clinician_risk_worklist();
  execute 'reset role';
  insert into s38c_results values ('4d a clinician tied to nobody sees nothing', jsonb_array_length(v_rep -> 'rows')::text, '0', case when jsonb_array_length(v_rep -> 'rows') = 0 then 'PASS' else 'FAIL' end);

  -- 5. override
  perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_o := public.override_patient_risk(l, 'high', 'Trying to override a patient I am not tied to', 7);
  execute 'reset role';
  insert into s38c_results values ('5a untied clinician cannot override', v_o ->> 'status', 'denied', case when v_o ->> 'status' = 'denied' then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.audit_log where actor_id = c2 and action = 'staff.chart_read' and reason = 'risk override refused' and result = 'denied' and subject_patient_id = l;
  insert into s38c_results values ('5a2 the refused attempt is itself audited and the row survives (INV-10)', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.override_patient_risk(l, NULL, 'A long enough reason for the record', 7); insert into s38c_results values ('5b0 a null tier is refused as invalid', 'ok', 'refused', 'FAIL');
  exception when sqlstate '22023' then insert into s38c_results values ('5b0 a null tier is refused as invalid', 'refused', 'refused', 'PASS'); end;
  begin perform public.override_patient_risk(l, 'high', 'short', 7); insert into s38c_results values ('5b short reason refused', 'ok', 'refused', 'FAIL');
  exception when sqlstate '22023' then insert into s38c_results values ('5b short reason refused', 'refused', 'refused', 'PASS'); end;
  begin perform public.override_patient_risk(l, 'high', 'A long enough reason for the record', 365); insert into s38c_results values ('5c expiry beyond the maximum refused', 'ok', 'refused', 'FAIL');
  exception when sqlstate '22023' then insert into s38c_results values ('5c expiry beyond the maximum refused', 'refused', 'refused', 'PASS'); end;
  v_o := public.override_patient_risk(l, 'high', 'Recently widowed, call this week', 7);
  v_rep := public.clinician_risk_worklist();
  execute 'reset role';
  insert into s38c_results values ('5d override moves the tier, marks it overridden, keeps the computed tier',
    (v_rep #>> '{rows,1,level}') || '/' || (v_rep #>> '{rows,1,computed_level}') || '/' || (v_rep #>> '{rows,1,overridden}'), 'high/low/true',
    case when v_rep #>> '{rows,1,patient_id}' = l::text and v_rep #>> '{rows,1,level}' = 'high' and v_rep #>> '{rows,1,computed_level}' = 'low' and (v_rep #>> '{rows,1,overridden}')::boolean then 'PASS' else 'FAIL' end);
  select level into v_txt from public.risk_scores where patient_id = l order by computed_on desc limit 1;
  insert into s38c_results values ('5e the stored computed score is untouched', v_txt, 'low', case when v_txt = 'low' then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.risk_overrides where patient_id = l and organisation_id = v_org;
  insert into s38c_results values ('5f only the valid override was stored, with its organisation', v_n::text || '/' || (v_o ->> 'status'), '1/ok', case when v_n = 1 and v_o ->> 'status' = 'ok' then 'PASS' else 'FAIL' end);

  -- 6. fairness report
  select count(*) into v_n from public.risk_scores where is_test;
  insert into s38c_results values ('6a test patient has a score (so 6e is not vacuous)', v_n::text, '>0', case when v_n > 0 then 'PASS' else 'FAIL' end);
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.risk_distribution_report(); insert into s38c_results values ('6b clinician refused the fairness report', 'ran', 'refused', 'FAIL');
  exception when insufficient_privilege then insert into s38c_results values ('6b clinician refused the fairness report', 'refused', 'refused', 'PASS'); end;
  execute 'reset role';
  -- this fixture has 11 scored non-test people, which would meet the default floor of 11, so raise the floor above it for this check
  update public.outcome_config set config = jsonb_set(config, '{min_cell}', '20') where is_active;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_rep := public.risk_distribution_report();
  execute 'reset role';
  insert into s38c_results values ('6c floor above the group sizes: every group withheld, no total',
    coalesce(v_rep ->> 'total_scored', 'null') || '/' || (select bool_and((c1 ->> 'suppressed')::boolean) from jsonb_array_elements(v_rep #> '{by,state}') c1)::text, 'null/true',
    case when v_rep ->> 'total_scored' is null and (select bool_and((c1 ->> 'suppressed')::boolean) from jsonb_array_elements(v_rep #> '{by,state}') c1) then 'PASS' else 'FAIL' end);
  update public.outcome_config set config = jsonb_set(config, '{min_cell}', '2') where is_active;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_rep := public.risk_distribution_report();
  execute 'reset role';
  select count(distinct patient_id) into v_n from public.risk_scores where not is_test;
  insert into s38c_results values ('6e test account not counted in the total', coalesce(v_rep ->> 'total_scored', 'null'), v_n::text, case when (v_rep ->> 'total_scored')::integer = v_n then 'PASS' else 'FAIL' end);
  insert into s38c_results values ('6d small group withheld (Oyo, 1 person)',
    (select (c1 ->> 'suppressed') from jsonb_array_elements(v_rep #> '{by,state}') c1 where c1 ->> 'key' = 'Oyo'), 'true',
    case when (select (c1 ->> 'suppressed') from jsonb_array_elements(v_rep #> '{by,state}') c1 where c1 ->> 'key' = 'Oyo') = 'true' then 'PASS' else 'FAIL' end);
  insert into s38c_results values ('6f the next smallest group withheld too (Kano), so Oyo cannot be recovered by subtraction',
    (select (c1 ->> 'suppressed') from jsonb_array_elements(v_rep #> '{by,state}') c1 where c1 ->> 'key' = 'Kano'), 'true',
    case when (select (c1 ->> 'suppressed') from jsonb_array_elements(v_rep #> '{by,state}') c1 where c1 ->> 'key' = 'Kano') = 'true' then 'PASS' else 'FAIL' end);
  insert into s38c_results values ('6g a large group is shown with its mix (Lagos 7, high 2)',
    (select (c1 ->> 'n') || '/' || (c1 ->> 'high') from jsonb_array_elements(v_rep #> '{by,state}') c1 where c1 ->> 'key' = 'Lagos'), '7/2',
    case when (select (c1 ->> 'n') || '/' || (c1 ->> 'high') from jsonb_array_elements(v_rep #> '{by,state}') c1 where c1 ->> 'key' = 'Lagos') = '7/2' then 'PASS' else 'FAIL' end);
  update public.outcome_config set config = jsonb_set(config, '{min_cell}', '11') where is_active;

  -- a patient flagged as a test account AFTER being scored leaves every worklist at once
  perform set_config('request.jwt.claims', '', true);   -- back to a service context: only admin or service may flag a test account
  update public.profiles set is_test = true where id = l;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_rep := public.clinician_risk_worklist();
  execute 'reset role';
  insert into s38c_results values ('4g a later is_test flag removes the patient from the worklist', jsonb_array_length(v_rep -> 'rows')::text, '1',
    case when jsonb_array_length(v_rep -> 'rows') = 1 and v_rep #>> '{rows,0,patient_id}' = h::text then 'PASS' else 'FAIL' end);
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set is_test = false where id = l;

  -- =============================== MONTHLY REPORT ===============================
  v_n := private.generate_monthly_reports(v_now2);
  select count(*) into v_n2 from public.monthly_reports where month = v_m;
  insert into s38c_results values ('7a nothing written for last month inside the grace days', v_n2::text, '0', case when v_n2 = 0 then 'PASS' else 'FAIL' end);
  update public.medicine_config set is_active = false where is_active;
  v_n := private.generate_monthly_reports(v_now3);
  select count(*) into v_n2 from public.monthly_reports where month = v_m;
  insert into s38c_results values ('7a2 adherence unreadable: nothing is written (not stored as "nothing to show")', v_n2::text, '0', case when v_n2 = 0 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.ops_incidents where external_reference = 'monthly-reports-failing' and status not in ('resolved', 'closed');
  insert into s38c_results values ('7a3 the failure opens one incident', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);
  update public.medicine_config set is_active = true where version = (select max(version) from public.medicine_config);
  v_n := private.generate_monthly_reports(v_now3);
  select count(*) into v_n2 from public.monthly_reports where month = v_m;
  insert into s38c_results values ('7b written once the grace days passed', v_n2::text, '>=10', case when v_n2 >= 10 then 'PASS' else 'FAIL' end);
  insert into s38c_results values ('7c second run writes nothing', private.generate_monthly_reports(v_now3)::text, '0', case when private.generate_monthly_reports(v_now3) = 0 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.monthly_reports where patient_id = p0;
  insert into s38c_results values ('7d no report for someone who neither joined nor logged', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.monthly_reports where patient_id = p1 and month = v_m;
  insert into s38c_results values ('7e a person who logged but has not joined still gets one', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);

  select payload into v_row from public.monthly_reports where patient_id = h and month = v_m;
  insert into s38c_results values ('7f H: 4 readings on 4 days, average 160.0/100.0, above the default target, no last month to compare',
    (v_row ->> 'readings') || '/' || (v_row ->> 'days_logged') || '/' || (v_row #>> '{average,systolic}') || '/' || (v_row #>> '{average,diastolic}') || '/' || (v_row #>> '{average,versus_target}') || '/' || (v_row #>> '{target,source}') || '/' || (v_row ->> 'direction_vs_last_month'),
    '4/4/160.0/100.0/above/default/not_enough_data',
    case when (v_row ->> 'readings') = '4' and (v_row ->> 'days_logged') = '4' and (v_row #>> '{average,systolic}')::numeric = 160.0 and (v_row #>> '{average,diastolic}')::numeric = 100.0
         and v_row #>> '{average,versus_target}' = 'above' and v_row #>> '{target,source}' = 'default' and v_row ->> 'direction_vs_last_month' = 'not_enough_data' then 'PASS' else 'FAIL' end);
  insert into s38c_results values ('7g weekly split: week 1 has 3 readings with an average, week 2 has 1 reading and none (under the minimum)',
    (v_row #>> '{weeks,0,readings}') || '/' || coalesce(v_row #>> '{weeks,0,avg_systolic}', 'null') || '/' || (v_row #>> '{weeks,1,readings}') || '/' || (case when v_row #> '{weeks,1,avg_systolic}' = 'null'::jsonb then 'null' else 'set' end),
    '3/160.0/1/null',
    case when (v_row #>> '{weeks,0,readings}') = '3' and (v_row #>> '{weeks,0,avg_systolic}')::numeric = 160.0 and (v_row #>> '{weeks,1,readings}') = '1' and v_row #> '{weeks,1,avg_systolic}' = 'null'::jsonb then 'PASS' else 'FAIL' end);
  select payload into v_row from public.monthly_reports where patient_id = r and month = v_m;
  insert into s38c_results values ('7h R: lower than last month and under target', (v_row ->> 'direction_vs_last_month') || '/' || (v_row #>> '{average,versus_target}'), 'lower/under',
    case when v_row ->> 'direction_vs_last_month' = 'lower' and v_row #>> '{average,versus_target}' = 'under' then 'PASS' else 'FAIL' end);
  select payload into v_row from public.monthly_reports where patient_id = pt and month = v_m;
  insert into s38c_results values ('7h2 PT: the report uses her own target 130/80 and says it was set for her',
    (v_row #>> '{target,systolic}') || '/' || (v_row #>> '{target,source}') || '/' || (v_row #>> '{average,versus_target}'), '130/patient/above',
    case when (v_row #>> '{target,systolic}') = '130' and v_row #>> '{target,source}' = 'patient' and v_row #>> '{average,versus_target}' = 'above' then 'PASS' else 'FAIL' end);
  select payload into v_row from public.monthly_reports where patient_id = f and month = v_m;
  insert into s38c_results values ('7i F: two readings is "not enough": no average, no direction',
    (v_row ->> 'enough_readings') || '/' || (case when v_row -> 'average' = 'null'::jsonb then 'null' else 'set' end) || '/' || (v_row ->> 'direction_vs_last_month'), 'false/null/not_enough_data',
    case when (v_row ->> 'enough_readings') = 'false' and v_row -> 'average' = 'null'::jsonb and v_row ->> 'direction_vs_last_month' = 'not_enough_data' then 'PASS' else 'FAIL' end);
  select payload::text into v_txt from public.monthly_reports where patient_id = h and month = v_m;
  insert into s38c_results values ('7j the report carries nothing about risk, other people or care-team activity', (v_txt ~* 'risk|level|rank|percentile|other (patients|people)|task|escalat')::text, 'false',
    case when v_txt !~* 'risk|level|rank|percentile|other (patients|people)|task|escalat' then 'PASS' else 'FAIL' end);
  select is_test into v_ok from public.monthly_reports where patient_id = t and month = v_m;
  insert into s38c_results values ('7k test account report is flagged is_test', coalesce(v_ok::text, 'none'), 'true', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*), count(*) filter (where patient_id <> h) into v_n, v_n2 from public.monthly_reports;
  v_rep := public.my_monthly_reports();
  begin update public.monthly_reports set config_version = 1; insert into s38c_results values ('7m patient cannot update a report', 'updated', 'refused', 'FAIL');
  exception when insufficient_privilege then insert into s38c_results values ('7m patient cannot update a report', 'refused', 'refused', 'PASS'); end;
  execute 'reset role';
  insert into s38c_results values ('7l patient reads only their own reports', v_n || '/' || v_n2 || '/' || jsonb_array_length(v_rep), '>0/0/' || v_n, case when v_n > 0 and v_n2 = 0 and jsonb_array_length(v_rep) = v_n then 'PASS' else 'FAIL' end);
  perform set_config('request.jwt.claims', json_build_object('sub', p0, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_rep := public.my_monthly_reports();
  execute 'reset role';
  insert into s38c_results values ('7n someone with no reports gets an empty list, not anyone else''s', jsonb_array_length(v_rep)::text, '0', case when jsonb_array_length(v_rep) = 0 then 'PASS' else 'FAIL' end);
  begin
    update public.monthly_reports set config_version = 1 where patient_id = h;
    insert into s38c_results values ('7o owner update refused by the append-only trigger', 'updated', 'refused', 'FAIL');
  exception when others then
    insert into s38c_results values ('7o owner update refused by the append-only trigger', sqlerrm, 'monthly_reports_append_only', case when sqlerrm = 'monthly_reports_append_only' then 'PASS' else 'FAIL' end);
  end;

  -- =============================== SABOTAGE ===============================
  create or replace function private.clinician_has_patient_access(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $f$ select true $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_rep := public.clinician_risk_worklist();
  execute 'reset role';
  insert into s38c_results values ('8a SABOTAGE: with the tie forced open the untied clinician sees patients (4d would FAIL)', jsonb_array_length(v_rep -> 'rows')::text, '>0',
    case when jsonb_array_length(v_rep -> 'rows') > 0 then 'PASS' else 'FAIL' end);
  drop trigger monthly_reports_append_only on public.monthly_reports;
  update public.monthly_reports set payload = '{}'::jsonb where patient_id = h and month = v_m;
  select payload::text into v_txt from public.monthly_reports where patient_id = h and month = v_m;
  insert into s38c_results values ('8b SABOTAGE: without the trigger the report is rewritten (7o would FAIL)', v_txt, '{}', case when v_txt = '{}' then 'PASS' else 'FAIL' end);
end $$;

select * from s38c_results order by check_name;

do $$
begin
  if exists (select 1 from s38c_results where verdict = 'FAIL') then
    raise exception 'S38c proof: % check(s) FAILED', (select count(*) from s38c_results where verdict = 'FAIL');
  end if;
end $$;

rollback;
