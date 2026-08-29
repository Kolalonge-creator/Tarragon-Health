-- Tarragon Health — Vaccination & Immunisation Engine, gap closure 2/3
--
-- Closes a spec §43.3 gap: the status vocabulary (Complete/Due/Overdue/
-- Partially complete/Unknown/Contraindicated/Declined) has no schema support
-- today for the last two — a patient's informed refusal, or a clinician's
-- contraindication finding, currently has nowhere to be recorded and would
-- otherwise keep resurfacing as "due"/"overdue" forever.
--
-- vaccination_schedules (the persisted, reminder-bearing due/overdue
-- projection — 20260716190000) is the right home: recording either reason
-- closes out that row (status -> 'cancelled', reusing the existing
-- screening_status enum rather than widening a value shared with every
-- screening feature) and the reminder cron already skips non-'pending' rows.
--
-- Authorization mirrors the two clinically-different acts:
--   - 'declined' is the patient's own informed choice — settable by the
--     patient themselves or a 'manage'-level caregiver (profile_access),
--     same authority already granted for logging a dose (20260723200847).
--     vaccination_schedules_update never got that widening when
--     vaccination_records did, so this migration closes that gap too.
--   - 'contraindicated' is a clinical judgement — gated on
--     private.is_clinical_tier(), the exact function
--     enforce_vaccination_verification() already uses to keep a Care
--     Coordinator from adjudicating a certificate (20260812023800).
-- Attribution (who/when) is server-derived in the trigger, never trusted
-- from the caller, same pattern as verified_by/verified_at.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'vaccination_non_administration_reason') then
    create type public.vaccination_non_administration_reason as enum ('declined', 'contraindicated');
  end if;
end $$;

alter table public.vaccination_schedules
  add column if not exists non_administration_reason public.vaccination_non_administration_reason,
  add column if not exists non_administration_note text,
  add column if not exists non_administration_recorded_by uuid references public.profiles (id) on delete set null,
  add column if not exists non_administration_recorded_at timestamptz,
  add constraint vaccination_schedules_non_administration_note_length
    check (non_administration_note is null or char_length(non_administration_note) between 1 and 500);

-- ---------------------------------------------------------------------------
-- RLS: extend UPDATE to 'manage'-level caregivers, matching
-- vaccination_records_update exactly (this table's own INSERT stays
-- unwidened — declining/contraindicating only ever targets a row the due/
-- overdue engine has already persisted, so no caregiver insert path is
-- needed here).
-- ---------------------------------------------------------------------------
drop policy if exists vaccination_schedules_update on public.vaccination_schedules;
create policy vaccination_schedules_update on public.vaccination_schedules
  for update to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = vaccination_schedules.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  )
  with check (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = vaccination_schedules.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  );

-- ---------------------------------------------------------------------------
-- Structural guardrail: 'contraindicated' cannot be set by anyone RLS alone
-- would let touch the row (a plain patient, or a Care Coordinator acting as
-- org staff) — only a clinical-tier care-team member. Attribution and the
-- status transition to 'cancelled' are server-derived here, never trusted
-- from the caller.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_vaccination_non_administration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'update' and new.non_administration_reason is not distinct from old.non_administration_reason then
    return new;
  end if;

  if new.non_administration_reason = 'contraindicated' and not private.is_clinical_tier(new.organisation_id) then
    raise exception 'Only a clinical-tier member of the care team can mark a vaccine as contraindicated'
      using errcode = '42501';
  end if;

  if new.non_administration_reason is not null then
    new.non_administration_recorded_by := (select auth.uid());
    new.non_administration_recorded_at := now();
    new.status := 'cancelled';
  else
    new.non_administration_recorded_by := null;
    new.non_administration_recorded_at := null;
    new.non_administration_note := null;
  end if;

  return new;
end;
$$;

drop trigger if exists vaccination_schedules_enforce_non_administration on public.vaccination_schedules;
create trigger vaccination_schedules_enforce_non_administration
  before insert or update on public.vaccination_schedules
  for each row execute function private.enforce_vaccination_non_administration();

do $$
begin
  if not exists (select 1 from pg_type where typname = 'vaccination_non_administration_reason') then
    raise exception 'vaccination_non_administration_reason enum was not created';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vaccination_schedules'
      and column_name in (
        'non_administration_reason', 'non_administration_note',
        'non_administration_recorded_by', 'non_administration_recorded_at'
      )
    having count(*) = 4
  ) then
    raise exception 'vaccination_schedules is missing one or more non-administration columns';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'vaccination_schedules_enforce_non_administration'
      and tgrelid = 'public.vaccination_schedules'::regclass and not tgisinternal
  ) then
    raise exception 'vaccination_schedules_enforce_non_administration trigger was not created';
  end if;
  raise notice 'PASS: vaccination declined/contraindicated status support installed';
end $$;
