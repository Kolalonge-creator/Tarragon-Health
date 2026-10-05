-- S08: medicines. Complex schedules, pill count and refill countdown, a server
-- "missed" job that never overrules a late-synced "taken", weekly adherence, and
-- the three medicine signals (8.1-8.6, 8.10, 8.13-8.15).
--
-- What this does:
--   1. medicine_config: one active, versioned row holding the PROPOSED server-side
--      values (missed window, low-supply days, adherence window/threshold/minimum).
--      Mirrors packages/shared proposed-config `medicines.dose_rules`,
--      `reminders.behaviour` and `adherence.threshold`; never hard-coded in a function.
--   2. medications.schedule_spec (jsonb, nullable): the structured schedule (daily,
--      every N days, weekdays, taper, as needed, with start/end dates and a food
--      note). Null means the old plain list in schedule_times. A clinician-prescribed
--      row cannot have it changed by the patient: enforce_patient_clinician_medication_allowlist
--      refuses any column outside its short allow-list, and schedule_spec is not on it.
--   3. private.medication_slots_on(spec, times, date): the one SQL expansion of a
--      schedule into dose slots, used by the missed job, the reminders, the supply
--      estimate and the adherence function. The TypeScript twin (packages/medicines
--      schedule.ts) shares its test cases with the proof for this file.
--   4. medication_supply: the patient's pill count (own table, so the prescribed
--      medicines row stays untouched), and private.medication_supply_status() that
--      walks the schedule forward to a run-out date.
--   5. medication_logs_latest_per_slot and evaluate_adherence_escalation now prefer
--      any row a person wrote over a server-written "missed" row for the same slot,
--      so a dose logged offline and synced late is "taken" even though the server's
--      own "missed" row has a later timestamp. Without this the view picks the
--      newest row, which is the server's.
--   6. private.mark_overdue_doses_missed(): marks an unanswered slot "missed"
--      (source 'system') after server_missed_after_minutes, deterministic client_id
--      so a re-run is a no-op. 12 hours by default, longer than the on-device
--      "missed" (2 hours) so a phone that was offline has time to sync first.
--   7. private.weekly_adherence() and public.medication_weekly_adherence(): the
--      one formula (docs/research/S08.md section 2). Self, a caregiver with the
--      medicines category, an acting guardian, or tied staff (audited, with a reason).
--   8. Signals: dose recorded, dose missed, refill due, adherence low, into
--      clinical_rule_events. None of them changes a medicine or a dose.
--   9. The server dose reminder and refill reminder no longer put the medicine
--      name in the notification payload (INV-07), and the refill reminder also fires
--      from the pill count.
--
-- Row counts at writing (live, 2026-10-04): medications 4, medication_logs 0,
-- medication_supply (new) 0, clinical_rule_events 21. No data conversion exists:
-- every new column is nullable or defaulted and nothing is backfilled.

-- 1. Config -----------------------------------------------------------------
create table if not exists public.medicine_config (
  version                      integer primary key,
  is_active                    boolean not null default false,
  missed_after_minutes         integer not null check (missed_after_minutes between 15 and 1440),
  server_missed_after_minutes  integer not null check (server_missed_after_minutes between 30 and 2880),
  low_supply_days              integer not null check (low_supply_days >= 1),
  adherence_window_days        integer not null check (adherence_window_days between 1 and 60),
  adherence_threshold_percent  integer not null check (adherence_threshold_percent between 1 and 100),
  adherence_min_doses          integer not null check (adherence_min_doses >= 1),
  note                         text,
  created_at                   timestamptz not null default now(),
  check (server_missed_after_minutes >= missed_after_minutes)
);
create unique index if not exists medicine_config_one_active on public.medicine_config (is_active) where is_active;
alter table public.medicine_config enable row level security;
create policy medicine_config_read on public.medicine_config for select to authenticated using (true);
revoke all on public.medicine_config from public, anon;
grant select on public.medicine_config to authenticated;

insert into public.medicine_config
  (version, is_active, missed_after_minutes, server_missed_after_minutes, low_supply_days,
   adherence_window_days, adherence_threshold_percent, adherence_min_doses, note)
