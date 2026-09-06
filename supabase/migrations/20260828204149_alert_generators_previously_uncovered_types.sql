-- Tarragon Health — Alert System infrastructure, part 5/6: generators for
-- the 8.1 alert types that had no real source yet.
--
-- Per the audit behind this feature, 8 of 16 alert_type_code values already
-- have a live generator (the pre-existing clinician_alerts triggers, see
-- part 2b's header). This migration adds real, event-driven generators for
-- three more, wherever a genuine source table/transition exists:
--   - missed_appointment  <- appointments.status -> 'no_show'
--   - failed_referral     <- specialist_referrals.status -> 'declined'
--   - adherence_problem   <- medication_adherence_alerts.level -> 'doctor'
--     (bridges the existing, separate coach/doctor adherence ladder into
--     the unified clinician_alerts inbox WITHOUT replacing or duplicating
--     that ladder -- medication_adherence_alerts stays the source of truth
--     for coach-level follow-up; this only mirrors the doctor-level rung)
-- plus three staleness sweeps for types with no single triggering write,
-- only a "this has sat too long" condition:
--   - overdue_task        <- care_outreach_tasks stuck open, no nudge, 72h+
--   - laboratory_failure  <- lab_orders stuck 'ordered', no sample, 5d+
--   - pharmacy_problem    <- pharmacy_orders stuck requested/confirmed, 3d+
--
-- The remaining five type_codes (abnormal_result, abnormal_monitoring,
-- symptom_escalation, medication_safety, deterioration, overdue_monitoring,
-- refill_due, potential_interaction, provider_unavailable,
-- appointment_failure) either already have a generator (part 2b) or have no
-- source table that maps to them without inventing one (see alert_rules'
-- evidence_basis field for each, part 1) -- not built here, per this
-- project's own standing rule against building ahead of a real event
-- source.
--
-- private.raise_clinician_alert() is a small shared helper: six call sites
-- below all do the same insert with different values, so one function
-- beats six near-identical inserts.

create or replace function private.raise_clinician_alert(
  p_organisation_id uuid,
  p_patient_id uuid,
  p_level public.alert_level,
  p_title text,
  p_detail text,
  p_category public.alert_category,
  p_type_code public.alert_type_code
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, detail, category, type_code)
  values (p_organisation_id, p_patient_id, p_level, 'open', p_title, p_detail, p_category, p_type_code)
  returning id;
$$;

comment on function private.raise_clinician_alert(uuid, uuid, public.alert_level, text, text, public.alert_category, public.alert_type_code) is
  'Shared insert helper for the new alert generators in this migration. severity/dedup/auto-assignment are still handled entirely by private.classify_and_assign_clinician_alert() (part 2b) -- this just avoids repeating the same six-column insert six times.';

revoke all on function private.raise_clinician_alert(uuid, uuid, public.alert_level, text, text, public.alert_category, public.alert_type_code) from public, anon;

-- ---------------------------------------------------------------------------
-- missed_appointment
-- ---------------------------------------------------------------------------

create or replace function private.raise_missed_appointment_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'no_show' or old.status = 'no_show' then
    return new;
  end if;

  perform private.raise_clinician_alert(
    new.organisation_id, new.patient_id, 'clinician_review',
    'Missed appointment',
    format('Appointment scheduled for %s was recorded as a no-show.%s',
      to_char(new.scheduled_for, 'YYYY-MM-DD HH24:MI'),
      case when new.reason is not null then ' Reason for visit: ' || new.reason else '' end),
    'care_management', 'missed_appointment'
  );

  return new;
end;
$$;

create trigger appointments_raise_missed_appointment_alert
  after update of status on public.appointments
  for each row execute function private.raise_missed_appointment_alert();

-- ---------------------------------------------------------------------------
-- failed_referral
-- ---------------------------------------------------------------------------

create or replace function private.raise_failed_referral_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'declined' or old.status = 'declined' then
    return new;
  end if;

  perform private.raise_clinician_alert(
    new.organisation_id, new.patient_id, 'clinician_review',
    'Specialist referral declined',
    format('Referral to %s was declined.%s', new.specialist_type,
      case when new.referral_reason is not null then ' Original reason: ' || new.referral_reason else '' end),
    'care_management', 'failed_referral'
  );

  return new;
end;
$$;

create trigger specialist_referrals_raise_failed_referral_alert
  after update of status on public.specialist_referrals
  for each row execute function private.raise_failed_referral_alert();

-- ---------------------------------------------------------------------------
-- adherence_problem (bridge, not a replacement -- see header)
-- ---------------------------------------------------------------------------

create or replace function private.bridge_doctor_adherence_alert_to_clinician_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_drug text;
begin
  if new.level <> 'doctor' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.level = 'doctor' then
    return new;
  end if;

  select drug_name into v_drug from public.medications where id = new.medication_id;

  perform private.raise_clinician_alert(
    new.organisation_id, new.patient_id, 'urgent_escalation',
    'Medication adherence: doctor review needed',
    format('%s missed doses in the last %s days for %s.', new.missed_count, new.window_days, coalesce(v_drug, 'a medication')),
    'medication', 'adherence_problem'
  );

  return new;
end;
$$;

create trigger medication_adherence_alerts_bridge_to_clinician_alerts
  after insert or update on public.medication_adherence_alerts
  for each row execute function private.bridge_doctor_adherence_alert_to_clinician_alerts();

-- ---------------------------------------------------------------------------
-- overdue_task, laboratory_failure, pharmacy_problem -- staleness sweeps.
-- Each carries its own not-exists guard as a second, belt-and-suspenders
-- dedup layer on top of classify_and_assign's own 24h dedup_key detection
-- (part 2b) -- a daily sweep re-running while the underlying condition is
-- still true should not regenerate a fresh alert every single run.
-- ---------------------------------------------------------------------------

create or replace function private.raise_overdue_task_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.raise_clinician_alert(
    cot.organisation_id, cot.patient_id, 'routine',
    'Overdue care-coordination task',
    format('Outreach task (%s) has been open since %s with no follow-up recorded.', cot.trigger_type, to_char(cot.created_at, 'YYYY-MM-DD')),
    'care_management', 'overdue_task'
  )
  from public.care_outreach_tasks cot
  where cot.status = 'open'
    and cot.nudge_sent_at is null
    and cot.created_at < now() - interval '72 hours'
    and not exists (
      select 1 from public.clinician_alerts ca
      where ca.type_code = 'overdue_task' and ca.patient_id = cot.patient_id
        and ca.status in ('open', 'acknowledged') and ca.created_at > now() - interval '20 hours'
    );
end;
$$;

comment on function private.raise_overdue_task_alerts() is
  'Daily sweep: a care_outreach_tasks row still open, un-nudged, 72h+ old raises a routine clinician_alerts row (8.1 overdue_task) so a stalled coordination task gets supervisory visibility beyond the coordinator worklist alone.';

revoke all on function private.raise_overdue_task_alerts() from public, anon;

select cron.schedule('overdue-care-outreach-task-alerts', '15 3 * * *', $$select private.raise_overdue_task_alerts()$$);

create or replace function private.raise_laboratory_failure_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.raise_clinician_alert(
    lo.organisation_id, lo.patient_id, 'clinician_review',
    'Lab order stalled before sample collection',
    format('Lab order %s has been in "ordered" status since %s with no sample collected.', coalesce(lo.order_number, lo.id::text), to_char(lo.ordered_at, 'YYYY-MM-DD')),
    'operational', 'laboratory_failure'
  )
  from public.lab_orders lo
  where lo.status = 'ordered'
    and lo.ordered_at < now() - interval '5 days'
    and not exists (
      select 1 from public.clinician_alerts ca
      where ca.type_code = 'laboratory_failure' and ca.patient_id = lo.patient_id
        and ca.status in ('open', 'acknowledged') and ca.created_at > now() - interval '20 hours'
    );
end;
$$;

comment on function private.raise_laboratory_failure_alerts() is
  'Daily sweep: a lab_orders row stuck in ordered status 5d+ with no sample_collected transition raises a clinician_review clinician_alerts row (8.1 laboratory_failure).';

revoke all on function private.raise_laboratory_failure_alerts() from public, anon;

select cron.schedule('laboratory-failure-alerts', '30 3 * * *', $$select private.raise_laboratory_failure_alerts()$$);

create or replace function private.raise_pharmacy_problem_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.raise_clinician_alert(
    po.organisation_id, po.patient_id, 'clinician_review',
    'Pharmacy order stalled before dispensing',
    format('Pharmacy order %s has been "%s" since %s without progressing to dispensed.', coalesce(po.order_number, po.id::text), po.status, to_char(po.requested_at, 'YYYY-MM-DD')),
    'medication', 'pharmacy_problem'
  )
  from public.pharmacy_orders po
  where po.status in ('requested', 'confirmed')
    and po.requested_at < now() - interval '3 days'
    and not exists (
      select 1 from public.clinician_alerts ca
      where ca.type_code = 'pharmacy_problem' and ca.patient_id = po.patient_id
        and ca.status in ('open', 'acknowledged') and ca.created_at > now() - interval '20 hours'
    );
end;
$$;

comment on function private.raise_pharmacy_problem_alerts() is
  'Daily sweep: a pharmacy_orders row stuck requested/confirmed 3d+ without reaching dispensed raises a clinician_review clinician_alerts row (8.1 pharmacy_problem).';

revoke all on function private.raise_pharmacy_problem_alerts() from public, anon;

select cron.schedule('pharmacy-problem-alerts', '45 3 * * *', $$select private.raise_pharmacy_problem_alerts()$$);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'appointments_raise_missed_appointment_alert' and tgrelid = 'public.appointments'::regclass and not tgisinternal) then
    raise exception 'appointments_raise_missed_appointment_alert trigger was not created';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'specialist_referrals_raise_failed_referral_alert' and tgrelid = 'public.specialist_referrals'::regclass and not tgisinternal) then
    raise exception 'specialist_referrals_raise_failed_referral_alert trigger was not created';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'medication_adherence_alerts_bridge_to_clinician_alerts' and tgrelid = 'public.medication_adherence_alerts'::regclass and not tgisinternal) then
    raise exception 'medication_adherence_alerts_bridge_to_clinician_alerts trigger was not created';
  end if;
  if not exists (select 1 from cron.job where jobname = 'overdue-care-outreach-task-alerts') then
    raise exception 'overdue-care-outreach-task-alerts cron job was not scheduled';
  end if;
  if not exists (select 1 from cron.job where jobname = 'laboratory-failure-alerts') then
    raise exception 'laboratory-failure-alerts cron job was not scheduled';
  end if;
  if not exists (select 1 from cron.job where jobname = 'pharmacy-problem-alerts') then
    raise exception 'pharmacy-problem-alerts cron job was not scheduled';
  end if;
  raise notice 'PASS: all 6 new alert generators (3 triggers + 3 sweeps) installed and scheduled';
end $$;
