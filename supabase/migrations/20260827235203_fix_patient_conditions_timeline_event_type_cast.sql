-- Fixes 20260827195615_patient_conditions_problem_list.sql: private.
-- record_timeline_event()'s 3rd parameter is public.timeline_event_type
-- (an enum), not text. A bare string literal resolves fine against it (as
-- private.timeline_from_care_plan() already does elsewhere), but a CASE
-- expression whose branches are both unknown-type string literals resolves
-- to `text` per Postgres's CASE type-resolution rules -- and text does not
-- implicitly cast to an enum in a function call, so every INSERT/UPDATE on
-- patient_conditions was raising "function private.record_timeline_event(
-- ..., unknown, ...) does not exist". Fixed with an explicit cast.

create or replace function private.timeline_from_patient_condition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  v_actor := private.timeline_staff_from_profile(
    coalesce(new.diagnosing_clinician_id, new.recorded_by), new.organisation_id
  );

  perform private.record_timeline_event(
    new.organisation_id, new.patient_id,
    (case when tg_op = 'INSERT' then 'condition_recorded' else 'condition_status_changed' end)::public.timeline_event_type,
    'patient_conditions', new.id,
    case when tg_op = 'INSERT' then 'Condition added to your record' else 'Condition status updated' end,
    new.condition_name || ' · ' || replace(new.status::text, '_', ' '),
    coalesce(new.updated_at, new.created_at, now()),
    v_actor
  );
  return new;
end;
$$;

do $$
begin
  if (select pg_get_functiondef(oid) from pg_proc where proname = 'timeline_from_patient_condition' and pronamespace = 'private'::regnamespace)
     not ilike '%::public.timeline_event_type%' then
    raise exception 'FAIL: timeline_from_patient_condition still missing the explicit enum cast';
  end if;
  raise notice 'PASS: timeline_from_patient_condition fixed with explicit enum cast';
end $$;
