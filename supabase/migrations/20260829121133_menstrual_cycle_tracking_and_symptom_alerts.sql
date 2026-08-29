-- Tarragon Health — Women's Health platform, part 1: menstrual cycle tracking
-- + symptom pattern alerts (spec §44.3/44.4).
--
-- reproductive_health_profiles (20260724001210) already carries a single
-- self-reported life_stage/last_period_date/average_cycle_length_days row per
-- patient — a snapshot, not a log. This adds the actual per-period log
-- (period dates, duration, flow, pain, symptoms) the spec asks for, plus a
-- deterministic pattern-alert engine modelled directly on the existing
-- bp_red_flag_engine / alert_generators_previously_uncovered_types shape:
-- private.raise_clinician_alert(...) into the unified clinician_alerts inbox
-- (category 'clinical', type_code 'symptom_escalation' — a real, taxonomy-
-- assigned type with no generator yet, see 20260828015618's own note that it
-- was deliberately left ungenerated pending "a real event source").
--
-- §44.3 is explicit that cycle predictions must never be presented as
-- medically certain — this migration stores only what the patient reports;
-- any predictive copy belongs in lib/rules/cycle-nudges.ts (app layer),
-- which already carries that discipline.
--
-- Deliberately does NOT duplicate the one-touch emergency pathway: "severe
-- bleeding that won't stop" is already a DANGER_SIGNS emergency sign. This
-- engine looks for *patterns* across logged periods (heavy flow or severe
-- pain repeating, or a materially changed cycle length) — a clinician_review
-- alert, not an emergency — exactly the distinction the spec draws between
-- "may warrant clinical assessment" and the acute emergency checklist.

create type public.menstrual_flow_level as enum ('spotting', 'light', 'medium', 'heavy');

create table if not exists public.menstrual_cycle_logs (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  period_start_date date not null,
  period_end_date   date,
  flow_level        public.menstrual_flow_level,
  pain_level        smallint check (pain_level between 0 and 10),
  symptoms          text[] not null default '{}',
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint menstrual_cycle_logs_dates_order
    check (period_end_date is null or period_end_date >= period_start_date)
);

create index if not exists menstrual_cycle_logs_patient_idx
  on public.menstrual_cycle_logs (patient_id, period_start_date desc);
create index if not exists menstrual_cycle_logs_org_idx
  on public.menstrual_cycle_logs (organisation_id);

drop trigger if exists menstrual_cycle_logs_set_updated_at on public.menstrual_cycle_logs;
create trigger menstrual_cycle_logs_set_updated_at
  before update on public.menstrual_cycle_logs
  for each row execute function private.set_updated_at();

alter table public.menstrual_cycle_logs enable row level security;

-- Same shape as reproductive_health_profiles: patient owns their own log; org
-- staff read within the org; a profile_access 'manage' grantee may read/write
-- on behalf of a managed profile.
drop policy if exists menstrual_cycle_logs_select on public.menstrual_cycle_logs;
create policy menstrual_cycle_logs_select on public.menstrual_cycle_logs
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = menstrual_cycle_logs.patient_id
        and pa.grantee_user_id = (select auth.uid())
    )
  );

drop policy if exists menstrual_cycle_logs_insert on public.menstrual_cycle_logs;
create policy menstrual_cycle_logs_insert on public.menstrual_cycle_logs
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = menstrual_cycle_logs.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  );

drop policy if exists menstrual_cycle_logs_update on public.menstrual_cycle_logs;
create policy menstrual_cycle_logs_update on public.menstrual_cycle_logs
  for update to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = menstrual_cycle_logs.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  )
  with check (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = menstrual_cycle_logs.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  );

-- No delete grant — an append-and-amend log, like vitals_readings; a wrong
-- entry is corrected (period_end_date, flow_level, notes), not erased.
grant select, insert, update on public.menstrual_cycle_logs to authenticated;

-- ---------------------------------------------------------------------------
-- Pattern-alert engine (§44.4): heavy bleeding, persistent severe pain, or a
-- materially changed cycle length across the patient's most recent logs.
-- Fires on insert or update (a period_end_date/flow_level added after the
-- fact still needs to be checked) via private.raise_clinician_alert, which
-- itself relies on classify_and_assign_clinician_alert (20260828014055) for
-- severity/dedup/auto-assignment — this function only decides *whether* a
-- pattern is present, never severity or routing.
-- ---------------------------------------------------------------------------
create or replace function private.handle_menstrual_cycle_log_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent_heavy_count integer;
  v_recent_severe_pain_count integer;
  v_previous_start date;
  v_typical_cycle_days integer;
  v_actual_cycle_days integer;
