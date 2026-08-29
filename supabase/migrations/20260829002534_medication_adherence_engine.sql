-- Tarragon Health — Module 21: Medication Access & Adherence Engine, part 3/7.
--
-- §21.9 adherence measurement + §21.10 adherence trends. The acceptance
-- criterion (§21.16) is "why isn't this patient taking the medicine", not a
-- bare percentage — so this computes a real trailing-window percentage from
-- dose-log history (never from dispensing/collection alone, §21.9's explicit
-- warning) and floors the resulting status using two signals a percentage
-- alone would miss: an open doctor-level entry on the existing missed-dose
-- ladder (medication_adherence_alerts, 20260716175000) and repeated
-- "forgot" access check-ins (part 2) — a patient who forgets to log AND
-- forgets to take is invisible to the log-based calculation alone.
--
-- private.compute_medication_adherence() is the single source of truth,
-- called from three places so medications.adherence_status/adherence_pct_30d
-- never drift from what it would compute fresh: a new dose log, a new access
-- check-in (extending part 2's handler), and a nightly sweep that catches
-- pure silence — a patient who simply stops logging entirely triggers
-- neither of the first two, so nothing else would ever notice the decay.

create or replace function private.compute_medication_adherence(p_medication_id uuid)
returns table (status public.medication_adherence_status, pct numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_med record;
  v_window_start date;
  v_days integer;
  v_doses_per_day integer;
  v_taken integer;
  v_logged integer;
  v_pct numeric;
  v_status public.medication_adherence_status;
  v_has_doctor_alert boolean;
  v_recent_forgot integer;
begin
  select id, created_at::date as started, schedule_times
  into v_med
  from public.medications
  where id = p_medication_id and is_active;

  if not found then
    return query select 'unknown'::public.medication_adherence_status, null::numeric;
    return;
  end if;

  -- Trailing 30 days, or since the medication started if that is more
  -- recent — a 2-day-old prescription should not be scored against 30 days
  -- of doses that were never due.
  v_window_start := greatest(v_med.started, current_date - 29);
  v_days := (current_date - v_window_start) + 1;
  v_doses_per_day := jsonb_array_length(coalesce(v_med.schedule_times, '[]'::jsonb));

  select count(*) filter (where status = 'taken'), count(*)
  into v_taken, v_logged
  from public.medication_logs
  where medication_id = p_medication_id
    and coalesce(scheduled_for_date, logged_at::date) >= v_window_start;

  if v_doses_per_day > 0 then
    -- Structured schedule: denominator is doses actually DUE, not just
    -- doses the patient happened to log — an unlogged slot counts against
    -- adherence rather than being invisible, which is what makes this
    -- honest per §21.9 rather than a self-report-only percentage.
    v_pct := round(least(100, 100.0 * v_taken / greatest(v_doses_per_day * v_days, 1)), 1);
  elsif v_logged > 0 then
    -- Freeform/as-needed dosing has no fixed schedule to compute an
    -- expected-dose denominator against; fall back to taken-of-logged, which
    -- is weaker but still better than declaring it unmeasurable.
    v_pct := round(100.0 * v_taken / v_logged, 1);
  else
    v_pct := null;
  end if;

  v_status := case
    when v_pct is null then 'unknown'
    when v_pct >= 90 then 'taking'
    when v_pct >= 50 then 'frequently_missed'
    else 'not_taking'
  end;

  select exists (
    select 1 from public.medication_adherence_alerts
    where medication_id = p_medication_id and level = 'doctor' and status <> 'resolved'
  ) into v_has_doctor_alert;

  select count(*) into v_recent_forgot
  from public.medication_access_checkins
  where medication_id = p_medication_id
    and barrier = 'forgot'
    and created_at >= now() - interval '30 days';

  -- Never report better than what the platform's own escalation ladder or
  -- the patient's own "I forgot" reports already say — a floor, not an
  -- override, so a genuinely worse computed status is never masked.
  if v_has_doctor_alert and v_status in ('taking', 'unknown') then
    v_status := 'frequently_missed';
  end if;
  if v_recent_forgot >= 2 and v_status = 'taking' then
    v_status := 'frequently_missed';
  end if;

  return query select v_status, v_pct;
end;
$$;

comment on function private.compute_medication_adherence(uuid) is
  'Trailing-window adherence status + percentage for one medication (§21.9). Denominator is doses DUE per schedule_times, not doses logged, so silence counts against adherence. Floored (never improved) by an open doctor-level medication_adherence_alerts entry or 2+ recent "forgot" access check-ins. Only ever called from SECURITY DEFINER trigger/cron contexts in this schema — not exposed to clients.';

-- ---------------------------------------------------------------------------
-- Trigger 1: a new dose log recomputes immediately.
-- ---------------------------------------------------------------------------

create or replace function private.sync_medication_adherence_from_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  select * into v_row from private.compute_medication_adherence(new.medication_id);
  update public.medications
    set adherence_status = v_row.status, adherence_pct_30d = v_row.pct
    where id = new.medication_id
      and (adherence_status is distinct from v_row.status or adherence_pct_30d is distinct from v_row.pct);
  return new;
end;
$$;

create trigger medication_logs_sync_adherence_status
  after insert on public.medication_logs
  for each row execute function private.sync_medication_adherence_from_log();

-- ---------------------------------------------------------------------------
-- Trigger 2: extend part 2's check-in handler to also recompute (the
-- "forgot" floor above needs this — a check-in itself is not a dose log).
-- Same trigger name/attachment as part 2 created; only the function body
-- changes, matching how 20260730224249 extended an earlier migration's
-- function in place.
-- ---------------------------------------------------------------------------

create or replace function private.handle_medication_access_checkin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_drug text;
  v_new_access_status public.medication_access_status;
  v_level public.alert_level;
  v_type_code public.alert_type_code;
  v_title text;
  v_detail text;
  v_adherence record;
begin
  select drug_name into v_drug from public.medications where id = new.medication_id;

  if new.obtained = 'yes' then
    update public.medications set access_status = 'available' where id = new.medication_id;
  else
    v_new_access_status := case new.barrier
      when 'too_expensive' then 'too_expensive'
      when 'out_of_stock' then 'out_of_stock'
      when 'pharmacy_unavailable' then 'unable_to_collect'
      when 'prescription_issue' then 'unable_to_collect'
      else null
    end;

    if v_new_access_status is not null then
      update public.medications set access_status = v_new_access_status where id = new.medication_id;
    end if;

    if new.barrier <> 'forgot' then
      v_level := case new.obtained when 'no' then 'clinician_review' else 'routine' end;
      v_type_code := case when new.barrier = 'prescription_issue' then 'refill_due' else 'pharmacy_problem' end;
      v_title := format('Medication access problem: %s', coalesce(v_drug, 'a medication'));
      v_detail := format(
        'Patient reported they %s able to obtain %s.%s%s',
        case new.obtained when 'no' then 'were not' else 'were only partially' end,
        coalesce(v_drug, 'their medication'),
        case when new.barrier is not null then ' Reason: ' || replace(new.barrier::text, '_', ' ') || '.' else '' end,
        case when new.notes is not null then ' Notes: ' || new.notes else '' end
      );

      perform private.raise_clinician_alert(
        new.organisation_id, new.patient_id, v_level, v_title, v_detail, 'medication', v_type_code
      );
    end if;
  end if;

  select * into v_adherence from private.compute_medication_adherence(new.medication_id);
  update public.medications
    set adherence_status = v_adherence.status, adherence_pct_30d = v_adherence.pct
    where id = new.medication_id
      and (adherence_status is distinct from v_adherence.status or adherence_pct_30d is distinct from v_adherence.pct);

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Nightly sweep: catches pure silence (no new log, no new check-in) —
-- otherwise a patient who stops logging entirely would keep their last
-- computed status forever.
-- ---------------------------------------------------------------------------

create or replace function private.recompute_medication_adherence_statuses()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.medications m
  set adherence_status = c.status, adherence_pct_30d = c.pct
  from public.medications active_m
  cross join lateral private.compute_medication_adherence(active_m.id) as c
  where active_m.is_active
    and m.id = active_m.id
    and (m.adherence_status is distinct from c.status or m.adherence_pct_30d is distinct from c.pct);
$$;

revoke all on function private.recompute_medication_adherence_statuses() from public, anon;

select cron.schedule(
  'medication-adherence-status-recompute-daily',
  '0 4 * * *',
  $$select private.recompute_medication_adherence_statuses();$$
);

-- ---------------------------------------------------------------------------
-- §21.10 adherence trends — month-by-month percentage, read directly off
-- medication_logs (no separate history table to keep in sync).
-- ---------------------------------------------------------------------------

create view public.medication_adherence_monthly_v
with (security_invoker = true) as
select
  m.id as medication_id,
  m.patient_id,
  m.organisation_id,
  date_trunc('month', coalesce(l.scheduled_for_date, l.logged_at::date))::date as month,
  count(*) filter (where l.status = 'taken') as taken_count,
  count(*) as logged_count,
  round(100.0 * count(*) filter (where l.status = 'taken') / greatest(count(*), 1), 1) as adherence_pct
from public.medications m
join public.medication_logs l on l.medication_id = m.id
group by m.id, m.patient_id, m.organisation_id, date_trunc('month', coalesce(l.scheduled_for_date, l.logged_at::date));

comment on view public.medication_adherence_monthly_v is
  'Module 21 §21.10 month-by-month adherence trend per medication, derived straight from medication_logs. Derived, RLS-respecting (security_invoker) view — no independent access control of its own. logged_count is doses actually logged, not doses due, so this is a coarser number than adherence_pct_30d on the medications row itself; it is meant for the trend line, not the headline figure.';

grant select on public.medication_adherence_monthly_v to authenticated;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'compute_medication_adherence' and pronamespace = 'private'::regnamespace) then
    raise exception 'private.compute_medication_adherence was not created';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'medication_logs_sync_adherence_status' and tgrelid = 'public.medication_logs'::regclass and not tgisinternal
  ) then
    raise exception 'medication_logs_sync_adherence_status trigger was not created';
  end if;
  if not exists (select 1 from cron.job where jobname = 'medication-adherence-status-recompute-daily') then
    raise exception 'medication-adherence-status-recompute-daily cron job was not scheduled';
  end if;
  if not exists (select 1 from information_schema.views where table_schema = 'public' and table_name = 'medication_adherence_monthly_v') then
    raise exception 'medication_adherence_monthly_v view was not created';
  end if;
  raise notice 'PASS: medication adherence engine (compute function, 2 triggers, nightly sweep, monthly trend view) installed';
end $$;
