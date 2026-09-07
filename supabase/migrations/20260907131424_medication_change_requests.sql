-- Tarragon Health
-- Patient UX fix pass, 2026-09-07: patients could add a new self-reported
-- medication and stop one of their own, but had no way to propose a change
-- to an existing medication ("this dose changed", "I was told to switch
-- brands") with a reason — the only edit path at all was
-- private.amend_medication, which explicitly BLOCKS the patient from calling
-- it themselves (20260829010500_amend_medication.sql: "A prescription can
-- only be amended by clinical staff, not the patient").
--
-- Founder decision (asked explicitly): a patient submits a change request +
-- reason, but it does NOT take effect until a clinician reviews it — the
-- same "every clinical judgment made by a doctor" rule the tier ladder
-- already enforces everywhere else. This table is a REQUEST, not an edit
-- path: it never writes to public.medications itself. Modelled directly on
-- medication_repeat_requests (20260829011000) for the request/review shape,
-- but reviewed via private.has_prescribing_authority rather than the lighter
-- private.can_confirm_medication_refill — a repeat request only lets a
-- patient collect more of what was already signed; this can describe an
-- actual dose/drug/instruction change, which is the same class of act
-- amend_medication itself already gates behind full prescribing authority.
-- Approving a request here only records that a clinician has reviewed it —
-- the clinician still makes the actual change through the existing Amend
-- control (private.amend_medication), so there is exactly one path that ever
-- writes to a prescription, matching the "one true amendment mechanism"
-- shape the rest of this table's review trigger enforces.

create type public.medication_change_request_status as enum ('pending', 'approved', 'denied');

create table public.medication_change_requests (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  medication_id     uuid not null references public.medications (id) on delete cascade,

  requested_change  text not null,
  reason            text not null,

  status            public.medication_change_request_status not null default 'pending',
  requested_at      timestamptz not null default now(),
  reviewed_by       uuid references public.clinical_staff (id) on delete set null,
  reviewed_at       timestamptz,
  review_note       text,
  denial_reason     text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint medication_change_requests_requested_change_length check (
    char_length(btrim(requested_change)) between 1 and 500
  ),
  constraint medication_change_requests_reason_length check (
    char_length(btrim(reason)) between 1 and 500
  ),
  constraint medication_change_requests_review_note_length check (char_length(review_note) <= 500),
  constraint medication_change_requests_denial_reason_length check (char_length(denial_reason) <= 500)
);

create index medication_change_requests_medication_idx
  on public.medication_change_requests (medication_id, requested_at desc);
create index medication_change_requests_patient_idx
  on public.medication_change_requests (patient_id, requested_at desc);
create index medication_change_requests_org_status_idx
  on public.medication_change_requests (organisation_id, status);

create trigger medication_change_requests_set_updated_at
  before update on public.medication_change_requests
  for each row execute function private.set_updated_at();

comment on table public.medication_change_requests is
  'A patient''s proposed change to an existing medication (what they want changed + why) and its clinical review. Never writes to public.medications itself — approval records that a clinician has reviewed it; the actual edit still goes through private.amend_medication, the one true amendment mechanism.';

-- ---------------------------------------------------------------------------
-- INSERT: organisation_id/patient_id re-derived from the medication row,
-- never trusted from the client (same discipline as
-- stamp_and_check_medication_repeat_request). The medication must belong to
-- this patient and still be active.
-- ---------------------------------------------------------------------------

create or replace function private.stamp_and_check_medication_change_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_med public.medications%rowtype;
  v_open_count integer;
begin
  select * into v_med from public.medications where id = new.medication_id;
  if v_med.id is null then
    raise exception 'Medication not found' using errcode = '42704';
  end if;
  if v_med.patient_id <> (select auth.uid()) then
    raise exception 'You can only request a change to your own medication' using errcode = '42501';
  end if;
  if not v_med.is_active then
    raise exception 'This medication is no longer active' using errcode = '22023';
  end if;
  if v_med.superseded_at is not null then
    raise exception 'This medication has already been updated — request a change against its current version' using errcode = '22023';
  end if;

  new.organisation_id := v_med.organisation_id;
  new.patient_id := v_med.patient_id;
  new.status := 'pending';
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_note := null;
  new.denial_reason := null;

  select count(*) into v_open_count
  from public.medication_change_requests
  where medication_id = new.medication_id and status = 'pending';
  if v_open_count > 0 then
    raise exception 'A change request is already pending for this medication' using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger medication_change_requests_stamp_and_check
  before insert on public.medication_change_requests
  for each row execute function private.stamp_and_check_medication_change_request();

-- ---------------------------------------------------------------------------
-- UPDATE (review only): a clinician with prescribing authority may move a
-- pending request to approved/denied, never edit the request text itself.
-- reviewed_by/reviewed_at are server-stamped, never client-supplied.
-- ---------------------------------------------------------------------------

create or replace function private.stamp_medication_change_request_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_staff_id uuid;
begin
  if old.status <> 'pending' then
    raise exception 'This change request has already been reviewed' using errcode = '22023';
  end if;
  if new.status not in ('approved', 'denied') then
    raise exception 'Invalid review outcome' using errcode = '22023';
  end if;
  if new.status = 'denied' and coalesce(btrim(new.denial_reason), '') = '' then
    raise exception 'A reason is required to deny a change request' using errcode = '22023';
  end if;

  new.organisation_id := old.organisation_id;
  new.patient_id := old.patient_id;
  new.medication_id := old.medication_id;
  new.requested_change := old.requested_change;
  new.reason := old.reason;
  new.requested_at := old.requested_at;

  select id into v_caller_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = old.organisation_id
    and active;

  new.reviewed_by := v_caller_staff_id;
  new.reviewed_at := now();
  if new.status = 'approved' then
    new.denial_reason := null;
  end if;

  return new;
end;
$$;

create trigger medication_change_requests_stamp_review
  before update on public.medication_change_requests
  for each row execute function private.stamp_medication_change_request_review();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.medication_change_requests enable row level security;

create policy medication_change_requests_select on public.medication_change_requests
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy medication_change_requests_insert on public.medication_change_requests
  for insert to authenticated
  with check (patient_id = (select auth.uid()));

-- Review only — full prescribing authority, matching amend_medication's own
-- gate: this describes the same class of act (drug/dose/instruction change),
-- not the lighter refill-confirmation authority.
create policy medication_change_requests_update on public.medication_change_requests
  for update to authenticated
  using (private.is_org_staff(organisation_id) and private.has_prescribing_authority(organisation_id))
  with check (private.is_org_staff(organisation_id) and private.has_prescribing_authority(organisation_id));

grant select, insert, update on public.medication_change_requests to authenticated;
revoke all on public.medication_change_requests from anon;
revoke delete on public.medication_change_requests from authenticated;

create trigger audit_row_change_trg
  after insert or update or delete on public.medication_change_requests
  for each row execute function private.audit_row_change();

create trigger capture_record_correction_trg
  after update or delete on public.medication_change_requests
  for each row execute function private.capture_record_correction();

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'medication_change_requests'
  ) then
    raise exception 'medication_change_requests table was not created';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'medication_change_requests_stamp_and_check'
      and tgrelid = 'public.medication_change_requests'::regclass
  ) then
    raise exception 'medication_change_requests_stamp_and_check trigger was not created';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'medication_change_requests' and cmd = 'DELETE'
  ) then
    raise exception 'medication_change_requests must have no DELETE policy';
  end if;
  raise notice 'PASS: medication_change_requests — table, RLS, eligibility + review triggers installed';
end $$;
