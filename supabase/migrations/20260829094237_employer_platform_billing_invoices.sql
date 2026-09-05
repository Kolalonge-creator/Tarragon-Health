-- Tarragon Health — Employer Health Platform, part 6/6: employer billing
-- (Module 26 §26.15).
--
-- Part 1/6 already put the five billing-model shapes onto `corporate_contracts`
-- (billing_model/billing_rate_kobo/billing_fixed_amount_kobo/billing_interval),
-- with a CHECK that a model can never leave its own rate unset. What was
-- missing is an actual INVOICE — a frozen, periodic bill computed from that
-- contract, the way `outcome_reports` freezes a dashboard snapshot rather than
-- recomputing it forever from live data. `employer_invoices` is that freeze:
-- generating one reads the contract and the roster ONCE, and everything after
-- that (headcount_basis, rate, amount) is a fact about that period, immune to
-- a later contract edit or roster change.
--
-- ── Who touches this table ──────────────────────────────────────────────────
-- Money owed by an employer to Tarragon is a Tarragon finance fact, not an
-- institution-admin-writable one — same posture as corporate_contracts
-- itself (Tarragon operations write the contract; the employer only reads
-- it, added in part 1/6). `private.is_finance()` already exists
-- (role in ('finance','admin') or the finance.view permission) and is the
-- established gate for platform money surfaces, so it gates generation and
-- status changes here too. The employer reads its own invoices (it needs to
-- know what it owes) exactly like it reads its own contract.
--
-- ── What is deliberately NOT built here ─────────────────────────────────────
-- No payment collection flow. `payment_transactions`/the Paystack/Stripe
-- webhook machinery is the subscription-billing path (an individual paying
-- for their own plan); a B2B invoice is typically settled by bank transfer
-- against a PO, off-platform, and `employer_invoices.status` (draft -> issued
-- -> paid -> void) is Tarragon finance recording that reality by hand, not a
-- checkout integration. Building a second payment collector for the B2B side
-- is a materially larger, separate ask.

create type public.employer_invoice_status as enum ('draft', 'issued', 'paid', 'void');

create table public.employer_invoices (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  contract_id       uuid references public.corporate_contracts (id) on delete restrict,
  period_start      date not null,
  period_end        date not null,
  -- Frozen at generation time — see the header note. Never recomputed from a
  -- later contract edit or roster change.
  billing_model     public.employer_billing_model not null,
  headcount_basis   integer,
  rate_kobo         bigint,
  fixed_amount_kobo bigint,
  amount_kobo       bigint not null,
  status            public.employer_invoice_status not null default 'draft',
  issued_at         timestamptz,
  due_at            date,
  paid_at           timestamptz,
  void_reason       text,
  notes             text,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint employer_invoices_period check (period_end >= period_start),
  constraint employer_invoices_amount_non_negative check (amount_kobo >= 0),
  constraint employer_invoices_headcount_non_negative check (headcount_basis is null or headcount_basis >= 0),
  -- One invoice per org per period — a re-generation is a mistake to catch,
  -- not a second bill for the same month.
  constraint employer_invoices_status_attribution
    check ((status = 'issued') = (issued_at is not null))
);

create unique index employer_invoices_org_period_key
  on public.employer_invoices (organisation_id, period_start, period_end)
  where status <> 'void';

create index employer_invoices_org_idx on public.employer_invoices (organisation_id, period_start desc);

create trigger employer_invoices_set_updated_at
  before update on public.employer_invoices
  for each row execute function private.set_updated_at();

comment on table public.employer_invoices is
  'A frozen, periodic bill for an employer (Module 26 §26.15), generated from corporate_contracts via public.employer_generate_invoice(). Money owed is a Tarragon finance fact — see private.is_finance() below. Settlement (bank transfer against a PO) is recorded by hand via public.employer_set_invoice_status(); this table does not collect payment itself.';

-- Void is the only reversal a real invoice ever needs (accounting hygiene: a
-- wrong invoice is voided and reissued, never deleted or silently edited).
create function private.assert_invoice_void_has_reason()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'void' and (new.void_reason is null or length(trim(new.void_reason)) = 0) then
    raise exception 'a voided invoice must record why';
  end if;
  return new;
end;
$$;

create trigger employer_invoices_void_has_reason
  before insert or update of status on public.employer_invoices
  for each row execute function private.assert_invoice_void_has_reason();

alter table public.employer_invoices enable row level security;
grant select, insert, update, delete on public.employer_invoices to authenticated;

create policy employer_invoices_select on public.employer_invoices
  for select to authenticated
  using (private.is_finance()
         or (private.is_institution_admin() and organisation_id = private.current_org_id()));
create policy employer_invoices_insert on public.employer_invoices
  for insert to authenticated
  with check (private.is_finance());
create policy employer_invoices_update on public.employer_invoices
  for update to authenticated
  using (private.is_finance())
  with check (private.is_finance());
create policy employer_invoices_delete on public.employer_invoices
  for delete to authenticated
  using (private.is_admin());

-- ---------------------------------------------------------------------------
-- Generation
-- ---------------------------------------------------------------------------

