-- S08z: dose times anchored to the events a day is built around (waking, meals, the daily prayers, bedtime).
--
-- A patient can tie a dose to an anchor ("with dinner", "30 minutes after the morning prayer") instead of a clock time.
-- Nothing is computed from location or a calendar: the patient says what time each anchor they use is, and a "my day has
-- shifted" entry moves chosen anchors by chosen minutes for a run of dates (a month of fasting, travel) and then simply stops
-- applying. The schedule keeps its spec; only the resolved Lagos clock times change. An anchor is a scheduling convenience the
-- patient picks, never advice about when to take a dose. It is available on patient-added medicines (a prescribed schedule is
-- still fixed by the care team: the existing column allow-list already refuses a patient edit of schedule_spec on those).
--
-- What this adds
--   * public.dose_anchor_defaults       the PROPOSED starting time for each anchor (mirrors medicines.dose_anchors in the
--                                       versioned configuration; a Jest mirror test fails on drift). A patient-set time always wins.
--   * public.patient_dose_anchors       the times a patient chose, VERSIONED BY DATE: a change applies from its own date, so a day
--                                       already lived (and the doses logged on it) never moves.
--   * public.patient_day_shifts         "my day has shifted" entries. Ending one early records cancelled_from; earlier dates keep
--                                       their shifted times for the same reason.
--   * private.medication_slots_on(spec, times, date, patient)   the one SQL expansion, now resolving anchored doses; the old
--                                       3-argument form stays as a wrapper (no patient: proposed defaults only). Resolution lets a
--                                       dose that crosses midnight land on the neighbouring Lagos date, exactly as packages/medicines
--                                       does (the cases in anchors.fixtures.ts are carried in packages/db/tests/s08z_dose_anchors.sql).
--   * The four functions that expand slots (the server missed-dose job, the weekly adherence figure, the refill estimate and the
--     dose reminder queue) are rewritten FROM THEIR LIVE DEFINITIONS to pass the patient, so every one of them reads the same
--     resolved times. The rewrite aborts the migration loudly if the expected call text is not found.
--   * private.is_valid_schedule_spec  accepts `anchored` (daily, every-N-days, weekdays only), with no clock times when anchored
--                                       doses exist; mirrors parseScheduleSpec without a profile. The profile-dependent window
--                                       check (two anchored doses closer than the window) is enforced by triggers on medications and
--                                       on patient_dose_anchors (checked on the FINAL state of a save), so no write path leaves windows
--                                       overlapping at the person's normal times. A day shift is NOT checked against windows: during a
--                                       shift two anchors may sit closer than a window, which only makes a dose read "due" a little longer
--                                       (recorded in docs/design/S08z.md).
--   * Three RPCs, the only write path: save_dose_anchor_times, create_day_shift, cancel_day_shift. Each takes the patient (self or
--     an acting guardian), is idempotent where a retry is possible, and moves an effective date to TOMORROW when today already
--     has logged doses on an affected anchor, so resolution of a day with answers never changes. A change made on a phone that
--     was offline and sent up to 3 days late is accepted from the date it was made ONLY when no dose on an affected anchor has
--     been logged since; otherwise it starts today (never rewriting a day that has answers).
--   * Anchor times and shifts are readable by the person and an acting guardian ONLY. Which prayers a person ties a medicine to
--     discloses religious belief (special-category data), so tied clinicians and caregivers do not read these tables; they see the
--     resolved dose times through the ordinary medicine records. The care team's view of a shifted day is an open question
--     (OQ-S08z-2, OQ-S08z-5).
--
-- Row counts at writing (live): medications with a schedule_spec: 0 anchored (the field is new). Nothing is converted.
-- Safe to apply: additive tables, one function replaced in place, four rewritten from their live definitions with exact-match
-- anchors that abort the migration if they do not match. amend_medication already carries schedule_spec (20261013185145).

-- 1. The anchors --------------------------------------------------------------------------------------------------
create or replace function private.dose_anchor_ids()
returns text[] language sql immutable set search_path = '' as $$
  select array['waking', 'morning_prayer', 'breakfast', 'midday_prayer', 'lunch', 'afternoon_prayer',
               'evening_prayer', 'dinner', 'night_prayer', 'bedtime'];
$$;

