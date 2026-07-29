-- Tarragon Health
-- Payment webhook event log (Sprint 6) — every Paystack webhook event is
-- recorded here first, keyed by the provider's own event id, so a replayed
-- webhook (Paystack retries on non-2xx, and can be manually resent from
-- their dashboard) is a guaranteed no-op rather than a double-activation.
-- Same immutability posture as audit_log: no authenticated write policy at
-- all — only the paystack-webhook Edge Function (service-role key, bypasses
-- RLS/grants entirely) ever inserts a row.

create type public.payment_transaction_type as enum (
  'charge.success', 'charge.failed', 'subscription.create', 'subscription.disable',
  'subscription.not_renew', 'invoice.create', 'invoice.update', 'invoice.payment_failed', 'other'
);

create table public.payment_transactions (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid references public.organisations (id) on delete set null,
  provider                public.payment_provider not null default 'paystack',
  provider_event_id       text not null,
  event_type              public.payment_transaction_type not null default 'other',
  subscription_id         uuid references public.subscriptions (id) on delete set null,
  subscription_add_on_id  uuid references public.subscription_add_ons (id) on delete set null,
  amount_minor            bigint,
  currency                public.currency,
  raw_payload             jsonb not null default '{}'::jsonb,
  processed_at            timestamptz,
  error                   text,
  created_at              timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index payment_transactions_org_idx on public.payment_transactions (organisation_id, created_at desc);
create index payment_transactions_subscription_idx on public.payment_transactions (subscription_id);

alter table public.payment_transactions enable row level security;

create policy payment_transactions_select on public.payment_transactions
  for select to authenticated
  using (organisation_id is not null and private.is_org_staff(organisation_id));

grant select on public.payment_transactions to authenticated;
-- Deliberately no insert/update/delete grant to authenticated — only the
-- service-role key (paystack-webhook Edge Function) writes.
