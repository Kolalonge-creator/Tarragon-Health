-- Tarragon Health
-- Gap found while building the admin DSAR review console (2026-09-18 audit,
-- apps/web/src/app/(dashboard)/admin/data-rights/): unlike its two siblings
-- (private.enforce_data_deletion_request_attribution raises on
-- old.status = 'completed', private.enforce_data_export_request_attribution
-- raises on old.status = 'fulfilled' -- both 20260830002055), the
-- correction-requests attribution trigger never locked a request once it
-- reached its own terminal status ('applied'). This was harmless while
-- nothing in the app ever drove a request that far -- the new admin queue
-- is the first real caller that can, so the gap is now practically
-- reachable: any private.is_org_staff() account could keep rewriting
-- resolution_note/decision_note/status on an already-applied correction
-- request after the fact, undermining the exact audit trail this workflow
-- exists to produce. Close it the same way the siblings already are.

create or replace function private.enforce_data_correction_request_attribution()
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
    return new;
  end if;

  if old.status = 'applied' then
    raise exception 'This correction request is already applied and cannot be edited further.'
      using errcode = '42501';
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
  'INSERT: forces patient_id/organisation_id/status server-side from the caller''s own profile -- neither is coalesce-soft-defaulted, both are unconditional. UPDATE: locks an applied request (added 2026-09-18, matching the deletion/export siblings'' completed/fulfilled lock -- the admin review console built the same day was the first real caller that could reach this state), keeps requester identity immutable, stamps reviewed_by/reviewed_at server-side on any status change off pending. Corrected 20260830 -- organisation_id was previously coalesce-defaulted, inconsistent with patient_id''s unconditional treatment.';

do $$
begin
  if pg_get_functiondef('private.enforce_data_correction_request_attribution()'::regprocedure)
     not like '%applied%cannot be edited further%'
  then
    raise exception 'data_correction_requests attribution trigger still has no lock on an applied request';
  end if;
  raise notice 'PASS: data_correction_requests now locks against further edits once applied, matching its siblings';
end $$;
