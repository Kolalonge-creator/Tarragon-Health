-- S08 review fixes (code review, 2026-10-04).
--
--   1. A schedule edit no longer invents history. The missed job and the weekly
--      adherence function started counting a medicine's slots at medications.created_at,
--      so adding a 20:00 time on Monday made Saturday's and Sunday's 20:00 "missed" and
--      could raise an adherence alert for doses nobody was ever asked to take.
--      medications.schedule_effective_from is stamped when schedule_times or
--      schedule_spec change (and at insert); slots due before the later of it and
--      created_at are not counted. The trigger is named so it runs after
--      medications_a_patient_allowlist, which therefore never sees the stamp.
--   2. A stale past refill_date no longer hides a pill-count run-out: only a refill
--      date that is today or later takes part in the "earliest due date".
--   3. Suspended accounts (profiles.is_active = false) get no server "missed" rows and
--      no weekly adherence signal.
--
-- Row counts at writing (live): medications 4, medication_logs 0, medication_supply 0.
-- schedule_effective_from is nullable and not backfilled: null reads as created_at.

alter table public.medications add column if not exists schedule_effective_from timestamptz;

create or replace function private.stamp_medication_schedule_effective_from()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.schedule_effective_from := coalesce(new.created_at, now());
  elsif new.schedule_times is distinct from old.schedule_times
     or new.schedule_spec is distinct from old.schedule_spec then
    new.schedule_effective_from := now();
  end if;
  return new;
end;
$$;
drop trigger if exists medications_stamp_schedule_effective_from on public.medications;
create trigger medications_stamp_schedule_effective_from before insert or update on public.medications
  for each row execute function private.stamp_medication_schedule_effective_from();
revoke all on function private.stamp_medication_schedule_effective_from() from public, anon, authenticated;

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
               greatest(m.created_at, coalesce(m.schedule_effective_from, m.created_at)) as active_from
          from public.medications m
         cross join lateral generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') g(d)
         cross join lateral private.medication_slots_on(m.schedule_spec, m.schedule_times, g.d::date) sl
         where m.patient_id = p_patient and m.is_active and m.superseded_at is null
      ) s
      left join public.medication_logs_latest_per_slot v
        on v.medication_id = s.med_id and v.scheduled_for_date = s.sdate and v.scheduled_time = s.slot_time
     where s.due_at <= p_now and s.due_at >= s.active_from
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
      join public.profiles p on p.id = m.patient_id and p.is_active
     cross join lateral generate_series((v_today - 3)::timestamp, v_today::timestamp, interval '1 day') g(d)
     cross join lateral private.medication_slots_on(m.schedule_spec, m.schedule_times, g.d::date) sl
     where m.is_active and m.stopped_at is null and m.superseded_at is null
       and ((g.d::date + sl.slot_time::time) at time zone 'Africa/Lagos')
             + make_interval(mins => c.server_missed_after_minutes) <= p_now
       and ((g.d::date + sl.slot_time::time) at time zone 'Africa/Lagos')
             >= greatest(m.created_at, coalesce(m.schedule_effective_from, m.created_at))
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
  for r in
    select distinct m.patient_id, m.organisation_id
      from public.medications m
      join public.profiles p on p.id = m.patient_id and p.is_active
     where m.is_active and m.superseded_at is null
  loop
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
      -- Only a refill date that is today or later takes part: a stale past date must not
      -- hide a pill-count run-out (least() ignores a null).
      select cand.*,
             least(case when refill_date >= v_today then refill_date end, run_out) as due_date
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

revoke all on function private.weekly_adherence(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.mark_overdue_doses_missed(timestamptz) from public, anon, authenticated;
revoke all on function private.emit_adherence_signals(timestamptz) from public, anon, authenticated;

do $$
declare fn text;
begin
  foreach fn in array array[
    'private.weekly_adherence(uuid,timestamptz)', 'private.mark_overdue_doses_missed(timestamptz)',
    'private.emit_adherence_signals(timestamptz)', 'private.stamp_medication_schedule_effective_from()'] loop
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception '% must not be executable by clients', fn;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.medications'::regclass
                  and tgname = 'medications_stamp_schedule_effective_from') then
    raise exception 'schedule_effective_from trigger missing';
  end if;
  -- The allowlist trigger must run before the stamping one, so a patient's reminder-time edit passes it.
  if not ('medications_a_patient_allowlist' < 'medications_stamp_schedule_effective_from') then
    raise exception 'trigger order assumption broken';
  end if;
end $$;