values (1, true, 120, 720, 7, 7, 80, 3,
        'PROPOSED values, S08 (2026-10-04). missed_after 120 = reminders.behaviour; threshold 80 over 7 days = adherence.threshold (spec 17); server_missed_after 720 so an offline phone can sync first (S06 stuck notice is 12 hours).')
on conflict (version) do nothing;

-- 2. Structured schedule ------------------------------------------------------
alter table public.medications add column if not exists schedule_spec jsonb;
alter table public.medications drop constraint if exists medications_schedule_spec_shape;
alter table public.medications add constraint medications_schedule_spec_shape check (
  schedule_spec is null or (
    jsonb_typeof(schedule_spec) = 'object'
    and schedule_spec ->> 'kind' in ('daily', 'every_n_days', 'weekdays', 'taper', 'as_needed')
  )
);

-- 3. Slot expansion -----------------------------------------------------------
create or replace function private.medication_slots_on(p_spec jsonb, p_times jsonb, p_date date)
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
begin
  if p_spec is null then
    v_kind := 'daily';
    v_times := coalesce(p_times, '[]'::jsonb);
  else
    v_kind := p_spec ->> 'kind';
    v_start := nullif(p_spec ->> 'startDate', '')::date;
    v_end := nullif(p_spec ->> 'endDate', '')::date;
    if (v_start is not null and p_date < v_start) or (v_end is not null and p_date > v_end) then
      return;
    end if;
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

-- 4. Pill count -----------------------------------------------------------------
create table if not exists public.medication_supply (
  medication_id   uuid primary key references public.medications (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id),
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  pills_on_hand   numeric(7, 1) not null check (pills_on_hand >= 0 and pills_on_hand * 2 = floor(pills_on_hand * 2)),
  pills_per_dose  numeric(4, 1) not null default 1 check (pills_per_dose > 0 and pills_per_dose * 2 = floor(pills_per_dose * 2)),
  counted_at      timestamptz not null default now(),
  count_source    text not null default 'patient' check (count_source in ('patient', 'dispensed')),
  updated_at      timestamptz not null default now()
);
create index if not exists medication_supply_patient_idx on public.medication_supply (patient_id);
create index if not exists medication_supply_org_idx on public.medication_supply (organisation_id);

create or replace function private.medication_supply_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  select patient_id, organisation_id into v from public.medications where id = new.medication_id;
  if not found then
    raise exception 'medication not found' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and new.medication_id is distinct from old.medication_id then
    raise exception 'a pill count cannot move to another medicine' using errcode = '42501';
  end if;
  -- Who the count belongs to always comes from the medicine, never from the client.
  new.patient_id := v.patient_id;
  new.organisation_id := v.organisation_id;
  if tg_op = 'INSERT' or new.pills_on_hand is distinct from old.pills_on_hand
     or new.pills_per_dose is distinct from old.pills_per_dose then
    new.counted_at := now();
  else
    new.counted_at := old.counted_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists medication_supply_guard on public.medication_supply;
create trigger medication_supply_guard before insert or update on public.medication_supply
  for each row execute function private.medication_supply_guard();

alter table public.medication_supply enable row level security;
create policy medication_supply_select on public.medication_supply for select to authenticated using (
  patient_id = (select auth.uid())
  or private.can_act_for(patient_id)
  or private.can_read_clinical(patient_id, 'medications'::public.care_access_category)
  or private.can_read_clinical(patient_id, 'view_medication'::public.caregiver_permission)
);
create policy medication_supply_insert on public.medication_supply for insert to authenticated with check (
  patient_id = (select auth.uid()) or private.can_act_for(patient_id)
);
create policy medication_supply_update on public.medication_supply for update to authenticated
  using (patient_id = (select auth.uid()) or private.can_act_for(patient_id))
  with check (patient_id = (select auth.uid()) or private.can_act_for(patient_id));
revoke all on public.medication_supply from public, anon;
grant select, insert, update on public.medication_supply to authenticated;

-- 5. A person's row beats the server's "missed" for the same slot ----------------
create or replace view public.medication_logs_latest_per_slot with (security_invoker = on) as
 select distinct on (medication_id, scheduled_for_date, scheduled_time,
        case when scheduled_time is null then id else null::uuid end)
    id, organisation_id, patient_id, medication_id, status, reason, logged_at, created_at,
    scheduled_time, scheduled_for_date, logged_by_profile_id, missed_reason
   from public.medication_logs
  order by medication_id, scheduled_for_date, scheduled_time,
        case when scheduled_time is null then id else null::uuid end,
        (status = 'missed' and source = 'system'), logged_at desc, id desc;

