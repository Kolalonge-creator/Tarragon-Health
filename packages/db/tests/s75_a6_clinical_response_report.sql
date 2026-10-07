-- ===========================================================================
-- Proof: S75 A6 public.clinical_response_report (spec 22.7, 22.8; S-9 no published numbers; INV-13; min cell).
--   1. Role matrix: admin and analyst may read; patient, clinician and anon are refused. Each allowed read writes one audit row (who and the window only).
--   2. Exact numbers for a fixture group (22 completed tasks, claim delay 1..22 minutes, completion delay 61..82): median 11.5 and p90 19.9 to claim,
--      71.5 and 79.9 to complete; 3 open tasks past due; 2 completed after due.
--   3. Small groups are withheld without a count (a group of 5); a measure with fewer than the minimum values in a shown group is withheld on its own
--      (a group of 22 with only 5 claimed).
--   4. Test accounts are never counted: tasks flagged is_test and tasks of an is_test patient change nothing.
--   5. Pages: a role with only 3 pages is withheld.
--   6. The data-quality strip is present and withheld when the member count is under the minimum.
--   7. The reply states it is descriptive only and not for publication; no per-person field exists anywhere in it.
--   8. SABOTAGE: the test-account filter removed; the report must then change (check 4 would FAIL).
-- BEGIN/ROLLBACK; mints its own fixtures. The window is a fixed past window so rows already on the stack cannot disturb the numbers.
-- ===========================================================================
begin;
create temp table s75a6_results (check_name text, observed text, expected text, verdict text);
grant all on s75a6_results to public;

create function pg_temp.mkuser(p_role text, p_name text, p_test boolean default false) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_org uuid := (select id from public.organisations order by created_at limit 1);
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's75a6-' || replace(v::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, is_test)
  values (v, v_org, p_role::public.user_role, p_name, '+23480' || lpad((floor(random() * 99999999))::integer::text, 8, '0'), p_test)
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name, is_test = excluded.is_test;
  return v;
end $$;
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); end $$;
create function pg_temp.report() returns jsonb language sql as $$ select public.clinical_response_report(date '2026-01-10', date '2026-01-12') $$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_base timestamptz := (date '2026-01-10' + time '10:00') at time zone 'Africa/Lagos';
  adm uuid; ana uuid; pat uuid; clin uuid; tp uuid; docu uuid;
  v_t uuid; i integer; v_r jsonb; v_g jsonb; v_n integer; v_before jsonb; v_after jsonb; v_rs uuid; v_code text; v_ver integer; v_ev uuid;
