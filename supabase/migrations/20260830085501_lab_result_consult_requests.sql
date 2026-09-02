-- Tarragon Health — the paid request that gates a self-arranged lab-result
-- upload behind the one-off consultation fee (founder rule, 2026-08-30).
--
-- Shape cloned from video_visit_requests (20260723120000), trimmed of the
-- scheduling-specific columns (slot_id, accepted_by/at, declined_reason,
-- proposed_*) that request has and this one doesn't need: there is no
-- doctor-acceptance step here, only a patient-pays -> patient-uploads
-- lifecycle. request -> pending_payment -> payment_confirmed is the exact
-- same booking-checkout machinery as lab/pharmacy/referral/video_visit
-- orders (status/origin/payment_provider(_ref)/pending_payment_provider_ref
-- driven by initiateBookingCheckout + the Paystack/Stripe webhooks, which
-- key off the metadata contract generically and need no changes here).
-- payment_confirmed -> document_uploaded happens when
-- public.claim_lab_result_consult_credit (next migration) atomically
-- claims an unclaimed, paid request at upload time.
--
-- lab_result_document_id is populated AFTER the document row exists (by
-- public.settle_lab_result_consult_claim, called by the upload action right
-- after a successful lab_result_documents insert) rather than at claim time:
-- the claimed row's foreign key would be unsatisfiable at claim time because
-- the referenced lab_result_documents row does not exist yet in that earlier,
-- already-committed transaction — claim and document-insert are two separate
-- calls from the app, not one Postgres transaction.
create type public.lab_result_consult_request_status as enum (
  'requested',
  'pending_payment',
  'payment_confirmed',
  'document_uploaded',
  'expired',
  'cancelled',
  'refunded'
);

create table public.lab_result_consult_requests (
  id                            uuid primary key default gen_random_uuid(),
  organisation_id               uuid not null references public.organisations (id) on delete restrict,
  patient_id                    uuid not null references public.profiles (id) on delete cascade,
  -- Optional: ties the fee to a specific self-arranged order awaiting a
  -- result. Null means a "loose" credit not tied to any particular order
  -- (a patient can upload a result with zero prior order — see
  -- uploadResultDocumentAsPatient).
  lab_order_id                  uuid references public.lab_orders (id) on delete set null,
  note                          text,
  status                        public.lab_result_consult_request_status not null default 'requested',
  origin                        text not null default 'patient_initiated',
  amount_minor                  bigint not null default 0,
  currency                      text not null default 'NGN',
  payment_provider              text,
  payment_provider_ref          text,
  pending_payment_provider_ref  text,
  refund_status                 text check (refund_status in ('due', 'refunded')),
  refund_ref                    text,
  -- Set once, after the fact, by public.settle_lab_result_consult_claim —
  -- never at claim time (see header). Not a request the client can steer:
  -- the claim function alone decides which document a claimed request is
  -- allowed to be settled against.
  lab_result_document_id        uuid references public.lab_result_documents (id) on delete set null,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index lab_result_consult_requests_org_status_idx
  on public.lab_result_consult_requests (organisation_id, status, created_at);
create index lab_result_consult_requests_patient_idx
  on public.lab_result_consult_requests (patient_id, created_at desc);
create index lab_result_consult_requests_pending_ref_idx
  on public.lab_result_consult_requests (pending_payment_provider_ref)
  where pending_payment_provider_ref is not null;
-- The exact lookup public.claim_lab_result_consult_credit performs.
create index lab_result_consult_requests_unclaimed_idx
  on public.lab_result_consult_requests (patient_id, lab_order_id)
  where status = 'payment_confirmed' and lab_result_document_id is null;

create trigger lab_result_consult_requests_set_updated_at
  before update on public.lab_result_consult_requests
  for each row execute function private.set_updated_at();

-- The charge amount is ALWAYS server-derived from the price book (same
-- pin-amount pattern as private.pin_video_visit_amount) — a patient session
-- inserting a doctored amount_minor is silently overwritten, and a
-- disabled/missing price book rejects the request outright. Also guards
-- that an order-linked request actually belongs to the same patient/org and
-- is not against a network-billed (fulfilment='partner') order — that path
-- is billed directly by Tarragon and never needs this fee.
create or replace function private.pin_lab_result_consult_amount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price record;
  v_order record;
begin
  if new.lab_order_id is not null then
    select patient_id, organisation_id, fulfilment::text as fulfilment
      into v_order
      from public.lab_orders where id = new.lab_order_id;

    if v_order.patient_id is null or v_order.patient_id is distinct from new.patient_id then
      raise exception 'lab_order_id does not belong to this patient' using errcode = '23514';
    end if;
    if v_order.fulfilment = 'partner' then
      raise exception 'A network-billed lab order does not need a separate consultation fee'
        using errcode = '23514';
    end if;
  end if;

  select p.amount_minor, p.currency, p.is_enabled into v_price
  from (
    select amount_minor, currency, is_enabled, 0 as pri
    from public.lab_result_consult_prices where organisation_id = new.organisation_id
    union all
    select amount_minor, currency, is_enabled, 1
    from public.lab_result_consult_prices where organisation_id is null
  ) p
  order by p.pri
  limit 1;

  if v_price.amount_minor is null or not v_price.is_enabled then
    raise exception 'the lab-result consultation fee is not available right now';
  end if;
  new.amount_minor := v_price.amount_minor;
  new.currency := v_price.currency;
  new.status := 'requested';
  new.origin := 'patient_initiated';
  new.payment_provider := null;
  new.payment_provider_ref := null;
  new.pending_payment_provider_ref := null;
  new.refund_status := null;
  new.refund_ref := null;
  new.lab_result_document_id := null;
  return new;
end;
$$;

create trigger lab_result_consult_requests_pin_amount
  before insert on public.lab_result_consult_requests
  for each row execute function private.pin_lab_result_consult_amount();

alter table public.lab_result_consult_requests enable row level security;

create policy lab_result_consult_requests_select on public.lab_result_consult_requests
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy lab_result_consult_requests_insert on public.lab_result_consult_requests
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    and organisation_id = private.current_org_id()
  );
-- A patient may withdraw an unpaid request; everything after payment moves
-- through claim_lab_result_consult_credit/settle_lab_result_consult_claim or
-- the webhook/service-role paths, never a raw patient UPDATE.
create policy lab_result_consult_requests_patient_cancel on public.lab_result_consult_requests
  for delete to authenticated
  using (patient_id = (select auth.uid()) and status in ('requested', 'pending_payment'));
create policy lab_result_consult_requests_staff_update on public.lab_result_consult_requests
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.lab_result_consult_requests to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'lab_result_consult_requests'
  ) then
    raise exception 'FAIL: lab_result_consult_requests was not created';
  end if;
end $$;