create or replace function private.evaluate_adherence_escalation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_missed integer;
  v_level  public.med_adherence_alert_level;
  v_alert  public.medication_adherence_alerts%rowtype;
begin
  select count(*) into v_missed
  from (
    select distinct on (
        case when scheduled_time is not null and scheduled_for_date is not null
          then scheduled_for_date::text || '|' || scheduled_time
          else id::text
        end
      )
      status
    from public.medication_logs
    where medication_id = new.medication_id
      and logged_at >= now() - interval '30 days'
    order by
      case when scheduled_time is not null and scheduled_for_date is not null
        then scheduled_for_date::text || '|' || scheduled_time
        else id::text
      end,
      -- S08: a row a person wrote beats the server's own "missed" row for the same slot.
      (status = 'missed' and source = 'system'),
      logged_at desc,
      id desc
  ) latest
  where latest.status in ('missed', 'not_available');

  select * into v_alert
  from public.medication_adherence_alerts
  where medication_id = new.medication_id and status <> 'resolved'
  limit 1;

  if v_alert.id is not null then
    update public.medication_adherence_alerts
      set missed_count = v_missed
    where id = v_alert.id;
  end if;

  if new.status not in ('missed', 'not_available') then
    return new;
  end if;

  if v_missed >= 6 then
    v_level := 'doctor';
  elsif v_missed >= 3 then
    v_level := 'coach';
  else
    return new;
  end if;

  if v_alert.id is null then
    insert into public.medication_adherence_alerts
      (organisation_id, patient_id, medication_id, level, missed_count)
    values
      (new.organisation_id, new.patient_id, new.medication_id, v_level, v_missed);
  else
    update public.medication_adherence_alerts
      set level = case when v_level = 'doctor' then 'doctor' else level end,
          status = case
            when status = 'acknowledged' and v_level = 'doctor' and level <> 'doctor'
            then 'open'::public.med_adherence_alert_status
            else status
          end
    where id = v_alert.id;
  end if;

  return new;
end;
$$;

-- 6. Supply estimate (the SQL twin of packages/medicines supply.ts) ---------------
create or replace function private.medication_supply_status(p_medication uuid, p_now timestamptz default now())
returns table (pills_left numeric, run_out_date date)
language plpgsql stable security definer set search_path = '' as $$
declare
  m record;
  s record;
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_taken integer;
  v_left  numeric;
  v_run   date;
begin
  select * into m from public.medications where id = p_medication and is_active and superseded_at is null;
  if not found then return; end if;
  select * into s from public.medication_supply where medication_id = p_medication;
  if not found then return; end if;

  select count(*) into v_taken from public.medication_logs_latest_per_slot v
   where v.medication_id = p_medication and v.logged_at >= s.counted_at and v.status in ('taken', 'delayed');
  v_left := greatest(0, s.pills_on_hand - v_taken * s.pills_per_dose);

  select min(x.d) into v_run from (
    select g.d::date as d,
           row_number() over (order by g.d, sl.slot_time) as rn
      from generate_series(v_today::timestamp, (v_today + 366)::timestamp, interval '1 day') g(d)
     cross join lateral private.medication_slots_on(m.schedule_spec, m.schedule_times, g.d::date) sl
     where ((g.d::date + sl.slot_time::time) at time zone 'Africa/Lagos') > p_now
       and not exists (
         select 1 from public.medication_logs_latest_per_slot v
          where v.medication_id = p_medication and v.scheduled_for_date = g.d::date
            and v.scheduled_time = sl.slot_time
            and v.status in ('taken', 'delayed', 'skipped', 'not_available'))
  ) x
  where x.rn * s.pills_per_dose > v_left;

  return query select v_left, v_run;
end;
$$;

