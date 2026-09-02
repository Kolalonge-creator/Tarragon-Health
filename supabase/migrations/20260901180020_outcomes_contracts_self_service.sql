-- Tarragon Health — self-service fee-at-risk contract proposals.
--
-- public.outcomes_contracts (20260714130000) has only a SELECT policy —
-- writes are service-role-only, so no HMO/corporate admin can configure
-- their own fee-at-risk deal today; every one has had to be entered by hand.
-- Founder decision 2026-09-01: let an org's own hmo_admin/corporate_admin
-- PROPOSE terms, but never write outcomes_contracts directly — a fee-at-risk
-- deal is money terms, not logistics (unlike employer_roster_members, which
-- is genuinely low-risk self-service). Models directly on the finance
-- maker-checker pattern (20260726120000_finance_audit_trail_and_approvals.sql
-- — finance_approval_requests / finance_approve_request /
-- finance_reject_request): a change-request row, no update/delete grant to
-- authenticated at all, and a security-definer approval RPC that does the
-- real write. Approver is superadmin (private.is_admin(), role='admin' — the
-- codebase's only super-admin role, see private.is_org_staff()'s own
-- comment) rather than a finance officer, since there is no dedicated
-- ops-review role yet and this isn't a GL entry.

create table public.outcomes_contract_change_requests (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  contract_type               public.outcomes_contract_type not null,
  proposed_outcome_thresholds jsonb not null default '[]',
  proposed_payout_terms       text,
  proposed_effective_from     date not null default current_date,
  status                      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by                uuid references public.profiles (id) on delete set null,
  requested_at                timestamptz not null default now(),
  reviewed_by                 uuid references public.profiles (id) on delete set null,
  reviewed_at                 timestamptz,
  rejection_reason            text,
  created_contract_id         uuid references public.outcomes_contracts (id) on delete set null,
  created_at                  timestamptz not null default now(),
  constraint outcomes_contract_change_requests_reviewed_shape check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status in ('approved', 'rejected') and reviewed_by is not null and reviewed_at is not null)
  )
);
alter table public.outcomes_contract_change_requests enable row level security;
create index outcomes_contract_change_requests_org_idx
  on public.outcomes_contract_change_requests (organisation_id, requested_at desc);
create index outcomes_contract_change_requests_status_idx
  on public.outcomes_contract_change_requests (status, requested_at) where status = 'pending';

-- Reads: the proposing org's own staff, plus superadmin (for the review
-- queue). No update/delete policy at all — status can only move via the
-- approve/reject RPCs below, which run as the function owner and so need no
-- direct grant either.
create policy outcomes_contract_change_requests_select
  on public.outcomes_contract_change_requests
  for select to authenticated
  using (private.is_org_staff(organisation_id) or private.is_admin());

grant select on public.outcomes_contract_change_requests to authenticated;

-- ---------------------------------------------------------------------------
-- propose_outcomes_contract_change — the org-facing entry point. Restricted
-- to hmo_admin/corporate_admin explicitly (not "any org staff") since a
-- pharmacist or lab_liaison at the same org has no business proposing money
-- terms — is_org_staff alone would admit them.
-- ---------------------------------------------------------------------------

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

