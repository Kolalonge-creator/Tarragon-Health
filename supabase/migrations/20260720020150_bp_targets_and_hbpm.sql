-- Tarragon Health — Hypertension pathway H5 (individualised BP targets) +
-- H4 (HBPM 7-day averaging). TH-CP-HTN-001 §5.3, §6.1, §6.2, §12.2.
--
-- H5: home BP targets are LOWER than clinic targets and are patient-specific
-- (<135/85 most; <130/80 for diabetes/CKD/CVD/heart failure; individualised for
-- the frail elderly). Until now the platform carried one generic target as text
-- in condition_protocols. patient_bp_targets stores an explicit doctor-set
-- target; private.patient_home_bp_target derives one when none is set. The BP
-- red-flag trigger now decides "above target" (amber) against this target, so a
-- high-risk patient at 132/82 is correctly flagged above target.
--
-- H4: the 7-day HBPM protocol (§5.3) — 2 AM + 2 PM readings x7 days, DISCARD
-- day 1, average the rest; home hypertension = average >=135/85. This average
-- (not any single reading) is the number used for diagnosis and periodic
-- reassessment (§6.2 "do not diagnose on one reading").

-- ---------------------------------------------------------------------------
-- H5.1  patient_bp_targets — one active target per patient, doctor-set
-- ---------------------------------------------------------------------------
create table if not exists public.patient_bp_targets (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  category         text not null default 'standard'
                     check (category in ('standard','high_risk','frail','custom')),
  home_systolic    smallint not null check (home_systolic between 100 and 180),
  home_diastolic   smallint not null check (home_diastolic between 60 and 110),
  office_systolic  smallint not null check (office_systolic between 100 and 180),
  office_diastolic smallint not null check (office_diastolic between 60 and 110),
  rationale        text,
  set_by           uuid references public.clinical_staff (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (patient_id)
);

create index if not exists patient_bp_targets_org_idx on public.patient_bp_targets (organisation_id);

drop trigger if exists patient_bp_targets_set_updated_at on public.patient_bp_targets;
create trigger patient_bp_targets_set_updated_at
  before update on public.patient_bp_targets
  for each row execute function private.set_updated_at();

alter table public.patient_bp_targets enable row level security;

drop policy if exists patient_bp_targets_select on public.patient_bp_targets;
create policy patient_bp_targets_select on public.patient_bp_targets
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists patient_bp_targets_write on public.patient_bp_targets;
create policy patient_bp_targets_write on public.patient_bp_targets
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.patient_bp_targets to authenticated;

-- ---------------------------------------------------------------------------
-- H5.2  Effective home target: explicit row, else derived from risk conditions
-- ---------------------------------------------------------------------------
create or replace function private.patient_home_bp_target(p_patient uuid)
returns table (systolic smallint, diastolic smallint, source text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sys smallint; v_dia smallint;
begin
  select t.home_systolic, t.home_diastolic into v_sys, v_dia
  from public.patient_bp_targets t where t.patient_id = p_patient;
  if found then
    return query select v_sys, v_dia, 'explicit'::text;
    return;
  end if;

  if exists (
    select 1 from public.care_plans cp
    where cp.patient_id = p_patient and cp.status = 'active'
      and cp.condition in ('diabetes','ckd','cardiovascular','heart_failure')
  ) then
    return query select 130::smallint, 80::smallint, 'derived_high_risk'::text;
  else
    return query select 135::smallint, 85::smallint, 'derived_standard'::text;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- H5.3  Make "above target" (amber) target-aware in the BP red-flag trigger.
-- ---------------------------------------------------------------------------
create or replace function private.handle_bp_reading_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level     text;
  v_alert_lvl public.alert_level;
  v_esc       smallint;
  v_sla       interval;
  v_title     text;
  v_detail    text;
  v_existing  public.clinician_alerts%rowtype;
  v_t_sys     smallint;
  v_t_dia     smallint;
begin
  if new.vital_type <> 'blood_pressure' then
    return new;
  end if;

  update public.clinician_alerts
    set status = 'resolved', updated_at = now()
  where patient_id = new.patient_id
    and status = 'open'
    and title = 'Missing expected blood-pressure readings';

  v_level := private.classify_bp_level(new.systolic, new.diastolic);

  if v_level = 'green' and new.systolic is not null and new.diastolic is not null then
    select systolic, diastolic into v_t_sys, v_t_dia
    from private.patient_home_bp_target(new.patient_id);
    if new.systolic >= v_t_sys or new.diastolic >= v_t_dia then
      v_level := 'amber';
    end if;
  end if;

  if v_level in ('unknown', 'green') then
    return new;
  end if;

  v_detail := format('Home BP reading %s/%s mmHg logged %s.',
                     new.systolic, new.diastolic, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'));

  if v_level = 'emergency' then
    if not exists (
      select 1 from public.emergency_events e
      where e.patient_id = new.patient_id
        and e.source = 'bp_reading'
        and e.status = 'active'
        and e.created_at > now() - interval '6 hours'
    ) then
      insert into public.emergency_events
        (organisation_id, patient_id, source, trigger_detail, status, vital_reading_id)
      values (
        new.organisation_id, new.patient_id, 'bp_reading',
        v_detail || ' This is in the hypertensive-crisis range.',
        'active', new.id
      );
    end if;
    return new;
  end if;

  if v_level = 'red' then
    v_alert_lvl := 'urgent_escalation'; v_esc := 3; v_sla := interval '1 hour';
    v_title := 'Priority 1: high blood pressure reading';
    v_detail := v_detail || ' Please ask the patient to rest 5 minutes and re-check, then review same day.';
  else
    v_alert_lvl := 'clinician_review'; v_esc := 2; v_sla := interval '72 hours';
    v_title := 'Blood pressure above target';
    v_detail := v_detail || ' Above target — review adherence, technique, lifestyle and titration.';
  end if;

  select * into v_existing
  from public.clinician_alerts
  where patient_id = new.patient_id
    and vital_reading_id is not null
    and status = 'open'
  order by created_at desc
  limit 1;

  if v_existing.id is not null then
    if v_esc >= coalesce(v_existing.escalation_level, 0) then
      update public.clinician_alerts
        set level = v_alert_lvl, escalation_level = v_esc, title = v_title,
            detail = v_detail, sla_due_at = now() + v_sla,
            vital_reading_id = new.id, updated_at = now()
      where id = v_existing.id;
    end if;
  else
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at,
       escalation_level, vital_reading_id)
    values (
      new.organisation_id, new.patient_id, v_alert_lvl, 'open', v_title, v_detail,
      now() + v_sla, v_esc, new.id
    );
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.patient_id, 'bp_red_flag.raised',
    'vitals_readings', new.id,
    jsonb_build_object('level', v_level, 'systolic', new.systolic, 'diastolic', new.diastolic)
  );

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- H4  HBPM 7-day average (§5.3): discard the earliest day, average the rest.
-- ---------------------------------------------------------------------------
create or replace function private.hbpm_average(p_patient uuid)
returns table (
  avg_systolic numeric, avg_diastolic numeric,
  n_readings integer, n_days integer,
  window_start date, meets_home_htn boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with win as (
    select v.systolic, v.diastolic, (v.taken_at at time zone 'Africa/Lagos')::date as d
    from public.vitals_readings v
    where v.patient_id = p_patient
      and v.vital_type = 'blood_pressure'
      and v.systolic is not null and v.diastolic is not null
      and v.taken_at >= (now() - interval '7 days')
  ),
  kept as (
    select * from win
    where (select count(distinct d) from win) = 1
       or d > (select min(d) from win)
  )
  select
    round(avg(systolic), 1), round(avg(diastolic), 1),
    count(*)::int, count(distinct d)::int,
    (select min(d) from win),
    (avg(systolic) >= 135 or avg(diastolic) >= 85)
  from kept
  having count(*) > 0;
$$;

create or replace function public.hbpm_summary(p_patient uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_avg record;
  v_tgt record;
begin
  select organisation_id into v_org from public.profiles where id = p_patient;
  if v_org is null then
    return jsonb_build_object('error', 'unknown_patient');
  end if;
  if not (p_patient = (select auth.uid()) or private.is_org_staff(v_org)) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_avg from private.hbpm_average(p_patient);
  select * into v_tgt from private.patient_home_bp_target(p_patient);

  return jsonb_build_object(
    'target', jsonb_build_object('systolic', v_tgt.systolic, 'diastolic', v_tgt.diastolic, 'source', v_tgt.source),
    'average', case when v_avg.n_readings is null then null else jsonb_build_object(
      'systolic', v_avg.avg_systolic, 'diastolic', v_avg.avg_diastolic,
      'n_readings', v_avg.n_readings, 'n_days', v_avg.n_days,
      'window_start', v_avg.window_start, 'meets_home_htn', v_avg.meets_home_htn,
      'at_target', (v_avg.avg_systolic < v_tgt.systolic and v_avg.avg_diastolic < v_tgt.diastolic)
    ) end);
end;
$$;

revoke all on function public.hbpm_summary(uuid) from public, anon;
grant execute on function public.hbpm_summary(uuid) to authenticated;
