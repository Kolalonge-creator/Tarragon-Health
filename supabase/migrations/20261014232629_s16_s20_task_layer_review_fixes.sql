-- S16-S20 task layer, review fixes (lead review of 20261014222123). A third, small migration rather than an edit of the second.
--
--   1. D10 relaxed. A claim whose lease ran out but is STILL LIVE (the sweep has not ended it; the task is still claimed by this
--      clinician) can be completed: the work is real, and refusing it lost a written answer. Completion after the due time already
--      counts as completed_late. A claim the sweep has ended, or that was reassigned, is still refused (queue_no_claim). Applied by
--      rewriting the live body (the SR2d pattern) so nothing else in queue_complete is restated.
--   2. Cron: queue-watchdog and queue-backlog-digest move off the shared minutes (SR2 stagger, 20261012211349).
--   3. The watchdog is watched: queue_stale_jobs also reports a watchdog that has not finished a run, and queue_health (readable by the
--      clinical lead) carries it. An external dead-man check is still needed (a dead pg_cron kills the watchdog too).
--   4. cancel_clinical_task on a claimed task tells the claimant, in app, in neutral words; my_task_outcome() lets the task page show
--      "withdrawn" instead of "you do not hold this task".
--   5. Contact attempts may be dated up to 24 hours before the task was created (a call made before the result reached the queue).
--   6. Escalation flood: the first immediate escalation alerts by in-app, push and email; further immediate escalations within the
--      coalescing window still get their own in-app row (nothing is dropped) but their push and email are folded into ONE follow-up
--      ("more tasks escalated", with a count) per channel, until that follow-up has gone out.
--
-- Two numbers here are SQL constants, not configuration, because queue_task_layer_config v1 cannot be edited in place and a v2 would
-- have to be activated unsigned: contact_attempt_lookback() = 24 hours and escalation_coalesce_window() = 10 minutes. Both are PROPOSED
-- (owner CMO), documented in the registry entry `queue.task_layer` and in docs/design/S16-S20-task-layer.md; the v2 pack moves them into config.

-- ---------------------------------------------------------------------------
-- Constants as functions (so a proof can sabotage them and a v2 can later read config instead)
-- ---------------------------------------------------------------------------
create function private.contact_attempt_lookback() returns interval
language sql immutable set search_path = ''
as $$ select interval '24 hours'; $$;
create function private.escalation_coalesce_window() returns interval
language sql immutable set search_path = ''
as $$ select interval '10 minutes'; $$;
revoke all on function private.contact_attempt_lookback(), private.escalation_coalesce_window() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1 and 5. queue_complete: no lease refusal; task_outcome_error: 24 hour look-back (live bodies rewritten, SR2d pattern)
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_old constant text := E'  -- D10: a lease that has run out is the sweep''s to release, not the clinician''s to finish\n  if c.expires_at <= now() then raise exception ''queue_claim_expired'' using errcode = ''42501''; end if;\n';
  v_new constant text := E'  -- D10 (relaxed): the claim is live (the select above) and the task is still this clinician''s, so a lapsed lease the sweep has not\n  -- yet released does not stop the work being recorded; once the sweep has ended the claim, or another clinician holds it, the select\n  -- above finds nothing and this raises queue_no_claim. Completed after the due time counts as completed_late below.\n';
begin
  v_def := pg_get_functiondef('public.queue_complete(uuid,jsonb)'::regprocedure);
  if position(v_old in v_def) = 0 then raise exception 'S16-S20 fixes: queue_complete no longer contains the lease check; not rewriting'; end if;
  execute replace(v_def, v_old, v_new);

  v_def := pg_get_functiondef('private.task_outcome_error(public.clinical_tasks,uuid,jsonb)'::regprocedure);
  if position('v_at >= t.created_at and' in v_def) = 0 then raise exception 'S16-S20 fixes: task_outcome_error no longer contains the attempt date check; not rewriting'; end if;
  execute replace(v_def, 'v_at >= t.created_at and', 'v_at >= t.created_at - private.contact_attempt_lookback() and');
