-- S19d: unified red-event paging, BEHIND A FLAG THAT SHIPS OFF (S16-S20 review Stage 3, CMO decision 11 part 3, defects P5).
--
-- Design and inventory: docs/design/S16-S20-unified-red-paging.md. CMO test pack: docs/plans/S16-S20-unified-red-paging-test-pack.md.
--
-- Live checked 2026-10-15 on koiplnmbgnqnbywhpjlf (read only) before writing: head 20261015013620; the md5 of the live definition of every
-- function patched below equals the md5 of this repo's replayed definition (handle_spo2/temperature/pulse_reading_red_flag,
-- handle_symptom_red_flag, handle_emergency_event, red_watch_triage_trigger, create_red_page), so there is no drift to carry. Even so each
-- function is PATCHED IN PLACE from its current definition with an asserted anchor, never rewritten from an old copy: this project has
-- clobbered handle_symptom_red_flag twice by rewriting it from a stale body.
--
-- WHAT THIS CHANGES WITH THE FLAG OFF: nothing. There is no active unified_red_paging_config row, so every new call returns false at once
-- and every legacy handler runs exactly the code path it ran before (the only edit to a handler is an extra boolean that is false).
--
-- WHAT IT ADDS, for the sources that today notify every `role = clinician` account in parallel and never create a `pages` row (P5):
-- SpO2 red, pulse red, temperature red, a red-flag symptom, and emergency_events rows from an allow-list of sources (the SpO2, temperature and pulse
-- red flags, symptom_log, symptom_triage, danger_symptom_checklist; see 5c for what is deliberately left out and why). With the flag ON for a source, the event creates a page through the SAME ladder as
-- the blood pressure page (create_red_page: Free-patient rule, merge window, conflict and self exclusion, no-cover handling, timers,
-- delivered-ack, expiry), and the legacy handler stops pushing and emailing every clinician FOR THAT EVENT, but only when a page with a
-- named clinician was actually created or joined. A page that could not be made, or one that found nobody on cover, leaves the old
-- broadcast running: a red event never ends up with no clinician notification.
--
-- Also NOT unified: a crisis from the mental health screen or intake screen. private.raise_crisis_follow_up already pages the rota primary (an
-- on_call_page notice through crisis_notify, plus a priority task and a leadership step when nobody is on cover), so a pages row would ring twice.
--
-- NOT TOUCHED, by design: the abnormal screening result pipeline (Category 2 to 1, CLAUDE.md); patient-facing emergency guidance
-- (emergency_events, the acknowledge-gated dialog, INV-06); emergency-contact notice; the red-alert watch on emergency events; the
-- clinician_alerts rows (they still open, they are the work queue); amber and "review needed" levels (not red-class); heart-failure weight gain
-- and lifestyle red flags (alerts without a broadcast today, a four-hour review, not an immediate red event).

-- ---------------------------------------------------------------------------
-- 1. Versioned config (PROPOSED, owner CMO). Born inactive and unsigned: no active row means OFF.
-- ---------------------------------------------------------------------------
create table public.unified_red_paging_config (
  id               uuid primary key default gen_random_uuid(),
  version          integer not null unique,
  is_active        boolean not null default false,
  effective_from   date not null,
  rules            jsonb not null,
  approved_at      timestamptz,
  approved_by      uuid references public.profiles (id) on delete set null,
  test_pack_confirmed_at timestamptz,
  switched_off_at  timestamptz,
  switched_off_by  uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  -- A version can only be live once the CMO has signed it.
  -- (approved_by is not required here: it is ON DELETE SET NULL, and erasing a profile must never be blocked by a live flag)
  constraint unified_red_paging_config_live_needs_signature check (not is_active or approved_at is not null)
);
create unique index unified_red_paging_config_one_active on public.unified_red_paging_config (is_active) where is_active;

create function private.unified_red_paging_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare k text;
begin
  foreach k in array array['spo2_red', 'pulse_red', 'temperature_red', 'symptom_red_flag', 'emergency_event', 'suppress_legacy_clinician_notice'] loop
    if not coalesce((r ->> k) in ('0', '1'), false) then return false; end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;
