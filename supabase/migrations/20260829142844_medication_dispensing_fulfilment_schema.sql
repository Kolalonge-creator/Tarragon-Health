-- Tarragon Health — Medication Dispensing & Fulfilment Engine (schema, part 1/3)
--
-- Completes the DORMANT routed-pharmacy path (pharmacy_orders / pharmacist
-- portal — is_active = false on every pharmacy_partners row, 0 live orders,
-- unchanged by this migration) rather than reversing the 2026-08-03
-- self-arranged-fulfilment decision
-- (20260803132008_medication_collected_anywhere.sql — "keep the record, drop
-- the routing") or the 2026-08-27 refusal to build a "sent to pharmacy"
-- status (20260827200208_prescription_workspace_fields.sql). Self-arranged
-- fulfilment stays the default patient path, completely untouched. This just
-- fills real gaps in the opt-in routed path so it is complete for whenever
-- ops activates a real partner: pharmacy acceptance, stock-unavailable +
-- substitution, partial dispensing, richer dispensing records, cold-chain,
-- controlled-substance audit at dispense time, and a failed-delivery
-- resolution workflow. No stock/inventory is added anywhere (founder
-- constraint, 20260716176000_pharmacy_order_dispenses.sql — "the founder was
-- explicit the pharmacist surface must not require pharmacies to load
-- stock").
--
-- HMO/insurance copay-vs-self-pay determination (spec §63.15) is
-- deliberately NOT built here — zero precedent anywhere in this codebase,
-- and it sits immediately next to the hardened 2026-07-29 "no capitation,
-- ever" guardrail (20260729122912_remove_hmo_capitation_i8.sql). Left as an
-- explicit open item for a founder decision, same class of gate as the
-- Phase 2/3 items in CLAUDE.md's Clinical Tier Ladder section.
--
-- Enum additions are isolated in this migration file, on their own, so a
-- later migration in this same set can safely reference the new values —
-- PostgreSQL forbids using a newly added enum value in the same transaction
-- that added it, and each migration file is its own transaction.

-- ---------------------------------------------------------------------------
-- 1. New pharmacy_order_status values.
--    'unavailable'      — pharmacist reviewed the order and cannot fulfil it
--                          as prescribed (spec §63.4). Sits between
--                          'confirmed' and 'dispensed': a substitution can
--                          still move it forward to 'dispensed'.
--    'delivery_failed'  — a delivery attempt did not succeed (spec §63.10).
--                          Sits between 'out_for_delivery' and 'delivered':
--                          staff can reassign a courier to retry.
-- ---------------------------------------------------------------------------

alter type public.pharmacy_order_status add value if not exists 'unavailable' after 'confirmed';
alter type public.pharmacy_order_status add value if not exists 'delivery_failed' after 'out_for_delivery';

-- ---------------------------------------------------------------------------
-- 2. Delivery-attempt result/reason enums (spec §63.10).
-- ---------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'delivery_attempt_result') then
    create type public.delivery_attempt_result as enum ('failed', 'delivered');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'delivery_failure_reason') then
    create type public.delivery_failure_reason as enum (
      'patient_unavailable', 'incorrect_address', 'courier_failure', 'security_access_issue', 'other'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. pharmacy_orders: stock-unavailable flag, cold-chain flag, and a real
--    "courier assigned" timestamp distinct from delivery_confirmed_at (spec
--    §63.4, §63.9, §63.11).
-- ---------------------------------------------------------------------------

alter table public.pharmacy_orders
  add column if not exists unavailable_reason text,
  add column if not exists unavailable_at timestamptz,
  add column if not exists requires_cold_chain boolean not null default false,
  add column if not exists courier_assigned_at timestamptz;

alter table public.pharmacy_orders
  add constraint pharmacy_orders_unavailable_reason_length check (char_length(unavailable_reason) <= 500);

comment on column public.pharmacy_orders.unavailable_reason is
  'Pharmacist-entered reason the prescribed medicine could not be fulfilled as-is (spec §63.4). Free text, advisory only — set via pharmacist_flag_unavailable.';
comment on column public.pharmacy_orders.requires_cold_chain is
  'True when any item snapshotted into items requires cold-chain handling (pharmacy_medications.requires_cold_chain at order time). Gates which logistics partners can be assigned and drives the packaging note shown to staff/patient.';
comment on column public.pharmacy_orders.courier_assigned_at is
  'When a logistics partner was assigned. Currently set at the same moment the order moves to out_for_delivery (single-step assignment), but kept as its own column so the delivery-status timeline has a real timestamp for the "courier assigned" step distinct from status transitions.';

-- ---------------------------------------------------------------------------
-- 4. Cold-chain capability on the catalogue/courier sides (spec §63.11).
--    Both default false — nothing changes for any existing row. Admin-only
--    to set (same authority level as every other pharmacy_medications
--    column besides is_active, which private.restrict_pharmacy_medication_
--    partner_edit_to_availability already reserves for the pharmacist —
--    see 20260827203240_partner_org_self_service_locations_and_availability.sql).
-- ---------------------------------------------------------------------------

alter table public.pharmacy_medications
  add column if not exists requires_cold_chain boolean not null default false;

alter table public.logistics_partners
  add column if not exists supports_cold_chain boolean not null default false;

comment on column public.pharmacy_medications.requires_cold_chain is
  'Set by admin catalogue management (not the pharmacist self-service surface — see restrict_pharmacy_medication_partner_edit_to_availability). Snapshotted onto pharmacy_orders.items at order time and rolled up into pharmacy_orders.requires_cold_chain.';
comment on column public.logistics_partners.supports_cold_chain is
  'Whether this courier can handle a cold-chain order. Set by admin; gates the courier picker on a cold-chain order (app-layer filter, same as the existing region filter).';

-- ---------------------------------------------------------------------------
-- 5. pharmacy_order_dispenses: partial dispensing, richer dispensing
--    record, substitution, and controlled-substance audit (spec §63.5,
--    §63.6, §63.12, §63.13). All nullable/defaulted — no existing row or
--    insert path is affected.
-- ---------------------------------------------------------------------------

alter table public.pharmacy_order_dispenses
  add column if not exists quantity_prescribed text,
  add column if not exists is_partial boolean not null default false,
  add column if not exists outstanding_note text,
  add column if not exists batch_number text,
  add column if not exists substituted_for text,
  add column if not exists substitution_reason text,
  add column if not exists controlled_tier text,
  add column if not exists enhanced_verification_confirmed boolean not null default false;

alter table public.pharmacy_order_dispenses
  add constraint pharmacy_order_dispenses_quantity_prescribed_length check (char_length(quantity_prescribed) <= 100),
  add constraint pharmacy_order_dispenses_outstanding_note_length check (char_length(outstanding_note) <= 500),
  add constraint pharmacy_order_dispenses_batch_number_length check (char_length(batch_number) <= 100),
  add constraint pharmacy_order_dispenses_substituted_for_length check (char_length(substituted_for) <= 200),
  add constraint pharmacy_order_dispenses_substitution_reason_length check (char_length(substitution_reason) <= 500),
  add constraint pharmacy_order_dispenses_controlled_tier_values
    check (controlled_tier is null or controlled_tier in ('narcotic', 'restricted'));

-- Same discipline as controlled-substances.ts on the prescribing side: the
-- platform never blocks a dispense outright, but a controlled/restricted
-- drug must carry an explicit confirmation before the record is saved —
-- enforced here, not just in the UI, so the audit trail (spec §63.12) is
-- real rather than advisory-only.
alter table public.pharmacy_order_dispenses
  add constraint pharmacy_order_dispenses_controlled_needs_verification
  check (controlled_tier is null or enhanced_verification_confirmed);

comment on column public.pharmacy_order_dispenses.quantity_prescribed is
  'Snapshot of what was prescribed, entered alongside quantity (what was actually dispensed) so a partial fill records the distinction the way spec §63.5 asks for ("Prescribed: 30 / Dispensed: 20"), without requiring numeric parsing of free-text quantities.';
comment on column public.pharmacy_order_dispenses.is_partial is
  'True when this dispense did not fulfil the full prescribed quantity. Pharmacist/patient-set, not derived — quantities are free text (e.g. "30 tablets"), not reliably parseable.';
comment on column public.pharmacy_order_dispenses.controlled_tier is
  'Snapshot of controlled-substances.ts''s advisory classification (narcotic/restricted/null) at dispense time, for audit — never a verified NDLEA schedule lookup, same discipline as the prescribing-side flag it mirrors.';

-- ---------------------------------------------------------------------------
-- 6. Failed-delivery resolution workflow (spec §63.10): each delivery
--    attempt is its own row rather than a single flat status, so a
--    redelivery can be retried and the reason for each failure stays on
--    record. patient_id is denormalized for the same reason it already is
--    on pharmacy_order_dispenses — simpler RLS than joining through
--    pharmacy_orders on every read.
-- ---------------------------------------------------------------------------

create table if not exists public.pharmacy_order_delivery_attempts (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  pharmacy_order_id  uuid not null references public.pharmacy_orders (id) on delete cascade,
  attempt_number     integer not null default 1,
  result             public.delivery_attempt_result not null,
  failure_reason     public.delivery_failure_reason,
  notes              text,
  recorded_by        uuid references public.profiles (id) on delete set null,
  attempted_at       timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

alter table public.pharmacy_order_delivery_attempts
  add constraint pharmacy_order_delivery_attempts_attempt_number_positive check (attempt_number > 0),
  add constraint pharmacy_order_delivery_attempts_notes_length check (char_length(notes) <= 500),
  add constraint pharmacy_order_delivery_attempts_failure_reason_shape
    check ((result = 'failed' and failure_reason is not null) or (result = 'delivered' and failure_reason is null));

create index if not exists pharmacy_order_delivery_attempts_order_idx
  on public.pharmacy_order_delivery_attempts (pharmacy_order_id, attempted_at desc);
create index if not exists pharmacy_order_delivery_attempts_patient_idx
  on public.pharmacy_order_delivery_attempts (patient_id);

alter table public.pharmacy_order_delivery_attempts enable row level security;

-- Reads only via plain RLS (patient owns the order, or org staff); writes go
-- exclusively through record_pharmacy_delivery_attempt (part 2/3 of this
-- set) so the attempt row and the order's own status column always move
-- together — no direct INSERT/UPDATE grant here.
drop policy if exists pharmacy_order_delivery_attempts_select on public.pharmacy_order_delivery_attempts;
create policy pharmacy_order_delivery_attempts_select on public.pharmacy_order_delivery_attempts
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select on public.pharmacy_order_delivery_attempts to authenticated;

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                   where t.typname = 'pharmacy_order_status' and e.enumlabel = 'unavailable') then
    raise exception 'pharmacy_order_status is missing unavailable';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                   where t.typname = 'pharmacy_order_status' and e.enumlabel = 'delivery_failed') then
    raise exception 'pharmacy_order_status is missing delivery_failed';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'pharmacy_order_dispenses' and column_name = 'controlled_tier'
  ) then
    raise exception 'pharmacy_order_dispenses is missing controlled_tier';
  end if;
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'pharmacy_order_delivery_attempts'
  ) then
    raise exception 'pharmacy_order_delivery_attempts was not created';
  end if;
  -- Founder constraint that must stay true: no inventory/stock table.
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name in ('pharmacy_stock', 'pharmacy_inventory')
  ) then
    raise exception 'a stock/inventory table was added — this violates the founder constraint';
  end if;
end $$;
