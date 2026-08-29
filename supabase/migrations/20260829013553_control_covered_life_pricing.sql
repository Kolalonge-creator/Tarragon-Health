-- Tarragon Health — Control (E7, Revenue Architecture and Earnings Plan):
-- per-covered-life institutional contracts. "Deliberately well below the
-- entry-level HMO premium, because Tarragon is a layer on top of cover,
-- not a substitute for it." ₦9,000/life/year at pilot scale, ₦6,000 above
-- 5,000 lives.
--
-- Revives public.corporate_contracts (20260705211343_b2b_billing.sql)
-- rather than creating a new table: confirmed by codebase audit to be dead
-- schema — present since 2026-07-05, referenced by zero queries/actions/UI
-- anywhere — with EXACTLY the shape this needs already
-- (organisation_id/per_employee_per_year_kobo/employee_count/status/
-- effective_from/effective_to) and RLS already correctly scoped
-- (private.is_org_staff-gated, so — same as outcomes_contracts — the
-- buying institution never reads this directly; Tarragon manages and
-- shares terms manually, matching "corporate wellness plans and HMO
-- partnerships are priced differently... speak to our team directly").
-- Despite its name, nothing in it is employer-specific — it now serves any
-- institutional buyer (employer, HMO, or state), which the source plan's
-- own "employers, HMOs and states" framing for Control needs.
--
-- THIS IS NOT CAPITATION, and that distinction is load-bearing, not
-- cosmetic, given I8 ("no capitation, ever," 2026-07-29, one of four
-- founder-confirmed platform-narrowing removals — hmo_contracts.
-- capitation_rate_kobo was deleted outright, not just deactivated).
-- Capitation means Tarragon is paid a fixed fee per member to bear the
-- FINANCIAL RISK of that member's actual care costs — the more care a
-- capitated member needs, the more Tarragon loses. Control is the
-- opposite shape: a flat fee for a BOUNDED, protocol-driven coordination
-- service (deterministic escalation thresholds, not individualised risk
-- underwriting), sized against the clinician-minute budget the source
-- plan itself sets (~45 minutes/life/year at this price — see
-- docs/REVENUE_ARCHITECTURE_AND_EARNINGS_PLAN.md §5/§6). Tarragon never
-- pays a claim, never bears the cost of a covered life's actual medical
-- care, and the lab/pharmacy/specialist a covered life uses is still paid
-- by them or their institution directly, same as every other product on
-- this platform — Control changes who pays for coordination, never who
-- bears clinical financial risk. Worth the founder's own eyes on this
-- distinction before it's sold, given how deliberately I8 was reinforced.

-- Price book: the two-tier rate, server-pinned like every other price in
-- this codebase. per_employee_per_year_kobo (kept, not renamed, despite
-- covering non-employer buyers too — renaming a live column is more
-- migration risk than the naming mismatch is worth) is set FROM
-- employee_count, never accepted from the caller.
create or replace function private.pin_control_contract_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.per_employee_per_year_kobo := case
    when new.employee_count >= 5000 then 600000  -- ₦6,000/life/yr
    else 900000                                   -- ₦9,000/life/yr, pilot scale
  end;
  return new;
end;
$$;

drop trigger if exists corporate_contracts_pin_control_rate on public.corporate_contracts;
create trigger corporate_contracts_pin_control_rate
  before insert or update of employee_count on public.corporate_contracts
  for each row execute function private.pin_control_contract_rate();

-- ---------------------------------------------------------------------------
-- Admin creation entry point — same "service-role script, no self-service
-- UI" posture as outcomes_contracts and workforce_risk_engagements. The
-- buyer never sees or creates this row themselves; Tarragon manages it.
-- ---------------------------------------------------------------------------
create or replace function public.create_control_contract(
  p_organisation_id uuid,
  p_name text,
  p_covered_lives integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_admin() then
    raise exception 'only a superadmin may create a Control contract' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organisations where id = p_organisation_id) then
    raise exception 'no such organisation';
  end if;
  if p_covered_lives is null or p_covered_lives <= 0 then
    raise exception 'covered_lives must be positive' using errcode = '23514';
  end if;

  insert into public.corporate_contracts (organisation_id, name, employee_count)
  values (p_organisation_id, p_name, p_covered_lives)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_control_contract(uuid, text, integer) from public, anon;
grant execute on function public.create_control_contract(uuid, text, integer) to authenticated;

do $$
declare v_rate bigint;
begin
  if not exists (select 1 from pg_trigger where tgname = 'corporate_contracts_pin_control_rate') then
    raise exception 'FAIL: pricing trigger missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'create_control_contract' and pronamespace = 'public'::regnamespace) then
    raise exception 'FAIL: create_control_contract missing';
  end if;
  if has_function_privilege('anon', 'public.create_control_contract(uuid, text, integer)', 'EXECUTE') then
    raise exception 'FAIL: anon can create a Control contract';
  end if;

  -- Prove both tiers actually price correctly, not just that the trigger exists.
  insert into public.corporate_contracts (organisation_id, name, employee_count)
  values ((select id from public.organisations limit 1), '__pin_rate_test_pilot', 100)
  returning per_employee_per_year_kobo into v_rate;
  if v_rate <> 900000 then raise exception 'FAIL: pilot-scale rate is % not 900000', v_rate; end if;
  delete from public.corporate_contracts where name = '__pin_rate_test_pilot';

  insert into public.corporate_contracts (organisation_id, name, employee_count)
  values ((select id from public.organisations limit 1), '__pin_rate_test_scale', 6000)
  returning per_employee_per_year_kobo into v_rate;
  if v_rate <> 600000 then raise exception 'FAIL: above-5000 rate is % not 600000', v_rate; end if;
  delete from public.corporate_contracts where name = '__pin_rate_test_scale';
end $$;
