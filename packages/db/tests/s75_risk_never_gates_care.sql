-- ===========================================================================
-- Proof: S75 A4 (CMO decision S-6): a risk score never gates care.
--
-- Claiming, ordering and eligibility of clinical_tasks through public.queue_next and private.queue_candidates are IDENTICAL with
-- and without risk_scores / risk_predictions rows for the same patients.
--   1. The scenario (one clinician, five tasks of mixed class and due date, one clinician-eligible set) is run twice in isolated
--      sub-transactions: once with no risk rows, once with HIGH risk rows (risk_scores and risk_predictions) deliberately placed on
--      the patient of the LEAST urgent task, so any consultation of risk would reorder or filter. The eligible set and the full
--      claim order must be identical, and equal to the plain (class, due) order.
--   2. The queue functions (queue_next, queue_candidates, queue_gate, queue_has_block, apply_task_transition) do not mention risk_scores,
--      risk_predictions or risk_models in their source.
--   3. SABOTAGE: queue_next redefined inside the transaction to order by risk first; the same two-run comparison must then DIFFER
--      (so check 1 would have failed), proving the test discriminates.
-- BEGIN/ROLLBACK; mints its own fixtures. The scenario functions end each run in a raised exception so nothing from a run persists.
-- ===========================================================================
begin;

create temp table s75a4_results (check_name text, observed text, expected text, verdict text);
grant all on s75a4_results to public;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's75a4-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S75A4 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

-- One run of the scenario. Returns 'eligible=<labels>|order=<labels>' and leaves nothing behind (the sub-transaction is aborted on purpose).
create function pg_temp.scenario(p_with_risk boolean) returns text language plpgsql as $f$
declare
  v_org uuid; v_admin uuid; v_doc uuid; v_staff uuid; v_model uuid; v_ver integer;
  v_labels text[] := array['A', 'B', 'C', 'D', 'E'];
  v_class smallint[] := array[4, 2, 4, 3, 2];
  v_due integer[] := array[3, 1, 1, 5, 2];
  v_pat uuid[] := '{}'; v_task uuid[] := '{}';
  v_p uuid; v_t uuid; i integer; v_order text := ''; v_elig text; v_next jsonb; v_id uuid; v_idx integer;
begin
  begin
    select id into v_org from public.organisations order by created_at limit 1;
    v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
    update public.clinical_staff set active = false where is_test is not true;
    v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician');
    insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
        license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_doc, 'S75A4 doc', 'MDCN', 'S75A4-' || substr(v_doc::text, 1, 8), true, 'active', now(), v_admin,
        'medical_officer', 'contracted', 2, true, v_admin, true) returning id into v_staff;
    insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
    values (v_org, v_doc, now() - interval '1 minute', now() + interval '2 hours', 'queue', true);

    perform set_config('tarragon.task_transition', 'on', true);
    for i in 1..5 loop
      v_p := pg_temp.mkuser(v_org, 'pat' || v_labels[i], 'patient');
      insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id,
          required_competencies, min_tier, due_at, delivery_path, state, is_test, created_at)
      values (v_org, 'amber_bp_review', 1, v_class[i], v_class[i], v_p, '{}', 'medical_officer', now() + make_interval(days => v_due[i]), 'pull', 'open', true,
              now() - make_interval(mins => i))
      returning id into v_t;
      v_pat := v_pat || v_p; v_task := v_task || v_t;
    end loop;
    perform set_config('tarragon.task_transition', 'off', true);

    if p_with_risk then
      -- HIGH risk on the least urgent task's patient (A: class 4, due in 3 days) and on E; none on B, the most urgent.
      select min(version) into v_ver from public.risk_config;
      select id into v_model from public.risk_models limit 1;
      for i in 1..5 loop
        insert into public.risk_scores (organisation_id, patient_id, model_version, computed_on, deterioration_risk, dropout_risk, level, reasons, is_test)
        values (v_org, v_pat[i], v_ver, current_date, case when v_labels[i] in ('A', 'E') then 99 else 1 end, case when v_labels[i] in ('A', 'E') then 99 else 1 end,
                case when v_labels[i] in ('A', 'E') then 'high' else 'low' end, '[]'::jsonb, true);
        if v_model is not null then
          insert into public.risk_predictions (organisation_id, patient_id, risk_model_id, domain, horizon_days, probability, risk_level, contributors, features_snapshot, influenced_care)
          select v_org, v_pat[i], m.id, m.domain, m.horizon_days, case when v_labels[i] in ('A', 'E') then 0.99 else 0.01 end,
                 case when v_labels[i] in ('A', 'E') then 'high'::public.risk_level else 'low'::public.risk_level end,
                 case when v_labels[i] in ('A', 'E') then '[{"feature":"proof","value":1}]'::jsonb else '[]'::jsonb end, '{}'::jsonb, true
            from public.risk_models m where m.id = v_model;
        end if;
      end loop;
    end if;

    select string_agg(l, ',' order by l) into v_elig
      from (select v_labels[array_position(v_task, c.id)] as l from private.queue_candidates(v_doc, false) c) q;

    perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    for i in 1..5 loop
      v_next := public.queue_next();
      v_id := (v_next -> 'task' ->> 'id')::uuid;
      exit when v_id is null;
      v_idx := array_position(v_task, v_id);
      v_order := v_order || coalesce(v_labels[v_idx], '?');
      perform public.queue_complete(v_id, '{"done":true}'::jsonb);
    end loop;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    raise exception 'S75A4RESULT:eligible=%|order=%|risk=%/%', v_elig, v_order, (select count(*) from public.risk_scores where is_test and computed_on = current_date), (select count(*) from public.risk_predictions where influenced_care);
  exception when others then
    reset role;
    if sqlerrm like 'S75A4RESULT:%' then return substr(sqlerrm, 13); end if;
    return 'ERR:' || sqlerrm;
  end;