end $$;
revoke all on function public.queue_complete(uuid, jsonb) from public, anon;
grant execute on function public.queue_complete(uuid, jsonb) to authenticated;
revoke all on function private.task_outcome_error(public.clinical_tasks, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Cron: off the shared minutes. In use: */5 offsets 0 to 4, */10 offsets 1 and 2, daily 06:00 to 06:40 in many slots.
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.alter_job((select jobid from cron.job where jobname = 'queue-watchdog'), schedule := '14-59/10 * * * *');
  perform cron.alter_job((select jobid from cron.job where jobname = 'queue-backlog-digest'), schedule := '27 6 * * *');   -- 07:27 in Lagos
end $$;

-- ---------------------------------------------------------------------------
-- 3. The watchdog watches itself
-- ---------------------------------------------------------------------------
-- The watchdog runs every 10 minutes now; 25 minutes without a finished run is stale. (A cron cadence, not a clinical number.)
create or replace function private.queue_stale_jobs() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('job', j.job, 'last_run_at', j.last_run_at, 'max_age_minutes', j.max_age) order by j.job), '[]'::jsonb)
    from (
      select h.job_name as job, h.last_run_at, m.v::integer as max_age
        from public.queue_job_heartbeats h
        join (select key as k, value #>> '{}' as v from jsonb_each(private.task_layer_setting('watchdog') -> 'job_max_age_minutes')) m on m.k = h.job_name
      union all
      select h.job_name, h.last_run_at, 25
        from public.queue_job_heartbeats h where h.job_name = 'queue-watchdog'
    ) j
   where j.last_run_at < now() - make_interval(mins => j.max_age);
$$;
revoke all on function private.queue_stale_jobs() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. A withdrawn task: tell the claimant, and let the page say so
-- ---------------------------------------------------------------------------
-- Restates the S16 body (20261006014107) with the notice.
create or replace function public.cancel_clinical_task(p_task uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare t public.clinical_tasks%rowtype;
begin
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can cancel a task' using errcode = '42501'; end if;
  select * into t from public.clinical_tasks where id = p_task;
  if not found then raise exception 'unknown task' using errcode = '22023'; end if;
  perform private.apply_task_transition(p_task, 'cancelled', 'lead', (select auth.uid()), p_reason);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (t.organisation_id, (select auth.uid()), 'clinical_task.cancelled', 'clinical_task', t.id,
          jsonb_build_object('reason', btrim(p_reason), 'from_state', t.state), t.patient_id);
  -- the clinician who was working on it hears so, without the reason, the patient or anything clinical (INV-07)
  if t.state = 'claimed' and t.claimed_by is not null then
    insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, source_table, source_id)
    values (t.claimed_by, t.organisation_id, 'in_app', 'task_withdrawn_notice', jsonb_build_object('task_id', t.id), 'pending', 'non_clinical', 'clinical_tasks', t.id);
  end if;
end;
$$;
revoke all on function public.cancel_clinical_task(uuid, text) from public, anon;
grant execute on function public.cancel_clinical_task(uuid, text) to authenticated;

-- What happened to a task I was working on: 'withdrawn', 'completed', 'returned' (back in the queue) or null (never mine). Reads only
-- the caller's own claims, so it cannot be used to look at anyone else's work.
create function public.my_task_outcome(p_task uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select case ct.state when 'cancelled' then 'withdrawn' when 'completed' then 'completed' else 'returned' end
    from public.task_claims k join public.clinical_tasks ct on ct.id = k.task_id
   where k.task_id = p_task and k.clinician_id = (select auth.uid()) and ct.state not in ('claimed')
   order by k.claimed_at desc limit 1;
$$;
revoke all on function public.my_task_outcome(uuid) from public, anon;
grant execute on function public.my_task_outcome(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Escalation flood: one follow-up instead of a push and an email per task
-- ---------------------------------------------------------------------------
-- Restates 20261014222123's body. Every escalation still writes its own in-app row for the clinical lead (and the task still shows in
-- queue_escalated_overview); only the push and email beyond the first, inside the window, are folded into a count.
create or replace function private.notify_task_escalated(p_task uuid, p_transition uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.clinical_tasks%rowtype;
  cfg jsonb := private.task_layer_setting('escalation_alert');
  r record;
  v_immediate boolean;
  v_channels jsonb;
  v_ch text;
  v_email text;
  v_n integer := 0;
  v_recent boolean;
  v_pending uuid;
begin
  select * into t from public.clinical_tasks where id = p_task;
  if not found then return; end if;
  -- the more urgent of the original and the current class decides the tier
  v_immediate := least(t.priority_class, t.priority_class_original) <= (cfg ->> 'immediate_max_class')::integer;
  v_channels := case when v_immediate then cfg -> 'immediate_channels' else cfg -> 'notice_channels' end;
  for r in
    select cs.profile_id from public.clinical_staff cs join public.profiles p on p.id = cs.profile_id
     where cs.organisation_id = t.organisation_id and cs.profile_id is not null and cs.active and cs.status = 'active'
       and cs.doctor_tier = 'chief_medical_officer' and p.is_active and p.is_test = t.is_test
  loop
    v_n := v_n + 1;
    -- has this person already been pushed or emailed an immediate alert inside the window?
    v_recent := v_immediate and exists (
      select 1 from public.notifications n
       where n.recipient_id = r.profile_id and n.template = 'task_escalation_alert' and n.channel <> 'in_app'
         and n.created_at > now() - private.escalation_coalesce_window());
    for v_ch in select jsonb_array_elements_text(v_channels) loop
      if v_ch = 'email' then
        select u.email into v_email from auth.users u where u.id = r.profile_id;
        continue when v_email is null;
      else
        v_email := null;
      end if;
      if v_recent and v_ch <> 'in_app' then
        -- fold into one follow-up per channel that has not gone out yet
        select n.id into v_pending from public.notifications n
         where n.recipient_id = r.profile_id and n.template = 'task_escalation_more' and n.channel = v_ch::public.notification_channel
           and n.status = 'pending' and n.created_at > now() - private.escalation_coalesce_window()
         order by n.created_at desc limit 1 for update;
        if found then
          update public.notifications set payload = jsonb_set(payload, '{count}', to_jsonb(coalesce((payload ->> 'count')::integer, 1) + 1)) where id = v_pending;
        else
          insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table)
          values (r.profile_id, t.organisation_id, v_ch::public.notification_channel, 'task_escalation_more',
                  jsonb_strip_nulls(jsonb_build_object('count', 1, 'to_email', v_email)), 'pending', 'non_clinical', 'critical', 'clinical_tasks');
        end if;
      else
        insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
        values (r.profile_id, t.organisation_id, v_ch::public.notification_channel,
                case when v_immediate then 'task_escalation_alert' else 'queue_backlog_notice' end,
                jsonb_strip_nulls(jsonb_build_object('task_id', t.id, 'to_email', v_email)),
                'pending', 'non_clinical', case when v_immediate then 'critical' else 'routine' end::public.notification_priority,
                'clinical_tasks', t.id);
      end if;
    end loop;
  end loop;
  if v_n = 0 and not t.is_test then
    -- nobody to tell is itself a problem, not a quiet success (a test task never raises a real incident)
    if not exists (select 1 from public.ops_incidents where external_reference = 'task_escalation_no_cmo' and status not in ('resolved', 'closed')) then
      insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
      values (t.organisation_id, 'clinical', 'sev1', 'A clinical task escalated and nobody could be told',
              'A task escalated but no active Chief Medical Officer account matched to be alerted. Add or activate one, then review the escalated tasks.',
              'task_escalation_no_cmo', now(), now());
    end if;
  end if;
  insert into public.audit_log (organisation_id, action, entity_type, entity_id, event, subject_patient_id)
  values (t.organisation_id, 'clinical_task.escalation_notified', 'clinical_task', t.id,
          jsonb_build_object('transition_id', p_transition, 'tier', case when v_immediate then 'immediate' else 'notice' end, 'recipients', v_n), t.patient_id);
exception when others then
  -- never let a failure to notify undo the escalation; make the failure loud instead
  insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
  values (t.organisation_id, 'clinical_task.escalation_notify_failed', 'clinical_task', p_task, jsonb_build_object('error', sqlerrm));
  if not exists (select 1 from public.ops_incidents where external_reference = 'task_escalation_notify_failed' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (t.organisation_id, 'technical', 'sev1', 'Telling the clinical lead about an escalated task failed',
            'private.notify_task_escalated raised an error; see audit_log action clinical_task.escalation_notify_failed. Review the escalated tasks by hand.',
            'task_escalation_notify_failed', now(), now());
  end if;
end;
$$;
revoke all on function private.notify_task_escalated(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if position('c.expires_at <= now()' in pg_get_functiondef('public.queue_complete(uuid,jsonb)'::regprocedure)) > 0 then
    raise exception 'S16-S20 fixes: queue_complete still refuses a lapsed lease';
  end if;
  if (select schedule from cron.job where jobname = 'queue-watchdog') <> '14-59/10 * * * *' or (select schedule from cron.job where jobname = 'queue-backlog-digest') <> '27 6 * * *' then
    raise exception 'S16-S20 fixes: a cron schedule was not moved';
  end if;
  if has_function_privilege('anon', 'public.my_task_outcome(uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.cancel_clinical_task(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.escalation_coalesce_window()', 'EXECUTE') then
    raise exception 'S16-S20 fixes: a function is callable by the wrong role';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.my_task_outcome(uuid)'::regprocedure and a.grantee = 0) then
    raise exception 'S16-S20 fixes: PUBLIC can execute my_task_outcome';
  end if;
end $$;
