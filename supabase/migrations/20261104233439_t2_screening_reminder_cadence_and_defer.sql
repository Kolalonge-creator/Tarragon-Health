-- T2 Phase 3, part 2 of 3: test reminders at 14, 7 and 1 day before due and 7 and 30 days overdue; the patient can move a test with a
-- recorded reason. Founder decision T2-12 (2026-11-04, chat; docs/DECISIONS.md).
--
-- WHY A NEW TABLE AND NOT THE SIGNED RULE SET. Until now the reminder timing lived in code (queue_screening_reminders: upcoming within 7
-- days, due, overdue after 6 days, escalated after 20). It was never inside screening_rule_sets, which holds WHO is screened for WHAT and
-- HOW OFTEN (the CMO-signed patient-harm list). When a reminder is sent is an operational setting under G-01 (docs/design/GATE-MODEL.md
-- rule 3): versioned, audited, a change note, no signature, no hub line. So the timing moves out of code into screening_reminder_configs.
--   v1 = the old timing exactly, recorded for history (inactive).
--   v2 = the founder's timing (active from this migration).
--
-- THE ENGINE. Each step has offsetDays (relative to the due date) and an optional untilDays (exclusive upper bound). Each night every open
-- schedule gets AT MOST ONE reminder: the first step, in order, whose offset is later than the last one it was sent, whose day has come,
-- and whose window has not closed. A schedule first seen late therefore gets the step that fits now, not a burst of old ones. The
-- grouping of more than 2 same-stage reminders into one message (20261030110000) is kept: each step goes through queue_screening_stage.
-- Templates are reused unchanged (they name a date, not a number of days), so no edge function changes.
--   v2 steps: due_in_14 [-14,-7) upcoming | due_in_7 [-7,-1) upcoming | due_in_1 [-1,7) due, with push | overdue_7 [7,..) overdue |
--             overdue_30 [30,..) escalated, with push.
-- A schedule that already reached a stage under the old code keeps it (the stage maps to an offset: upcoming -7, due 0, overdue 7,
-- escalated 30), so nobody is sent an old stage again on the switch.
--
-- COORDINATOR FOLLOW-UP. Reaching the last step (escalated, 30 days overdue) means the member has missed all five reminders. The existing
-- sweep private.chase_unreported_screening_results() (20261029192501) already raises one screening_result_chase task for a care
-- coordinator for a Member's schedule at stage 'escalated' (once per schedule, ever; ids only; members only). It is reused, unchanged:
-- with v2 it now fires at 30 days overdue instead of 20. That task type still waits for the CMO's confirm_task_type (needs_confirmation).
--
-- DEFER AND CANCEL. Cancel with a reason already exists (set_screening_state: declined / not applicable, reason code and note required).
-- New: public.defer_screening(schedule, new date, reason code, note): the patient (at most rules.defer.maxPerSchedule times) or a tied
-- clinician (no limit) moves the due date later, up to rules.defer.maxDaysAhead days ahead, with a reason code from the config and a note
-- (required for 'other'). The reminder sequence restarts against the new date; the old date and the reason are kept on the row and in
-- the audit log.
--
-- Counts before this migration (local replay): screening_reminder_configs does not exist; the four new columns do not exist.

-- ---------------------------------------------------------------------------
-- 1. Versioned operational setting
-- ---------------------------------------------------------------------------
create table public.screening_reminder_configs (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique check (version >= 1),
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null check (jsonb_typeof(rules -> 'steps') = 'array' and jsonb_array_length(rules -> 'steps') >= 1),
  change_note    text not null check (char_length(btrim(change_note)) >= 20),
  decided_by     text not null check (btrim(decided_by) <> ''),
  activated_at   timestamptz,
  activated_by   uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);
create unique index screening_reminder_configs_one_active on public.screening_reminder_configs (is_active) where is_active;
comment on table public.screening_reminder_configs is
  'T2-12: when screening reminders are sent (steps relative to the due date) and how a patient may move a test. An OPERATIONAL setting (G-01): versioned, a change note, no signature. History is never edited: a change is a new version.';