revoke all on function public.propose_outcomes_contract_change(uuid, text, jsonb, text, date) from public;
revoke all on function public.propose_outcomes_contract_change(uuid, text, jsonb, text, date) from anon;
grant execute on function public.propose_outcomes_contract_change(uuid, text, jsonb, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- approve_outcomes_contract_request / reject_outcomes_contract_request —
-- superadmin only. Approve does the real outcomes_contracts write here (the
-- function owner needs no direct table grant since this is security
-- definer) — one contract per org isn't enforced by a unique constraint
-- (outcomes_contracts allows a history of contracts over time, same as the
-- existing effective_from-ordered index implies), so approving inserts a new
-- row rather than upserting.
-- ---------------------------------------------------------------------------

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

revoke all on function public.approve_outcomes_contract_request(uuid, text) from public;
revoke all on function public.approve_outcomes_contract_request(uuid, text) from anon;
grant execute on function public.approve_outcomes_contract_request(uuid, text) to authenticated;

create or replace function public.reject_outcomes_contract_request(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.outcomes_contract_change_requests%rowtype;
begin
  if not private.is_admin() then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'a rejection reason is required';
  end if;

  select * into r from public.outcomes_contract_change_requests where id = p_id for update;
  if r.id is null then raise exception 'request not found'; end if;
  if r.status <> 'pending' then raise exception 'request already reviewed'; end if;

  update public.outcomes_contract_change_requests
     set status = 'rejected', reviewed_by = (select auth.uid()), reviewed_at = now(),
         rejection_reason = p_reason
   where id = p_id;

  perform private.log_audit('outcomes_contract.rejected', 'outcomes_contract_change_requests', p_id,
    jsonb_build_object('organisation_id', r.organisation_id, 'reason', p_reason));
end;
$$;

revoke all on function public.reject_outcomes_contract_request(uuid, text) from public;
revoke all on function public.reject_outcomes_contract_request(uuid, text) from anon;
grant execute on function public.reject_outcomes_contract_request(uuid, text) to authenticated;

do $$
declare
  v_hmo_org uuid;
  v_hmo_admin uuid;
  v_wrong_role_user uuid;
  v_req_id uuid;
begin
  if has_function_privilege('anon', 'public.propose_outcomes_contract_change(uuid,text,jsonb,text,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.approve_outcomes_contract_request(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.reject_outcomes_contract_request(uuid,text)', 'EXECUTE') then
    raise exception 'FAIL: anon must never touch outcomes contract requests';
  end if;
  -- The real enforcement boundary is RLS POLICY, not the raw GRANT bit —
  -- this platform's own alter-default-privileges fix (see
  -- reference_authenticated_table_grants_root_cause) auto-grants full DML to
  -- authenticated on every table, new or old, so has_table_privilege() would
  -- always read true here regardless of what this migration intends. RLS
  -- with no matching policy still denies the write outright.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'outcomes_contract_change_requests'
      and cmd in ('UPDATE', 'DELETE')
  ) then
    raise exception 'FAIL: no UPDATE/DELETE policy should exist on the change-request table';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'outcomes_contracts' and cmd = 'INSERT'
  ) then
    raise exception 'FAIL: no INSERT policy should exist on outcomes_contracts — approval RPC only';
  end if;

  select id into v_hmo_org from public.organisations where type = 'hmo' limit 1;
  select id into v_hmo_admin from public.profiles where role = 'hmo_admin' and organisation_id = v_hmo_org limit 1;
  select id into v_wrong_role_user from public.profiles where role = 'patient' and organisation_id = v_hmo_org limit 1;

  if v_hmo_org is null or v_hmo_admin is null then
    raise notice 'SKIPPED behavioral proof: no hmo_admin/organisation row to test against';
  else
    -- Simulate the RPC's own logic path directly (this migration script has
    -- no real auth.uid() session) — proves the schema/status-machine shape,
    -- same limitation and same justification as the service_purchases proof
    -- in 20260901174915_promo_codes_service_purchases.sql.
    insert into public.outcomes_contract_change_requests
      (organisation_id, contract_type, proposed_outcome_thresholds, proposed_payout_terms, requested_by)
    values (v_hmo_org, 'fee_at_risk', '[{"metric":"bp_control_percent","target":60}]'::jsonb, 'migration proof', v_hmo_admin)
    returning id into v_req_id;

    update public.outcomes_contract_change_requests
       set status = 'approved', reviewed_by = coalesce(v_wrong_role_user, v_hmo_admin), reviewed_at = now()
     where id = v_req_id;

    if (select status from public.outcomes_contract_change_requests where id = v_req_id) <> 'approved' then
      raise exception 'FAIL: change request did not transition to approved';
    end if;

    delete from public.outcomes_contract_change_requests where id = v_req_id;
  end if;

  raise notice 'PASS: outcomes_contract_change_requests schema + maker-checker RPCs in place';
end $$;