revoke all on function private.unified_red_paging_rules_valid(jsonb) from public, anon, authenticated;
alter table public.unified_red_paging_config add constraint unified_red_paging_config_rules_valid check (private.unified_red_paging_rules_valid(rules));

-- The values of a version never change; the CMO signs a NEW version. Only the lifecycle columns may move.
create function private.unified_red_paging_config_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'unified_red_paging_config rows are never deleted' using errcode = '55000'; end if;
  if tg_op = 'UPDATE' and (new.version is distinct from old.version or new.rules is distinct from old.rules or new.effective_from is distinct from old.effective_from) then
    raise exception 'the rules of a unified red paging version never change: add a new version' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.unified_red_paging_config_guard() from public, anon, authenticated;
create trigger unified_red_paging_config_guard before update or delete on public.unified_red_paging_config
  for each row execute function private.unified_red_paging_config_guard();

-- unified-red-paging-rules-begin
-- Version 1: every source on, and the legacy broadcast suppressed only where a page with a named clinician exists. INACTIVE and UNSIGNED:
-- nothing happens until the Chief Medical Officer signs it on the sign-off hub after running the test pack.
insert into public.unified_red_paging_config (version, is_active, effective_from, rules) values (1, false, '2026-10-15', $json$
{
  "spo2_red": 1,
  "pulse_red": 1,
  "temperature_red": 1,
  "symptom_red_flag": 1,
  "emergency_event": 1,
  "suppress_legacy_clinician_notice": 1
}
$json$::jsonb);
-- unified-red-paging-rules-end

alter table public.unified_red_paging_config enable row level security;
-- staff who manage it only: a patient has no use for the clinical-safety settings or for who switched them
create policy unified_red_paging_config_read on public.unified_red_paging_config for select to authenticated
  using (private.credential_is_cmo() or private.is_admin());
revoke all on public.unified_red_paging_config from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.unified_red_paging_config from authenticated;
grant select on public.unified_red_paging_config to authenticated;

-- Fail-safe reads. A missing row, an unsigned row, a malformed value or any error means OFF (null / false), never ON.
create function private.unified_red_rule(p_key text) returns integer
language plpgsql stable security definer set search_path = ''
as $$
begin
  return (select (rules ->> p_key)::integer from public.unified_red_paging_config
           where is_active and approved_at is not null order by version desc limit 1);
exception when others then
  return null;
end;
$$;
revoke all on function private.unified_red_rule(text) from public, anon, authenticated;

