-- Tarragon Health — pharmacy settlement parity, part 2: reconcile, settle,
-- refund (spec §25.19). Mirrors 20260821192256_partner_billing_reconcile_
-- settle_refund.sql structurally — same three pieces (a statement table, a
-- matching function, approve-into-AP; a refund-policy table, request/
-- approve RPCs) — adapted for how a pharmacy order actually differs from a
-- lab order:
--   * a statement line matches against a medication_id, not a
--     screen_type_code (pharmacy_medications has no simple text code the
--     way screen_types does);
--   * the liability account is 2710 (part 1 of this pair), not 2700;
--   * "what we owe the pharmacy" is patient price minus Tarragon's
--     commission (part 1's partner_cost_kobo), not a wholesale cost;
--   * the refund reasons are pharmacy-shaped (out of stock, wrong item
--     dispensed, a failed delivery) rather than lab-shaped (a rejected
--     sample, a lost result).
--
-- Deliberately its own pair of tables (pharmacy_partner_statements /
-- pharmacy_partner_statement_lines) rather than widening partner_statements
-- / partner_statement_lines, which already hard-codes lab_order_id and
-- screen_type_code and belongs to migration work this session does not own
-- the history of — see part 1's header for the full explanation.

-- ---------------------------------------------------------------------------
-- 1. The statement a pharmacy partner sends.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.pharmacy_partner_statement_status as enum
    ('draft', 'matched', 'disputed', 'approved', 'settled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.pharmacy_partner_statement_line_resolution as enum
    ('unmatched', 'agreed', 'overcharged', 'undercharged', 'not_ordered', 'not_delivered');
exception when duplicate_object then null; end $$;

create table if not exists public.pharmacy_partner_statements (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  pharmacy_partner_id uuid not null references public.pharmacy_partners (id) on delete restrict,
  reference           text not null,
  period_start        date not null,
  period_end          date not null,
  currency            public.currency not null default 'NGN',
  invoiced_total_kobo bigint not null check (invoiced_total_kobo >= 0),
  expected_total_kobo bigint,
  status              public.pharmacy_partner_statement_status not null default 'draft',
  received_at         timestamptz not null default now(),
  matched_at          timestamptz,
  approved_by         uuid references public.profiles (id) on delete restrict,
  approved_at         timestamptz,
  settled_at          timestamptz,
  bill_id             uuid references public.finance_bills (id) on delete restrict,
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (pharmacy_partner_id, reference),
  check (period_end >= period_start)
);

comment on table public.pharmacy_partner_statements is
  'One invoice from a partner pharmacy for a period. invoiced_total_kobo is what they billed for what they dispensed; expected_total_kobo is what our own orders'' partner_cost_kobo says it should have been. The gap between the two is the entire point of this table — mirrors partner_statements for laboratories.';

create table if not exists public.pharmacy_partner_statement_lines (
  id                uuid primary key default gen_random_uuid(),
  statement_id      uuid not null references public.pharmacy_partner_statements (id) on delete cascade,
  pharmacy_order_id uuid references public.pharmacy_orders (id) on delete restrict,
  partner_reference text,
  medication_id     uuid references public.pharmacy_medications (id) on delete restrict,
  invoiced_kobo     bigint not null check (invoiced_kobo >= 0),
  expected_kobo     bigint,
  resolution        public.pharmacy_partner_statement_line_resolution not null default 'unmatched',
  resolution_note   text,
  resolved_by       uuid references public.profiles (id) on delete restrict,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now()
);

comment on column public.pharmacy_partner_statement_lines.expected_kobo is
  'What Tarragon owes for this medication according to the order''s own snapshotted partner_cost_breakdown. Null means the line matched no order we hold — a finding, not a gap to fill in.';

create index if not exists pharmacy_partner_statement_lines_statement_idx on public.pharmacy_partner_statement_lines (statement_id);
create index if not exists pharmacy_partner_statement_lines_order_idx on public.pharmacy_partner_statement_lines (pharmacy_order_id);
create index if not exists pharmacy_partner_statements_org_idx on public.pharmacy_partner_statements (organisation_id, status);

drop trigger if exists pharmacy_partner_statements_set_updated_at on public.pharmacy_partner_statements;
create trigger pharmacy_partner_statements_set_updated_at
  before update on public.pharmacy_partner_statements
  for each row execute function private.set_updated_at();

alter table public.pharmacy_partner_statements enable row level security;
alter table public.pharmacy_partner_statement_lines enable row level security;

drop policy if exists pharmacy_partner_statements_staff on public.pharmacy_partner_statements;
create policy pharmacy_partner_statements_staff on public.pharmacy_partner_statements
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

drop policy if exists pharmacy_partner_statement_lines_staff on public.pharmacy_partner_statement_lines;
create policy pharmacy_partner_statement_lines_staff on public.pharmacy_partner_statement_lines
  for all to authenticated
  using (exists (select 1 from public.pharmacy_partner_statements ps
                  where ps.id = statement_id and private.is_org_staff(ps.organisation_id)))
  with check (exists (select 1 from public.pharmacy_partner_statements ps
                  where ps.id = statement_id and private.is_org_staff(ps.organisation_id)));

grant select, insert, update on public.pharmacy_partner_statements to authenticated;
grant select, insert, update on public.pharmacy_partner_statement_lines to authenticated;
revoke all on public.pharmacy_partner_statements from anon;
revoke all on public.pharmacy_partner_statement_lines from anon;

-- ---------------------------------------------------------------------------
-- 2. Matching — compares every invoiced line against the order's own
-- snapshotted breakdown, keyed by medication_id rather than a text code.
-- ---------------------------------------------------------------------------
create or replace function public.match_pharmacy_partner_statement(p_statement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stmt public.pharmacy_partner_statements%rowtype;
  v_line record;
  v_expected bigint;
  v_res public.pharmacy_partner_statement_line_resolution;
  v_total_expected bigint := 0;
  v_variances int := 0;
begin
  select * into v_stmt from public.pharmacy_partner_statements where id = p_statement_id;
  if v_stmt.id is null then
    raise exception 'no such statement' using errcode = '42501';
  end if;
  if not private.is_org_staff(v_stmt.organisation_id) then
    raise exception 'only care-team staff can reconcile a partner statement' using errcode = '42501';
  end if;
  if v_stmt.status in ('approved', 'settled') then
    raise exception 'this statement is already % — re-matching it would rewrite an agreed record', v_stmt.status
      using errcode = '23514';
  end if;

  for v_line in
    select * from public.pharmacy_partner_statement_lines where statement_id = p_statement_id
  loop
    v_expected := null;

    if v_line.pharmacy_order_id is not null then
      select (elem ->> 'partner_cost_kobo')::bigint into v_expected
        from public.pharmacy_orders po,
             lateral jsonb_array_elements(coalesce(po.partner_cost_breakdown, '[]'::jsonb)) elem
       where po.id = v_line.pharmacy_order_id
         and (elem ->> 'medication_id')::uuid = v_line.medication_id
       limit 1;
    end if;

    if v_expected is null then
      v_res := 'not_ordered';
    elsif v_line.invoiced_kobo = v_expected then
      v_res := 'agreed';
    elsif v_line.invoiced_kobo > v_expected then
      v_res := 'overcharged';
    else
      v_res := 'undercharged';
    end if;

    if v_res <> 'agreed' then
      v_variances := v_variances + 1;
    end if;
    v_total_expected := v_total_expected + coalesce(v_expected, 0);

    update public.pharmacy_partner_statement_lines
       set expected_kobo = v_expected, resolution = v_res
     where id = v_line.id;
  end loop;

  -- A medication we ordered and paid for that never appears on the
  -- statement at all: the patient's money is held, the pharmacy never
  -- billed us, and without this nobody would ever ask why.
  insert into public.pharmacy_partner_statement_lines
    (statement_id, pharmacy_order_id, medication_id, invoiced_kobo, expected_kobo, resolution, resolution_note)
  select p_statement_id, po.id, (elem ->> 'medication_id')::uuid, 0, (elem ->> 'partner_cost_kobo')::bigint, 'not_delivered',
         'Ordered and paid for in this period, but absent from the statement.'
    from public.pharmacy_orders po,
         lateral jsonb_array_elements(coalesce(po.partner_cost_breakdown, '[]'::jsonb)) elem
   where po.partner_cost_provider_id = v_stmt.pharmacy_partner_id
     and po.status in ('payment_confirmed', 'confirmed', 'dispensed', 'out_for_delivery', 'delivered')
     and po.updated_at::date between v_stmt.period_start and v_stmt.period_end
     and not exists (
       select 1 from public.pharmacy_partner_statement_lines l
        where l.statement_id = p_statement_id
          and l.pharmacy_order_id = po.id
          and l.medication_id = (elem ->> 'medication_id')::uuid
     );

  select count(*) filter (where resolution <> 'agreed'),
         sum(coalesce(expected_kobo, 0))
    into v_variances, v_total_expected
    from public.pharmacy_partner_statement_lines where statement_id = p_statement_id;

  update public.pharmacy_partner_statements
     set expected_total_kobo = v_total_expected,
         status = (case when v_variances = 0 then 'matched' else 'disputed' end)::public.pharmacy_partner_statement_status,
         matched_at = now()
   where id = p_statement_id;

  return jsonb_build_object(
    'ok', true,
    'status', case when v_variances = 0 then 'matched' else 'disputed' end,
    'variance_lines', v_variances,
    'invoiced_kobo', v_stmt.invoiced_total_kobo,
    'expected_kobo', v_total_expected,
    'difference_kobo', v_stmt.invoiced_total_kobo - v_total_expected
  );
end;
$$;

revoke all on function public.match_pharmacy_partner_statement(uuid) from public;
revoke all on function public.match_pharmacy_partner_statement(uuid) from anon;
grant execute on function public.match_pharmacy_partner_statement(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Approval and settlement — moves the liability from 2710 into the
-- ordinary accounts-payable machinery, exactly as approve_partner_statement
-- does for 2700.
-- ---------------------------------------------------------------------------
create or replace function public.approve_pharmacy_partner_statement(
  p_statement_id uuid,
  p_force_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stmt public.pharmacy_partner_statements%rowtype;
  v_unresolved int;
  v_agreed bigint;
  v_vendor uuid;
  v_bill uuid;
  v_entry uuid;
  v_partner_name text;
begin
  select * into v_stmt from public.pharmacy_partner_statements where id = p_statement_id;
  if v_stmt.id is null then
    raise exception 'no such statement' using errcode = '42501';
  end if;
  if not private.is_org_staff(v_stmt.organisation_id) then
    raise exception 'you cannot see this partner statement' using errcode = '42501';
  end if;
  if not private.finance_can('finance.vendors.manage') then
    raise exception 'approving a partner statement commits Tarragon to pay it, which needs finance authority'
      using errcode = '42501';
  end if;
  if v_stmt.status = 'settled' then
    raise exception 'this statement is already settled' using errcode = '23514';
  end if;
  if v_stmt.status = 'draft' then
    raise exception 'match this statement against our orders before approving it' using errcode = '23514';
  end if;

  select count(*) into v_unresolved
    from public.pharmacy_partner_statement_lines
   where statement_id = p_statement_id
     and resolution <> 'agreed'
     and resolved_at is null;

  if v_unresolved > 0 and coalesce(btrim(p_force_note), '') = '' then
    raise exception '% line(s) on this statement still disagree with our orders. Resolve them, or approve with a written reason.', v_unresolved
      using errcode = '23514';
  end if;

  select coalesce(sum(case when resolution in ('agreed', 'undercharged') then invoiced_kobo
                           when resolution = 'overcharged' then coalesce(expected_kobo, invoiced_kobo)
                           else 0 end), 0)
    into v_agreed
    from public.pharmacy_partner_statement_lines where statement_id = p_statement_id;

  if v_agreed <= 0 then
    raise exception 'nothing on this statement is agreed to be payable' using errcode = '23514';
  end if;

  select name into v_partner_name from public.pharmacy_partners where id = v_stmt.pharmacy_partner_id;

  select id into v_vendor from public.finance_vendors where name = v_partner_name;
  if v_vendor is null then
    insert into public.finance_vendors (name, vendor_type, is_active, wht_applicable)
    values (v_partner_name, 'pharmacy', true, false)
    returning id into v_vendor;
  end if;

  v_bill := public.finance_create_bill(
    v_vendor, v_stmt.period_end, v_stmt.period_end + 30, v_stmt.currency::text, v_agreed,
    '2710', 'PARTNER_NET',
    'Pharmacy statement ' || v_stmt.reference
      || ' (' || v_stmt.period_start || ' to ' || v_stmt.period_end || ')');

  v_entry := public.finance_approve_bill(v_bill);

  update public.pharmacy_partner_statements
     set status = 'approved',
         approved_by = (select auth.uid()),
         approved_at = now(),
         bill_id = v_bill,
         note = coalesce(p_force_note, note)
   where id = p_statement_id;

  return jsonb_build_object('ok', true, 'agreed_kobo', v_agreed,
    'invoiced_kobo', v_stmt.invoiced_total_kobo,
    'withheld_kobo', v_stmt.invoiced_total_kobo - v_agreed,
    'bill_id', v_bill, 'journal_entry_id', v_entry);
end;
$$;

revoke all on function public.approve_pharmacy_partner_statement(uuid, text) from public;
revoke all on function public.approve_pharmacy_partner_statement(uuid, text) from anon;
grant execute on function public.approve_pharmacy_partner_statement(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Refunds — the same defined-answer-in-advance discipline as
-- lab_refund_policies, reasons shaped for how a pharmacy order actually
-- fails: never reaches the pharmacy, cannot be filled, is filled wrong, or
-- never reaches the patient.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.pharmacy_refund_reason as enum
    ('patient_cancelled', 'out_of_stock', 'wrong_item_dispensed', 'partially_fulfilled',
     'delivery_failed', 'duplicate_order', 'clinically_withdrawn');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.pharmacy_refund_status as enum ('requested', 'approved', 'rejected', 'paid');
exception when duplicate_object then null; end $$;

create table if not exists public.pharmacy_refund_policies (
  reason             public.pharmacy_refund_reason primary key,
  refunds_in_full    boolean not null,
  partner_still_owed boolean not null,
  note               text not null
);

comment on table public.pharmacy_refund_policies is
  'The defined answer for each way a paid pharmacy order can go wrong, decided in advance rather than per incident. refunds_in_full = the patient gets everything back. partner_still_owed = the pharmacy fulfilled correctly and is paid regardless, so Tarragon absorbs the cost as well as the commission — mirrors lab_refund_policies.';

insert into public.pharmacy_refund_policies (reason, refunds_in_full, partner_still_owed, note) values
  ('patient_cancelled',      true,  false,
   'Cancelled before the pharmacy dispensed anything. Nothing was consumed; the pharmacy is not owed and the patient gets everything back.'),
  ('out_of_stock',           true,  false,
   'The pharmacy could not fulfil the order. Voided and refunded in full — we do not keep money for medication nobody supplied.'),
  ('wrong_item_dispensed',   true,  false,
   'The pharmacy dispensed the wrong item or strength. Refunded in full; the pharmacy is not paid for a fulfilment error.'),
  ('partially_fulfilled',    false, true,
   'Some items were dispensed and some were not (out of stock, a substitution declined). The patient is refunded for what was not dispensed, and the pharmacy is paid for what was.'),
  ('delivery_failed',        true,  true,
   'The pharmacy dispensed correctly and the order never reached the patient (a courier or logistics failure). Our failure, not theirs: the patient is refunded in full AND the pharmacy is still paid. Tarragon absorbs both.'),
  ('duplicate_order',        true,  false,
   'The same order placed twice. The duplicate is voided in full before it reaches the pharmacy.'),
  ('clinically_withdrawn',   true,  false,
   'A clinician withdrew the prescription before it was dispensed. Refunded in full.')
on conflict (reason) do nothing;

alter table public.pharmacy_refund_policies enable row level security;
drop policy if exists pharmacy_refund_policies_select on public.pharmacy_refund_policies;
create policy pharmacy_refund_policies_select on public.pharmacy_refund_policies
  for select to authenticated using (true);
grant select on public.pharmacy_refund_policies to authenticated;
revoke all on public.pharmacy_refund_policies from anon;

create table if not exists public.pharmacy_order_refunds (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  pharmacy_order_id    uuid not null references public.pharmacy_orders (id) on delete restrict,
  reason               public.pharmacy_refund_reason not null references public.pharmacy_refund_policies (reason) on delete restrict,
  status               public.pharmacy_refund_status not null default 'requested',
  refund_total_kobo    bigint not null check (refund_total_kobo > 0),
  partner_portion_kobo bigint not null default 0 check (partner_portion_kobo >= 0),
  margin_portion_kobo  bigint not null default 0 check (margin_portion_kobo >= 0),
  detail               text,
  requested_by         uuid references public.profiles (id) on delete restrict,
  requested_at         timestamptz not null default now(),
  approved_by          uuid references public.profiles (id) on delete restrict,
  approved_at          timestamptz,
  paid_at              timestamptz,
  journal_entry_id     uuid references public.finance_journal_entries (id) on delete restrict,
  created_at           timestamptz not null default now(),
  check (partner_portion_kobo + margin_portion_kobo <= refund_total_kobo)
);

create index if not exists pharmacy_order_refunds_order_idx on public.pharmacy_order_refunds (pharmacy_order_id);
create index if not exists pharmacy_order_refunds_open_idx on public.pharmacy_order_refunds (organisation_id, status)
  where status in ('requested', 'approved');

alter table public.pharmacy_order_refunds enable row level security;

drop policy if exists pharmacy_order_refunds_staff on public.pharmacy_order_refunds;
create policy pharmacy_order_refunds_staff on public.pharmacy_order_refunds
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

drop policy if exists pharmacy_order_refunds_patient_select on public.pharmacy_order_refunds;
create policy pharmacy_order_refunds_patient_select on public.pharmacy_order_refunds
  for select to authenticated
  using (exists (select 1 from public.pharmacy_orders po
                  where po.id = pharmacy_order_id and po.patient_id = (select auth.uid())));

grant select, insert, update on public.pharmacy_order_refunds to authenticated;
revoke all on public.pharmacy_order_refunds from anon;

-- ---------------------------------------------------------------------------
-- 5. Raising one — the split is computed from the policy table, never
-- passed in, same discipline as request_lab_order_refund. Formalises what
-- pharmacist_decline_order's bare refund_status='due' flag started: this is
-- the path that gives it a reason, a GL entry, and a journal_entry_id, for
-- any pharmacy order care-team/finance staff need to refund properly —
-- including ones already flagged 'due' by that existing function.
-- ---------------------------------------------------------------------------
create or replace function public.request_pharmacy_order_refund(
  p_order_id uuid,
  p_reason public.pharmacy_refund_reason,
  p_amount_kobo bigint default null,
  p_detail text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order   public.pharmacy_orders%rowtype;
  v_policy  public.pharmacy_refund_policies%rowtype;
  v_paid    bigint;
  v_amount  bigint;
  v_partner bigint;
  v_margin  bigint;
  v_refund  uuid;
begin
  select * into v_order from public.pharmacy_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'no such order' using errcode = '42501';
  end if;
  if not private.is_org_staff(v_order.organisation_id) then
    raise exception 'only care-team staff can raise a refund' using errcode = '42501';
  end if;

  select * into v_policy from public.pharmacy_refund_policies where reason = p_reason;

  v_paid   := coalesce(v_order.payable_kobo, coalesce(v_order.total_kobo, 0) - coalesce(v_order.voucher_covered_kobo, 0));
  v_amount := case when v_policy.refunds_in_full then v_paid else coalesce(p_amount_kobo, 0) end;

  if v_amount <= 0 then
    raise exception 'a partial refund needs an amount' using errcode = '23514';
  end if;
  if v_amount > v_paid then
    raise exception 'refund of % exceeds the % actually paid on this order', v_amount, v_paid
      using errcode = '23514';
  end if;

  if v_policy.partner_still_owed then
    v_partner := 0;
    v_margin  := v_amount;
  else
    v_partner := least(coalesce(v_order.partner_cost_kobo, 0), v_amount);
    v_margin  := v_amount - v_partner;
  end if;

  insert into public.pharmacy_order_refunds
    (organisation_id, pharmacy_order_id, reason, refund_total_kobo,
     partner_portion_kobo, margin_portion_kobo, detail, requested_by)
  values
    (v_order.organisation_id, p_order_id, p_reason, v_amount,
     v_partner, v_margin, p_detail, (select auth.uid()))
  returning id into v_refund;

  return jsonb_build_object('ok', true, 'refund_id', v_refund,
    'refund_kobo', v_amount, 'released_from_liability_kobo', v_partner,
    'tarragon_loss_kobo', v_margin, 'policy', v_policy.note);
end;
$$;

revoke all on function public.request_pharmacy_order_refund(uuid, public.pharmacy_refund_reason, bigint, text) from public;
revoke all on function public.request_pharmacy_order_refund(uuid, public.pharmacy_refund_reason, bigint, text) from anon;
grant execute on function public.request_pharmacy_order_refund(uuid, public.pharmacy_refund_reason, bigint, text) to authenticated;

create or replace function public.approve_pharmacy_order_refund(p_refund_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r     public.pharmacy_order_refunds%rowtype;
  v_lines jsonb := '[]'::jsonb;
  v_entry uuid;
begin
  select * into v_r from public.pharmacy_order_refunds where id = p_refund_id;
  if v_r.id is null then
    raise exception 'no such refund' using errcode = '42501';
  end if;
  if not private.is_org_staff(v_r.organisation_id) then
    raise exception 'only care-team staff can approve a refund' using errcode = '42501';
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
$$;

revoke all on function public.approve_pharmacy_order_refund(uuid) from public;
revoke all on function public.approve_pharmacy_order_refund(uuid) from anon;
grant execute on function public.approve_pharmacy_order_refund(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Assertions.
-- ---------------------------------------------------------------------------
do $$
declare v_missing text;
begin
  select string_agg(e.enumlabel, ', ') into v_missing
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
   where t.typname = 'pharmacy_refund_reason'
     and not exists (select 1 from public.pharmacy_refund_policies p
                      where p.reason::text = e.enumlabel);
  if v_missing is not null then
    raise exception 'no refund policy defined for: %', v_missing;
  end if;

  if not (select partner_still_owed from public.pharmacy_refund_policies where reason = 'delivery_failed') then
    raise exception 'a failed delivery must still pay the pharmacy — they dispensed correctly';
  end if;
  if (select partner_still_owed from public.pharmacy_refund_policies where reason = 'wrong_item_dispensed') then
    raise exception 'a fulfilment error must not be paid for';
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'pharmacy_partner_statements'
  ) then
    raise exception 'FAIL: pharmacy_partner_statements was not created';
  end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'pharmacy_order_refunds'
  ) then
    raise exception 'FAIL: pharmacy_order_refunds was not created';
  end if;

  if not has_function_privilege('authenticated', 'public.request_pharmacy_order_refund(uuid,public.pharmacy_refund_reason,bigint,text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute request_pharmacy_order_refund';
  end if;
  if not has_function_privilege('authenticated', 'public.approve_pharmacy_partner_statement(uuid,text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute approve_pharmacy_partner_statement';
  end if;

  raise notice 'PASS: pharmacy partner statements, matching, settlement, and refund engine all in place';
end $$;
