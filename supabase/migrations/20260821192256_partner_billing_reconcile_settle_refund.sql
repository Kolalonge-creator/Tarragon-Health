-- Option A, part 3: the unglamorous half. What Synlab invoices, what we agreed
-- to, what happens when those differ, and what a patient gets back when
-- something goes wrong.
--
-- The founder's own note was right that this is the hard part, and right about
-- why: "Paid and never went. Went but the sample was rejected. Went but only
-- half the tests were run. Each needs a defined answer before the first
-- patient hits it, not after." So the answers are a table, filled in now,
-- rather than a judgement call made under pressure by whoever picks up the
-- complaint.

-- ---------------------------------------------------------------------------
-- 1. The per-test cost breakdown, so reconciliation can be line-level.
--
-- partner_cost_kobo is one number for the whole order, which is all the
-- payment split needs. A statement does not arrive as one number: Synlab
-- invoices tests. Matching an invoice line to "some fraction of an order
-- total" would mean re-deriving each test's cost from a price list that has
-- moved since — the exact re-derivation the collect migration exists to avoid.
-- So the breakdown is snapshotted alongside the total, from the same lookup,
-- at the same moment.
-- ---------------------------------------------------------------------------
alter table public.lab_orders
  add column if not exists partner_cost_breakdown jsonb;

comment on column public.lab_orders.partner_cost_breakdown is
  'Per-test cost at the moment of ordering: [{"code": "...", "cost_kobo": n}]. The audit trail behind partner_cost_kobo, and what a statement line is matched against. Never recomputed, for the same reason the total is not.';

create or replace function private.compute_partner_cost(
  p_patient_id uuid,
  p_organisation_id uuid,
  p_bundle_id uuid,
  p_provider_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_codes     text[];
  v_code      text;
  v_cost      bigint;
  v_total     bigint := 0;
  v_missing   text[] := '{}';
  v_breakdown jsonb := '[]'::jsonb;
begin
  select private.patient_delivered_test_codes(p_patient_id, p_organisation_id, pb.test_codes)
    into v_codes
    from public.panel_bundles pb where pb.id = p_bundle_id;

  if v_codes is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_bundle');
  end if;

  foreach v_code in array v_codes loop
    select lt.price_kobo into v_cost
      from public.lab_tests lt
     where lt.provider_id = p_provider_id and lt.code = v_code;

    if v_cost is null then
      v_missing := v_missing || v_code;
    else
      v_total := v_total + v_cost;
      v_breakdown := v_breakdown || jsonb_build_object('code', v_code, 'cost_kobo', v_cost);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', (array_length(v_missing, 1) is null),
    'cost_kobo', v_total,
    'breakdown', v_breakdown,
    'missing_codes', to_jsonb(v_missing)
  );
end;
$$;

revoke all on function private.compute_partner_cost(uuid, uuid, uuid, uuid) from public;

-- Supersedes the collect migration's copy. Identical except that it also
-- stores the breakdown the same function now returns.
create or replace function private.set_lab_order_computed_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price    jsonb;
  v_cost     jsonb;
  v_provider uuid;
