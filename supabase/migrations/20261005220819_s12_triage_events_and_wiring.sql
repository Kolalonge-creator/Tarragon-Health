-- S12: wire the triage engine into the platform (spec 4.6, 5, 6.2 recheck flow, INV-01/05/13/14/16).
--
-- Live checked 2026-10-05 on koiplnmbgnqnbywhpjlf before writing this: no triage_events,
-- pages or clinical_tasks table; the event bus (S10) and triage_rule_sets (S11) are live with
-- no subscriber; vitals_readings has 12 rows and a triage_event_id column with no foreign key;
-- the live BP pipeline (private.classify_bp_level, vitals_readings_bp_red_flag) is NOT changed
-- here (OQ-67 decision: live bands stay until the CMO signs the new rule set).
--
-- What this adds:
--  1. public.triage_events (spec 4.6) - one row per graded result, append only, with the rule
--     set id and version (INV-16), a `shadow` flag, and the foreign key vitals_readings.triage_event_id.
--  2. public.triage_pending_rechecks - a first elevated reading waiting for its repeat.
--  3. A repeat-reading task for the patient (care_tasks, kind log_bp, source triage_recheck) and
--     patient_tasks exposing `source`.
--  4. Producers of observation.recorded: a trigger on blood pressure readings, a trigger for a
--     red-flag symptom that arrives just after one, and a one minute sweep that (a) turns an
--     unanswered recheck into a timed_out regrade and (b) re-emits any reading that never got its
--     event, so a failed emit is never silent.
--  5. Service-role functions the edge handler uses: triage_context_for_observation (read) and
--     record_triage_result (write, one transaction, idempotent).
--  6. The subscriber row `triage.grade_observation` (handler registered in process-events).
--
-- SHADOW (OQ-88): while no triage_rule_sets row is approved, the server grades with the draft
-- and every triage_events row and triage.graded event carries shadow = true. Subscribers added by
-- S16 (tasks) and S19 (paging) must ignore shadow events, so nothing new pages anyone or opens a
-- clinical task off an unsigned rule set; the live pipeline keeps doing that.

-- ---------------------------------------------------------------------------
-- 1. triage_events
-- ---------------------------------------------------------------------------
create table public.triage_events (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid references public.profiles (id) on delete set null,
  trigger_type     text not null check (trigger_type in ('observation', 'symptom_report', 'silence', 'adherence', 'result')),
  trigger_id       uuid not null,
  grade            text not null check (grade in ('green', 'amber', 'red')),
  rule_id          text,
  rule_set_id      uuid not null references public.triage_rule_sets (id) on delete restrict,
  rule_set_code    text not null,
  rule_set_version integer not null,
  rule_set_status  text not null check (rule_set_status in ('draft', 'approved', 'retired')),
  explanation_key  text,
  actions          jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array'),
  matched_rule_ids text[] not null default '{}',
  task_key         text,
  -- What the grade was based on (the symptoms and recheck state seen). A regrade with new facts, such as a
  -- red-flag symptom that arrives after the reading, is a new row; a redelivery of the same facts is not.
  basis            text not null default '',
  shadow           boolean not null,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  -- A redelivered event cannot grade the same trigger twice with the same rule set.
  unique (trigger_type, trigger_id, rule_set_id, basis),
  -- Shadow is exactly "graded by a rule set nobody has approved".
  check (shadow = (rule_set_status <> 'approved')),
  -- INV-05: a red result always asks for the on-call page.
  check (grade <> 'red' or actions @> '[{"kind":"page_on_call"}]'::jsonb)
);
create index triage_events_patient_idx on public.triage_events (patient_id, created_at desc) where patient_id is not null;

comment on table public.triage_events is 'S12: one row per graded triage result (spec 4.6). Append only. shadow = graded with a rule set the CMO has not approved; downstream subscribers must ignore shadow rows (OQ-88).';

create or replace function private.triage_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- The one allowed change: the foreign key's ON DELETE SET NULL when a profile is erased.
  if tg_op = 'UPDATE' and old.patient_id is not null and new.patient_id is null
     and (to_jsonb(new) - 'patient_id') = (to_jsonb(old) - 'patient_id') then
    return new;
  end if;
  raise exception 'triage_events is append only' using errcode = '55000';
