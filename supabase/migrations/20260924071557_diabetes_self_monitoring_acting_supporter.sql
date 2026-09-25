-- A supporter acting for a dependent could not log insulin, a foot self-check,
-- or a sick-day note on the dependent's behalf.
--
-- Root cause: apps/web/src/app/(dashboard)/patient/actions.ts's
-- currentPatientOrg() (used by logInsulin/logFootSelfCheck/logSickDay) read
-- auth.uid() directly instead of resolving the acting-for subject the way
-- every sibling widget on the same Vitals & symptoms page already does
-- (VitalsForm, SymptomLogForm, etc. all thread subjectId from
-- getPatientDashboardContext()). That app-layer bug is fixed alongside this
-- migration, but fixing it alone would only trade a silent misattribution for
-- an opaque RLS-denied error: insulin_logs/foot_self_checks/sick_day_logs
-- never got the 2026-08-01 "acting for someone you support"
-- (20260801110000_acting_for_someone_you_support.sql) treatment that
-- vitals_readings/symptoms already have — patient_id = auth.uid() OR
-- is_org_staff only, with no private.can_act_for() carve-out for a
-- 'manage'-grant supporter. This closes that gap for all three tables using
-- the exact same shape as vitals_readings: an additive
-- <table>_insert_acting_supporter policy, plus a logged_by_profile_id column
-- stamped server-side (never client-supplied) so the dependent can always
-- tell their own entry from one their supporter made for them.
--
-- Why this matters clinically, not just architecturally:
-- private.handle_foot_self_check() (20260720130000_diabetes_structured_record.sql)
-- fires a same-day urgent clinician_alerts row straight off
-- foot_self_checks.patient_id/organisation_id. Before this fix, a parent
-- logging a genuine foot problem for a diabetic child (blocked from writing
-- under the child's own patient_id) had no working path at all, so no alert
-- would ever reach the queue for the at-risk patient.
--
-- Deliberately narrow, matching the founder's 2026-08-01 decision: logging a
-- reading is the errand a family member genuinely runs for a dependent. It is
-- not a general write grant — no UPDATE/DELETE policy is added here, same as
-- vitals_readings/symptoms.

alter table public.insulin_logs
  add column if not exists logged_by_profile_id uuid references public.profiles(id);
alter table public.foot_self_checks
  add column if not exists logged_by_profile_id uuid references public.profiles(id);
alter table public.sick_day_logs
  add column if not exists logged_by_profile_id uuid references public.profiles(id);

comment on column public.insulin_logs.logged_by_profile_id is
  'Who physically entered this, when that is not the patient. NULL = the patient themselves. Server-derived from auth.uid() by private.stamp_acting_supporter and NOT client-supplied, so an entry can never be passed off as the patient''s own account of themselves.';
comment on column public.foot_self_checks.logged_by_profile_id is
  'Who physically entered this, when that is not the patient. NULL = the patient themselves. Server-derived from auth.uid() by private.stamp_acting_supporter and NOT client-supplied, so an entry can never be passed off as the patient''s own account of themselves.';
comment on column public.sick_day_logs.logged_by_profile_id is
  'Who physically entered this, when that is not the patient. NULL = the patient themselves. Server-derived from auth.uid() by private.stamp_acting_supporter and NOT client-supplied, so an entry can never be passed off as the patient''s own account of themselves.';

-- Reuses the existing, already-audited private.stamp_acting_supporter()
-- (defined by 20260801110000_acting_for_someone_you_support.sql) rather than
-- three near-duplicate trigger functions.
drop trigger if exists stamp_acting_supporter on public.insulin_logs;
create trigger stamp_acting_supporter
  before insert on public.insulin_logs
  for each row execute function private.stamp_acting_supporter();

drop trigger if exists stamp_acting_supporter on public.foot_self_checks;
create trigger stamp_acting_supporter
  before insert on public.foot_self_checks
  for each row execute function private.stamp_acting_supporter();

drop trigger if exists stamp_acting_supporter on public.sick_day_logs;
create trigger stamp_acting_supporter
  before insert on public.sick_day_logs
  for each row execute function private.stamp_acting_supporter();

drop policy if exists insulin_logs_insert_acting_supporter on public.insulin_logs;
create policy insulin_logs_insert_acting_supporter on public.insulin_logs
  for insert to authenticated
  with check (private.can_act_for(patient_id));

drop policy if exists foot_self_checks_insert_acting_supporter on public.foot_self_checks;
create policy foot_self_checks_insert_acting_supporter on public.foot_self_checks
  for insert to authenticated
  with check (private.can_act_for(patient_id));

drop policy if exists sick_day_logs_insert_acting_supporter on public.sick_day_logs;
create policy sick_day_logs_insert_acting_supporter on public.sick_day_logs
  for insert to authenticated
  with check (private.can_act_for(patient_id));

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='insulin_logs'
                    and policyname='insulin_logs_insert_acting_supporter') then
    raise exception 'a supporter cannot log insulin for the person they support';
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='foot_self_checks'
                    and policyname='foot_self_checks_insert_acting_supporter') then
    raise exception 'a supporter cannot log a foot self-check for the person they support';
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='sick_day_logs'
                    and policyname='sick_day_logs_insert_acting_supporter') then
    raise exception 'a supporter cannot log a sick-day note for the person they support';
  end if;
  -- Same guarantee as vitals_readings/symptoms: no path lets a supporter
  -- revise or delete an entry once recorded, for any of the three tables.
  if exists (select 1 from pg_policies
              where schemaname='public'
                and tablename in ('insulin_logs','foot_self_checks','sick_day_logs')
                and cmd in ('UPDATE','DELETE')
                and qual::text like '%can_act_for%') then
    raise exception 'a supporter must never be able to revise or delete a diabetes self-monitoring entry';
  end if;
end $$;
