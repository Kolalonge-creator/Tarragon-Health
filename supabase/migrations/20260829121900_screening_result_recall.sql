-- Tarragon Health — Preventive Screening Engine gap closure, 3/4
--
-- Screening recall (spec: "Screening completed -> Result requires repeat ->
-- Recall created -> Patient reminded -> Follow-up completed").
--
-- private.refresh_screening_schedule_on_result() (20260802232211, since
-- extended to respect an active chronic-care-plan's own cadence) already
-- closes the current schedule row and opens the next one the moment a
-- screening_results row lands — but it only ever uses screen_types.
-- frequency_months (or the pathway-tightened interval), never anything
-- about THIS particular result. A borderline/inconclusive finding that
-- needs an earlier repeat than the routine cadence — the textbook "recall"
-- case, distinct from an abnormal/critical result, which already escalates
-- to a doctor via the existing handle_abnormal_screening_result trigger —
-- has no way to shorten that next cycle today.
--
-- recall_months is clinician-set, not part of the initial result insert:
-- the clinician doesn't know a result needs a recall until they've seen the
-- ML interpretation, which is exactly why setScreeningResultFollowUpAction
-- already exists as a deliberate second step (see that function's own
-- comment). This migration lets that same second step optionally also set
-- recall_months, and a new AFTER UPDATE trigger reacts to it.
alter table public.screening_results
  add column if not exists recall_months integer;

alter table public.screening_results
  add constraint screening_results_recall_months_range
  check (recall_months is null or recall_months between 1 and 60);

comment on column public.screening_results.recall_months is
  'Clinician-set recall interval (months) when this result needs an earlier '
  'repeat than the screen type''s routine cadence — set via '
  'setScreeningResultFollowUpAction alongside follow_up_action, never at '
  'initial result insert. See private.apply_screening_result_recall().';

alter table public.screening_schedules
  add column if not exists is_recall boolean not null default false,
  add column if not exists recall_reason text;

comment on column public.screening_schedules.is_recall is
  'True when this row exists because a result required an earlier repeat '
  '(private.apply_screening_result_recall), not because of the screen '
  'type''s routine cadence.';
comment on column public.screening_schedules.recall_reason is
  'Carried over from the triggering screening_results.follow_up_action — '
  'why the patient is being asked to repeat this test. Only set on a row '
  'where is_recall is true.';

create or replace function private.apply_screening_result_recall()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_screen_type_id uuid;
  v_schedule_id uuid;
  v_recall_due date;
begin
  if new.screen_type_code is null then
    return new;
  end if;

  select id into v_screen_type_id
  from public.screen_types
  where code = new.screen_type_code and is_active = true;

  if v_screen_type_id is null then
    return new;
  end if;

  v_recall_due := (current_date + (new.recall_months || ' months')::interval)::date;

  -- The insert-time refresh trigger already opened the patient's next-cycle
  -- 'pending' row for this screen type when the result was recorded; a
  -- recall tightens THAT row rather than opening a second one, and only
  -- ever pulls its due date earlier, never later, so a routine cadence that
  -- happens to already be shorter than the recall interval is never pushed
  -- out.
  select id into v_schedule_id
  from public.screening_schedules
  where patient_id = new.patient_id
    and screen_type_id = v_screen_type_id
    and status = 'pending'
  order by created_at desc
  limit 1;

  if v_schedule_id is not null then
    update public.screening_schedules
    set due_date = least(due_date, v_recall_due),
        is_recall = true,
        recall_reason = new.follow_up_action
    where id = v_schedule_id;
  else
    -- A one-off screen type (no routine cadence) or a patient with no prior
    -- schedule row for it — the recall itself is the only reason a next
    -- cycle should exist at all.
    insert into public.screening_schedules
      (organisation_id, patient_id, screen_type_id, due_date, status, is_recall, recall_reason)
    values
      (new.organisation_id, new.patient_id, v_screen_type_id, v_recall_due, 'pending', true, new.follow_up_action);
  end if;

  return new;
exception
  when others then
    return new;
end;
$function$;

drop trigger if exists screening_results_recall_refresh on public.screening_results;
create trigger screening_results_recall_refresh
  after update of recall_months on public.screening_results
  for each row
  when (new.recall_months is not null and new.recall_months is distinct from old.recall_months)
  execute function private.apply_screening_result_recall();
