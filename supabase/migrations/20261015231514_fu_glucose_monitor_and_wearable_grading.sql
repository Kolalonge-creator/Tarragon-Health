-- Follow-up OQ-320 (founder answer 2026-10-15): glucose from continuous monitors and wearables IS now graded by the glucose rules.
--
-- Live checked 2026-10-15 on koiplnmbgnqnbywhpjlf before writing: vital_source = manual, device, wearable, cgm, fhir_import, photo_confirmed; the R2 wiring is live
-- (producer trigger on manual and device readings only); glucose_care_triage v1 is a DRAFT, so every result is shadow: this migration pages nobody and opens no task
-- until the Chief Medical Officer signs the rule set. It also stays behind the existing producer: a manual or Bluetooth reading goes through the unchanged row trigger.
--
-- The three guards a stream of monitor readings needs (all PROPOSED, in versioned configuration, never in code; mirrors registry key triage.glucose_monitor):
--   freshMinutes   a reading older than this when it reaches the server is NOT graded (a bulk sync of old values must not page a stale low). 30.
--   dedupeMinutes  the same level (grade and rule) for the same patient is not graded again within this long, for monitor readings. 60. "Same level" means the patient's
--                  MOST RECENT glucose result is that level: a recovery in between (a different grade or rule) restarts it, so a second low after a normal reading is graded.
--   bulk syncs     a statement that inserts many monitor readings grades only the LATEST reading of each patient in that statement.
-- The production connection budget is tight, so there is no new cron job: a statement-level trigger (one cheap check per insert statement) is the only new work,
-- and the streaming volume is cut at the source (one event per patient per batch, and none for a stale one).
--
-- What this adds
--  1. triage_glucose_monitor_config (versioned, one active row) and private.glucose_monitor_config().
--  2. A statement-level AFTER INSERT trigger on vitals_readings that emits one observation.recorded (kind glucose, ids only, idempotency key glu:<id>, the same key shape
--     as the row trigger) for the latest fresh monitor glucose reading of each patient in the statement.
--  3. public.record_glucose_triage_result rewritten from its LIVE definition with one asserted replace: a monitor-sourced reading whose level is the patient's most recent
--     glucose result, inside the dedupe window, stores nothing (returns created=false, deduped=true; helper private.glucose_monitor_is_duplicate reads the config once).
--     A manual or Bluetooth reading is never deduped.
--  4. Nothing is dropped silently: a stale batch and a failed emit each write an audit_log row (glucose_monitor.stale_dropped, glucose_monitor.emit_failed), and the existing
--     10-minute R2 sweep now also re-emits the LATEST monitor reading of a patient inside the freshness window if it lost its event (bounded: one lookup per patient).
--  The symptom regrade and the ketone regrade stay manual and device only on purpose.
--  KNOWN LIMIT (founder decision: a bulk sync grades only the latest reading): a fresh low earlier in the same batch as a normal latest reading is not graded by this engine;
--  the older glucose pipeline (glucose_emergency_backstop) still sees every row. Raised as an open question in docs/design/FU-engine-closeout.md.

-- 1. Config ----------------------------------------------------------------------------------------------------------------------------
create table public.triage_glucose_monitor_config (
  version        integer primary key check (version >= 1),
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null check (jsonb_typeof(rules) = 'object'),
  created_at     timestamptz not null default now()
);
create unique index triage_glucose_monitor_config_one_active on public.triage_glucose_monitor_config (is_active) where is_active;
alter table public.triage_glucose_monitor_config enable row level security;
create policy triage_glucose_monitor_config_admin_read on public.triage_glucose_monitor_config for select to authenticated using (private.is_admin());
revoke all on public.triage_glucose_monitor_config from public, anon, authenticated;
grant select on public.triage_glucose_monitor_config to authenticated;

-- glucose-monitor-begin
insert into public.triage_glucose_monitor_config (version, is_active, effective_from, rules) values (1, true, '2026-10-15', $json$
{
  "enabled": true,
  "freshMinutes": 30,
  "dedupeMinutes": 60,
  "sources": ["wearable", "cgm"]
}
$json$::jsonb);
-- glucose-monitor-end
comment on table public.triage_glucose_monitor_config is 'OQ-320: PROPOSED guards for grading glucose from continuous monitors and wearables (freshness window, dedupe interval, sources). Mirrors registry key triage.glucose_monitor; a Jest test fails on drift.';

