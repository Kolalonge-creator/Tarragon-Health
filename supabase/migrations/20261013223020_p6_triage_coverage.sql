-- P6 (S11-S15 build, plan item R3): triage coverage. Silence and adherence reach the engine for Members,
-- a symptom report with no reading is recorded in shadow form, cuff type is visible, and a clinician
-- can see WHY the engine raised a task.
--
-- Live checked 2026-10-13 on koiplnmbgnqnbywhpjlf before writing: bp_care_triage v3 approved, v4 draft;
-- 0 triage_events, 0 clinical_tasks; the only live "pathway state" for the two-tier model is
-- public.patient_memberships (state, starts_at, ends_at) read through private.patient_is_member_at();
-- there is no pathway_enrolments or care pack table (OQ-89's "care_pack_active" maps to an active Member).
-- private.weekly_adherence() (S08x) already computes the taken-over-due percentage.
--
-- What this adds
--  1. triage_events.context (the facts the engine saw: reading, symptoms, cuff type, or the silence /
--     adherence trigger) so a clinician can be shown why a task exists. rule_set_id becomes nullable ONLY for
--     the shadow-only symptom-report bridge (a check pins that: no rule set means shadow, always).
--  2. triage_coverage_config (versioned, born OFF) - the daily sweep does nothing until a human turns it on.
--  3. The daily sweep private.sweep_triage_coverage(): for active Members with a blood pressure interest it emits
--     silence.detected (BP-A5, 7 days under the approved rule set) or adherence.below_line (BP-A4) through the
--     S10 bus, once per patient per Lagos day, and never again for a cause that already has a triage event.
--  4. public.triage_context_for_coverage() / public.record_coverage_triage_result(): the service-role pair the
--     process-events handler uses to grade those triggers with the SAME pure engine (INV-01) and store the result.
--  5. A shadow-only bridge for a symptom report with no reading (AFTER INSERT trigger on symptoms; it does NOT
--     touch private.handle_symptom_red_flag, which keeps paging exactly as before).
--  6. cuff_type in the observations context and in the patient summary reading rows; the triage event rows in
--     the summary now carry rule id, rule set code and version, and the context.
--  7. public.clinician_task_triage_explainer(task): the audited, tied read the task page shows.
--
-- Rewrites of existing functions and the observations view are done from the LIVE definition at apply time
-- (pg_get_functiondef / pg_get_viewdef + one asserted textual replace), never from an old copy: this project has
-- clobbered handle_symptom_red_flag twice by rewriting it from a stale body.

-- ---------------------------------------------------------------------------
-- 1. triage_events.context and the shadow-only bridge row
-- ---------------------------------------------------------------------------
alter table public.triage_events add column if not exists context jsonb
  check (context is null or jsonb_typeof(context) = 'object');
comment on column public.triage_events.context is 'P6: the facts the rule set was given (reading, symptoms, cuff type, or the silence/adherence trigger). Shown to a tied clinician in the task explainer (decision-support transparency, INV-16).';

alter table public.triage_events alter column rule_set_id drop not null;
alter table public.triage_events add constraint triage_events_no_rule_set_means_shadow
  check (rule_set_id is not null or (shadow and rule_set_code = 'live_symptom_gate'));
create unique index triage_events_bridge_once on public.triage_events (trigger_type, trigger_id) where rule_set_id is null;

-- ---------------------------------------------------------------------------
-- 2. Config, born off
-- ---------------------------------------------------------------------------
create table public.triage_coverage_config (
  version        integer primary key check (version >= 1),
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null check (jsonb_typeof(rules) = 'object'),
  created_at     timestamptz not null default now()
);
create unique index triage_coverage_config_one_active on public.triage_coverage_config (is_active) where is_active;
alter table public.triage_coverage_config enable row level security;
create policy triage_coverage_config_admin_read on public.triage_coverage_config for select to authenticated using (private.is_admin());
revoke all on public.triage_coverage_config from public, anon, authenticated;
grant select on public.triage_coverage_config to authenticated;

-- triage-coverage-begin
insert into public.triage_coverage_config (version, is_active, effective_from, rules) values (1, true, '2026-10-13', $json$
{
  "enabled": false,
  "bp_interest_days": 90
}
$json$::jsonb);
-- triage-coverage-end
comment on table public.triage_coverage_config is 'P6: PROPOSED settings for the daily silence/adherence sweep. enabled=false at birth; a human turns it on after the CMO confirms Members should get these tasks. Mirrors registry key triage.coverage.';

-- ---------------------------------------------------------------------------
-- 3. Snapshot of what a reading was graded on
-- ---------------------------------------------------------------------------
create or replace function private.triage_reading_snapshot(p_reading uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'vitalType', v.vital_type::text,
    'reading', case when v.vital_type::text = 'blood_pressure'
                    then jsonb_build_object('systolic', v.systolic, 'diastolic', v.diastolic, 'takenAt', v.taken_at)
                    else jsonb_build_object('value', coalesce(v.glucose_mmol_l, v.value_numeric), 'takenAt', v.taken_at) end,
    'cuffType', v.cuff_type,
    'symptoms', coalesce((select jsonb_agg(distinct s.symptom_type::text)
                            from public.symptoms s
                           where s.patient_id = v.patient_id
                             and s.symptom_type::text in ('severe_headache', 'chest_pain', 'breathlessness', 'weakness_or_numbness',
                                   'difficulty_speaking', 'back_pain', 'epigastric_pain', 'confusion', 'visual_disturbance', 'fainting',
                                   'dizziness', 'palpitations')
                             and s.created_at between v.created_at - interval '10 minutes' and v.created_at + interval '10 minutes'),
                         '[]'::jsonb))
  from public.vitals_readings v where v.id = p_reading;
$$;
revoke all on function private.triage_reading_snapshot(uuid) from public, anon, authenticated;

-- record_triage_result: store the context. Rewritten from the live body with one asserted replace.
do $mig$
declare
  d text := pg_get_functiondef('public.record_triage_result(uuid, jsonb, uuid, uuid, text)'::regprocedure);
  cols_old constant text := 'matched_rule_ids, task_key, basis, shadow, is_test)';
  vals_old constant text := $q$p_result ->> 'taskKey', coalesce(p_basis, ''), v_shadow, coalesce(v_is_test, false))$q$;
