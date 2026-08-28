-- Tarragon Health — Monitoring Engine: individualised targets for SpO2,
-- temperature, and pulse (§6.10 — "Never assume one universal target")
--
-- BP and glucose already have this (patient_bp_targets/patient_glucose_
-- targets, H5/§9) but SpO2 and temperature have only ever had the fixed
-- population bands baked into private.classify_spo2_level/classify_
-- temperature_level, and pulse's pattern assessment (assess-heart-rate.ts)
-- has a hardcoded 60-100bpm resting range. This closes that gap the same
-- way BP already did (private.patient_home_bp_target,
-- 20260720020150_bp_targets_and_hbpm.sql H5.3): an individualised target
-- can only ever make the ROUTINE ("amber") review threshold more or less
-- sensitive — the RED/EMERGENCY safety floor stays fixed for every
-- patient. This mirrors patient_glucose_targets' own explicit rule ("the
-- emergency / hypo thresholds are NEVER relaxed — safety is fixed").
--
-- Deliberately NOT a full custom emergency-floor remap for chronic
-- hypoxaemia (e.g. a severe COPD patient prescribed a target SpO2 range
-- below the population "red" band) — that is a real, distinct clinical
-- policy decision (home-oxygen target-saturation prescribing) needing
-- actual Clinical Director sign-off, not something to invent inside a
-- schema migration. Flagged for that review, same "flag rather than invent
-- an unasked band" precedent already used in temperature_red_flag_engine's
-- own mild-hypothermia note, not decided here.
--
-- classify_spo2_level()/classify_temperature_level() themselves are left
-- untouched (still the fixed population classifier, still what the TS
-- presentation-only badges mirror) — the override is applied as a second,
-- explicit step in each trigger, exactly like BP's H5.3, not folded into
-- the classifier itself.
--
-- CORRECTED after applying to the live koiplnmbgnqnbywhpjlf project: the
-- version of handle_spo2_reading_red_flag()/handle_temperature_reading_
-- red_flag() this branch's own git history carried (20260807090139/
-- 20260807090237) was STALE relative to what was actually live — checked
-- via pg_get_functiondef before writing the trigger bodies below, per
-- CLAUDE.md's own standing lesson ("a live schema object can exist with no
-- migration record... check its live definition directly, not just
-- whether a migration file exists"). The live versions carry real,
-- load-bearing logic this branch's local files never picked up: plan-gated
-- escalation (private.patient_has_feature_access(..., 'vitals_red_flag_
-- doctor_escalation') — Free-tier patients get private.raise_dangerous_
-- reading_ai_suggestion() instead of a doctor alert), configurable
-- per-mechanism SLAs (private.escalation_sla_minutes(...)), and clinician
-- paging (private.enqueue_critical_notification(...)). The trigger bodies
-- below are the LIVE versions with only the individualised-target upgrade
-- step added — a plain overwrite from the original local file would have
-- silently reverted all three of those.

-- ---------------------------------------------------------------------------
-- patient_spo2_targets
-- ---------------------------------------------------------------------------
create table public.patient_spo2_targets (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  patient_id           uuid not null unique references public.profiles (id) on delete cascade,
  -- The value AT OR BELOW which a green reading is upgraded to amber.
  -- Bounded strictly above the fixed RED ceiling (92) so an override can
  -- never mask a genuinely urgent reading as merely routine.
  amber_threshold_pct  smallint not null default 94 check (amber_threshold_pct > 92 and amber_threshold_pct <= 100),
  rationale            text,
  set_by               uuid references public.clinical_staff (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index patient_spo2_targets_org_idx on public.patient_spo2_targets (organisation_id);

drop trigger if exists patient_spo2_targets_set_updated_at on public.patient_spo2_targets;
create trigger patient_spo2_targets_set_updated_at
  before update on public.patient_spo2_targets
  for each row execute function private.set_updated_at();

alter table public.patient_spo2_targets enable row level security;

create policy patient_spo2_targets_select on public.patient_spo2_targets
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy patient_spo2_targets_write on public.patient_spo2_targets
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.patient_spo2_targets to authenticated;

-- ---------------------------------------------------------------------------
-- patient_temperature_targets
-- ---------------------------------------------------------------------------
create table public.patient_temperature_targets (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null unique references public.profiles (id) on delete cascade,
  -- The value AT OR ABOVE which a green reading is upgraded to amber.
  -- Bounded strictly below the fixed RED floor (39.0).
  amber_threshold_c   numeric(3, 1) not null default 38.0 check (amber_threshold_c >= 37.0 and amber_threshold_c < 39.0),
  rationale           text,
  set_by              uuid references public.clinical_staff (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index patient_temperature_targets_org_idx on public.patient_temperature_targets (organisation_id);

drop trigger if exists patient_temperature_targets_set_updated_at on public.patient_temperature_targets;
create trigger patient_temperature_targets_set_updated_at
  before update on public.patient_temperature_targets
  for each row execute function private.set_updated_at();

alter table public.patient_temperature_targets enable row level security;

create policy patient_temperature_targets_select on public.patient_temperature_targets
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy patient_temperature_targets_write on public.patient_temperature_targets
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.patient_temperature_targets to authenticated;

-- ---------------------------------------------------------------------------
-- patient_pulse_targets — no emergency/red tier exists for pulse at all
-- (assess-heart-rate.ts is a best-effort trailing-window PATTERN assessment,
-- never an emergency page), so this one has no "never relax below a safety
-- floor" constraint to enforce — a full resting-range override is safe.
-- ---------------------------------------------------------------------------
create table public.patient_pulse_targets (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null unique references public.profiles (id) on delete cascade,
  resting_min_bpm     smallint not null default 60 check (resting_min_bpm between 30 and 150),
  resting_max_bpm     smallint not null default 100 check (resting_max_bpm between 30 and 150),
  rationale           text,
  set_by              uuid references public.clinical_staff (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint patient_pulse_targets_range_check check (resting_min_bpm < resting_max_bpm)
);
create index patient_pulse_targets_org_idx on public.patient_pulse_targets (organisation_id);

drop trigger if exists patient_pulse_targets_set_updated_at on public.patient_pulse_targets;
create trigger patient_pulse_targets_set_updated_at
  before update on public.patient_pulse_targets
  for each row execute function private.set_updated_at();

alter table public.patient_pulse_targets enable row level security;

create policy patient_pulse_targets_select on public.patient_pulse_targets
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy patient_pulse_targets_write on public.patient_pulse_targets
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.patient_pulse_targets to authenticated;

-- ---------------------------------------------------------------------------
-- Wire the SpO2 trigger to the override. This is the LIVE function body
-- (fetched via pg_get_functiondef) with only the individualised-target
-- upgrade step added — see the correction note above.
-- ---------------------------------------------------------------------------
create or replace function private.handle_spo2_reading_red_flag()
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
  v_alert_id  uuid;
  v_should_page boolean := false;
  v_level_label text;
  r           public.profiles%rowtype;
  v_has_escalation_access boolean;
  v_amber_threshold smallint;
begin
  if new.vital_type <> 'spo2' then
    return new;
  end if;

  v_level := private.classify_spo2_level(new.spo2_pct);

  -- §6.10 individualised-target upgrade (mirrors BP's H5.3): a green
  -- reading is upgraded to amber if it crosses THIS patient's own,
  -- clinician-set threshold. Never touches red/emergency — those stay the
  -- fixed population safety floor for every patient.
  if v_level = 'green' and new.spo2_pct is not null then
    select amber_threshold_pct into v_amber_threshold
    from public.patient_spo2_targets where patient_id = new.patient_id;
    if v_amber_threshold is not null and new.spo2_pct <= v_amber_threshold then
      v_level := 'amber';
    end if;
  end if;

  if v_level in ('unknown', 'green') then
    return new;
  end if;

  v_detail := format('SpO2 reading %s%% logged %s.',
                     new.spo2_pct, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'));

  if v_level = 'emergency' then
    if not exists (
      select 1 from public.emergency_events e
      where e.patient_id = new.patient_id
        and e.source = 'spo2_red_flag'
        and e.status = 'active'
        and e.created_at > now() - interval '6 hours'
    ) then
      insert into public.emergency_events
        (organisation_id, patient_id, source, trigger_detail, status, vital_reading_id)
      values (
        new.organisation_id, new.patient_id, 'spo2_red_flag',
        v_detail || ' This is in the hypoxia / emergency range.',
        'active', new.id
      );
    end if;
    return new;
  end if;

  v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');

  if v_level = 'red' then
    v_alert_lvl := 'urgent_escalation'; v_esc := 3;
    v_sla := private.escalation_sla_minutes('spo2_vitals_red_flag', 'urgent_escalation') * interval '1 minute';
    v_title := 'Priority 1: low oxygen saturation reading';
    v_detail := v_detail || ' Please review same day and confirm reading technique.';
    v_level_label := 'Priority 1';
  else
    v_alert_lvl := 'clinician_review'; v_esc := 2;
    v_sla := private.escalation_sla_minutes('spo2_vitals_red_flag', 'clinician_review') * interval '1 minute';
    v_title := 'Oxygen saturation below target';
    v_detail := v_detail || ' Below target — review symptoms and recheck.';
    v_level_label := 'Review needed';
  end if;

  if v_has_escalation_access then
    select ca.* into v_existing
    from public.clinician_alerts ca
    join public.vitals_readings vr on vr.id = ca.vital_reading_id
    where ca.patient_id = new.patient_id
      and vr.vital_type = 'spo2'
      and ca.status = 'open'
    order by ca.created_at desc
    limit 1;

    if v_existing.id is not null then
      if v_esc >= coalesce(v_existing.escalation_level, 0) then
        update public.clinician_alerts
          set level = v_alert_lvl, escalation_level = v_esc, title = v_title,
              detail = v_detail, sla_due_at = now() + v_sla,
              vital_reading_id = new.id, updated_at = now()
        where id = v_existing.id;
        v_alert_id := v_existing.id;
        if v_esc > coalesce(v_existing.escalation_level, 0) then
          v_should_page := true;
        end if;
      end if;
    else
      insert into public.clinician_alerts
        (organisation_id, patient_id, level, status, title, detail, sla_due_at,
         escalation_level, vital_reading_id)
      values (
        new.organisation_id, new.patient_id, v_alert_lvl, 'open', v_title, v_detail,
        now() + v_sla, v_esc, new.id
      )
      returning id into v_alert_id;
      v_should_page := true;
    end if;
  else
    perform private.raise_dangerous_reading_ai_suggestion(
      new.organisation_id, new.patient_id, 'oxygen saturation', v_level_label,
      'Sit upright, take slow, deep breaths, and recheck in about 15 minutes. If your reading stays low, or you feel short of breath, dizzy, or unwell, seek care promptly.'
    );
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.patient_id, 'spo2_red_flag.raised',
    'vitals_readings', new.id,
    jsonb_build_object('level', v_level, 'spo2_pct', new.spo2_pct,
                       'escalation_gated_by_plan', not v_has_escalation_access)
  );

  if v_should_page then
    for r in
      select * from public.profiles
      where organisation_id = new.organisation_id and role = 'clinician' and phone is not null
    loop
      perform private.enqueue_critical_notification(
        new.organisation_id, r.id, 'vitals_red_flag_clinician_alert',
        jsonb_build_object(
          'patient_name', coalesce((select full_name from public.profiles where id = new.patient_id), 'A patient'),
          'vital_label', 'oxygen saturation',
          'level_label', v_level_label
        ),
        'spo2_vitals_red_flag', v_alert_lvl, 'clinician_alerts', v_alert_id
      );
    end loop;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Wire the temperature trigger to the override — same treatment.
-- ---------------------------------------------------------------------------
create or replace function private.handle_temperature_reading_red_flag()
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
  v_alert_id  uuid;
  v_should_page boolean := false;
  v_level_label text;
  r           public.profiles%rowtype;
  v_has_escalation_access boolean;
  v_amber_threshold numeric;
begin
  if new.vital_type <> 'temperature' then
    return new;
  end if;

  v_level := private.classify_temperature_level(new.temperature_c);

  -- §6.10 individualised-target upgrade — same shape as SpO2 above.
  if v_level = 'green' and new.temperature_c is not null then
    select amber_threshold_c into v_amber_threshold
    from public.patient_temperature_targets where patient_id = new.patient_id;
    if v_amber_threshold is not null and new.temperature_c >= v_amber_threshold then
      v_level := 'amber';
    end if;
  end if;

  if v_level in ('unknown', 'green') then
    return new;
  end if;

  v_detail := format('Temperature reading %sC logged %s.',
                     new.temperature_c, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'));

  if v_level = 'emergency' then
    if not exists (
      select 1 from public.emergency_events e
      where e.patient_id = new.patient_id
        and e.source = 'temperature_red_flag'
        and e.status = 'active'
        and e.created_at > now() - interval '6 hours'
    ) then
      insert into public.emergency_events
        (organisation_id, patient_id, source, trigger_detail, status, vital_reading_id)
      values (
        new.organisation_id, new.patient_id, 'temperature_red_flag',
        v_detail || ' This is in the hyperpyrexia/hypothermia emergency range.',
        'active', new.id
      );
    end if;
    return new;
  end if;

  v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');

  if v_level = 'red' then
    v_alert_lvl := 'urgent_escalation'; v_esc := 3;
    v_sla := private.escalation_sla_minutes('temperature_vitals_red_flag', 'urgent_escalation') * interval '1 minute';
    v_title := 'Priority 1: high fever reading';
    v_detail := v_detail || ' Sepsis-relevant range — please review same day.';
    v_level_label := 'Priority 1';
  else
    v_alert_lvl := 'clinician_review'; v_esc := 2;
    v_sla := private.escalation_sla_minutes('temperature_vitals_red_flag', 'clinician_review') * interval '1 minute';
    v_title := 'Fever reading logged';
    v_detail := v_detail || ' Review symptoms and recheck.';
    v_level_label := 'Review needed';
  end if;

  if v_has_escalation_access then
    select ca.* into v_existing
    from public.clinician_alerts ca
    join public.vitals_readings vr on vr.id = ca.vital_reading_id
    where ca.patient_id = new.patient_id
      and vr.vital_type = 'temperature'
      and ca.status = 'open'
    order by ca.created_at desc
    limit 1;

    if v_existing.id is not null then
      if v_esc >= coalesce(v_existing.escalation_level, 0) then
        update public.clinician_alerts
          set level = v_alert_lvl, escalation_level = v_esc, title = v_title,
              detail = v_detail, sla_due_at = now() + v_sla,
              vital_reading_id = new.id, updated_at = now()
        where id = v_existing.id;
        v_alert_id := v_existing.id;
        if v_esc > coalesce(v_existing.escalation_level, 0) then
          v_should_page := true;
        end if;
      end if;
    else
      insert into public.clinician_alerts
        (organisation_id, patient_id, level, status, title, detail, sla_due_at,
         escalation_level, vital_reading_id)
      values (
        new.organisation_id, new.patient_id, v_alert_lvl, 'open', v_title, v_detail,
        now() + v_sla, v_esc, new.id
      )
      returning id into v_alert_id;
      v_should_page := true;
    end if;
  else
    perform private.raise_dangerous_reading_ai_suggestion(
      new.organisation_id, new.patient_id, 'temperature', v_level_label,
      'Rest and stay hydrated, and take paracetamol if needed for fever; recheck your temperature in a few hours. If it stays this high, or you feel very unwell, seek care promptly.'
    );
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.patient_id, 'temperature_red_flag.raised',
    'vitals_readings', new.id,
    jsonb_build_object('level', v_level, 'temperature_c', new.temperature_c,
                       'escalation_gated_by_plan', not v_has_escalation_access)
  );

  if v_should_page then
    for r in
      select * from public.profiles
      where organisation_id = new.organisation_id and role = 'clinician' and phone is not null
    loop
      perform private.enqueue_critical_notification(
        new.organisation_id, r.id, 'vitals_red_flag_clinician_alert',
        jsonb_build_object(
          'patient_name', coalesce((select full_name from public.profiles where id = new.patient_id), 'A patient'),
          'vital_label', 'temperature',
          'level_label', v_level_label
        ),
        'temperature_vitals_red_flag', v_alert_lvl, 'clinician_alerts', v_alert_id
      );
    end loop;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'patient_spo2_targets') then
    raise exception 'FAIL: patient_spo2_targets was not created';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'patient_temperature_targets') then
    raise exception 'FAIL: patient_temperature_targets was not created';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'patient_pulse_targets') then
    raise exception 'FAIL: patient_pulse_targets was not created';
  end if;

  raise notice 'PASS: individualised SpO2/temperature/pulse targets installed';
end $$;