create or replace function private.glucose_monitor_config()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce((select c.rules from public.triage_glucose_monitor_config c where c.is_active), '{"enabled": false}'::jsonb);
$$;
revoke all on function private.glucose_monitor_config() from public, anon, authenticated;

-- 2. Producer for monitor and wearable readings --------------------------------------------------------------------------------------
create or replace function private.emit_glucose_monitor_observations()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_cfg jsonb;
  v_fresh interval;
  r record;
begin
  -- Cheap exit for every insert statement that carries no monitor glucose (blood pressure, weight, manual glucose...).
  if not exists (select 1 from new_rows n where n.vital_type = 'glucose'::public.vital_type and n.source in ('wearable'::public.vital_source, 'cgm'::public.vital_source)) then
    return null;
  end if;
  begin
    v_cfg := private.glucose_monitor_config();
    if not coalesce((v_cfg ->> 'enabled')::boolean, false) then return null; end if;
    v_fresh := make_interval(mins => (v_cfg ->> 'freshMinutes')::integer);
    -- The latest monitor reading of each patient in this statement, and only if it is fresh. Older rows of a bulk sync are never graded.
    for r in
      select distinct on (n.patient_id) n.id, n.organisation_id, n.patient_id, n.taken_at
        from new_rows n
       where n.vital_type = 'glucose'::public.vital_type and n.glucose_mmol_l is not null and n.correction_status is null
         and n.source in ('wearable'::public.vital_source, 'cgm'::public.vital_source)
       order by n.patient_id, n.taken_at desc, n.created_at desc, n.id
    loop
      if r.taken_at >= now() - v_fresh then
        begin
          perform private.emit_domain_event(
            'observation.recorded', r.organisation_id,
            jsonb_build_object('observation_id', r.id, 'kind', 'glucose'),
            'glu:' || r.id::text,
            r.patient_id, 'observation', r.id);
        exception when others then
          -- One patient's failed emit never stops the next patient's, and it is not silent: a warning, an audit row, and the sweep below re-emits it.
          raise warning 'OQ-320: could not emit observation.recorded for monitor glucose reading %: %', r.id, sqlerrm;
          insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
            values (r.organisation_id, 'glucose_monitor.emit_failed', 'vitals_reading', r.id, jsonb_build_object('error', sqlerrm));
        end;
      else
        -- Too old to grade as new (an offline phone catching up). Recorded, not graded: the freshness window is the founder's guard against a stale low paging.
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
          values (r.organisation_id, 'glucose_monitor.stale_dropped', 'vitals_reading', r.id,
                  jsonb_build_object('taken_at', r.taken_at, 'fresh_minutes', (v_cfg ->> 'freshMinutes')::integer));
      end if;
    end loop;
  exception when others then
    -- Even the config read or the loop itself failing never refuses a reading.
    raise warning 'OQ-320: monitor glucose batch not graded: %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function private.emit_glucose_monitor_observations() from public, anon, authenticated;

create trigger vitals_readings_emit_glucose_monitor_observations
  after insert on public.vitals_readings
  referencing new table as new_rows
  for each statement execute function private.emit_glucose_monitor_observations();

