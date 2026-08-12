-- H17 (TH-CP-HTN-001 §14.7, §23): "A doctor who can't demonstrate red-flag
-- recognition doesn't take HTN cases." has_current_pathway_attestation() and
-- the htn-red-flags-v1 attestation flow (clinical_staff_attestations) were
-- built 2026-07-20 but never actually gated anywhere in app code — found
-- during a 2026-08-10 readiness audit. This closes that gap at the point a
-- clinician takes ownership of a case: acknowledging a clinician_alerts row
-- (useAcknowledgeAlert -> status 'open' -> 'acknowledged'). Scoped to alerts
-- sourced from a blood_pressure vitals_readings row only — this is an HTN
-- competency gate, not a blanket gate on every alert type (glucose/SpO2/
-- temperature/screening/AI-coach/CV-risk alerts are untouched).
--
-- DB-enforced (not app-layer only) to match the existing clinical-authority
-- pattern (private.has_prescribing_authority, private.can_handle_emergency_
-- escalation) — CLAUDE.md's own rule is that clinical authority is never
-- enforced only by which dashboard a login can reach.

create or replace function private.enforce_htn_alert_attestation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_bp boolean;
  v_staff_id uuid;
begin
  -- Only gate the open -> acknowledged transition; overrides, resolutions and
  -- other field updates are untouched.
  if new.status <> 'acknowledged' or old.status = 'acknowledged' or new.acknowledged_by is null then
    return new;
  end if;

  if new.vital_reading_id is null then
    return new;
  end if;

  select (vr.vital_type = 'blood_pressure') into v_is_bp
  from public.vitals_readings vr
  where vr.id = new.vital_reading_id;

  if coalesce(v_is_bp, false) is not true then
    return new;
  end if;

  select cs.id into v_staff_id
  from public.clinical_staff cs
  where cs.profile_id = new.acknowledged_by and cs.active is true;

  if v_staff_id is null or not private.has_current_pathway_attestation(v_staff_id, 'htn-red-flags-v1') then
    raise exception
      'Complete the hypertension red-flag competency attestation before taking BP red-flag cases (TH-CP-HTN-001 §14.7).'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists htn_alert_attestation_gate on public.clinician_alerts;
create trigger htn_alert_attestation_gate
  before update on public.clinician_alerts
  for each row
  execute function private.enforce_htn_alert_attestation();

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'htn_alert_attestation_gate'
  ) then
    raise exception 'htn_alert_attestation_gate trigger was not created';
  end if;
end $$;
