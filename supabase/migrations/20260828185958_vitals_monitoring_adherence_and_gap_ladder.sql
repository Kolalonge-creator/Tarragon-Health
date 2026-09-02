-- Tarragon Health — Monitoring Engine: adherence tracking (§6.13) + risk-
-- aware missed-monitoring escalation ladder (§6.14)
--
-- §6.13 wants "expected readings / completed / missed / adherence %" — today
-- "adherence" in this codebase means MEDICATION adherence only
-- (20260716175000_medication_adherence_escalation.sql and friends); nothing
-- computes it for vitals monitoring. public.patient_vitals_adherence() does,
-- reading monitoring_schedule_items (previous migration) against
-- vitals_readings over a rolling window.
--
-- §6.14 wants "Due -> Reminder -> Still missed -> Second reminder -> Care
-- team notification if clinically relevant" AND explicitly "Missing a BP
-- reading in a low-risk patient should not generate the same workflow as
-- missing monitoring in a high-risk patient." Today the only missed-
-- monitoring detection at all is private.flag_overdue_vitals() — BP/
-- diabetes-condition only, one fixed step (a single clinician_alerts row
-- once freq_days+7 days pass), not risk-aware.
--
-- private.evaluate_vitals_monitoring_gaps() generalises this to EVERY
-- scheduled vital (glucose/weight/spo2/temperature/pulse/waist — none of
-- which have any missed-reading detection today) and reuses the same
-- upcoming/due/overdue/escalated reminder_stage ladder installed on
-- monitoring_schedule_items. Staging is risk-level-dependent via
-- private.vitals_monitoring_grace_days(): a higher risk_level (from
-- patient_risk_scores) tightens the grace window between stages, a lower
-- one widens it — the direct implementation of §6.14's example. It
-- deliberately never runs the escalated-stage clinician_alerts step for
-- blood_pressure — flag_overdue_vitals() already owns that gap for BP, and
-- this must not raise a second, separately-tracked alert for the same
-- missing reading. 'upcoming' is never set here: unlike a one-off
-- screening due_date, a recurring cadence has no single future date to be
-- "upcoming" for, so this ladder only ever runs due -> overdue ->
-- escalated.
--
-- A genuine reading resets the ladder immediately
-- (private.reset_monitoring_gap_on_reading), same auto-resolve-on-any-
-- reading behaviour flag_overdue_vitals() already has for BP.

-- ---------------------------------------------------------------------------
-- Adherence
-- ---------------------------------------------------------------------------

create or replace function public.patient_vitals_adherence(p_patient_id uuid, p_window_days integer default 28)
returns table (
  schedule_item_id   uuid,
  vital_type         public.vital_type,
  frequency_per_week integer,
  expected_count     integer,
  completed_count    integer,
  missed_count       integer,
  adherence_pct      numeric
)
language sql
stable
set search_path = ''
as $$
  -- Deliberately plain SECURITY INVOKER (the default): both tables read here
  -- already carry an RLS policy covering "the patient themselves, or org
  -- staff" — same reasoning as patient_monitoring_latest_readings.
  with items as (
    select
      id, vital_type, frequency_per_week,
      greatest(start_date, current_date - (p_window_days - 1)) as window_start
    from public.monitoring_schedule_items
    where patient_id = p_patient_id and status = 'active'
  ),
  expected as (
    select
      id, vital_type, frequency_per_week,
      greatest(ceil(frequency_per_week * (current_date - window_start + 1) / 7.0)::int, 0) as expected_count,
      window_start
    from items
  ),
  completed as (
    select e.id, count(vr.id)::int as completed_count
    from expected e
    left join public.vitals_readings vr
      on vr.patient_id = p_patient_id
     and vr.vital_type = e.vital_type
     and vr.taken_at >= e.window_start::timestamptz
    group by e.id
  )
  select
    e.id,
    e.vital_type,
    e.frequency_per_week,
    e.expected_count,
    coalesce(c.completed_count, 0),
    greatest(e.expected_count - coalesce(c.completed_count, 0), 0),
    case when e.expected_count = 0 then 100
         else round(least(coalesce(c.completed_count, 0), e.expected_count)::numeric / e.expected_count * 100)
    end
  from expected e
  left join completed c on c.id = e.id
  order by e.vital_type;
$$;

grant execute on function public.patient_vitals_adherence(uuid, integer) to authenticated;
revoke execute on function public.patient_vitals_adherence(uuid, integer) from public;

