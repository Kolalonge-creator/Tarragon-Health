-- Tarragon Health
-- Bug fix, caught while writing the client-side insert for data_deletion_
-- requests / data_correction_requests: both attribution triggers force
-- patient_id unconditionally ("new.patient_id := (select auth.uid())") but
-- only soft-default organisation_id via coalesce("new.organisation_id :=
-- coalesce(new.organisation_id, ...)") -- meaning a client-supplied,
-- real-but-wrong organisation_id on INSERT is silently KEPT, not
-- overwritten. Both tables' admin policies are private.is_admin() (a
-- global, non-org-scoped flag, matching regulatory_obligations/
-- vendor_assessments), so this was not an actual cross-org data leak --
-- but it is real attribution spoofing on a compliance-workflow record,
-- inconsistent with the unconditional patient_id treatment right next to
-- it, and inconsistent with every other attribution trigger built this
-- pass. Force it the same way patient_id already is.

create or replace function private.enforce_data_deletion_request_attribution()
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
  'INSERT: forces patient_id/organisation_id/status server-side from the caller''s own profile -- neither is coalesce-soft-defaulted, both are unconditional, so a client-supplied value for either is always discarded. UPDATE: locks a completed request, keeps requester identity immutable, requires admin to move status past pending and stamps reviewed/completed attribution server-side. Corrected 20260830 -- organisation_id was previously coalesce-defaulted (kept if client-supplied), inconsistent with patient_id''s unconditional treatment.';

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
  'INSERT: forces patient_id/organisation_id/status server-side from the caller''s own profile -- neither is coalesce-soft-defaulted, both are unconditional. UPDATE: keeps requester identity immutable, stamps reviewed_by/reviewed_at server-side on any status change off pending. Corrected 20260830 -- organisation_id was previously coalesce-defaulted, inconsistent with patient_id''s unconditional treatment.';

do $$
begin
  if pg_get_functiondef('private.enforce_data_deletion_request_attribution()'::regprocedure) like '%coalesce(%new.organisation_id%' then
    raise exception 'data_deletion_requests attribution trigger still coalesce-defaults organisation_id';
  end if;
  if pg_get_functiondef('private.enforce_data_correction_request_attribution()'::regprocedure) like '%coalesce(%new.organisation_id%' then
    raise exception 'data_correction_requests attribution trigger still coalesce-defaults organisation_id';
  end if;
  raise notice 'PASS: both DSAR-workflow triggers now force organisation_id unconditionally, matching patient_id';
end $$;
