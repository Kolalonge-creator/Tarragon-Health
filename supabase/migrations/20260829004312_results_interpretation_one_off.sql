-- Tarragon Health — standalone, one-off "Results Interpretation" product
-- (Revenue Architecture and Earnings Plan, 27 Aug 2026, engine E3).
--
-- The mechanism this sells already exists: upload a lab result document,
-- private.handle_lab_result_document() flags it for a clinician to write a
-- plain-language interpretation (20260720120100_lab_result_documents.sql),
-- gated to paid-plan patients only since 2026-08-05
-- (20260804232022_gate_result_document_review_to_paid_plans.sql). What does
-- NOT exist is a way to buy that review as a single, one-off purchase without
-- a subscription — the plan's proposed price is ₦7,500 one-off, available on
-- any plan including Tarragon Free.
--
-- subscription_add_ons was considered and rejected: it attaches an add-on to
-- an existing subscriptions row and bills on a recurring interval (see
-- patient/subscription/actions.ts:attachAddOn) — there is no one-off-charge
-- shape in it, and it would misrepresent a single purchase as a recurring
-- one. video_visit_requests already solves exactly this problem for a
-- ₦10,000/visit purchase, available on any plan — this migration copies that
-- pattern (price book table + request table + price-pinning trigger +
-- generic booking-checkout machinery) rather than inventing a new one.
--
-- PLACEHOLDER launch price (₦7,500), same status as video_visit_requests'
-- own placeholder comment — the source plan itself calls every price in it
-- "a proposal for decision, not a live price." Founder to confirm/adjust via
-- SQL or a future admin control before this is promoted anywhere.

-- ---------------------------------------------------------------------------
-- 1. Price book — mirrors video_visit_prices exactly (platform default row,
--    optional per-org override, patient-readable/admin-writable).
-- ---------------------------------------------------------------------------
create table public.results_interpretation_prices (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid references public.organisations (id) on delete cascade,
  amount_minor     bigint not null check (amount_minor > 0),
  currency         text not null default 'NGN' check (currency in ('NGN', 'GBP', 'USD')),
  is_enabled       boolean not null default true,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null,
  constraint results_interpretation_prices_org_unique unique (organisation_id)
);
create unique index results_interpretation_prices_default_idx
  on public.results_interpretation_prices ((organisation_id is null))
  where organisation_id is null;

alter table public.results_interpretation_prices enable row level security;
create policy results_interpretation_prices_select on public.results_interpretation_prices
  for select to authenticated using (true);
create policy results_interpretation_prices_write on public.results_interpretation_prices
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
grant select, insert, update, delete on public.results_interpretation_prices to authenticated;

insert into public.results_interpretation_prices (organisation_id, amount_minor, currency)
values (null, 750000, 'NGN');

-- ---------------------------------------------------------------------------
-- 2. Request/credit table. No accept/decline step (unlike video visits — a
--    result-interpretation purchase has nothing for staff to accept, it is
--    consumed automatically the next time the patient uploads a result), so
--    the status lifecycle is shorter: requested -> pending_payment ->
--    payment_confirmed -> fulfilled (or cancelled while still unpaid).
--    lab_result_document_id is set by private.handle_lab_result_document()
--    at the moment this credit is spent — see part 4 below.
-- ---------------------------------------------------------------------------
create type public.results_interpretation_request_status as enum (
  'requested',
  'pending_payment',
  'payment_confirmed',
  'fulfilled',
  'cancelled'
);

create table public.results_interpretation_requests (
  id                            uuid primary key default gen_random_uuid(),
  organisation_id               uuid not null references public.organisations (id) on delete restrict,
  patient_id                    uuid not null references public.profiles (id) on delete cascade,
  status                        public.results_interpretation_request_status not null default 'requested',
  origin                        text not null default 'patient_initiated',
  amount_minor                  bigint not null default 0,
  currency                      text not null default 'NGN',
  payment_provider              text,
  payment_provider_ref          text,
  pending_payment_provider_ref  text,
  -- Set once this credit is spent on an uploaded result (part 4). Null means
  -- unspent — private.handle_lab_result_document() looks for the oldest
  -- unspent, payment_confirmed row per patient, FIFO.
  lab_result_document_id        uuid references public.lab_result_documents (id) on delete set null,
  fulfilled_at                  timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index results_interpretation_requests_org_status_idx
  on public.results_interpretation_requests (organisation_id, status, created_at);
create index results_interpretation_requests_patient_idx
  on public.results_interpretation_requests (patient_id, created_at desc);
create index results_interpretation_requests_pending_ref_idx
  on public.results_interpretation_requests (pending_payment_provider_ref)
  where pending_payment_provider_ref is not null;
-- The lookup private.handle_lab_result_document() runs on every result
-- upload: oldest unspent, paid-for credit for this patient.
create index results_interpretation_requests_unspent_idx
  on public.results_interpretation_requests (patient_id, created_at)
  where status = 'payment_confirmed' and lab_result_document_id is null;

create trigger results_interpretation_requests_set_updated_at
  before update on public.results_interpretation_requests
  for each row execute function private.set_updated_at();

-- The charge amount is ALWAYS server-derived from the price book — same
-- contract as private.pin_video_visit_amount().
create or replace function private.pin_results_interpretation_amount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price record;
begin
  select p.amount_minor, p.currency, p.is_enabled into v_price
  from (
    select amount_minor, currency, is_enabled, 0 as pri
    from public.results_interpretation_prices where organisation_id = new.organisation_id
    union all
    select amount_minor, currency, is_enabled, 1
    from public.results_interpretation_prices where organisation_id is null
  ) p
  order by p.pri
  limit 1;

  if v_price.amount_minor is null or not v_price.is_enabled then
    raise exception 'results interpretation is not available right now';
  end if;
  new.amount_minor := v_price.amount_minor;
  new.currency := v_price.currency;
  new.status := 'requested';
  new.origin := 'patient_initiated';
  new.payment_provider := null;
  new.payment_provider_ref := null;
  new.pending_payment_provider_ref := null;
  new.lab_result_document_id := null;
  new.fulfilled_at := null;
  return new;
end;
$$;

create trigger results_interpretation_requests_pin_amount
  before insert on public.results_interpretation_requests
  for each row execute function private.pin_results_interpretation_amount();

alter table public.results_interpretation_requests enable row level security;

create policy results_interpretation_requests_select on public.results_interpretation_requests
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy results_interpretation_requests_insert on public.results_interpretation_requests
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    and organisation_id = private.current_org_id()
  );
