-- Tarragon Health — Platform Credit: kill switch for NEW top-ups only.
--
-- Launch-scope audit reconciliation, 2026-09-22 (see
-- docs/LAUNCH_SCOPE_AND_PLATFORM_REBUILD_AUDIT_2026-09-21.md and the
-- founder's locked-in decisions in the accompanying plan). One finding from
-- that audit checked out as real and current: Platform Credit
-- (20260917100300_platform_credit_core_schema.sql onward) ships as a live,
-- ungated prepaid-balance top-up flow, and the only legal memo on file
-- (docs/legal/) covers the deleted Health Wallet, not this product's actual
-- shape (paid/promo bucket split, non-transferable, closed-loop spend on
-- service_products). A real Nigerian-fintech counsel review of Platform
-- Credit as built has not happened. This is an engineering follow-up, not a
-- counsel review — that review is flagged to the founder in the PR
-- description as work outside this migration's scope.
--
-- WHAT THIS DOES AND DOES NOT TOUCH
-- ----------------------------------
-- Gates only NEW top-ups (record_platform_credit_topup_intent, the one RPC
-- both the web action — apps/web/.../patient/platform-credit/actions.ts —
-- and the mobile route — apps/web/.../api/mobile/platform-credit/
-- topup-intent/route.ts — call to start funding a balance). Deliberately
-- does NOT touch:
--   * existing balances (platform_credit_balances) — untouched;
--   * the ledger (platform_credit_ledger_entries) — untouched, still fully
--     readable;
--   * spend/redemption of already-funded credit (pay_service_purchase_on_
--     platform_credit, pay_pharmacy_order_on_platform_credit,
--     pay_specialist_referral_on_platform_credit, confirm_video_visit_
--     request_on_platform_credit / accept_video_visit_request) — untouched;
--   * admin grants (grant_platform_credit) — untouched, an admin can still
--     issue promotional credit if genuinely needed.
-- A patient who has already funded a balance keeps every bit of it and can
-- keep spending it exactly as before. This is a deliberate, judgment-call
-- narrowing of "gate Platform Credit" to "gate new money coming in" — stated
-- explicitly here and in the PR description since the plan did not spell out
-- this exact boundary.
--
-- THE MECHANISM — the same public.platform_modules pattern already used for
-- module 27/28 (payer_platform / provider_org_platform,
-- 20260829092227_platform_module_activation_gate.sql): a superadmin-only,
-- audited, note-requiring switch in the database, checked independently at
-- more than one layer so no single UI decision can silently reopen it.
--
-- Platform Credit's write surface is narrower than the payer/provider-org
-- tables that pattern was built for: every write already goes through a
-- single SECURITY DEFINER RPC with no direct INSERT grant to `authenticated`
-- at all (see 20260917100300's own header on this), so there is no RLS
-- INSERT policy for a "module disabled" check to strengthen — the RPC IS
-- the one door. The three layers here are therefore:
--   1. RPC — record_platform_credit_topup_intent itself refuses outright
--      while the module is off (this is the real, load-bearing gate; every
--      caller funnels through it, web and mobile alike, present or future).
--   2. Route/action-level check — both call sites check the module first and
--      return a clear, patient-facing message rather than surfacing the raw
--      RPC exception text.
--   3. UI — platform-credit-card.tsx hides the top-up affordance (suggested
--      amounts, custom-amount form) while leaving balance/ledger display
--      alone, per lib/platform-modules.ts's own "never the ONLY check"
--      warning.

begin;

insert into public.platform_modules (key, label, description) values
  ('platform_credit_topups',
   'Platform Credit — new top-ups',
   'Funding a NEW platform credit top-up (record_platform_credit_topup_intent). Off by default pending a Nigerian-fintech counsel review of Platform Credit as built (paid/promo bucket split, non-transferable, closed-loop spend). Does not touch existing balances, the ledger, or spending already-funded credit — those keep working regardless of this switch.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The real gate: record_platform_credit_topup_intent refuses while the
-- module is off, with a message written for the patient reading it in the
-- product (via the action/route wrappers) rather than assert_module_enabled's
-- generic "<label> is built but not yet activated" phrasing — this is a
-- patient-facing funding flow, not an internal admin console.
-- ---------------------------------------------------------------------------

create or replace function public.record_platform_credit_topup_intent(
  p_patient_id uuid,
  p_amount_kobo bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_config public.platform_credit_config%rowtype;
  v_id uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  if not private.module_enabled('platform_credit_topups') then
    raise exception 'Adding funds to your Platform Credit balance is not available right now. Your existing balance and spending are not affected.'
      using errcode = '23514';
  end if;

  if not private.can_purchase_voucher_for(p_patient_id, v_caller) then
    raise exception 'you can only fund your own platform credit, or someone who has linked you to their care'
      using errcode = '42501';
  end if;

  select organisation_id into v_org from public.profiles where id = p_patient_id;
  if v_org is null then
    raise exception 'patient not found';
  end if;

  select * into v_config from public.platform_credit_config where id = true;
  if p_amount_kobo is null or p_amount_kobo < v_config.min_topup_kobo then
    raise exception 'the minimum top-up is % kobo', v_config.min_topup_kobo;
  end if;
  if p_amount_kobo > v_config.max_topup_kobo then
    raise exception 'the maximum top-up is % kobo', v_config.max_topup_kobo;
  end if;

  insert into public.platform_credit_topup_intents
    (organisation_id, patient_id, purchaser_profile_id, amount_kobo, currency, status)
  values
    (v_org, p_patient_id, v_caller, p_amount_kobo, 'NGN', 'pending_payment')
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.record_platform_credit_topup_intent(uuid, bigint) from public, anon;
grant execute on function public.record_platform_credit_topup_intent(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions — the gate closes (proved with a real simulated patient
-- session, not just "the function contains an if"), spend/read stay open,
-- and a sabotage run (module switched on) shows the check actually
-- discriminates rather than being dead code.
-- ---------------------------------------------------------------------------

do $$
declare
  v_patient uuid;
  v_org     uuid;
  v_before  text;
  v_after   text;
begin
  if private.module_enabled('platform_credit_topups') then
    raise exception 'FAIL: platform_credit_topups shipped switched on — must ship dormant';
  end if;

  select id, organisation_id into v_patient, v_org
    from public.profiles where role = 'patient' limit 1;

  if v_patient is null then
    raise notice 'SKIP: no patient row to prove the gate against; structural checks only';
  else
    begin
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);

      begin
        set local role authenticated;
        perform public.record_platform_credit_topup_intent(v_patient, 1000000);
        reset role;
        v_before := 'ACCEPTED';
      exception when others then
        begin reset role; exception when others then null; end;
        v_before := sqlerrm;
      end;

      raise exception 'ROLLBACK_PROBE';
    exception when others then
      if sqlerrm <> 'ROLLBACK_PROBE' then
        raise;
      end if;
    end;

    if v_before = 'ACCEPTED' then
      raise exception 'FAIL: a top-up intent was accepted while platform_credit_topups is off';
    end if;
    if v_before is null or position('not available right now' in v_before) = 0 then
      raise exception 'FAIL: the refusal message is not the patient-facing one (got: %)', v_before;
    end if;

    -- Sabotage: switch the module on for real (rolled back with everything
    -- else) and prove the same call now succeeds — the check discriminates,
    -- it is not just always-refusing dead code.
    begin
      update public.platform_modules
         set is_enabled = true, enabled_at = now(), enabled_by = v_patient, activation_note = 'sabotage probe'
       where key = 'platform_credit_topups';

      perform set_config('request.jwt.claims',
        json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
      begin
        set local role authenticated;
        perform public.record_platform_credit_topup_intent(v_patient, 1000000);
        reset role;
        v_after := 'ACCEPTED';
      exception when others then
        begin reset role; exception when others then null; end;
        v_after := sqlerrm;
      end;

      raise exception 'ROLLBACK_PROBE_2';
    exception when others then
      if sqlerrm <> 'ROLLBACK_PROBE_2' then
        raise;
      end if;
    end;

    if v_after <> 'ACCEPTED' then
      raise exception 'SABOTAGE FAIL: switching the module on did not reopen top-ups (got: %)', v_after;
    end if;

    raise notice 'PASS: platform_credit_topups gate refuses while off (%), opens once switched on (sabotage confirms discrimination)', v_before;
  end if;

  if private.module_enabled('platform_credit_topups') then
    raise exception 'FAIL: sabotage probe leaked outside its subtransaction — module is on after rollback';
  end if;

  raise notice 'PASS: Platform Credit new-top-ups kill switch in place, spend/read untouched';
end $$;

commit;
