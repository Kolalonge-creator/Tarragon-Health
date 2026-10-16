-- Task queue gaps OQ-432, OQ-433 and OQ-435 (raised by the S16-S20 task layer, docs/OPEN-QUESTIONS.md).
--
--   OQ-432  The symptom checker's "a human must look at this" outcome (clinician_review_required on a routine or self-care
--           result) raised a clinician_alerts review alert and no task, and nothing produced a `symptom_review` task from it.
--           The OQ recommendation (b) is built: for a patient whose plan includes doctor time the review is ONE
--           `symptom_review` task (dedup key symptom_triage:<patient>:<complaint>, so a repeat merges instead of piling up),
--           and the alert is not raised beside it. The alert is raised exactly as before when (i) the patient is on Free
--           (private.patient_may_page_doctor false: Free keeps today's behaviour, no doctor task for Free) and (ii) the task could
--           not be made (audit_log symptom_triage.task_error + an ops incident, and the alert is the fallback), so a review is
--           never dropped. Urgent and emergency outcomes are untouched (their own alert / emergency event). The rule-set
--           triage path (create_tasks_from_triage_event) already skips shadow events and Free patients and is unchanged; this
--           producer sits on the assessment table, which has no shadow concept, and is gated by symptom_checker_enabled.
--           symptom_triage_assessments gains clinician_review_task_id (the alert id column stays for the Free/fallback case).
--   OQ-433  `pharmacy_flag_review` always requires the `prescribing` competency (recommendation (a)); `admin_clinical` requires it
--           for the prescription subtype only (dedup key prescription: or repeat_prescription:), which no producer makes today.
--           Held in private.task_extra_competencies(), a PROPOSED code constant like private.contact_attempt_lookback(), not a
--           task_types change: the task_types rows, their confirmation state and the CMO's pack are untouched.
--   OQ-435  create_clinical_task no longer offers a task to a lead (or pushes it to an employed doctor) who lacks a competency
--           the task requires: the lead is skipped, the task goes to the next route (a competent pushed doctor, else the pool),
--           and the transition reason says why ("... (lead not offered: lacks prescribing)").
--
-- Live counts on 2026-10-16 (read before writing; project koiplnmbgnqnbywhpjlf): open clinical_tasks = 1 (an escalated
-- amber_bp_review, requires hypertension, not touched); open pharmacy_flag_review = 0; open admin_clinical = 0;
-- prescription_pharmacy_flags = 0; symptom_triage_assessments = 0; symptom_reviews = 0; lead_assignments = 0. So no open task
-- is stranded and no row is converted. A task keeps the competencies stored on it when it was made; this change applies to tasks
-- made after it. (A repeat flag merging into a live task made before this change would not gain `prescribing`; there are none.)
-- Live prescribing holders: 1 clinician. A new pharmacy flag task can be claimed only by a holder; with none on shift it waits in
-- the pool and, past its due time, escalates to the Chief Medical Officer like any unclaimable task (D2). That is the intent of (a).
--
-- Restated bodies, each the LIVE body (pg_get_functiondef on 2026-10-16, md5 checked) with only the changes above:
--   private.create_clinical_task            md5 c335f99e70bf7ea6de9c3a420a106726 (= 20261014235641 section 2)
--   private.pick_employed_clinician_for     md5 99e468de6a5cd441d313904bd556bb8d (becomes a wrapper over the new competent picker)
--   private.handle_symptom_triage_assessment md5 f09f4630cc4d96838886491690c6b55e (= 20260829095025)
-- Overloads: no function gains a second signature (pick_employed_clinician_for keeps its 3-argument form; the competent picker has a
-- different name), so no existing bare-literal call becomes ambiguous.
-- Nothing here confirms a task type, signs, or approves anything (the CMO's act).

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------
create function private.clinician_missing_competencies(p_profile uuid, p_required text[]) returns text[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(r order by r), '{}'::text[])
    from unnest(coalesce(p_required, '{}'::text[])) r
   where r <> all (coalesce((
           select array_agg(cc.competency_code)
             from public.clinical_staff cs
             join public.clinician_competencies cc on cc.clinical_staff_id = cs.id and cc.revoked_at is null
            where cs.profile_id = p_profile), '{}'::text[]));
$$;
revoke all on function private.clinician_missing_competencies(uuid, text[]) from public, anon, authenticated;

create function private.task_extra_competencies(p_type text, p_dedup_key text) returns text[]
language sql immutable set search_path = ''
as $$
  -- PROPOSED (OQ-433, CMO to confirm): a code constant until the next version of the queue.task_layer pack carries it.
  select case
    when p_type = 'pharmacy_flag_review' then array['prescribing']::text[]
    when p_type = 'admin_clinical' and coalesce(p_dedup_key, '') ~ '^(repeat_)?prescription:' then array['prescribing']::text[]
    else '{}'::text[]
  end;
$$;
revoke all on function private.task_extra_competencies(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. OQ-435: the employed-doctor picker can be told what the task requires
-- ---------------------------------------------------------------------------
create or replace function private.pick_employed_clinician_competent(p_org uuid, p_min public.doctor_tier, p_patient uuid, p_required text[])
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select cs.profile_id
    from public.clinical_staff cs
   where cs.organisation_id = p_org and cs.active and cs.status = 'active' and cs.profile_id is not null
     and cs.employment_type = 'employed'
     and cs.doctor_tier is not null
     and private.doctor_tier_rank(cs.doctor_tier) >= private.doctor_tier_rank(p_min)
     and private.clinician_is_eligible(cs.profile_id)
     and not private.clinician_on_leave(cs.profile_id)
     and not private.clinician_in_post_call_rest(cs.profile_id)
     and not private.has_conflict(cs.profile_id, p_patient)
     and coalesce(array_length(private.clinician_missing_competencies(cs.profile_id, p_required), 1), 0) = 0
   order by private.clinician_deprioritised_now(cs.profile_id),
            (select count(*) from public.clinical_tasks ct
              where ct.pushed_to = cs.profile_id and ct.state in ('offered_to_lead', 'open', 'claimed', 'escalated')),
            cs.profile_id
   limit 1;
$function$;

create or replace function private.pick_employed_clinician_for(p_org uuid, p_min public.doctor_tier, p_patient uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.pick_employed_clinician_competent(p_org, p_min, p_patient, '{}'::text[]);
$function$;

revoke all on function private.pick_employed_clinician_competent(uuid, public.doctor_tier, uuid, text[]) from public, anon, authenticated;
revoke all on function private.pick_employed_clinician_for(uuid, public.doctor_tier, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. OQ-433 + OQ-435: create_clinical_task
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.create_clinical_task(p_patient uuid, p_type text, p_due_minutes integer DEFAULT NULL::integer, p_dedup_key text DEFAULT NULL::text, p_triage_event uuid DEFAULT NULL::uuid, p_rule_set_version integer DEFAULT NULL::integer, p_source_event uuid DEFAULT NULL::uuid, p_extra_competencies text[] DEFAULT '{}'::text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ty public.task_types%rowtype;
  pr public.profiles%rowtype;
  v_due timestamptz;
  v_id uuid;
  v_existing public.clinical_tasks%rowtype;
  v_lead uuid;
  v_push uuid;
  v_window_ends timestamptz;
  v_frac numeric := (private.task_layer_setting('lead_window_cap_fraction') #>> '{}')::numeric;
  v_cap_minutes integer;
  v_new_due timestamptz;
  v_req text[];
  v_missing text[];
  v_skip text;
begin
  if v_frac is null then raise exception 'queue_task_layer_config has no active row' using errcode = 'P0001'; end if;
  select * into ty from public.task_types where code = p_type and is_active;
  if not found or not ty.creatable then raise exception 'unknown or non-creatable task type %', p_type using errcode = '22023'; end if;
  select * into pr from public.profiles where id = p_patient and role = 'patient';
  if not found then raise exception 'unknown patient' using errcode = '22023'; end if;
  v_due := now() + make_interval(mins => coalesce(p_due_minutes, ty.default_due_minutes));

  -- A repeat trigger merges into the live task; the merge is counted and a tighter due time wins. Never dropped silently.
  if p_dedup_key is not null then
    -- A task already claimed is being worked on without the new information, so a repeat must not vanish into it:
    -- it becomes a follow-up task under its own key (a further repeat merges into that one, or into the next).
    loop
      select * into v_existing from public.clinical_tasks
       where dedup_key = p_dedup_key and state not in ('completed', 'cancelled') for update;
      exit when not found or v_existing.state <> 'claimed';
      p_dedup_key := p_dedup_key || '+';
    end loop;
    if found then
      v_new_due := case when coalesce((private.queue_setting('dedup_tightens_due'))::boolean, true) then least(v_existing.due_at, v_due) else v_existing.due_at end;
      perform set_config('tarragon.task_transition', 'on', true);
      -- D9: a tighter due time tightens an offer still running, by the same fraction of the task's own life
      update public.clinical_tasks set merged_count = merged_count + 1, due_at = v_new_due,
             lead_window_ends_at = case when state = 'offered_to_lead' and lead_window_ends_at is not null
                                        then least(lead_window_ends_at, created_at + (v_new_due - created_at) * v_frac)
                                        else lead_window_ends_at end
       where id = v_existing.id;
      perform set_config('tarragon.task_transition', 'off', true);
      return v_existing.id;
    end if;
  end if;

  -- OQ-433: what the task requires is the type's list, the producer's extras, and the type's prescription subtype rule.
  v_req := (select coalesce(array_agg(distinct x order by x), '{}')
              from unnest(ty.required_competencies || coalesce(p_extra_competencies, '{}') || private.task_extra_competencies(ty.code, p_dedup_key)) x);

  perform set_config('tarragon.task_transition', 'on', true);
  insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id,
      source_event_id, triage_event_id, rule_set_version, required_competencies, min_tier, due_at, dedup_key, is_test)
  values (pr.organisation_id, ty.code, ty.version, ty.priority_class, ty.priority_class, p_patient,
      p_source_event, p_triage_event, p_rule_set_version,
      v_req,
      ty.min_doctor_tier, v_due, p_dedup_key, pr.is_test)
  returning id into v_id;
  perform set_config('tarragon.task_transition', 'off', true);

  insert into public.clinical_task_transitions (organisation_id, task_id, from_state, to_state, actor_kind, reason, is_test)
  values (pr.organisation_id, v_id, null, 'created', 'system', 'created', pr.is_test);
  perform private.emit_domain_event('clinical_task.created', pr.organisation_id,
    jsonb_build_object('task_id', v_id, 'type', ty.code, 'priority_class', ty.priority_class),
    'clinical_task.created:' || v_id, p_patient, 'clinical_task', v_id);

  -- D1: the window is the type's window or a fraction of the time this task has, whichever is shorter. Less than a minute
  -- of window is no window: the task goes straight to the pool.
  v_cap_minutes := floor(least(ty.lead_window_minutes::numeric, v_frac * extract(epoch from (v_due - now())) / 60));

  -- Where it goes first. A red-class task never waits (INV-05).
  if ty.priority_class > 1 and v_cap_minutes >= 1 then
    -- S18 (OQ-111): the patient's lead clinician; care_team_assignment is only the fallback for patients with no lead row.
    select coalesce(
             (select la.clinician_id from public.lead_assignments la where la.patient_id = p_patient and la.state = 'active'),
             (select cta.clinician_id from public.care_team_assignment cta where cta.patient_id = p_patient))
      into v_lead;
    v_window_ends := least(v_due, now() + make_interval(mins => v_cap_minutes));
    -- OQ-435: a lead who lacks a competency the task requires cannot claim it, so the offer would only lapse. Skip the lead and
    -- say why on the transition that follows (the audit trail), then carry on as if there were no lead.
    if v_lead is not null then
      v_missing := private.clinician_missing_competencies(v_lead, v_req);
      if coalesce(array_length(v_missing, 1), 0) > 0 then
        v_skip := 'lead not offered: lacks ' || array_to_string(v_missing, ', ');
        v_lead := null;
      end if;
    end if;
    -- S18 (OQ-112): working hours and post-call rest for contracted clinicians; never offered to a conflicted clinician.
    if v_lead is not null
       and private.clinician_offerable(v_lead, now(), v_window_ends)
       and not private.has_conflict(v_lead, p_patient)
       and exists (select 1 from public.clinical_staff cs where cs.profile_id = v_lead and cs.doctor_tier is not null
                    and private.doctor_tier_rank(cs.doctor_tier) >= private.doctor_tier_rank(ty.min_doctor_tier)) then
      perform set_config('tarragon.task_transition', 'on', true);
      update public.clinical_tasks set lead_clinician_id = v_lead, lead_window_ends_at = v_window_ends where id = v_id;
      if exists (select 1 from public.clinical_staff cs where cs.profile_id = v_lead and cs.employment_type = 'employed') and ty.pushable then
        update public.clinical_tasks set delivery_path = 'push', pushed_to = v_lead where id = v_id;
      end if;
      perform set_config('tarragon.task_transition', 'off', true);
      perform private.apply_task_transition(v_id, 'offered_to_lead', 'system', null, 'offered to the named clinician');
      return v_id;
    end if;
    if ty.pushable then
      v_push := private.pick_employed_clinician_competent(pr.organisation_id, ty.min_doctor_tier, p_patient, v_req);
      if v_push is not null then
        perform set_config('tarragon.task_transition', 'on', true);
        update public.clinical_tasks set delivery_path = 'push', pushed_to = v_push, lead_window_ends_at = v_window_ends where id = v_id;
        perform set_config('tarragon.task_transition', 'off', true);
        perform private.apply_task_transition(v_id, 'offered_to_lead', 'system', null, 'pushed to an employed doctor' || coalesce(' (' || v_skip || ')', ''));
        return v_id;
      end if;
    end if;
  end if;
  perform private.apply_task_transition(v_id, 'open', 'system', null, 'to the pool' || coalesce(' (' || v_skip || ')', ''));
  return v_id;
end;
$function$;

revoke all on function private.create_clinical_task(uuid, text, integer, text, uuid, integer, uuid, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. OQ-432: the symptom checker's review becomes one task
-- ---------------------------------------------------------------------------
alter table public.symptom_triage_assessments
  add column clinician_review_task_id uuid references public.clinical_tasks (id) on delete set null;
create index symptom_triage_assessments_review_task_idx on public.symptom_triage_assessments (clinician_review_task_id)
  where clinician_review_task_id is not null;
comment on column public.symptom_triage_assessments.clinician_review_task_id is
  'OQ-432: the symptom_review task that carries a requested clinician review for a patient whose plan includes doctor time. Null with clinician_review_alert_id set means Free or the task could not be made.';

CREATE OR REPLACE FUNCTION private.handle_symptom_triage_assessment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pathway_label text;
  v_has_escalation_access boolean;
  v_emergency_event_id uuid;
  v_clinician_alert_id uuid;
  v_review_alert_id uuid;
  v_review_task uuid;
begin
  select elem->>'label' into v_pathway_label
  from jsonb_array_elements(
    (select config from public.triage_protocols where version = new.protocol_version) -> 'pathways'
  ) as elem
  where elem->>'key' = new.presenting_complaint_key
  limit 1;

  v_pathway_label := coalesce(v_pathway_label, new.presenting_complaint_key);

  if new.category = 'emergency' then
    insert into public.emergency_events
      (organisation_id, patient_id, source, trigger_detail, status, logged_by_profile_id)
    values (
      new.organisation_id, new.patient_id, 'symptom_triage',
      format('Symptom triage (%s): %s', v_pathway_label, new.rationale),
      'active', new.logged_by_profile_id
    )
    returning id into v_emergency_event_id;
    new.emergency_event_id := v_emergency_event_id;

  elsif new.category = 'urgent' then
    v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');
    if v_has_escalation_access then
      insert into public.clinician_alerts
        (organisation_id, patient_id, level, status, type_code, title, detail, sla_due_at)
      values (
        new.organisation_id, new.patient_id, 'urgent_escalation', 'open', 'symptom_escalation',
        format('Symptom triage: %s (urgent)', v_pathway_label),
        format('Symptom triage engine classified a %s assessment as needing prompt clinical assessment. %s',
               v_pathway_label, new.rationale),
        now() + (private.escalation_sla_minutes('symptom_triage', 'urgent_escalation') * interval '1 minute')
      )
      returning id into v_clinician_alert_id;
      new.clinician_alert_id := v_clinician_alert_id;
    else
      perform private.raise_dangerous_reading_ai_suggestion(
        new.organisation_id, new.patient_id, v_pathway_label, 'Needs prompt attention',
        format('Based on what you told us about your %s, this is best checked by a clinician soon — please seek care if it does not settle quickly.', v_pathway_label)
      );
    end if;
  end if;

  -- §37.9: force a human look on a genuinely uncertain classification, but
  -- don't pile a second alert onto a case that already put a human in
  -- front of it (emergency/urgent already did, above).
  --
  -- OQ-432: for a patient whose plan includes doctor time the review is ONE symptom_review task in the queue, not a task and an alert
  -- beside it (the P5 parallel-paging problem). The alert is still raised when the patient is on Free (no doctor task for Free;
  -- behaviour unchanged) and whenever the task cannot be made, so a review is never dropped.
  if new.clinician_review_required and new.category in ('routine', 'self_management') then
    if private.patient_may_page_doctor(new.patient_id) then
      begin
        v_review_task := private.create_clinical_task(new.patient_id, 'symptom_review', null,
          'symptom_triage:' || new.patient_id || ':' || new.presenting_complaint_key);
        new.clinician_review_task_id := v_review_task;
      exception when others then
        v_review_task := null;
        new.clinician_review_task_id := null;
        -- the record of the failure must never stop the review alert below, so each write is its own best-effort step, loudly logged
        begin
          insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
          values (new.organisation_id, null, 'symptom_triage.task_error', 'symptom_triage_assessment', new.id,
                  jsonb_build_object('sqlstate', sqlstate, 'error', sqlerrm, 'fallback', 'clinician_review alert'));
        exception when others then
          raise warning 'symptom_triage: the task failure could not be audited (%): %', sqlstate, sqlerrm;
        end;
        begin
          perform private.page_incident_sev(new.organisation_id, 'symptom_triage_task_failed:' || new.id, 'sev2',
            'A symptom check review has no task',
            'A symptom check asked for a clinician review and the clinical task could not be made; the review alert was raised instead. See audit_log action symptom_triage.task_error.');
        exception when others then
          raise warning 'symptom_triage: the task failure could not raise an incident (%): %', sqlstate, sqlerrm;
        end;
      end;
    end if;
    if v_review_task is null then
      insert into public.clinician_alerts
        (organisation_id, patient_id, level, status, type_code, title, detail, sla_due_at)
      values (
        new.organisation_id, new.patient_id, 'clinician_review', 'open', 'symptom_escalation',
        format('Symptom triage: %s (review requested)', v_pathway_label),
        format('Symptom triage engine could not confidently classify this %s assessment as routine/self-care — flagged for human review. %s',
               v_pathway_label, new.rationale),
        now() + (private.escalation_sla_minutes('symptom_triage', 'clinician_review') * interval '1 minute')
      )
      returning id into v_review_alert_id;
      new.clinician_review_alert_id := v_review_alert_id;
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function private.handle_symptom_triage_assessment() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Self-check
-- ---------------------------------------------------------------------------
do $$
declare v text;
begin
  if private.task_extra_competencies('pharmacy_flag_review', null) <> array['prescribing'] then raise exception 'FAIL: pharmacy_flag_review does not require prescribing'; end if;
  if private.task_extra_competencies('admin_clinical', 'prescription:abc') <> array['prescribing'] then raise exception 'FAIL: a prescription admin task does not require prescribing'; end if;
  if cardinality(private.task_extra_competencies('admin_clinical', 'mh_handoff:abc')) <> 0 then raise exception 'FAIL: a non-prescription admin task requires prescribing'; end if;
  if cardinality(private.task_extra_competencies('symptom_review', null)) <> 0 then raise exception 'FAIL: symptom_review gained an extra competency'; end if;
  if position('clinician_missing_competencies' in pg_get_functiondef('private.create_clinical_task(uuid,text,integer,text,uuid,integer,uuid,text[])'::regprocedure)) = 0 then
    raise exception 'FAIL: create_clinical_task does not check the lead';
  end if;
  if position('symptom_review' in pg_get_functiondef('private.handle_symptom_triage_assessment()'::regprocedure)) = 0 then
    raise exception 'FAIL: the symptom handler has no task producer';
  end if;
  if (select count(*) from pg_proc where proname = 'pick_employed_clinician_for' and pronamespace = 'private'::regnamespace) <> 1 then
    raise exception 'FAIL: pick_employed_clinician_for has more than one signature';
  end if;
  for v in select unnest(array[
      'private.clinician_missing_competencies(uuid,text[])', 'private.task_extra_competencies(text,text)',
      'private.pick_employed_clinician_competent(uuid,public.doctor_tier,uuid,text[])', 'private.pick_employed_clinician_for(uuid,public.doctor_tier,uuid)',
      'private.create_clinical_task(uuid,text,integer,text,uuid,integer,uuid,text[])', 'private.handle_symptom_triage_assessment()']) loop
    if has_function_privilege('anon', v, 'EXECUTE') or has_function_privilege('authenticated', v, 'EXECUTE') then
      raise exception 'FAIL: % is executable by anon or authenticated', v;
    end if;
  end loop;
  -- no task type was touched or sent to the CMO for confirmation by this migration
  if exists (select 1 from public.task_types where code in ('symptom_review', 'pharmacy_flag_review', 'admin_clinical') and needs_confirmation) then
    raise exception 'FAIL: a task type awaits confirmation (this migration must not add one)';
  end if;
end $$;
