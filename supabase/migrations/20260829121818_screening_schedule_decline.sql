-- Tarragon Health — Preventive Screening Engine gap closure, 2/4
--
-- A patient declining a recommended screening (spec's "Declined" status,
-- added in 20260829121649_screening_status_declined.sql) needs somewhere to
-- carry WHY, so a care coordinator reviewing patient_care_gaps-style
-- outreach later can see the patient already made an informed choice rather
-- than just silently vanishing off the calendar. declined_at/declined_reason
-- mirror the same "a status change carries proof" convention already used
-- elsewhere (e.g. clinician_alerts_resolution_requires_documentation) — a
-- row can only be 'declined' if both are set, and only ever has them set
-- while 'declined', so the two columns and the status agree by construction
-- rather than by app-layer discipline alone.

alter table public.screening_schedules
  add column if not exists declined_at timestamptz,
  add column if not exists declined_reason text;

alter table public.screening_schedules
  add constraint screening_schedules_declined_requires_reason
  check (
    (status = 'declined') = (
      declined_at is not null
      and declined_reason is not null
      and length(trim(declined_reason)) > 0
    )
  );

comment on column public.screening_schedules.declined_at is
  'Set together with declined_reason the moment status flips to ''declined'' — '
  'never set otherwise (see screening_schedules_declined_requires_reason).';
comment on column public.screening_schedules.declined_reason is
  'Patient-entered reason for declining this screening. Required whenever '
  'status = ''declined'' (see screening_schedules_declined_requires_reason).';

-- Every current schedule-creation path (private.refresh_screening_schedule_
-- on_result, private.refresh_screening_schedule_on_completion, and the risk
-- assessment engine in apps/web/src/app/(dashboard)/patient/actions.ts) only
-- ever inserts a fresh 'pending' row keyed on (patient_id, screen_type_id) —
-- none of them currently check whether the patient already declined that
-- screen type, so without this guard the very next risk-assessment
-- resubmission (or completed result, or reminder-cycle refresh) would
-- silently resurrect a row the patient explicitly turned down. A single
-- BEFORE INSERT trigger enforces the invariant once, for every insert path
-- present today and any added later, rather than teaching each call site
-- (one of which — submitRiskAssessment — is a large, already-tested,
-- onboarding-critical-path server action not worth touching for this) to
-- check it individually. Returning null from a BEFORE INSERT trigger is the
-- standard Postgres way to silently skip inserting that one row — this
-- matches the exception-guarded, best-effort discipline every other
-- screening-calendar trigger in this codebase already follows (a skipped
-- row is not an error condition here, same as
-- generateVaccinationScheduleBestEffort).
--
-- A clinician (or the patient) can still always reactivate by updating the
-- declined row's status directly — screening_schedules_update's RLS already
-- permits that for both the owning patient and org staff — this trigger
-- only ever blocks a brand-new duplicate row, never an update to the
-- existing one.
create or replace function private.block_screening_schedule_after_decline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'pending' and exists (
    select 1 from public.screening_schedules
    where patient_id = new.patient_id
      and screen_type_id = new.screen_type_id
      and status = 'declined'
  ) then
    return null;
  end if;
  return new;
exception
  when others then
    return new;
end;
$function$;

drop trigger if exists screening_schedules_respect_decline on public.screening_schedules;
create trigger screening_schedules_respect_decline
  before insert on public.screening_schedules
  for each row
  execute function private.block_screening_schedule_after_decline();