begin
  select count(*) filter (where flow_level = 'heavy'),
         count(*) filter (where pain_level >= 8)
    into v_recent_heavy_count, v_recent_severe_pain_count
  from (
    select flow_level, pain_level
    from public.menstrual_cycle_logs
    where patient_id = new.patient_id
    order by period_start_date desc
    limit 3
  ) recent;

  if v_recent_heavy_count >= 2 then
    perform private.raise_clinician_alert(
      new.organisation_id, new.patient_id, 'clinician_review',
      'Possible heavy menstrual bleeding pattern',
      format('Heavy flow reported on %s of the last 3 logged periods (most recent starting %s).',
        v_recent_heavy_count, new.period_start_date),
      'clinical', 'symptom_escalation'
    );
  end if;

  if v_recent_severe_pain_count >= 2 then
    perform private.raise_clinician_alert(
      new.organisation_id, new.patient_id, 'clinician_review',
      'Persistent severe menstrual pain reported',
      format('Pain rated 8/10 or higher on %s of the last 3 logged periods (most recent starting %s).',
        v_recent_severe_pain_count, new.period_start_date),
      'clinical', 'symptom_escalation'
    );
  end if;

  -- Significant cycle-length change: compare this period's gap since the
  -- previous logged period against the patient's self-reported average
  -- (reproductive_health_profiles.average_cycle_length_days). Only evaluated
  -- when both a previous log and a stated average exist.
  select period_start_date into v_previous_start
  from public.menstrual_cycle_logs
  where patient_id = new.patient_id and period_start_date < new.period_start_date
  order by period_start_date desc
  limit 1;

  if v_previous_start is not null then
    v_actual_cycle_days := new.period_start_date - v_previous_start;
    select average_cycle_length_days into v_typical_cycle_days
    from public.reproductive_health_profiles
    where patient_id = new.patient_id;

    if v_typical_cycle_days is not null
       and v_actual_cycle_days > 0
       and abs(v_actual_cycle_days - v_typical_cycle_days) >= 10 then
      perform private.raise_clinician_alert(
        new.organisation_id, new.patient_id, 'clinician_review',
        'Significant menstrual cycle change',
        format('Latest cycle was %s days, versus a self-reported average of %s days.',
          v_actual_cycle_days, v_typical_cycle_days),
        'clinical', 'symptom_escalation'
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.handle_menstrual_cycle_log_alert() from public, anon;

drop trigger if exists menstrual_cycle_logs_raise_pattern_alert on public.menstrual_cycle_logs;
create trigger menstrual_cycle_logs_raise_pattern_alert
  after insert or update on public.menstrual_cycle_logs
  for each row execute function private.handle_menstrual_cycle_log_alert();

-- ---------------------------------------------------------------------------
-- Missed-period sweep — same "staleness sweep" shape as
-- raise_overdue_task_alerts/raise_laboratory_failure_alerts
-- (20260828015618): a menstruating patient whose most recent logged period
-- is well past their own stated average + a two-week buffer is a "cycle
-- change" the insert-time trigger above can never see, since no new row is
-- ever logged for a missed period.
-- ---------------------------------------------------------------------------
create or replace function private.raise_missed_period_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.raise_clinician_alert(
    rhp.organisation_id, rhp.patient_id, 'clinician_review',
    'Possible missed or significantly delayed period',
    format('No period logged since %s (self-reported average cycle: %s days).',
      last_log.period_start_date, rhp.average_cycle_length_days),
    'clinical', 'symptom_escalation'
  )
  from public.reproductive_health_profiles rhp
  join lateral (
    select period_start_date
    from public.menstrual_cycle_logs mcl
    where mcl.patient_id = rhp.patient_id
    order by period_start_date desc
    limit 1
  ) last_log on true
  where rhp.life_stage = 'menstruating'
    and rhp.average_cycle_length_days is not null
    and last_log.period_start_date < current_date - (rhp.average_cycle_length_days + 14)
    and not exists (
      select 1 from public.clinician_alerts ca
      where ca.type_code = 'symptom_escalation' and ca.patient_id = rhp.patient_id
        and ca.status in ('open', 'acknowledged') and ca.created_at > now() - interval '20 days'
    );
end;
$$;

comment on function private.raise_missed_period_alerts() is
  'Daily sweep: a menstruating patient whose last logged period start is more than (average_cycle_length_days + 14) days ago raises a clinician_review clinician_alerts row (symptom_escalation) -- a missed/delayed period has no insert event of its own to trigger on.';

revoke all on function private.raise_missed_period_alerts() from public, anon;

select cron.schedule('menstrual-missed-period-alerts', '20 4 * * *', $$select private.raise_missed_period_alerts()$$);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'menstrual_flow_level') then
    raise exception 'menstrual_flow_level enum was not created';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'menstrual_cycle_logs') then
    raise exception 'menstrual_cycle_logs table was not created';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'menstrual_cycle_logs_raise_pattern_alert' and tgrelid = 'public.menstrual_cycle_logs'::regclass and not tgisinternal) then
    raise exception 'menstrual_cycle_logs_raise_pattern_alert trigger was not created';
  end if;
  if not exists (select 1 from cron.job where jobname = 'menstrual-missed-period-alerts') then
    raise exception 'menstrual-missed-period-alerts cron job was not scheduled';
  end if;
  if has_table_privilege('anon', 'public.menstrual_cycle_logs', 'SELECT') then
    raise exception 'anon must not have access to menstrual_cycle_logs';
  end if;
  raise notice 'PASS: menstrual_cycle_logs + pattern-alert engine installed';
end $$;