create function private.screening_reminder_configs_immutable() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'screening_reminder_configs keeps its history: a version is never deleted' using errcode = '55000'; end if;
  if new.version <> old.version or new.rules <> old.rules or new.change_note <> old.change_note or new.decided_by <> old.decided_by
     or new.effective_from <> old.effective_from then
    raise exception 'screening_reminder_configs is never edited: add a new version' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger screening_reminder_configs_no_edit before update or delete on public.screening_reminder_configs
  for each row execute function private.screening_reminder_configs_immutable();

alter table public.screening_reminder_configs enable row level security;
create policy screening_reminder_configs_read on public.screening_reminder_configs for select to authenticated using (true);
revoke all on public.screening_reminder_configs from public, anon, authenticated;
grant select on public.screening_reminder_configs to authenticated;

-- screening-reminder-config-v1-begin
insert into public.screening_reminder_configs (version, is_active, effective_from, decided_by, change_note, rules) values
(1, false, '2026-08-28', 'Engineering (S44 escalating reminders, 20260828183145; pacing 20261030110000)',
 'The timing that lived in code before T2-12: upcoming within 7 days, due on the day, overdue after 6 days, escalated after 20 days (only after overdue). Recorded for history; never active from this table.',
 $json${
  "steps": [
    {"code": "upcoming", "offsetDays": -7, "untilDays": 0, "stage": "upcoming", "template": "screening_upcoming", "push": false},
    {"code": "due", "offsetDays": 0, "untilDays": 7, "stage": "due", "template": "screening_due", "push": false},
    {"code": "overdue", "offsetDays": 7, "untilDays": null, "stage": "overdue", "template": "screening_overdue", "push": false},
    {"code": "escalated", "offsetDays": 21, "untilDays": null, "stage": "escalated", "template": "screening_escalated", "push": true}
  ],
  "coordinatorFollowUp": {"afterStage": "escalated", "taskType": "screening_result_chase", "membersOnly": true},
  "defer": null
 }$json$::jsonb);
-- screening-reminder-config-v1-end

-- screening-reminder-config-v2-begin
insert into public.screening_reminder_configs (version, is_active, effective_from, decided_by, change_note, rules, activated_at) values
(2, true, '2026-11-04', 'Founder decision T2-12, 2026-11-04 (chat)',
 'Brief section 6.4 timing: 14, 7 and 1 day before the test is due, then 7 and 30 days overdue, then a coordinator follows up a Member. In-app, push and email only (no WhatsApp, no SMS). The patient may move a test with a recorded reason.',
 $json${
  "steps": [
    {"code": "due_in_14", "offsetDays": -14, "untilDays": -7, "stage": "upcoming", "template": "screening_upcoming", "push": false},
    {"code": "due_in_7", "offsetDays": -7, "untilDays": -1, "stage": "upcoming", "template": "screening_upcoming", "push": false},
    {"code": "due_in_1", "offsetDays": -1, "untilDays": 7, "stage": "due", "template": "screening_due", "push": true},
    {"code": "overdue_7", "offsetDays": 7, "untilDays": null, "stage": "overdue", "template": "screening_overdue", "push": false},
    {"code": "overdue_30", "offsetDays": 30, "untilDays": null, "stage": "escalated", "template": "screening_escalated", "push": true}
  ],
  "coordinatorFollowUp": {"afterStage": "escalated", "taskType": "screening_result_chase", "membersOnly": true},
  "defer": {
    "maxDaysAhead": 180,
    "maxPerSchedule": 3,
    "reasonCodes": ["travelling", "unwell", "cost", "waiting_for_doctor_advice", "booked_for_later", "other"],
    "noteRequiredFor": ["other"],
    "noteMaxChars": 500
  }
 }$json$::jsonb, now());
-- screening-reminder-config-v2-end

create function private.screening_reminder_rules() returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules from public.screening_reminder_configs where is_active $$;

