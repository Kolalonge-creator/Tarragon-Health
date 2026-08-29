-- Patient Health Record architecture review — a genuinely distinct
-- "Patient received" medication event (spec §1.15's 4-stage model:
-- Prescribed -> Pharmacy dispensed -> Patient received -> Patient reports
-- taking), founder-decided (docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md §3
-- Q2: build it now, ahead of a real pharmacy partnership).
--
-- BEFORE THIS MIGRATION, the 4 stages collapsed to 3: Prescribed
-- (medications), Dispensed-and-Received-as-one-event (pharmacy_order_
-- dispenses — a single dispensed_on + dispense_source enum distinguishing
-- only WHO recorded it, patient or pharmacy, not two separate timestamps),
-- Taking (medication_logs). This adds the missing middle event as its own
-- table rather than bolting a second timestamp onto pharmacy_order_
-- dispenses, because the two events have genuinely different actors and
-- optionality: a dispense record may or may not exist at all (self-arranged
-- fulfilment — 20260803132008_medication_collected_anywhere.sql — means
-- most medication today has no pharmacy_order_dispenses row whatsoever),
-- while "the patient has the medication in hand" is the one fact that
-- always eventually needs recording regardless of how it got to them.
--
-- DELIBERATELY NOT WIRED TO pharmacy_orders.delivery_confirmed_at
-- pharmacy_orders already has a delivery pathway (fulfilment_method,
-- delivery_confirmed_at, courier_reference) but it is switched off in the
-- UI and has zero production rows (no contracted logistics partner is
-- active) — per 20260716123000_pharmacy_order_fulfilment_method.sql and
-- CLAUDE.md. Auto-deriving a receipt confirmation from pharmacy_orders.
-- items (jsonb, not a medications.id-linked structure) would be automation
-- built on top of a currently-dormant pathway, for a benefit nobody can use
-- yet. Left as a natural follow-up once that pathway goes live, not
-- attempted here — this migration is the standalone event only.

create table public.medication_receipt_confirmations (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  patient_id                  uuid not null references public.profiles (id) on delete cascade,
  medication_id               uuid references public.medications (id) on delete set null,
  pharmacy_order_dispense_id  uuid references public.pharmacy_order_dispenses (id) on delete set null,
  received_at                 timestamptz not null default now(),
  confirmation_source         text not null default 'patient_self_report'
    check (confirmation_source in ('patient_self_report', 'delivery_confirmed', 'pharmacy_confirmed')),
  confirmed_by                uuid references public.profiles (id) on delete set null,
  notes                       text,
  created_at                  timestamptz not null default now(),
  constraint medication_receipt_confirmations_has_context
    check (medication_id is not null or pharmacy_order_dispense_id is not null)
);

comment on table public.medication_receipt_confirmations is
  'The distinct "Patient received" event from spec §1.15''s 4-stage medication model, separate from pharmacy_order_dispenses (a pharmacy/patient-recorded dispense event, which may not exist at all under self-arranged fulfilment) and from medication_logs (patient reports TAKING a dose).';

create index medication_receipt_confirmations_patient_idx
  on public.medication_receipt_confirmations (patient_id, received_at desc);
create index medication_receipt_confirmations_org_idx
  on public.medication_receipt_confirmations (organisation_id);

alter table public.medication_receipt_confirmations enable row level security;

create policy medication_receipt_confirmations_select on public.medication_receipt_confirmations
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy medication_receipt_confirmations_insert on public.medication_receipt_confirmations
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy medication_receipt_confirmations_update on public.medication_receipt_confirmations
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy medication_receipt_confirmations_delete on public.medication_receipt_confirmations
  for delete to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.medication_receipt_confirmations to authenticated;
revoke all on public.medication_receipt_confirmations from anon;

create or replace function private.timeline_from_medication_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_timeline_event(
    new.organisation_id, new.patient_id, 'medication_received',
    'medication_receipt_confirmations', new.id,
    'Medication received',
    coalesce((select drug_name from public.medications where id = new.medication_id), 'Medication'),
    new.received_at,
    private.timeline_staff_from_profile(new.confirmed_by, new.organisation_id)
  );
  return new;
end;
$$;

drop trigger if exists medication_receipt_confirmations_timeline_insert on public.medication_receipt_confirmations;
create trigger medication_receipt_confirmations_timeline_insert
  after insert on public.medication_receipt_confirmations
  for each row execute function private.timeline_from_medication_receipt();

create trigger audit_row_change_trg
  after insert or update or delete on public.medication_receipt_confirmations
  for each row execute function private.audit_row_change();

create trigger capture_record_correction_trg
  after update or delete on public.medication_receipt_confirmations
  for each row execute function private.capture_record_correction();

do $$
begin
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'medication_receipt_confirmations') then
    raise exception 'FAIL: medication_receipt_confirmations table was not created';
  end if;
  raise notice 'PASS: medication_receipt_confirmations — table, RLS, timeline, and audit wiring installed';
end $$;
