-- A founder-commissioned launch-scope audit's diaspora ask: replace "the
-- sponsor creates a full patient record with the recipient's name+phone,
-- before any payment" (the current /patient/supporting/new elder-proxy path)
-- with a claim-based flow for a recipient who WILL use the app themselves --
-- pay for a named service against just a phone number and first name, no
-- profile created up front, no health details from the sponsor at all. The
-- recipient gets a neutral invite, creates their OWN account (normal
-- signup/login, same phone-OTP path every patient already has), and decides
-- whether to claim it.
--
-- Deliberately NOT a replacement for the existing elder-proxy flow
-- (addElderProxyDependentAction) -- that serves a genuinely different case
-- (a dependent who will never operate the app themselves, managed forever by
-- the sponsor via profile_access). This is for the "pay for my mum's health
-- check, she'll use the app herself" case, which the existing
-- can_purchase_voucher_for gate structurally can't serve: it requires a
-- profile_access grant to already exist, and there is no "reserve against a
-- bare phone number" primitive anywhere in this schema until now.
--
-- Modelled directly on funding_programme_invitations (PR #713, 2026-09-23)
-- for the reservation/invitation shape, and on
-- private.activate_sponsored_service_purchase (sponsored_subscription kind)
-- for the payment-activation trigger shape -- both proven patterns, not
-- reinvented here.

create type public.sponsored_reservation_status as enum (
  'pending_payment', 'invited', 'claimed', 'expired', 'cancelled'
);

create table public.sponsored_service_reservations (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations(id) on delete restrict,
  service_product_id          uuid not null references public.service_products(id) on delete restrict,
  sponsor_profile_id          uuid not null references public.profiles(id) on delete restrict,
  recipient_phone             text not null check (recipient_phone ~ '^\+[1-9]\d{7,14}$'),
  recipient_first_name        text not null check (length(trim(recipient_first_name)) > 0),
  status                      public.sponsored_reservation_status not null default 'pending_payment',
  amount_kobo                 bigint not null check (amount_kobo >= 0),
  currency                    public.currency not null default 'NGN',
  payment_provider            text,
  payment_provider_ref        text,
  invite_token                text unique,
  invited_at                  timestamptz,
  expires_at                  timestamptz,
  claimed_by_profile_id       uuid references public.profiles(id) on delete set null,
  claimed_at                  timestamptz,
  care_voucher_id             uuid references public.care_vouchers(id) on delete set null,
  cancelled_at                timestamptz,
  cancelled_reason            text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  -- Only NGN is priced anywhere on this platform (see the sponsored_subscription
  -- checkout's own comment on why the GBP/USD Stripe path was removed
  -- 2026-09-03) -- a reservation with any other currency could never actually
  -- be charged.
  constraint sponsored_service_reservations_ngn_only check (currency = 'NGN'),
  -- Claim-consistency, same shape as funding_programme_invitations' own check:
  -- claimed iff claimed_by_profile_id/claimed_at/care_voucher_id all set.
  constraint sponsored_service_reservations_claim_consistency check (
    (status = 'claimed' and claimed_by_profile_id is not null and claimed_at is not null and care_voucher_id is not null)
    or (status <> 'claimed' and claimed_by_profile_id is null and claimed_at is null and care_voucher_id is null)
  )
);

create index sponsored_service_reservations_sponsor_idx on public.sponsored_service_reservations (sponsor_profile_id);
create index sponsored_service_reservations_phone_status_idx on public.sponsored_service_reservations (recipient_phone, status);

create trigger sponsored_service_reservations_set_updated_at
  before update on public.sponsored_service_reservations
  for each row execute function private.set_updated_at();

alter table public.sponsored_service_reservations enable row level security;

grant select on public.sponsored_service_reservations to authenticated;

-- Read-only for the sponsor's own reservations (their "gifts sent" status
-- list -- payment/invitation/claim lifecycle only, never the beneficiary's
-- clinical data, which this table never holds). Org staff too, for support
-- purposes, same shape as most patient-adjacent tables on this platform.
create policy sponsored_service_reservations_select on public.sponsored_service_reservations
  for select
  using (
    sponsor_profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

-- No insert/update/delete policy at all -- every write goes through the
-- SECURITY DEFINER RPCs (20260923013601_sponsored_service_reservation_rpcs.sql)
-- or the payment-activation trigger
-- (20260923013621_activate_sponsored_service_reservation.sql), same
-- discipline as funding_programme_invitations.

do $$
begin
  if has_table_privilege('anon', 'public.sponsored_service_reservations', 'SELECT') then
    raise exception 'anon must never be able to read sponsored_service_reservations';
  end if;
end $$;