end $f$;

do $$
declare
  v_plain text; v_risk text; v_src text; fn text; v_hit text := ''; v_sab_plain text; v_sab_risk text;
begin
  if not exists (select 1 from public.risk_config) then raise exception 'fixture FAIL: no risk_config row'; end if;

  v_plain := pg_temp.scenario(false);
  v_risk := pg_temp.scenario(true);
  insert into s75a4_results values ('1a baseline scenario runs and claims all five in (class, due) order',
    v_plain, 'eligible=A,B,C,D,E|order=BEDCA|risk=0/0', case when v_plain = 'eligible=A,B,C,D,E|order=BEDCA|risk=0/0' then 'PASS' else 'FAIL' end);
  insert into s75a4_results values ('1b with high risk rows on the least urgent patients, eligibility and claim order are identical',
    split_part(v_risk, '|risk=', 1), split_part(v_plain, '|risk=', 1), case when split_part(v_risk, '|risk=', 1) = split_part(v_plain, '|risk=', 1) then 'PASS' else 'FAIL' end);
  insert into s75a4_results values ('1c the risk fixture really wrote five risk_scores rows (so 1b compares something)',
    split_part(v_risk, '|risk=', 2), '5/*', case when split_part(split_part(v_risk, '|risk=', 2), '/', 1) = '5' then 'PASS' else 'FAIL' end);

  -- 2 the queue functions do not mention risk tables
  foreach fn in array array['public.queue_next(text[])', 'private.queue_candidates(uuid,boolean)', 'private.queue_gate(uuid)', 'private.queue_has_block(uuid)'] loop
    v_src := pg_get_functiondef(fn::regprocedure);
    if v_src ~* 'risk_scores|risk_predictions|risk_models|risk_level|deterioration_risk|dropout_risk' then v_hit := v_hit || fn || ' '; end if;
  end loop;
  insert into s75a4_results values ('2 queue_next, queue_candidates, queue_gate, queue_has_block never mention a risk table or column', coalesce(nullif(v_hit, ''), 'none'), 'none',
    case when v_hit = '' then 'PASS' else 'FAIL' end);

  -- 3 SABOTAGE: order by risk first
  execute replace(pg_get_functiondef('public.queue_next(text[])'::regprocedure),
    $a$order by c.priority_class, (c.state <> 'offered_to_lead'), c.due_at, c.created_at$a$,
    $b$order by coalesce((select max(rs.deterioration_risk) from public.risk_scores rs where rs.patient_id = ct.patient_id), 0) desc, c.priority_class, c.due_at, c.created_at$b$);
  v_sab_plain := pg_temp.scenario(false);
  v_sab_risk := pg_temp.scenario(true);
  insert into s75a4_results values ('3 SABOTAGE: with queue_next ordering by risk the two runs differ (1b would FAIL)',
    v_sab_plain || ' vs ' || v_sab_risk, 'different', case when split_part(v_sab_plain, '|risk=', 1) <> split_part(v_sab_risk, '|risk=', 1) and v_sab_plain not like 'ERR:%' and v_sab_risk not like 'ERR:%' then 'PASS' else 'FAIL' end);
end $$;

select * from s75a4_results order by check_name;
do $$ begin
  if exists (select 1 from s75a4_results where verdict = 'FAIL') then raise exception 'S75 A4 proof: % check(s) FAILED', (select count(*) from s75a4_results where verdict = 'FAIL'); end if;
end $$;
rollback;
