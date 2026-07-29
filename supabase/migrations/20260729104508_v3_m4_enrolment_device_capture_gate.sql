-- M4: enrolment device-capture gate (build spec v3 §5.4): "a patient cannot reach
-- enrolments.status = 'active' on a pathway requiring a device without a devices row of the
-- matching device_kind. Attestation is permitted; a tick-box is not." Also: "BP cuff with no
-- arm_circumference_cm -> block enrolment completion until captured."
--
-- Interpretation flagged, not guessed silently (ported from the parallel tarragon-control build
-- of this same spec): "matching device_kind" implies a mapping from pathway (programme_code:
-- control/concierge) to a required device_kind, but no such mapping exists anywhere in Phase 1 --
-- programme_code doesn't encode condition (hypertension vs diabetes), and there is no
-- per-condition device requirement table. Read here as: any active enrolment requires AT LEAST
-- ONE devices row (of any kind) for that patient. Revisit if/when programmes gain a condition
-- dimension.
create or replace function private.enforce_device_capture_before_active_enrolment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_device_count int;
  v_bp_missing_arm int;
begin
  if new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' then
    return new;
  end if;

  select count(*) into v_device_count from devices where patient_id = new.patient_id;
  if v_device_count = 0 then
    raise exception 'M4: enrolment cannot activate -- patient % has no captured devices row. Attestation is permitted but a tick-box is not: make, model, is_wrist and approx_age_years (and arm_circumference_cm for a BP cuff) must be genuinely captured first.', new.patient_id
      using errcode = '23514';
  end if;

  select count(*) into v_bp_missing_arm
  from devices
  where patient_id = new.patient_id
    and device_kind = 'bp'
    and arm_circumference_cm is null;

  if v_bp_missing_arm > 0 then
    raise exception 'M4: enrolment cannot activate -- patient % has a BP cuff device with no arm_circumference_cm captured.', new.patient_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger enforce_device_capture_before_active_enrolment_trigger
  before insert or update of status on enrolments
  for each row execute function private.enforce_device_capture_before_active_enrolment();
