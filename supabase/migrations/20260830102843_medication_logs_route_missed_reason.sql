-- Tarragon Health — route a missed-dose reason to the right intervention
-- (Engagement/Retention gap #1).
--
-- useLogDose() (apps/web/src/lib/queries/medications.ts) writes to
-- medication_logs directly from the browser's Supabase client, not through a
-- server action — so this routing must be enforced in the database, not in
-- client code, or a patient could simply never trigger it.
--
-- Two reasons the patient can self-resolve with a specific, non-generic
-- message ('forgot', 'feels_well') get a behavioural nudge notification.
-- The other four need a human — those route to the existing non-clinical
-- Care Coordinator outreach worklist (care_outreach_tasks), not the clinical
-- medication_adherence_alerts ladder (private.evaluate_adherence_escalation,
-- 20260716175000_medication_adherence_escalation.sql), since "why didn't you
-- take this" is a logistics/engagement problem per the Clinical Tier
-- Ladder's Care Coordinator scope, not a clinical-severity one. That
-- existing trigger is untouched by this migration.

create or replace function private.route_missed_dose_reason()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week_start date := date_trunc('week', (now() at time zone 'Africa/Lagos'))::date;
  v_per_day    int;
  v_total_wk   int;
  v_taken_wk   int;
  v_remaining  int;
  v_drug_name  text;
begin
  if new.status <> 'missed' or new.missed_reason is null then
    return new;
  end if;

  -- Only act on a genuine change into this state, not a no-op re-save.
  if tg_op = 'UPDATE'
     and old.status = new.status
     and old.missed_reason is not distinct from new.missed_reason then
    return new;
  end if;

  select drug_name, coalesce(jsonb_array_length(schedule_times), 0)
    into v_drug_name, v_per_day
  from public.medications
  where id = new.medication_id;

  v_total_wk := coalesce(v_per_day, 0) * 7;

  select count(*) into v_taken_wk
  from public.medication_logs
  where medication_id = new.medication_id
    and status = 'taken'
    and scheduled_for_date between v_week_start and v_week_start + 6;

  v_remaining := greatest(v_total_wk - v_taken_wk, 0);

  if new.missed_reason in ('forgot', 'feels_well') then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id,
      new.patient_id,
      'whatsapp',
      'pending',
      'missed_dose_behavioural_nudge',
      jsonb_build_object(
        'reason', new.missed_reason,
        'drug_name', coalesce(v_drug_name, 'your medication'),
        'taken_this_week', v_taken_wk,
        'total_this_week', v_total_wk,
        'remaining_this_week', v_remaining
      )
    );
  else
    insert into public.care_outreach_tasks (organisation_id, patient_id, trigger_type, trigger_detail, priority)
    values (
      new.organisation_id,
      new.patient_id,
      'medication_engagement_barrier',
      jsonb_build_object(
        'medication_id', new.medication_id,
        'drug_name', coalesce(v_drug_name, 'medication'),
        'missed_reason', new.missed_reason,
        'log_id', new.id,
        'condition_or_type', coalesce(v_drug_name, 'Medication')
      ),
      3
    )
    on conflict (patient_id, trigger_type) where status in ('open', 'in_progress', 'contacted') do nothing;
  end if;

  return new;
end;
$$;

revoke execute on function private.route_missed_dose_reason() from public;

drop trigger if exists medication_logs_route_missed_reason on public.medication_logs;
create trigger medication_logs_route_missed_reason
  after insert or update of status, missed_reason on public.medication_logs
  for each row execute function private.route_missed_dose_reason();

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'medication_logs_route_missed_reason'
      and tgrelid = 'public.medication_logs'::regclass
  ) then
    raise exception 'FAIL: medication_logs_route_missed_reason trigger was not created';
  end if;

  if has_function_privilege('anon', 'private.route_missed_dose_reason()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.route_missed_dose_reason()';
  end if;

  raise notice 'PASS: route_missed_dose_reason trigger installed, anon EXECUTE revoked';
end $$;
