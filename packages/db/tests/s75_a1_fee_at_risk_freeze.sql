-- ===========================================================================
-- Proof: S75 A1 (CMO decision S-14) fee-at-risk freeze.
--   1. An HMO admin proposing fee_at_risk is refused; a flat fee is accepted (so the freeze is not a blanket outage).
--   2. A patient and anon are refused (role matrix unchanged).
--   3. A superadmin cannot approve a still-pending fee_at_risk request; can approve a flat one.
--   4. An existing outcomes_contracts row is untouched.
--   5. SABOTAGE: the propose function without the freeze check lets fee_at_risk through (check 1 would FAIL).
-- BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================
begin;

create temp table s75a1_results (check_name text, observed text, expected text, verdict text);
grant all on s75a1_results to public;

do $$
declare
  v_org uuid := gen_random_uuid(); v_hmo uuid := gen_random_uuid(); v_pat uuid := gen_random_uuid(); v_adm uuid := gen_random_uuid();
  v_id uuid; v_req uuid; v_old uuid; v_n integer; v_msg text;
begin
  insert into public.organisations (id, name, type) values (v_org, 'S75A1 HMO', 'hmo');
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select x, 's75a1-' || replace(x::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_hmo, v_pat, v_adm]) x;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_hmo, v_org, 'hmo_admin', 'S75A1 Hmo', '+2348075100001'),
    (v_pat, v_org, 'patient', 'S75A1 Patient', '+2348075100002'),
    (v_adm, v_org, 'admin', 'S75A1 Admin', '+2348075100003')
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id;

  insert into public.outcomes_contracts (organisation_id, contract_type, outcome_thresholds, payout_terms, effective_from)
  values (v_org, 'fee_at_risk', '[]'::jsonb, 'existing', current_date - 30) returning id into v_old;

  -- 1a fee_at_risk refused
  perform set_config('request.jwt.claims', json_build_object('sub', v_hmo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.propose_outcomes_contract_change(v_org, 'fee_at_risk', '[]'::jsonb, 'x', current_date);
    insert into s75a1_results values ('1a hmo_admin fee_at_risk refused', 'allowed', 'refused', 'FAIL');
  exception when others then
    insert into s75a1_results values ('1a hmo_admin fee_at_risk refused', sqlerrm, 'paused', case when sqlerrm like '%paused%' then 'PASS' else 'FAIL' end);
  end;
  -- 1b flat accepted
  begin
    v_id := public.propose_outcomes_contract_change(v_org, 'flat', '[]'::jsonb, 'x', current_date);
    insert into s75a1_results values ('1b hmo_admin flat accepted', (v_id is not null)::text, 'true', case when v_id is not null then 'PASS' else 'FAIL' end);
  exception when others then
    insert into s75a1_results values ('1b hmo_admin flat accepted', sqlerrm, 'true', 'FAIL');
  end;
  execute 'reset role';

  -- 2 patient and anon
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.propose_outcomes_contract_change(v_org, 'flat', '[]'::jsonb, 'x', current_date);
    insert into s75a1_results values ('2a patient refused', 'allowed', 'refused', 'FAIL');
  exception when others then
    insert into s75a1_results values ('2a patient refused', sqlerrm, 'only an HMO', case when sqlerrm like 'only an HMO%' then 'PASS' else 'FAIL' end);
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  begin
    execute 'set local role anon';
    perform public.propose_outcomes_contract_change(v_org, 'flat', '[]'::jsonb, 'x', current_date);
    insert into s75a1_results values ('2b anon refused', 'allowed', 'refused', 'FAIL');
  exception when others then
    insert into s75a1_results values ('2b anon refused', 'refused', 'refused', 'PASS');
  end;
  execute 'reset role';

  -- 3 approval: a pending fee_at_risk request (filed before the freeze) cannot be approved; a flat one can
  insert into public.outcomes_contract_change_requests (organisation_id, contract_type, proposed_payout_terms, requested_by)
  values (v_org, 'fee_at_risk', 'old request', v_hmo) returning id into v_req;
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.approve_outcomes_contract_request(v_req);
    insert into s75a1_results values ('3a admin cannot approve pending fee_at_risk', 'approved', 'refused', 'FAIL');
  exception when others then
    insert into s75a1_results values ('3a admin cannot approve pending fee_at_risk', sqlerrm, 'paused', case when sqlerrm like '%paused%' then 'PASS' else 'FAIL' end);
  end;
  begin
    perform public.approve_outcomes_contract_request(v_id);
    insert into s75a1_results values ('3b admin approves the flat request', 'approved', 'approved', 'PASS');
  exception when others then
    insert into s75a1_results values ('3b admin approves the flat request', sqlerrm, 'approved', 'FAIL');
  end;
  execute 'reset role';

  -- 4 existing contract untouched
  select count(*) into v_n from public.outcomes_contracts where id = v_old and contract_type = 'fee_at_risk' and payout_terms = 'existing';
  insert into s75a1_results values ('4 existing fee_at_risk contract untouched', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);

  -- 5 SABOTAGE: remove the freeze check from the propose function and fee_at_risk goes through
  execute replace(pg_get_functiondef('public.propose_outcomes_contract_change(uuid,text,jsonb,text,date)'::regprocedure),
    $a$if p_contract_type = 'fee_at_risk' then$a$, $b$if false then$b$);
  perform set_config('request.jwt.claims', json_build_object('sub', v_hmo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.propose_outcomes_contract_change(v_org, 'fee_at_risk', '[]'::jsonb, 'x', current_date);
    insert into s75a1_results values ('5 SABOTAGE: without the check fee_at_risk is accepted (1a would FAIL)', 'allowed', 'allowed', 'PASS');
  exception when others then
    insert into s75a1_results values ('5 SABOTAGE: without the check fee_at_risk is accepted (1a would FAIL)', sqlerrm, 'allowed', 'FAIL');
  end;
  execute 'reset role';
end $$;

select * from s75a1_results order by check_name;

do $$
begin
  if exists (select 1 from s75a1_results where verdict = 'FAIL') then
    raise exception 'S75 A1 proof: % check(s) FAILED', (select count(*) from s75a1_results where verdict = 'FAIL');
  end if;
end $$;

rollback;
