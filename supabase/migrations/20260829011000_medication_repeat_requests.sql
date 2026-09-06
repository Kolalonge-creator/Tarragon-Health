-- Tarragon Health — Electronic Prescription & Prescription Management Engine.
-- §62.11 "I need my next supply" + §62.12 repeat approval.
--
-- Policy decision, stated plainly because the spec's own flow diagram
-- ("Repeat request -> Eligible? -> Clinical review if required -> Approved")
-- reads as if some repeats could skip review: this schema does NOT implement
-- an auto-approve branch. Every repeat request always reaches a clinician —
-- the spec is explicit elsewhere that "unrestricted automatic repeats" for
-- medications requiring clinical reassessment must never happen, and there is
-- no reliable, schema-level way to tell "needs reassessment" from "routine"
-- for a free-text drug_name without duplicating apps/web/src/lib/rules/
-- controlled-substances.ts's curated pattern list in SQL and risking the two
-- drifting apart. "Eligible?" is still real, and still happens before a
-- clinician ever sees the request — it's the BEFORE INSERT trigger below,
-- which rejects (with a specific reason) a request against an inactive,
-- superseded, expired, or exhausted prescription, or one with a request
-- already pending, before it is ever created.
--
-- Review authority reuses private.can_confirm_medication_refill (any active
-- clinical tier, never care_coordinator) rather than a new function: clearing
-- a patient for their next supply of an already-signed, stable prescription
-- is the same class of act as Tier 1's existing "confirm & continue" refill
-- authority, not a new-prescribing act (that stays gated behind
-- has_prescribing_authority via amend_medication/AddMedicationForm).

create type public.medication_repeat_request_status as enum ('pending', 'approved', 'denied');

create table public.medication_repeat_requests (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  medication_id     uuid not null references public.medications (id) on delete cascade,
  status            public.medication_repeat_request_status not null default 'pending',
  requested_at      timestamptz not null default now(),
  reviewed_by       uuid references public.clinical_staff (id) on delete set null,
  reviewed_at       timestamptz,
  review_note       text,
  denial_reason     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint medication_repeat_requests_review_note_length check (char_length(review_note) <= 500),
  constraint medication_repeat_requests_denial_reason_length check (char_length(denial_reason) <= 500)
);

create index medication_repeat_requests_medication_idx
  on public.medication_repeat_requests (medication_id, requested_at desc);
create index medication_repeat_requests_patient_idx
  on public.medication_repeat_requests (patient_id, requested_at desc);
create index medication_repeat_requests_org_status_idx
  on public.medication_repeat_requests (organisation_id, status);

create trigger medication_repeat_requests_set_updated_at
  before update on public.medication_repeat_requests
  for each row execute function private.set_updated_at();

comment on table public.medication_repeat_requests is
  'Spec §62.11/§62.12 — a patient''s request for the next supply of a repeat prescription, and its clinical approval/denial. See this migration''s header for why there is deliberately no auto-approve path.';

-- ---------------------------------------------------------------------------
-- Eligibility gate, BEFORE INSERT — "Eligible?" from the spec's flow diagram.
-- organisation_id/patient_id are re-derived from the medication row, never
-- trusted from the client, same reasoning as stamp_medication_added_by.
-- ---------------------------------------------------------------------------

create or replace function private.stamp_and_check_medication_repeat_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_med public.medications%rowtype;
  v_open_count integer;
  v_used_count integer;