begin
  if (length(d) - length(replace(d, cols_old, ''))) / length(cols_old) <> 1
     or (length(d) - length(replace(d, vals_old, ''))) / length(vals_old) <> 1 then
    raise exception 'P6: record_triage_result live body no longer has the expected insert; review before changing it';
  end if;
  d := replace(d, cols_old, 'matched_rule_ids, task_key, basis, shadow, is_test, context)');
  d := replace(d, vals_old, $q$p_result ->> 'taskKey', coalesce(p_basis, ''), v_shadow, coalesce(v_is_test, false), private.triage_reading_snapshot(v.id))$q$);
  execute d;
end $mig$;

-- ---------------------------------------------------------------------------
-- 4. Who the daily sweep looks at, and what the engine is given
-- ---------------------------------------------------------------------------
create or replace function private.triage_coverage_rule_params()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  -- The rule set the server grades with: the approved version, else the newest draft; never a retired one.
  select rules -> 'params'
    from public.triage_rule_sets
   where code = 'bp_care_triage' and status in ('approved', 'draft')
   order by (status = 'approved') desc, version desc
   limit 1;
$$;
revoke all on function private.triage_coverage_rule_params() from public, anon, authenticated;

-- Active Members with a blood pressure interest: an active hypertension care plan, or a reading in the last N days.
-- Free patients are not here, on purpose: Free consumes no doctor time (two-tier), so no clinician task is ever made for them.
create or replace function private.triage_coverage_candidates(p_now timestamptz, p_patient uuid default null)
returns table (patient_id uuid, organisation_id uuid, since_at timestamptz, last_reading_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  with cfg as (select coalesce((rules ->> 'bp_interest_days')::int, 90) as days from public.triage_coverage_config where is_active)
  select pr.id, pr.organisation_id,
         greatest(
           (select max(m.starts_at) from public.patient_memberships m where m.patient_id = pr.id and m.state = 'active' and m.starts_at <= p_now),
           (select max(cp.created_at) from public.care_plans cp where cp.patient_id = pr.id and cp.status = 'active' and cp.condition::text = 'hypertension')
         ) as since_at,
         (select max(v.taken_at) from public.vitals_readings v
           where v.patient_id = pr.id and v.vital_type::text = 'blood_pressure' and v.systolic is not null and v.taken_at <= p_now) as last_reading_at
    from public.profiles pr
   where pr.role = 'patient' and pr.is_active
     and (p_patient is null or pr.id = p_patient)
     and private.patient_is_member_at(pr.id, p_now)
     and (exists (select 1 from public.care_plans cp where cp.patient_id = pr.id and cp.status = 'active' and cp.condition::text = 'hypertension')
          or exists (select 1 from public.vitals_readings v, cfg
                      where v.patient_id = pr.id and v.vital_type::text = 'blood_pressure' and v.systolic is not null
                        and v.taken_at > p_now - make_interval(days => cfg.days) and v.taken_at <= p_now));
$$;
revoke all on function private.triage_coverage_candidates(timestamptz, uuid) from public, anon, authenticated;

create or replace function private.lagos_days_between(p_from timestamptz, p_to timestamptz)
returns integer
language sql immutable set search_path = ''
as $$ select greatest(0, ((p_to at time zone 'Africa/Lagos')::date - (p_from at time zone 'Africa/Lagos')::date)) $$;
revoke all on function private.lagos_days_between(timestamptz, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The daily sweep (idempotent per patient per Lagos day; a no-op while the config says enabled=false)
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent)
values ('adherence.below_line', 'A Member''s doses taken over due doses fell below the rule set''s adherence line', 'S12', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys)
values ('adherence.below_line', 1, array['day'])
on conflict do nothing;

create or replace function private.sweep_triage_coverage(p_now timestamptz default now())
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_params jsonb;
  v_silence_days integer;
  v_min_percent numeric;
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  c record;
  a jsonb;
  v_days integer;
  v_anchor date;
  v_n integer := 0;
  v_failed integer := 0;
begin
  if not coalesce((select (rules ->> 'enabled')::boolean from public.triage_coverage_config where is_active), false) then
    return 0;
  end if;
  v_params := private.triage_coverage_rule_params();
  if v_params is null then
    raise warning 'P6: no bp_care_triage rule set to read the silence and adherence lines from; sweep skipped';
    return 0;
  end if;
  v_silence_days := (v_params #>> '{silence,days}')::int;
  v_min_percent := (v_params #>> '{adherence,minPercent}')::numeric;

  for c in select * from private.triage_coverage_candidates(p_now) loop
    -- silence (BP-A5): counted from the last reading, or from when the Member's blood pressure programme began.
    -- Each trigger has its own subtransaction so one failing never rolls back the other's event.
    begin
      if v_silence_days is not null and coalesce(c.last_reading_at, c.since_at) is not null then
        v_days := private.lagos_days_between(coalesce(c.last_reading_at, c.since_at), p_now);
        v_anchor := (coalesce(c.last_reading_at, c.since_at) at time zone 'Africa/Lagos')::date;
        if v_days >= v_silence_days
           and not exists (select 1 from public.triage_events e
                            where e.patient_id = c.patient_id and e.task_key = 'BP-A5:' || v_anchor::text and not e.shadow
                              and e.created_at > p_now - interval '30 days') then
          if private.emit_domain_event('silence.detected', c.organisation_id,
               jsonb_build_object('days', v_days, 'day', v_today), 'cov:silence:' || c.patient_id || ':' || v_today,
               c.patient_id, 'patient', c.patient_id) is not null then
            v_n := v_n + 1;
          end if;
        end if;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      raise warning 'P6 coverage sweep: silence for patient % failed: %', c.patient_id, sqlerrm;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (c.organisation_id, 'triage_coverage_sweep.error', 'patient', c.patient_id, jsonb_build_object('step', 'silence', 'error', sqlerrm));
    end;

    -- adherence (BP-A4): once per ISO week
    begin
      if v_min_percent is not null then
        a := private.weekly_adherence(c.patient_id, p_now);
        if (a ->> 'percent') is not null and (a ->> 'percent')::numeric < v_min_percent
           and not exists (select 1 from public.triage_events e
                            where e.patient_id = c.patient_id and e.task_key = 'BP-A4:' || to_char(v_today, 'IYYY-"W"IW') and not e.shadow
                              and e.created_at > p_now - interval '10 days') then
          if private.emit_domain_event('adherence.below_line', c.organisation_id,
               jsonb_build_object('day', v_today), 'cov:adherence:' || c.patient_id || ':' || v_today,
               c.patient_id, 'patient', c.patient_id) is not null then
            v_n := v_n + 1;
          end if;
        end if;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      raise warning 'P6 coverage sweep: adherence for patient % failed: %', c.patient_id, sqlerrm;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (c.organisation_id, 'triage_coverage_sweep.error', 'patient', c.patient_id, jsonb_build_object('step', 'adherence', 'error', sqlerrm));
    end;
  end loop;

  -- A failure is recorded where operations look (audit_log row per patient above, one open incident here), the same way the
  -- clinical task sweep does it. The patient is tried again tomorrow.
  if v_failed > 0 and not exists (select 1 from public.ops_incidents where external_reference = 'triage_coverage_sweep' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values ('technical', 'sev2', 'Silence and adherence sweep failed for some Members',
            format('%s Member check(s) failed in private.sweep_triage_coverage(); see audit_log action triage_coverage_sweep.error. A silent or non-adherent Member may not have been looked at today.', v_failed),
            'triage_coverage_sweep', now(), now());
  end if;
  return v_n;
end $$;
revoke all on function private.sweep_triage_coverage(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Context for the grader and the result writer (service role only)
-- ---------------------------------------------------------------------------
create or replace function public.triage_context_for_coverage(p_patient uuid, p_trigger text, p_day date default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_now timestamptz := now();
  c record;
  v_prof public.profiles%rowtype;
  v_target record;
  v_trigger jsonb;
  v_open jsonb;
  v_history jsonb;
  a jsonb;
begin
  if p_trigger not in ('silence', 'adherence') then
    raise exception 'triage_context_for_coverage: unknown trigger %', p_trigger using errcode = '22023';
  end if;
  select * into c from private.triage_coverage_candidates(v_now, p_patient) x;
  -- Not an active Member with a blood pressure interest (a Free patient, or a lapsed Member): nothing to grade.
  if not found then return jsonb_build_object('found', false); end if;
  select * into v_prof from public.profiles where id = p_patient;
  select * into v_target from private.patient_home_bp_target(p_patient);

  if p_trigger = 'silence' then
    -- lastReadingAt is a real JSON null when the Member has never read: the engine's input check wants the key, not its absence.
    v_trigger := jsonb_build_object('type', 'silence', 'lastReadingAt', c.last_reading_at,
      'sinceAt', coalesce(c.since_at, c.last_reading_at));
  else
    a := private.weekly_adherence(p_patient, v_now);
    if (a ->> 'percent') is null then return jsonb_build_object('found', false); end if;
    v_trigger := jsonb_build_object('type', 'adherence', 'percent7d', (a ->> 'percent')::numeric);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('systolic', h.systolic, 'diastolic', h.diastolic, 'takenAt', h.taken_at)
                            order by h.taken_at desc), '[]'::jsonb) into v_history
    from public.vitals_readings h
   where h.patient_id = p_patient and h.vital_type::text = 'blood_pressure' and h.systolic is not null and h.diastolic is not null
     and h.taken_at between v_now - interval '14 days' and v_now;

  select coalesce(jsonb_agg(k.task_key), '[]'::jsonb) into v_open
    from (select distinct e.task_key from public.triage_events e
           where e.patient_id = p_patient and e.task_key is not null and not e.shadow and e.created_at > v_now - interval '30 days') k;

  return jsonb_build_object(
    'found', true,
    'organisationId', c.organisation_id,
    'patientId', p_patient,
    'isTest', coalesce(v_prof.is_test, false),
    'day', coalesce(p_day, (v_now at time zone 'Africa/Lagos')::date),
    'trigger', v_trigger,
    'input', jsonb_strip_nulls(jsonb_build_object(
      'history', v_history,
      'target', jsonb_build_object('systolic', v_target.systolic, 'diastolic', v_target.diastolic),
      -- An active Member is the two-tier stand-in for the engine's care_pack_active state (OQ-89); anyone else returned found=false above.
      'pathway', jsonb_build_object('state', 'care_pack_active'),
      'pregnant', coalesce((select pp.is_pregnant from public.patient_pregnancy pp where pp.patient_id = p_patient limit 1), false),
      'ageYears', case when v_prof.date_of_birth is null then null else extract(year from age(v_now, v_prof.date_of_birth))::int end,
      'now', v_now,
      'existingOpenTaskKeys', v_open)) || jsonb_build_object('trigger', v_trigger));
end $$;

create or replace function public.record_coverage_triage_result(
  p_patient uuid,
  p_trigger text,
  p_day date,
  p_result jsonb,
  p_rule_set_id uuid,
  p_context jsonb,
  p_causation_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_rs public.triage_rule_sets%rowtype;
  v_pr public.profiles%rowtype;
  v_grade text := p_result ->> 'grade';
  v_shadow boolean;
  v_trigger_id uuid;
  v_id uuid;
  v_actions jsonb := coalesce(p_result -> 'actions', '[]'::jsonb);
begin
  if p_trigger not in ('silence', 'adherence') then
    raise exception 'record_coverage_triage_result: unknown trigger %', p_trigger using errcode = '22023';
  end if;
  if p_result ->> 'status' <> 'graded' then
    return jsonb_build_object('status', p_result ->> 'status', 'created', false);
  end if;
  if v_grade not in ('green', 'amber', 'red') then
    raise exception 'record_coverage_triage_result: a graded result needs a grade' using errcode = '22023';
  end if;
  select * into v_pr from public.profiles where id = p_patient and role = 'patient';
  if not found then raise exception 'record_coverage_triage_result: unknown patient' using errcode = '22023'; end if;
  select * into v_rs from public.triage_rule_sets where id = p_rule_set_id;
  if not found then raise exception 'record_coverage_triage_result: rule set not found' using errcode = '22023'; end if;
  if p_result #>> '{ruleSet,code}' is distinct from v_rs.code or (p_result #>> '{ruleSet,version}')::int is distinct from v_rs.version then
    raise exception 'record_coverage_triage_result: result was graded with a different rule set than the one named' using errcode = '22023';
  end if;
  v_shadow := v_rs.status <> 'approved';
  -- One result per patient, trigger and Lagos day, however often the event is redelivered.
  v_trigger_id := md5(p_patient::text || ':' || p_trigger || ':' || p_day::text)::uuid;

  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id,
      rule_set_code, rule_set_version, rule_set_status, explanation_key, actions, matched_rule_ids, task_key, basis, shadow, is_test, context)
    values (v_pr.organisation_id, p_patient, p_trigger, v_trigger_id, v_grade, p_result ->> 'ruleId', v_rs.id,
      v_rs.code, v_rs.version, v_rs.status, p_result ->> 'explanationKey', v_actions,
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_result -> 'matchedRuleIds', '[]'::jsonb)) x), '{}'),
      p_result ->> 'taskKey', '', v_shadow, coalesce(v_pr.is_test, false), p_context)
    on conflict (trigger_type, trigger_id, rule_set_id, basis) do nothing
    returning id into v_id;
  if v_id is null then
    select id into v_id from public.triage_events
     where trigger_type = p_trigger and trigger_id = v_trigger_id and rule_set_id = v_rs.id and basis = '';
    return jsonb_build_object('status', 'graded', 'created', false, 'triage_event_id', v_id, 'shadow', v_shadow);
  end if;

  perform private.emit_domain_event(
    'triage.graded', v_pr.organisation_id,
    jsonb_build_object('grade', v_grade, 'triage_event_id', v_id, 'trigger_type', p_trigger,
      'rule_id', p_result ->> 'ruleId', 'rule_set_status', v_rs.status, 'shadow', v_shadow,
      'explanation_key', p_result ->> 'explanationKey', 'task_key', p_result ->> 'taskKey', 'actions', v_actions),
    'triage:' || v_id::text, p_patient, 'triage_event', v_id,
    case when v_grade = 'red' then 'urgent' else 'normal' end, null, p_causation_id);
  return jsonb_build_object('status', 'graded', 'created', true, 'triage_event_id', v_id, 'shadow', v_shadow);