-- A patient may withdraw an unpaid request. Once paid, fulfilment happens
-- automatically (part 4) — there is no patient or staff UPDATE path at all,
-- matching the "server-derived, never client-trusted" rule this file follows
-- everywhere else.
create policy results_interpretation_requests_patient_cancel on public.results_interpretation_requests
  for delete to authenticated
  using (patient_id = (select auth.uid()) and status in ('requested', 'pending_payment'));

grant select, insert, delete on public.results_interpretation_requests to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Wire 'results_interpretation' into the generic booking-checkout
--    machinery's server-side price/ownership check
--    (private.pin_results_interpretation_amount above already handles the
--    charge amount; requireOwnedBookingOrder/initiateBookingCheckout on the
--    TypeScript side need BookingOrderType extended — see the accompanying
--    app-code changes in lib/billing/booking-ownership.ts,
--    lib/billing/checkout-metadata.ts, and BOTH deployed webhook Edge
--    Functions (supabase/functions/paystack-webhook,
--    supabase/functions/stripe-webhook) — this migration alone does not
--    activate real payment confirmation; the Edge Functions must be
--    redeployed for their copy of BOOKING_TABLE to pick up the new entry.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4. Redefine private.handle_lab_result_document() (same trigger, same name,
--    third redefinition after 20260720120100 and 20260804232022) to also
--    accept a spent one-off credit as review access, when the patient has no
--    subscription/add-on-based 'result_document_review' feature. Behaviour-
--    preserving for every existing plan/add-on path — the only new branch is
--    the one-off-credit fallback, and it only ever RAISES access, never lowers
--    it below what 20260804232022 already grants.
-- ---------------------------------------------------------------------------
create or replace function private.handle_lab_result_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
  v_has_review_access boolean;
  v_credit_id uuid;
begin
  if (select auth.uid()) is not null then
    new.uploaded_by := (select auth.uid());
  end if;

  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_note := null;

  v_has_review_access := private.patient_has_feature_access(new.patient_id, 'result_document_review');

  -- No plan/add-on access — fall back to the oldest unspent, paid-for
  -- one-off credit (E3 Results Interpretation), FIFO. Locked so two uploads
  -- racing in the same instant can't both claim the same credit.
  if not v_has_review_access then
    select id into v_credit_id
    from public.results_interpretation_requests
    where patient_id = new.patient_id
      and status = 'payment_confirmed'
      and lab_result_document_id is null
    order by created_at asc
    limit 1
    for update skip locked;

    if v_credit_id is not null then
      v_has_review_access := true;
    end if;
  end if;

  if v_has_review_access then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, escalation_level)
    values (
      new.organisation_id,
      new.patient_id,
      'clinician_review',
      'open',
      'Lab result document uploaded — review needed',
      format(
        'A lab result document was uploaded (%s)%s. Review and record any clinical finding. (Uploading a file does not itself create a screening result.)',
        new.source,
        case when new.note is not null and length(btrim(new.note)) > 0
          then format(' — %s', new.note) else '' end
      ),
      2
    )
    returning id into v_alert_id;

    new.clinician_alert_id := v_alert_id;
  else
    new.clinician_alert_id := null;
  end if;

  if new.source <> 'patient' then
    insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
    values
      (new.organisation_id, new.patient_id, 'whatsapp', 'result_document_available',
        jsonb_build_object('source', new.source::text)),
      (new.organisation_id, new.patient_id, 'email', 'result_document_available',
        jsonb_build_object('source', new.source::text));
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    new.uploaded_by,
    'lab_result_document.uploaded',
    'lab_result_documents',
    new.id,
    jsonb_build_object(
      'source', new.source::text,
      'clinician_alert_id', v_alert_id,
      'review_gated_by_plan', not v_has_review_access,
      'results_interpretation_credit_id', v_credit_id
    )
  );

  -- Spend the credit last, now that new.id is known (defaults are applied
  -- before a BEFORE trigger runs, so new.id is already the generated uuid).
  if v_credit_id is not null then
    update public.results_interpretation_requests
      set status = 'fulfilled',
          lab_result_document_id = new.id,
          fulfilled_at = now()
      where id = v_credit_id;
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'results_interpretation_requests'
  ) then
    raise exception 'FAIL: results_interpretation_requests was not created';
  end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'results_interpretation_prices'
  ) then
    raise exception 'FAIL: results_interpretation_prices was not created';
  end if;
  if not exists (
    select 1 from public.results_interpretation_prices where organisation_id is null and amount_minor = 750000
  ) then
    raise exception 'FAIL: default results_interpretation_prices row missing or wrong amount';
  end if;
end $$;
