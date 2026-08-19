-- Tarragon Health — Glucose/ketone emergency DB backstop
--
-- Glucose already has a real app-layer red-flag engine
-- (apps/web/src/lib/vitals/glucose-red-flags.ts + assess-glucose.ts,
-- assessGlucoseBestEffort) covering severe hypo, suspected DKA, plus richer
-- pattern/target-override bands that need a 14-day trailing window, a
-- per-patient target override, and a type-1-suspicion profile lookup — none
-- of which fits a pure IMMUTABLE SQL classifier the way BP/SpO2/temperature
-- do, so that engine stays exactly where it is.
--
-- The gap: assessGlucoseBestEffort is only called from logVital()
-- (apps/web/src/app/(dashboard)/patient/actions.ts) — confirmed by reading
-- both apps/web/src/app/api/mobile/device-readings/route.ts and
-- apps/web/src/app/api/integrations/device-readings/route.ts that neither
-- calls it after inserting a glucose row. A glucometer synced via BLE
-- bypasses red-flag detection an identical manually-typed reading would
-- trigger. This migration adds a narrow DB-trigger backstop covering ONLY
-- the two true single-value emergencies (severe hypo, suspected DKA), so
-- they can never be silently dropped by any insert path — present or
-- future (a new device type, a bulk import, an EHR feed) — mirroring the
-- same "cannot be bypassed" reasoning as the BP/SpO2/temperature triggers.
-- RED/AMBER bands (hypo-alert, very-high, persistent-hyperglycaemia,
-- recurrent-hypo, ketones-raised/moderate) are deliberately left app-layer
-- only — Step 6 (apps/web device-sync route changes) closes that gap for
-- the two currently-known insert paths instead.
--
-- Thresholds mirror GLUCOSE_THRESHOLDS in glucose-red-flags.ts exactly
-- (severeHypo 3.0, highForDka 11.0, ketoneHigh 3.0 mmol/L blood / urine
-- moderate-large) and the emergency dedupe window mirrors
-- EMERGENCY_DEDUPE_HOURS (3h) in assess-glucose.ts — whichever mechanism
-- (this trigger, or the app-layer call from logVital) fires second finds
-- the first one's still-active emergency_events row and no-ops. No new
-- emergency_source enum value is needed — 'glucose_red_flag' already exists,
-- added by the app-layer engine.

-- 1. Shared insert-if-not-deduped helper, used by both emergency cases below.
create or replace function private.raise_glucose_backstop_emergency(
  p_organisation_id uuid,
  p_patient_id uuid,
  p_vital_reading_id uuid,
  p_detail text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.emergency_events e
    where e.patient_id = p_patient_id
      and e.source = 'glucose_red_flag'
      and e.status = 'active'
      and e.created_at > now() - interval '3 hours'
  ) then
    return;
  end if;

  insert into public.emergency_events
    (organisation_id, patient_id, source, trigger_detail, status, vital_reading_id)
  values (p_organisation_id, p_patient_id, 'glucose_red_flag', p_detail, 'active', p_vital_reading_id);

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    p_organisation_id, p_patient_id, 'glucose_emergency_backstop.raised',
    'vitals_readings', p_vital_reading_id, jsonb_build_object('detail', p_detail)
  );
end;
$$;

-- 2. The trigger. Fires on either a glucose or a ketones insert, since they
--    land as separate vitals_readings rows and DKA needs both.
create or replace function private.handle_glucose_emergency_backstop()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_glucose      numeric;
  v_ketone_mmol  numeric;
  v_ketone_urine text;
  v_detail       text;
begin
  if new.vital_type not in ('glucose', 'ketones') then
    return new;
  end if;

  -- Severe hypo: single-value emergency, only meaningful on a glucose insert.
  if new.vital_type = 'glucose' and new.glucose_mmol_l is not null and new.glucose_mmol_l < 3.0 then
    v_detail := format('Severe hypoglycaemia — glucose %s mmol/L logged %s.',
                        new.glucose_mmol_l, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'));
    perform private.raise_glucose_backstop_emergency(new.organisation_id, new.patient_id, new.id, v_detail);
    return new;
  end if;

  -- Suspected DKA: resolve the freshest glucose and the freshest fresh (<=24h)
  -- ketone reading, regardless of which one triggered this insert.
  if new.vital_type = 'glucose' then
    v_glucose := new.glucose_mmol_l;
  else
    select vr.glucose_mmol_l into v_glucose
    from public.vitals_readings vr
    where vr.patient_id = new.patient_id and vr.vital_type = 'glucose'
    order by vr.taken_at desc
    limit 1;
  end if;

  if new.vital_type = 'ketones' then
    v_ketone_mmol := new.ketones_mmol_l;
    v_ketone_urine := new.ketone_urine;
  else
    select vr.ketones_mmol_l, vr.ketone_urine into v_ketone_mmol, v_ketone_urine
    from public.vitals_readings vr
    where vr.patient_id = new.patient_id and vr.vital_type = 'ketones'
      and vr.taken_at > now() - interval '24 hours'
    order by vr.taken_at desc
    limit 1;
  end if;

  if v_glucose is not null and v_glucose >= 11.0
     and (
       (v_ketone_mmol is not null and v_ketone_mmol >= 3.0)
       or (v_ketone_urine is not null and v_ketone_urine in ('moderate', 'large'))
     )
  then
    v_detail := format('Suspected DKA — glucose %s mmol/L with raised ketones, logged %s.',
                        v_glucose, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'));
    perform private.raise_glucose_backstop_emergency(new.organisation_id, new.patient_id, new.id, v_detail);
  end if;

  return new;
end;
$$;

drop trigger if exists vitals_readings_glucose_emergency_backstop on public.vitals_readings;
create trigger vitals_readings_glucose_emergency_backstop
  after insert on public.vitals_readings
  for each row
  when (new.vital_type in ('glucose', 'ketones'))
  execute function private.handle_glucose_emergency_backstop();

-- 3. Assertions — schema-level only (function/trigger existence). The
--    behavioural cases (severe-hypo insert, same-session DKA pair, dedupe
--    against the app-layer call) need real patient/org fixture rows and a
--    rolled-back transaction, so they live in
--    packages/db/tests/glucose_emergency_backstop.sql instead of here — a
--    migration must not fabricate patient data.
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'vitals_readings_glucose_emergency_backstop'
      and tgrelid = 'public.vitals_readings'::regclass
      and not tgisinternal
  ) then
    raise exception 'FAIL: vitals_readings_glucose_emergency_backstop trigger missing';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'handle_glucose_emergency_backstop' and n.nspname = 'private'
  ) then
    raise exception 'FAIL: private.handle_glucose_emergency_backstop missing';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'raise_glucose_backstop_emergency' and n.nspname = 'private'
  ) then
    raise exception 'FAIL: private.raise_glucose_backstop_emergency missing';
  end if;

  raise notice 'PASS: glucose_emergency_db_backstop — trigger and functions verified';
end $$;