end $$;

revoke all on function public.triage_context_for_coverage(uuid, text, date) from public, anon, authenticated;
revoke all on function public.record_coverage_triage_result(uuid, text, date, jsonb, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.triage_context_for_coverage(uuid, text, date) to service_role;
grant execute on function public.record_coverage_triage_result(uuid, text, date, jsonb, uuid, jsonb, uuid) to service_role;

insert into public.event_subscribers (subscriber_key, event_type, handler_key, note) values
  ('triage.grade_silence', 'silence.detected', 'triage.grade_coverage', 'P6: grades a silence trigger (BP-A5) with the engine and records the result (shadow until the rule set is approved)'),
  ('triage.grade_adherence', 'adherence.below_line', 'triage.grade_coverage', 'P6: grades an adherence trigger (BP-A4) with the engine and records the result (shadow until the rule set is approved)')
on conflict do nothing;

-- One start time that no other job uses (SR2: pg_cron opens a connection per job). 06:52 UTC = 07:52 Lagos.
select cron.schedule('triage-coverage-daily', '52 6 * * *', $$select private.sweep_triage_coverage()$$);

-- ---------------------------------------------------------------------------
-- 7. Symptom report with no reading: a shadow-only record beside the live path
-- ---------------------------------------------------------------------------
-- The engine grades a reading (BP-R/A/G rules all need one), so a symptom alone cannot be graded by it without a new
-- rule set version, which only the CMO can sign. Until then the live danger-sign path (handle_symptom_red_flag) is the
-- only thing that pages and it is left exactly as it is. This trigger records what that gate decided as a SHADOW triage
-- event (never acted on: S16 and S19 ignore shadow) so the same table, bus event and divergence tooling can see
-- symptom-only reports. A symptom within ten minutes after a BP reading is the observation path's regrade, not this.
create or replace function private.record_symptom_report_triage()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_test boolean;
begin
  if not (coalesce(new.is_red_flag, false) or new.severity >= 5) then return null; end if;
  begin
    -- any reading in the 10 minutes before: the observation path regrades that episode (blood pressure today, glucose when its rules land)
    if exists (select 1 from public.vitals_readings v
                where v.patient_id = new.patient_id and v.created_at <= new.created_at and v.created_at >= new.created_at - interval '10 minutes') then
      return null;
    end if;
    select coalesce(is_test, false) into v_test from public.profiles where id = new.patient_id;
    insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id,
        rule_set_code, rule_set_version, rule_set_status, explanation_key, actions, matched_rule_ids, task_key, basis, shadow, is_test, context)
      values (new.organisation_id, new.patient_id, 'symptom_report', new.id,
        case when new.is_red_flag then 'red' else 'amber' end,
        case when new.is_red_flag then 'SYM-LIVE-RED' else 'SYM-LIVE-REVIEW' end,
        null, 'live_symptom_gate', 1, 'draft', null,
        case when new.is_red_flag then '[{"kind":"page_on_call"}]'::jsonb else '[]'::jsonb end,
        '{}', null, '', true, coalesce(v_test, false),
        jsonb_build_object('symptoms', jsonb_build_array(new.symptom_type::text), 'severity', new.severity, 'noReading', true))
      on conflict (trigger_type, trigger_id) where rule_set_id is null do nothing
      returning id into v_id;
    if v_id is not null then
      perform private.emit_domain_event(
        'triage.graded', new.organisation_id,
        jsonb_build_object('grade', case when new.is_red_flag then 'red' else 'amber' end, 'triage_event_id', v_id,
          'trigger_type', 'symptom_report', 'rule_set_status', 'draft', 'shadow', true),
        'triage:' || v_id::text, new.patient_id, 'triage_event', v_id, 'normal');
    end if;
  exception when others then
    -- A symptom report is never refused because this record failed; the live path has already decided what to do with it.
    raise warning 'P6: could not record the symptom-report triage event for %: %', new.id, sqlerrm;
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (new.organisation_id, 'p6_symptom_bridge.error', 'symptom', new.id, jsonb_build_object('error', sqlerrm));
  end;
  return null;
