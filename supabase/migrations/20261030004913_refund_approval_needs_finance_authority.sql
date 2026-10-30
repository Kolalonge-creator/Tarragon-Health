-- OQ-580: approving a lab or pharmacy refund posts a journal entry, so it needs finance authority.
--
-- Found live 2026-10-30: public.approve_lab_order_refund(uuid) and public.approve_pharmacy_order_refund(uuid) checked only
-- private.is_org_staff(), so a care coordinator or a clinician could approve a refund and post to the ledger. Every other
-- public function that posts to the ledger (finance_post_manual_journal, finance_reverse_journal, finance_run_revenue_recognition)
-- already demands the permission 'finance.gl.post'. These two now do the same. An admin holds every permission, so an admin still
-- approves; a finance user needs the grant; the care team can still RAISE a refund (request_*_order_refund is unchanged).
--
-- Not added on purpose: a rule that the approver differs from the requester. The founder is the sole reviewer (a second-signer
-- rule would stop the only person who can refund from refunding), and approved_by is recorded on the row and in the journal.
--
-- Second finding, from the dry run of this very migration on the live project: finance_journal_entries_source_check allows 'refund'
-- but NOT 'lab_refund' or 'pharmacy_refund', the two sources these functions post with (migration 20260829011043 is recorded as applied
-- but its constraint is not what is live). So both functions failed at the posting step for every caller, an admin included. The
-- constraint is rebuilt below as the live list plus those two. No other function posts a source outside the live list (checked against
-- every live function body that calls private.finance_post_journal), and no existing row uses either new value, so the rebuild
-- validates trivially.
--
-- Third: a finance-role user is not 'care-team staff' under private.is_org_staff, so the grant alone was not enough. The organisation
-- check now also admits a caller whose own organisation is the refund's (private.caller_org()); the permission is still the authority.
--
-- Also added while redefining from the live bodies: the refund row is read FOR UPDATE, so two simultaneous approvals cannot both pass the
-- 'requested' check and post the same refund twice.
--
-- Counts before this change: 0 rows in lab_order_refunds, 0 in pharmacy_order_refunds, and no screen or server action calls either
-- approve function, so no conversion step exists and nothing in flight changes. Both bodies below are the LIVE bodies
-- (pg_get_functiondef, 2026-10-30) with one added check; CREATE OR REPLACE keeps the existing grants (anon has no EXECUTE).

alter table public.finance_journal_entries drop constraint if exists finance_journal_entries_source_check;
alter table public.finance_journal_entries add constraint finance_journal_entries_source_check
  check (source = any (array['payment', 'commission', 'refund', 'wallet', 'voucher', 'platform_credit', 'revenue_recognition', 'fx', 'manual',
                             'adjustment', 'opening', 'payout', 'payout_reversal', 'lab_refund', 'pharmacy_refund']));

create or replace function public.approve_lab_order_refund(p_refund_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_r         public.lab_order_refunds%rowtype;
  v_lines     jsonb := '[]'::jsonb;
  v_entry     uuid;
  v_treatment public.partner_revenue_treatment;
begin
  -- OQ-580: approving posts to the ledger, so it needs the same permission as every other ledger-posting function.
  if not private.has_permission('finance.gl.post') then
    raise exception 'approving a refund posts to the ledger and needs finance authority' using errcode = '42501';
  end if;
  select * into v_r from public.lab_order_refunds where id = p_refund_id for update;
  if v_r.id is null then
    raise exception 'no such refund' using errcode = '42501';
  end if;
  if not (private.is_org_staff(v_r.organisation_id) or v_r.organisation_id = private.caller_org()) then
    raise exception 'only people in this organisation can approve its refunds' using errcode = '42501';
  end if;
  if v_r.status <> 'requested' then
    raise exception 'this refund is already %', v_r.status using errcode = '23514';
  end if;

  v_treatment := private.partner_revenue_treatment();

  if v_treatment = 'gross_principal' then
    -- The entire amount was recognised as revenue, so the entire amount
    -- reverses through contra-revenue.
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','4900','debit_minor',v_r.refund_total_kobo,'credit_minor',0,
                         'organisation_id',v_r.organisation_id,
                         'memo','Refunded to the patient'),
      jsonb_build_object('account_code','2400','debit_minor',0,'credit_minor',v_r.refund_total_kobo,
                         'organisation_id',v_r.organisation_id,
                         'memo','Owed back to the patient'));

    -- And where the laboratory is not owed, its cost unwinds too.
    if v_r.partner_portion_kobo > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_code','2700','debit_minor',v_r.partner_portion_kobo,'credit_minor',0,
                           'organisation_id',v_r.organisation_id,
                           'memo','Released — the laboratory is not owed for this order'),
        jsonb_build_object('account_code','5100','debit_minor',0,'credit_minor',v_r.partner_portion_kobo,
                           'organisation_id',v_r.organisation_id,
                           'memo','Laboratory cost reversed with it'));
    end if;
  else
    if v_r.partner_portion_kobo > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_code','2700','debit_minor',v_r.partner_portion_kobo,'credit_minor',0,
                           'organisation_id',v_r.organisation_id,
                           'memo','Released — the laboratory is not owed for this order'));
    end if;
    if v_r.margin_portion_kobo > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_code','4900','debit_minor',v_r.margin_portion_kobo,'credit_minor',0,
                           'organisation_id',v_r.organisation_id,
                           'memo','Refunded to the patient at Tarragon''s cost'));
    end if;
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_code','2400','debit_minor',0,'credit_minor',v_r.refund_total_kobo,
                         'organisation_id',v_r.organisation_id,
                         'memo','Owed back to the patient'));
  end if;

  v_entry := private.finance_post_journal(
    current_date, 'NGN', 'lab_refund', p_refund_id::text,
    'Laboratory order refund — ' || v_r.reason::text || ' (' || v_treatment::text || ')', v_lines, null);

  update public.lab_order_refunds
     set status = 'approved', approved_by = (select auth.uid()),
         approved_at = now(), journal_entry_id = v_entry
   where id = p_refund_id;

  return jsonb_build_object('ok', true, 'journal_entry_id', v_entry, 'treatment', v_treatment);
