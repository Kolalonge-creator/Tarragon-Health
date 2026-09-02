-- Tarragon Health — Monitoring Engine: Remote Patient Monitoring, first real
-- programme (§6.19)
--
-- The spec's own worked example is heart failure: daily weight -> BP ->
-- symptoms -> trend deterioration -> care team alerted. Built on explicit
-- ask (the spec's "Eventually" framing is a priority note, not a ban — same
-- "pull forward on explicit ask" precedent CLAUDE.md already documents for
-- Employer/HMO dashboards and Premium ParentCare).
--
-- The platform already carries the exact clinical rule for this, unbuilt:
-- condition_protocols.lifestyle for heart_failure says "Weigh daily and
-- report gain of more than 2 kg in 3 days"; its escalation.red_flags says
-- "Rapid weight gain with worsening breathlessness or orthopnoea", SLA
-- "Priority-1 red alert - 4-hour clinician contact SLA" (matches CLAUDE.md's
-- own 4-hour SLA figure for the platform's other Priority-1 pathway). Both
-- are WHO/ESC-derived and already Clinical-Director-authored content, not
-- numbers invented for this migration — encoded here as-is via a DB trigger
-- so it fires for EVERY weight insert path (same "cannot be bypassed by a
-- missing app-layer check" reasoning as the BP/SpO2/temperature engines).
--
-- Deliberately narrower than the full spec example: this is the
-- quantifiable half (weight trend), not a symptom-severity composite score
-- — a "worsening breathlessness" self-report already reaches a clinician via
-- the existing symptom-logging/danger-symptom pathways (CLAUDE.md's
-- emergency safety net), so this does not duplicate that. Scoped to
-- patients with an ENROLLED heart_failure chronic_programme_enrolments row
-- only — an unrelated patient's post-meal or hydration-driven weight swing
-- must never trigger a heart-failure-specific alert.

create or replace function private.handle_heart_failure_weight_gain_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_earliest_weight numeric;
  v_earliest_taken_at timestamptz;
  v_gain numeric;
  v_existing_id uuid;
  v_title text := 'Heart failure: rapid weight gain';
  v_detail text;
begin
  if new.vital_type <> 'weight' or new.weight_kg is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.chronic_programme_enrolments e
    join public.chronic_condition_programmes p on p.id = e.programme_id
    where e.patient_id = new.patient_id
      and e.status = 'enrolled'
      and p.condition = 'heart_failure'
  ) then
    return new;
  end if;

  -- Oldest weight reading within the trailing 3-day window, compared to this
  -- one. Using the OLDEST available point (not necessarily exactly 3 days
  -- back) is the conservative choice for sparse daily logging: a >2kg rise
  -- over whatever shorter span is actually on file is, if anything, MORE
  -- concerning than the same rise over a full 3 days, so this never under-
  -- reacts to missing data.
  select weight_kg, taken_at into v_earliest_weight, v_earliest_taken_at
  from public.vitals_readings
  where patient_id = new.patient_id
    and vital_type = 'weight'
    and taken_at >= new.taken_at - interval '3 days'
    and taken_at < new.taken_at
  order by taken_at asc
  limit 1;

  if v_earliest_weight is null then
    return new;  -- no prior reading in-window to compare against
  end if;

  v_gain := new.weight_kg - v_earliest_weight;
  if v_gain <= 2.0 then
    return new;
  end if;

  v_detail := format(
    'Weight rose from %s kg (%s) to %s kg (%s) — a %s kg gain within 3 days. WHO/ESC heart-failure guidance: '
    || 'report gain of more than 2 kg in 3 days as a possible sign of decompensation.',
    v_earliest_weight, to_char(v_earliest_taken_at, 'YYYY-MM-DD HH24:MI'),
    new.weight_kg, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'),
    round(v_gain, 1)
  );

  -- One open alert per patient for this specific mechanism, upgrade/refresh
  -- only — never a second row while one is still open, matching every other
  -- red-flag engine's dedup shape.
  select id into v_existing_id
  from public.clinician_alerts
  where patient_id = new.patient_id and title = v_title and status = 'open'
  order by created_at desc
  limit 1;

  if v_existing_id is not null then
    update public.clinician_alerts
      set detail = v_detail, sla_due_at = now() + interval '4 hours',
          vital_reading_id = new.id, updated_at = now()
    where id = v_existing_id;
  else
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at,
       escalation_level, vital_reading_id)
    values (
      new.organisation_id, new.patient_id, 'urgent_escalation', 'open', v_title, v_detail,
      now() + interval '4 hours', 3, new.id
    );
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.patient_id, 'heart_failure_weight_gain.raised',
    'vitals_readings', new.id,
    jsonb_build_object('gain_kg', round(v_gain, 1), 'earliest_weight_kg', v_earliest_weight, 'latest_weight_kg', new.weight_kg)
  );

  return new;
end;
$$;

drop trigger if exists vitals_readings_heart_failure_weight_gain on public.vitals_readings;
create trigger vitals_readings_heart_failure_weight_gain
  after insert on public.vitals_readings
  for each row
  when (new.vital_type = 'weight')
  execute function private.handle_heart_failure_weight_gain_red_flag();

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'vitals_readings_heart_failure_weight_gain'
      and tgrelid = 'public.vitals_readings'::regclass
      and not tgisinternal
  ) then
    raise exception 'FAIL: vitals_readings_heart_failure_weight_gain trigger missing';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'handle_heart_failure_weight_gain_red_flag'
  ) then
    raise exception 'FAIL: private.handle_heart_failure_weight_gain_red_flag missing';
  end if;

  raise notice 'PASS: heart failure RPM weight-gain deterioration alert installed';
end $$;