create function private.unified_red_paging_on(p_source text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  return coalesce(private.unified_red_rule(p_source), 0) = 1;
exception when others then
  return false;
end;
$$;
revoke all on function private.unified_red_paging_on(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The CMO's two controls. Only the CMO can switch ON; the CMO or an admin can switch OFF (the safe direction).
-- ---------------------------------------------------------------------------
create function public.sign_unified_red_paging_config(p_version integer, p_test_pack_run boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.unified_red_paging_config%rowtype; v_uid uuid;
begin
  v_uid := private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can switch unified red-event paging on' using errcode = '42501'; end if;
  if p_test_pack_run is not true then raise exception 'confirm that the staging test pack was run before switching this on' using errcode = '22023'; end if;
  select * into c from public.unified_red_paging_config where version = p_version for update;
  if not found then raise exception 'no such unified red-event paging version' using errcode = 'P0002'; end if;
  if c.is_active then raise exception 'that version is already on' using errcode = '23514'; end if;
  update public.unified_red_paging_config set is_active = false where is_active and version <> p_version;
  update public.unified_red_paging_config
     set approved_at = coalesce(approved_at, now()), approved_by = coalesce(approved_by, v_uid), test_pack_confirmed_at = now(),
         is_active = true, switched_off_at = null, switched_off_by = null
   where version = p_version;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (null, v_uid, 'unified_red_paging.switched_on', 'unified_red_paging_config', c.id, jsonb_build_object('version', p_version));
end;
$$;
revoke all on function public.sign_unified_red_paging_config(integer, boolean) from public, anon, authenticated;
grant execute on function public.sign_unified_red_paging_config(integer, boolean) to authenticated;

create function public.switch_off_unified_red_paging() returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid; v_n integer;
begin
  v_uid := private.uid_or_deny();
  if not (private.credential_is_cmo() or private.is_admin()) then raise exception 'only the chief medical officer or an admin can switch unified red-event paging off' using errcode = '42501'; end if;
  update public.unified_red_paging_config set is_active = false, switched_off_at = now(), switched_off_by = v_uid where is_active;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
      values (null, v_uid, 'unified_red_paging.switched_off', 'unified_red_paging_config', null, jsonb_build_object('rows', v_n));
  end if;
  -- Pages that are already open are NOT touched: they stay on the ladder until acknowledged or closed. Only new events go back to the old path.
  return v_n;
end;
$$;
revoke all on function public.switch_off_unified_red_paging() from public, anon, authenticated;
grant execute on function public.switch_off_unified_red_paging() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. A triage event can now come from a live threshold function, not only a rule set.
--    "approved" here means: the deterministic threshold function in force today (classify_*), not a rule set row. The CMO's signature on the
--    config above is the approval. These rows are never shadow, so create_red_page treats them like any red grade (and the reconciler
--    can page one if the direct call ever failed after the row was saved).
-- ---------------------------------------------------------------------------
alter table public.triage_events drop constraint triage_events_no_rule_set_means_shadow;
alter table public.triage_events add constraint triage_events_no_rule_set_means_shadow
  check (rule_set_id is not null
         or (shadow and rule_set_code = 'live_symptom_gate')
         or (not shadow and rule_set_code = 'unified_red_paging' and rule_set_status = 'approved' and grade = 'red'));
-- (once per source event is already enforced by triage_events_bridge_once on (trigger_type, trigger_id) where rule_set_id is null. A unified row therefore
-- never uses ('symptom_report', symptom id): that slot belongs to the P6 shadow bridge written by AFTER INSERT on symptoms. Symptoms and emergency events use
-- trigger_type 'result' with their own ids.)

-- The red-alert watch is the patient-outreach net and is already opened by the emergency event itself. A unified paging row must not open a
-- second one (the patient would be told twice): skip it. Everything else is the live definition.
create or replace function private.red_watch_triage_trigger()
returns trigger language plpgsql security definer set search_path = ''
as $function$ begin
  if new.rule_set_code = 'unified_red_paging' then return null; end if;
  perform private.open_red_alert_watch('triage_event', new.id);
  return null;
end $function$;

-- ---------------------------------------------------------------------------
-- 4. The one entry point every red source calls. Returns true ONLY when the legacy "notify every clinician" step can be skipped.
-- ---------------------------------------------------------------------------
create function private.unified_red_page_covers(
  p_source text, p_org uuid, p_patient uuid, p_trigger_type text, p_ref_table text, p_ref_id uuid
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_te uuid; v_page uuid; v_no_cover boolean; v_test boolean;
begin
  -- Flag off, unsigned, missing or unreadable: the old path runs untouched.
  if p_patient is null or p_ref_id is null or not private.unified_red_paging_on(p_source) then return false; end if;
  -- Two-tier: a Free patient's red event pages nobody. The legacy handlers already give them the guidance record; nothing is added here.
  if not private.patient_may_page_doctor(p_patient) then return false; end if;
  begin
    select id into v_te from public.triage_events
     where rule_set_code = 'unified_red_paging' and trigger_type = p_trigger_type and trigger_id = p_ref_id and basis = p_source;
    if v_te is null then
      select coalesce(is_test, false) into v_test from public.profiles where id = p_patient;
      -- ids only, no reading values (INV-07): a clinician reaches the facts through the page and the chart, after acknowledging.
      insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code,
          rule_set_version, rule_set_status, explanation_key, actions, matched_rule_ids, task_key, basis, shadow, is_test, context)
      values (p_org, p_patient, p_trigger_type, p_ref_id, 'red', 'UNIFIED-' || upper(p_source), null, 'unified_red_paging',
          1, 'approved', null, '[{"kind":"page_on_call"}]'::jsonb, '{}', null, p_source, false, coalesce(v_test, false),
          jsonb_build_object('source', p_source, 'ref_table', p_ref_table, 'ref_id', p_ref_id))
      returning id into v_te;
    end if;
    v_page := public.create_red_page(v_te);
    if v_page is null then return false; end if;
    select no_cover into v_no_cover from public.pages where id = v_page;
    -- Nobody on cover: leadership was alerted by the ladder, and the old broadcast ALSO runs, so a clinician who can see the patient is told.
    if coalesce(v_no_cover, true) then return false; end if;
    return coalesce(private.unified_red_rule('suppress_legacy_clinician_notice'), 0) = 1;
  exception when others then
    -- The sub-block rolled back its own work. The old path runs. Not silent: an audit row and an ops incident.
    begin
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (p_org, 'unified_red_page.error', 'paging', p_ref_id, jsonb_build_object('source', p_source, 'error', sqlerrm));
      perform private.page_incident(p_org, 'unified_red_page_failed:' || p_source, 'A red event could not be paged through the unified ladder',
        'A red event could not be turned into a page; the older clinician notification ran instead. See audit_log action unified_red_page.error.');
    exception when others then
      raise warning 'unified red paging error for % %: %', p_source, p_ref_id, sqlerrm;
    end;
    return false;
  end;
end;
$$;
revoke all on function private.unified_red_page_covers(text, uuid, uuid, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Patch the legacy handlers in place from their CURRENT definitions, each anchor asserted.
-- ---------------------------------------------------------------------------
do $patch$
declare
  v_def text; v_new text; v_oid oid; v_count integer;
  p record;
begin
  -- 5a. SpO2, pulse, temperature: only the `red` level is red-class. The call sits inside `v_should_page`, so it only runs on a paid-plan
  --     escalation (a Free patient never reaches it) and never for amber.
  for p in select * from (values
      ('handle_spo2_reading_red_flag', 'spo2_red'),
      ('handle_pulse_reading_red_flag', 'pulse_red'),
      ('handle_temperature_reading_red_flag', 'temperature_red')) as t(fn, src)
  loop
    select pr.oid into v_oid from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace where n.nspname = 'private' and pr.proname = p.fn;
    v_def := pg_get_functiondef(v_oid);
    if position('unified_red_page_covers' in v_def) > 0 then continue; end if;
    v_count := (length(v_def) - length(replace(v_def, E'\n  if v_should_page then\n', ''))) / length(E'\n  if v_should_page then\n');
    if v_count <> 1 then raise exception 'S19d: anchor for % found % times, expected 1', p.fn, v_count; end if;
    v_new := replace(v_def, E'\n  if v_should_page then\n',
      E'\n  if v_should_page and not (v_level = ''red'' and private.unified_red_page_covers(' || quote_literal(p.src)
      || E', new.organisation_id, new.patient_id, ''observation'', ''vitals_readings'', new.id)) then\n');
    if v_new = v_def then raise exception 'S19d: patch of % changed nothing', p.fn; end if;
    execute v_new;
  end loop;

  -- 5b. Red-flag symptom: only the red-flag branch (urgent_escalation), not the severity 5-7 review.
  select pr.oid into v_oid from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace where n.nspname = 'private' and pr.proname = 'handle_symptom_red_flag';
  v_def := pg_get_functiondef(v_oid);
  if position('unified_red_page_covers' in v_def) = 0 then
    v_count := (length(v_def) - length(replace(v_def, E'\n  if v_should_page then\n', ''))) / length(E'\n  if v_should_page then\n');
    if v_count <> 1 then raise exception 'S19d: anchor for handle_symptom_red_flag found % times, expected 1', v_count; end if;
    v_new := replace(v_def, E'\n  if v_should_page then\n',
      E'\n  if v_should_page and not (v_is_red_flag and private.unified_red_page_covers(''symptom_red_flag'', new.organisation_id, new.patient_id, ''result'', ''symptoms'', new.id)) then\n');
    if v_new = v_def then raise exception 'S19d: patch of handle_symptom_red_flag changed nothing'; end if;
    execute v_new;
  end if;

  -- 5c. Emergency events: three edits, ALLOW-LIST of sources (a new source is old-path until someone adds it here on purpose): the SpO2, temperature and pulse
  --     red flags, symptom_log, symptom_triage and danger_symptom_checklist. Everything else stays on the old path: bp_reading and glucose_red_flag (they have a
  --     triage-engine page, or will once glucose_care_triage is signed: a second page would ring twice), triage_red (the Free record), mental_health_screen and
  --     intake_screen (a crisis already has its own pager and task in private.raise_crisis_follow_up), and pregnancy_symptom_checklist, exposure_report,
  --     support_ticket_intake, ai_coach, symptom_to_test_checker (reproductive and other sensitive or free-text sources: a page would also tell the Care
  --     Circle and widen who learns of it; the CMO and DPO decide that, not this change).
  select pr.oid into v_oid from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace where n.nspname = 'private' and pr.proname = 'handle_emergency_event';
  v_def := pg_get_functiondef(v_oid);
  if position('unified_red_page_covers' in v_def) = 0 then
    v_new := v_def;
    -- declare
    v_count := (length(v_new) - length(replace(v_new, E'  v_source_label text;\nbegin\n', ''))) / length(E'  v_source_label text;\nbegin\n');
    if v_count <> 1 then raise exception 'S19d: emergency declare anchor found % times', v_count; end if;
    v_new := replace(v_new, E'  v_source_label text;\nbegin\n', E'  v_source_label text;\n  v_unified_paged boolean := false;\nbegin\n');
    -- decide, right after the alert row exists
    v_count := (length(v_new) - length(replace(v_new, E'      new.clinician_alert_id := v_alert_id;\n', ''))) / length(E'      new.clinician_alert_id := v_alert_id;\n');
    if v_count <> 1 then raise exception 'S19d: emergency alert anchor found % times', v_count; end if;
    v_new := replace(v_new, E'      new.clinician_alert_id := v_alert_id;\n',
      E'      new.clinician_alert_id := v_alert_id;\n      v_unified_paged := new.source::text in (''spo2_red_flag'', ''temperature_red_flag'', ''pulse_red_flag'', ''symptom_log'', ''symptom_triage'', ''danger_symptom_checklist'')\n'
      || E'        and private.unified_red_page_covers(''emergency_event'', new.organisation_id, new.patient_id, ''result'', ''emergency_events'', new.id);\n');
    -- skip the broadcast loop only when a page covers the event
    v_count := (length(v_new) - length(replace(v_new, E'where organisation_id = new.organisation_id and role = ''clinician''\n      loop', ''))) / length(E'where organisation_id = new.organisation_id and role = ''clinician''\n      loop');
    if v_count <> 1 then raise exception 'S19d: emergency loop anchor found % times', v_count; end if;
    v_new := replace(v_new, E'where organisation_id = new.organisation_id and role = ''clinician''\n      loop',
      E'where organisation_id = new.organisation_id and role = ''clinician''\n          and not v_unified_paged\n      loop');
    if v_new = v_def then raise exception 'S19d: patch of handle_emergency_event changed nothing'; end if;
    execute v_new;
  end if;

  -- 5d. Everything else that reads triage_events or pages and would otherwise count or mishandle a unified row. Same method: current definition, counted anchor.
  --     (1) the patient's "could not get care" answer must attach to the emergency event (which has the red-alert watch), never to a unified row (which has
  --     none); (2) the chain-health timings, the parity measure and the risk score were built on the blood pressure engine and must not be moved by another source;
  --     (3) a unified page does not tell the Care Circle: that reach is for the CMO and DPO to decide (a blood pressure page still does).
  for p in select * from (values
      ('private.chain_timing_rows(integer,boolean)'::regprocedure, $a$where te.trigger_type = 'observation' and not te.shadow and te.is_test = p_test$a$, $b$where te.trigger_type = 'observation' and not te.shadow and te.rule_set_code is distinct from 'unified_red_paging' and te.is_test = p_test$b$),
      ('private.chain_timing_rows(integer,boolean)'::regprocedure, $a$where not te.shadow and te.is_test = p_test$a$, $b$where not te.shadow and te.rule_set_code is distinct from 'unified_red_paging' and te.is_test = p_test$b$),
      ('private.chain_timing_rows(integer,boolean)'::regprocedure, $a$join public.triage_events te on te.id = p.triage_event_id, win$a$, $b$join public.triage_events te on te.id = p.triage_event_id and te.rule_set_code is distinct from 'unified_red_paging', win$b$),
      ('private.risk_compute(uuid,date)'::regprocedure, $a$where patient_id = p_patient and not shadow and (created_at at time zone$a$, $b$where patient_id = p_patient and not shadow and rule_set_code is distinct from 'unified_red_paging' and (created_at at time zone$b$),
      ('private.triage_parity_rows(integer)'::regprocedure, $a$where te.trigger_type = 'observation' and not te.is_test$a$, $b$where te.trigger_type = 'observation' and not te.is_test and te.rule_set_code is distinct from 'unified_red_paging'$b$),
      ('public.record_red_care_response(uuid,text,uuid,uuid,timestamptz)'::regprocedure, $a$where patient_id = v_uid and grade = 'red' and not shadow and created_at$a$, $b$where patient_id = v_uid and grade = 'red' and not shadow and rule_set_code is distinct from 'unified_red_paging' and created_at$b$),
      ('private.notify_circle_red_alert()'::regprocedure, E'  if new.parent_page_id is not null then return new; end if;\n', E'  if new.parent_page_id is not null then return new; end if;\n  if exists (select 1 from public.triage_events ut where ut.id = new.triage_event_id and ut.rule_set_code = ''unified_red_paging'') then return new; end if;\n')
    ) as t(fn, from_text, to_text)
  loop
    v_def := pg_get_functiondef(p.fn);
    if position('unified_red_paging' in v_def) > 0 and position(p.to_text in v_def) > 0 then continue; end if;
    v_count := (length(v_def) - length(replace(v_def, p.from_text, ''))) / length(p.from_text);
    if v_count <> 1 then raise exception 'S19d: anchor for % found % times, expected 1: %', p.fn, v_count, p.from_text; end if;
    v_new := replace(v_def, p.from_text, p.to_text);
    execute v_new;
  end loop;
end
$patch$;

-- ---------------------------------------------------------------------------
-- 6. Self-checks
-- ---------------------------------------------------------------------------
do $check$
declare fn text;
begin
  foreach fn in array array['handle_spo2_reading_red_flag', 'handle_pulse_reading_red_flag', 'handle_temperature_reading_red_flag', 'handle_symptom_red_flag', 'handle_emergency_event'] loop
    if position('unified_red_page_covers' in pg_get_functiondef(('private.' || fn || '()')::regprocedure)) = 0 then
      raise exception 'S19d: % was not patched', fn;
    end if;
  end loop;
  if position('unified_red_paging' in pg_get_functiondef('private.risk_compute(uuid,date)'::regprocedure)) = 0
     or position('unified_red_paging' in pg_get_functiondef('private.chain_timing_rows(integer,boolean)'::regprocedure)) = 0
     or position('unified_red_paging' in pg_get_functiondef('private.triage_parity_rows(integer)'::regprocedure)) = 0
     or position('unified_red_paging' in pg_get_functiondef('public.record_red_care_response(uuid,text,uuid,uuid,timestamptz)'::regprocedure)) = 0
     or position('unified_red_paging' in pg_get_functiondef('private.notify_circle_red_alert()'::regprocedure)) = 0 then
    raise exception 'S19d: a dependent function was not patched';
  end if;
  if exists (select 1 from public.unified_red_paging_config where is_active or approved_at is not null) then raise exception 'S19d: the config must ship inactive and unsigned'; end if;
  if private.unified_red_paging_on('spo2_red') or private.unified_red_paging_on('emergency_event') then raise exception 'S19d: the flag must read OFF on arrival'; end if;
  if has_function_privilege('anon', 'private.unified_red_page_covers(text,uuid,uuid,text,text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.unified_red_page_covers(text,uuid,uuid,text,text,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.unified_red_paging_on(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.sign_unified_red_paging_config(integer,boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.switch_off_unified_red_paging()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.sign_unified_red_paging_config(integer,boolean)', 'EXECUTE') then
    raise exception 'S19d: function grants are wrong';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'unified_red_paging_config'
              and grantee in ('anon', 'PUBLIC', 'authenticated') and privilege_type <> 'SELECT') then
    raise exception 'S19d: config table grants are wrong';
  end if;
end
$check$;
