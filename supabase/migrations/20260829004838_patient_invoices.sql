-- Tarragon Health — formal per-service invoices (spec §25.6).
--
-- Deliberately separate from patient_receipts() (20260829001259): a receipt
-- is a read-time projection over payment_transactions/video_visit_requests/
-- care_voucher_payments, recomputed on every call; an invoice is a formal,
-- numbered document that must stay identical every time it is re-downloaded
-- — "do not calculate financial history simply from current database
-- states" (spec §25.22). So invoices is a real, append-only table: the first
-- request for a given payment mints a row and an invoice number, every
-- later request returns exactly that same row.
--
-- VAT is looked up from the existing tax configuration, not hard-coded — see
-- finance_accounts.vat_treatment / finance_tax_rates
-- (20260725230414_finance_tax_configuration.sql). As things stand today
-- every revenue account in the seeded chart of accounts is 'exempt' (most
-- Nigerian medical/health services are VAT-exempt under the VAT Act), so
-- every invoice minted today will correctly show VAT: Exempt — this
-- migration does not assert otherwise, it reads the real account config.
-- If finance ever reclassifies a revenue account to 'standard', new
-- invoices for that service pick up the VAT breakdown automatically; VAT
-- computation is scoped to NGN only — cross-border VAT treatment for
-- GBP/USD diaspora charges is an unsettled question this migration does not
-- attempt to answer, so those always show Exempt/₦0 regardless of account
-- config.

create sequence private.invoice_number_seq;

create table public.invoices (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete restrict,
  invoice_number    text not null unique,
  -- Same five-way split as patient_receipts()'s service_type, plus what it
  -- points back to — the underlying payment_transactions/video_visit_
  -- requests/care_voucher_payments row id. No FK: polymorphic across three
  -- tables, same bare-uuid-with-comment idiom as commissions.source_id.
  service_type      text not null check (service_type in
    ('membership', 'laboratory', 'pharmacy', 'referral', 'consultation', 'care_voucher')),
  source_id         uuid not null,
  service_label     text not null,
  reference         text not null,
  total_minor       bigint not null check (total_minor >= 0),
  subtotal_minor    bigint not null check (subtotal_minor >= 0),
  vat_minor         bigint not null default 0 check (vat_minor >= 0),
  vat_treatment     text not null default 'exempt' check (vat_treatment in ('exempt', 'zero_rated', 'standard')),
  vat_rate_pct      numeric,
  currency          public.currency not null,
  issued_at         timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  constraint invoices_totals_balance check (subtotal_minor + vat_minor = total_minor),
  -- One invoice per underlying payment, ever — re-requesting the same
  -- receipt's invoice must return the same document, not mint a new number.
  unique (service_type, source_id)
);

create index invoices_patient_idx on public.invoices (patient_id, issued_at desc);
create index invoices_organisation_idx on public.invoices (organisation_id);

alter table public.invoices enable row level security;

create policy invoices_select on public.invoices
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select on public.invoices to authenticated;
-- Deliberately no insert/update/delete grant to authenticated — only
-- get_or_create_invoice() (SECURITY DEFINER below) ever writes a row, and
-- an invoice is never edited or deleted once issued.