-- An admin or the CMO switches the active version (an operational setting: either role, a note, audited). Never edits one.
create function public.activate_screening_reminder_config(p_version integer, p_note text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_id uuid;
begin
  if v_uid is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'not_authorised: an admin or the CMO switches the reminder timing' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 20 then raise exception 'note_required: at least 20 characters' using errcode = '22023'; end if;
  select id into v_id from public.screening_reminder_configs where version = p_version;
  if v_id is null then raise exception 'version_not_found' using errcode = '22023'; end if;
  update public.screening_reminder_configs set is_active = false where is_active and id <> v_id;
  update public.screening_reminder_configs set is_active = true, activated_at = now(), activated_by = v_uid where id = v_id;
  perform private.log_audit('screening_reminder_config.activated', 'screening_reminder_configs', v_id,
    jsonb_build_object('version', p_version, 'note', btrim(p_note)));
  return v_id;
end $$;
revoke all on function public.activate_screening_reminder_config(integer, text) from public, anon;
grant execute on function public.activate_screening_reminder_config(integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Schedule columns
-- ---------------------------------------------------------------------------
alter table public.screening_schedules
  add column reminder_last_offset integer,
  add column original_due_date date,
  add column deferred_at timestamptz,
  add column deferred_reason_code text,
  add column deferred_note text,
  add column deferred_by uuid references public.profiles (id) on delete set null,
  add column defer_count integer not null default 0 check (defer_count >= 0);
alter table public.screening_schedules add constraint screening_schedules_deferral_has_reason
  check ((deferred_at is null) = (deferred_reason_code is null));
comment on column public.screening_schedules.reminder_last_offset is
  'T2-12: the offsetDays (relative to due_date) of the last reminder step sent. Null with reminder_stage null means none sent. Reset when the test is moved.';
comment on column public.screening_schedules.original_due_date is 'T2-12: the due date before the first deferral; null if never moved.';

-- what "already sent" means for a row: no stage = nothing; a stage set by the old code (no offset) maps to its offset
create function private.screening_effective_last_offset(p_stage public.reminder_stage, p_offset integer) returns integer
language sql immutable set search_path = ''
as $$ select case when p_stage is null then null
                  else coalesce(p_offset, case p_stage when 'upcoming' then -7 when 'due' then 0 when 'overdue' then 7 when 'escalated' then 30 end)
             end $$;

-- ---------------------------------------------------------------------------
-- 3. The nightly reminder job, read from the active configuration
-- ---------------------------------------------------------------------------
create or replace function private.queue_screening_reminders() returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_rules jsonb := private.screening_reminder_rules();
  r record;
  v_org uuid;
begin
  if v_rules is null then
    -- No active timing: send nothing rather than guess, but never silently. One sev3 ops incident while the outage lasts (the
    -- nightly run finds the open one and does not open a second), plus one audit row per day. No patient is named (INV-07).
    select o.id into v_org from public.organisations o order by o.created_at limit 1;
    if v_org is not null then
      if not exists (select 1 from public.audit_log a where a.action = 'screening_reminders.no_active_config'
                      and a.created_at >= date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos') then
        insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
        values (v_org, null, 'screening_reminders.no_active_config', 'screening_reminder_configs', null, '{}'::jsonb, 'failed');
      end if;
      if not exists (select 1 from public.ops_incidents i where i.external_reference = 'screening_reminders_no_active_config'
                      and i.status not in ('resolved', 'closed')) then
        insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at, owner_id)
        values (v_org, 'technical', 'sev3', 'Screening reminders stopped: no active reminder timing',
                'The nightly screening reminder job found no active row in screening_reminder_configs, so it sent no reminders. An admin or the CMO switches a version on with activate_screening_reminder_config(version, note). No patient is named here.',
                'screening_reminders_no_active_config', now(), now() + interval '1 day', private.screening_incident_owner(v_org));
      end if;
    end if;
    return;
  end if;
  for r in
    with steps as (
      select x ->> 'code' as code, (x ->> 'offsetDays')::integer as off, (x ->> 'untilDays')::integer as until_d,
             x ->> 'template' as tpl, x ->> 'stage' as stage, coalesce((x ->> 'push')::boolean, false) as push, o
        from jsonb_array_elements(v_rules -> 'steps') with ordinality as t(x, o)
    ), open as (
      select s.id, s.due_date, private.screening_effective_last_offset(s.reminder_stage, s.reminder_last_offset) as last_off
        from public.screening_schedules s
       where s.status in ('pending', 'booked', 'overdue') and not private.screening_result_uploaded(s.id)
    ), pick as (
      select distinct on (op.id) op.id, st.*
        from open op
        join steps st on st.off > coalesce(op.last_off, -100000)
                     and current_date >= op.due_date + st.off
                     and (st.until_d is null or current_date < op.due_date + st.until_d)
       order by op.id, st.o
    )
    select p.o, p.code, p.off, p.tpl, p.stage, p.push, array_agg(p.id order by p.id) as ids
      from pick p group by p.o, p.code, p.off, p.tpl, p.stage, p.push order by p.o
  loop
    perform private.queue_screening_stage(r.tpl, r.stage, r.ids, r.push);
    update public.screening_schedules set reminder_last_offset = r.off where id = any (r.ids);
  end loop;
end $$;

revoke all on function private.screening_reminder_rules(), private.queue_screening_reminders(),
  private.screening_effective_last_offset(public.reminder_stage, integer), private.screening_reminder_configs_immutable()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Defer (move a test later) with a recorded reason
-- ---------------------------------------------------------------------------
create function public.defer_screening(p_schedule uuid, p_new_due date, p_reason_code text, p_note text default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.screening_schedules%rowtype;
  v_cfg jsonb := private.screening_reminder_rules() -> 'defer';
  v_is_patient boolean;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if v_cfg is null or jsonb_typeof(v_cfg) <> 'object' then raise exception 'defer_not_available' using errcode = 'P0001'; end if;
  select * into v_row from public.screening_schedules where id = p_schedule for update;
  if not found then raise exception 'schedule_not_found' using errcode = '22023'; end if;
  v_is_patient := v_row.patient_id = v_uid;
  if not v_is_patient and not private.clinician_has_patient_access(v_row.patient_id) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if v_row.status not in ('pending', 'booked', 'overdue') then raise exception 'not_open' using errcode = '22023'; end if;
  if p_new_due is null or p_new_due <= greatest(v_row.due_date, current_date)
     or p_new_due > current_date + (v_cfg ->> 'maxDaysAhead')::integer then
    raise exception 'new_date_out_of_range: later than today and the current due date, at most % days ahead', v_cfg ->> 'maxDaysAhead'
      using errcode = '22023';
  end if;
  if p_reason_code is null or not ((v_cfg -> 'reasonCodes') ? p_reason_code) then raise exception 'reason_required' using errcode = '22023'; end if;
  if (v_cfg -> 'noteRequiredFor') ? p_reason_code and v_note is null then raise exception 'note_required' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > (v_cfg ->> 'noteMaxChars')::integer then raise exception 'note_too_long' using errcode = '22023'; end if;
  if v_is_patient and v_row.defer_count >= (v_cfg ->> 'maxPerSchedule')::integer then
    raise exception 'defer_limit_reached: ask your care team to move it again' using errcode = 'P0001';
  end if;

  update public.screening_schedules set
      original_due_date = coalesce(original_due_date, due_date),
      due_date = p_new_due,
      status = case when status = 'overdue' then 'pending'::public.screening_status else status end,
      reminder_stage = null,
      reminder_last_offset = null,
      deferred_at = now(),
      deferred_reason_code = p_reason_code,
      deferred_note = v_note,
      deferred_by = v_uid,
      defer_count = defer_count + 1
   where id = p_schedule;
  perform private.log_audit('screening.deferred', 'screening_schedules', p_schedule,
    jsonb_build_object('from', v_row.due_date, 'to', p_new_due, 'reason_code', p_reason_code,
                       'by', case when v_is_patient then 'patient' else 'clinician' end));
  return p_schedule;
end $$;
revoke all on function public.defer_screening(uuid, date, text, text) from public, anon;
grant execute on function public.defer_screening(uuid, date, text, text) to authenticated;

do $$
begin
  if (select count(*) from public.screening_reminder_configs where is_active) <> 1 then raise exception 'exactly one reminder config must be active'; end if;
  if (select version from public.screening_reminder_configs where is_active) <> 2 then raise exception 'v2 must be the active reminder config'; end if;
  if (select rules -> 'coordinatorFollowUp' ->> 'afterStage' from public.screening_reminder_configs where is_active)
     <> (select x ->> 'stage' from public.screening_reminder_configs c, jsonb_array_elements(c.rules -> 'steps') with ordinality t(x, o)
          where c.is_active order by o desc limit 1) then
    raise exception 'the last reminder step must reach the stage the coordinator sweep reads';
  end if;
  if has_function_privilege('anon', 'public.defer_screening(uuid,date,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.activate_screening_reminder_config(integer,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.queue_screening_reminders()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.screening_reminder_rules()', 'EXECUTE') then
    raise exception 'a reminder function is callable by the wrong role';
  end if;
end $$;

select private.rebuild_analytics_clean_views();
