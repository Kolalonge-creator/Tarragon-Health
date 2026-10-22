-- S70b item 4: a wrist or ring blood pressure that looks high is a RISK FLAG, never a diagnosis. The person is asked, calmly, to take a cuff reading this week, and
-- a task on their own list says so. This migration adds ONLY that task. It does not page anyone, raise a clinician alert, grade, average or change any number.
--
-- HOW IT FITS THE EXISTING RULE (docs/design/BP-wearable-estimates.md, migration 20261016200822): a wearable blood pressure (source = 'wearable') is already an
-- ESTIMATE. It is kept and shown, left out of every diagnostic number, and, behind platform module device_cuffless_bp_informational (born OFF, the CMO's choice,
-- OQ-BPW-1), a red or amber estimate gives the person the usual recheck guidance with no clinician page. That migration is NOT touched here. This one adds a
-- separate, independently switched, patient-only prompt: platform module device_cuffless_cuff_check_task, BORN OFF.
--
-- WHAT IT DOES (module on): after a wearable blood pressure is saved, if the LIVE deterministic classifier (private.classify_bp_level, INV-01 no model) puts it in
-- the amber or red band, one open "take a cuff reading this week" task is created on the person's own care_tasks list (kind log_bp, owner patient, due in
-- private.cuffless_cuff_check_days()). One open task at a time: a second estimate while one is open adds nothing. The title and description name no value, no band and
-- no condition (INV-07). An emergency-level estimate is NOT handled here: the existing emergency path owns it and a "this week" task would be wrong.
-- Failure to create the task writes an audit row and never blocks the reading (a task is a convenience, the reading may be dangerous).
--
-- NUMBERS: the 7 days is the PROPOSED, unsigned configuration bp.cuffless_calibration.cuffCheckWithinDays (packages/shared proposed-config); a mirror test keeps this
-- function and that entry equal. The 28-day "stale" label is app-side only. Nothing here is signed or approved.

insert into public.platform_modules (key, label, description) values
  ('device_cuffless_cuff_check_task', 'Wearable blood pressure estimate prompts a cuff check',
   'When a blood pressure estimate from a watch, ring or phone sensor looks high, the person gets a calm task to take a cuff reading this week. It pages nobody and changes no number. Off: no task is made.')
on conflict (key) do nothing;

create or replace function private.cuffless_cuff_check_days() returns integer
language sql immutable parallel safe set search_path = '' as $$ select 7 $$;
comment on function private.cuffless_cuff_check_days() is 'PROPOSED (bp.cuffless_calibration.cuffCheckWithinDays, unsigned, CMO owned): days the person is given to take a cuff reading. Mirrored by packages/shared proposed-config; a test keeps them equal.';
revoke all on function private.cuffless_cuff_check_days() from public, anon;
grant execute on function private.cuffless_cuff_check_days() to authenticated, service_role;

create or replace function private.cuffless_cuff_check_task() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_level text;
begin
  if not private.module_enabled('device_cuffless_cuff_check_task') then return new; end if;
  if new.vital_type <> 'blood_pressure' or not private.bp_reading_is_estimate(new.source::text) then return new; end if;
  if new.systolic is null or new.diastolic is null then return new; end if;
  begin
    v_level := private.classify_bp_level(new.systolic::int, new.diastolic::int);
    -- amber and red only: green and unknown need nothing, and emergency belongs to the emergency path.
    if v_level not in ('amber', 'red') then return new; end if;
    if exists (
      select 1 from public.care_tasks t
       where t.patient_id = new.patient_id and t.source = 'cuffless_estimate'
         and t.status in ('not_started', 'scheduled', 'in_progress')
    ) then
      return new;
    end if;
    insert into public.care_tasks (organisation_id, patient_id, title, description, owner_role, priority, due_at, source, kind)
    values (new.organisation_id, new.patient_id,
            'Take a blood pressure reading with a cuff this week',
            'A reading from a watch or ring is only an estimate. A cuff reading tells us what your blood pressure really is.',
            'patient', 2, now() + make_interval(days => private.cuffless_cuff_check_days()), 'cuffless_estimate', 'log_bp');
  exception when others then
    -- never lose or delay the reading because a convenience task could not be written; leave a trace
    begin
      perform private.log_audit('cuffless_cuff_check_task.failed', 'vitals_readings', new.id, jsonb_build_object('sqlstate', sqlstate));
    exception when others then
      null;
    end;
  end;
  return new;
end $$;
revoke all on function private.cuffless_cuff_check_task() from public, anon, authenticated;

drop trigger if exists vitals_readings_z_cuffless_cuff_check_task on public.vitals_readings;
create trigger vitals_readings_z_cuffless_cuff_check_task
  after insert on public.vitals_readings
  for each row
  when (new.vital_type = 'blood_pressure' and new.source = 'wearable')
  execute function private.cuffless_cuff_check_task();

do $$
begin
  if private.module_enabled('device_cuffless_cuff_check_task') then raise exception 'S70b: the cuff-check task module was born on'; end if;
  if has_function_privilege('anon', 'private.cuffless_cuff_check_task()', 'EXECUTE') then raise exception 'S70b: anon can execute the cuff-check trigger function'; end if;
  if has_function_privilege('anon', 'private.cuffless_cuff_check_days()', 'EXECUTE') then raise exception 'S70b: anon can execute cuffless_cuff_check_days'; end if;
  if (select prosrc from pg_proc where proname = 'cuffless_cuff_check_task' and pronamespace = 'private'::regnamespace) ilike '%clinician_alerts%' then
    raise exception 'S70b: the cuff-check task must never raise a clinician alert';
  end if;
end $$;
