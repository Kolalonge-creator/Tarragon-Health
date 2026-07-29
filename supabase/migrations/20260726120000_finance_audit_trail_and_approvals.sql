-- Tarragon Health — Finance: audit trail + maker-checker approvals.
--
-- Two additions the original finance build (2026-07-25) deliberately left for
-- a follow-up pass: (1) every HUMAN-triggered finance write now logs to the
-- platform's immutable public.audit_log via the same private.log_audit()
-- helper the super-admin RBAC console uses — deliberately NOT added to
-- private.finance_post_journal itself (the primitive used by automated
-- payment/commission posting), since that would spam the audit log with
-- thousands of routine, already-fully-visible-in-the-ledger entries; audit
-- logging belongs on the public.* human entry points. (2) a real segregation-
-- of-duties control: a manual journal entry at or above a configurable
-- per-currency threshold, and locking an accounting period, now go through a
-- pending-approval queue that a DIFFERENT finance user must approve — the
-- requester can never approve their own request.

-- ---------------------------------------------------------------------------
-- 1. New capability keys.
-- ---------------------------------------------------------------------------
insert into public.permissions (key, label, category, description) values
  ('finance.approvals.manage', 'Approve finance requests', 'Finance', 'Review and approve/reject pending large journal entries and period locks; configure the approval threshold.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Per-currency approval threshold (editable, never hard-coded).
-- ---------------------------------------------------------------------------
create table public.finance_approval_settings (
  currency       public.currency primary key,
  threshold_minor bigint not null check (threshold_minor > 0),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles (id) on delete set null
);
alter table public.finance_approval_settings enable row level security;

insert into public.finance_approval_settings (currency, threshold_minor) values
  ('NGN', 50000000),  -- ₦500,000 — placeholder, finance/founder to confirm
  ('GBP', 500000),    -- £5,000 — placeholder
  ('USD', 500000)     -- $5,000 — placeholder
on conflict (currency) do nothing;

create or replace function public.finance_approval_settings_list()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_finance()
    then coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'threshold_minor', threshold_minor)
           order by currency) from public.finance_approval_settings), '[]'::jsonb)
    else '[]'::jsonb end;
$$;

create or replace function public.finance_upsert_approval_threshold(p_currency text, p_threshold_minor bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.finance_can('finance.approvals.manage') then raise exception 'not authorised'; end if;
  if coalesce(p_threshold_minor, 0) <= 0 then raise exception 'threshold must be positive'; end if;
  insert into public.finance_approval_settings (currency, threshold_minor, updated_at, updated_by)
  values (p_currency::public.currency, p_threshold_minor, now(), (select auth.uid()))
  on conflict (currency) do update set
    threshold_minor = excluded.threshold_minor, updated_at = now(), updated_by = (select auth.uid());
  perform private.log_audit('finance.approval_threshold.upsert', 'finance_approval_settings', null,
    jsonb_build_object('currency', p_currency, 'threshold_minor', p_threshold_minor));
end; $$;

-- ---------------------------------------------------------------------------
-- 3. Approval request queue.
-- ---------------------------------------------------------------------------
create table public.finance_approval_requests (
  id              uuid primary key default gen_random_uuid(),
  request_type    text not null check (request_type in ('manual_journal', 'period_lock')),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  payload         jsonb not null,
  reason          text,
  requested_by    uuid references public.profiles (id) on delete set null,
  requested_at    timestamptz not null default now(),
  reviewed_by     uuid references public.profiles (id) on delete set null,
  reviewed_at     timestamptz,
  review_note     text,
  result_entry_id uuid references public.finance_journal_entries (id) on delete set null,
  created_at      timestamptz not null default now()
);
alter table public.finance_approval_requests enable row level security;
create index finance_approval_requests_status_idx on public.finance_approval_requests (status, requested_at desc);

create or replace function private.finance_request_approval(p_type text, p_payload jsonb, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.finance_approval_requests (request_type, payload, reason, requested_by)
  values (p_type, p_payload, p_reason, (select auth.uid()))
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.finance_pending_approvals()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_finance() then coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'request_type', r.request_type, 'payload', r.payload, 'reason', r.reason,
      'requested_by_name', p.full_name, 'requested_at', r.requested_at,
      'is_own_request', r.requested_by = (select auth.uid()))
      order by r.requested_at)
    from public.finance_approval_requests r
    left join public.profiles p on p.id = r.requested_by
    where r.status = 'pending'), '[]'::jsonb)
  else '[]'::jsonb end;
$$;

