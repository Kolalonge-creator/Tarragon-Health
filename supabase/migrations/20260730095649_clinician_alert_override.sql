-- Tarragon Health
-- v3 port: "deterministic always-classify with a clinician_override field."
-- CLAUDE.md's "PORT IT IN" list. The platform's automatic classification
-- (clinician_alerts.level, set deterministically by triggers like
-- private.handle_abnormal_screening_result / the BP/diabetes red-flag
-- engines) had no field for a clinician to record disagreement with the
-- system's assigned level -- the only existing write path
-- (useAcknowledgeAlert in lib/queries/clinician-alerts.ts) touches
-- status/acknowledged_by/acknowledged_at only, never level, and no UI
-- anywhere lets a human override the classification. `level` itself is
-- deliberately left untouched (never manually mutated) so the system's own
-- classification is always preserved -- this adds a SEPARATE override
-- channel, not a way to overwrite history.
--
-- Same "RLS admits broadly, a trigger narrows" pattern as
-- enforce_medication_confirm_only/can_confirm_medication_refill:
-- clinician_alerts_update's RLS already allows any org-staff to update this
-- table (private.is_org_staff), which per the Clinical Tier Ladder rule
-- must NEVER let a Care Coordinator make a clinical judgment call (no
-- clinical_staff row = no override, structurally, not just by app-layer
-- convention). overridden_by/overridden_at are server-derived from the
-- caller's own active clinical_staff row -- never client-supplied, same
-- forge-proof discipline as last_confirmed_by/reviewed_by elsewhere in
-- this schema.

alter table public.clinician_alerts
  add column override_level  public.alert_level,
  add column override_reason text,
  add column overridden_by   uuid references public.clinical_staff (id) on delete set null,
  add column overridden_at   timestamptz,
  add constraint clinician_alerts_override_reason_required
    check (override_level is null or override_reason is not null);

create index clinician_alerts_overridden_by_idx
  on public.clinician_alerts (overridden_by) where overridden_by is not null;

comment on column public.clinician_alerts.level is
  'The system''s own deterministic classification. Never manually mutated -- see override_level for a clinician''s recorded disagreement.';
comment on column public.clinician_alerts.override_level is
  'A clinician''s explicit override of the system-assigned level, with override_reason required. The effective level for triage/display purposes is coalesce(override_level, level). level itself is left untouched so the original auto-classification is always recoverable.';

create or replace function private.enforce_alert_override_clinical_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_staff_id uuid;
begin
  -- Nothing override-related is changing on this update (e.g. the existing
  -- acknowledge-alert write touches status/acknowledged_by/acknowledged_at
  -- only) -- preserve whatever is already there and never let a client
  -- spoof overridden_by/overridden_at on an unrelated write.
  if new.override_level is not distinct from old.override_level
    and new.override_reason is not distinct from old.override_reason
  then
    new.overridden_by := old.overridden_by;
    new.overridden_at := old.overridden_at;
    return new;
  end if;

  select id into v_caller_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active;

  if v_caller_staff_id is null then
    raise exception 'Only an active clinician can override an alert''s classification' using errcode = '42501';
  end if;

  if new.override_level is null then
    -- Clearing a previously-set override.
    new.override_reason := null;
    new.overridden_by := null;
    new.overridden_at := null;
  else
    new.overridden_by := v_caller_staff_id;
    new.overridden_at := now();
  end if;

  return new;
end;
$$;

create trigger clinician_alerts_enforce_override_clinical_only
  before update on public.clinician_alerts
  for each row execute function private.enforce_alert_override_clinical_only();