-- 7. Weekly adherence (the SQL twin of packages/medicines adherence.ts) ------------
create or replace function private.weekly_adherence(p_patient uuid, p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c record;
  v_end date := (p_now at time zone 'Africa/Lagos')::date;
  v_start date;
  r record;
  v_percent integer;
begin
  select * into c from public.medicine_config where is_active;
  if not found then
    raise exception 'no active medicine_config' using errcode = '55000';
  end if;
  v_start := v_end - (c.adherence_window_days - 1);

  select
    count(*) filter (where state <> 'open')                          as due,
    count(*) filter (where state = 'taken')                          as taken,
    count(*) filter (where state = 'delayed')                        as late,
    count(*) filter (where state = 'skipped')                        as skipped,
    count(*) filter (where state = 'missed')                         as missed,
    count(*) filter (where state = 'not_available')                  as unavailable
  into r
  from (
    select coalesce(v.status::text,
             case when p_now >= s.due_at + make_interval(mins => c.missed_after_minutes) then 'missed' else 'open' end) as state
      from (
        select m.id as med_id, g.d::date as sdate, sl.slot_time,
               ((g.d::date + sl.slot_time::time) at time zone 'Africa/Lagos') as due_at,
               m.created_at
          from public.medications m
         cross join lateral generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') g(d)
         cross join lateral private.medication_slots_on(m.schedule_spec, m.schedule_times, g.d::date) sl
         where m.patient_id = p_patient and m.is_active and m.superseded_at is null
      ) s
      left join public.medication_logs_latest_per_slot v
        on v.medication_id = s.med_id and v.scheduled_for_date = s.sdate and v.scheduled_time = s.slot_time
     where s.due_at <= p_now and s.due_at >= s.created_at
  ) z;

  v_percent := case when r.due >= c.adherence_min_doses
                    then round(100.0 * (r.taken + r.late) / r.due)::integer end;

  return jsonb_build_object(
    'percent', v_percent, 'due', r.due, 'taken', r.taken, 'late', r.late, 'skipped', r.skipped,
    'missed', r.missed, 'unavailable', r.unavailable,
    'below_threshold', coalesce(v_percent < c.adherence_threshold_percent, false),
    'threshold_percent', c.adherence_threshold_percent,
    'window_start', v_start, 'window_end', v_end, 'config_version', c.version);
end;
$$;

create or replace function public.medication_weekly_adherence(p_patient uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  -- The patient, an acting guardian, or a supporter holding the medicines grant read it directly.
  if p_patient = (select auth.uid())
     or private.can_act_for(p_patient)
     or private.can_read_clinical(p_patient, 'medications'::public.care_access_category)
     or private.can_read_clinical(p_patient, 'view_medication'::public.caregiver_permission) then
    return jsonb_build_object('status', 'ok') || private.weekly_adherence(p_patient);
  end if;
  -- Staff read through the tie, with a reason, and every read is audited (INV-10, INV-12).
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if not private.can_staff_read_clinical(p_patient, 'medications'::public.care_access_category) then
    perform private.audit_chart_read(p_patient, array['dose_events'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied');
  end if;
  perform private.audit_chart_read(p_patient, array['dose_events'], p_reason, 'success');
  return jsonb_build_object('status', 'ok') || private.weekly_adherence(p_patient);
end;
$$;

-- 8. Signals ----------------------------------------------------------------------
create or replace function private.emit_dose_recorded_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source is not distinct from 'system' then
    return null;
  end if;
  begin
    perform private.emit_clinical_rule_event(
      new.organisation_id, new.patient_id, 'medication_dose_recorded',
      jsonb_strip_nulls(jsonb_build_object(
        'medication_id', new.medication_id, 'status', new.status,
        'scheduled_for_date', new.scheduled_for_date, 'scheduled_time', new.scheduled_time)),
      'db_trigger', 'medication_logs', new.id, new.logged_at, 'dose_recorded:' || new.id::text);
  exception when others then
    -- A dose log must never fail because a signal could not be written; the warning reaches the database log.
    raise warning 'dose_recorded event not written for log %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists medication_logs_emit_dose_recorded on public.medication_logs;
create trigger medication_logs_emit_dose_recorded after insert on public.medication_logs
  for each row execute function private.emit_dose_recorded_event();

-- 6b. The server "missed" job ------------------------------------------------------
create or replace function private.mark_overdue_doses_missed(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare
  c record;
  r record;
  v_id uuid;
  v_n integer := 0;
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
begin
  select * into c from public.medicine_config where is_active;
  if not found then
    raise exception 'no active medicine_config' using errcode = '55000';
  end if;

  for r in
    select m.id as med_id, m.organisation_id, m.patient_id, g.d::date as slot_date, sl.slot_time
      from public.medications m
     cross join lateral generate_series((v_today - 3)::timestamp, v_today::timestamp, interval '1 day') g(d)
     cross join lateral private.medication_slots_on(m.schedule_spec, m.schedule_times, g.d::date) sl
     where m.is_active and m.stopped_at is null and m.superseded_at is null
       and ((g.d::date + sl.slot_time::time) at time zone 'Africa/Lagos')
             + make_interval(mins => c.server_missed_after_minutes) <= p_now
       and ((g.d::date + sl.slot_time::time) at time zone 'Africa/Lagos') >= m.created_at
       and not exists (
         select 1 from public.medication_logs l
          where l.medication_id = m.id and l.scheduled_for_date = g.d::date and l.scheduled_time = sl.slot_time)
  loop
    v_id := null;
    insert into public.medication_logs
      (organisation_id, patient_id, medication_id, status, scheduled_time, scheduled_for_date, source, client_id)
    values
      (r.organisation_id, r.patient_id, r.med_id, 'missed', r.slot_time, r.slot_date, 'system',
       md5('server-missed|' || r.med_id::text || '|' || r.slot_date::text || '|' || r.slot_time)::uuid)
    on conflict (patient_id, client_id) where client_id is not null do nothing
    returning id into v_id;

    if v_id is not null then
      v_n := v_n + 1;
      begin
        perform private.emit_clinical_rule_event(
          r.organisation_id, r.patient_id, 'medication_dose_missed',
          jsonb_build_object('medication_id', r.med_id, 'scheduled_for_date', r.slot_date, 'scheduled_time', r.slot_time),
          'cron', 'medication_logs', v_id, p_now,
          'dose_missed:' || r.med_id::text || ':' || r.slot_date::text || ':' || r.slot_time);
      exception when others then
        raise warning 'dose_missed event not written for medication %: %', r.med_id, sqlerrm;
      end;
    end if;
  end loop;
  return v_n;
end;
$$;

create or replace function private.emit_adherence_signals(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r record;
  a jsonb;
  v_n integer := 0;
  v_week date := date_trunc('week', (p_now at time zone 'Africa/Lagos'))::date;
begin
  for r in select distinct patient_id, organisation_id from public.medications where is_active and superseded_at is null loop
    a := private.weekly_adherence(r.patient_id, p_now);
    if (a ->> 'below_threshold')::boolean then
      begin
        if private.emit_clinical_rule_event(
             r.organisation_id, r.patient_id, 'medication_adherence_low',
             jsonb_build_object('percent', a -> 'percent', 'due', a -> 'due', 'taken', a -> 'taken',
                                'skipped', a -> 'skipped', 'missed', a -> 'missed', 'config_version', a -> 'config_version'),
             'cron', null, null, p_now, 'adherence_low:' || r.patient_id::text || ':' || v_week::text) is not null then
          v_n := v_n + 1;
        end if;
      exception when others then
        raise warning 'adherence_low event not written for patient %: %', r.patient_id, sqlerrm;
      end;
    end if;
  end loop;
  return v_n;
end;
$$;

-- 9. Reminders: no medicine name in the payload, slots from the schedule, refill from the pill count
create or replace function private.queue_medication_dose_reminders()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_now_lagos    timestamp := (now() at time zone 'Africa/Lagos');
  v_today_lagos  date := v_now_lagos::date;
  v_current_time time := v_now_lagos::time;
begin
  with candidates as (
    select m.id as medication_id, m.organisation_id, m.patient_id, sl.slot_time as schedule_time
      from public.medications m
     cross join lateral private.medication_slots_on(m.schedule_spec, m.schedule_times, v_today_lagos) sl
     where m.is_active
  ),
  due as (
    select c.* from candidates c
     where c.schedule_time::time <= v_current_time
       and c.schedule_time::time > v_current_time - interval '15 minutes'
       and not exists (
         select 1 from public.medication_logs l
          where l.medication_id = c.medication_id and l.scheduled_for_date = v_today_lagos
            and l.scheduled_time = c.schedule_time)
       and not exists (
         select 1 from public.medication_dose_reminders r
          where r.medication_id = c.medication_id and r.scheduled_for_date = v_today_lagos
            and r.scheduled_time = c.schedule_time)
  ),
  inserted_state as (
    insert into public.medication_dose_reminders (organisation_id, patient_id, medication_id, scheduled_for_date, scheduled_time)
    select organisation_id, patient_id, medication_id, v_today_lagos, schedule_time from due
    on conflict (medication_id, scheduled_for_date, scheduled_time) do nothing
    returning medication_id, scheduled_time
  ),
  confirmed as (
    select d.* from due d
      join inserted_state s on s.medication_id = d.medication_id and s.scheduled_time = d.schedule_time
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, private.patient_reminder_channel(patient_id), 'pending', 'medication_dose_reminder',
           jsonb_build_object('medication_id', medication_id, 'scheduled_time', schedule_time)
      from confirmed
    returning id
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select organisation_id, patient_id, 'in_app', 'pending', 'medication_dose_reminder',
         jsonb_build_object('medication_id', medication_id, 'scheduled_time', schedule_time)
    from confirmed;
end;
$$;

create or replace function private.queue_medication_refill_reminders()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_low   integer;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  r record;
begin
  select low_supply_days into v_low from public.medicine_config where is_active;
  v_low := coalesce(v_low, 7);

  for r in
    with cand as (
      select m.id as medication_id, m.patient_id, m.organisation_id, m.refill_date,
             (select ss.run_out_date from private.medication_supply_status(m.id) ss) as run_out,
             coalesce(
               (select x.lead_days from public.medication_refill_reminder_rules x where x.patient_id = m.patient_id),
               (select x.lead_days from public.medication_refill_reminder_rules x where x.patient_id is null and x.organisation_id = m.organisation_id),
               v_low) as lead_days
        from public.medications m
       where m.is_active and m.superseded_at is null
    ), eff as (
      select cand.*,
             case when refill_date is not null and run_out is not null then least(refill_date, run_out)
                  else coalesce(refill_date, run_out) end as due_date
        from cand
    )
    select * from eff e
     where e.due_date is not null
       and e.due_date - e.lead_days <= v_today
       and e.due_date >= v_today
       and not exists (
         select 1 from public.medication_refill_state s
          where s.medication_id = e.medication_id and s.reminded_for_refill_date = e.due_date)
  loop
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (r.organisation_id, r.patient_id, private.patient_reminder_channel(r.patient_id), 'pending',
            'medication_refill_reminder',
            jsonb_build_object('medication_id', r.medication_id, 'refill_date', r.due_date));
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (r.organisation_id, r.patient_id, 'in_app', 'pending', 'medication_refill_reminder',
            jsonb_build_object('medication_id', r.medication_id, 'refill_date', r.due_date));
    insert into public.medication_refill_state (medication_id, patient_id, organisation_id, reminded_for_refill_date, reminder_sent_at)
    values (r.medication_id, r.patient_id, r.organisation_id, r.due_date, now())
    on conflict (medication_id) do update
      set reminded_for_refill_date = excluded.reminded_for_refill_date,
          reminder_sent_at = excluded.reminder_sent_at,
          updated_at = now();
    begin
      perform private.emit_clinical_rule_event(
        r.organisation_id, r.patient_id, 'medication_refill_due',
        jsonb_build_object('medication_id', r.medication_id, 'due_date', r.due_date,
                           'from_pill_count', r.run_out is not null and r.run_out = r.due_date),
        'cron', 'medications', r.medication_id, now(),
        'refill_due:' || r.medication_id::text || ':' || r.due_date::text);
    exception when others then
      raise warning 'refill_due event not written for medication %: %', r.medication_id, sqlerrm;
    end;
  end loop;
end;
$$;

-- Schedules ------------------------------------------------------------------------
select cron.schedule('medicine-missed-dose-job-every-15-min', '*/15 * * * *', $$select private.mark_overdue_doses_missed();$$);
select cron.schedule('medicine-adherence-signals-daily', '40 6 * * *', $$select private.emit_adherence_signals();$$);

-- Privileges: none of the cron or helper functions is callable from a client ----------
revoke all on function private.medication_slots_on(jsonb, jsonb, date) from public, anon, authenticated;
revoke all on function private.medication_supply_status(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.weekly_adherence(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.mark_overdue_doses_missed(timestamptz) from public, anon, authenticated;
revoke all on function private.emit_adherence_signals(timestamptz) from public, anon, authenticated;
revoke all on function private.medication_supply_guard() from public, anon, authenticated;
revoke all on function private.emit_dose_recorded_event() from public, anon, authenticated;
revoke all on function public.medication_weekly_adherence(uuid, text) from public, anon;
grant execute on function public.medication_weekly_adherence(uuid, text) to authenticated;

-- Assertions --------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  -- The shared expansion cases (packages/medicines/src/schedule.fixtures.ts).
  if (select array_agg(slot_time) from private.medication_slots_on(
        '{"kind":"daily","times":["20:00","08:00"]}', null, date '2026-10-05')) is distinct from array['08:00','20:00'] then
    raise exception 'daily expansion wrong';
  end if;
  if exists (select 1 from private.medication_slots_on(
        '{"kind":"every_n_days","times":["09:00"],"intervalDays":2,"anchorDate":"2026-10-01"}', null, date '2026-10-04')) then
    raise exception 'every_n_days off-anchor must have no slot';
  end if;
  if not exists (select 1 from private.medication_slots_on(
        '{"kind":"every_n_days","times":["06:00"],"intervalDays":2,"anchorDate":"2028-02-27"}', null, date '2028-02-29')) then
    raise exception 'every_n_days leap-day slot missing';
  end if;
  if (select dose_text from private.medication_slots_on(
        '{"kind":"taper","startDate":"2026-10-01","steps":[{"days":3,"times":["08:00","20:00"],"doseText":"2 tablets"},{"days":3,"times":["08:00"],"doseText":"1 tablet"}]}',
        null, date '2026-10-05') limit 1) is distinct from '1 tablet' then
    raise exception 'taper step 2 wrong';
  end if;
  if exists (select 1 from private.medication_slots_on('{"kind":"as_needed"}', null, date '2026-10-05')) then
    raise exception 'as_needed must have no slots';
  end if;
  if (select array_agg(slot_time) from private.medication_slots_on(null, '["07:00"]', date '2026-10-05')) is distinct from array['07:00'] then
    raise exception 'legacy schedule_times expansion wrong';
  end if;

  if (select count(*) from public.medicine_config where is_active) <> 1 then
    raise exception 'exactly one active medicine_config row expected';
  end if;
  if exists (select 1 from information_schema.table_privileges
              where table_name in ('medicine_config', 'medication_supply') and grantee in ('anon', 'PUBLIC')) then
    raise exception 'medicine tables must not be reachable by anon';
  end if;

  foreach fn in array array[
    'private.medication_slots_on(jsonb,jsonb,date)', 'private.medication_supply_status(uuid,timestamptz)',
    'private.weekly_adherence(uuid,timestamptz)', 'private.mark_overdue_doses_missed(timestamptz)',
    'private.emit_adherence_signals(timestamptz)', 'public.medication_weekly_adherence(uuid,text)'] loop
    if has_function_privilege('anon', fn, 'EXECUTE') then
      raise exception '% must not be executable by anon', fn;
    end if;
  end loop;
  foreach fn in array array[
    'private.medication_slots_on(jsonb,jsonb,date)', 'private.medication_supply_status(uuid,timestamptz)',
    'private.weekly_adherence(uuid,timestamptz)', 'private.mark_overdue_doses_missed(timestamptz)',
    'private.emit_adherence_signals(timestamptz)'] loop
    if has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception '% must not be executable by authenticated', fn;
    end if;
  end loop;

  if (select count(*) from cron.job where jobname in ('medicine-missed-dose-job-every-15-min', 'medicine-adherence-signals-daily')) <> 2 then
    raise exception 'S08 cron jobs were not scheduled';
  end if;
  if (select reloptions::text from pg_class where oid = 'public.medication_logs_latest_per_slot'::regclass) not like '%security_invoker=on%' then
    raise exception 'medication_logs_latest_per_slot must stay security_invoker';
  end if;
end $$;
