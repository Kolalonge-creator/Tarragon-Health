-- Tarragon Health — Device & Data Operations, part 4/6: alert taxonomy extension.
--
-- 55.17 "clinical downtime" needs a real, governed way to notify clinical operations and identify
-- patients requiring urgent monitoring when a device/wearable ingestion pipeline goes down. The
-- existing Alert System (20260828013011 onward) is exactly the machinery for this — clinician_alerts
-- + alert_rules governance + private.raise_clinician_alert() — but alert_type_code has no value for
-- "a data pipeline, not a patient's own condition, is the thing wrong." This migration adds one:
-- monitoring_pipeline_down, under the existing 'operational' category alongside
-- provider_unavailable/appointment_failure/laboratory_failure.
--
-- Split into its own migration (rather than folded into 20260829023051, which is the first
-- migration that actually USES this value in an executable insert) on the same discipline this
-- codebase already follows for enum additions (e.g. 20260828013522_alert_status_add_snoozed_closed
-- as its own file before 20260828014055 uses the new statuses): ALTER TYPE ... ADD VALUE cannot be
-- used in the same transaction that added it. This file only adds the value and extends alert_rules
-- (a jsonb document that stores type_code as a plain string, never cast to the enum, so no
-- same-transaction restriction applies there) — nothing in this file casts the new value to
-- alert_type_code itself. private.raise_clinician_alert() (in the next migration) does that cast,
-- safely, in a later transaction.

alter type public.alert_type_code add value if not exists 'monitoring_pipeline_down';

comment on type public.alert_type_code is
  '16 original values per 20260828013011''s taxonomy (8.1), plus monitoring_pipeline_down (added 20260829, 55.17) for the device/wearable connection-fleet''s own operational-downtime alerts — distinct from the other operational codes in that its evidence_basis is a data-pipeline health signal (integration_health_status/integration_incidents), not a patient-record staleness sweep.';

-- ---------------------------------------------------------------------------
-- Extend the active alert_rules version with a governed entry for the new
-- type, following the exact versioning discipline both escalation_slas and
-- alert_rules itself already use: read the current active config, append,
-- insert as the next version, deactivate the old one. Computed from
-- whatever the live active version actually is (never a hardcoded version
-- number) so this migration is correct regardless of how many alert_rules
-- versions have shipped since 20260828013011's v1.
-- ---------------------------------------------------------------------------
do $$
declare
  v_old_id      uuid;
  v_old_config  jsonb;
  v_old_version integer;
begin
  select id, config, version into v_old_id, v_old_config, v_old_version
  from public.alert_rules
  where is_active
  order by version desc
  limit 1;

  if v_old_config is null then
    raise exception 'No active alert_rules version found to extend';
  end if;

  update public.alert_rules set is_active = false where id = v_old_id;

  insert into public.alert_rules (version, config, notes, is_active)
  values (
    v_old_version + 1,
    v_old_config || jsonb_build_array(jsonb_build_object(
      'category', 'operational',
      'type_code', 'monitoring_pipeline_down',
      'default_severity', 2,
      'severity_meaning', 'Doctor review by default; the generator raises it per affected patient only when that patient is on an active chronic (hypertension/diabetes) care plan relying on the affected pipeline — see private.integration_component_affected_patients().',
      'evidence_basis', 'integration_health_status/integration_incidents (55.11/55.16/55.17) — raised by private.handle_integration_incident_opened() when a component transitions to state=down.',
      'owner_tier', 'tier_1',
      'backup_tier', 'care_coordinator',
      'senior_tier', 'tier_2',
      'ack_timeout_minutes', 60,
      'channel_sequence', jsonb_build_array('in_app', 'push'),
      'auto_suppress_duplicates', true,
      'suppress_window_minutes', 360,
      'effective_date', null,
      'review_date', null
    )),
    format(
      'v%s: extends v%s with monitoring_pipeline_down (device/wearable connection-fleet operations, 55.17 clinical downtime workflow). Active-but-unsigned like every prior version — flagged for Clinical Director review via public.sign_alert_rules().',
      v_old_version + 1, v_old_version
    ),
    true
  );
end $$;

do $$
begin
  if not exists (select 1 from pg_enum where enumtypid = 'public.alert_type_code'::regtype and enumlabel = 'monitoring_pipeline_down') then
    raise exception 'alert_type_code.monitoring_pipeline_down was not added';
  end if;
  if not exists (
    select 1 from public.alert_rules c, jsonb_array_elements(c.config) entry
    where c.is_active and entry->>'type_code' = 'monitoring_pipeline_down'
  ) then
    raise exception 'active alert_rules config has no monitoring_pipeline_down entry';
  end if;
  raise notice 'PASS: monitoring_pipeline_down alert type added and governed in the active alert_rules version';
end $$;
