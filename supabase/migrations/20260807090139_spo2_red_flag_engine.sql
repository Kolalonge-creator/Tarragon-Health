-- Tarragon Health — SpO2 red-flag auto-detection engine
--
-- Founder ask: dangerous vitals readings should reliably and quickly reach a
-- doctor through the existing escalation machinery — deterministic thresholds,
-- not ML, not autonomous dispatch. A clinician still makes every downstream
-- call. Same architecture as the BP red-flag engine
-- (20260720015223_bp_red_flag_engine.sql): a DB trigger on vitals_readings so
-- it fires for EVERY insert path (manual app/web, BLE device sync, any future
-- path) and cannot be bypassed by a missing app-layer check. Until now, a
-- dangerously low SpO2 reading raised nothing on the clinician side at all —
-- apps/web/src/lib/vitals/plausibility.ts only shows the *patient* a
-- pre-submit "please confirm this reading" prompt for <94%, never reaching
-- clinician_alerts/emergency_events.
--
-- Triage bands (resting pulse oximetry; a single low reading is far more
-- clinically urgent than a single elevated BP reading, so this trigger pages
-- immediately on EMERGENCY rather than only via emergency_events' own
-- acknowledge-gated 10-minute contact-notify):
--   EMERGENCY: < 90%       -> hypoxia, immediate doctor contact
--   RED      : 90-92%      -> urgent, same-day review
--   AMBER    : 93-94%      -> doctor review within a few days
--   GREEN    : >= 95%      -> no alert
--
-- Correctness note vs. the BP template this mirrors: BP's own "existing open
-- alert" lookup (private.handle_bp_reading_red_flag, current version in
-- 20260730105131_v3_port_escalation_sla_config.sql) is NOT scoped by vital
-- type — it grabs the single most-recently-created open alert with any
-- non-null vital_reading_id for the patient, so a RED SpO2 reading landing
-- right after an open BP alert could silently overwrite the BP alert's
-- title/level. This trigger's lookup joins back to vitals_readings and
-- filters on vital_type so it only ever touches its own alerts. (BP's
-- function has the same latent bug; fixing it is a separate, small follow-up
-- — not part of this feature's diff.)

-- 1. Additive: emergency_events can be sourced from an SpO2 reading.
alter type public.emergency_source add value if not exists 'spo2_red_flag';

-- 2. Pure classifier — one place defines the bands, reused by the trigger.
--    Kept in `private` (never exposed) and IMMUTABLE (deterministic).
create or replace function private.classify_spo2_level(p_spo2_pct integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_spo2_pct is null then 'unknown'
    when p_spo2_pct < 90 then 'emergency'
    when p_spo2_pct <= 92 then 'red'
    when p_spo2_pct <= 94 then 'amber'
    else 'green'
  end;
$$;

-- 3. The trigger.
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
begin
  if new.vital_type <> 'spo2' then
    return new;
  end if;

  v_level := private.classify_spo2_level(new.spo2_pct);
  if v_level in ('unknown', 'green') then
    return new;  -- nothing to raise
  end if;

  v_detail := format('SpO2 reading %s%% logged %s.',
                     new.spo2_pct, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'));

  -- EMERGENCY: hand off to emergency_events (its BEFORE INSERT trigger raises
  -- the Priority-1 alert + audit + acknowledge-gated contact notify + follow-up).
  -- Light dedupe: don't raise a second spo2_red_flag emergency while one is
  -- still active from the last 6h.
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

  -- RED / AMBER -> clinician_alerts, one active SpO2 alert per patient, upgrade-only.
  if v_level = 'red' then
    v_alert_lvl := 'urgent_escalation'; v_esc := 3; v_sla := interval '1 hour';
    v_title := 'Priority 1: low oxygen saturation reading';
    v_detail := v_detail || ' Please review same day and confirm reading technique.';
  else
    v_alert_lvl := 'clinician_review'; v_esc := 2; v_sla := interval '72 hours';
    v_title := 'Oxygen saturation below target';
    v_detail := v_detail || ' Below target — review symptoms and recheck.';
  end if;

  -- Vital-type-scoped lookup (see correctness note above) — only ever
  -- upgrades/refreshes an alert this same trigger previously raised.
  select ca.* into v_existing
  from public.clinician_alerts ca
  join public.vitals_readings vr on vr.id = ca.vital_reading_id
  where ca.patient_id = new.patient_id
    and vr.vital_type = 'spo2'
    and ca.status = 'open'
  order by ca.created_at desc
  limit 1;

  if v_existing.id is not null then
    -- Upgrade-only: never downgrade an already-open SpO2 alert; refresh it if
    -- the new reading is as or more severe.
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
    new.organisation_id, new.patient_id, 'spo2_red_flag.raised',
    'vitals_readings', new.id,
    jsonb_build_object('level', v_level, 'spo2_pct', new.spo2_pct)
  );

  return new;
end;
$$;

drop trigger if exists vitals_readings_spo2_red_flag on public.vitals_readings;
create trigger vitals_readings_spo2_red_flag
  after insert on public.vitals_readings
  for each row
  when (new.vital_type = 'spo2')
  execute function private.handle_spo2_reading_red_flag();

-- 4. Assertions — prove the engine is wired correctly, not just hoped for.
do $$
declare
  v_band text;
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'vitals_readings_spo2_red_flag'
      and tgrelid = 'public.vitals_readings'::regclass
      and not tgisinternal
  ) then
    raise exception 'FAIL: vitals_readings_spo2_red_flag trigger missing';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'handle_spo2_reading_red_flag' and n.nspname = 'private'
  ) then
    raise exception 'FAIL: private.handle_spo2_reading_red_flag missing';
  end if;

  v_band := private.classify_spo2_level(85);
  if v_band <> 'emergency' then
    raise exception 'FAIL: classify_spo2_level(85) = % expected emergency', v_band;
  end if;

  v_band := private.classify_spo2_level(91);
  if v_band <> 'red' then
    raise exception 'FAIL: classify_spo2_level(91) = % expected red', v_band;
  end if;

  v_band := private.classify_spo2_level(94);
  if v_band <> 'amber' then
    raise exception 'FAIL: classify_spo2_level(94) = % expected amber', v_band;
  end if;

  v_band := private.classify_spo2_level(97);
  if v_band <> 'green' then
    raise exception 'FAIL: classify_spo2_level(97) = % expected green', v_band;
  end if;

  v_band := private.classify_spo2_level(null);
  if v_band <> 'unknown' then
    raise exception 'FAIL: classify_spo2_level(null) = % expected unknown', v_band;
  end if;

  raise notice 'PASS: spo2_red_flag_engine — trigger, function, and classifier bands verified';
end $$;
