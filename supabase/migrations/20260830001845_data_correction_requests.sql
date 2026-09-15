-- Tarragon Health
-- Data Governance gap-closure, found while building the Privacy Centre page
-- (§87.7/§87.9 right to rectification). The PR3 plan assumed §87.9 was
-- already built because record_corrections exists -- confirmed live via
-- information_schema that record_corrections is a pure AFTER-THE-FACT audit
-- trail (old_values/new_values/corrected_by/corrected_at, written by an
-- existing trigger when a clinician edits data) with no requested_by/status/
-- review columns at all, and a full apps/web search found no patient-facing
-- "request a correction" UI anywhere. The audit trail is real; the patient
-- RIGHT to request rectification of their own data was not.
--
-- Same shape as data_deletion_requests (20260829223411), deliberately: a
-- tracked WORKFLOW, not an auto-apply-the-edit engine -- correcting clinical
-- data is itself a clinical action requiring review, not something a
-- patient's own submission should be allowed to write directly. When a
-- reviewer does make the underlying correction (e.g. editing a
-- vitals_readings row), the EXISTING record_corrections trigger logs that
-- separately -- this table is not linked to it by a hard FK because the
-- correction can land on any of many target tables; resolution_note is
-- where a reviewer records what was actually changed and where.

create table public.data_correction_requests (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  patient_id        uuid not null references public.profiles (id) on delete cascade,

  requested_at      timestamptz not null default now(),
  record_description text not null check (length(btrim(record_description)) > 0),
  what_is_wrong     text not null check (length(btrim(what_is_wrong)) > 0),
  requested_change  text,

  status            text not null default 'pending' check (status in (
    'pending', 'under_review', 'approved', 'applied', 'denied'
  )),
  reviewed_by       uuid references public.profiles (id) on delete set null,
  reviewed_at       timestamptz,
  decision_note     text,
  resolution_note   text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint data_correction_requests_reviewed_requires_reviewer check (
    status = 'pending' or (reviewed_by is not null and reviewed_at is not null)
  ),
  constraint data_correction_requests_denied_requires_reason check (
    status <> 'denied' or (decision_note is not null and length(btrim(decision_note)) > 0)
  ),
  constraint data_correction_requests_applied_requires_resolution check (
    status <> 'applied' or (resolution_note is not null and length(btrim(resolution_note)) > 0)
  )
);

comment on table public.data_correction_requests is
  'Patient right-to-rectification request workflow, docs spec §87.9. Deliberately separate from record_corrections (which is a write-time audit trail of already-executed corrections, not a request mechanism) -- correcting clinical data stays a reviewed clinical action, this table only tracks the request and its outcome.';

create index data_correction_requests_org_status_idx on public.data_correction_requests (organisation_id, status, requested_at desc);
create index data_correction_requests_patient_idx on public.data_correction_requests (patient_id);

alter table public.data_correction_requests enable row level security;

create policy data_correction_requests_select on public.data_correction_requests
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy data_correction_requests_insert on public.data_correction_requests
  for insert to authenticated
  with check (patient_id = (select auth.uid()));

create policy data_correction_requests_update on public.data_correction_requests
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.data_correction_requests to authenticated;
revoke delete on public.data_correction_requests from authenticated;

create trigger data_correction_requests_set_updated_at
  before update on public.data_correction_requests
  for each row execute function private.set_updated_at();

create or replace function private.enforce_data_correction_request_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.patient_id := (select auth.uid());
    new.organisation_id := coalesce(
      new.organisation_id,
      (select organisation_id from public.profiles where id = (select auth.uid()))
    );
    new.status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
    return new;
  end if;

  new.patient_id := old.patient_id;
  new.organisation_id := old.organisation_id;
  new.requested_at := old.requested_at;

  if new.status <> old.status and new.status <> 'pending' then
    new.reviewed_by := (select auth.uid());
    new.reviewed_at := coalesce(old.reviewed_at, now());
  end if;

  return new;
end;
$$;

comment on function private.enforce_data_correction_request_attribution() is
  'INSERT: forces patient_id/organisation_id/status server-side (a patient cannot open a request on someone else''s behalf or pre-mark it reviewed). UPDATE: keeps requester identity immutable, stamps reviewed_by/reviewed_at server-side on any status change off pending. Review authority itself is org-staff broadly (matches the RLS UPDATE policy) rather than a narrower tier gate -- unlike data_deletion_requests, a rectification request review does not by itself execute a data change (see resolution_note), so the same low-risk-review bar as other org-staff-reviewable queues applies.';

create trigger data_correction_requests_enforce_attribution
  before insert or update on public.data_correction_requests
  for each row execute function private.enforce_data_correction_request_attribution();

revoke all on function private.enforce_data_correction_request_attribution() from public;

do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'data_correction_requests') then
    raise exception 'data_correction_requests missing after migration';
  end if;
  if exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'data_correction_requests' and cmd = 'DELETE'
  ) then
    raise exception 'data_correction_requests must have no DELETE policy';
  end if;
  if has_table_privilege('authenticated', 'public.data_correction_requests', 'DELETE') then
    raise exception 'authenticated must not hold DELETE on data_correction_requests';
  end if;
  raise notice 'PASS: data_correction_requests created, RLS + attribution trigger present';
end $$;
