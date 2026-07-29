-- Tarragon Health — Vaccination verified pathway
--
-- Turns the vaccination *registry* into a verified *pathway*: a patient uploads
-- the physical certificate they were handed at the vaccination centre, a
-- Tarragon care-team doctor reviews that image and acknowledges the dose was
-- truly received, and only then does the platform issue a Tarragon certificate
-- and roll the schedule forward to the next dose.
--
-- Depends on public.vaccination_schedules + private.queue_vaccination_reminders
-- (20260716190000_vaccination_schedules.sql — already live on remote; carried
-- here for code parity, overlaps PR #60's preventive-health-pathway slice).
--
-- Design mirrors the existing clinical-attribution + structural-guardrail
-- patterns:
--   * verified_by/verified_at are the same null-gated attribution shape as
--     escalations.reviewed_by (docs/CLINICAL_TRUST_MODEL_SPEC.md §2) — surfaced
--     through the shared "Reviewed by Dr. X" component, never invented.
--   * A BEFORE trigger server-derives verified_by and issues the certificate
--     serial, so neither can be spoofed from a patient session (same pattern as
--     medications.last_confirmed_by / enforce_medication_confirm_only).

-- ---------------------------------------------------------------------------
-- Verification state
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'vaccination_verification_status') then
    create type public.vaccination_verification_status as enum (
      'self_reported',        -- logged by the patient, no physical proof attached
      'pending_verification', -- physical certificate uploaded, awaiting Tarragon review
      'verified',             -- a Tarragon doctor confirmed the physical certificate
      'rejected'              -- reviewed and not accepted (e.g. illegible/mismatched)
    );
  end if;
end $$;

alter table public.vaccination_records
  add column if not exists verification_status public.vaccination_verification_status
    not null default 'self_reported',
  -- storage.objects path (bucket 'vaccination-certificates') of the image the
  -- patient uploaded from the centre. Never a public URL — viewed via a
  -- short-lived signed URL minted server-side for org staff only.
  add column if not exists physical_certificate_path text,
  add column if not exists verified_by uuid references public.profiles (id) on delete set null,
  add column if not exists verified_at timestamptz,
  add column if not exists verification_note text,
  -- The Tarragon-issued certificate identity, set once at verification time by
  -- the trigger below (never client-supplied).
  add column if not exists tarragon_certificate_serial text unique,
  add column if not exists tarragon_certificate_issued_at timestamptz,
  -- Links a logged dose back to the appointment it was booked under, closing
  -- the appointment -> vaccination loop (Priority #2).
  add column if not exists booking_request_id uuid references public.booking_requests (id) on delete set null;

-- Fast lookup for the clinician verification worklist.
create index if not exists vaccination_records_pending_verification_idx
  on public.vaccination_records (organisation_id, created_at)
  where verification_status = 'pending_verification';

-- Monotonic source for human-readable Tarragon certificate serials.
create sequence if not exists public.vaccination_certificate_serial_seq;

-- ---------------------------------------------------------------------------
-- Structural verification guardrail
-- ---------------------------------------------------------------------------
-- RLS already lets a patient UPDATE their own vaccination_records row (to
-- attach a certificate + move it to 'pending_verification'). This trigger is
-- the structural backstop that stops that same self-write from ever reaching
-- 'verified'/'rejected', and makes the attribution + certificate serial
-- impossible to forge — they are derived here, not trusted from the caller.
create or replace function private.enforce_vaccination_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.verification_status in ('verified', 'rejected') then
    -- Only Tarragon care-team staff can adjudicate. Which staff member is
    -- allowed to act is enforced in the app layer (an active clinical_staff
    -- record — the same app-layer clinical-authority gate as Care Coordinator
    -- write access); this is the DB backstop that a plain patient session
    -- cannot cross even though RLS lets it touch its own row.
    if not private.is_org_staff(new.organisation_id) then
      raise exception 'Only Tarragon care-team staff can verify or reject a vaccination record'
        using errcode = '42501';
    end if;

    -- Server-derived attribution — cannot be spoofed to another doctor.
    new.verified_by := (select auth.uid());
    if new.verified_at is null then
      new.verified_at := now();
    end if;
  else
    -- Any non-adjudicated state carries no attribution or note.
    new.verified_by := null;
    new.verified_at := null;
    new.verification_note := null;
  end if;

  -- The Tarragon certificate exists only on a verified record, and its serial
  -- is issued exactly once (never reissued, never client-supplied).
  if new.verification_status = 'verified' then
    if tg_op = 'UPDATE' and old.verification_status = 'verified' then
      new.tarragon_certificate_serial := old.tarragon_certificate_serial;
      new.tarragon_certificate_issued_at := old.tarragon_certificate_issued_at;
    else
      if new.tarragon_certificate_serial is null then
        new.tarragon_certificate_serial :=
          'TAR-VAX-' || lpad(nextval('public.vaccination_certificate_serial_seq')::text, 6, '0');
      end if;
      new.tarragon_certificate_issued_at := now();
    end if;
  else
    new.tarragon_certificate_serial := null;
    new.tarragon_certificate_issued_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists vaccination_records_enforce_verification on public.vaccination_records;
create trigger vaccination_records_enforce_verification
  before insert or update on public.vaccination_records
  for each row execute function private.enforce_vaccination_verification();

-- ---------------------------------------------------------------------------
-- Certificate image storage (private bucket)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vaccination-certificates',
  'vaccination-certificates',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do nothing;

-- Path convention: '<patient_id>/<uuid>.<ext>'. A patient may read/write only
-- objects under their own uid folder. Org staff never read via a storage
-- policy (which can't see org membership cleanly) — the clinician worklist
-- mints a short-lived signed URL server-side after RLS-confirming the record
-- is in their organisation.
drop policy if exists "vaccination cert patient insert" on storage.objects;
create policy "vaccination cert patient insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vaccination-certificates'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "vaccination cert patient select" on storage.objects;
create policy "vaccination cert patient select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vaccination-certificates'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "vaccination cert patient update" on storage.objects;
create policy "vaccination cert patient update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'vaccination-certificates'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'vaccination-certificates'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "vaccination cert patient delete" on storage.objects;
create policy "vaccination cert patient delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'vaccination-certificates'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
