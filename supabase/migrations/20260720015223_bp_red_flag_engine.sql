-- Tarragon Health — Hypertension pathway H1: BP red-flag auto-detection engine
-- (TH-CP-HTN-001 §5.4, §14, §15, §16)
--
-- The pathway's non-negotiable rule (§14.6): "the platform detects and surfaces
-- EVERY red flag automatically — they are hard-coded into the system, not left
-- to human vigilance". Until now, logging a blood_pressure reading only computed
-- an ML BP-control risk score (assess-bp-control.ts) — a crisis reading raised
-- NO alert. This adds the missing safety layer as a DB trigger on
-- vitals_readings so it fires for EVERY insert path (manual app/web, BLE device
-- sync, any future path) and cannot be bypassed by a missing app-layer check —
-- the same reasoning that made emergency_events a trigger-owned alert.
--
-- Triage bands (home BP thresholds, §15 escalation card / §6.3 staging; clinic
-- readings run ~5 mmHg higher but home BP is Tarragon's primary input, so home
-- thresholds are the conservative choice):
--   EMERGENCY (④): diastolic >= 120, or systolic >= 200  -> hypertensive crisis
--   RED      (③): systolic 160-199 or diastolic 100-119  -> urgent, same-day
--   AMBER    (②): systolic 135-159 or diastolic 85-99     -> doctor review <=72h
--   GREEN    (①): < 135/85                                 -> no alert
-- Symptom red-flags at any BP already route to emergency_events via the symptom
-- pathway; this trigger covers the BP-value red flags.
--
-- EMERGENCY reuses emergency_events (raises the Priority-1 alert + acknowledge-
-- gated emergency-contact notify + follow-up — exactly the §16 path). RED/AMBER
-- raise a clinician_alerts row, one active BP alert per patient, UPGRADE-ONLY
-- (mirrors medication_adherence_alerts) so a stream of readings never spams the
-- worklist. Nothing here ever auto-closes or downgrades an alert — only a doctor
-- stands one down (§14.6), which the existing clinician_alerts lifecycle
-- already enforces.

-- 1. Additive: emergency_events can be sourced from a BP reading.
alter type public.emergency_source add value if not exists 'bp_reading';

-- 2. Link an alert / emergency event back to the exact reading that raised it
--    (nullable, on delete set null — same precedent as clinician_alerts.screening_result_id).
alter table public.clinician_alerts
  add column if not exists vital_reading_id uuid references public.vitals_readings (id) on delete set null;
alter table public.emergency_events
  add column if not exists vital_reading_id uuid references public.vitals_readings (id) on delete set null;

-- 3. Pure classifier — one place defines the bands, reused by the trigger.
--    Kept in `private` (never exposed) and IMMUTABLE (deterministic).
create or replace function private.classify_bp_level(p_systolic integer, p_diastolic integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_systolic is null or p_diastolic is null then 'unknown'
    when p_diastolic >= 120 or p_systolic >= 200 then 'emergency'
    when p_systolic >= 160 or p_diastolic >= 100 then 'red'
    when p_systolic >= 135 or p_diastolic >= 85  then 'amber'
    else 'green'
  end;
$$;

-- 4. The trigger.
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
begin
  if new.vital_type <> 'blood_pressure' then
    return new;
  end if;

  v_level := private.classify_bp_level(new.systolic, new.diastolic);
  if v_level in ('unknown', 'green') then
    return new;  -- nothing to raise
  end if;

  v_detail := format('Home BP reading %s/%s mmHg logged %s.',
                     new.systolic, new.diastolic, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'));

  -- EMERGENCY: hand off to emergency_events (its BEFORE INSERT trigger raises the
  -- Priority-1 alert + audit + acknowledge-gated contact notify + follow-up).
  -- Light dedupe: don't raise a second bp_reading emergency while one is still
  -- active from the last 6h.
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

  -- RED / AMBER -> clinician_alerts, one active BP alert per patient, upgrade-only.
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
    -- Upgrade-only: never downgrade an already-open BP alert; refresh it if the
    -- new reading is as or more severe.
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

drop trigger if exists vitals_readings_bp_red_flag on public.vitals_readings;
create trigger vitals_readings_bp_red_flag
  after insert on public.vitals_readings
  for each row
  when (new.vital_type = 'blood_pressure')
  execute function private.handle_bp_reading_red_flag();