create table if not exists public.dose_anchor_defaults (
  anchor       text primary key check (anchor in ('waking', 'morning_prayer', 'breakfast', 'midday_prayer', 'lunch',
                                                  'afternoon_prayer', 'evening_prayer', 'dinner', 'night_prayer', 'bedtime')),
  default_time text not null check (default_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
insert into public.dose_anchor_defaults (anchor, default_time) values
  ('waking', '06:30'), ('morning_prayer', '05:45'), ('breakfast', '07:30'), ('midday_prayer', '13:15'), ('lunch', '13:30'),
  ('afternoon_prayer', '16:30'), ('evening_prayer', '19:00'), ('dinner', '20:00'), ('night_prayer', '20:15'), ('bedtime', '22:30')
on conflict (anchor) do nothing;
alter table public.dose_anchor_defaults enable row level security;
drop policy if exists dose_anchor_defaults_read on public.dose_anchor_defaults;
create policy dose_anchor_defaults_read on public.dose_anchor_defaults for select to authenticated using (true);
revoke all on public.dose_anchor_defaults from public, anon, authenticated;
grant select on public.dose_anchor_defaults to authenticated;

create table if not exists public.patient_dose_anchors (
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  anchor          text not null check (anchor in ('waking', 'morning_prayer', 'breakfast', 'midday_prayer', 'lunch',
                                                  'afternoon_prayer', 'evening_prayer', 'dinner', 'night_prayer', 'bedtime')),
  effective_from  date not null,
  local_time      text not null check (local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  organisation_id uuid not null references public.organisations (id),
  created_at      timestamptz not null default now(),
  primary key (patient_id, anchor, effective_from)
);
create index if not exists patient_dose_anchors_org_idx on public.patient_dose_anchors (organisation_id);

create table if not exists public.patient_day_shifts (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id),
  client_id       uuid,
  starts_on       date not null,
  ends_on         date not null,
  offsets         jsonb not null,
  cancelled_from  date,
  created_at      timestamptz not null default now(),
  constraint patient_day_shifts_range check (ends_on >= starts_on and ends_on - starts_on + 1 <= 45),
  constraint patient_day_shifts_offsets_shape check (jsonb_typeof(offsets) = 'object' and offsets <> '{}'::jsonb)
);
create unique index if not exists patient_day_shifts_client_uidx on public.patient_day_shifts (patient_id, client_id) where client_id is not null;
create index if not exists patient_day_shifts_patient_idx on public.patient_day_shifts (patient_id, starts_on);
create index if not exists patient_day_shifts_org_idx on public.patient_day_shifts (organisation_id);

create or replace function private.day_shift_offsets_ok(p_offsets jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if p_offsets is null or jsonb_typeof(p_offsets) <> 'object' or p_offsets = '{}'::jsonb then return false; end if;
  return not exists (
    select 1 from jsonb_each(p_offsets) e
     where e.key <> all (array['waking', 'morning_prayer', 'breakfast', 'midday_prayer', 'lunch', 'afternoon_prayer',
                               'evening_prayer', 'dinner', 'night_prayer', 'bedtime'])
        or not private.schedule_int_ok(e.value, -360, 360));
exception when others then
  return false;
end;
$$;

-- Who a row belongs to always comes from the profile, never the client; a shift's offsets are checked here, and only
-- cancelled_from may change afterwards.
create or replace function private.day_shift_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select organisation_id into new.organisation_id from public.profiles where id = new.patient_id;
    if new.organisation_id is null then raise exception 'patient has no organisation' using errcode = '23503'; end if;
    if not private.day_shift_offsets_ok(new.offsets) then
      raise exception 'day shift offsets are not valid' using errcode = '23514';
    end if;
  else
    if new.patient_id is distinct from old.patient_id or new.starts_on is distinct from old.starts_on
       or new.ends_on is distinct from old.ends_on or new.offsets is distinct from old.offsets
       or new.client_id is distinct from old.client_id or new.organisation_id is distinct from old.organisation_id then
      raise exception 'a day shift cannot be edited, only ended' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists day_shift_guard on public.patient_day_shifts;
create trigger day_shift_guard before insert or update on public.patient_day_shifts
  for each row execute function private.day_shift_guard();

alter table public.patient_dose_anchors enable row level security;
alter table public.patient_day_shifts enable row level security;
drop policy if exists patient_dose_anchors_select on public.patient_dose_anchors;
create policy patient_dose_anchors_select on public.patient_dose_anchors for select to authenticated using (
  patient_id = (select auth.uid()) or private.can_act_for(patient_id)
);
drop policy if exists patient_day_shifts_select on public.patient_day_shifts;
create policy patient_day_shifts_select on public.patient_day_shifts for select to authenticated using (
  patient_id = (select auth.uid()) or private.can_act_for(patient_id)
);
-- No insert, update or delete policy: the three RPCs below are the only write path.
revoke all on public.patient_dose_anchors, public.patient_day_shifts from public, anon, authenticated;
grant select on public.patient_dose_anchors, public.patient_day_shifts to authenticated;

-- 2. Resolution helpers --------------------------------------------------------------------------------------------
-- The anchor's time in minutes on a date: the latest time the patient chose that had taken effect by then, else the proposed default.
create or replace function private.dose_anchor_minutes(p_patient uuid, p_anchor text, p_date date)
returns integer language sql stable security definer set search_path = '' as $$
  select (substr(t, 1, 2)::integer * 60 + substr(t, 4, 2)::integer)
    from (select coalesce(
                   (select a.local_time from public.patient_dose_anchors a
                     where a.patient_id = p_patient and a.anchor = p_anchor and a.effective_from <= p_date
                     order by a.effective_from desc limit 1),
                   (select d.default_time from public.dose_anchor_defaults d where d.anchor = p_anchor)) as t) q;
$$;

-- The latest chosen time of all, whatever its date (the schedule's normal look): what the window check compares.
create or replace function private.dose_anchor_latest_minutes(p_patient uuid, p_anchor text)
returns integer language sql stable security definer set search_path = '' as $$
  select (substr(t, 1, 2)::integer * 60 + substr(t, 4, 2)::integer)
    from (select coalesce(
                   (select a.local_time from public.patient_dose_anchors a
                     where a.patient_id = p_patient and a.anchor = p_anchor order by a.effective_from desc limit 1),
                   (select d.default_time from public.dose_anchor_defaults d where d.anchor = p_anchor)) as t) q;
$$;

-- How far the newest shift that names this anchor and covers the date moves it (minutes), 0 when none.
create or replace function private.dose_anchor_shift(p_patient uuid, p_anchor text, p_date date)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select (s.offsets ->> p_anchor)::integer
       from public.patient_day_shifts s
      where s.patient_id = p_patient and p_date between s.starts_on and s.ends_on
        and (s.cancelled_from is null or p_date < s.cancelled_from)
        and s.offsets ? p_anchor
      order by s.created_at desc, s.id desc limit 1), 0);
$$;

-- The smallest gap between consecutive minute-of-day values, counting the wrap to tomorrow. 1440 for fewer than two.
create or replace function private.min_gap_of_minutes(p_minutes integer[])
returns integer language sql immutable set search_path = '' as $$
  select coalesce(min(gap), 1440)::integer
    from (select coalesce(lead(m) over (order by m), first_value(m) over (order by m) + 1440) - m as gap
            from (select distinct x as m from unnest(p_minutes) x) d) g
   where (select count(distinct x) from unnest(p_minutes) x) >= 2;
$$;

-- The minute-of-day of every dose of a daily-shaped spec at its normal look (clock times plus anchored doses at the latest chosen
-- anchor time, with one anchor optionally overridden to a proposed new time).
create or replace function private.spec_normal_minutes(p_spec jsonb, p_patient uuid, p_override_anchor text default null, p_override_time text default null)
returns integer[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(m), '{}') from (
    select (substr(t, 1, 2)::integer * 60 + substr(t, 4, 2)::integer) as m
      from jsonb_array_elements_text(case when jsonb_typeof(p_spec -> 'times') = 'array' then p_spec -> 'times' else '[]'::jsonb end) t
    union all
    select ((coalesce(case when a ->> 'anchor' = p_override_anchor and p_override_time is not null
                           then substr(p_override_time, 1, 2)::integer * 60 + substr(p_override_time, 4, 2)::integer end,
                      private.dose_anchor_latest_minutes(p_patient, a ->> 'anchor'))
             + (a ->> 'offsetMinutes')::integer) % 1440 + 1440) % 1440
      from jsonb_array_elements(case when jsonb_typeof(p_spec -> 'anchored') = 'array' then p_spec -> 'anchored' else '[]'::jsonb end) a
  ) q;
$$;

-- 3. The one SQL expansion ------------------------------------------------------------------------------------------
-- The 4-argument form resolves anchored doses for a patient. An anchored dose belongs to the SCHEDULE day it was resolved from, so
-- one that crosses midnight lands on the neighbouring date: this looks at the day before, the day itself and the day after and
-- keeps what resolves onto p_date. With no patient only the proposed defaults apply (the 3-argument wrapper below).
create or replace function private.medication_slots_on(p_spec jsonb, p_times jsonb, p_date date, p_patient uuid)
returns table (slot_time text, dose_text text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_kind  text;
  v_times jsonb := '[]'::jsonb;
  v_dose  text;
  v_start date;
  v_end   date;
  v_n     integer;
  v_off   integer;
  v_step  jsonb;
  v_ans   jsonb;
  v_a     jsonb;
  v_d     date;
  v_occ   boolean;
  v_total integer;
  v_min   integer;
begin
  if p_spec is null then
    v_kind := 'daily';
    v_times := coalesce(p_times, '[]'::jsonb);
  else
    v_kind := p_spec ->> 'kind';
    v_start := nullif(p_spec ->> 'startDate', '')::date;
    v_end := nullif(p_spec ->> 'endDate', '')::date;
    if not ((v_start is not null and p_date < v_start) or (v_end is not null and p_date > v_end)) then
      if v_kind = 'daily' then
        v_times := coalesce(p_spec -> 'times', '[]'::jsonb);
      elsif v_kind = 'every_n_days' then
        v_n := (p_spec ->> 'intervalDays')::integer;
        v_off := p_date - (p_spec ->> 'anchorDate')::date;
        if v_n >= 2 and v_off >= 0 and v_off % v_n = 0 then
          v_times := coalesce(p_spec -> 'times', '[]'::jsonb);
        end if;
      elsif v_kind = 'weekdays' then
        if exists (select 1 from jsonb_array_elements_text(coalesce(p_spec -> 'days', '[]'::jsonb)) d
                    where d::integer = extract(dow from p_date)::integer) then
          v_times := coalesce(p_spec -> 'times', '[]'::jsonb);
        end if;
      elsif v_kind = 'taper' then
        if v_start is not null then
          v_off := p_date - v_start;
          for v_step in select * from jsonb_array_elements(coalesce(p_spec -> 'steps', '[]'::jsonb)) loop
            if v_off >= 0 and v_off < (v_step ->> 'days')::integer then
              v_times := coalesce(v_step -> 'times', '[]'::jsonb);
              v_dose := v_step ->> 'doseText';
              exit;
            end if;
            v_off := v_off - (v_step ->> 'days')::integer;
          end loop;
        end if;
      end if;
    end if;

    v_ans := case when jsonb_typeof(p_spec -> 'anchored') = 'array' then p_spec -> 'anchored' else '[]'::jsonb end;
    if jsonb_array_length(v_ans) > 0 and v_kind in ('daily', 'every_n_days', 'weekdays') then
      for v_d in select p_date + g from generate_series(-1, 1) g loop
        if (v_start is not null and v_d < v_start) or (v_end is not null and v_d > v_end) then continue; end if;
        v_occ := case v_kind
                   when 'daily' then true
                   when 'every_n_days' then (v_d - (p_spec ->> 'anchorDate')::date) >= 0
                                            and (v_d - (p_spec ->> 'anchorDate')::date) % (p_spec ->> 'intervalDays')::integer = 0
                   else exists (select 1 from jsonb_array_elements_text(coalesce(p_spec -> 'days', '[]'::jsonb)) dd
                                 where dd::integer = extract(dow from v_d)::integer)
                 end;
        if not v_occ then continue; end if;
        for v_a in select * from jsonb_array_elements(v_ans) loop
          v_total := private.dose_anchor_minutes(p_patient, v_a ->> 'anchor', v_d)
                     + private.dose_anchor_shift(p_patient, v_a ->> 'anchor', v_d)
                     + (v_a ->> 'offsetMinutes')::integer;
          if v_d + floor(v_total / 1440.0)::integer = p_date then
            v_min := ((v_total % 1440) + 1440) % 1440;
            v_times := v_times || to_jsonb(lpad((v_min / 60)::text, 2, '0') || ':' || lpad((v_min % 60)::text, 2, '0'));
          end if;
        end loop;
      end loop;
    end if;
  end if;

  return query
    select t, v_dose
      from (select distinct x as t from jsonb_array_elements_text(v_times) x) q
     where t ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     order by t;
exception when others then
  -- A malformed spec has no slots; it must never break a cron run for every other patient.
  raise warning 'medication_slots_on: malformed schedule ignored (%)', sqlerrm;
  return;
end;
$$;

-- The 3-argument form is kept for callers with no patient in hand: proposed defaults only.
create or replace function private.medication_slots_on(p_spec jsonb, p_times jsonb, p_date date)
returns table (slot_time text, dose_text text)
language sql stable security definer set search_path = '' as $$
  select * from private.medication_slots_on(p_spec, p_times, p_date, null::uuid);
$$;
revoke all on function private.medication_slots_on(jsonb, jsonb, date, uuid) from public, anon, authenticated;
revoke all on function private.medication_slots_on(jsonb, jsonb, date) from public, anon, authenticated;
revoke all on function private.dose_anchor_minutes(uuid, text, date) from public, anon, authenticated;
revoke all on function private.dose_anchor_latest_minutes(uuid, text) from public, anon, authenticated;
revoke all on function private.dose_anchor_shift(uuid, text, date) from public, anon, authenticated;
revoke all on function private.spec_normal_minutes(jsonb, uuid, text, text) from public, anon, authenticated;
revoke all on function private.min_gap_of_minutes(integer[]) from public, anon, authenticated;
revoke all on function private.dose_anchor_ids() from public, anon, authenticated;
revoke all on function private.day_shift_offsets_ok(jsonb) from public, anon, authenticated;
revoke all on function private.day_shift_guard() from public, anon, authenticated;

-- 4. The four expansions read the patient's anchors -----------------------------------------------------------------
-- Rewritten from their LIVE definitions, not from an older copy of the text: each must contain exactly one call to the 3-argument
-- form on the medications alias `m`, and the migration aborts if it does not.
do $$
declare
  v_fn   text;
  v_oid  oid;
  v_def  text;
  v_new  text;
  v_cnt  integer;
begin
  foreach v_fn in array array[
    'private.queue_medication_dose_reminders()',
    'private.medication_supply_status(uuid,timestamp with time zone)',
    'private.mark_overdue_doses_missed(timestamp with time zone)',
    'private.weekly_adherence(uuid,timestamp with time zone)'
  ] loop
    v_oid := v_fn::regprocedure::oid;
    v_def := pg_get_functiondef(v_oid);
    v_cnt := (select count(*) from regexp_matches(v_def, 'private\.medication_slots_on\(m\.schedule_spec, m\.schedule_times, [A-Za-z0-9_.:]+\)', 'g'));
    if v_cnt <> 1 then
      raise exception 'S08z: % has % calls to medication_slots_on in the expected form (wanted exactly 1); not rewriting', v_fn, v_cnt;
    end if;
    v_new := regexp_replace(v_def,
      'private\.medication_slots_on\(m\.schedule_spec, m\.schedule_times, ([A-Za-z0-9_.:]+)\)',
      'private.medication_slots_on(m.schedule_spec, m.schedule_times, \1, m.patient_id)');
    if v_new = v_def then raise exception 'S08z: % was not changed', v_fn; end if;
    execute v_new;
  end loop;
end
$$;

-- 5. The validator ------------------------------------------------------------------------------------------------------
-- 1 to 12 entries, or none when the spec has anchored doses and the kind allows them.
create or replace function private.schedule_times_ok_or_none(p_times jsonb, p_allow_none boolean)
returns boolean language sql immutable set search_path = '' as $$
  select case when p_allow_none and (p_times is null or jsonb_typeof(p_times) = 'null'
                                     or (jsonb_typeof(p_times) = 'array' and jsonb_array_length(p_times) = 0)) then true
              else private.schedule_times_ok(p_times) end;
$$;

-- `anchored`: an array of at most 12 { anchor, offsetMinutes } (a known anchor, whole minutes from -120 to 180, no repeat of the
-- same pair), only on daily, every-N-days and weekdays schedules.
create or replace function private.schedule_anchored_ok(p_anchored jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if p_anchored is null or jsonb_typeof(p_anchored) = 'null' then return true; end if;
  if jsonb_typeof(p_anchored) <> 'array' or jsonb_array_length(p_anchored) > 12 then return false; end if;
  if exists (
    select 1 from jsonb_array_elements(p_anchored) e
     where jsonb_typeof(e) <> 'object'
        or jsonb_typeof(e -> 'anchor') is distinct from 'string'
        or (e ->> 'anchor') <> all (array['waking', 'morning_prayer', 'breakfast', 'midday_prayer', 'lunch', 'afternoon_prayer',
                                          'evening_prayer', 'dinner', 'night_prayer', 'bedtime'])
        or not private.schedule_int_ok(e -> 'offsetMinutes', -120, 180)) then
    return false;
  end if;
  if (select count(*) from jsonb_array_elements(p_anchored)) <>
     (select count(distinct ((e ->> 'anchor') || '|' || (e ->> 'offsetMinutes'))) from jsonb_array_elements(p_anchored) e) then
    return false;
  end if;
  return true;
exception when others then
  return false;
end;
$$;
revoke all on function private.schedule_times_ok_or_none(jsonb, boolean) from public, anon, authenticated;
revoke all on function private.schedule_anchored_ok(jsonb) from public, anon, authenticated;

create or replace function private.is_valid_schedule_spec(p_spec jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_kind     text;
  v_start    text;
  v_end      text;
  v_window   numeric := 0;
  v_lists    jsonb[] := '{}';
  v_step     jsonb;
  v_text     text;
  v_anchored jsonb;
  v_has_anch boolean := false;
  v_times_n  integer;
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

  -- Anchored doses (S08z).
  v_anchored := p_spec -> 'anchored';
  if not private.schedule_anchored_ok(v_anchored) then return false; end if;
  v_has_anch := v_anchored is not null and jsonb_typeof(v_anchored) = 'array' and jsonb_array_length(v_anchored) > 0;
  if v_has_anch and coalesce(v_kind, '') <> all (array['daily', 'every_n_days', 'weekdays']) then return false; end if;

  if v_kind = 'daily' then
    if not private.schedule_times_ok_or_none(p_spec -> 'times', v_has_anch) then return false; end if;
    v_lists := array[p_spec -> 'times'];
  elsif v_kind = 'every_n_days' then
    if not private.schedule_int_ok(p_spec -> 'intervalDays', 2, 90) then return false; end if;
    if jsonb_typeof(p_spec -> 'anchorDate') is distinct from 'string' or not private.schedule_date_ok(p_spec ->> 'anchorDate') then return false; end if;
    if not private.schedule_times_ok_or_none(p_spec -> 'times', v_has_anch) then return false; end if;
    v_lists := array[p_spec -> 'times'];
  elsif v_kind = 'weekdays' then
    if jsonb_typeof(p_spec -> 'days') is distinct from 'array' or jsonb_array_length(p_spec -> 'days') = 0 then return false; end if;
    if exists (select 1 from jsonb_array_elements(p_spec -> 'days') d where not private.schedule_int_ok(d, 0, 6)) then return false; end if;
    if not private.schedule_times_ok_or_none(p_spec -> 'times', v_has_anch) then return false; end if;
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

  -- Clock times and anchored doses together may not pass 12 a day.
  if v_has_anch and v_kind in ('daily', 'every_n_days', 'weekdays') then
    v_times_n := case when jsonb_typeof(p_spec -> 'times') = 'array' then jsonb_array_length(p_spec -> 'times') else 0 end;
    if v_times_n + jsonb_array_length(v_anchored) > 12 then return false; end if;
  end if;

  -- A window must close before the next dose time: two overlapping windows leave a dose "due"
  -- after the next one has started. (Anchored doses are checked against the patient's own times by the triggers below.)
  if v_window > 0 and exists (
       select 1 from unnest(v_lists) l
        where l is not null and jsonb_typeof(l) = 'array' and jsonb_array_length(l) > 0 and private.schedule_min_gap(l) <= v_window) then
    return false;
  end if;
  return true;
exception when others then
  return false;
end;
$$;

-- 6. No write path can leave two windows overlapping --------------------------------------------------------------------
-- The check constraint above cannot see a patient's anchor times (it is immutable). These two triggers close that: a medicine
-- with a flexible window may not be saved with anchored doses closer than the window, and an anchor time may not be moved to a
-- time that would do the same to any of the patient's active medicines. Fails OPEN on an internal error (with a warning): this is
-- a consistency rule, and a guard bug must never block a patient's medicine write.
create or replace function private.medication_anchor_window_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_window numeric;
begin
  if new.schedule_spec is null or jsonb_typeof(new.schedule_spec -> 'anchored') is distinct from 'array'
     or jsonb_array_length(new.schedule_spec -> 'anchored') = 0 then
    return new;
  end if;
  v_window := coalesce(nullif(new.schedule_spec ->> 'windowMinutes', '')::numeric, 0);
  if v_window > 0 and private.min_gap_of_minutes(private.spec_normal_minutes(new.schedule_spec, new.patient_id)) <= v_window then
    raise exception 'dose window overlaps the next dose' using errcode = '23514', detail = 'anchored_window_overlap';
  end if;
  return new;
exception
  when sqlstate '23514' then raise;
  when others then
    raise warning 'medication_anchor_window_guard skipped: %', sqlerrm;
    return new;
end;
$$;
drop trigger if exists medication_anchor_window_guard on public.medications;
create trigger medication_anchor_window_guard before insert or update of schedule_spec on public.medications
  for each row execute function private.medication_anchor_window_guard();

create or replace function private.dose_anchor_fill()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select organisation_id into new.organisation_id from public.profiles where id = new.patient_id;
  if new.organisation_id is null then raise exception 'patient has no organisation' using errcode = '23503'; end if;
  return new;
end;
$$;
drop trigger if exists dose_anchor_fill on public.patient_dose_anchors;
create trigger dose_anchor_fill before insert on public.patient_dose_anchors
  for each row execute function private.dose_anchor_fill();

-- Checked on the FINAL state: save_dose_anchor_times defers it until every time in the call is written, so moving breakfast and lunch
-- together is judged as a pair, not one at a time. A direct write (the proof, an admin) is judged at once.
create or replace function private.dose_anchor_window_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_conflict uuid;
begin
  select m.id into v_conflict
    from public.medications m
   where m.patient_id = new.patient_id and m.is_active and m.superseded_at is null
     and jsonb_typeof(m.schedule_spec -> 'anchored') = 'array'
     and coalesce(nullif(m.schedule_spec ->> 'windowMinutes', '')::numeric, 0) > 0
     and private.min_gap_of_minutes(private.spec_normal_minutes(m.schedule_spec, m.patient_id)) <= (m.schedule_spec ->> 'windowMinutes')::numeric
   limit 1;
  if v_conflict is not null then
    raise exception 'this time would make a dose window overlap the next dose' using errcode = '23514', detail = 'anchored_window_overlap';
  end if;
  return null;
exception
  when sqlstate '23514' then raise;
  when others then
    raise warning 'dose_anchor_window_guard skipped: %', sqlerrm;
    return null;
end;
$$;
drop trigger if exists dose_anchor_window_guard on public.patient_dose_anchors;
create constraint trigger dose_anchor_window_guard after insert or update on public.patient_dose_anchors
  deferrable initially immediate for each row execute function private.dose_anchor_window_guard();
revoke all on function private.medication_anchor_window_guard() from public, anon, authenticated;
revoke all on function private.dose_anchor_window_guard() from public, anon, authenticated;
revoke all on function private.dose_anchor_fill() from public, anon, authenticated;

-- 7. The write path -------------------------------------------------------------------------------------------------------
-- True when today already has any dose answer logged for a medicine anchored to one of these anchors: moving the anchor from today
-- would orphan that answer (the slot is keyed by its resolved time), so the change starts tomorrow instead.
create or replace function private.anchor_day_has_answers(p_patient uuid, p_anchors text[], p_date date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.medication_logs l
      join public.medications m on m.id = l.medication_id
     where l.patient_id = p_patient and l.scheduled_for_date in (p_date - 1, p_date, p_date + 1) and l.scheduled_time is not null
       and jsonb_typeof(m.schedule_spec -> 'anchored') = 'array'
       and exists (select 1 from jsonb_array_elements(m.schedule_spec -> 'anchored') a where (a ->> 'anchor') = any (p_anchors)));
$$;
revoke all on function private.anchor_day_has_answers(uuid, text[], date) from public, anon, authenticated;

-- True when ANY dose log exists from the day before p_from onward for a medicine tied to one of these anchors. A change accepted
-- from a past date (an offline phone sending late) is safe only when there is nothing logged since it could orphan.
create or replace function private.anchor_logs_since(p_patient uuid, p_anchors text[], p_from date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.medication_logs l
      join public.medications m on m.id = l.medication_id
     where l.patient_id = p_patient and l.scheduled_for_date >= p_from - 1 and l.scheduled_time is not null
       and jsonb_typeof(m.schedule_spec -> 'anchored') = 'array'
       and exists (select 1 from jsonb_array_elements(m.schedule_spec -> 'anchored') a where (a ->> 'anchor') = any (p_anchors)));
$$;
revoke all on function private.anchor_logs_since(uuid, text[], date) from public, anon, authenticated;

create or replace function public.save_dose_anchor_times(p_patient uuid, p_times jsonb, p_effective_from date default null)
returns date
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_from  date;
  e       record;
  v_keys  text[];
begin
  if v_uid is null or (v_uid <> p_patient and not private.can_act_for(p_patient)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_times is null or jsonb_typeof(p_times) <> 'object' or p_times = '{}'::jsonb then
    raise exception 'times must be a non-empty object' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(p_times) x
              where x.key <> all (private.dose_anchor_ids())
                 or jsonb_typeof(x.value) <> 'string' or (x.value #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception 'unknown anchor or bad time' using errcode = '22023';
  end if;
  v_from := coalesce(p_effective_from, v_today);
  if v_from > v_today + 30 then
    raise exception 'effective date too far ahead' using errcode = '22023';
  end if;
  select array_agg(k) into v_keys from jsonb_object_keys(p_times) k;
  -- A past date (a phone that was offline) is kept only up to 3 days back and only when nothing on these anchors has been logged since.
  if v_from < v_today and (v_from < v_today - 3 or private.anchor_logs_since(p_patient, v_keys, v_from)) then
    v_from := v_today;
  end if;
  -- Today already has answers on these anchors: the new time starts tomorrow so those answers keep their slot.
  if v_from <= v_today + 1 and private.anchor_day_has_answers(p_patient, v_keys, v_today) then
    v_from := greatest(v_from, v_today + 1);
  end if;
  -- The window check runs once, on the final state of this save, not after each time.
  set constraints public.dose_anchor_window_guard deferred;
  for e in select key, value #>> '{}' as t from jsonb_each(p_times) loop
    insert into public.patient_dose_anchors (patient_id, anchor, effective_from, local_time, organisation_id)
    values (p_patient, e.key, v_from, e.t, (select organisation_id from public.profiles where id = p_patient))
    on conflict (patient_id, anchor, effective_from) do update set local_time = excluded.local_time;
  end loop;
  set constraints public.dose_anchor_window_guard immediate;
  return v_from;
end;
$$;

create or replace function public.create_day_shift(p_patient uuid, p_client_id uuid, p_starts_on date, p_ends_on date, p_offsets jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_start date;
  v_id    uuid;
begin
  if v_uid is null or (v_uid <> p_patient and not private.can_act_for(p_patient)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_client_id is not null then
    select id into v_id from public.patient_day_shifts where patient_id = p_patient and client_id = p_client_id;
    if v_id is not null then return v_id; end if;
  end if;
  if p_starts_on is null or p_ends_on is null or not private.day_shift_offsets_ok(p_offsets) then
    raise exception 'bad day shift' using errcode = '22023';
  end if;
  -- A shift never reaches back into days that have answers. One created on a phone that was offline and sent up to 3 days late keeps its
  -- own start when nothing on its anchors has been logged since; otherwise it starts today at the earliest.
  v_start := p_starts_on;
  if v_start < v_today and (v_start < v_today - 3 or private.anchor_logs_since(p_patient, (select array_agg(k) from jsonb_object_keys(p_offsets) k), v_start)) then
    v_start := v_today;
  end if;
  if v_start = v_today and private.anchor_day_has_answers(p_patient, (select array_agg(k) from jsonb_object_keys(p_offsets) k), v_today) then
    v_start := v_today + 1;
  end if;
  if p_ends_on < v_start then
    raise exception 'that shift is already over, or starts when today has doses recorded' using errcode = '22023', detail = 'shift_not_applicable';
  end if;
  insert into public.patient_day_shifts (patient_id, organisation_id, client_id, starts_on, ends_on, offsets)
  values (p_patient, (select organisation_id from public.profiles where id = p_patient), p_client_id, v_start, p_ends_on, p_offsets)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.cancel_day_shift(p_patient uuid, p_id uuid)
returns date
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  s       public.patient_day_shifts;
  v_from  date;
begin
  if v_uid is null or (v_uid <> p_patient and not private.can_act_for(p_patient)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- The phone knows a shift it has just created only by the client id it sent; the server's own id is accepted too.
  select * into s from public.patient_day_shifts where patient_id = p_patient and (id = p_id or client_id = p_id) order by (id = p_id) desc limit 1;
  if not found then raise exception 'no such day shift' using errcode = 'P0002'; end if;
  v_from := v_today;
  if private.anchor_day_has_answers(p_patient, (select array_agg(k) from jsonb_object_keys(s.offsets) k), v_today) then
    v_from := v_today + 1;
  end if;
  -- Never earlier than the shift's own start (a shift not yet begun is simply void), never later than an earlier end.
  v_from := greatest(v_from, s.starts_on);
  if s.cancelled_from is not null then v_from := least(v_from, s.cancelled_from); end if;
  update public.patient_day_shifts set cancelled_from = v_from where id = s.id;
  return v_from;
end;
$$;
revoke all on function public.save_dose_anchor_times(uuid, jsonb, date) from public, anon;
revoke all on function public.create_day_shift(uuid, uuid, date, date, jsonb) from public, anon;
revoke all on function public.cancel_day_shift(uuid, uuid) from public, anon;
grant execute on function public.save_dose_anchor_times(uuid, jsonb, date) to authenticated;
grant execute on function public.create_day_shift(uuid, uuid, date, date, jsonb) to authenticated;
grant execute on function public.cancel_day_shift(uuid, uuid) to authenticated;

-- 7b. The patient-data registry (S39d): every table with a patient_id is listed with its retention class and whether it is exported.
-- Left UNREVIEWED on purpose: a class review is the CMO's and DPO's to give.
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
select t, 'patient_id', private.retention_class_for(t), 'review', true, false,
       'Added by S08z (2026-10-21). Class proposed by the standing name rule; awaiting the next CMO and DPO class review. SPECIAL-CATEGORY: which prayers a person ties a medicine to discloses religious belief; readable by the person and an acting guardian only (OQ-S08z-5).'
  from unnest(array['patient_dose_anchors', 'patient_day_shifts']) t
on conflict (table_name) do nothing;

-- 8. Closing self-check ------------------------------------------------------------------------------------------------------
do $$
declare v_fn text;
begin
  if (select count(*) from public.dose_anchor_defaults) <> 10 then raise exception 'S08z: expected 10 anchor defaults'; end if;
  if exists (select 1 from information_schema.table_privileges
              where table_name in ('dose_anchor_defaults', 'patient_dose_anchors', 'patient_day_shifts')
                and table_schema = 'public' and grantee in ('anon', 'PUBLIC')) then
    raise exception 'S08z: anchor tables must not be reachable by anon';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('patient_dose_anchors', 'patient_day_shifts')
                and (qual ilike '%can_read_clinical%' or qual ilike '%care_access%')) then
    raise exception 'S08z: anchor times and shifts must not be readable by clinical readers (religious belief)';
  end if;
  if exists (select 1 from information_schema.table_privileges
              where table_name in ('patient_dose_anchors', 'patient_day_shifts') and table_schema = 'public'
                and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')) then
    raise exception 'S08z: patients must write anchors and shifts only through the RPCs';
  end if;
  foreach v_fn in array array[
    'public.save_dose_anchor_times(uuid,jsonb,date)', 'public.create_day_shift(uuid,uuid,date,date,jsonb)', 'public.cancel_day_shift(uuid,uuid)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'S08z: % must not be executable by anon', v_fn; end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception 'S08z: % must be executable by authenticated', v_fn; end if;
  end loop;
  foreach v_fn in array array[
    'private.medication_slots_on(jsonb,jsonb,date,uuid)', 'private.medication_slots_on(jsonb,jsonb,date)',
    'private.dose_anchor_minutes(uuid,text,date)', 'private.dose_anchor_shift(uuid,text,date)',
    'private.spec_normal_minutes(jsonb,uuid,text,text)', 'private.anchor_day_has_answers(uuid,text[],date)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'S08z: % must not be executable by anon or authenticated', v_fn;
    end if;
  end loop;
  -- The expansion: defaults with no patient, and a dose that crosses midnight lands on the next date.
  if (select array_agg(slot_time) from private.medication_slots_on(
        '{"kind":"daily","times":[],"anchored":[{"anchor":"breakfast","offsetMinutes":0}]}', null, date '2026-10-05')) is distinct from array['07:30'] then
    raise exception 'S08z: anchored breakfast with no patient did not resolve to the proposed default';
  end if;
  if not private.is_valid_schedule_spec('{"kind":"daily","anchored":[{"anchor":"dinner","offsetMinutes":-30}]}')
     or private.is_valid_schedule_spec('{"kind":"daily","times":[]}')
     or private.is_valid_schedule_spec('{"kind":"as_needed","anchored":[{"anchor":"dinner","offsetMinutes":0}]}')
     or private.is_valid_schedule_spec('{"kind":"daily","anchored":[{"anchor":"brunch","offsetMinutes":0}]}') then
    raise exception 'S08z: the schedule validator does not accept and refuse the anchored forms';
  end if;
end
$$;