-- 3. Dedupe in the result writer -----------------------------------------------------------------------------------------------------
create or replace function private.glucose_monitor_is_duplicate(p_patient uuid, p_rule_set uuid, p_grade text, p_rule text, p_reading uuid, p_source text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cfg jsonb := private.glucose_monitor_config();
begin
  if not coalesce((v_cfg ->> 'enabled')::boolean, false) or not (p_source = any (select jsonb_array_elements_text(coalesce(v_cfg -> 'sources', '[]'::jsonb)))) then
    return false;
  end if;
  -- The patient's most recent glucose result for this rule set (another reading, any source) must be the same level, inside the window. A different level in between
  -- (a recovery, or a worse reading) therefore ends the duplicate run, and the next one is graded.
  return coalesce((select e.grade = p_grade and e.rule_id is not distinct from p_rule
                     from public.triage_events e
                    where e.patient_id = p_patient and e.rule_set_id = p_rule_set and e.trigger_type = 'observation' and e.trigger_id <> p_reading
                      and e.created_at > now() - make_interval(mins => (v_cfg ->> 'dedupeMinutes')::integer)
                    order by e.created_at desc, e.id desc limit 1), false);
end $$;
revoke all on function private.glucose_monitor_is_duplicate(uuid, uuid, text, text, uuid, text) from public, anon, authenticated;

do $mig$
declare
  d text := pg_get_functiondef('public.record_glucose_triage_result(uuid, jsonb, uuid, uuid, text)'::regprocedure);
  anchor constant text := E'  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id,\n      rule_set_code, rule_set_version, rule_set_status, explanation_key, actions, matched_rule_ids, task_key, basis, shadow, is_test)';
  extra constant text := $q$  -- OQ-320: a monitor or wearable reading whose LEVEL (grade and rule) is the patient's most recent glucose result, inside the dedupe window, stores nothing,
  -- so a stream of 5-minute readings in one low cannot page or open a task again every five minutes, while a second low after a recovery is graded. A manual or Bluetooth
  -- reading is never deduped, and a redelivery or regrade of the SAME reading (trigger_id = this reading) is left to the unique key below. The caller sees deduped = true.
  if private.glucose_monitor_is_duplicate(v.patient_id, v_rs.id, v_grade, p_result ->> 'ruleId', v.id, v.source::text) then
    return jsonb_build_object('status', 'graded', 'created', false, 'deduped', true);
  end if;

$q$;
begin
  if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'OQ-320: record_glucose_triage_result live body no longer has the expected insert; review before changing it';
  end if;
  execute replace(d, anchor, extra || anchor);
end $mig$;

-- 4. Sweep: also the latest monitor reading of each patient inside the freshness window ------------------------------------------------
do $mig$
declare
  d text := pg_get_functiondef('private.sweep_glucose_observation_events()'::regprocedure);
  anchor constant text := E'  return v_n;\nend';
  extra constant text := $q$  -- OQ-320: the latest monitor or wearable reading of each patient, only while it is still fresh, if it lost its event (a failed emit). Bounded: one reading per patient.
  if coalesce((private.glucose_monitor_config() ->> 'enabled')::boolean, false) then
    for r in
      select distinct on (v.patient_id) v.id, v.organisation_id, v.patient_id
        from private.vitals_readings_current v
       where v.vital_type::text = 'glucose' and v.glucose_mmol_l is not null and v.correction_status is null
         and v.source::text in ('wearable', 'cgm')
         and v.taken_at > now() - make_interval(mins => (private.glucose_monitor_config() ->> 'freshMinutes')::integer)
         and v.created_at < now() - interval '1 minute'
       order by v.patient_id, v.taken_at desc, v.created_at desc, v.id
    loop
      if not exists (select 1 from public.domain_events e where e.event_type = 'observation.recorded' and e.idempotency_key = 'glu:' || r.id::text) then
        begin
          perform private.emit_domain_event(
            'observation.recorded', r.organisation_id,
            jsonb_build_object('observation_id', r.id, 'kind', 'glucose'),
            'glu:' || r.id::text, r.patient_id, 'observation', r.id);
          v_n := v_n + 1;
        exception when others then
          raise warning 'OQ-320: sweep could not emit monitor glucose reading %: %', r.id, sqlerrm;
        end;
      end if;
    end loop;
  end if;
$q$;
begin
  if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'OQ-320: sweep_glucose_observation_events live body no longer ends as expected; review before changing it';
  end if;
  execute replace(d, anchor, extra || anchor);
end $mig$;

do $$
begin
  if pg_get_functiondef('public.record_glucose_triage_result(uuid, jsonb, uuid, uuid, text)'::regprocedure) not like '%glucose_monitor_is_duplicate%'
     or pg_get_functiondef('private.sweep_glucose_observation_events()'::regprocedure) not like '%freshMinutes%' then
    raise exception 'OQ-320 self-check: the writer does not dedupe';
  end if;
  if has_function_privilege('anon', 'private.emit_glucose_monitor_observations()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.emit_glucose_monitor_observations()', 'EXECUTE')
     or has_function_privilege('anon', 'private.glucose_monitor_config()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.glucose_monitor_is_duplicate(uuid, uuid, text, text, uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_glucose_triage_result(uuid, jsonb, uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_glucose_triage_result(uuid, jsonb, uuid, uuid, text)', 'EXECUTE') then
    raise exception 'OQ-320 self-check: a function became callable by a client';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'vitals_readings_emit_glucose_monitor_observations' and tgrelid = 'public.vitals_readings'::regclass and tgnewtable is not null) then
    raise exception 'OQ-320 self-check: the monitor producer trigger is missing';
  end if;
  if (select count(*) from public.triage_glucose_monitor_config where is_active) <> 1 then
    raise exception 'OQ-320 self-check: exactly one active config expected';
  end if;
  if has_table_privilege('anon', 'public.triage_glucose_monitor_config', 'SELECT') then
    raise exception 'OQ-320 self-check: anon can read the config';
  end if;
end $$;
