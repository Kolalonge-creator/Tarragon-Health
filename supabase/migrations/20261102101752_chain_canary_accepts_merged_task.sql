-- The clinical chain canary reported a false miss at stage "task" on 2026-10-29 and 2026-11-01 (2 of about 700 runs, canary data only).
--
-- Cause. Both fixtures belong to one synthetic patient, and a task's dedup key is per patient and task type
-- (triage:<patient>:amber_bp_review). The red fixture's event also makes an amber_bp_review task. Whichever event the bus processes first
-- creates the task, and the other merges into it (merged_count = 1). When the red event wins, the one task carries the RED event's id, and
-- the evaluator, which looked only for a task whose triage_event_id is the amber event's, found none and raised "no amber_bp_review task for
-- the amber event" although the chain had done its job. Checked on the 2026-11-01 23:11 run: the single task was linked to a red observation
-- event (94de0b40-...), had merged_count 1, and was created 2 seconds after the amber event.
--
-- Fix. Keep the exact lookup first. When it finds nothing, accept a task of the expected type for the same synthetic patient that was created
-- at or after the fixture reading and that another event merged into (merged_count > 0). A task that was never made still fails, and so does
-- a task that exists but is older than the reading.
--
-- The function body is the LIVE one (read from pg_get_functiondef on 2026-11-02, which reads private.vitals_readings_current: a later migration
-- patched the original in 20261013223401_p1_chain_canary.sql). Checked line by line against live in a rolled-back transaction: the only
-- difference is the five lines added below. Do not rebuild this from the original file; that would undo the later patch.
create or replace function private.chain_canary_evaluate(p_run uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  st public.chain_canary_runs;
  s public.chain_canary_subjects;
  it jsonb;
  f public.chain_canary_fixtures;
  v_cfg jsonb := (select rules from public.chain_canary_config where is_active);
  rd public.vitals_readings;
  te public.triage_events;
  pg public.pages;
  v_task public.clinical_tasks;
  v_out jsonb := '[]'::jsonb;
  v_stage text; v_msg text; v_one jsonb; v_t jsonb;
  v_n integer; v_viol text[]; v_bad_keys integer;
  v_failed_stage text; v_failed_fixture text; v_sev public.ops_incident_severity := 'sev2';
  v_errs jsonb := '[]'::jsonb;
  v_task_row record;
begin
  select * into st from public.chain_canary_runs where run_id = p_run and kind = 'started';
  if not found then return null; end if;
  if exists (select 1 from public.chain_canary_runs where run_id = p_run and kind = 'result') then return null; end if;
  select * into s from public.chain_canary_subjects;
  if v_cfg is null then raise exception 'no active chain canary config'; end if;

  begin
    for it in select * from jsonb_array_elements(st.fixtures) loop
      select * into f from public.chain_canary_fixtures where code = it ->> 'fixture';
      select * into rd from private.vitals_readings_current where id = (it ->> 'reading_id')::uuid;
      v_stage := null; v_msg := null; v_t := '{}'::jsonb;

      select * into te from public.triage_events where trigger_type = 'observation' and trigger_id = rd.id order by shadow, created_at limit 1;
      if te.id is null then
        v_stage := 'graded'; v_msg := 'no triage event for the fixture reading: the event bus processor, the observation subscriber or the engine did not run';
      else
        v_t := v_t || jsonb_build_object('graded_seconds', round(extract(epoch from te.created_at - rd.created_at))::int, 'grade', te.grade);
        if te.created_at - rd.created_at > make_interval(secs => (v_cfg ->> 'gradedSeconds')::int) then
          v_stage := 'graded'; v_msg := format('graded after %s seconds (budget %s)', round(extract(epoch from te.created_at - rd.created_at)), v_cfg ->> 'gradedSeconds');
        elsif te.grade <> f.expect_grade then
          v_stage := 'graded_wrong_grade'; v_msg := format('fixture %s expected %s, engine said %s (rule %s v%s). If the rule set was deliberately changed, update the fixture.', f.code, f.expect_grade, te.grade, te.rule_set_code, te.rule_set_version);
        elsif te.shadow then
          v_stage := 'graded_shadow'; v_msg := 'graded by a rule set that is not approved (shadow): no task or page would be made';
        end if;
      end if;

      if v_stage is null then
        -- the bus delivered triage.graded to the task and paging subscribers
        select count(*) into v_n from public.domain_events e where e.event_type = 'triage.graded' and e.aggregate_id = te.id;
        if v_n = 0 then
          v_stage := 'event_emitted'; v_msg := 'triage.graded was not emitted for the graded event';
        else
          for v_task_row in
            select d.subscriber_key, d.status, d.last_error, d.done_at, e.created_at as ev_at
              from public.domain_event_deliveries d join public.domain_events e on e.id = d.event_id
             where e.event_type = 'triage.graded' and e.aggregate_id = te.id
               and ((f.expect_task_type is not null and d.subscriber_key = 'queue.create_from_triage') or (f.expect_page and d.subscriber_key = 'paging.on_red'))
          loop
            if v_task_row.status <> 'done' then
              v_stage := 'event_delivered'; v_msg := format('subscriber %s is %s%s', v_task_row.subscriber_key, v_task_row.status, coalesce(': ' || left(v_task_row.last_error, 160), ''));
            end if;
          end loop;
        end if;
      end if;

      if v_stage is null and f.expect_task_type is not null then
        select * into v_task from public.clinical_tasks where triage_event_id = te.id and type = f.expect_task_type order by created_at limit 1;
        if v_task.id is null then
          -- the other fixture of this patient made the task first and this event merged into it (see the header of this migration)
          select * into v_task from public.clinical_tasks
           where organisation_id = s.organisation_id and patient_id = rd.patient_id and type = f.expect_task_type
             and merged_count > 0 and created_at >= rd.created_at - interval '10 seconds'
           order by created_at limit 1;
        end if;
        if v_task.id is null then
          v_stage := 'task'; v_msg := format('no %s task for the amber event', f.expect_task_type);
        else
          v_t := v_t || jsonb_build_object('task_seconds', round(extract(epoch from v_task.created_at - te.created_at))::int);
          if v_task.created_at - te.created_at > make_interval(secs => (v_cfg ->> 'taskSeconds')::int) then
            v_stage := 'task'; v_msg := format('task made after %s seconds (budget %s)', round(extract(epoch from v_task.created_at - te.created_at)), v_cfg ->> 'taskSeconds');
          end if;
        end if;
      end if;

      if v_stage is null and f.expect_page then
        select * into pg from public.pages where triage_event_id = te.id and parent_page_id is null;
        if pg.id is null then
          v_stage := 'page'; v_msg := 'a red event made no page for the on-call clinician';
        elsif pg.to_clinician_id is distinct from s.clinician_id then
          v_stage := 'page'; v_msg := 'the page went to someone other than the synthetic on-call clinician';
        else
          v_t := v_t || jsonb_build_object('page_seconds', round(extract(epoch from pg.sent_at - te.created_at))::int);
          if pg.sent_at - te.created_at > make_interval(secs => (v_cfg ->> 'pageSeconds')::int) then
            v_stage := 'page'; v_msg := format('page sent after %s seconds (budget %s)', round(extract(epoch from pg.sent_at - te.created_at)), v_cfg ->> 'pageSeconds');
          end if;
        end if;
        if v_stage is null then
          v_viol := array(select distinct unnest(private.notification_text_violations(n.payload::text))
                            from public.notifications n where n.source_table = 'pages' and n.source_id = pg.id and n.template = 'on_call_page');
          select count(distinct n.channel) into v_n from public.notifications n where n.source_table = 'pages' and n.source_id = pg.id and n.template = 'on_call_page'
             and n.content_class = 'non_clinical' and n.priority = 'critical' and n.recipient_id = s.clinician_id;
          select count(*) into v_bad_keys from public.notifications n, jsonb_object_keys(n.payload) k
           where n.source_table = 'pages' and n.source_id = pg.id and n.template = 'on_call_page' and k <> 'page_id';
          if v_n < 3 then
            v_stage := 'notification'; v_msg := format('the page made %s of its 3 critical notice rows (push, in-app, email); every channel must have one', v_n);
          elsif v_bad_keys > 0 or cardinality(v_viol) > 0 then
            v_stage := 'notification_not_neutral'; v_msg := 'the page notification payload carries more than the page id or a forbidden term (INV-07)';
          elsif exists (select 1 from public.notifications n where n.source_table = 'pages' and n.source_id = pg.id and n.template = 'on_call_page'
                          and n.created_at - pg.sent_at > make_interval(secs => (v_cfg ->> 'notificationSeconds')::int)) then
            v_stage := 'notification'; v_msg := format('a page notice was recorded more than %s seconds after the page', v_cfg ->> 'notificationSeconds');
          else
            v_t := v_t || jsonb_build_object('notifications', v_n);
          end if;
        end if;
        if v_stage is null then
          if pg.acknowledged_at is null then
            v_stage := 'ack'; v_msg := 'the synthetic clinician did not acknowledge the page (public.acknowledge_page or the page write guard is broken)';
          else
            v_t := v_t || jsonb_build_object('ack_seconds', round(extract(epoch from pg.acknowledged_at - pg.sent_at))::int);
            if pg.acknowledged_at - pg.sent_at > make_interval(secs => (v_cfg ->> 'ackSeconds')::int) then
              v_stage := 'ack'; v_msg := 'acknowledged outside the budget';
            end if;
          end if;
        end if;
      elsif v_stage is null and not f.expect_page then
        if exists (select 1 from public.pages where triage_event_id = te.id) then
          v_stage := 'unexpected_page'; v_msg := 'a non-red fixture made a page';
        end if;
      end if;

      v_one := jsonb_build_object('fixture', f.code, 'reading_id', rd.id, 'passed', v_stage is null, 'stage', v_stage, 'message', v_msg, 'timings', v_t);
      v_out := v_out || jsonb_build_array(v_one);
      if v_stage is not null and v_failed_stage is null then
        v_failed_stage := v_stage; v_failed_fixture := f.code;
      end if;
      if v_stage is not null and f.expect_page then v_sev := 'sev1'; end if;
    end loop;
  exception when others then
    v_failed_stage := 'evaluate'; v_failed_fixture := null; v_sev := 'sev2';
    v_out := v_out || jsonb_build_array(jsonb_build_object('stage', 'evaluate', 'message', 'the canary check itself failed: ' || sqlerrm));
  end;

  -- clean up so the next run starts clean: cancel its tasks, close its pages, resolve its legacy alerts. A cleanup failure is
  -- recorded, never hidden, and never turns a passed run into a failed one.
  begin
    for v_task_row in select id from public.clinical_tasks where organisation_id = s.organisation_id and state in ('created', 'offered_to_lead', 'open', 'escalated', 'claimed') loop
      begin
        perform private.apply_task_transition(v_task_row.id, 'cancelled', 'lead', null, 'chain canary clean-up');
      exception when others then v_errs := v_errs || to_jsonb('task: ' || sqlerrm); end;
    end loop;
    begin
      -- every open page of the synthetic organisation, acknowledged or not: an unacknowledged one left open would be escalated by sweep_pages into
      -- a real sev1 incident of its own, one per run, instead of the single named 'ack' incident
      perform set_config('tarragon.paging_write', 'on', true);
      update public.pages set closed_at = now(), close_note = 'chain canary clean-up' where organisation_id = s.organisation_id and closed_at is null;
      perform set_config('tarragon.paging_write', 'off', true);
    exception when others then perform set_config('tarragon.paging_write', 'off', true); v_errs := v_errs || to_jsonb('page: ' || sqlerrm); end;
    begin
      update public.clinician_alerts set status = 'resolved', resolution_action = 'chain canary clean-up', resolution_outcome = 'no_action_needed'
         where organisation_id = s.organisation_id and status not in ('resolved', 'closed');
    exception when others then v_errs := v_errs || to_jsonb('alerts: ' || sqlerrm); end;
    begin
      update public.emergency_events set status = 'resolved' where organisation_id = s.organisation_id and status = 'active';
    exception when others then v_errs := v_errs || to_jsonb('emergency: ' || sqlerrm); end;
  exception when others then v_errs := v_errs || to_jsonb('cleanup: ' || sqlerrm);
  end;

  insert into public.chain_canary_runs (run_id, kind, config_version, passed, failed_stage, fixtures, details)
  values (p_run, 'result', st.config_version, v_failed_stage is null, v_failed_stage, v_out,
          jsonb_build_object('failed_fixture', v_failed_fixture, 'cleanup_errors', v_errs, 'evaluated_after_seconds', round(extract(epoch from now() - st.at))::int));

  if v_failed_stage is not null then
    perform private.ops_alert_incident('chain_canary:' || v_failed_stage,
      'Clinical chain canary missed at stage: ' || v_failed_stage,
      format('The synthetic check for the clinical chain failed at stage "%s"%s. %s Open the chain health page (/admin/ops/chain-health or /clinician/chain-health) for the timeline. Run %s.',
             v_failed_stage, coalesce(' (fixture ' || v_failed_fixture || ')', ''),
             coalesce((select string_agg(x ->> 'message', ' ') from jsonb_array_elements(v_out) x where x ->> 'message' is not null), ''), p_run),
      v_sev);
  end if;
  return v_failed_stage is null;
end $$;
revoke all on function private.chain_canary_evaluate(uuid) from public, anon, authenticated;
