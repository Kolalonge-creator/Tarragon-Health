-- Finance dashboard audit (2026-09-18): reversing a posted journal entry had
-- no maker-checker control at all, while posting a large manual entry above
-- the approval threshold correctly routes to a second finance officer
-- (finance_post_manual_journal). finance_reverse_journal only checked
-- finance.gl.post, so anyone with post rights could unilaterally reverse an
-- entry of any size — including a fraud-motivated reversal, which is exactly
-- the scenario the approvals system exists to catch. Give reversal the same
-- threshold check the posting side already has, executed through the same
-- finance_approval_requests queue (a new 'journal_reversal' request_type;
-- request_type is a plain text column, not an enum, so no ALTER TYPE dance).
--
-- finance_reverse_journal's return type changes from uuid to jsonb (same
-- {status, ...} shape finance_post_manual_journal already returns) so the
-- caller can tell a synchronous reversal from one sent for approval;
-- apps/web's reverseJournalAction/ledger.tsx are updated in the same PR to
-- match.

drop function if exists public.finance_reverse_journal(uuid, text);

create or replace function public.finance_reverse_journal(p_entry uuid, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_id uuid;
  v_req uuid;
  v_max bigint;
  v_threshold bigint;
  v_currency public.currency;
  v_entry_no bigint;
begin
  if not private.finance_can('finance.gl.post') then raise exception 'not authorised'; end if;

  select currency, entry_no into v_currency, v_entry_no
    from public.finance_journal_entries where id = p_entry;
  if v_currency is null then raise exception 'entry not found'; end if;

  select coalesce(max(greatest(debit_minor, credit_minor)), 0) into v_max
    from public.finance_journal_lines where entry_id = p_entry;
  select threshold_minor into v_threshold from public.finance_approval_settings
    where currency = v_currency;

  if v_threshold is not null and v_max >= v_threshold then
    v_req := private.finance_request_approval('journal_reversal',
      jsonb_build_object('entry_id', p_entry, 'reason', p_reason),
      p_reason);
    perform private.log_audit('finance.journal.reverse_request_approval', 'finance_journal_entries', p_entry,
      jsonb_build_object('amount_minor', v_max, 'currency', v_currency, 'reason', p_reason, 'request_id', v_req));
    return jsonb_build_object('status', 'pending_approval', 'request_id', v_req);
  end if;

  v_id := private.finance_reverse_entry(p_entry, p_reason, (select auth.uid()));
  perform private.log_audit('finance.journal.reverse', 'finance_journal_entries', p_entry,
    jsonb_build_object('reason', p_reason, 'reversal_entry_id', v_id));
  return jsonb_build_object('status', 'reversed', 'entry_id', v_id);
end; $function$;

-- DROP FUNCTION above clears any explicit grants — reinstate the same one
-- the pre-fix function had (authenticated only; never anon/PUBLIC).
grant execute on function public.finance_reverse_journal(uuid, text) to authenticated;

create or replace function public.finance_approve_request(p_id uuid, p_note text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r public.finance_approval_requests%rowtype;
  v_entry uuid;
  v_month date;
begin
  if not private.finance_can('finance.approvals.manage') then raise exception 'not authorised'; end if;
  select * into r from public.finance_approval_requests where id = p_id for update;
  if r.id is null then raise exception 'approval request not found'; end if;
  if r.status <> 'pending' then raise exception 'request already reviewed'; end if;
  if r.requested_by = (select auth.uid()) then
    raise exception 'a different finance officer must approve this request' using errcode = 'check_violation';
  end if;

  if r.request_type = 'manual_journal' then
    v_entry := private.finance_post_journal(
      (r.payload->>'entry_date')::date, coalesce(r.payload->>'currency', 'NGN')::public.currency,
      'manual', null, r.payload->>'memo', r.payload->'lines', r.requested_by);
    perform private.log_audit('finance.journal.post', 'finance_journal_entries', v_entry,
      jsonb_build_object('via_approval', p_id, 'memo', r.payload->>'memo'));
  elsif r.request_type = 'journal_reversal' then
    v_entry := private.finance_reverse_entry((r.payload->>'entry_id')::uuid, r.payload->>'reason', r.requested_by);
    perform private.log_audit('finance.journal.reverse', 'finance_journal_entries', (r.payload->>'entry_id')::uuid,
      jsonb_build_object('via_approval', p_id, 'reversal_entry_id', v_entry, 'reason', r.payload->>'reason'));
  elsif r.request_type = 'period_lock' then
    v_month := (r.payload->>'period_month')::date;
    insert into public.finance_periods (period_month, status, closed_at, closed_by, locked_at, locked_by)
    values (v_month, 'locked', now(), (select auth.uid()), now(), (select auth.uid()))
    on conflict (period_month) do update set
      status = 'locked',
      closed_at = coalesce(public.finance_periods.closed_at, now()),
      closed_by = coalesce(public.finance_periods.closed_by, (select auth.uid())),
      locked_at = now(), locked_by = (select auth.uid());
    perform private.log_audit('finance.period.lock', 'finance_periods', null,
      jsonb_build_object('period_month', v_month, 'via_approval', p_id));
  end if;

  update public.finance_approval_requests set
    status = 'approved', reviewed_by = (select auth.uid()), reviewed_at = now(),
    review_note = p_note, result_entry_id = v_entry
  where id = p_id;

  perform private.log_audit('finance.approval.approve', 'finance_approval_requests', p_id,
    jsonb_build_object('request_type', r.request_type, 'note', p_note));
  return jsonb_build_object('status', 'approved', 'entry_id', v_entry);
end; $function$;