end $$;
create trigger triage_events_no_update before update or delete on public.triage_events
  for each row execute function private.triage_events_append_only();
create trigger triage_events_no_truncate before truncate on public.triage_events
  for each statement execute function private.triage_events_append_only();

alter table public.triage_events enable row level security;
-- A patient reads their own results. Staff reach a patient through a task or page (S16 to S19, INV-12),
-- so there is deliberately no clinician policy here. Admin may read for investigation.
create policy triage_events_patient_read on public.triage_events for select to authenticated
  using (patient_id = (select auth.uid()));
create policy triage_events_admin_read on public.triage_events for select to authenticated
  using (private.is_admin());
revoke all on public.triage_events from public, anon, authenticated;
grant select on public.triage_events to authenticated;

-- Link the reading to its triage result (S05 left this column without a foreign key).
alter table public.vitals_readings
  add constraint vitals_readings_triage_event_fk
  foreign key (triage_event_id) references public.triage_events (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. Pending rechecks
-- ---------------------------------------------------------------------------
create table public.triage_pending_rechecks (
  observation_id uuid primary key references public.vitals_readings (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id     uuid not null references public.profiles (id) on delete cascade,
  due_at         timestamptz not null,
  state          text not null default 'pending' check (state in ('pending', 'resolved', 'timed_out', 'superseded')),
  timeout_emitted_at timestamptz,
  created_at     timestamptz not null default now()
);
create index triage_pending_rechecks_due_idx on public.triage_pending_rechecks (due_at) where state = 'pending';
create index triage_pending_rechecks_patient_idx on public.triage_pending_rechecks (patient_id) where state = 'pending';
alter table public.triage_pending_rechecks enable row level security;
revoke all on public.triage_pending_rechecks from public, anon, authenticated;
comment on table public.triage_pending_rechecks is 'S12: a first elevated reading waiting for its repeat (spec 6.2). No API access; written by record_triage_result, swept every minute.';

-- ---------------------------------------------------------------------------
-- 3. patient_tasks exposes `source` (appended last so the view can be replaced in place)
-- ---------------------------------------------------------------------------
create or replace view public.patient_tasks with (security_invoker = true) as
select
  t.id,
  t.patient_id,
  t.organisation_id,
  t.kind,
  t.title,
  t.priority,
  t.due_at,
  t.recurrence,
  t.owner_role,
  case t.status
    when 'completed' then 'done'
    when 'cancelled' then 'cancelled'
    when 'missed' then 'missed'
    when 'expired' then 'missed'
    when 'unable_to_complete' then 'unable'
    else 'open'
  end as state,
  t.status,
  t.source_event_id,
  t.care_plan_id,
  t.created_at,
  t.updated_at,
  t.source
from public.care_tasks t
where t.patient_id = (select auth.uid())
  and t.owner_role = 'patient';

-- The source lock refuses any non-staff edit of a device reading, so the backend could not link a
-- device reading to its triage result (found by the S12 proof: record_triage_result raised for a
-- device-sourced reading). Same body as the live function (checked 2026-10-05) plus two rules:
--   * a backend call (no signed-in user) may change triage_event_id and nothing else;
--   * a signed-in patient may never change triage_event_id on any reading (INV-16 integrity).
create or replace function private.enforce_vitals_reading_source_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.triage_event_id is distinct from new.triage_event_id then
    if (select auth.uid()) is null then
      if (to_jsonb(new) - 'triage_event_id') is distinct from (to_jsonb(old) - 'triage_event_id') then
        raise exception 'A backend update may only link the triage result' using errcode = '42501';
      end if;
      return new;
    end if;
    if not private.is_org_staff(old.organisation_id) then
      raise exception 'The triage result link cannot be changed from a patient session' using errcode = '42501';
    end if;
  end if;

  -- Org staff (any role): unrestricted, unchanged from prior behavior.
  if private.is_org_staff(old.organisation_id) then
    return new;
  end if;

  -- Patient session editing their own row: only a 'manual' reading may be
  -- touched. Anything else (device/wearable/cgm, or any future source
  -- value - deny-by-default, not an enumerated allowlist) is locked.
  if old.source is distinct from 'manual' then
    raise exception
      'This reading was recorded automatically (%) and cannot be edited directly. Contact your care team if it needs a correction.',
      old.source
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Producers of observation.recorded
-- ---------------------------------------------------------------------------
create or replace function private.emit_bp_observation_recorded()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.vital_type::text = 'blood_pressure' and new.systolic is not null and new.diastolic is not null then
    begin
      perform private.emit_domain_event(
        'observation.recorded', new.organisation_id,
        jsonb_build_object('observation_id', new.id),
        'bp:' || new.id::text,
        new.patient_id, 'observation', new.id);
    exception when others then
      -- A reading is never refused because the bus is unhappy. This is not silent: the warning is
      -- logged and private.sweep_triage_rechecks() re-emits any reading that has no event.
      raise warning 'S12: could not emit observation.recorded for %: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end $$;
create trigger vitals_readings_emit_observation_recorded
  after insert on public.vitals_readings
  for each row execute function private.emit_bp_observation_recorded();

-- A red-flag symptom that reaches the server just after the reading (offline order) regrades that reading.
create or replace function private.emit_symptom_regrade()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_obs public.vitals_readings%rowtype;
begin
  if new.symptom_type::text not in ('severe_headache', 'chest_pain', 'breathlessness', 'weakness_or_numbness',
       'difficulty_speaking', 'back_pain', 'confusion', 'visual_disturbance') then
    return null;
  end if;
  begin
    select * into v_obs from public.vitals_readings v
    where v.patient_id = new.patient_id and v.vital_type::text = 'blood_pressure' and v.systolic is not null
      and v.created_at <= new.created_at and v.created_at >= new.created_at - interval '10 minutes'
    order by v.created_at desc, v.taken_at desc limit 1;
    if found then
      perform private.emit_domain_event(
        'observation.recorded', v_obs.organisation_id,
        jsonb_build_object('observation_id', v_obs.id, 'symptom_id', new.id),
        'bp:' || v_obs.id::text || ':sym:' || new.id::text,
        v_obs.patient_id, 'observation', v_obs.id);
    end if;
  exception when others then
    raise warning 'S12: could not emit a symptom regrade for %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
create trigger symptoms_emit_triage_regrade
  after insert on public.symptoms
  for each row execute function private.emit_symptom_regrade();

-- Every minute: (a) a due recheck becomes a timed_out regrade, (b) a reading with no event is re-emitted,
-- (c) a repeat task whose reading is no longer pending is closed.
create or replace function private.sweep_triage_rechecks()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select p.observation_id, p.organisation_id, p.patient_id from public.triage_pending_rechecks p
    where p.state = 'pending' and p.due_at <= now() and p.timeout_emitted_at is null
    for update skip locked
  loop
    perform private.emit_domain_event(
      'observation.recorded', r.organisation_id,
      jsonb_build_object('observation_id', r.observation_id, 'recheck', 'timed_out'),
      'bp:' || r.observation_id::text || ':timeout',
      r.patient_id, 'observation', r.observation_id);
    update public.triage_pending_rechecks set timeout_emitted_at = now() where observation_id = r.observation_id;
    v_n := v_n + 1;
  end loop;

  for r in
    select v.id, v.organisation_id, v.patient_id from public.vitals_readings v
    where v.vital_type::text = 'blood_pressure' and v.systolic is not null and v.diastolic is not null
      and v.created_at > now() - interval '24 hours' and v.created_at < now() - interval '1 minute'
      and not exists (select 1 from public.domain_events e
                      where e.event_type = 'observation.recorded' and e.idempotency_key = 'bp:' || v.id::text)
  loop
    perform private.emit_domain_event(
      'observation.recorded', r.organisation_id,
      jsonb_build_object('observation_id', r.id),
      'bp:' || r.id::text, r.patient_id, 'observation', r.id);
    v_n := v_n + 1;
  end loop;

  update public.care_tasks t set status = 'expired'
  where t.source = 'triage_recheck' and t.status in ('not_started', 'scheduled', 'in_progress')
    and not exists (select 1 from public.triage_pending_rechecks p where p.patient_id = t.patient_id and p.state = 'pending');
  return v_n;
end $$;

select cron.schedule('triage-recheck-sweep', '* * * * *', $$select private.sweep_triage_rechecks()$$);

-- ---------------------------------------------------------------------------
-- 5. Context for the grader (read) and the result writer (write). Service role only.
-- ---------------------------------------------------------------------------
create or replace function public.triage_context_for_observation(p_observation_id uuid, p_recheck text default null, p_window_minutes integer default 15)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.vitals_readings%rowtype;
  v_prof public.profiles%rowtype;
  v_target record;
  v_prev record;
  v_recheck jsonb := null;
  v_symptoms jsonb;
  v_history jsonb;
  v_open jsonb;
begin
  select * into v from public.vitals_readings where id = p_observation_id;
  if not found or v.vital_type::text <> 'blood_pressure' or v.systolic is null or v.diastolic is null then
    return jsonb_build_object('found', false);
  end if;
  select * into v_prof from public.profiles where id = v.patient_id;
  select * into v_target from private.patient_home_bp_target(v.patient_id);

  select coalesce(jsonb_agg(distinct s.symptom_type::text), '[]'::jsonb) into v_symptoms
  from public.symptoms s
  where s.patient_id = v.patient_id
    and s.symptom_type::text in ('severe_headache', 'chest_pain', 'breathlessness', 'weakness_or_numbness',
          'difficulty_speaking', 'back_pain', 'epigastric_pain', 'confusion', 'visual_disturbance', 'fainting',
          'dizziness', 'palpitations')
    and s.created_at between v.created_at - interval '10 minutes' and v.created_at + interval '10 minutes';

  select coalesce(jsonb_agg(jsonb_build_object('systolic', h.systolic, 'diastolic', h.diastolic, 'takenAt', h.taken_at)
                            order by h.taken_at desc), '[]'::jsonb) into v_history
  from public.vitals_readings h
  where h.patient_id = v.patient_id and h.vital_type::text = 'blood_pressure' and h.id <> v.id
    and h.systolic is not null and h.diastolic is not null
    and h.taken_at between v.taken_at - interval '14 days' and v.taken_at;

  if p_recheck = 'timed_out' then
    v_recheck := jsonb_build_object('kind', 'timed_out');
  else
    select h.systolic, h.diastolic, h.taken_at into v_prev
    from public.triage_pending_rechecks p
    join public.vitals_readings h on h.id = p.observation_id
    where p.patient_id = v.patient_id and p.state = 'pending' and p.observation_id <> v.id
      and h.taken_at <= v.taken_at and h.taken_at >= v.taken_at - make_interval(mins => p_window_minutes)
    order by h.taken_at desc limit 1;
    if found then
      v_recheck := jsonb_build_object('kind', 'repeat',
        'previous', jsonb_build_object('systolic', v_prev.systolic, 'diastolic', v_prev.diastolic, 'takenAt', v_prev.taken_at),
        'minutesSincePrevious', round(extract(epoch from (v.taken_at - v_prev.taken_at)) / 60.0, 2));
    end if;
  end if;

  select coalesce(jsonb_agg(c.task_key), '[]'::jsonb) into v_open
  from (select distinct e.task_key from public.triage_events e
        where e.patient_id = v.patient_id and e.task_key is not null and not e.shadow
          and e.created_at > now() - interval '30 days') c;

  return jsonb_build_object(
    'found', true,
    'organisationId', v.organisation_id,
    'patientId', v.patient_id,
    'isTest', coalesce(v_prof.is_test, false),
    'observationId', v.id,
    'basis', md5(coalesce((select string_agg(s2, ',' order by s2) from jsonb_array_elements_text(v_symptoms) s2), '') || '|' || coalesce(v_recheck ->> 'kind', '')),
    'input', jsonb_strip_nulls(jsonb_build_object(
      'trigger', jsonb_strip_nulls(jsonb_build_object(
        'type', 'observation',
        'reading', jsonb_build_object('systolic', v.systolic, 'diastolic', v.diastolic, 'takenAt', v.taken_at),
        'symptoms', v_symptoms,
        'recheck', v_recheck)),
      'history', v_history,
      'target', jsonb_build_object('systolic', v_target.systolic, 'diastolic', v_target.diastolic),
      'pathway', jsonb_build_object('state', 'self_guided'),
      'pregnant', coalesce((select pp.is_pregnant from public.patient_pregnancy pp where pp.patient_id = v.patient_id limit 1), false),
      'ageYears', case when v_prof.date_of_birth is null then null else extract(year from age(v.taken_at, v_prof.date_of_birth))::int end,
      'now', now(),
      'existingOpenTaskKeys', v_open)));
end $$;

create or replace function public.record_triage_result(
  p_observation_id uuid,
  p_result jsonb,
  p_rule_set_id uuid,
  p_causation_id uuid default null,
  p_basis text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.vitals_readings%rowtype;
  v_rs public.triage_rule_sets%rowtype;
  v_status text := p_result ->> 'status';
  v_grade text := p_result ->> 'grade';
  v_shadow boolean;
  v_id uuid;
  v_created boolean := false;
  v_is_test boolean;
  v_actions jsonb := coalesce(p_result -> 'actions', '[]'::jsonb);
  v_after integer;
  v_window integer;
begin
  if v_status not in ('graded', 'recheck_required', 'rejected') then
    raise exception 'record_triage_result: unknown status %', v_status using errcode = '22023';
  end if;
  select * into v from public.vitals_readings where id = p_observation_id;
  if not found then
    raise exception 'record_triage_result: observation % not found', p_observation_id using errcode = '22023';
  end if;
  select * into v_rs from public.triage_rule_sets where id = p_rule_set_id;
  if not found then
    raise exception 'record_triage_result: rule set % not found', p_rule_set_id using errcode = '22023';
  end if;
  if p_result #>> '{ruleSet,code}' is distinct from v_rs.code or (p_result #>> '{ruleSet,version}')::int is distinct from v_rs.version then
    raise exception 'record_triage_result: result was graded with a different rule set than the one named' using errcode = '22023';
  end if;
  select coalesce(is_test, false) into v_is_test from public.profiles where id = v.patient_id;
  v_shadow := v_rs.status <> 'approved';

  if v_status = 'rejected' then
    return jsonb_build_object('status', 'rejected', 'created', false);
  end if;

  if v_status = 'recheck_required' then
    v_after := coalesce((p_result #>> '{recheck,afterMinutes}')::int, 5);
    v_window := coalesce((p_result #>> '{recheck,windowMinutes}')::int, 15);
    update public.triage_pending_rechecks set state = 'superseded'
      where patient_id = v.patient_id and state = 'pending' and observation_id <> v.id;
    insert into public.triage_pending_rechecks (observation_id, organisation_id, patient_id, due_at)
      values (v.id, v.organisation_id, v.patient_id, v.taken_at + make_interval(mins => v_window))
      on conflict (observation_id) do nothing;
    if not exists (select 1 from public.care_tasks t where t.patient_id = v.patient_id and t.source = 'triage_recheck'
                   and t.status in ('not_started', 'scheduled', 'in_progress')) then
      insert into public.care_tasks (organisation_id, patient_id, title, owner_role, priority, due_at, source, kind, source_event_id)
        values (v.organisation_id, v.patient_id, '', 'patient', 1, v.taken_at + make_interval(mins => v_after), 'triage_recheck', 'log_bp', p_causation_id);
    end if;
    return jsonb_build_object('status', 'recheck_required', 'created', true);
  end if;

  if v_grade not in ('green', 'amber', 'red') then
    raise exception 'record_triage_result: a graded result needs a grade' using errcode = '22023';
  end if;

  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id,
      rule_set_code, rule_set_version, rule_set_status, explanation_key, actions, matched_rule_ids, task_key, basis, shadow, is_test)
    values (v.organisation_id, v.patient_id, 'observation', v.id, v_grade, p_result ->> 'ruleId', v_rs.id,
      v_rs.code, v_rs.version, v_rs.status, p_result ->> 'explanationKey', v_actions,
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_result -> 'matchedRuleIds', '[]'::jsonb)) x), '{}'),
      p_result ->> 'taskKey', coalesce(p_basis, ''), v_shadow, coalesce(v_is_test, false))
    on conflict (trigger_type, trigger_id, rule_set_id, basis) do nothing
    returning id into v_id;
  v_created := v_id is not null;
  if not v_created then
    select id into v_id from public.triage_events
      where trigger_type = 'observation' and trigger_id = v.id and rule_set_id = v_rs.id and basis = coalesce(p_basis, '');
  end if;

  if v_created then
    update public.vitals_readings set triage_event_id = v_id where id = v.id and triage_event_id is null;
    -- Only readings taken no later than this one are settled by it: a late or regraded older reading must not
    -- close the wait on a newer first elevated reading.
    update public.triage_pending_rechecks p set state = case when p.observation_id = v.id then 'timed_out' else 'resolved' end
      where p.patient_id = v.patient_id and p.state = 'pending'
        and exists (select 1 from public.vitals_readings h where h.id = p.observation_id and h.taken_at <= v.taken_at);
    update public.care_tasks set status = 'completed'
      where patient_id = v.patient_id and source = 'triage_recheck' and status in ('not_started', 'scheduled', 'in_progress')
        and not exists (select 1 from public.triage_pending_rechecks p where p.patient_id = v.patient_id and p.state = 'pending');
    perform private.emit_domain_event(
      'triage.graded', v.organisation_id,
      jsonb_build_object('grade', v_grade, 'triage_event_id', v_id, 'observation_id', v.id,
        'rule_id', p_result ->> 'ruleId', 'rule_set_status', v_rs.status, 'shadow', v_shadow,
        'explanation_key', p_result ->> 'explanationKey', 'task_key', p_result ->> 'taskKey', 'actions', v_actions),
      'triage:' || v_id::text, v.patient_id, 'triage_event', v_id,
      case when v_grade = 'red' then 'urgent' else 'normal' end, null, p_causation_id);
  end if;
  return jsonb_build_object('status', 'graded', 'created', v_created, 'triage_event_id', v_id, 'shadow', v_shadow);
end $$;

-- The rule set the server grades with: the approved version, else the newest draft (shadow, OQ-88).
-- Never a retired one. Service role only.
create or replace function public.triage_rule_set_for_grading(p_code text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', id, 'status', status, 'code', code, 'version', version, 'rules', rules)
  from public.triage_rule_sets
  where code = p_code and status in ('approved', 'draft')
  order by (status = 'approved') desc, version desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 6. Subscriber, grants
-- ---------------------------------------------------------------------------
insert into public.event_subscribers (subscriber_key, event_type, handler_key, note)
values ('triage.grade_observation', 'observation.recorded', 'triage.grade_observation',
        'S12: runs the triage engine on a blood pressure reading and records the result (shadow until the rule set is approved)');

revoke all on function private.emit_bp_observation_recorded() from public, anon, authenticated;
revoke all on function private.emit_symptom_regrade() from public, anon, authenticated;
revoke all on function private.sweep_triage_rechecks() from public, anon, authenticated;
revoke all on function private.triage_events_append_only() from public, anon, authenticated;
revoke all on function public.triage_context_for_observation(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.record_triage_result(uuid, jsonb, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.triage_rule_set_for_grading(text) from public, anon, authenticated;
grant execute on function public.triage_rule_set_for_grading(text) to service_role;
grant execute on function public.triage_context_for_observation(uuid, text, integer) to service_role;
grant execute on function public.record_triage_result(uuid, jsonb, uuid, uuid, text) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.record_triage_result(uuid, jsonb, uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_triage_result(uuid, jsonb, uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.triage_context_for_observation(uuid, text, integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.triage_context_for_observation(uuid, text, integer)', 'EXECUTE') then
    raise exception 'S12 functions must be service role only';
  end if;
  if has_table_privilege('anon', 'public.triage_events', 'SELECT') or has_table_privilege('authenticated', 'public.triage_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.triage_pending_rechecks', 'SELECT') then
    raise exception 'S12 table grants are too wide';
  end if;
end $$;
