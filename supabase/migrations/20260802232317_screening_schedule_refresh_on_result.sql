-- Closes a gap flagged (not silently dropped) in the 57ea1be session: recording
-- a screening result never refreshed the patient's screening_schedules
-- calendar. The screening_schedules recommendation engine
-- (computeScreeningRecommendations, called from submitRiskAssessment) has
-- always been tighten-only and re-runnable, but nothing besides a fresh risk
-- assessment ever re-ran it — a Core/Advanced/Comprehensive Screen result
-- (or any clinician-recorded screening_results row) left the calendar
-- exactly as it was, so a just-completed screening kept showing as due and
-- the next cycle's due date was never scheduled.
--
-- Deliberately NOT built by extracting/re-triggering the embedded logic
-- inside submitRiskAssessment (apps/web/src/app/(dashboard)/patient/actions.ts)
-- — that function is large, already-tested, and sits on the onboarding
-- critical path; refactoring it purely to add a second call site was judged
-- too risky. Instead this is a narrow DB trigger reacting to the one place
-- every screening_results row lands regardless of caller (the clinician
-- result form, and any future path — see screening-result-actions.ts's single
-- insert statement, confirmed via grep to be the only current writer).
--
-- Deliberately does NOT re-validate age/sex eligibility against screen_types
-- — a result already exists for this patient+test, so scheduling its own
-- next cycle is correct regardless of whether the catalogue would have
-- *recommended* it fresh (that eligibility question belongs to
-- computeScreeningRecommendations/submitRiskAssessment, not to this narrower
-- "you just did this, here's when it's next due" refresh).
--
-- Known, accepted scope limit: re-recording the same screen_type_code twice
-- in quick succession (e.g. a correction) will close the schedule row this
-- trigger just opened and open another — no dedupe/rate-limit exists, matching
-- this codebase's existing tolerance for the same class of edge case
-- elsewhere (e.g. screening_schedules has no one-active partial unique index
-- the way vaccination_schedules does).

create or replace function private.refresh_screening_schedule_on_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_screen_type_id uuid;
  v_frequency_months int;
begin
  if new.screen_type_code is null then
    return new;
  end if;

  select id, frequency_months
    into v_screen_type_id, v_frequency_months
  from public.screen_types
  where code = new.screen_type_code
    and is_active = true;

  if v_screen_type_id is null then
    return new;
  end if;

  -- Close out whichever active schedule row this result satisfies. Matched
  -- on patient + screen type rather than a screening_schedule_id FK, since
  -- self-bookable Screen-tier orders (Core/Advanced/Comprehensive) are
  -- deliberately booked with no schedule link (see
  -- private.enforce_lab_order_origin's self-bookable branch) — this is the
  -- one path that reconnects such an order back to the calendar.
  update public.screening_schedules
  set status = 'completed'
  where patient_id = new.patient_id
    and screen_type_id = v_screen_type_id
    and status in ('pending', 'booked', 'overdue');

  -- Recurring screenings roll to the next cycle from today (the date of
  -- this result), mirroring computeScreeningRecommendations' own
  -- addMonths(lastCompleted, frequencyMonths) branch. One-off screenings
  -- (frequency_months is null) get no follow-up row, matching that same
  -- function's "lastCompleted, frequencyMonths is null -> continue" branch.
  if v_frequency_months is not null then
    insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, due_date, status)
    values (
      new.organisation_id,
      new.patient_id,
      v_screen_type_id,
      (current_date + (v_frequency_months || ' months')::interval)::date,
      'pending'
    );
  end if;

  return new;
exception
  when others then
    -- Refreshing the calendar must never block recording a clinical
    -- result — same best-effort discipline as every other secondary-effect
    -- trigger/best-effort function in this codebase (e.g.
    -- generateVaccinationScheduleBestEffort).
    return new;
end;
$$;

create trigger screening_results_refresh_schedule
  after insert on public.screening_results
  for each row execute function private.refresh_screening_schedule_on_result();

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'refresh_screening_schedule_on_result'
  ) then
    raise exception 'refresh_screening_schedule_on_result was not created';
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'screening_results_refresh_schedule'
  ) then
    raise exception 'screening_results_refresh_schedule trigger was not created';
  end if;
end $$;
