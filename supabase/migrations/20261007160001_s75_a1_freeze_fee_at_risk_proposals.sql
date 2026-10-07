-- S75 A1 (CMO decision S-14): freeze new fee-at-risk contracts.
--
-- A fee-at-risk contract ties money to an outcome figure that Tarragon cannot yet attribute to its own work (no
-- causal claim, no comparison group). So new fee-at-risk contracts stop being created. This is a soft disable:
--   * public.propose_outcomes_contract_change now REFUSES contract_type = 'fee_at_risk' (a flat fee is still accepted).
--   * public.approve_outcomes_contract_request now REFUSES to turn a still-pending fee_at_risk request into a contract,
--     so a request filed before this migration cannot slip through. It can still be rejected.
-- Existing outcomes_contracts rows are not touched. Existing change requests (any status) are not touched.
-- The bodies below are the live definitions from 20260901180020_outcomes_contracts_self_service.sql (the only
-- definition in this tree) with exactly one added check each.
-- Counts at write time are not read from production; nothing is converted, so no data step exists.

create or replace function public.propose_outcomes_contract_change(
  p_organisation_id uuid,
  p_contract_type text,
  p_outcome_thresholds jsonb,
  p_payout_terms text,
  p_effective_from date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_role public.user_role;
  v_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select role into v_role from public.profiles
    where id = v_caller and organisation_id = p_organisation_id;
  if v_role is null or v_role not in ('hmo_admin', 'corporate_admin') then
    raise exception 'only an HMO or corporate admin for this organisation may propose contract terms'
      using errcode = '42501';
  end if;

  if p_contract_type not in ('fee_at_risk', 'flat') then
    raise exception 'invalid contract type %', p_contract_type;
  end if;
  if p_contract_type = 'fee_at_risk' then
    raise exception 'new fee-at-risk contracts are paused; propose a flat fee instead'
      using errcode = 'P0001';
  end if;
  if p_outcome_thresholds is null or jsonb_typeof(p_outcome_thresholds) <> 'array' then
    raise exception 'outcome_thresholds must be a json array';
  end if;

  insert into public.outcomes_contract_change_requests (
    organisation_id, contract_type, proposed_outcome_thresholds,
    proposed_payout_terms, proposed_effective_from, requested_by
  ) values (
    p_organisation_id, p_contract_type::public.outcomes_contract_type, p_outcome_thresholds,
    p_payout_terms, coalesce(p_effective_from, current_date), v_caller
  )
  returning id into v_id;

  perform private.log_audit('outcomes_contract.change_requested', 'outcomes_contract_change_requests', v_id,
    jsonb_build_object('organisation_id', p_organisation_id, 'contract_type', p_contract_type));

  return v_id;
end;
$$;

revoke all on function public.propose_outcomes_contract_change(uuid, text, jsonb, text, date) from public, anon;
grant execute on function public.propose_outcomes_contract_change(uuid, text, jsonb, text, date) to authenticated;

create or replace function public.approve_outcomes_contract_request(p_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.outcomes_contract_change_requests%rowtype;
  v_contract_id uuid;
begin
  if not private.is_admin() then raise exception 'not authorised' using errcode = '42501'; end if;

  select * into r from public.outcomes_contract_change_requests where id = p_id for update;
  if r.id is null then raise exception 'request not found'; end if;
  if r.status <> 'pending' then raise exception 'request already reviewed'; end if;
  if r.contract_type = 'fee_at_risk' then
    raise exception 'new fee-at-risk contracts are paused; reject this request or ask for a flat fee'
      using errcode = 'P0001';
  end if;

  insert into public.outcomes_contracts (organisation_id, contract_type, outcome_thresholds, payout_terms, effective_from)
  values (r.organisation_id, r.contract_type, r.proposed_outcome_thresholds, r.proposed_payout_terms, r.proposed_effective_from)
  returning id into v_contract_id;

  update public.outcomes_contract_change_requests
     set status = 'approved', reviewed_by = (select auth.uid()), reviewed_at = now(),
         created_contract_id = v_contract_id
   where id = p_id;

  perform private.log_audit('outcomes_contract.approved', 'outcomes_contracts', v_contract_id,
    jsonb_build_object('request_id', p_id, 'organisation_id', r.organisation_id, 'note', p_note));

  return v_contract_id;
end;
$$;

revoke all on function public.approve_outcomes_contract_request(uuid, text) from public, anon;
grant execute on function public.approve_outcomes_contract_request(uuid, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.propose_outcomes_contract_change(uuid,text,jsonb,text,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.approve_outcomes_contract_request(uuid,text)', 'EXECUTE') then
    raise exception 'FAIL: anon must never execute the contract request functions';
  end if;
  if pg_get_functiondef('public.propose_outcomes_contract_change(uuid,text,jsonb,text,date)'::regprocedure) not like '%new fee-at-risk contracts are paused%'
     or pg_get_functiondef('public.approve_outcomes_contract_request(uuid,text)'::regprocedure) not like '%new fee-at-risk contracts are paused%' then
    raise exception 'FAIL: fee-at-risk freeze missing from a function';
  end if;
  raise notice 'PASS: S75 A1 fee-at-risk freeze in place';
end $$;