-- ---------------------------------------------------------------------------
-- Risk-aware grace windows
-- ---------------------------------------------------------------------------

-- Most severe risk_level on file within the last 6 months, across any
-- score_type — a patient with any recent high-risk score gets the faster
-- ladder even if their most recently COMPUTED score happens to be a
-- lower-priority one. No recent score at all resolves to null, which
-- vitals_monitoring_grace_days() below treats the same as 'moderate' — a
-- deliberately middling default rather than assuming everyone unscored is
-- low-risk (which would under-escalate) or high-risk (which would alarm
-- every new patient before any score exists).
create or replace function private.patient_worst_risk_level(p_patient_id uuid)
returns public.risk_level
language sql
stable
set search_path = ''
as $$
  select risk_level
  from public.patient_risk_scores
  where patient_id = p_patient_id
    and computed_at > now() - interval '6 months'
    and risk_level is not null
    and risk_level <> 'unknown'
  order by
    case risk_level
      when 'very_high' then 4
      when 'high' then 3
      when 'moderate' then 2
      when 'low' then 1
      else 0
    end desc,
    computed_at desc
  limit 1;
$$;

-- Extra grace days added per stage of the ladder. Lower = faster escalation.
create or replace function private.vitals_monitoring_grace_days(p_risk_level public.risk_level)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_risk_level
    when 'very_high' then 1
    when 'high' then 2
    when 'low' then 7
    else 4  -- moderate, or no recent score on file
  end;
$$;

-- ---------------------------------------------------------------------------
-- clinician_alerts gains a link back to the schedule item a missed-
-- monitoring alert is about — same precedent as vital_reading_id/
-- screening_result_id.
-- ---------------------------------------------------------------------------

alter table public.clinician_alerts
  add column if not exists monitoring_schedule_item_id uuid
    references public.monitoring_schedule_items (id) on delete set null;

-- ---------------------------------------------------------------------------
-- The ladder itself
-- ---------------------------------------------------------------------------

create or replace function private.evaluate_vitals_monitoring_gaps()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item                 record;
  v_last_reading_at       timestamptz;
  v_days_since            integer;
  v_gap_days              integer;
  v_risk                  public.risk_level;
  v_grace                 integer;
  v_due_threshold         integer;
  v_overdue_threshold     integer;
  v_escalated_threshold   integer;
  v_vital_label           text;
  v_existing_alert_id     uuid;
