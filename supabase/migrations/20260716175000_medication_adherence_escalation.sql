-- Tarragon Health — missed-dose escalation ladder (medication pathway, Phase 5)
--
-- Adherence programme: repeatedly missing a medication climbs a ladder
-- (pathway) — reminder → health coach → doctor review → medication adjustment.
-- Reminders already exist (refill + adherence check-ins). This adds the
-- coach/doctor rungs: as missed doses accumulate, an alert is raised on the
-- care-team worklist so a human follows up.
--
-- Driven by medication_logs (status='missed'): a BEFORE-existing 'missed' log
-- recomputes the trailing-30-day miss count for that medication and raises or
-- upgrades an alert:
--   • >= 3 missed / 30d → coach-level (health-coach outreach)
--   • >= 6 missed / 30d → doctor-level (doctor review / possible adjustment)
-- Alerts only ever upgrade (coach → doctor), never silently downgrade, and
-- acknowledged/resolved attribution is stamped server-side. One active alert
-- per medication. All idempotent-guarded.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'med_adherence_alert_level') then
    create type public.med_adherence_alert_level as enum ('coach', 'doctor');
  end if;
  if not exists (select 1 from pg_type where typname = 'med_adherence_alert_status') then
    create type public.med_adherence_alert_status as enum ('open', 'acknowledged', 'resolved');
  end if;
end $$;

create table if not exists public.medication_adherence_alerts (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  medication_id     uuid not null references public.medications (id) on delete cascade,
  level             public.med_adherence_alert_level not null,
  status            public.med_adherence_alert_status not null default 'open',
  missed_count      integer not null,
  window_days       integer not null default 30,
  acknowledged_by   uuid references public.clinical_staff (id) on delete set null,
  acknowledged_at   timestamptz,
  resolved_by       uuid references public.clinical_staff (id) on delete set null,
  resolved_at       timestamptz,
  resolution_note   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists med_adherence_alerts_org_idx
  on public.medication_adherence_alerts (organisation_id, status, level);
create index if not exists med_adherence_alerts_patient_idx
  on public.medication_adherence_alerts (patient_id);
-- One active (unresolved) alert per medication — the evaluator relies on this.
create unique index if not exists med_adherence_alerts_one_active_per_med
  on public.medication_adherence_alerts (medication_id) where status <> 'resolved';

drop trigger if exists med_adherence_alerts_set_updated_at on public.medication_adherence_alerts;
create trigger med_adherence_alerts_set_updated_at
  before update on public.medication_adherence_alerts
  for each row execute function private.set_updated_at();

alter table public.medication_adherence_alerts enable row level security;

-- Internal care-team worklist — org staff only, no patient access (the patient
-- sees reminders/check-ins, not the escalation record).
drop policy if exists med_adherence_alerts_select on public.medication_adherence_alerts;
create policy med_adherence_alerts_select on public.medication_adherence_alerts
  for select to authenticated using (private.is_org_staff(organisation_id));
drop policy if exists med_adherence_alerts_update on public.medication_adherence_alerts;
create policy med_adherence_alerts_update on public.medication_adherence_alerts
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, update on public.medication_adherence_alerts to authenticated;

-- --- acknowledge / resolve attribution (server-derived) ----------------------
create or replace function private.stamp_adherence_alert_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  select id into v_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active;

  if new.status = 'acknowledged' and old.status is distinct from 'acknowledged' then
    new.acknowledged_by := v_staff_id;
    new.acknowledged_at := coalesce(new.acknowledged_at, now());
  end if;
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.resolved_by := v_staff_id;
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists med_adherence_alerts_stamp_transition on public.medication_adherence_alerts;
create trigger med_adherence_alerts_stamp_transition
  before update on public.medication_adherence_alerts
  for each row execute function private.stamp_adherence_alert_transition();

-- --- evaluator: a missed dose raises/upgrades the alert ----------------------
create or replace function private.evaluate_adherence_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missed integer;
  v_level  public.med_adherence_alert_level;
  v_alert  public.medication_adherence_alerts%rowtype;
begin
  if new.status <> 'missed' then
    return new;
  end if;

  select count(*) into v_missed
  from public.medication_logs
  where medication_id = new.medication_id
    and status = 'missed'
    and logged_at >= now() - interval '30 days';

  if v_missed >= 6 then
    v_level := 'doctor';
  elsif v_missed >= 3 then
    v_level := 'coach';
  else
    return new;
  end if;

  select * into v_alert
  from public.medication_adherence_alerts
  where medication_id = new.medication_id and status <> 'resolved'
  limit 1;

  if v_alert.id is null then
    insert into public.medication_adherence_alerts
      (organisation_id, patient_id, medication_id, level, missed_count)
    values
      (new.organisation_id, new.patient_id, new.medication_id, v_level, v_missed);
  else
    update public.medication_adherence_alerts
      set missed_count = v_missed,
          -- only ever upgrade the rung
          level = case when v_level = 'doctor' then 'doctor' else level end,
          -- a fresh doctor-level breach re-opens an acknowledged coach alert
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

drop trigger if exists medication_logs_evaluate_escalation on public.medication_logs;
create trigger medication_logs_evaluate_escalation
  after insert on public.medication_logs
  for each row execute function private.evaluate_adherence_escalation();
