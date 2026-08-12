-- Medication dose logs join the acting-for feature: a supporter can log a
-- dose for someone they act for, and see the day's checklist for someone
-- whose record they're allowed to read.
--
-- medication_logs was the one table left out of both 2026-08-01 sweeps
-- (20260801110000/20260801120000 for writes, 20260731181143/20260731185243
-- for reads) — still on its original patient_id-only policy from
-- 20260705211129. That was a real gap: a caregiver who has opened an
-- elderly parent's account to log her blood pressure could not also
-- confirm she'd taken her morning tablets, the single most ordinary errand
-- this whole feature exists for.
--
-- Dose logs are not append-only like vitals/symptoms — the app already does
-- a select-then-upsert against the (medication_id, scheduled_for_date,
-- scheduled_time) row (apps/mobile/src/lib/medications.ts's logDose,
-- mirrored from apps/web/src/lib/queries/medications.ts's useLogDose), and
-- the patient has always been able to correct their own same-day tap. A
-- supporter gets the same narrow correction right and no more: they may
-- update a row only if they are the one who logged it, never a row the
-- patient (or another supporter) wrote. "Someone else's entry" is scoped to
-- logged_by_profile_id here rather than to the whole row, because same-day
-- toggling is a normal UI interaction for this table in a way revising a
-- blood pressure reading never is.

-- 1. Who actually logged it ------------------------------------------------
alter table public.medication_logs
  add column if not exists logged_by_profile_id uuid references public.profiles(id);

comment on column public.medication_logs.logged_by_profile_id is
  'Who marked this dose, when that is not the patient. NULL = the patient themselves. Server-derived from auth.uid() by private.stamp_acting_supporter on both insert and update, never client-supplied. Reverts to NULL the moment the patient touches their own row again.';

-- One trigger covers both insert and update: stamp_acting_supporter's logic
-- (compare the row's patient_id to auth.uid()) is identical either way, and
-- covering update matters here specifically — unlike vitals/symptoms, this
-- table allows a same-day correction, so attribution must be re-derived on
-- every write, not fixed at insert time.
drop trigger if exists stamp_acting_supporter on public.medication_logs;
create trigger stamp_acting_supporter
  before insert or update on public.medication_logs
  for each row execute function private.stamp_acting_supporter('patient_id');

-- 2. Let a supporter write --------------------------------------------------
drop policy if exists medication_logs_insert_acting_supporter on public.medication_logs;
create policy medication_logs_insert_acting_supporter on public.medication_logs
  for insert to authenticated
  with check (private.can_act_for(patient_id));

-- Narrower than this table's platform-default update policy on purpose: a
-- supporter may only update a row THEY logged, never one the patient or a
-- different supporter wrote — same-day correction of your own tap, not
-- revision of someone else's record. The existing medication_logs_update
-- policy (patient_id = auth.uid() or is_org_staff) is untouched, so the
-- patient keeps full rights over every row in their own record regardless
-- of who logged it.
drop policy if exists medication_logs_update_acting_supporter on public.medication_logs;
create policy medication_logs_update_acting_supporter on public.medication_logs
  for update to authenticated
  using (private.can_act_for(patient_id) and logged_by_profile_id = (select auth.uid()))
  with check (private.can_act_for(patient_id) and logged_by_profile_id = (select auth.uid()));

-- Deliberately no delete policy for a supporter — matches every other
-- acting-for table; the existing medication_logs_delete (staff-only) is
-- untouched.

-- 3. Let a supporter read ---------------------------------------------------
-- Full visibility of the day's checklist when the patient has consented,
-- same clause as the other 11 clinical-read tables (screening_schedules,
-- vitals_readings, medications, ...). Without this a supporter could see
-- the active medication list (medications_select already carries
-- can_read_clinical) but never which doses are logged against it, so the
-- checklist would read as permanently empty regardless of what the patient
-- has actually done today — the exact "looks like an empty result, not an
-- error" trap this codebase has hit before.
drop policy if exists medication_logs_select on public.medication_logs;
create policy medication_logs_select on public.medication_logs
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

-- Read-back-what-you-wrote, for the same insert...select()/update...select()
-- RLS trap documented in 20260801121000_supporter_can_read_back_what_they_wrote.sql
-- — supabase-js's .insert(...).select() and .update(...).select() are each
-- checked against the SELECT policy too, and this fires even for a
-- supporter who also holds can_read_clinical consent, because the trap is
-- about the literal select policy being evaluated inline with the write.
drop policy if exists medication_logs_select_own_entry on public.medication_logs;
create policy medication_logs_select_own_entry on public.medication_logs
  for select to authenticated
  using (logged_by_profile_id = (select auth.uid()));

-- 4. Assert ------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'medication_logs'
       and policyname = 'medication_logs_insert_acting_supporter'
  ) then
    raise exception 'a supporter cannot log a dose for the person they support';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'medication_logs'
       and policyname = 'medication_logs_update_acting_supporter'
       and qual::text like '%logged_by_profile_id%'
  ) then
    raise exception 'a supporter must only be able to correct a dose log they themselves wrote';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'medication_logs'
       and cmd = 'DELETE'
       and qual::text like '%can_act_for%'
  ) then
    raise exception 'a supporter must never be able to delete a dose log';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'medication_logs'
       and cmd = 'SELECT'
       and qual::text like '%can_read_clinical%'
  ) then
    raise exception 'a consented supporter must be able to read the days checklist';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'stamp_acting_supporter'
       and tgrelid = 'public.medication_logs'::regclass
       and not tgisinternal
  ) then
    raise exception 'medication_logs is missing its attribution trigger';
  end if;
end $$;
