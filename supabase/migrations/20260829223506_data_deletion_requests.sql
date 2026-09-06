-- Tarragon Health
-- Data Governance gap-closure, item 3 of 7 (§87.11 "data deletion" of the
-- 2026-08-29 governance/safety spec audit). Confirmed live before writing
-- this: docs/legal/dpia-health-data-processing.md states plainly deletion
-- requests are "handled case by case" -- no table, no tracked process.
--
-- Deliberately a WORKFLOW, not an automated anonymisation engine: the spec
-- itself warns "clinical records subject to mandatory retention should not
-- simply be deleted because a patient requests deletion." Auto-executing a
-- deletion against arbitrary tables is exactly the kind of irreversible,
-- high-blast-radius automation that needs a human decision per request, not
-- a migration's best guess -- this tracks the request, the reviewer's
-- category-by-category decision (referencing table_classifications /
-- data_retention_policies, both built earlier the same day), and the
-- eventual completion, replacing "case by case, undocumented" with
-- "case by case, documented and auditable."

create table public.data_deletion_requests (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete cascade,
  patient_id          uuid not null references public.profiles (id) on delete cascade,

  requested_at        timestamptz not null default now(),
  reason              text,
  -- Which table_classifications rows the patient is asking about -- a
  -- lightweight array of table names, not a hard FK array (patients don't
  -- pick from the registry directly; an admin maps the request onto it
  -- during review).
  requested_categories text[] not null default '{}',

  status              text not null default 'pending' check (status in (
    'pending', 'under_review', 'approved_partial', 'approved_full', 'denied', 'completed'
  )),
  reviewed_by         uuid references public.profiles (id) on delete set null,
  reviewed_at         timestamptz,
  decision_note       text,
  -- What could NOT be deleted and why (e.g. "clinical_records retention
  -- category has no defined end date") -- required whenever the decision
  -- isn't a full, unblocked approval.
  blocked_categories  text[] not null default '{}',
  blocked_reason      text,

  completed_by        uuid references public.profiles (id) on delete set null,
  completed_at        timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint data_deletion_requests_reviewed_requires_reviewer check (
    status = 'pending' or (reviewed_by is not null and reviewed_at is not null)
  ),
  constraint data_deletion_requests_partial_requires_blocked_reason check (
    status <> 'approved_partial' or (blocked_reason is not null and length(btrim(blocked_reason)) > 0)
  ),
  constraint data_deletion_requests_denied_requires_reason check (
    status <> 'denied' or (decision_note is not null and length(btrim(decision_note)) > 0)
  ),
  constraint data_deletion_requests_completed_requires_completion check (
    status <> 'completed' or (completed_by is not null and completed_at is not null)
  )
);

comment on table public.data_deletion_requests is
  'Controlled deletion/anonymisation request workflow, docs spec §87.11. Tracks the request, the reviewer''s per-category decision, and completion -- does NOT auto-execute a deletion against any table. blocked_categories/blocked_reason document why a clinical-record category under mandatory retention cannot simply be deleted on request, per the spec''s own warning.';

create index data_deletion_requests_org_status_idx on public.data_deletion_requests (organisation_id, status, requested_at desc);
create index data_deletion_requests_patient_idx on public.data_deletion_requests (patient_id);

alter table public.data_deletion_requests enable row level security;

create policy data_deletion_requests_select on public.data_deletion_requests
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_admin());

create policy data_deletion_requests_insert on public.data_deletion_requests
  for insert to authenticated
  with check (patient_id = (select auth.uid()));

create policy data_deletion_requests_update on public.data_deletion_requests
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, insert, update on public.data_deletion_requests to authenticated;
revoke delete on public.data_deletion_requests from authenticated;

create trigger data_deletion_requests_set_updated_at
  before update on public.data_deletion_requests
  for each row execute function private.set_updated_at();

create or replace function private.enforce_data_deletion_request_attribution()
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
    new.completed_by := null;
    new.completed_at := null;
    return new;
  end if;

  if old.status = 'completed' then
    raise exception 'This deletion request is already completed and cannot be edited further.'
      using errcode = '42501';
  end if;

  new.patient_id := old.patient_id;
  new.organisation_id := old.organisation_id;
  new.requested_at := old.requested_at;

  if new.status <> old.status and new.status <> 'pending' then
    if not private.is_admin() then
      raise exception 'Only an admin can review or complete a data deletion request.'
        using errcode = '42501';
    end if;
    new.reviewed_by := (select auth.uid());
    new.reviewed_at := coalesce(old.reviewed_at, now());
    if new.status = 'completed' then
      new.completed_by := (select auth.uid());
      new.completed_at := now();
    end if;
  end if;

  return new;
end;
$$;

comment on function private.enforce_data_deletion_request_attribution() is
  'INSERT: forces patient_id/organisation_id/status server-side. UPDATE: locks a completed request, keeps requester identity immutable, requires admin to move status past pending and stamps reviewed/completed attribution server-side.';

create trigger data_deletion_requests_enforce_attribution
  before insert or update on public.data_deletion_requests
  for each row execute function private.enforce_data_deletion_request_attribution();

revoke all on function private.enforce_data_deletion_request_attribution() from public;

do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'data_deletion_requests') then
    raise exception 'data_deletion_requests missing after migration';
  end if;
  if exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'data_deletion_requests' and cmd = 'DELETE'
  ) then
    raise exception 'data_deletion_requests must have no DELETE policy';
  end if;
  if has_table_privilege('authenticated', 'public.data_deletion_requests', 'DELETE') then
    raise exception 'authenticated must not hold DELETE on data_deletion_requests';
  end if;
  raise notice 'PASS: data_deletion_requests created, RLS + attribution trigger present';
end $$;