begin
  if new.fulfilment is distinct from 'partner' or new.panel_bundle_id is null then
    return new;
  end if;

  v_price := private.compute_review_price(new.patient_id, new.organisation_id, new.panel_bundle_id);

  if not coalesce((v_price ->> 'ok')::boolean, false) then
    raise exception 'Cannot price this review: %', coalesce(v_price ->> 'error', 'unknown')
      using errcode = '23514';
  end if;
  if coalesce((v_price ->> 'delivered_count')::int, 0) = 0 then
    raise exception 'This review contains nothing for this patient — every test in % is excluded for them (sex, age, already on file, or an unmet gate).',
      v_price ->> 'bundle_code' using errcode = '23514';
  end if;
  if not coalesce((v_price ->> 'priceable')::boolean, false) then
    raise exception 'Cannot bill this review — no price on file for: %.',
      (select string_agg(value #>> '{}', ', ') from jsonb_array_elements(v_price -> 'unpriced_codes'))
      using errcode = '23514';
  end if;

  new.total_kobo := (v_price ->> 'total_kobo')::bigint;

  v_provider := private.resolve_lab_order_provider(new.provider_id, new.facility_id);
  if v_provider is null then
    raise exception 'No active partner laboratory for this order.' using errcode = '23514';
  end if;

  v_cost := private.compute_partner_cost(new.patient_id, new.organisation_id, new.panel_bundle_id, v_provider);
  if not coalesce((v_cost ->> 'ok')::boolean, false) then
    raise exception 'The partner laboratory has no contracted price for: %. Taking payment for a test they have not agreed to run would leave the patient paid up and the test undeliverable.',
      (select string_agg(value #>> '{}', ', ') from jsonb_array_elements(v_cost -> 'missing_codes'))
      using errcode = '23514';
  end if;

  new.partner_cost_kobo        := (v_cost ->> 'cost_kobo')::bigint;
  new.partner_cost_breakdown   := v_cost -> 'breakdown';
  new.partner_cost_provider_id := v_provider;

  return new;
end;
$$;

revoke all on function private.set_lab_order_computed_price() from public;

-- ---------------------------------------------------------------------------
-- 2. The statement Synlab sends.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.partner_statement_status as enum
    ('draft', 'matched', 'disputed', 'approved', 'settled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.partner_statement_line_resolution as enum
    ('unmatched', 'agreed', 'overcharged', 'undercharged', 'not_ordered', 'not_delivered');
exception when duplicate_object then null; end $$;

create table if not exists public.partner_statements (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  provider_id         uuid not null references public.lab_providers (id) on delete restrict,
  reference           text not null,
  period_start        date not null,
  period_end          date not null,
  currency            public.currency not null default 'NGN',
  invoiced_total_kobo bigint not null check (invoiced_total_kobo >= 0),
  expected_total_kobo bigint,
  status              public.partner_statement_status not null default 'draft',
  received_at         timestamptz not null default now(),
  matched_at          timestamptz,
  approved_by         uuid references public.profiles (id) on delete restrict,
  approved_at         timestamptz,
  settled_at          timestamptz,
  bill_id             uuid references public.finance_bills (id) on delete restrict,
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (provider_id, reference),
  check (period_end >= period_start)
);

comment on table public.partner_statements is
  'One invoice from a partner laboratory for a period. invoiced_total_kobo is what they billed; expected_total_kobo is what our own orders say it should have been. The gap between the two is the entire point of this table.';

create table if not exists public.partner_statement_lines (
  id               uuid primary key default gen_random_uuid(),
  statement_id     uuid not null references public.partner_statements (id) on delete cascade,
  lab_order_id     uuid references public.lab_orders (id) on delete restrict,
  partner_reference text,
  screen_type_code text references public.screen_types (code) on delete restrict,
  invoiced_kobo    bigint not null check (invoiced_kobo >= 0),
  expected_kobo    bigint,
  resolution       public.partner_statement_line_resolution not null default 'unmatched',
  resolution_note  text,
  resolved_by      uuid references public.profiles (id) on delete restrict,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now()
);

comment on column public.partner_statement_lines.expected_kobo is
  'What this test cost according to the order''s own snapshotted breakdown. Null means the line matched no order we hold — which is a finding, not a gap to fill in.';

create index if not exists partner_statement_lines_statement_idx on public.partner_statement_lines (statement_id);
create index if not exists partner_statement_lines_order_idx on public.partner_statement_lines (lab_order_id);
create index if not exists partner_statements_org_idx on public.partner_statements (organisation_id, status);

drop trigger if exists partner_statements_set_updated_at on public.partner_statements;
create trigger partner_statements_set_updated_at
  before update on public.partner_statements
  for each row execute function private.set_updated_at();

alter table public.partner_statements enable row level security;
alter table public.partner_statement_lines enable row level security;

drop policy if exists partner_statements_staff on public.partner_statements;
create policy partner_statements_staff on public.partner_statements
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

drop policy if exists partner_statement_lines_staff on public.partner_statement_lines;
create policy partner_statement_lines_staff on public.partner_statement_lines
  for all to authenticated
  using (exists (select 1 from public.partner_statements ps
                  where ps.id = statement_id and private.is_org_staff(ps.organisation_id)))
  with check (exists (select 1 from public.partner_statements ps
                  where ps.id = statement_id and private.is_org_staff(ps.organisation_id)));

grant select, insert, update on public.partner_statements to authenticated;
grant select, insert, update on public.partner_statement_lines to authenticated;
revoke all on public.partner_statements from anon;
revoke all on public.partner_statement_lines from anon;

-- ---------------------------------------------------------------------------
-- 3. Matching.
--
-- Compares every invoiced line against the order's own snapshotted breakdown
-- and labels the difference. Deliberately does not "correct" anything: a
-- variance is a fact to be looked at, and a reconciliation that quietly
-- absorbs differences is one that will pay for tests nobody ordered.
-- ---------------------------------------------------------------------------
create or replace function public.match_partner_statement(p_statement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stmt public.partner_statements%rowtype;
  v_line record;
  v_expected bigint;
  v_res public.partner_statement_line_resolution;
  v_total_expected bigint := 0;
  v_variances int := 0;
begin
  select * into v_stmt from public.partner_statements where id = p_statement_id;
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
    select * from public.partner_statement_lines where statement_id = p_statement_id
  loop
    v_expected := null;

    -- The line is matched against what the ORDER recorded, not against the
    -- current price list. An order placed under last quarter's contract is
    -- reconciled at last quarter's price, which is what was actually agreed.
    if v_line.lab_order_id is not null then
      select (elem ->> 'cost_kobo')::bigint into v_expected
        from public.lab_orders lo,
             lateral jsonb_array_elements(coalesce(lo.partner_cost_breakdown, '[]'::jsonb)) elem
       where lo.id = v_line.lab_order_id
         and elem ->> 'code' = v_line.screen_type_code
       limit 1;
    end if;

    if v_expected is null then
      -- Either no order, or an order that never included this test. Both mean
      -- Synlab is billing for something Tarragon did not ask for.
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

    update public.partner_statement_lines
       set expected_kobo = v_expected, resolution = v_res
     where id = v_line.id;
  end loop;

  -- A test we ordered and paid for that never appears on the invoice at all is
  -- the quietest failure of the lot: the patient's money is held, the
  -- laboratory never billed us, and without this nobody would ever ask why.
  insert into public.partner_statement_lines
    (statement_id, lab_order_id, screen_type_code, invoiced_kobo, expected_kobo, resolution, resolution_note)
  select p_statement_id, lo.id, elem ->> 'code', 0, (elem ->> 'cost_kobo')::bigint, 'not_delivered',
         'Ordered and paid for in this period, but absent from the statement.'
    from public.lab_orders lo,
         lateral jsonb_array_elements(coalesce(lo.partner_cost_breakdown, '[]'::jsonb)) elem
   where lo.partner_cost_provider_id = v_stmt.provider_id
     and lo.fulfilment = 'partner'
     and lo.status in ('payment_confirmed', 'sample_collected', 'processing', 'resulted')
     and lo.payment_confirmed_at::date between v_stmt.period_start and v_stmt.period_end
     and not exists (
       select 1 from public.partner_statement_lines l
        where l.statement_id = p_statement_id
          and l.lab_order_id = lo.id
          and l.screen_type_code = elem ->> 'code'
     );

  select count(*) filter (where resolution <> 'agreed'),
         sum(coalesce(expected_kobo, 0))
    into v_variances, v_total_expected
    from public.partner_statement_lines where statement_id = p_statement_id;

  update public.partner_statements
     set expected_total_kobo = v_total_expected,
         -- Cast is required, not stylistic: an untyped CASE result is text,
         -- and Postgres will not implicitly coerce it to the enum.
         status = (case when v_variances = 0 then 'matched' else 'disputed' end)::public.partner_statement_status,
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

revoke all on function public.match_partner_statement(uuid) from public;
grant execute on function public.match_partner_statement(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Approval and settlement.
--
-- Approval is what turns "money we are holding for Synlab" into "money we owe
-- Synlab", and it is the point where the liability moves out of 2700 and into
-- the ordinary accounts-payable machinery that already exists — including
-- withholding tax, which is not optional in Nigeria and which finance_bills
-- already models.
--
--   Dr 2700 Partner lab funds payable   the agreed amount
--   Cr 2500 Accounts payable — vendors  the same amount
--
-- Paying the bill is then the existing AP flow, untouched by this migration.
-- ---------------------------------------------------------------------------
create or replace function public.approve_partner_statement(
  p_statement_id uuid,
  p_force_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stmt public.partner_statements%rowtype;
  v_unresolved int;
  v_agreed bigint;
  v_vendor uuid;
  v_bill uuid;
  v_entry uuid;
  v_provider_name text;
begin
  select * into v_stmt from public.partner_statements where id = p_statement_id;
  if v_stmt.id is null then
    raise exception 'no such statement' using errcode = '42501';
  end if;
  -- Both gates, not either: seeing the statement is an org-staff matter,
  -- committing Tarragon to pay it is a finance one. finance_create_bill and
  -- finance_approve_bill re-check the finance permission themselves, so this
  -- is a clearer early failure rather than the only line of defence.
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
    from public.partner_statement_lines
   where statement_id = p_statement_id
     and resolution <> 'agreed'
     and resolved_at is null;

  -- A variance can be accepted deliberately — a repeat test we agree to pay
  -- for, a price we concede — but never silently. Somebody writes down why.
  if v_unresolved > 0 and coalesce(btrim(p_force_note), '') = '' then
    raise exception '% line(s) on this statement still disagree with our orders. Resolve them, or approve with a written reason.', v_unresolved
      using errcode = '23514';
  end if;

  -- Pay what we agreed, not what was invoiced. An overcharge left unresolved
  -- is not paid just because somebody clicked approve.
  select coalesce(sum(case when resolution in ('agreed', 'undercharged') then invoiced_kobo
                           when resolution = 'overcharged' then coalesce(expected_kobo, invoiced_kobo)
                           else 0 end), 0)
    into v_agreed
    from public.partner_statement_lines where statement_id = p_statement_id;

  if v_agreed <= 0 then
    raise exception 'nothing on this statement is agreed to be payable' using errcode = '23514';
  end if;

  select name into v_provider_name from public.lab_providers where id = v_stmt.provider_id;

  -- Lookup-or-create the vendor. wht_applicable is left FALSE deliberately:
  -- Nigerian withholding tax on services is real and the bill machinery
  -- already handles it (finance_approve_bill splits 2300 out automatically the
  -- moment a rate is set), but the rate that applies to a laboratory contract
  -- is a question for the founder's tax adviser, and guessing 5% or 10% here
  -- would under- or over-withhold from a real partner on every invoice.
  select id into v_vendor from public.finance_vendors where name = v_provider_name;
  if v_vendor is null then
    insert into public.finance_vendors (name, vendor_type, is_active, wht_applicable)
    values (v_provider_name, 'lab', true, false)
    returning id into v_vendor;
  end if;

  -- The bill is raised and approved through the existing accounts-payable
  -- RPCs rather than by inserting a row and posting a journal by hand.
  -- finance_approve_bill posts Dr <expense_account> / Cr 2500 — and with
  -- expense_account_code = '2700' that IS the journal this migration wants:
  -- the held funds leave the partner liability and become a formal vendor
  -- payable. Hand-writing it would have double-posted against the bill's own
  -- entry and skipped the withholding-tax split entirely.
  v_bill := public.finance_create_bill(
    v_vendor, v_stmt.period_end, v_stmt.period_end + 30, v_stmt.currency::text, v_agreed,
    '2700', 'PARTNER_NET',
    'Laboratory statement ' || v_stmt.reference
      || ' (' || v_stmt.period_start || ' to ' || v_stmt.period_end || ')');

  v_entry := public.finance_approve_bill(v_bill);

  update public.partner_statements
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

revoke all on function public.approve_partner_statement(uuid, text) from public;
grant execute on function public.approve_partner_statement(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Refunds — the defined answer, per case, written down in advance.
--
-- Two independent questions decide every refund, and conflating them is how
-- this goes wrong:
--   * does the PATIENT get their money back?      (almost always yes)
--   * do we still owe the LABORATORY for it?      (only if they did the work)
--
-- When the laboratory did nothing, their share is released from the liability
-- and only Tarragon's margin is a real loss. When the laboratory did the work
-- and the failure was ours — a result we lost — the patient is still refunded
-- in full and Tarragon absorbs both the margin AND the lab's cost. That second
-- case is genuinely expensive, which is exactly why it should be visible in
-- the ledger rather than absorbed quietly.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.lab_refund_reason as enum
    ('patient_cancelled', 'never_attended', 'sample_rejected', 'partially_run',
     'result_lost', 'duplicate_order', 'clinically_withdrawn');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lab_refund_status as enum ('requested', 'approved', 'rejected', 'paid');
exception when duplicate_object then null; end $$;

create table if not exists public.lab_refund_policies (
  reason             public.lab_refund_reason primary key,
  refunds_in_full    boolean not null,
  partner_still_owed boolean not null,
  note               text not null
);

comment on table public.lab_refund_policies is
  'The defined answer for each way a paid laboratory order can go wrong, decided in advance rather than per incident. refunds_in_full = the patient gets everything back. partner_still_owed = the laboratory did the work and is paid regardless, so Tarragon absorbs the cost as well as the margin.';

insert into public.lab_refund_policies (reason, refunds_in_full, partner_still_owed, note) values
  ('patient_cancelled',    true,  false,
   'Cancelled before the sample was taken. Nothing was consumed; the laboratory is not owed and the patient gets everything back.'),
  ('never_attended',       true,  false,
   'Paid and never went. The order is voided, the held funds are released, and the patient is refunded in full — we do not keep money for a test nobody performed.'),
  ('sample_rejected',      true,  false,
   'The sample could not be used (haemolysed, insufficient, mislabelled). Refunded in full; the patient may re-book at no penalty. The laboratory is not paid for a sample it could not run.'),
  ('partially_run',        false, true,
   'Some tests ran and some did not. The patient is refunded for the tests that did not, and the laboratory is paid for the ones it did.'),
  ('result_lost',          true,  true,
   'The work was done and the result never reached the patient. Our failure, not theirs: the patient is refunded in full AND the laboratory is still paid. Tarragon absorbs both.'),
  ('duplicate_order',      true,  false,
   'The same review ordered twice. The duplicate is voided in full before it reaches the laboratory.'),
  ('clinically_withdrawn', true,  false,
   'A doctor withdrew the request before it was run — a result already on file, or a change in the clinical picture. Refunded in full.')
on conflict (reason) do nothing;

alter table public.lab_refund_policies enable row level security;
drop policy if exists lab_refund_policies_select on public.lab_refund_policies;
create policy lab_refund_policies_select on public.lab_refund_policies
  for select to authenticated using (true);
grant select on public.lab_refund_policies to authenticated;
revoke all on public.lab_refund_policies from anon;

create table if not exists public.lab_order_refunds (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  lab_order_id        uuid not null references public.lab_orders (id) on delete restrict,
  reason              public.lab_refund_reason not null references public.lab_refund_policies (reason) on delete restrict,
  status              public.lab_refund_status not null default 'requested',
  refund_total_kobo   bigint not null check (refund_total_kobo > 0),
  partner_portion_kobo bigint not null default 0 check (partner_portion_kobo >= 0),
  margin_portion_kobo  bigint not null default 0 check (margin_portion_kobo >= 0),
  detail              text,
  requested_by        uuid references public.profiles (id) on delete restrict,
  requested_at        timestamptz not null default now(),
  approved_by         uuid references public.profiles (id) on delete restrict,
  approved_at         timestamptz,
  paid_at             timestamptz,
  journal_entry_id    uuid references public.finance_journal_entries (id) on delete restrict,
  created_at          timestamptz not null default now(),
  check (partner_portion_kobo + margin_portion_kobo <= refund_total_kobo)
);

create index if not exists lab_order_refunds_order_idx on public.lab_order_refunds (lab_order_id);
create index if not exists lab_order_refunds_open_idx on public.lab_order_refunds (organisation_id, status)
  where status in ('requested', 'approved');

alter table public.lab_order_refunds enable row level security;

drop policy if exists lab_order_refunds_staff on public.lab_order_refunds;
create policy lab_order_refunds_staff on public.lab_order_refunds
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

-- A patient can see that a refund on their own order exists and where it has
-- got to. They cannot create or change one.
drop policy if exists lab_order_refunds_patient_select on public.lab_order_refunds;
create policy lab_order_refunds_patient_select on public.lab_order_refunds
  for select to authenticated
  using (exists (select 1 from public.lab_orders lo
                  where lo.id = lab_order_id and lo.patient_id = (select auth.uid())));

grant select, insert, update on public.lab_order_refunds to authenticated;
revoke all on public.lab_order_refunds from anon;

-- ---------------------------------------------------------------------------
-- 6. Raising one.
--
-- The split is computed from the policy table, never passed in: whoever is
-- handling an upset patient should not also be deciding, in that moment, how
-- much of the refund comes out of a liability and how much out of revenue.
-- ---------------------------------------------------------------------------
create or replace function public.request_lab_order_refund(
  p_order_id uuid,
  p_reason public.lab_refund_reason,
  p_amount_kobo bigint default null,
  p_detail text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order   public.lab_orders%rowtype;
  v_policy  public.lab_refund_policies%rowtype;
  v_paid    bigint;
  v_amount  bigint;
  v_partner bigint;
  v_margin  bigint;
  v_refund  uuid;
begin
  select * into v_order from public.lab_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'no such order' using errcode = '42501';
  end if;
  if not private.is_org_staff(v_order.organisation_id) then
    raise exception 'only care-team staff can raise a refund' using errcode = '42501';
  end if;
  if v_order.fulfilment <> 'partner' then
    raise exception 'a self-arranged order was never billed by Tarragon, so there is nothing here to refund — the patient paid the laboratory directly'
      using errcode = '23514';
  end if;

  select * into v_policy from public.lab_refund_policies where reason = p_reason;

  v_paid   := coalesce(v_order.total_kobo, 0) - coalesce(v_order.subscriber_discount_kobo, 0);
  v_amount := case when v_policy.refunds_in_full then v_paid else coalesce(p_amount_kobo, 0) end;

  if v_amount <= 0 then
    raise exception 'a partial refund needs an amount' using errcode = '23514';
  end if;
  if v_amount > v_paid then
    raise exception 'refund of % exceeds the % actually paid on this order', v_amount, v_paid
      using errcode = '23514';
  end if;

  if v_policy.partner_still_owed then
    -- The laboratory keeps its money; every naira of this refund is Tarragon's
    -- loss, cost included.
    v_partner := 0;
    v_margin  := v_amount;
  else
    -- Release the laboratory's share of the liability first, and only the
    -- remainder is lost margin. Capped at the order's own cost so a partial
    -- refund can never release more liability than the order created.
    v_partner := least(coalesce(v_order.partner_cost_kobo, 0), v_amount);
    v_margin  := v_amount - v_partner;
  end if;

  insert into public.lab_order_refunds
    (organisation_id, lab_order_id, reason, refund_total_kobo,
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

revoke all on function public.request_lab_order_refund(uuid, public.lab_refund_reason, bigint, text) from public;
grant execute on function public.request_lab_order_refund(uuid, public.lab_refund_reason, bigint, text) to authenticated;

create or replace function public.approve_lab_order_refund(p_refund_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r     public.lab_order_refunds%rowtype;
  v_lines jsonb := '[]'::jsonb;
  v_entry uuid;
begin
  select * into v_r from public.lab_order_refunds where id = p_refund_id;
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

  v_entry := private.finance_post_journal(
    current_date, 'NGN', 'lab_refund', p_refund_id::text,
    'Laboratory order refund — ' || v_r.reason::text, v_lines, null);

  update public.lab_order_refunds
     set status = 'approved', approved_by = (select auth.uid()),
         approved_at = now(), journal_entry_id = v_entry
   where id = p_refund_id;

  return jsonb_build_object('ok', true, 'journal_entry_id', v_entry);
end;
$$;

revoke all on function public.approve_lab_order_refund(uuid) from public;
grant execute on function public.approve_lab_order_refund(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Assertions.
-- ---------------------------------------------------------------------------
do $$
declare v_missing text;
begin
  -- Every way this can go wrong has an answer on file. If someone adds a
  -- reason to the enum without deciding what happens, this fails.
  select string_agg(e.enumlabel, ', ') into v_missing
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
   where t.typname = 'lab_refund_reason'
     and not exists (select 1 from public.lab_refund_policies p
                      where p.reason::text = e.enumlabel);
  if v_missing is not null then
    raise exception 'no refund policy defined for: %', v_missing;
  end if;

  -- The expensive case is deliberate, not an oversight.
  if not (select partner_still_owed from public.lab_refund_policies where reason = 'result_lost') then
    raise exception 'a lost result must still pay the laboratory — they did the work';
  end if;
  if (select partner_still_owed from public.lab_refund_policies where reason = 'sample_rejected') then
    raise exception 'a rejected sample must not be paid for';
  end if;

  if pg_get_functiondef('private.set_lab_order_computed_price()'::regprocedure)
       not like '%partner_cost_breakdown%' then
    raise exception 'the order is not snapshotting its per-test cost breakdown';
  end if;
end $$;