create function public.employer_generate_invoice(
  p_organisation_id uuid,
  p_period_start date,
  p_period_end date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract public.corporate_contracts;
  v_headcount integer;
  v_amount bigint;
  v_invoice_id uuid;
begin
  if not private.is_finance() then
    raise exception 'not authorised';
  end if;
  if p_period_end < p_period_start then
    raise exception 'p_period_end must be on or after p_period_start';
  end if;

  select * into v_contract
    from public.corporate_contracts
   where organisation_id = p_organisation_id and status = 'active' and billing_model is not null
   order by created_at desc
   limit 1;
  if v_contract.id is null then
    raise exception 'organisation % has no active contract with a billing model', p_organisation_id;
  end if;

  if v_contract.billing_model = 'service_based' then
    raise exception 'service_based billing has no standing rate to generate from — record it directly with a known amount_kobo instead';
  end if;

  -- The two headcount-basis models differ in exactly what they count:
  -- per_employee is everyone on the books during the period (the employer
  -- pays for the roster it declared, whether or not each person ever
  -- activated); per_active_member is only those who actually claimed an
  -- account. Both exclude a row 'removed' before the period even started.
  if v_contract.billing_model = 'per_employee' then
    select count(*) into v_headcount
      from public.employer_roster_members
     where organisation_id = p_organisation_id
       and status <> 'removed'
       and created_at::date <= p_period_end
       and (eligible_from is null or eligible_from <= p_period_end)
       and (eligible_until is null or eligible_until >= p_period_start);
    v_amount := coalesce(v_contract.billing_rate_kobo, 0) * v_headcount;

  elsif v_contract.billing_model = 'per_active_member' then
    select count(*) into v_headcount
      from public.employer_roster_members
     where organisation_id = p_organisation_id
       and status = 'claimed'
       and claimed_at::date <= p_period_end
       and (eligible_until is null or eligible_until >= p_period_start);
    v_amount := coalesce(v_contract.billing_rate_kobo, 0) * v_headcount;

  elsif v_contract.billing_model = 'fixed_contract' then
    v_headcount := null;
    v_amount := coalesce(v_contract.billing_fixed_amount_kobo, 0);

  elsif v_contract.billing_model = 'hybrid' then
    select count(*) into v_headcount
      from public.employer_roster_members
     where organisation_id = p_organisation_id
       and status = 'claimed'
       and claimed_at::date <= p_period_end
       and (eligible_until is null or eligible_until >= p_period_start);
    v_amount := coalesce(v_contract.billing_fixed_amount_kobo, 0)
                + coalesce(v_contract.billing_rate_kobo, 0) * v_headcount;
  end if;

  insert into public.employer_invoices
    (organisation_id, contract_id, period_start, period_end, billing_model,
     headcount_basis, rate_kobo, fixed_amount_kobo, amount_kobo, created_by)
  values
    (p_organisation_id, v_contract.id, p_period_start, p_period_end, v_contract.billing_model,
     v_headcount, v_contract.billing_rate_kobo, v_contract.billing_fixed_amount_kobo, v_amount,
     (select auth.uid()))
  returning id into v_invoice_id;

  perform private.log_audit('employer_invoice.generated', 'employer_invoices', v_invoice_id,
    jsonb_build_object('organisation_id', p_organisation_id, 'amount_kobo', v_amount,
                       'billing_model', v_contract.billing_model));

  return v_invoice_id;
end;
$$;

revoke all on function public.employer_generate_invoice(uuid, date, date) from public;
grant execute on function public.employer_generate_invoice(uuid, date, date) to authenticated;
revoke execute on function public.employer_generate_invoice(uuid, date, date) from anon;

-- ---------------------------------------------------------------------------
-- Recording settlement — the only writes an issued invoice ever gets
-- ---------------------------------------------------------------------------

create function public.employer_set_invoice_status(
  p_invoice_id uuid,
  p_status text,
  p_void_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.employer_invoices;
begin
  if not private.is_finance() then
    raise exception 'not authorised';
  end if;
  if p_status not in ('draft', 'issued', 'paid', 'void') then
    raise exception 'p_status must be one of draft/issued/paid/void';
  end if;

  select * into v_inv from public.employer_invoices where id = p_invoice_id;
  if v_inv.id is null then
    raise exception 'invoice not found';
  end if;
  if v_inv.status = 'void' then
    raise exception 'a voided invoice cannot be reopened — generate a fresh one';
  end if;
  if v_inv.status = 'paid' and p_status <> 'void' then
    raise exception 'a paid invoice can only be voided, not reset to % — record a correction as a new invoice', p_status;
  end if;

  update public.employer_invoices
     set status = p_status::public.employer_invoice_status,
         issued_at = case when p_status = 'issued' then coalesce(issued_at, now()) else issued_at end,
         paid_at   = case when p_status = 'paid' then now() else paid_at end,
         void_reason = case when p_status = 'void' then p_void_reason else void_reason end
   where id = p_invoice_id;

  perform private.log_audit('employer_invoice.status_set', 'employer_invoices', p_invoice_id,
    jsonb_build_object('status', p_status));
end;
$$;

revoke all on function public.employer_set_invoice_status(uuid, text, text) from public;
grant execute on function public.employer_set_invoice_status(uuid, text, text) to authenticated;
revoke execute on function public.employer_set_invoice_status(uuid, text, text) from anon;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_n int;
begin
  select count(*) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'employer_invoices' and c.relrowsecurity;
  if v_n <> 1 then raise exception 'FAIL: RLS not enabled on employer_invoices'; end if;

  -- An institution admin must not gain a write policy on its own invoice.
  if exists (
    select 1 from pg_policies
     where tablename = 'employer_invoices' and cmd <> 'SELECT' and qual like '%is_institution_admin%'
  ) then
    raise exception 'FAIL: an employer can write its own invoice';
  end if;

  if has_function_privilege('anon', 'public.employer_generate_invoice(uuid, date, date)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute employer_generate_invoice';
  end if;
  if has_function_privilege('anon', 'public.employer_set_invoice_status(uuid, text, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute employer_set_invoice_status';
  end if;

  raise notice 'PASS  employer_invoices: frozen per-period bill, finance-only write, institution-admin read-only';
end $$;