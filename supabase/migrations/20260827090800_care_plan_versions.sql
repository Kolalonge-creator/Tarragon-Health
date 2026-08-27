-- Tarragon Health — Care Management Engine, step 8
--
-- care_plan_versions: an append-only history of every prior state of a
-- care_plans row, so a review cycle's "old versions remain accessible"
-- (spec §3.18) is literally true rather than aspirational — today an update
-- to target_ranges, status, notes, assigned_clinician_id or programme
-- linkage simply overwrites care_plans with no trace of what it used to
-- say. Same "snapshot before overwrite" idiom this platform already uses
-- for care_plan_review_prompts' worklist trail, just applied to the plan's
-- own state this time. No new source of truth: care_plans stays the only
-- live record; this is a derived, immutable log of what it used to be.

create table public.care_plan_versions (
  id               uuid primary key default gen_random_uuid(),
  care_plan_id     uuid not null references public.care_plans (id) on delete cascade,
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  -- The FULL prior row, so a reader can see exactly what changed relative to
  -- the current one without a separate diff mechanism.
  snapshot         jsonb not null,
  changed_by       uuid references public.profiles (id) on delete set null,
  changed_at       timestamptz not null default now()
);

create index care_plan_versions_care_plan_idx on public.care_plan_versions (care_plan_id, changed_at desc);
create index care_plan_versions_patient_idx on public.care_plan_versions (patient_id);

create or replace function private.snapshot_care_plan_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Compare only the clinically meaningful columns (not updated_at, which
  -- changes on every touch) so a no-op write never creates a spurious version.
  if old.condition is distinct from new.condition
     or old.status is distinct from new.status
     or old.target_ranges is distinct from new.target_ranges
     or old.notes is distinct from new.notes
     or old.assigned_clinician_id is distinct from new.assigned_clinician_id
  then
    insert into public.care_plan_versions
      (care_plan_id, organisation_id, patient_id, snapshot, changed_by)
    values
      (old.id, old.organisation_id, old.patient_id, to_jsonb(old), (select auth.uid()));
  end if;
  return new;
end;
$$;

create trigger care_plans_snapshot_version
  after update on public.care_plans
  for each row execute function private.snapshot_care_plan_version();

alter table public.care_plan_versions enable row level security;

-- Patient reads their own plan's history same as the live plan; org staff
-- read within their org. No insert/update/delete policy at all — every row
-- is written by the SECURITY DEFINER trigger above, which bypasses RLS as
-- the definer, same as care_plan_review_prompts' own "no insert grant"
-- pattern.
create policy care_plan_versions_select on public.care_plan_versions
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select on public.care_plan_versions to authenticated;