end $$;
revoke all on function private.record_symptom_report_triage() from public, anon, authenticated;
create trigger symptoms_record_triage_shadow
  after insert on public.symptoms
  for each row execute function private.record_symptom_report_triage();

-- ---------------------------------------------------------------------------
-- 8. cuff_type in the observations context (rewritten from the live view definition)
-- ---------------------------------------------------------------------------
do $mig$
declare
  d text := pg_get_viewdef('public.observations'::regclass, false);
  old_frag constant text := $q$'note', note)$q$;
begin
  if (length(d) - length(replace(d, old_frag, ''))) / length(old_frag) <> 1 then
    raise exception 'P6: observations view no longer has the expected context expression; review before changing it';
  end if;
  d := replace(d, old_frag, $q$'note', note, 'cuff_type', cuff_type)$q$);
  execute 'create or replace view public.observations with (security_invoker = true) as ' || d;
end $mig$;

-- ---------------------------------------------------------------------------
-- 9. The patient summary: cuff type on reading rows; rule id, version and context on triage rows
-- ---------------------------------------------------------------------------
do $mig$
declare
  d text := pg_get_functiondef('public.clinician_patient_summary(uuid, text)'::regprocedure);
  r_old constant text := 'select type, systolic, diastolic, value_numeric, unit, measured_at, source';
  t_old constant text := 'select grade, trigger_type, explanation_key, created_at';