end;
$function$;

create or replace function public.approve_pharmacy_order_refund(p_refund_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_r     public.pharmacy_order_refunds%rowtype;
  v_lines jsonb := '[]'::jsonb;
  v_entry uuid;
begin
  -- OQ-580: approving posts to the ledger, so it needs the same permission as every other ledger-posting function.
  if not private.has_permission('finance.gl.post') then
    raise exception 'approving a refund posts to the ledger and needs finance authority' using errcode = '42501';
  end if;
  select * into v_r from public.pharmacy_order_refunds where id = p_refund_id for update;
  if v_r.id is null then
    raise exception 'no such refund' using errcode = '42501';
  end if;
  if not (private.is_org_staff(v_r.organisation_id) or v_r.organisation_id = private.caller_org()) then
    raise exception 'only people in this organisation can approve its refunds' using errcode = '42501';
  end if;
  if v_r.status <> 'requested' then
    raise exception 'this refund is already %', v_r.status using errcode = '23514';
  end if;

  if v_r.partner_portion_kobo > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_code','2710','debit_minor',v_r.partner_portion_kobo,'credit_minor',0,
                         'organisation_id',v_r.organisation_id,
                         'memo','Released — the pharmacy is not owed for this order'));
  end if;
  if v_r.margin_portion_kobo > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_code','4900','debit_minor',v_r.margin_portion_kobo,'credit_minor',0,
                         'organisation_id',v_r.organisation_id,
                         'memo','Refunded to the patient at Tarragon''s cost'));
  end if;
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('account_code','2400','debit_minor',0,'credit_minor',v_r.refund_total_kobo,
                       'organisation_id',v_r.organisation_id,
                       'memo','Owed back to the patient'));

  v_entry := private.finance_post_journal(
    current_date, 'NGN', 'pharmacy_refund', p_refund_id::text,
    'Pharmacy order refund — ' || v_r.reason::text, v_lines, null);

  update public.pharmacy_order_refunds
     set status = 'approved', approved_by = (select auth.uid()),
         approved_at = now(), journal_entry_id = v_entry
   where id = p_refund_id;

  update public.pharmacy_orders
     set refund_status = 'due', refund_amount_kobo = coalesce(refund_amount_kobo, v_r.refund_total_kobo)
   where id = v_r.pharmacy_order_id and refund_status is distinct from 'refunded';

  return jsonb_build_object('ok', true, 'journal_entry_id', v_entry);
end;
$function$;

-- Stated outright so a fresh replay and the live project end in the same place: anon inherits EXECUTE through PUBLIC, never directly.
revoke all on function public.approve_lab_order_refund(uuid) from public, anon;
revoke all on function public.approve_pharmacy_order_refund(uuid) from public, anon;
grant execute on function public.approve_lab_order_refund(uuid) to authenticated, service_role;
grant execute on function public.approve_pharmacy_order_refund(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Self-check: both bodies carry the check, and anon cannot execute either.
-- ---------------------------------------------------------------------------
do $$
declare f text; v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'finance_journal_entries_source_check' and c.conrelid = 'public.finance_journal_entries'::regclass;
  if v_def is null or v_def not like '%lab_refund%' or v_def not like '%pharmacy_refund%' then
    raise exception 'refund approval self-check: the ledger source constraint does not allow the refund sources';
  end if;
  foreach f in array array['public.approve_lab_order_refund(uuid)', 'public.approve_pharmacy_order_refund(uuid)'] loop
    if pg_get_functiondef(f::regprocedure) not like '%finance.gl.post%' then
      raise exception 'refund approval self-check: % does not demand finance authority', f;
    end if;
    if has_function_privilege('anon', f::regprocedure, 'EXECUTE') then
      raise exception 'refund approval self-check: anon can execute %', f;
    end if;
    if not has_function_privilege('authenticated', f::regprocedure, 'EXECUTE') then
      raise exception 'refund approval self-check: authenticated lost execute on % (the check inside is the gate)', f;
    end if;
  end loop;
end $$;