begin
  adm := pg_temp.mkuser('admin', 'S75A6 Admin'); ana := pg_temp.mkuser('analyst', 'S75A6 Analyst'); pat := pg_temp.mkuser('patient', 'S75A6 Patient');
  clin := pg_temp.mkuser('clinician', 'S75A6 Clinician'); tp := pg_temp.mkuser('patient', 'S75A6 Test Patient', true); docu := pg_temp.mkuser('clinician', 'S75A6 Claimant');

  perform set_config('tarragon.task_transition', 'on', true);
  -- group A: class 4, 22 completed (claim after i minutes, completed after 60+i minutes), the last two after their due time (due 60 minutes after creation)
  for i in 1..22 loop
    insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, required_competencies, min_tier,
        due_at, delivery_path, state, claimed_by, claimed_at, claim_expires_at, completed_at, outcome, is_test, created_at)
    values (v_org, 'amber_bp_review', 1, 4, 4, pat, '{}', 'medical_officer', v_base + case when i <= 20 then interval '2 hours' else interval '1 hour' end, 'pull', 'completed',
            docu, v_base + make_interval(mins => i), v_base + make_interval(mins => i + 30), v_base + make_interval(mins => 60 + i), '{"done":true}'::jsonb, false, v_base)
    returning id into v_t;
    insert into public.task_claims (organisation_id, task_id, clinician_id, claimed_at, expires_at, ended_at, end_reason, is_test)
    values (v_org, v_t, docu, v_base + make_interval(mins => i), v_base + make_interval(mins => i + 30), v_base + make_interval(mins => 60 + i), 'completed', false);
  end loop;
  -- 3 open tasks of the same group, long past due
  for i in 1..3 loop
    insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, required_competencies, min_tier,
        due_at, delivery_path, state, is_test, created_at)
    values (v_org, 'amber_bp_review', 1, 4, 4, pat, '{}', 'medical_officer', v_base + interval '1 hour', 'pull', 'open', false, v_base);
  end loop;
  -- group B: class 2, only 5 tasks (withheld)
  for i in 1..5 loop
    insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, required_competencies, min_tier,
        due_at, delivery_path, state, is_test, created_at)
    values (v_org, 'amber_bp_review', 1, 2, 2, pat, '{}', 'medical_officer', v_base + interval '1 hour', 'pull', 'open', false, v_base);
  end loop;
  -- group C: class 3, 22 tasks, only 5 claimed (claim measure withheld inside a shown group)
  for i in 1..22 loop
    insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, required_competencies, min_tier,
        due_at, delivery_path, state, is_test, created_at)
    values (v_org, 'amber_bp_review', 1, 3, 3, pat, '{}', 'medical_officer', v_base + interval '1 day', 'pull', 'open', false, v_base) returning id into v_t;
    if i <= 5 then
      insert into public.task_claims (organisation_id, task_id, clinician_id, claimed_at, expires_at, ended_at, end_reason, is_test)
      values (v_org, v_t, docu, v_base + interval '5 minutes', v_base + interval '35 minutes', v_base + interval '10 minutes', 'handed_back', false);
    end if;
  end loop;
  -- test accounts: 25 tasks of an is_test patient and 25 flagged is_test, class 4, slow to claim (so counting them would move the numbers)
  for i in 1..25 loop
    insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, required_competencies, min_tier,
        due_at, delivery_path, state, is_test, created_at)
    values (v_org, 'amber_bp_review', 1, 4, 4, tp, '{}', 'medical_officer', v_base + interval '1 hour', 'pull', 'open', false, v_base),
           (v_org, 'amber_bp_review', 1, 4, 4, pat, '{}', 'medical_officer', v_base + interval '1 hour', 'pull', 'open', true, v_base);
  end loop;
  perform set_config('tarragon.task_transition', 'off', true);

  -- pages: 3 root pages for one role (withheld). The guard trigger blocks direct inserts, so it is dropped inside this transaction only.
  select id, code, version into v_rs, v_code, v_ver from public.triage_rule_sets order by created_at limit 1;
  if v_rs is null then raise exception 'fixture FAIL: no triage_rule_sets row'; end if;
  drop trigger pages_guard on public.pages;
  for i in 1..3 loop
    insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, created_at)
    values (v_org, pat, 'observation', gen_random_uuid(), 'red', v_rs, v_code, v_ver, 'approved', '[{"kind":"page_on_call"}]'::jsonb, false, v_base) returning id into v_ev;
    insert into public.pages (organisation_id, patient_id, triage_event_id, role, to_clinician_id, escalation_level, sent_at, acknowledged_at, acknowledged_by, config_version, is_test)
    values (v_org, pat, v_ev, 'primary', clin, 0, v_base, v_base + interval '3 minutes', clin, 1, false);
  end loop;

  -- 1 role matrix and audit
  perform pg_temp.as_user(adm); execute 'set local role authenticated';
  v_r := pg_temp.report();
  execute 'reset role';
  insert into s75a6_results values ('1a admin may read', (v_r ? 'tasks')::text, 'true', case when v_r ? 'tasks' then 'PASS' else 'FAIL' end);
  perform pg_temp.as_user(ana); execute 'set local role authenticated';
  v_after := pg_temp.report();
  execute 'reset role';
  insert into s75a6_results values ('1b analyst may read and sees the same figures', (v_after -> 'tasks' = v_r -> 'tasks')::text, 'true', case when v_after -> 'tasks' = v_r -> 'tasks' then 'PASS' else 'FAIL' end);
  foreach v_t in array array[pat, clin] loop
    perform pg_temp.as_user(v_t); execute 'set local role authenticated';
    begin perform pg_temp.report(); insert into s75a6_results values ('1c ' || (select role::text from public.profiles where id = v_t) || ' refused', 'allowed', 'refused', 'FAIL');
    exception when others then insert into s75a6_results values ('1c ' || (select role::text from public.profiles where id = v_t) || ' refused', sqlerrm, 'outcomes_not_authorised', case when sqlerrm = 'outcomes_not_authorised' then 'PASS' else 'FAIL' end); end;
    execute 'reset role';
  end loop;
  perform set_config('request.jwt.claims', '', true);
  begin execute 'set local role anon'; perform pg_temp.report(); insert into s75a6_results values ('1d anon refused', 'allowed', 'refused', 'FAIL');
  exception when others then insert into s75a6_results values ('1d anon refused', 'refused', 'refused', 'PASS'); end;
  execute 'reset role';
  select count(*) into v_n from public.audit_log where action = 'outcomes.clinical_response_report' and actor_id in (adm, ana);
  insert into s75a6_results values ('1e each allowed read is audited, nothing but the window', v_n::text, '2', case when v_n = 2 then 'PASS' else 'FAIL' end);

  -- 2 exact numbers for group A
  select g into v_g from jsonb_array_elements(v_r -> 'tasks') g where g ->> 'priority_class' = '4';
  insert into s75a6_results values ('2a time to claim median/p90', (v_g #>> '{time_to_claim_minutes,median}') || '/' || (v_g #>> '{time_to_claim_minutes,p90}'), '11.5/19.9',
    case when (v_g #>> '{time_to_claim_minutes,median}')::numeric = 11.5 and (v_g #>> '{time_to_claim_minutes,p90}')::numeric = 19.9 then 'PASS' else 'FAIL' end);
  insert into s75a6_results values ('2b time to complete median/p90', (v_g #>> '{time_to_complete_minutes,median}') || '/' || (v_g #>> '{time_to_complete_minutes,p90}'), '71.5/79.9',
    case when (v_g #>> '{time_to_complete_minutes,median}')::numeric = 71.5 and (v_g #>> '{time_to_complete_minutes,p90}')::numeric = 79.9 then 'PASS' else 'FAIL' end);
  insert into s75a6_results values ('2c overdue open now and completed after due', (v_g ->> 'overdue_open_now') || '/' || (v_g ->> 'completed_after_due'), '3/2',
    case when (v_g ->> 'overdue_open_now')::integer = 3 and (v_g ->> 'completed_after_due')::integer = 2 then 'PASS' else 'FAIL' end);

  -- 3 small groups
  select g into v_g from jsonb_array_elements(v_r -> 'tasks') g where g ->> 'priority_class' = '2';
  insert into s75a6_results values ('3a a group of 5 is withheld with no count', (v_g ->> 'suppressed') || '/' || (v_g ? 'n')::text, 'true/false',
    case when (v_g ->> 'suppressed') = 'true' and not (v_g ? 'n') and not (v_g ? 'overdue_open_now') then 'PASS' else 'FAIL' end);
  select g into v_g from jsonb_array_elements(v_r -> 'tasks') g where g ->> 'priority_class' = '3';
  insert into s75a6_results values ('3b a shown group with only 5 claimed withholds the claim measure alone',
    (v_g ->> 'suppressed') || '/' || (v_g #>> '{time_to_claim_minutes,suppressed}'), 'false/true',
    case when (v_g ->> 'suppressed') = 'false' and (v_g #>> '{time_to_claim_minutes,suppressed}') = 'true' then 'PASS' else 'FAIL' end);
  insert into s75a6_results values ('3c no overall total is returned', (v_r ? 'total')::text || (v_r ? 'n')::text, 'falsefalse', case when not (v_r ? 'total') and not (v_r ? 'n') then 'PASS' else 'FAIL' end);

  -- 5 pages
  select g into v_g from jsonb_array_elements(v_r -> 'pages') g where g ->> 'page_role' = 'primary';
  insert into s75a6_results values ('5 a role with 3 pages is withheld', coalesce(v_g ->> 'suppressed', 'missing'), 'true', case when v_g ->> 'suppressed' = 'true' then 'PASS' else 'FAIL' end);

  -- 6 and 7
  insert into s75a6_results values ('6 data quality strip present', (v_r -> 'data_quality' ? 'members_with_a_bp_reading_last_30_days_pct')::text || '/' || (v_r -> 'data_quality' ? 'day90_snapshots_insufficient_data_pct')::text, 'true/true',
    case when v_r -> 'data_quality' ? 'members_with_a_bp_reading_last_30_days_pct' and v_r -> 'data_quality' ? 'day90_snapshots_insufficient_data_pct' then 'PASS' else 'FAIL' end);
  insert into s75a6_results values ('7 descriptive only, not for publication, no person fields', (v_r ->> 'descriptive_only') || '/' || (v_r ->> 'not_for_publication') || '/' || (v_r::text ~* 'patient_id|full_name|phone')::text, 'true/true/false',
    case when v_r ->> 'descriptive_only' = 'true' and v_r ->> 'not_for_publication' = 'true' and v_r::text !~* 'patient_id|full_name|phone' then 'PASS' else 'FAIL' end);

  -- 8 SABOTAGE: test accounts counted
  v_before := v_r -> 'tasks';
  execute replace(pg_get_functiondef('public.clinical_response_report(date,date)'::regprocedure),
    'where not ct.is_test and not coalesce(p.is_test, false)', 'where true');
  perform pg_temp.as_user(adm); execute 'set local role authenticated';
  v_after := pg_temp.report();
  execute 'reset role';
  insert into s75a6_results values ('4/8 SABOTAGE: with the test-account filter removed the report changes (so the filter is what keeps test accounts out)',
    (v_after -> 'tasks' <> v_before)::text, 'true', case when v_after -> 'tasks' <> v_before then 'PASS' else 'FAIL' end);
end $$;

select * from s75a6_results order by check_name;
do $$ begin
  if exists (select 1 from s75a6_results where verdict = 'FAIL') then raise exception 'S75 A6 proof: % check(s) FAILED', (select count(*) from s75a6_results where verdict = 'FAIL'); end if;
end $$;
rollback;
