-- Tarragon Health — price book for the self-arranged lab-result
-- consultation fee (founder rule, 2026-08-30).
--
-- Business rule: a patient uploading their own self-arranged lab result must
-- now pay a one-off ₦10,000 "consultation fee" before the upload is allowed.
-- Paying it also entitles the patient to a 15-minute doctor walkthrough of
-- the result (see 20260830085400/20260830085418 for the video_consultations context
-- this will eventually book into — not built in this pass). Network-billed
-- (fulfilment='partner') orders never need this fee — Tarragon already
-- bills those directly; see lab_result_consult_requests /
-- claim_lab_result_consult_credit for where that carve-out is enforced.
--
-- Shape cloned directly from video_visit_prices
-- (20260723120000_video_visit_requests.sql): platform-default row
-- (organisation_id null) with optional per-org overrides, admin-writable,
-- patient-readable so the price can be shown before payment.
create table public.lab_result_consult_prices (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid references public.organisations (id) on delete cascade,
  amount_minor     bigint not null check (amount_minor > 0),
  currency         text not null default 'NGN' check (currency in ('NGN', 'GBP', 'USD')),
  is_enabled       boolean not null default true,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null,
  constraint lab_result_consult_prices_org_unique unique (organisation_id)
);
create unique index lab_result_consult_prices_default_idx
  on public.lab_result_consult_prices ((organisation_id is null))
  where organisation_id is null;

alter table public.lab_result_consult_prices enable row level security;
create policy lab_result_consult_prices_select on public.lab_result_consult_prices
  for select to authenticated using (true);
create policy lab_result_consult_prices_write on public.lab_result_consult_prices
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
grant select, insert, update, delete on public.lab_result_consult_prices to authenticated;

-- Founder-specified launch price: ₦10,000 (1,000,000 kobo). Unlike
-- video_visit_prices' PLACEHOLDER price, this figure was given explicitly in
-- the founder's own words, not a placeholder — still adjustable later via
-- SQL or a future admin control (none is built in this pass; see PR
-- description).
insert into public.lab_result_consult_prices (organisation_id, amount_minor, currency)
values (null, 1000000, 'NGN');

do $$
begin
  if not exists (
    select 1 from public.lab_result_consult_prices
    where organisation_id is null and amount_minor = 1000000 and currency = 'NGN' and is_enabled
  ) then
    raise exception 'FAIL: default lab_result_consult_prices row was not seeded correctly';
  end if;
end $$;
