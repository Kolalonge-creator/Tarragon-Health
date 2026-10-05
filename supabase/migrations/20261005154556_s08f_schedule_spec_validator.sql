-- S08f: the database refuses any schedule the phone would refuse (closes OQ-77).
--
-- `medications.schedule_spec` is JSON a patient can write on their own patient-added medicine
-- straight through the API. The app validates it before writing (packages/medicines
-- parseScheduleSpec), but the database only checked the kind (S08) and the window (S08e). A
-- malformed times list, a non-numeric interval, empty weekdays, a bad taper step or a window as
-- long as the gap to the next dose could still be stored. The server then expanded no slots (or
-- different ones) while the phone refused the spec and fell back to plain daily times, so the
-- patient's and the care team's numbers could differ.
--
-- private.is_valid_schedule_spec(jsonb) mirrors parseScheduleSpec rule by rule and never raises:
-- it returns false for anything it cannot read, so a bad row is refused with a check violation
-- instead of an error from a cast. It is IMMUTABLE (pure JSON in, boolean out).
--
-- Known, deliberate differences from the phone (the database is the stricter side, never looser):
--   * a date before year 0001 is refused (the phone's date parser accepts year 0000);
--   * a doseText longer than 80 is counted in characters, the phone counts UTF-16 units, so a
--     string of emoji can be refused here a little before the phone would refuse it.
-- Everything else, including the exact accepted number forms (1.0 and 1e2 are whole numbers),
-- matches; the shared cases are proved in packages/db/tests/s08_medicines_schedule_adherence_refill.sql
-- and in packages/medicines/src/schedule.fixtures.ts.
--
-- Row counts at writing (live): medications 4, none with a schedule_spec, so the constraint
-- validates at once and nothing is converted. medications_schedule_window_valid (S08e) stays as a
-- narrower second line of defence.

create or replace function private.schedule_date_ok(p_value text)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  return p_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and to_char(p_value::date, 'YYYY-MM-DD') = p_value;
exception when others then
  return false;
end;
$$;

create or replace function private.schedule_int_ok(p_value jsonb, p_min numeric, p_max numeric)
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_value) = 'number'
              then (p_value #>> '{}')::numeric between p_min and p_max
                   and (p_value #>> '{}')::numeric = trunc((p_value #>> '{}')::numeric)
              else false end;
$$;

-- 1 to 12 entries, each an "HH:MM" string.
create or replace function private.schedule_times_ok(p_times jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_times) = 'array' and jsonb_array_length(p_times) between 1 and 12
              then not exists (
                select 1 from jsonb_array_elements(p_times) e
                 where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
              else false end;
$$;

-- The smallest gap in minutes between consecutive dose times, counting the wrap to tomorrow's first.
-- 1440 for a single time. Only called with a list private.schedule_times_ok accepted.
create or replace function private.schedule_min_gap(p_times jsonb)
returns integer language sql immutable set search_path = '' as $$
  select min(gap)::integer from (
    select coalesce(lead(m) over (order by m), first_value(m) over (order by m) + 1440) - m as gap
      from (select distinct (substr(e, 1, 2)::integer * 60 + substr(e, 4, 2)::integer) as m
              from jsonb_array_elements_text(p_times) e) t
  ) g;
$$;

create or replace function private.is_valid_schedule_spec(p_spec jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_kind   text;
  v_start  text;
  v_end    text;
  v_window numeric := 0;
  v_lists  jsonb[] := '{}';
  v_step   jsonb;
  v_text   text;
begin
  if p_spec is null then return true; end if;
  if jsonb_typeof(p_spec) <> 'object' then return false; end if;

  if p_spec ? 'startDate' and jsonb_typeof(p_spec -> 'startDate') <> 'null' then
    if jsonb_typeof(p_spec -> 'startDate') <> 'string' or not private.schedule_date_ok(p_spec ->> 'startDate') then return false; end if;
    v_start := p_spec ->> 'startDate';
  end if;
  if p_spec ? 'endDate' and jsonb_typeof(p_spec -> 'endDate') <> 'null' then
    if jsonb_typeof(p_spec -> 'endDate') <> 'string' or not private.schedule_date_ok(p_spec ->> 'endDate') then return false; end if;
    v_end := p_spec ->> 'endDate';
  end if;
  if v_start is not null and v_end is not null and v_end < v_start then return false; end if;

  if p_spec ? 'foodNote' and jsonb_typeof(p_spec -> 'foodNote') <> 'null' then
    if jsonb_typeof(p_spec -> 'foodNote') <> 'string'
       or (p_spec ->> 'foodNote') not in ('with_food', 'before_food', 'after_food', 'empty_stomach', 'bedtime') then
      return false;
    end if;
  end if;

  if p_spec ? 'windowMinutes' and jsonb_typeof(p_spec -> 'windowMinutes') <> 'null' then
    if not private.schedule_int_ok(p_spec -> 'windowMinutes', 0, 360) then return false; end if;
    v_window := (p_spec ->> 'windowMinutes')::numeric;
  end if;

  v_kind := case when jsonb_typeof(p_spec -> 'kind') = 'string' then p_spec ->> 'kind' end;
  if v_kind = 'daily' then
    if not private.schedule_times_ok(p_spec -> 'times') then return false; end if;
    v_lists := array[p_spec -> 'times'];
  elsif v_kind = 'every_n_days' then
    if not private.schedule_int_ok(p_spec -> 'intervalDays', 2, 90) then return false; end if;
    if jsonb_typeof(p_spec -> 'anchorDate') is distinct from 'string' or not private.schedule_date_ok(p_spec ->> 'anchorDate') then return false; end if;
    if not private.schedule_times_ok(p_spec -> 'times') then return false; end if;
    v_lists := array[p_spec -> 'times'];
  elsif v_kind = 'weekdays' then
    if jsonb_typeof(p_spec -> 'days') is distinct from 'array' or jsonb_array_length(p_spec -> 'days') = 0 then return false; end if;
    if exists (select 1 from jsonb_array_elements(p_spec -> 'days') d where not private.schedule_int_ok(d, 0, 6)) then return false; end if;
    if not private.schedule_times_ok(p_spec -> 'times') then return false; end if;
    v_lists := array[p_spec -> 'times'];
  elsif v_kind = 'taper' then
    if v_start is null then return false; end if;
    if jsonb_typeof(p_spec -> 'steps') is distinct from 'array' or jsonb_array_length(p_spec -> 'steps') not between 1 and 24 then return false; end if;
    for v_step in select * from jsonb_array_elements(p_spec -> 'steps') loop
      if jsonb_typeof(v_step) <> 'object' then return false; end if;
      if not private.schedule_int_ok(v_step -> 'days', 1, 366) then return false; end if;
      if not private.schedule_times_ok(v_step -> 'times') then return false; end if;
      if jsonb_typeof(v_step -> 'doseText') is distinct from 'string' then return false; end if;
      v_text := btrim(v_step ->> 'doseText', E' \t\n\r\f\v');
      if char_length(v_text) not between 1 and 80 then return false; end if;
      v_lists := v_lists || (v_step -> 'times');
    end loop;
  elsif v_kind = 'as_needed' then
    if p_spec ? 'maxPerDay' and jsonb_typeof(p_spec -> 'maxPerDay') <> 'null'
       and not private.schedule_int_ok(p_spec -> 'maxPerDay', 1, 24) then
      return false;
    end if;
  else
    return false;
  end if;

  -- A window must close before the next dose time: two overlapping windows leave a dose "due"
  -- after the next one has started.
  if v_window > 0 and exists (select 1 from unnest(v_lists) l where private.schedule_min_gap(l) <= v_window) then
    return false;
  end if;
  return true;
exception when others then
  return false;
end;
$$;

revoke all on function private.schedule_date_ok(text) from public, anon;
revoke all on function private.schedule_int_ok(jsonb, numeric, numeric) from public, anon;
revoke all on function private.schedule_times_ok(jsonb) from public, anon;
revoke all on function private.schedule_min_gap(jsonb) from public, anon;
revoke all on function private.is_valid_schedule_spec(jsonb) from public, anon;
-- A check constraint runs as the writing role, so the roles that write medications need execute.
grant execute on function private.schedule_date_ok(text) to authenticated, service_role;
grant execute on function private.schedule_int_ok(jsonb, numeric, numeric) to authenticated, service_role;
grant execute on function private.schedule_times_ok(jsonb) to authenticated, service_role;
grant execute on function private.schedule_min_gap(jsonb) to authenticated, service_role;
grant execute on function private.is_valid_schedule_spec(jsonb) to authenticated, service_role;

alter table public.medications drop constraint if exists medications_schedule_spec_valid;
alter table public.medications add constraint medications_schedule_spec_valid
  check (private.is_valid_schedule_spec(schedule_spec));

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.medications'::regclass
                  and conname = 'medications_schedule_spec_valid' and convalidated) then
    raise exception 'the schedule validator constraint is missing or not validated';
  end if;
  if has_function_privilege('anon', 'private.is_valid_schedule_spec(jsonb)', 'EXECUTE') then
    raise exception 'anon can execute the schedule validator';
  end if;
end $$;