begin
  for v_item in
    select * from public.monitoring_schedule_items
    where status = 'active' and (end_date is null or end_date >= current_date)
  loop
    select max(taken_at) into v_last_reading_at
    from public.vitals_readings
    where patient_id = v_item.patient_id
      and vital_type = v_item.vital_type
      and taken_at >= v_item.start_date::timestamptz;

    v_days_since := current_date - coalesce(v_last_reading_at::date, v_item.start_date);
    v_gap_days := ceil(7.0 / v_item.frequency_per_week)::int;

    v_risk := private.patient_worst_risk_level(v_item.patient_id);
    v_grace := private.vitals_monitoring_grace_days(v_risk);

    v_due_threshold := v_gap_days + v_grace;
    v_overdue_threshold := v_gap_days + (2 * v_grace);
    v_escalated_threshold := v_gap_days + (3 * v_grace);

    -- Always used through lower() below, so this only needs to turn the enum's
    -- underscore_case into words — no point capitalising what gets lowered again.
    v_vital_label := replace(v_item.vital_type::text, '_', ' ');

    if v_days_since >= v_escalated_threshold and v_item.reminder_stage is distinct from 'escalated' then
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values
        (v_item.organisation_id, v_item.patient_id, 'whatsapp', 'pending', 'vitals_monitoring_escalated',
         jsonb_build_object('vital_type', v_item.vital_type, 'days_since', v_days_since)),
        (v_item.organisation_id, v_item.patient_id, 'in_app', 'pending', 'vitals_monitoring_escalated',
         jsonb_build_object('vital_type', v_item.vital_type, 'days_since', v_days_since));

      -- blood_pressure already has its own dedicated missing-reading path
      -- (private.flag_overdue_vitals) — skip so a missed BP schedule never
      -- raises two independently-tracked clinician_alerts for one gap.
      if v_item.vital_type <> 'blood_pressure' then
        select id into v_existing_alert_id
        from public.clinician_alerts
        where monitoring_schedule_item_id = v_item.id and status = 'open'
        order by created_at desc
        limit 1;

        if v_existing_alert_id is null then
          insert into public.clinician_alerts
            (organisation_id, patient_id, level, status, title, detail, sla_due_at,
             escalation_level, monitoring_schedule_item_id)
          values (
            v_item.organisation_id, v_item.patient_id, 'clinician_review', 'open',
            format('Missing expected %s readings', lower(v_vital_label)),
            format(
              'No %s reading logged in %s days (expected roughly every %s day(s) at this patient''s prescribed frequency; risk level %s).',
              lower(v_vital_label), v_days_since, v_gap_days, coalesce(v_risk::text, 'unrated')
            ),
            now() + interval '72 hours', 2, v_item.id
          );
        end if;
      end if;

      update public.monitoring_schedule_items
        set reminder_stage = 'escalated', reminder_sent_at = now()
      where id = v_item.id;

    elsif v_days_since >= v_overdue_threshold and (v_item.reminder_stage is null or v_item.reminder_stage = 'due') then
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values
        (v_item.organisation_id, v_item.patient_id, 'whatsapp', 'pending', 'vitals_monitoring_overdue',
         jsonb_build_object('vital_type', v_item.vital_type, 'days_since', v_days_since)),
        (v_item.organisation_id, v_item.patient_id, 'in_app', 'pending', 'vitals_monitoring_overdue',
         jsonb_build_object('vital_type', v_item.vital_type, 'days_since', v_days_since));

      update public.monitoring_schedule_items
        set reminder_stage = 'overdue', reminder_sent_at = now()
      where id = v_item.id;

    elsif v_days_since >= v_due_threshold and v_item.reminder_stage is null then
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values
        (v_item.organisation_id, v_item.patient_id, 'whatsapp', 'pending', 'vitals_monitoring_due',
         jsonb_build_object('vital_type', v_item.vital_type, 'days_since', v_days_since)),
        (v_item.organisation_id, v_item.patient_id, 'in_app', 'pending', 'vitals_monitoring_due',
         jsonb_build_object('vital_type', v_item.vital_type, 'days_since', v_days_since));

      update public.monitoring_schedule_items
        set reminder_stage = 'due', reminder_sent_at = now()
      where id = v_item.id;
    end if;
  end loop;
end;
$$;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'vitals-monitoring-gaps-daily') then
    perform cron.unschedule('vitals-monitoring-gaps-daily');
  end if;
end $$;

select cron.schedule('vitals-monitoring-gaps-daily', '45 6 * * *', $$ select private.evaluate_vitals_monitoring_gaps(); $$);

-- ---------------------------------------------------------------------------
-- Auto-reset the moment a genuine reading arrives.
-- ---------------------------------------------------------------------------

create or replace function private.reset_monitoring_gap_on_reading()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_id uuid;
begin
  select id into v_item_id
  from public.monitoring_schedule_items
  where patient_id = new.patient_id
    and vital_type = new.vital_type
    and status = 'active'
    and reminder_stage is not null
  limit 1;

  if v_item_id is not null then
    update public.monitoring_schedule_items
      set reminder_stage = null, reminder_sent_at = null
    where id = v_item_id;

    update public.clinician_alerts
      set status = 'resolved', updated_at = now()
    where monitoring_schedule_item_id = v_item_id and status = 'open';
  end if;

  return new;
end;
$$;

drop trigger if exists vitals_readings_reset_monitoring_gap on public.vitals_readings;
create trigger vitals_readings_reset_monitoring_gap
  after insert on public.vitals_readings
  for each row
  execute function private.reset_monitoring_gap_on_reading();

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'patient_vitals_adherence'
  ) then
    raise exception 'FAIL: public.patient_vitals_adherence() was not installed';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinician_alerts' and column_name = 'monitoring_schedule_item_id'
  ) then
    raise exception 'FAIL: clinician_alerts.monitoring_schedule_item_id was not added';
  end if;
  if not exists (
    select 1 from cron.job where jobname = 'vitals-monitoring-gaps-daily'
  ) then
    raise exception 'FAIL: vitals-monitoring-gaps-daily cron job was not scheduled';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'vitals_readings_reset_monitoring_gap'
  ) then
    raise exception 'FAIL: vitals_readings_reset_monitoring_gap trigger was not installed';
  end if;

  raise notice 'PASS: vitals adherence + missed-monitoring gap ladder installed';
end $$;
