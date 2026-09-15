-- Tarragon Health
-- Patient UX fix pass, 2026-09-07: "Download your data" on the Privacy & data
-- centre was a plain <Link href="/api/patient/data-export"> that streams the
-- export instantly, with no review step at all -- founder wants a patient to
-- REQUEST their data from admin, not self-serve download it directly.
--
-- Modelled directly on data_deletion_requests / data_correction_requests
-- (20260829223506 / 20260830001845, attribution hardened 20260830002055):
-- same tracked-request shape, same RLS (patient can insert/see their own,
-- only private.is_admin() can move status off pending), same
-- unconditional-attribution trigger pattern. Deliberately does NOT attempt to
-- auto-generate or auto-deliver the export -- the existing instant
-- /api/patient/data-export route stays in the codebase for an admin to run
-- against the request once reviewed; this table exists to make the request
-- itself visible and reviewable instead of a silent direct download.

create table public.data_export_requests (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  patient_id        uuid not null references public.profiles (id) on delete cascade,

  requested_at      timestamptz not null default now(),
  note              text,

  status            text not null default 'pending' check (status in (
    'pending', 'under_review', 'fulfilled', 'denied'
  )),
  reviewed_by       uuid references public.profiles (id) on delete set null,
  reviewed_at       timestamptz,
  decision_note     text,

  fulfilled_by      uuid references public.profiles (id) on delete set null,
  fulfilled_at      timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint data_export_requests_reviewed_requires_reviewer check (
    status = 'pending' or (reviewed_by is not null and reviewed_at is not null)
  ),
  constraint data_export_requests_denied_requires_reason check (
    status <> 'denied' or (decision_note is not null and length(btrim(decision_note)) > 0)
  ),
  constraint data_export_requests_fulfilled_requires_completion check (
    status <> 'fulfilled' or (fulfilled_by is not null and fulfilled_at is not null)
  )
);

comment on table public.data_export_requests is
  'Patient data-export request workflow. Patients ask for their own data instead of self-serve downloading it via /api/patient/data-export directly; an admin reviews and fulfils each request out of band. Does not itself generate or deliver an export.';

create index data_export_requests_org_status_idx on public.data_export_requests (organisation_id, status, requested_at desc);
create index data_export_requests_patient_idx on public.data_export_requests (patient_id);

alter table public.data_export_requests enable row level security;

create policy data_export_requests_select on public.data_export_requests
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_admin());

create policy data_export_requests_insert on public.data_export_requests
  for insert to authenticated
  with check (patient_id = (select auth.uid()));

create policy data_export_requests_update on public.data_export_requests
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, insert, update on public.data_export_requests to authenticated;
revoke delete on public.data_export_requests from authenticated;

create trigger data_export_requests_set_updated_at
  before update on public.data_export_requests
  for each row execute function private.set_updated_at();

create or replace function private.enforce_data_export_request_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.patient_id := (select auth.uid());
    new.organisation_id := (select organisation_id from public.profiles where id = (select auth.uid()));
    new.status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.fulfilled_by := null;
    new.fulfilled_at := null;
    return new;
  end if;

  if old.status = 'fulfilled' then
    raise exception 'This export request is already fulfilled and cannot be edited further.'
      using errcode = '42501';
  end if;

  new.patient_id := old.patient_id;
  new.organisation_id := old.organisation_id;
  new.requested_at := old.requested_at;

  if new.status <> old.status and new.status <> 'pending' then
    if not private.is_admin() then
      raise exception 'Only an admin can review or fulfil a data export request.'
        using errcode = '42501';
    end if;
    new.reviewed_by := (select auth.uid());
    new.reviewed_at := coalesce(old.reviewed_at, now());
    if new.status = 'fulfilled' then
      new.fulfilled_by := (select auth.uid());
      new.fulfilled_at := now();
    end if;
  end if;

  return new;
end;
$$;

comment on function private.enforce_data_export_request_attribution() is
  'INSERT: forces patient_id/organisation_id/status server-side from the caller''s own profile, unconditionally (matches the 20260830002055 correction on the deletion/correction sibling triggers -- never coalesce-defaulted). UPDATE: locks a fulfilled request, keeps requester identity immutable, requires admin to move status past pending and stamps reviewed/fulfilled attribution server-side.';

create trigger data_export_requests_enforce_attribution
  before insert or update on public.data_export_requests
  for each row execute function private.enforce_data_export_request_attribution();

revoke all on function private.enforce_data_export_request_attribution() from public;

do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'data_export_requests') then
    raise exception 'data_export_requests missing after migration';
  end if;
  if exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'data_export_requests' and cmd = 'DELETE'
  ) then
    raise exception 'data_export_requests must have no DELETE policy';
  end if;
  if has_table_privilege('authenticated', 'public.data_export_requests', 'DELETE') then
    raise exception 'authenticated must not hold DELETE on data_export_requests';
  end if;
  raise notice 'PASS: data_export_requests created, RLS + attribution trigger present';
end $$;