create or replace function public.finance_approval_history(p_limit int default 100)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_finance() then coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'request_type', r.request_type, 'status', r.status, 'payload', r.payload,
      'reason', r.reason, 'requested_by_name', rp.full_name, 'requested_at', r.requested_at,
      'reviewed_by_name', vp.full_name, 'reviewed_at', r.reviewed_at, 'review_note', r.review_note,
      'result_entry_id', r.result_entry_id)
      order by coalesce(r.reviewed_at, r.requested_at) desc)
    from public.finance_approval_requests r
    left join public.profiles rp on rp.id = r.requested_by
    left join public.profiles vp on vp.id = r.reviewed_by
    where r.status <> 'pending'
    limit greatest(p_limit, 1)), '[]'::jsonb)
  else '[]'::jsonb end;
$$;

-- Approve: posts the deferred action. Requester can never approve their own
-- request — a real four-eyes control, not just a permission check.
create or replace function public.finance_approve_request(p_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
end; $$;

create or replace function public.finance_reject_request(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.finance_approval_requests%rowtype;
begin
  if not private.finance_can('finance.approvals.manage') then raise exception 'not authorised'; end if;
  select * into r from public.finance_approval_requests where id = p_id for update;
  if r.id is null then raise exception 'approval request not found'; end if;
  if r.status <> 'pending' then raise exception 'request already reviewed'; end if;
  if r.requested_by = (select auth.uid()) then
    raise exception 'a different finance officer must review this request' using errcode = 'check_violation';
  end if;

  update public.finance_approval_requests set
    status = 'rejected', reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = p_note
  where id = p_id;

  perform private.log_audit('finance.approval.reject', 'finance_approval_requests', p_id,
    jsonb_build_object('request_type', r.request_type, 'note', p_note));
end; $$;

-- ---------------------------------------------------------------------------
-- 4. finance_post_manual_journal — now routes a material entry into the
--    approval queue instead of posting immediately. Return type changes
--    uuid → jsonb ({status:'posted'|'pending_approval', entry_id|request_id}),
--    so the function must be dropped before being recreated.
-- ---------------------------------------------------------------------------
drop function if exists public.finance_post_manual_journal(date, text, text, jsonb);

create or replace function public.finance_post_manual_journal(
  p_entry_date date, p_currency text, p_memo text, p_lines jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_req uuid;
  v_max bigint;
  v_threshold bigint;
begin
  if not private.finance_can('finance.gl.post') then raise exception 'not authorised'; end if;

  select coalesce(max(greatest(coalesce((l->>'debit_minor')::bigint,0), coalesce((l->>'credit_minor')::bigint,0))), 0)
    into v_max from jsonb_array_elements(p_lines) l;
  select threshold_minor into v_threshold from public.finance_approval_settings
    where currency = coalesce(p_currency, 'NGN')::public.currency;

  if v_threshold is not null and v_max >= v_threshold then
    v_req := private.finance_request_approval('manual_journal',
      jsonb_build_object('entry_date', coalesce(p_entry_date, current_date), 'currency', coalesce(p_currency, 'NGN'),
                          'memo', p_memo, 'lines', p_lines),
      p_memo);
    perform private.log_audit('finance.journal.request_approval', 'finance_approval_requests', v_req,
      jsonb_build_object('amount_minor', v_max, 'currency', coalesce(p_currency, 'NGN'), 'memo', p_memo));
    return jsonb_build_object('status', 'pending_approval', 'request_id', v_req);
  end if;

  v_id := private.finance_post_journal(
    coalesce(p_entry_date, current_date), coalesce(p_currency,'NGN')::public.currency,
    'manual', null, p_memo, p_lines, (select auth.uid()));
  perform private.log_audit('finance.journal.post', 'finance_journal_entries', v_id,
    jsonb_build_object('memo', p_memo, 'currency', coalesce(p_currency, 'NGN'), 'max_line_minor', v_max));
  return jsonb_build_object('status', 'posted', 'entry_id', v_id);
end; $$;

create or replace function public.finance_reverse_journal(p_entry uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.finance_can('finance.gl.post') then raise exception 'not authorised'; end if;
  v_id := private.finance_reverse_entry(p_entry, p_reason, (select auth.uid()));
  perform private.log_audit('finance.journal.reverse', 'finance_journal_entries', p_entry,
    jsonb_build_object('reason', p_reason, 'reversal_entry_id', v_id));
  return v_id;
end; $$;

-- ---------------------------------------------------------------------------
-- 5. finance_set_period_status — locking now requires a second approver;
--    open/close stay immediate (both easily reversible day-to-day states).
--    Return type changes void → jsonb, so drop-then-recreate.
-- ---------------------------------------------------------------------------
drop function if exists public.finance_set_period_status(date, text);

create or replace function public.finance_set_period_status(p_month date, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_req uuid; v_pm date := date_trunc('month', p_month)::date;
begin
  if not private.finance_can('finance.periods.manage') then raise exception 'not authorised'; end if;
  if p_status not in ('open','closed','locked') then raise exception 'invalid status'; end if;

  if p_status = 'locked' then
    v_req := private.finance_request_approval('period_lock', jsonb_build_object('period_month', v_pm), null);
    perform private.log_audit('finance.period.request_lock', 'finance_periods', null,
      jsonb_build_object('period_month', v_pm, 'request_id', v_req));
    return jsonb_build_object('status', 'pending_approval', 'request_id', v_req);
  end if;

  insert into public.finance_periods (period_month, status)
  values (v_pm, p_status)
  on conflict (period_month) do update set
    status = excluded.status,
    closed_at = case when excluded.status = 'closed' then now() else null end,
    closed_by = case when excluded.status = 'closed' then (select auth.uid()) else null end,
    locked_at = null, locked_by = null;

  perform private.log_audit('finance.period.status_change', 'finance_periods', null,
    jsonb_build_object('period_month', v_pm, 'status', p_status));
  return jsonb_build_object('status', p_status);
end; $$;

-- ---------------------------------------------------------------------------
-- 6. Audit logging added to the remaining write RPCs (no signature change).
-- ---------------------------------------------------------------------------
create or replace function public.finance_upsert_account(
  p_code text, p_name text, p_type text, p_normal_balance text,
  p_vat_treatment text, p_is_active boolean, p_sort_order integer, p_description text
) returns text language plpgsql security definer set search_path = '' as $$
begin
  if not private.finance_can('finance.tax.manage') then raise exception 'not authorised'; end if;
  insert into public.finance_accounts (code, name, account_type, normal_balance, vat_treatment, is_active, sort_order, description)
  values (p_code, p_name, p_type, p_normal_balance, coalesce(p_vat_treatment,'exempt'),
          coalesce(p_is_active,true), coalesce(p_sort_order,0), p_description)
  on conflict (code) do update set
    name = excluded.name, account_type = excluded.account_type, normal_balance = excluded.normal_balance,
    vat_treatment = excluded.vat_treatment, is_active = excluded.is_active,
    sort_order = excluded.sort_order, description = excluded.description, updated_at = now();
  perform private.log_audit('finance.account.upsert', 'finance_accounts', null,
    jsonb_build_object('code', p_code, 'vat_treatment', p_vat_treatment, 'is_active', p_is_active));
  return p_code;
end; $$;

create or replace function public.finance_upsert_tax_rate(
  p_id uuid, p_jurisdiction text, p_tax_type text, p_name text, p_rate_pct numeric,
  p_applies_to text, p_effective_from date, p_is_active boolean, p_notes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.finance_can('finance.tax.manage') then raise exception 'not authorised'; end if;
  if p_id is null then
    insert into public.finance_tax_rates (jurisdiction, tax_type, name, rate_pct, applies_to, effective_from, is_active, notes)
    values (coalesce(p_jurisdiction,'NG'), p_tax_type, p_name, p_rate_pct, p_applies_to,
            coalesce(p_effective_from, current_date), coalesce(p_is_active,true), p_notes)
    returning id into v_id;
  else
    update public.finance_tax_rates set
      jurisdiction=coalesce(p_jurisdiction,'NG'), tax_type=p_tax_type, name=p_name, rate_pct=p_rate_pct,
      applies_to=p_applies_to, effective_from=coalesce(p_effective_from,current_date),
      is_active=coalesce(p_is_active,true), notes=p_notes, updated_at=now()
    where id=p_id returning id into v_id;
  end if;
  perform private.log_audit('finance.tax_rate.upsert', 'finance_tax_rates', v_id,
    jsonb_build_object('tax_type', p_tax_type, 'name', p_name, 'rate_pct', p_rate_pct, 'is_active', p_is_active));
  return v_id;
end; $$;

create or replace function public.finance_import_settlement(
  p_provider text, p_external_ref text, p_settlement_date date, p_currency text,
  p_gross bigint, p_fees bigint, p_net bigint, p_bank_account text, p_notes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.finance_can('finance.reconcile') then raise exception 'not authorised'; end if;
  insert into public.finance_settlements
    (provider, external_ref, settlement_date, currency, gross_minor, fees_minor, net_minor,
     bank_account_code, notes, imported_by)
  values (p_provider::public.payment_provider, nullif(p_external_ref,''), p_settlement_date,
          coalesce(p_currency,'NGN')::public.currency, coalesce(p_gross,0), coalesce(p_fees,0),
          coalesce(p_net,0), coalesce(p_bank_account,'1000'), nullif(p_notes,''), (select auth.uid()))
  returning id into v_id;
  perform private.log_audit('finance.settlement.import', 'finance_settlements', v_id,
    jsonb_build_object('provider', p_provider, 'gross_minor', p_gross, 'fees_minor', p_fees, 'net_minor', p_net));
  return v_id;
end; $$;

create or replace function public.finance_match_payment(
  p_settlement_id uuid, p_payment_transaction_id uuid, p_amount bigint
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_status text;
begin
  if not private.finance_can('finance.reconcile') then raise exception 'not authorised'; end if;
  select status into v_status from public.finance_settlements where id = p_settlement_id;
  if v_status is null then raise exception 'settlement not found'; end if;
  if v_status <> 'draft' then raise exception 'settlement already reconciled — cannot change matches'; end if;
  insert into public.finance_settlement_matches (settlement_id, payment_transaction_id, amount_minor, matched_by)
  values (p_settlement_id, p_payment_transaction_id, p_amount, (select auth.uid()))
  on conflict (payment_transaction_id) do update set
    settlement_id = excluded.settlement_id, amount_minor = excluded.amount_minor, matched_by = excluded.matched_by
  returning id into v_id;
  perform private.log_audit('finance.settlement.match', 'finance_settlements', p_settlement_id,
    jsonb_build_object('payment_transaction_id', p_payment_transaction_id, 'amount_minor', p_amount));
  return v_id;
end; $$;

create or replace function public.finance_unmatch_payment(p_payment_transaction_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_settlement uuid;
begin
  if not private.finance_can('finance.reconcile') then raise exception 'not authorised'; end if;
  select settlement_id into v_settlement from public.finance_settlement_matches
    where payment_transaction_id = p_payment_transaction_id;
  delete from public.finance_settlement_matches m
    using public.finance_settlements s
    where m.settlement_id = s.id and m.payment_transaction_id = p_payment_transaction_id and s.status = 'draft';
  if found then
    perform private.log_audit('finance.settlement.unmatch', 'finance_settlements', v_settlement,
      jsonb_build_object('payment_transaction_id', p_payment_transaction_id));
  end if;
end; $$;

create or replace function public.finance_post_settlement(p_settlement_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  st public.finance_settlements%rowtype;
  v_entry uuid;
begin
  if not private.finance_can('finance.reconcile') then raise exception 'not authorised'; end if;
  select * into st from public.finance_settlements where id = p_settlement_id;
  if st.id is null then raise exception 'settlement not found'; end if;
  if st.status = 'reconciled' then return st.journal_entry_id; end if;
  if st.gross_minor <> st.net_minor + st.fees_minor then
    raise exception 'settlement does not balance: gross % <> net % + fees % (variance %)',
      st.gross_minor, st.net_minor, st.fees_minor, st.gross_minor - (st.net_minor + st.fees_minor)
      using errcode = 'check_violation';
  end if;

  v_entry := private.finance_post_journal(
    st.settlement_date, st.currency, 'payment', 'settlement:' || st.id::text,
    'Settlement ' || st.provider::text || coalesce(' ' || st.external_ref, ''),
    jsonb_build_array(
      jsonb_build_object('account_code', st.bank_account_code, 'debit_minor', st.net_minor, 'credit_minor', 0,
                         'counterparty', st.provider::text),
      jsonb_build_object('account_code', '5000', 'debit_minor', st.fees_minor, 'credit_minor', 0,
                         'counterparty', st.provider::text),
      jsonb_build_object('account_code', '1020', 'debit_minor', 0, 'credit_minor', st.gross_minor,
                         'counterparty', st.provider::text)
    ),
    (select auth.uid()));

  update public.finance_settlements
    set status = 'reconciled', journal_entry_id = v_entry
    where id = st.id;
  perform private.log_audit('finance.settlement.post', 'finance_settlements', p_settlement_id,
    jsonb_build_object('journal_entry_id', v_entry, 'gross_minor', st.gross_minor));
  return v_entry;
end; $$;

create or replace function public.finance_run_revenue_recognition()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if not private.finance_can('finance.gl.post') then raise exception 'not authorised'; end if;
  v_count := private.finance_recognize_revenue(current_date);
  perform private.log_audit('finance.revrec.run', 'revenue_recognition_schedules', null,
    jsonb_build_object('entries_posted', v_count));
  return v_count;
end; $$;

-- ---------------------------------------------------------------------------
-- 7. Grant sweep for everything new in this migration.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text sig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'finance\_%'
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