begin
  select * into v_med from public.medications where id = new.medication_id;
  if v_med.id is null then
    raise exception 'Prescription not found' using errcode = '42704';
  end if;
  if v_med.source <> 'clinician' then
    raise exception 'Only a clinician-issued prescription can have a repeat requested' using errcode = '42501';
  end if;

  new.organisation_id := v_med.organisation_id;
  new.patient_id := v_med.patient_id;
  new.status := 'pending';
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_note := null;
  new.denial_reason := null;

  if not v_med.is_active then
    raise exception 'This prescription is no longer active' using errcode = '22023';
  end if;
  if v_med.superseded_at is not null then
    raise exception 'This prescription has been amended — request a repeat against its current version' using errcode = '22023';
  end if;
  if v_med.expires_at is not null and v_med.expires_at < now() then
    raise exception 'This prescription has expired' using errcode = '22023';
  end if;
  if coalesce(v_med.repeats_allowed, 0) = 0 then
    raise exception 'This prescription has no repeats remaining' using errcode = '22023';
  end if;

  select count(*) into v_open_count
  from public.medication_repeat_requests
  where medication_id = new.medication_id and status = 'pending';
  if v_open_count > 0 then
    raise exception 'A repeat request is already pending for this prescription' using errcode = '22023';
  end if;

  select count(*) into v_used_count
  from public.medication_repeat_requests
  where medication_id = new.medication_id and status = 'approved';
  if v_used_count >= v_med.repeats_allowed then
    raise exception 'No repeats remaining on this prescription' using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger medication_repeat_requests_stamp_and_check
  before insert on public.medication_repeat_requests
  for each row execute function private.stamp_and_check_medication_repeat_request();

-- ---------------------------------------------------------------------------
-- Review, BEFORE UPDATE — a clinician may only move a pending request to
-- approved/denied, never edit the request itself; reviewed_by/reviewed_at
-- are server-stamped, never client-supplied (same discipline as
-- last_confirmed_by/stamp_medication_added_by).
-- ---------------------------------------------------------------------------

create or replace function private.stamp_medication_repeat_request_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_staff_id uuid;
begin
  if old.status <> 'pending' then
    raise exception 'This repeat request has already been reviewed' using errcode = '22023';
  end if;
  if new.status not in ('approved', 'denied') then
    raise exception 'Invalid review outcome' using errcode = '22023';
  end if;
  if new.status = 'denied' and coalesce(btrim(new.denial_reason), '') = '' then
    raise exception 'A reason is required to deny a repeat request' using errcode = '22023';
  end if;

  new.organisation_id := old.organisation_id;
  new.patient_id := old.patient_id;
  new.medication_id := old.medication_id;
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

create trigger medication_repeat_requests_stamp_review
  before update on public.medication_repeat_requests
  for each row execute function private.stamp_medication_repeat_request_review();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.medication_repeat_requests enable row level security;

create policy medication_repeat_requests_select on public.medication_repeat_requests
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy medication_repeat_requests_insert on public.medication_repeat_requests
  for insert to authenticated
  with check (patient_id = (select auth.uid()));

-- Approve/deny only — private.can_confirm_medication_refill (any active
-- clinical tier, never care_coordinator). Full prescribing authority is not
-- required: this never changes drug/dose/frequency, only whether the
-- patient may collect their next supply of what was already signed.
create policy medication_repeat_requests_update on public.medication_repeat_requests
  for update to authenticated
  using (private.is_org_staff(organisation_id) and private.can_confirm_medication_refill(organisation_id))
  with check (private.is_org_staff(organisation_id) and private.can_confirm_medication_refill(organisation_id));

grant select, insert, update on public.medication_repeat_requests to authenticated;
revoke all on public.medication_repeat_requests from anon;

-- Platform-wide audit + correction trail, same as every other clinical table.
create trigger audit_row_change_trg
  after insert or update or delete on public.medication_repeat_requests
  for each row execute function private.audit_row_change();

create trigger capture_record_correction_trg
  after update or delete on public.medication_repeat_requests
  for each row execute function private.capture_record_correction();

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'medication_repeat_requests'
  ) then
    raise exception 'medication_repeat_requests table was not created';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'medication_repeat_requests_stamp_and_check'
      and tgrelid = 'public.medication_repeat_requests'::regclass
  ) then
    raise exception 'medication_repeat_requests_stamp_and_check trigger was not created';
  end if;
  raise notice 'PASS: medication_repeat_requests — table, RLS, eligibility + review triggers installed';
end $$;
