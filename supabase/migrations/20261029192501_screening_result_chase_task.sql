-- A person follows up when a screening result has not come back.
--
-- The patient-facing chase already exists (queue_screening_reminders: upcoming, due, overdue at +6 days, escalated at +20 days
-- with a push) and stops the moment a result is uploaded (screening_result_uploaded). It only ever reaches the PATIENT. A test
-- that was done at an outside lab but never reported therefore ends in one more push and then silence. Founder/CMO instruction
-- 2026-10-29: when the chase reaches its last stage, a person on the care team follows up.
--
-- WHO. Members only (private.patient_is_member). Free uses no doctor time, so no task is made for a Free patient; the patient
-- still gets every reminder. The task is for a CARE COORDINATOR: logistics only, never an interpretation of a result.
--
-- WHAT. One task of type screening_result_chase per screening schedule, ever (a completed task is not re-created for the same
-- schedule). It carries ids only (no test name, no result). It never contacts the patient on its own: a coordinator decides.
--
-- GATES. The type is PROPOSED (needs_confirmation) like silence_check. Until the CMO confirms it with confirm_task_type this
-- sweep creates nothing, and it creates nothing while the screening scheduler guard is off.
--
-- Counts before writing (live, read-only 2026-10-29): task_types has no screening_result_chase; screening_schedules 0 rows.

insert into public.task_types
  (code, version, priority_class, default_due_minutes, min_doctor_tier, required_competencies, lead_window_minutes, claim_timeout_minutes,
   pushable, creatable, source_task_keys, needs_confirmation, note)
values
  ('screening_result_chase', 1, 8, 2880, 'care_coordinator', '{}', 0, 60, false, true, '{}', true,
   'A Member''s printed screening request has had no result for 20 days after it fell due, and the patient reminders have run out. A coordinator checks whether the test was done and helps the patient upload it. Logistics only, never an interpretation. Ids only. PROPOSED, awaiting CMO confirmation.')
on conflict do nothing;

create or replace function private.chase_unreported_screening_results()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_made integer := 0;
begin
  -- inert until the scheduler is on and the CMO has confirmed the task type
  if not private.go_live_guard_on('screening_scheduler_enabled') then return 0; end if;
  if not exists (select 1 from public.task_types where code = 'screening_result_chase' and is_active and confirmed_at is not null) then
    return 0;
  end if;

  for r in
    select s.id as schedule_id, s.patient_id
      from public.screening_schedules s
      join public.profiles p on p.id = s.patient_id
     where s.reminder_stage = 'escalated'
       and s.status in ('pending', 'booked', 'overdue')
       and not private.screening_result_uploaded(s.id)
       and p.role = 'patient' and p.is_active
       and private.patient_is_member(s.patient_id)
       -- once per schedule, ever: a finished task does not come back for the same schedule
       and not exists (select 1 from public.clinical_tasks t
                        where t.dedup_key = 'screening_chase:' || s.id::text or t.dedup_key like 'screening_chase:' || s.id::text || '+%')
     order by s.due_date, s.id
     limit 200
  loop
    perform private.create_clinical_task(r.patient_id, 'screening_result_chase', null, 'screening_chase:' || r.schedule_id::text);
    v_made := v_made + 1;
  end loop;
  return v_made;
end $$;

revoke all on function private.chase_unreported_screening_results() from public, anon, authenticated;

select cron.schedule('screening-result-chase-daily', '50 6 * * *', $c$select private.chase_unreported_screening_results()$c$);

do $$
begin
  if not exists (select 1 from public.task_types where code = 'screening_result_chase' and min_doctor_tier = 'care_coordinator' and creatable) then
    raise exception 'screening_result_chase task type missing or not coordinator-tier';
  end if;
  if has_function_privilege('anon', 'private.chase_unreported_screening_results()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.chase_unreported_screening_results()', 'EXECUTE') then
    raise exception 'the chase sweep must not be callable by anon or authenticated';
  end if;
  if not exists (select 1 from cron.job where jobname = 'screening-result-chase-daily') then
    raise exception 'the nightly chase job was not scheduled';
  end if;
end $$;
