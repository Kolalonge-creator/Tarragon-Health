-- S36j: the Chief Medical Officer may approve payouts (founder decision 2026-10-06, docs/OPEN-QUESTIONS.md: "who may approve
-- payouts when the founder is the only admin: admin OR the Chief Medical Officer").
--
-- This is a money gate, so the change is deliberately narrow:
--   * private.payout_admin_org() is NOT widened. It is shared by build, discard, send, retry and list, and those stay admin only.
--   * A new private.payout_approver_org() admits an admin OR an active Chief Medical Officer, and only approve_payout uses it.
--   * public.approve_payout(uuid) is restated exactly as in 20261006193852_s31_weekly_payouts.sql (same signature, so no overload;
--     no later migration redefines it). Only the caller check changes, plus the approver role is written to the audit row.
--     payout_events.source allows only system/admin/webhook/edge, so the event keeps source 'admin' and the role goes in audit_log.
--   * A CMO who is also the payee still cannot approve their own payout (p.clinician_id = v_uid is refused, unchanged).
--   * public.payout_approval_queue() lets an approver see the drafts waiting: no bank details, no test clinicians (INV-13).

create function private.payout_approver_org() returns uuid
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'payout_not_authorised' using errcode = '42501';
  end if;
  return private.caller_org();
end;
$$;
revoke all on function private.payout_approver_org() from public, anon, authenticated;

create or replace function public.approve_payout(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := private.payout_approver_org();
  v_uid uuid := (select auth.uid());
  v_role text := case when private.is_admin() then 'admin' else 'cmo' end;
  p public.payouts%rowtype;
  b public.clinician_bank_accounts%rowtype;
  v_sum bigint;
  v_n integer;
  v_linked integer;
begin
  if not private.go_live_guard_on('payouts_enabled') then raise exception 'payout_guard_off' using errcode = '55000'; end if;
  select * into p from public.payouts where id = p_id and organisation_id = v_org for update;
  if not found then raise exception 'payout_unknown' using errcode = '22023'; end if;
  if p.state <> 'draft' then raise exception 'payout_not_a_draft' using errcode = '23514'; end if;
  if p.clinician_id = v_uid then raise exception 'payout_self_approval' using errcode = '42501'; end if;
  b := private.payout_ready(p.clinician_id);
  if b.id is null then raise exception 'payout_no_verified_bank' using errcode = '55000'; end if;
  -- The ledger is read again now. If it is not exactly what the draft showed, nothing is approved.
  select coalesce(sum(l.amount_kobo), 0)::bigint, count(*)::integer into v_sum, v_n
    from public.earnings_ledger l
   where l.clinician_id = p.clinician_id and l.organisation_id = p.organisation_id and l.payout_id is null and not l.is_test
     and l.earned_at < private.payout_cutoff(p.period_end);
  if v_sum <> p.amount_kobo or v_n <> p.line_count then raise exception 'payout_ledger_changed' using errcode = '55000'; end if;
  perform set_config('tarragon.payout_write', 'on', true);
  update public.payouts set state = 'approved', approved_by = v_uid, approved_at = now(), bank_account_id = b.id, recipient_code = b.recipient_code where id = p.id;
  perform set_config('tarragon.earnings_payout_link', 'on', true);
  update public.earnings_ledger set payout_id = p.id
   where clinician_id = p.clinician_id and organisation_id = p.organisation_id and payout_id is null and not is_test
     and earned_at < private.payout_cutoff(p.period_end);
  get diagnostics v_linked = row_count;
  perform set_config('tarragon.earnings_payout_link', 'off', true);
  if v_linked <> v_n then raise exception 'payout_link_mismatch' using errcode = '55000'; end if;
  insert into public.payout_transfers (payout_id, attempt, reference) values (p.id, 1, private.payout_reference(p.id, 1));
  perform private.payout_event(p.id, 'draft', 'approved', v_uid, 'admin', null);
  perform set_config('tarragon.payout_write', 'off', true);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'payout.approved', 'payout', p.id, jsonb_build_object('amount_kobo', p.amount_kobo, 'lines', v_n, 'approver_role', v_role));
  return jsonb_build_object('payout_id', p.id, 'reference', private.payout_reference(p.id, 1), 'amount_kobo', p.amount_kobo);
end;
$$;

-- The drafts waiting for an approver. No bank numbers or account names; test clinicians never appear (INV-13).
create function public.payout_approval_queue() returns table (
  id uuid, period_start date, period_end date, amount_kobo bigint, line_count integer, clinician_name text, bank_ready boolean, state text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := private.payout_approver_org();
begin
  return query
    select p.id, p.period_start, p.period_end, p.amount_kobo, p.line_count,
           (select cs.full_name from public.clinical_staff cs where cs.profile_id = p.clinician_id),
           (private.payout_ready(p.clinician_id)).id is not null,
           p.state, p.created_at
      from public.payouts p
     where p.organisation_id = v_org and p.state = 'draft' and not p.is_test
       and not exists (select 1 from public.profiles pr where pr.id = p.clinician_id and pr.is_test)
     order by p.created_at, p.id limit 200;
end;
$$;

revoke all on function public.approve_payout(uuid), public.payout_approval_queue() from public, anon, authenticated;
grant execute on function public.approve_payout(uuid), public.payout_approval_queue() to authenticated;

do $$
declare v_fn text; v_n integer;
begin
  foreach v_fn in array array['public.approve_payout(uuid)', 'public.payout_approval_queue()'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'S36j assertion: anon can execute %', v_fn; end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception 'S36j assertion: authenticated cannot execute %', v_fn; end if;
  end loop;
  if has_function_privilege('anon', 'private.payout_approver_org()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.payout_approver_org()', 'EXECUTE') then
    raise exception 'S36j assertion: payout_approver_org is callable by a client';
  end if;
  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'approve_payout';
  if v_n <> 1 then raise exception 'S36j assertion: approve_payout has % overloads', v_n; end if;
  if pg_get_functiondef('private.payout_admin_org()'::regprocedure) !~ 'private\.is_admin\(\)' or pg_get_functiondef('private.payout_admin_org()'::regprocedure) ~ 'credential_is_cmo' then
    raise exception 'S36j assertion: payout_admin_org must stay admin only';
  end if;
end $$;
