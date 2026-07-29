-- ===========================================================================
-- Diabetes Clinical Pathway — Sprint A.2 (G4): missing-expected-log safety net
-- ---------------------------------------------------------------------------
-- §15.5 / §16: "Missing expected data ... is itself a soft red flag — the
-- platform chases it ... and never assumes silence is safe." A daily job flags
-- any patient on an active diabetes care plan who has not logged a glucose
-- reading in over 7 days, raising ONE deduped amber clinician_alert so a human
-- checks in (are they well? out of strips? disengaged?). Deliberately lean —
-- a per-treatment "expected cadence" model can tighten this later.
-- ===========================================================================

create or replace function private.flag_missing_glucose_logs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level)
  select distinct
    cp.organisation_id,
    cp.patient_id,
    'clinician_review'::public.alert_level,
    'open'::public.alert_status,
    'No recent glucose logs',
    'This patient on an active diabetes care plan has not logged a glucose reading in over 7 days. Silence is not assumed safe (§15.5) — check in: confirm they are well, have test strips / supplies, and help them resume logging.',
    now() + interval '72 hours',
    2::smallint
  from public.care_plans cp
  where cp.condition = 'diabetes'
    and cp.status = 'active'
    and not exists (
      select 1 from public.vitals_readings v
      where v.patient_id = cp.patient_id
        and v.vital_type = 'glucose'
        and v.taken_at >= now() - interval '7 days'
    )
    and not exists (
      select 1 from public.clinician_alerts a
      where a.patient_id = cp.patient_id
        and a.title = 'No recent glucose logs'
        and a.status = 'open'
    );
end;
$$;

-- Idempotent (re)schedule.
do $$ begin
  perform cron.unschedule('diabetes-missing-glucose-daily');
exception when others then null;
end $$;

select cron.schedule(
  'diabetes-missing-glucose-daily',
  '30 6 * * *',
  $$select private.flag_missing_glucose_logs();$$
);
