-- Tarragon Health — medication safety pathway 64.8 (part 2 of 2, see
-- 20260829142846 for why this is a separate migration): a patient
-- repeatedly logging a dose as 'not_available' is genuine non-adherence —
-- they could not take the medicine, same downstream risk as a 'missed' dose
-- — and must count toward the same missed-dose escalation ladder
-- (private.evaluate_adherence_escalation, 20260716175000). Left out
-- deliberately: 'skipped' (already existed, was never counted — a
-- deliberate/clinician-sanctioned skip, not a risk signal) and the new
-- 'delayed' (the dose WAS taken, just later than scheduled — not a miss).
--
-- Body is byte-for-byte the live definition from
-- 20260716175000_medication_adherence_escalation.sql; only the status
-- comparisons in the early-return guard and the trailing-30-day count now
-- also match 'not_available'.

create or replace function private.evaluate_adherence_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missed integer;
  v_level  public.med_adherence_alert_level;
  v_alert  public.medication_adherence_alerts%rowtype;
begin
  if new.status not in ('missed', 'not_available') then
    return new;
  end if;

  select count(*) into v_missed
  from public.medication_logs
  where medication_id = new.medication_id
    and status in ('missed', 'not_available')
    and logged_at >= now() - interval '30 days';

  if v_missed >= 6 then
    v_level := 'doctor';
  elsif v_missed >= 3 then
    v_level := 'coach';
  else
    return new;
  end if;

  select * into v_alert
  from public.medication_adherence_alerts
  where medication_id = new.medication_id and status <> 'resolved'
  limit 1;

  if v_alert.id is null then
    insert into public.medication_adherence_alerts
      (organisation_id, patient_id, medication_id, level, missed_count)
    values
      (new.organisation_id, new.patient_id, new.medication_id, v_level, v_missed);
  else
    update public.medication_adherence_alerts
      set missed_count = v_missed,
          level = case when v_level = 'doctor' then 'doctor' else level end,
          status = case
            when status = 'acknowledged' and v_level = 'doctor' and level <> 'doctor'
            then 'open'::public.med_adherence_alert_status
            else status
          end
    where id = v_alert.id;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  if (select count(*) from pg_enum where enumtypid = 'public.medication_log_status'::regtype
        and enumlabel in ('delayed', 'not_available')) <> 2 then
    raise exception 'medication_log_status is missing delayed/not_available — run 20260829142846 first';
  end if;

  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'evaluate_adherence_escalation' and pronamespace = 'private'::regnamespace;

  if v_def not like '%not in (''missed'', ''not_available'')%'
     or v_def not like '%status in (''missed'', ''not_available'')%' then
    raise exception 'evaluate_adherence_escalation was not updated to count not_available';
  end if;
  -- Every pre-existing branch must survive the rewrite.
  if v_def not like '%v_missed >= 6%' or v_def not like '%v_missed >= 3%' then
    raise exception 'evaluate_adherence_escalation lost the coach/doctor threshold logic';
  end if;

  raise notice 'PASS: medication_log_status carries delayed/not_available, escalation counts not_available alongside missed';
end $$;
