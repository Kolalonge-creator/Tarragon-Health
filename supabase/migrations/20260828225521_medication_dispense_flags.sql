-- Tarragon Health -- pharmacist/clinical intervention flag on a medication
-- (Pharmacy Engine spec §12.13, docs/PHARMACY_ENGINE_SPEC.md Phase 1 item 1).
--
-- No mechanism anywhere let anyone flag "I think this dose looks wrong" (or
-- an availability/interaction/duplication/unclear-instruction/patient-query
-- concern) about a medication and have it route to a clinician. Unlike most
-- of §12, this does NOT require the dormant pharmacy_orders routing pipeline
-- to be live for the patient- and staff-raised paths below -- a pharmacist a
-- patient actually visited (self-arranged fulfilment) can always relay a
-- concern back through the patient or the care team even with no Tarragon-
-- routed order involved. A pharmacist_flag_dispense() RPC is also added,
-- scoped through private.pharmacist_partner() exactly like
-- pharmacist_record_dispense -- dormant today (0 live pharmacy_orders, same
-- as the rest of that surface) but ready the moment a real partner pharmacy
-- is onboarded and routing is switched back on, per
-- docs/PHARMACY_ENGINE_SPEC.md §3/§4.

create type public.medication_flag_type as enum (
  'prescription_issue', 'availability_issue', 'interaction_concern',
  'duplication', 'unclear_instruction', 'patient_query', 'other'
);

create type public.medication_flag_status as enum ('open', 'reviewed', 'resolved');

create table public.medication_dispense_flags (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  patient_id                  uuid not null references public.profiles (id) on delete cascade,
  medication_id               uuid references public.medications (id) on delete set null,
  pharmacy_order_dispense_id  uuid references public.pharmacy_order_dispenses (id) on delete set null,
  flag_type                   public.medication_flag_type not null,
  note                        text not null check (char_length(btrim(note)) > 0),
  raised_by                   uuid references public.profiles (id) on delete set null,
  raised_by_role              text,
  status                      public.medication_flag_status not null default 'open',
  reviewed_by                 uuid references public.clinical_staff (id) on delete set null,
  reviewed_at                 timestamptz,
  resolution_note             text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint medication_dispense_flags_resolution_documented
    check (
      status <> 'resolved'
      or (reviewed_by is not null and reviewed_at is not null and resolution_note is not null)
    )
);

comment on table public.medication_dispense_flags is
  'Pharmacy Engine spec §12.13: a pharmacist/patient/clinician-raised concern about a medication (prescription issue, availability, interaction, duplication, unclear instruction, patient query), routed to a clinician for review. raised_by/raised_by_role are server-stamped from the caller''s own session (see medication_dispense_flags_stamp_raised_by), never client-suppliable -- same falsification-proofing as medications.added_by.';

create index medication_dispense_flags_patient_idx
  on public.medication_dispense_flags (patient_id, created_at desc);
create index medication_dispense_flags_org_open_idx
  on public.medication_dispense_flags (organisation_id, status)
  where status <> 'resolved';

-- Server-derives raised_by/raised_by_role from the caller's own session on
-- every insert (direct table insert or via pharmacist_flag_dispense below,
-- since SECURITY DEFINER does not change what auth.uid() returns) -- a
-- client-supplied value here would let a patient's own insert masquerade as
-- "flagged by a pharmacist", the exact class of falsifiable-attribution gap
-- CLAUDE.md's ReviewedByDoctor rule and stamp_medication_added_by both guard
-- against elsewhere in this schema.
create or replace function private.stamp_medication_dispense_flag_raised_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.raised_by := (select auth.uid());
  new.raised_by_role := (select role::text from public.profiles where id = (select auth.uid()));
  return new;
end;
$$;

create trigger medication_dispense_flags_stamp_raised_by
  before insert on public.medication_dispense_flags
  for each row execute function private.stamp_medication_dispense_flag_raised_by();

create trigger medication_dispense_flags_set_updated_at
  before update on public.medication_dispense_flags
  for each row execute function private.set_updated_at();

alter table public.medication_dispense_flags enable row level security;

create policy medication_dispense_flags_select on public.medication_dispense_flags
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy medication_dispense_flags_insert on public.medication_dispense_flags
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy medication_dispense_flags_update on public.medication_dispense_flags
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.medication_dispense_flags to authenticated;
revoke all on public.medication_dispense_flags from anon;

create trigger audit_row_change_trg
  after insert or update or delete on public.medication_dispense_flags
  for each row execute function private.audit_row_change();

create trigger capture_record_correction_trg
  after update or delete on public.medication_dispense_flags
  for each row execute function private.capture_record_correction();

-- ---------------------------------------------------------------------------
-- pharmacist_flag_dispense -- the pharmacist-role path, same shape as
-- pharmacist_record_dispense: scoped to the caller's own linked pharmacy via
-- private.pharmacist_partner(), never a direct table grant (pharmacist is
-- deliberately excluded from is_org_staff -- see the comment above and
-- CLAUDE.md's standing lesson on that function). Works even for a concern
-- raised before anything was ever dispensed against the order (e.g. an
-- availability_issue caught at intake), so it does not require a
-- pharmacy_order_dispenses row to exist -- only the order itself.
-- ---------------------------------------------------------------------------
create or replace function public.pharmacist_flag_dispense(
  p_order_id uuid,
  p_flag_type public.medication_flag_type,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order         public.pharmacy_orders%rowtype;
  v_dispense_id   uuid;
  v_medication_id uuid;
  v_flag_id       uuid;
begin
  select * into v_order
  from public.pharmacy_orders
  where id = p_order_id and pharmacy_partner_id = private.pharmacist_partner();

  if v_order.id is null then
    raise exception 'Order not found for this pharmacy' using errcode = '42501';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'A note describing the concern is required' using errcode = '22023';
  end if;

  select id, medication_id into v_dispense_id, v_medication_id
  from public.pharmacy_order_dispenses
  where pharmacy_order_id = p_order_id
  order by created_at desc
  limit 1;

  insert into public.medication_dispense_flags
    (organisation_id, patient_id, medication_id, pharmacy_order_dispense_id, flag_type, note)
  values
    (v_order.organisation_id, v_order.patient_id, v_medication_id, v_dispense_id, p_flag_type, btrim(p_note))
  returning id into v_flag_id;

  return v_flag_id;
end;
$$;

revoke execute on function public.pharmacist_flag_dispense(uuid, public.medication_flag_type, text) from public;
revoke execute on function public.pharmacist_flag_dispense(uuid, public.medication_flag_type, text) from anon;
grant execute on function public.pharmacist_flag_dispense(uuid, public.medication_flag_type, text) to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'medication_dispense_flags') then
    raise exception 'FAIL: medication_dispense_flags table was not created';
  end if;
  if has_function_privilege('anon', 'public.pharmacist_flag_dispense(uuid, public.medication_flag_type, text)', 'execute') then
    raise exception 'FAIL: pharmacist_flag_dispense is anon-executable';
  end if;
  if has_table_privilege('anon', 'public.medication_dispense_flags', 'SELECT') then
    raise exception 'FAIL: anon can select medication_dispense_flags';
  end if;
  raise notice 'PASS: medication_dispense_flags + pharmacist_flag_dispense installed';
end $$;