-- ---------------------------------------------------------------------------
-- patient_receipts() gains organisation_id — additive, needed by
-- get_or_create_invoice() below to know which entity issues the invoice.
-- Every branch is otherwise unchanged from 20260829001259_patient_receipts.sql.
-- ---------------------------------------------------------------------------
create or replace function public.patient_receipts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  return coalesce(
    (
      select jsonb_agg(row_to_json(r) order by r.occurred_at desc)
      from (
        -- Membership / subscription charges.
        select
          pt.id,
          coalesce(pt.processed_at, pt.created_at) as occurred_at,
          'membership'::text as service_type,
          coalesce(sp.name, 'Membership') as service_label,
          coalesce(pt.provider_event_id, pt.id::text) as reference,
          pt.amount_minor,
          pt.currency,
          case
            when pt.error is not null then 'failed'
            when pt.event_type::text in ('charge.failed', 'invoice.payment_failed') then 'failed'
            when pt.processed_at is not null then 'successful'
            else 'pending'
          end as status,
          pt.provider::text as provider,
          pt.organisation_id
        from public.payment_transactions pt
        join public.subscriptions s on s.id = pt.subscription_id
        left join public.subscription_plans sp on sp.id = s.plan_id
        where s.subscriber_id = v_caller
          and pt.event_type::text in
            ('charge.success', 'charge.failed', 'invoice.payment_succeeded',
             'invoice.payment_failed', 'checkout.session.completed')

        union all

        -- Laboratory bookings.
        select
          pt.id,
          coalesce(pt.processed_at, pt.created_at),
          'laboratory',
          coalesce(pb.name, 'Lab order'),
          coalesce(pt.provider_event_id, pt.id::text),
          pt.amount_minor,
          pt.currency,
          case
            when pt.error is not null then 'failed'
            when pt.event_type::text in ('charge.failed', 'invoice.payment_failed') then 'failed'
            when pt.processed_at is not null then 'successful'
            else 'pending'
          end,
          pt.provider::text,
          lo.organisation_id
        from public.payment_transactions pt
        join public.lab_orders lo on lo.id = pt.booking_order_id
        left join public.panel_bundles pb on pb.id = lo.panel_bundle_id
        where pt.booking_order_type = 'lab' and lo.patient_id = v_caller

        union all

        -- Pharmacy bookings.
        select
          pt.id,
          coalesce(pt.processed_at, pt.created_at),
          'pharmacy',
          'Pharmacy order (' || jsonb_array_length(coalesce(po.items, '[]'::jsonb)) || ' item'
            || case when jsonb_array_length(coalesce(po.items, '[]'::jsonb)) = 1 then '' else 's' end || ')',
          coalesce(pt.provider_event_id, pt.id::text),
          pt.amount_minor,
          pt.currency,
          case
            when pt.error is not null then 'failed'
            when pt.event_type::text in ('charge.failed', 'invoice.payment_failed') then 'failed'
            when pt.processed_at is not null then 'successful'
            else 'pending'
          end,
          pt.provider::text,
          po.organisation_id
        from public.payment_transactions pt
        join public.pharmacy_orders po on po.id = pt.booking_order_id
        where pt.booking_order_type = 'pharmacy' and po.patient_id = v_caller

        union all

        -- Specialist referrals.
        select
          pt.id,
          coalesce(pt.processed_at, pt.created_at),
          'referral',
          initcap(replace(sr.specialist_type::text, '_', ' ')) || ' referral',
          coalesce(pt.provider_event_id, pt.id::text),
          pt.amount_minor,
          pt.currency,
          case
            when pt.error is not null then 'failed'
            when pt.event_type::text in ('charge.failed', 'invoice.payment_failed') then 'failed'
            when pt.processed_at is not null then 'successful'
            else 'pending'
          end,
          pt.provider::text,
          sr.organisation_id
        from public.payment_transactions pt
        join public.specialist_referrals sr on sr.id = pt.booking_order_id
        where pt.booking_order_type = 'referral' and sr.patient_id = v_caller

        union all

        -- Video consultations — never reach payment_transactions'
        -- booking_order_* columns (commission_type has no 'consultation'
        -- member), so this table is its own receipt source.
        select
          vvr.id,
          vvr.created_at,
          'consultation',
          'Video consultation',
          coalesce(vvr.payment_provider_ref, vvr.id::text),
          vvr.amount_minor,
          vvr.currency::public.currency,
          case
            when vvr.refund_status = 'refunded' then 'refunded'
            when vvr.status in ('declined', 'expired') and vvr.refund_status = 'due' then 'pending_refund'
            when vvr.status in ('declined', 'expired') then 'failed'
            when vvr.payment_provider_ref is not null then 'successful'
            else 'pending'
          end,
          vvr.payment_provider,
          vvr.organisation_id
        from public.video_visit_requests vvr
        where vvr.patient_id = v_caller and vvr.amount_minor > 0

        union all

        -- Care voucher instalments the patient paid for themselves (a
        -- voucher bought as a gift is the purchaser's receipt, not the
        -- beneficiary's).
        select
          cvp.id,
          cvp.created_at,
          'care_voucher',
          coalesce(cv.sku_name, 'Care voucher'),
          coalesce(cvp.pending_provider_ref, cvp.id::text),
          cvp.amount_minor,
          cvp.currency::public.currency,
          case cvp.status
            when 'applied' then 'successful'
            when 'failed' then 'failed'
            else 'pending'
          end,
          cvp.provider::text,
          cvp.organisation_id
        from public.care_voucher_payments cvp
        join public.care_vouchers cv on cv.id = cvp.voucher_id
        where cvp.payer_profile_id = v_caller
      ) r
    ),
    '[]'::jsonb
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- get_or_create_invoice — idempotent per (service_type, source_id).
-- Ownership is proven by requiring the payment to appear in the caller's
-- own patient_receipts() output, rather than re-deriving the same six joins
-- a second time — if it is not in their own receipt list, it is not theirs
-- to invoice.
-- ---------------------------------------------------------------------------
create or replace function public.get_or_create_invoice(p_service_type text, p_source_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_existing_id uuid;
  v_receipt jsonb;
  v_org uuid;
  v_currency public.currency;
  v_total bigint;
  v_account_code text;
  v_vat_treatment text;
  v_vat_rate numeric;
  v_vat bigint;
  v_subtotal bigint;
  v_number text;
  v_id uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  select id into v_existing_id
  from public.invoices
  where service_type = p_service_type and source_id = p_source_id and patient_id = v_caller;

  if v_existing_id is not null then
    return (select row_to_json(i) from public.invoices i where i.id = v_existing_id);
  end if;

  select elem into v_receipt
  from jsonb_array_elements(public.patient_receipts()) as elem
  where elem->>'service_type' = p_service_type and elem->>'id' = p_source_id::text
  limit 1;

  if v_receipt is null then
    raise exception 'receipt not found — this payment does not belong to you, or has not happened yet';
  end if;

  if (v_receipt->>'status') not in ('successful', 'refunded') then
    raise exception 'this payment has not completed — no invoice yet (status: %)', v_receipt->>'status';
  end if;

  v_org := (v_receipt->>'organisation_id')::uuid;
  v_currency := (v_receipt->>'currency')::public.currency;
  v_total := (v_receipt->>'amount_minor')::bigint;

  -- Every service_type but membership posts to the shared one-off
  -- booking-revenue account (4100) — see the chart-of-accounts seed
  -- (20260725225800_finance_coa_seed_and_posting_rpcs.sql).
  v_account_code := case p_service_type when 'membership' then '4000' else '4100' end;

  select vat_treatment into v_vat_treatment
  from public.finance_accounts where code = v_account_code;
  v_vat_treatment := coalesce(v_vat_treatment, 'exempt');

  select rate_pct into v_vat_rate
  from public.finance_tax_rates
  where jurisdiction = 'NG' and tax_type = 'vat' and applies_to = 'standard'
    and is_active and effective_from <= current_date
  order by effective_from desc
  limit 1;

  if v_vat_treatment = 'standard' and v_vat_rate is not null and v_currency = 'NGN' then
    -- The price list is VAT-inclusive — back the VAT out of the total
    -- rather than adding it on top, matching how the price is actually
    -- displayed to the patient.
    v_vat := round(v_total - (v_total / (1 + v_vat_rate / 100.0)));
    v_subtotal := v_total - v_vat;
  else
    v_vat_treatment := case when v_currency = 'NGN' then v_vat_treatment else 'exempt' end;
    v_vat := 0;
    v_subtotal := v_total;
  end if;

  v_number := private.next_reference('INV-', 'private.invoice_number_seq'::regclass);

  insert into public.invoices (
    organisation_id, patient_id, invoice_number, service_type, source_id,
    service_label, reference, total_minor, subtotal_minor, vat_minor,
    vat_treatment, vat_rate_pct, currency, issued_at
  )
  values (
    v_org, v_caller, v_number, p_service_type, p_source_id,
    v_receipt->>'service_label', v_receipt->>'reference', v_total, v_subtotal, v_vat,
    v_vat_treatment, case when v_vat_treatment = 'standard' then v_vat_rate else null end,
    v_currency, coalesce((v_receipt->>'occurred_at')::timestamptz, now())
  )
  on conflict (service_type, source_id) do nothing
  returning id into v_id;

  if v_id is null then
    -- Lost a concurrent race — the other request's row is the real one.
    select id into v_id from public.invoices where service_type = p_service_type and source_id = p_source_id;
  end if;

  return (select row_to_json(i) from public.invoices i where i.id = v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Safe letterhead subset for a patient-facing invoice PDF — deliberately
-- narrower than finance_company_profile_get() (gated to is_finance()):
-- bank account details, auditor, directors and company secretary have no
-- business appearing on every patient's downloadable invoice.
-- ---------------------------------------------------------------------------
create or replace function public.invoice_letterhead_details()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'legal_name', legal_name,
        'trading_name', trading_name,
        'rc_number', rc_number,
        'tin', tin,
        'vat_registration_number', vat_registration_number,
        'registered_address', registered_address,
        'registered_email', registered_email,
        'registered_phone', registered_phone
      )
      from public.finance_company_profile
      where singleton
    ),
    '{}'::jsonb
  );
$$;

grant execute on function public.get_or_create_invoice(text, uuid) to authenticated;
grant execute on function public.invoice_letterhead_details() to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'invoices'
  ) then
    raise exception 'FAIL: invoices was not created';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.invoices'::regclass) then
    raise exception 'FAIL: invoices does not have RLS enabled';
  end if;

  if not exists (select 1 from pg_policies where tablename = 'invoices' and policyname = 'invoices_select') then
    raise exception 'FAIL: invoices is missing its select policy';
  end if;

  if exists (
    select 1 from pg_policies where tablename = 'invoices' and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'FAIL: invoices should have no write policies — RPC-only via get_or_create_invoice';
  end if;

  if not exists (
    select 1 from pg_proc where proname = 'patient_receipts' and pronamespace = 'public'::regnamespace
      and pg_get_functiondef(oid) like '%organisation_id%'
  ) then
    raise exception 'FAIL: patient_receipts was not extended with organisation_id';
  end if;

  if not has_function_privilege('authenticated', 'public.get_or_create_invoice(text,uuid)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute get_or_create_invoice';
  end if;
  if not has_function_privilege('authenticated', 'public.invoice_letterhead_details()', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute invoice_letterhead_details';
  end if;

  raise notice 'PASS: invoices created, RLS correct, patient_receipts extended, RPCs executable by authenticated';
end $$;
