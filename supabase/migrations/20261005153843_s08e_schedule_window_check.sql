-- S08e: a flexible dose window outside 0 to 360 minutes can no longer be stored.
--
-- The app validates a schedule before writing it (packages/medicines parseScheduleSpec refuses a
-- window that is not a whole number from 0 to 360), but a patient can write `schedule_spec` on
-- their own patient-added medicine straight through the API. The database then read a window of
-- 400 as 360 (weekly_adherence clamps it) while the phone refused the whole spec and fell back to
-- the plain daily times, so the patient's and the care team's adherence numbers could differ.
--
-- Fixed where it starts: the row is refused at write time. The database accepts a window that is
-- absent, JSON null (the phone reads it as 0), or a whole number from 0 to 360, exactly what the
-- phone accepts. weekly_adherence keeps its own tolerance as a second line of defence.
--
-- Row counts at writing (live): medications 4, none with a window, so the constraint validates at
-- once and nothing is converted.

alter table public.medications drop constraint if exists medications_schedule_window_valid;
alter table public.medications add constraint medications_schedule_window_valid check (
  schedule_spec is null
  or not (schedule_spec ? 'windowMinutes')
  or case jsonb_typeof(schedule_spec -> 'windowMinutes')
       when 'null' then true
       when 'number' then (schedule_spec ->> 'windowMinutes')::numeric between 0 and 360
                          and (schedule_spec ->> 'windowMinutes')::numeric = trunc((schedule_spec ->> 'windowMinutes')::numeric)
       else false
     end
);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.medications'::regclass
                  and conname = 'medications_schedule_window_valid' and convalidated) then
    raise exception 'the window constraint is missing or not validated';
  end if;
end $$;
