-- ===========================================================================
-- Verification: private.queue_medication_lab_monitoring_reminders()
-- (20260829160625) — medication safety pathway 64.13. A monitoring row due
-- within 7 days gets a queued reminder notification and reminder_sent_at
-- stamped; one due later, or with no fixed due_date at all, does not.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
-- Wrapped in BEGIN/ROLLBACK.
-- ===========================================================================

begin;

create temporary table mlmr_fixture(k text primary key, v uuid) on commit drop;
create temporary table mlmr_result(
  check_name text, role text, observed text, expected text, verdict text
) on commit drop;

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_med uuid;
  v_due_soon uuid;
  v_due_later uuid;
  v_no_due_date uuid;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;
  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;
  select id into v_patient from public.profiles where role = 'patient' and organisation_id = v_org limit 1;

  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source)
  values (v_org, v_patient, 'MLMR Test Warfarin', '5mg', 'once daily', true, 'clinician')
  returning id into v_med;

  insert into public.medication_lab_monitoring
    (organisation_id, patient_id, medication_id, drug_class, monitoring_label, status, due_date)
  values (v_org, v_patient, v_med, 'Warfarin', 'INR monitoring (due soon)', 'pending', current_date + 3)
  returning id into v_due_soon;

  insert into public.medication_lab_monitoring
    (organisation_id, patient_id, medication_id, drug_class, monitoring_label, status, due_date)
  values (v_org, v_patient, v_med, 'Warfarin', 'INR monitoring (due later)', 'pending', current_date + 60)
  returning id into v_due_later;

  insert into public.medication_lab_monitoring
    (organisation_id, patient_id, medication_id, drug_class, monitoring_label, status, due_date)
  values (v_org, v_patient, v_med, 'Warfarin', 'INR monitoring (as indicated)', 'pending', null)
  returning id into v_no_due_date;

  insert into mlmr_fixture(k, v) values
    ('org', v_org), ('patient', v_patient), ('med', v_med),
    ('due_soon', v_due_soon), ('due_later', v_due_later), ('no_due_date', v_no_due_date);
end $$;

do $$
begin
  perform private.queue_medication_lab_monitoring_reminders();
end $$;

-- ==========================================================================
-- 1. Due within 7 days: reminder_sent_at stamped + BOTH a whatsapp and an
--    in_app notification queued (20260829190140 — the in_app companion is
--    not optional: it's the only channel that needs no external provider
--    approval, and Meta/Termii approval is still pending platform-wide).
-- ==========================================================================
do $$
declare
  v_id uuid := (select v from mlmr_fixture where k = 'due_soon');
  v_patient uuid := (select v from mlmr_fixture where k = 'patient');
  v_reminder_sent timestamptz;
  v_whatsapp_count bigint;
  v_in_app_count bigint;
begin
  select reminder_sent_at into v_reminder_sent from public.medication_lab_monitoring where id = v_id;
  select count(*) into v_whatsapp_count from public.notifications
  where recipient_id = v_patient and template = 'medication_lab_monitoring_due' and channel = 'whatsapp'
    and payload->>'monitoring_label' = 'INR monitoring (due soon)';
  select count(*) into v_in_app_count from public.notifications
  where recipient_id = v_patient and template = 'medication_lab_monitoring_due' and channel = 'in_app'
    and payload->>'monitoring_label' = 'INR monitoring (due soon)';

  insert into mlmr_result values
    ('a monitoring row due in 3 days gets a stamped reminder + whatsapp + in_app notifications', 'system',
     format('stamped=%s/whatsapp=%s/in_app=%s',
       case when v_reminder_sent is not null then 'yes' else 'no' end, v_whatsapp_count, v_in_app_count),
     'stamped=yes/whatsapp=1/in_app=1',
     case when v_reminder_sent is not null and v_whatsapp_count = 1 and v_in_app_count = 1
          then 'PASS' else 'FAIL' end);
  if v_reminder_sent is null or v_whatsapp_count <> 1 or v_in_app_count <> 1 then
    raise exception 'BROKEN: a due-soon medication_lab_monitoring row did not get reminded on both channels';
  end if;
end $$;

-- ==========================================================================
-- 2. Due in 60 days: not reminded yet.
-- ==========================================================================
do $$
declare
  v_id uuid := (select v from mlmr_fixture where k = 'due_later');
  v_reminder_sent timestamptz;
begin
  select reminder_sent_at into v_reminder_sent from public.medication_lab_monitoring where id = v_id;

  insert into mlmr_result values
    ('a monitoring row due in 60 days is not reminded yet', 'system',
     case when v_reminder_sent is null then 'not reminded' else 'reminded' end, 'not reminded',
     case when v_reminder_sent is null then 'PASS' else 'FAIL' end);
  if v_reminder_sent is not null then
    raise exception 'BROKEN: a monitoring row due in 60 days was reminded early';
  end if;
end $$;

-- ==========================================================================
-- 3. No fixed due_date ("as clinically indicated"): never reminded, sweep
--    does not error on it.
-- ==========================================================================
do $$
declare
  v_id uuid := (select v from mlmr_fixture where k = 'no_due_date');
  v_reminder_sent timestamptz;
begin
  select reminder_sent_at into v_reminder_sent from public.medication_lab_monitoring where id = v_id;

  insert into mlmr_result values
    ('a monitoring row with no fixed due_date is never reminded', 'system',
     case when v_reminder_sent is null then 'not reminded' else 'reminded' end, 'not reminded',
     case when v_reminder_sent is null then 'PASS' else 'FAIL' end);
  if v_reminder_sent is not null then
    raise exception 'BROKEN: a monitoring row with no fixed due_date was incorrectly reminded';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from mlmr_result
order by verdict desc, check_name, role;

rollback;