begin
  if (length(d) - length(replace(d, r_old, ''))) / length(r_old) <> 1
     or (length(d) - length(replace(d, t_old, ''))) / length(t_old) <> 1 then
    raise exception 'P6: clinician_patient_summary live body no longer has the expected selects; review before changing it';
  end if;
  d := replace(d, r_old, $q$select type, systolic, diastolic, value_numeric, unit, measured_at, source, context ->> 'cuff_type' as cuff_type$q$);
  d := replace(d, t_old, 'select grade, trigger_type, explanation_key, created_at, rule_id, rule_set_code, rule_set_version, matched_rule_ids, context');
  execute d;
end $mig$;

-- ---------------------------------------------------------------------------
-- 10. The explainer on the task page: why the engine raised this task (INV-12 tied, INV-10 audited)
-- ---------------------------------------------------------------------------
create or replace function public.clinician_task_triage_explainer(p_task uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  t public.clinical_tasks%rowtype;
  e public.triage_events%rowtype;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select * into t from public.clinical_tasks where id = p_task;
  -- The same answer for "no such task" and "not yours": nothing about a patient is learned from asking.
  if not found or not ((t.claimed_by = v_uid and t.state in ('claimed', 'escalated')) or private.clinician_has_patient_access(t.patient_id)) then
    return jsonb_build_object('status', 'denied');
  end if;
  if t.triage_event_id is null then
    return jsonb_build_object('status', 'none');
  end if;
  select * into e from public.triage_events where id = t.triage_event_id;
  if not found then return jsonb_build_object('status', 'none'); end if;

  perform private.s35_audit_read(t.patient_id, array['triage_explainer'], 'Reading why a triage rule raised a task I hold', 'success');
  return jsonb_build_object('status', 'ok',
    'task_id', t.id,
    'triage_event', jsonb_build_object(
      'id', e.id, 'grade', e.grade, 'trigger_type', e.trigger_type, 'rule_id', e.rule_id,
      'rule_set_code', e.rule_set_code, 'rule_set_version', e.rule_set_version, 'rule_set_status', e.rule_set_status,
      'matched_rule_ids', to_jsonb(e.matched_rule_ids), 'explanation_key', e.explanation_key,
      'actions', e.actions, 'task_key', e.task_key, 'context', e.context, 'created_at', e.created_at));
end $$;
revoke all on function public.clinician_task_triage_explainer(uuid) from public, anon;
grant execute on function public.clinician_task_triage_explainer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Self-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.triage_context_for_coverage(uuid, text, date)', 'execute')
     or has_function_privilege('authenticated', 'public.triage_context_for_coverage(uuid, text, date)', 'execute')
     or has_function_privilege('anon', 'public.record_coverage_triage_result(uuid, text, date, jsonb, uuid, jsonb, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.record_coverage_triage_result(uuid, text, date, jsonb, uuid, jsonb, uuid)', 'execute')
     or has_function_privilege('anon', 'public.clinician_task_triage_explainer(uuid)', 'execute')
     or has_function_privilege('anon', 'private.sweep_triage_coverage(timestamptz)', 'execute') then
    raise exception 'P6: function grants are too wide';
  end if;
  if not has_function_privilege('authenticated', 'public.clinician_task_triage_explainer(uuid)', 'execute') then
    raise exception 'P6: the explainer must be callable by signed-in staff';
  end if;
  if has_table_privilege('anon', 'public.triage_coverage_config', 'select') then
    raise exception 'P6: config readable by anon';
  end if;
  if (select (rules ->> 'enabled')::boolean from public.triage_coverage_config where is_active) then
    raise exception 'P6: the coverage sweep must be born off';
  end if;
  if (select count(*) from public.event_subscribers where subscriber_key in ('triage.grade_silence', 'triage.grade_adherence') and is_active) <> 2 then
    raise exception 'P6: coverage subscribers missing';
  end if;
  if position('triage_reading_snapshot' in pg_get_functiondef('public.record_triage_result(uuid, jsonb, uuid, uuid, text)'::regprocedure)) = 0 then
    raise exception 'P6: record_triage_result does not store the context';
  end if;
  if position('triage_event_id' in pg_get_functiondef('private.handle_symptom_red_flag()'::regprocedure)) <> 0 then
    raise exception 'P6: handle_symptom_red_flag must not have been touched';
  end if;
end $$;
