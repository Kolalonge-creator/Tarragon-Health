-- S16-S20 hardening, task layer (docs/plans/S16-S20-review-and-build-plan.md section 3 defects D1 D2 D4 D5 D6 D7 D8 D9 D10,
-- CMO decisions 1 to 3 in section 5; design note docs/design/S16-S20-task-layer.md). D3 is the migration before this one.
--
--   D1 + decision 1  The offer window is least(the task type's window, a fraction of the task's own due time). The fraction is
--                    PROPOSED config (`queue.task_layer`, lead_window_cap_fraction 0.5). A lapsed offer returns to open and is
--                    only then escalated if it is also past due. An escalated task that is not red (INV-05) is claimable by any
--                    eligible clinician; red (class 1) is unchanged.
--   D9               A repeat trigger that tightens a task's due time also tightens its offer window.
--   D2 + decision 2  An escalation tells the Chief Medical Officer, from the database, in the same transaction as the
--                    escalation: classes 1 and 2 at once by in-app, push and email (no SMS, no WhatsApp); classes 3 to 9 by an
--                    in-app notice, plus a daily digest. The wording is fixed and neutral (INV-07). Not a bus subscriber, on
--                    purpose: the bus is two asynchronous hops and a deploy-order dependency, and the review found the
--                    page path failing for exactly that reason. A failure to notify is logged and raises an incident.
--   D4 + decision 3  queue_complete needs a coded outcome per task type, checked against the system record where one exists.
--                    Free text stays as a note only. D10: and the claim must still be live.
--   D7               A needs_information or technical_problem hand-back is never re-offered to the same clinician; a task whose
--                    only eligible clinician hands it back escalates instead of stranding.
--   D8               queue_next(p_types) is bound to the caller's declared competencies.
--   D5               A dead-lettered, non-shadow triage.graded delivery raises an ops incident.
--   D6               Heartbeats for the sweep and the expiry job, a watchdog, and a queue_health alert when a class's oldest
--                    open task passes its warning threshold.
--   Producer         A titration_signoff task for every engine-proposed medication change awaiting signature, closed when the
--                    change is signed or rejected. (symptom_review has no producer here: see the design note.)
--
-- Restated bodies (each is the live body with only the changes above): create_clinical_task and sweep_clinical_tasks
-- (20261006014107, 20261006024602), queue_candidates, queue_handback, queue_complete, queue_health (20261006020013),
-- queue_next (20261014235603), queue_summary (20261006183417). Checked by md5 against the live project on 2026-10-14.
--
-- Live counts: task_types and the queue configs are read, never changed (a new config table holds the new values).

-- ---------------------------------------------------------------------------
-- 1. Versioned configuration (PROPOSED values; mirrored as `queue.task_layer` in packages/shared/src/proposed-config)
-- ---------------------------------------------------------------------------
create table public.queue_task_layer_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index queue_task_layer_config_one_active on public.queue_task_layer_config (is_active) where is_active;

-- task-layer-begin
insert into public.queue_task_layer_config (version, is_active, effective_from, rules) values (1, true, '2026-10-14', $json$
{
  "lead_window_cap_fraction": 0.5,
  "escalated_non_red_any_eligible": true,
  "handback_also_excludes_task_for": ["needs_information", "technical_problem"],
  "escalation_alert": {
    "immediate_max_class": 2,
    "immediate_channels": ["in_app", "push", "email"],
    "notice_channels": ["in_app"],
    "digest_channels": ["in_app", "email"]
  },
  "completion": {
    "default_codes": ["completed_action_taken", "completed_no_action_needed", "referred_on", "patient_unreachable_documented"],
    "codes_by_type": {
      "critical_result_review": ["result_released", "contact_attempts_documented"],
      "titration_signoff": ["signed", "amended", "rejected"],
      "pharmacy_flag_review": ["prescription_confirmed", "prescription_amended", "pharmacy_contacted", "prescription_withdrawn"],
      "symptom_review": ["answer_signed"],
      "async_question": ["guidance", "needs_call", "needs_more_information", "answer_signed"],
      "written_question_call": ["call_done"],
      "red_event_unacknowledged": ["acknowledged", "dispositioned"]
    },
    "legacy_kind_types": ["async_question", "written_question_call"],
    "contact_attempts": { "min_attempts": 3, "methods": ["phone_call", "video_call", "in_app_message", "emergency_contact"] },
    "note_max_chars": 1000
  },
  "watchdog": {
    "job_max_age_minutes": { "sweep-clinical-tasks": 5, "expire-task-claims": 5 },
    "class_warning_minutes": { "2": 60, "3": 120, "4": 720, "5": 720, "6": 1440, "7": 720, "8": 1440, "9": 2160 }
  }
}
$json$::jsonb);
-- task-layer-end

create function private.task_layer_setting(p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules -> p_key from public.queue_task_layer_config where is_active; $$;
revoke all on function private.task_layer_setting(text) from public, anon, authenticated;

create function private.try_uuid(p text) returns uuid
language plpgsql immutable set search_path = ''
as $$ begin return p::uuid; exception when others then return null; end; $$;
create function private.try_timestamptz(p text) returns timestamptz
language plpgsql stable set search_path = ''
as $$ begin return p::timestamptz; exception when others then return null; end; $$;
revoke all on function private.try_uuid(text), private.try_timestamptz(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. D1 and D9: create_clinical_task caps the offer window at a fraction of the due time
-- ---------------------------------------------------------------------------
create or replace function private.create_clinical_task(
  p_patient uuid, p_type text, p_due_minutes integer default null, p_dedup_key text default null,
  p_triage_event uuid default null, p_rule_set_version integer default null, p_source_event uuid default null,
  p_extra_competencies text[] default '{}')
returns uuid language plpgsql security definer set search_path = ''
as $$
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

  perform set_config('tarragon.task_transition', 'on', true);
  insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id,
      source_event_id, triage_event_id, rule_set_version, required_competencies, min_tier, due_at, dedup_key, is_test)
  values (pr.organisation_id, ty.code, ty.version, ty.priority_class, ty.priority_class, p_patient,
      p_source_event, p_triage_event, p_rule_set_version,
      (select coalesce(array_agg(distinct c order by c), '{}') from unnest(ty.required_competencies || coalesce(p_extra_competencies, '{}')) c),
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
      v_push := private.pick_employed_clinician_for(pr.organisation_id, ty.min_doctor_tier, p_patient);
      if v_push is not null then
        perform set_config('tarragon.task_transition', 'on', true);
        update public.clinical_tasks set delivery_path = 'push', pushed_to = v_push, lead_window_ends_at = v_window_ends where id = v_id;
        perform set_config('tarragon.task_transition', 'off', true);
        perform private.apply_task_transition(v_id, 'offered_to_lead', 'system', null, 'pushed to an employed doctor');
        return v_id;
      end if;
    end if;
  end if;
  perform private.apply_task_transition(v_id, 'open', 'system', null, 'to the pool');
  return v_id;
end;
$$;
revoke all on function private.create_clinical_task(uuid, text, integer, text, uuid, integer, uuid, text[]) from public, anon, authenticated;

-- Data step: offers already running keep no more than the same fraction of their own life. (A window that is already past
-- is released by the next sweep, one minute away.)
do $$
declare n integer; v_frac numeric := (private.task_layer_setting('lead_window_cap_fraction') #>> '{}')::numeric;
begin
  perform set_config('tarragon.task_transition', 'on', true);
  update public.clinical_tasks
     set lead_window_ends_at = least(lead_window_ends_at, created_at + (due_at - created_at) * v_frac)
   where state = 'offered_to_lead' and lead_window_ends_at is not null
     and lead_window_ends_at > created_at + (due_at - created_at) * v_frac;
  get diagnostics n = row_count;
  perform set_config('tarragon.task_transition', 'off', true);
  raise notice 'S16-S20 D1: shortened % running offer window(s)', n;
end $$;

-- ---------------------------------------------------------------------------
-- 3. D1, D6: the sweep releases lapsed offers first, then escalates what is past due; it leaves a heartbeat
-- ---------------------------------------------------------------------------
create table public.queue_job_heartbeats (
  job_name    text primary key,
  last_run_at timestamptz not null,
  last_result jsonb
);
alter table public.queue_job_heartbeats enable row level security;
alter table public.queue_task_layer_config enable row level security;
create policy queue_job_heartbeats_select on public.queue_job_heartbeats for select to authenticated using (private.task_staff_reader());
create policy queue_task_layer_config_select on public.queue_task_layer_config for select to authenticated using (private.task_staff_reader());
revoke all on public.queue_job_heartbeats, public.queue_task_layer_config from anon, public, authenticated;
grant select on public.queue_job_heartbeats, public.queue_task_layer_config to authenticated;
-- start the clocks now, so the watchdog does not raise an alarm for a job that has simply not run since this migration
insert into public.queue_job_heartbeats (job_name, last_run_at, last_result) values
  ('sweep-clinical-tasks', now(), null), ('expire-task-claims', now(), null), ('queue-watchdog', now(), null);

create function private.queue_heartbeat(p_job text, p_result jsonb default null) returns void
language sql security definer set search_path = ''
as $$
  insert into public.queue_job_heartbeats (job_name, last_run_at, last_result) values (p_job, now(), p_result)
  on conflict (job_name) do update set last_run_at = excluded.last_run_at, last_result = excluded.last_result;
$$;
revoke all on function private.queue_heartbeat(text, jsonb) from public, anon, authenticated;

create or replace function private.sweep_clinical_tasks() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_released integer := 0;
  v_promoted integer := 0;
  v_escalated integer := 0;
  v_errors integer := 0;
  v_window integer := coalesce((private.queue_setting('class3_promotion_window_minutes'))::integer, 240);
  v_grace integer := coalesce((private.queue_setting('escalate_after_due_minutes'))::integer, 0);
begin
  -- Each task is handled in its own block: one that fails is recorded and skipped, never allowed to stop the rest
  -- (an escalation sweep that aborts on one bad row would silently stop paging for everyone behind it).
  -- D1: a lapsed offer goes back to the pool first. Only a task that is then still past due is escalated.
  for r in select id, organisation_id from public.clinical_tasks where state = 'offered_to_lead' and lead_window_ends_at <= now() loop
    begin
      perform private.apply_task_transition(r.id, 'open', 'system', null, 'offer window ended');
      v_released := v_released + 1;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'sweep_clinical_tasks: releasing % failed: %', r.id, sqlerrm;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (r.organisation_id, 'clinical_task_sweep.error', 'clinical_task', r.id, jsonb_build_object('step', 'release', 'error', sqlerrm));
    end;
  end loop;
  for r in select id, organisation_id from public.clinical_tasks
            where state in ('offered_to_lead', 'open') and due_at <= now() - make_interval(mins => v_grace) loop   -- sargable form (SR2d)
    begin
      perform private.apply_task_transition(r.id, 'escalated', 'system', null, 'past due');
      v_escalated := v_escalated + 1;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'sweep_clinical_tasks: escalating % failed: %', r.id, sqlerrm;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (r.organisation_id, 'clinical_task_sweep.error', 'clinical_task', r.id, jsonb_build_object('step', 'escalate', 'error', sqlerrm));
    end;
  end loop;
  -- amber reviews within the window of their due time move up to class 3, once
  for r in select id, organisation_id from public.clinical_tasks
            where type = 'amber_bp_review' and priority_class = 4 and priority_class_original = 4
              and state in ('offered_to_lead', 'open', 'claimed')
              and due_at <= now() + make_interval(mins => v_window) loop
    begin
      perform set_config('tarragon.task_transition', 'on', true);
      update public.clinical_tasks set priority_class = 3 where id = r.id;
      perform set_config('tarragon.task_transition', 'off', true);
      insert into public.clinical_task_transitions (organisation_id, task_id, from_state, to_state, actor_kind, reason, is_test)
        select organisation_id, id, state, state, 'system', 'moved to priority class 3 (due soon)', is_test from public.clinical_tasks where id = r.id;
      v_promoted := v_promoted + 1;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'sweep_clinical_tasks: promoting % failed: %', r.id, sqlerrm;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (r.organisation_id, 'clinical_task_sweep.error', 'clinical_task', r.id, jsonb_build_object('step', 'promote', 'error', sqlerrm));
    end;
  end loop;
  if v_errors > 0 and not exists (select 1 from public.ops_incidents where external_reference = 'clinical_task_sweep' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values ('technical', 'sev1', 'Clinical task sweep failed for some tasks',
            format('%s task(s) could not be escalated, released or promoted by private.sweep_clinical_tasks(); see audit_log action clinical_task_sweep.error. An overdue task may not have been escalated.', v_errors),
            'clinical_task_sweep', now(), now());
  end if;
  return jsonb_build_object('released', v_released, 'promoted', v_promoted, 'escalated', v_escalated, 'errors', v_errors);
end;
$$;
revoke all on function private.sweep_clinical_tasks() from public, anon, authenticated;

-- The heartbeat is written only when the job ran to the end: a job that raises leaves the old time, and the watchdog sees it.
select cron.schedule('sweep-clinical-tasks', '* * * * *', $$ select private.queue_heartbeat('sweep-clinical-tasks', private.sweep_clinical_tasks()); $$);
select cron.schedule('expire-task-claims', '* * * * *', $$ select private.queue_heartbeat('expire-task-claims', private.expire_task_claims()); $$);

-- ---------------------------------------------------------------------------
-- 4. D1 + D7: who may be offered an escalated task; a hand-back reason that excludes the same clinician
-- ---------------------------------------------------------------------------
create or replace function private.queue_candidates(p_uid uuid, p_only_offered boolean default false)
returns table (id uuid, priority_class smallint, due_at timestamptz, created_at timestamptz, state public.clinical_task_state)
language sql stable security definer set search_path = ''
as $$
  with me as (
    select cs.organisation_id, cs.is_test, private.doctor_tier_rank(cs.doctor_tier) as rank,
           coalesce((select array_agg(cc.competency_code) from public.clinician_competencies cc
                      where cc.clinical_staff_id = cs.id and cc.revoked_at is null), '{}'::text[]) as comps
      from public.clinical_staff cs where cs.profile_id = p_uid
  ),
  -- the settings are read once per call, not once per candidate row
  cfg as (
    select coalesce((private.task_layer_setting('escalated_non_red_any_eligible'))::boolean, false) as escalated_any,
           coalesce((private.claim_setting('escalated_requires_on_call'))::boolean, true) as requires_on_call,
           private.claim_setting('handback_excludes_task_for') as excl_claims,
           private.task_layer_setting('handback_also_excludes_task_for') as excl_layer
  )
  select ct.id, ct.priority_class, ct.due_at, ct.created_at, ct.state
    from public.clinical_tasks ct, me, cfg
   where ct.organisation_id = me.organisation_id
     and ct.is_test = me.is_test
     and ct.patient_id <> p_uid
     and private.doctor_tier_rank(ct.min_tier) <= me.rank
     and ct.required_competencies <@ me.comps
     and (
          (ct.state = 'offered_to_lead' and p_uid in (ct.pushed_to, ct.lead_clinician_id))
       or (not p_only_offered and ct.state = 'open')
       or (not p_only_offered and ct.state = 'escalated'
           and (
                -- D1: an escalated task that is not red is claimable by any eligible clinician
                (ct.priority_class > 1 and ct.priority_class_original > 1 and cfg.escalated_any)
                -- red (INV-05) and everything else keeps the on-call rule
                or not cfg.requires_on_call
                or 'on_call' = any (me.comps)))
     )
     and not exists (select 1 from public.clinician_conflicts c
                      where c.clinician_id = p_uid and c.patient_id = ct.patient_id and c.status <> 'lifted')
     -- D7: the reasons that bar the same clinician from this task again: the S17 list plus the task-layer list
     and not exists (select 1 from public.task_handbacks h
                      where h.task_id = ct.id and h.clinician_id = p_uid
                        and (cfg.excl_claims ? h.reason_code or cfg.excl_layer ? h.reason_code));
$$;
revoke all on function private.queue_candidates(uuid, boolean) from public, anon, authenticated;

-- Whether anyone at all could still take this task: the same rules as queue_candidates, for every clinician in the
-- organisation, without needing a declared queue block (a rota-less clinician is still a person who could be asked).
create function private.task_has_other_candidate(p_task uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.clinical_tasks ct
      join public.clinical_staff cs on cs.organisation_id = ct.organisation_id and cs.is_test = ct.is_test
     where ct.id = p_task
       and cs.active and cs.status = 'active' and cs.profile_id is not null
       and cs.profile_id <> ct.patient_id
       and cs.doctor_tier is not null
       and private.doctor_tier_rank(cs.doctor_tier) >= private.doctor_tier_rank(ct.min_tier)
       and private.clinician_is_eligible(cs.profile_id)
       and ct.required_competencies <@ coalesce((select array_agg(cc.competency_code) from public.clinician_competencies cc
                                                  where cc.clinical_staff_id = cs.id and cc.revoked_at is null), '{}'::text[])
       and not private.has_conflict(cs.profile_id, ct.patient_id)
       and not exists (select 1 from public.task_handbacks h
                        where h.task_id = ct.id and h.clinician_id = cs.profile_id
                          and ((private.claim_setting('handback_excludes_task_for')) ? h.reason_code
                            or (private.task_layer_setting('handback_also_excludes_task_for')) ? h.reason_code))
  );
$$;
revoke all on function private.task_has_other_candidate(uuid) from public, anon, authenticated;

-- D7: after a hand-back whose reason bars the clinician from the task, a task nobody else can take is escalated, not stranded.
-- Restates the S17 body (20261006020013) with the stranded-task rule added after the reliability event.
create or replace function public.queue_handback(p_task uuid, p_reason text, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  c public.task_claims%rowtype;
  t public.clinical_tasks%rowtype;
  v_review jsonb := private.claim_setting('handback_review');
  v_n integer;
  v_name text;
  v_conflict uuid;
  v_excludes boolean;
begin
  if v_uid is null then raise exception 'queue_not_clinician' using errcode = '42501'; end if;
  if p_reason is null or p_reason not in ('conflict_of_interest', 'outside_competence', 'needs_information', 'technical_problem', 'other') then
    raise exception 'queue_bad_reason' using errcode = '22023';
  end if;
  if p_reason = 'other' and char_length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'queue_note_needed' using errcode = '22023';
  end if;
  select * into c from public.task_claims where task_id = p_task and clinician_id = v_uid and ended_at is null for update;
  if not found then raise exception 'queue_no_claim' using errcode = '42501'; end if;
  select * into t from public.clinical_tasks where id = p_task;

  update public.task_claims set ended_at = now(), end_reason = 'handed_back' where id = c.id;
  insert into public.task_handbacks (organisation_id, task_id, claim_id, clinician_id, reason_code, note, is_test)
  values (t.organisation_id, t.id, c.id, v_uid, p_reason, nullif(btrim(p_note), ''), t.is_test);
  perform private.apply_task_transition(t.id, 'open', 'clinician', v_uid, 'handed back: ' || p_reason);

  if p_reason = 'conflict_of_interest' then
    insert into public.clinician_conflicts (organisation_id, clinician_id, patient_id, reason, source, status, declared_by, is_test)
    values (t.organisation_id, v_uid, t.patient_id, coalesce(nullif(btrim(p_note), ''), 'declared when handing a task back'), 'handback', 'pending_review', v_uid, t.is_test)
    on conflict (clinician_id, patient_id) where status <> 'lifted' do nothing
    returning id into v_conflict;
    if v_conflict is not null then
      perform private.emit_domain_event('clinician.conflict_declared', t.organisation_id,
        jsonb_build_object('conflict_id', v_conflict, 'source', 'handback'), 'clinician.conflict_declared:' || v_conflict);
    end if;
  end if;

  perform private.reliability_event(v_uid, t.id, case when p_reason = 'other' then 'handed_back_other' else 'handed_back_reasoned' end);

  -- D7: nobody else can take it, so it must not sit open with no one able to see it
  v_excludes := (private.claim_setting('handback_excludes_task_for')) ? p_reason or (private.task_layer_setting('handback_also_excludes_task_for')) ? p_reason;
  if v_excludes and not private.task_has_other_candidate(t.id) then
    perform private.apply_task_transition(t.id, 'escalated', 'system', null, 'no other eligible clinician after a hand-back');
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
    values (t.organisation_id, v_uid, 'queue.handback_stranded_escalated', 'clinical_task', t.id, jsonb_build_object('reason_code', p_reason), t.patient_id);
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (t.organisation_id, v_uid, 'queue.handback', 'clinical_task', t.id, jsonb_build_object('reason_code', p_reason), t.patient_id);
  perform private.emit_domain_event('clinical_task.handed_back', t.organisation_id,
    jsonb_build_object('task_id', t.id, 'type', t.type, 'reason_code', p_reason),
    'clinical_task.handed_back:' || c.id, t.patient_id, 'clinical_task', t.id);

  -- more than N in D days goes to the clinical lead for review, once per window; it informs a person and changes nothing
  select count(*) into v_n from public.task_handbacks h
   where h.clinician_id = v_uid and h.created_at > now() - make_interval(days => (v_review ->> 'window_days')::integer);
  if v_n > (v_review ->> 'more_than')::integer and not exists (
       select 1 from public.audit_log a
        where a.actor_id = v_uid and a.action = 'queue.handback_review_flagged'
          and a.created_at > now() - make_interval(days => (v_review ->> 'window_days')::integer)) then
    select full_name into v_name from public.clinical_staff where profile_id = v_uid;
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (t.organisation_id, v_uid, 'queue.handback_review_flagged', 'profile', v_uid, jsonb_build_object('handbacks', v_n));
    perform private.emit_domain_event('clinician.handback_review_flagged', t.organisation_id,
      jsonb_build_object('clinician_id', v_uid, 'handbacks', v_n),
      'clinician.handback_review_flagged:' || v_uid || ':' || to_char(now(), 'IYYY-IW'));
    perform private.credential_notify_reviewers(t.organisation_id, 'Hand-backs to review',
      coalesce(v_name, 'A clinician') || ' has handed back ' || v_n || ' tasks in the last ' || (v_review ->> 'window_days') || ' days. Please review how their work is going.',
      jsonb_build_object('clinician_id', v_uid, 'handbacks', v_n));
  end if;
end;
$$;
revoke all on function public.queue_handback(uuid, text, text) from public, anon;
grant execute on function public.queue_handback(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. D8: queue_next(p_types) is bound to what the caller is declared competent in
-- ---------------------------------------------------------------------------
-- Restates 20261014235603 with the p_types intersection. The S22b membership claim filter keeps working: a page that asks
-- for its own types still gets them, if the clinician is competent in them. A type the clinician is not competent in is
-- dropped; if nothing is left, nothing is offered.
create or replace function public.queue_next(p_types text[] default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  cs public.clinical_staff%rowtype;
  t public.clinical_tasks%rowtype;
  ty public.task_types%rowtype;
  v_gate text;
  v_block boolean;
  v_live public.task_claims%rowtype;
  v_n integer;
  v_try integer := 0;
  v_expires timestamptz;
  v_claim uuid;
  v_comps text[];
begin
  if v_uid is null then raise exception 'queue_not_clinician' using errcode = '42501'; end if;
  -- serialises this clinician's own calls (a retry racing the original); other clinicians are not blocked
  select * into cs from public.clinical_staff where profile_id = v_uid for update;
  v_gate := private.queue_gate(v_uid);
  if v_gate is not null then raise exception '%', v_gate using errcode = '42501'; end if;
  update public.clinical_staff set queue_last_seen_at = now() where id = cs.id;

  -- D3: a live claim on a task that is no longer claimed (cancelled, completed) is stale and is ended.
  update public.task_claims k
     set ended_at = now(), end_reason = case when ct.state = 'completed' then 'completed' else 'cancelled' end
    from public.clinical_tasks ct
   where k.task_id = ct.id and k.clinician_id = v_uid and k.ended_at is null and ct.state <> 'claimed';

  -- already holding the cap: a retry over a dropped connection gets the same claim back, never a second task (OQ-D)
  select count(*) into v_n from public.task_claims where clinician_id = v_uid and ended_at is null;
  if v_n >= cs.max_concurrent_claims then
    select k.* into v_live from public.task_claims k join public.clinical_tasks ct on ct.id = k.task_id and ct.state = 'claimed'
     where k.clinician_id = v_uid and k.ended_at is null order by k.claimed_at limit 1;
    select * into t from public.clinical_tasks where id = v_live.task_id;
    return jsonb_build_object('already_claimed', true, 'claim_id', v_live.id, 'claim_expires_at', v_live.expires_at,
      'task', jsonb_build_object('id', t.id, 'type', t.type, 'priority_class', t.priority_class, 'due_at', t.due_at, 'patient_id', t.patient_id));
  end if;

  v_block := private.queue_has_block(v_uid);
  if not v_block and cs.employment_type is distinct from 'employed' then
    raise exception 'queue_no_availability' using errcode = '42501';
  end if;

  -- D8: the caller may narrow the queue to their own page's types, never widen it past their competencies
  if p_types is not null then
    select coalesce(array_agg(cc.competency_code), '{}'::text[]) into v_comps
      from public.clinician_competencies cc where cc.clinical_staff_id = cs.id and cc.revoked_at is null;
    p_types := array(select x from unnest(p_types) x
                      where exists (select 1 from public.task_types tt
                                     where tt.code = x and tt.is_active and tt.required_competencies <@ v_comps
                                       and private.doctor_tier_rank(tt.min_doctor_tier) <= private.doctor_tier_rank(cs.doctor_tier)));
    if cardinality(p_types) = 0 then
      return jsonb_build_object('already_claimed', false, 'task', null, 'reason', 'none_eligible');
    end if;
  end if;

  -- Up to three tries: a row another clinician claimed between our read and our lock is re-checked by the lock
  -- clause on the task itself and skipped, but LIMIT can then return nothing while other eligible rows remain.
  while v_try < 3 loop
    v_try := v_try + 1;
    select ct.* into t
      from public.clinical_tasks ct
      join private.queue_candidates(v_uid, not v_block) c on c.id = ct.id
     where ct.state in ('offered_to_lead', 'open', 'escalated')
       and (p_types is null or ct.type = any(p_types))
     order by c.priority_class, (c.state <> 'offered_to_lead'), c.due_at, c.created_at
     limit 1
       for update of ct skip locked;
    exit when found;
    exit when not exists (select 1 from private.queue_candidates(v_uid, not v_block) c2
                           join public.clinical_tasks ct2 on ct2.id = c2.id where p_types is null or ct2.type = any(p_types));
  end loop;
  if t.id is null then
    return jsonb_build_object('already_claimed', false, 'task', null, 'reason', 'none_eligible');
  end if;

  select * into ty from public.task_types where code = t.type and version = t.task_type_version;
  v_expires := now() + make_interval(mins => ty.claim_timeout_minutes);
  perform private.apply_task_transition(t.id, 'claimed', 'clinician', v_uid, 'claimed', v_uid, v_expires);
  insert into public.task_claims (organisation_id, task_id, clinician_id, expires_at, is_test)
  values (t.organisation_id, t.id, v_uid, v_expires, t.is_test) returning id into v_claim;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (t.organisation_id, v_uid, 'queue.claim', 'clinical_task', t.id,
          jsonb_build_object('type', t.type, 'priority_class', t.priority_class, 'claim_id', v_claim), t.patient_id);
  perform private.emit_domain_event('clinical_task.claimed', t.organisation_id,
    jsonb_build_object('task_id', t.id, 'type', t.type, 'priority_class', t.priority_class),
    'clinical_task.claimed:' || v_claim, t.patient_id, 'clinical_task', t.id);

  return jsonb_build_object('already_claimed', false, 'claim_id', v_claim, 'claim_expires_at', v_expires,
    'task', jsonb_build_object('id', t.id, 'type', t.type, 'priority_class', t.priority_class, 'due_at', t.due_at, 'patient_id', t.patient_id));
end;
$$;
revoke all on function public.queue_next(text[]) from public, anon;
grant execute on function public.queue_next(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. D4 + D10: a coded, system-checked outcome per task type; the claim must still be live
-- ---------------------------------------------------------------------------
create function private.task_outcome_code(p_type text, p_outcome jsonb) returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    nullif(btrim(p_outcome ->> 'code'), ''),
    case when (private.task_layer_setting('completion') -> 'legacy_kind_types') ? p_type then nullif(btrim(p_outcome ->> 'kind'), '') end);
$$;
revoke all on function private.task_outcome_code(text, jsonb) from public, anon, authenticated;

-- null when the outcome is acceptable, otherwise the stable error code. Reads the system record only; writes nothing.
create function private.task_outcome_error(t public.clinical_tasks, p_uid uuid, p_outcome jsonb) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  cfg jsonb := private.task_layer_setting('completion');
  v_code text := private.task_outcome_code(t.type, p_outcome);
  v_allowed jsonb := coalesce(cfg -> 'codes_by_type' -> t.type, cfg -> 'default_codes');
  v_staff uuid;
  v_cid uuid;
  v_src uuid;
  v_min integer := (cfg #>> '{contact_attempts,min_attempts}')::integer;
  v_valid integer;
  a jsonb;
  v_at timestamptz;
begin
  if v_code is null or not (v_allowed ? v_code) then return 'queue_outcome_code'; end if;
  if p_outcome ? 'note' and (jsonb_typeof(p_outcome -> 'note') <> 'string'
       or char_length(p_outcome ->> 'note') > (cfg ->> 'note_max_chars')::integer) then
    return 'queue_outcome_note';
  end if;

  if t.type = 'critical_result_review' then
    if v_code = 'result_released' then
      -- the result this task is about has been released to the patient
      if not exists (select 1 from public.lab_results lr
                      where lr.id = private.try_uuid(substring(t.dedup_key from '^lab_result:([0-9a-fA-F-]{36})'))
                        and lr.patient_id = t.patient_id and lr.release_state = 'released') then
        return 'queue_outcome_result_not_released';
      end if;
    else
      -- a documented sequence of contact attempts: enough of them, each dated, by a permitted method, reached or not
      if jsonb_typeof(p_outcome -> 'attempts') is distinct from 'array' then return 'queue_outcome_attempts'; end if;
      v_valid := 0;
      for a in select x from jsonb_array_elements(p_outcome -> 'attempts') x loop
        -- an ISO date-time only: Postgres would also read 'now' or 'today' as a time
        v_at := case when jsonb_typeof(a) = 'object' and (a ->> 'at') ~ '^\d{4}-\d{2}-\d{2}T' then private.try_timestamptz(a ->> 'at') end;
        if v_at is not null and v_at >= t.created_at and v_at <= now() + interval '5 minutes'
           and (cfg #> '{contact_attempts,methods}') ? coalesce(a ->> 'method', '')
           and jsonb_typeof(a -> 'reached') = 'boolean' then
          v_valid := v_valid + 1;
        end if;
      end loop;
      if v_valid < v_min or v_valid <> jsonb_array_length(p_outcome -> 'attempts') then return 'queue_outcome_attempts'; end if;
      -- three copies of one attempt are one attempt
      if (select count(distinct (x ->> 'at') || '|' || (x ->> 'method')) from jsonb_array_elements(p_outcome -> 'attempts') x) < v_min then
        return 'queue_outcome_attempts';
      end if;
    end if;

  elsif t.type = 'titration_signoff' then
    v_cid := private.try_uuid(p_outcome ->> 'care_plan_change_id');
    v_src := private.try_uuid(substring(t.dedup_key from '^titration:([0-9a-fA-F-]{36})'));
    if v_cid is null then return 'queue_outcome_change'; end if;
    if v_code in ('signed', 'amended') then
      if not exists (select 1 from public.care_plan_changes c
                      where c.id = v_cid and c.patient_id = t.patient_id and c.kind = 'medication'
                        and c.state in ('signed', 'confirmed', 'declined', 'expired')
                        and c.signed_by = p_uid and c.signed_at >= t.claimed_at) then
        return 'queue_outcome_change';
      end if;
      -- "signed" is the proposal the task was made for; "amended" is a different change the clinician signed in its place
      if v_src is not null and ((v_code = 'signed') <> (v_cid = v_src)) then return 'queue_outcome_change'; end if;
    else
      if not exists (select 1 from public.care_plan_changes c
                      where c.id = v_cid and c.patient_id = t.patient_id and c.state = 'rejected'
                        and c.rejected_by = p_uid and c.rejected_at >= t.claimed_at) then
        return 'queue_outcome_change';
      end if;
    end if;

  elsif t.type = 'symptom_review' then
    select id into v_staff from public.clinical_staff where profile_id = p_uid;
    if not exists (select 1 from public.clinical_encounter_notes n
                    where n.id = private.try_uuid(p_outcome ->> 'note_id') and n.patient_id = t.patient_id
                      and n.status = 'finalized' and n.finalized_by_staff = v_staff and n.finalized_at >= t.claimed_at) then
      return 'queue_outcome_note_missing';
    end if;

  elsif t.type = 'async_question' then
    if not exists (select 1 from public.async_consults ac
                    where ac.id = private.try_uuid(p_outcome ->> 'consult_id') and ac.patient_id = t.patient_id
                      and ac.status in ('answered', 'in_review')
                      -- the consult this task is about: its own task, or the follow-up task made for it (dedup async:<consult>:reply)
                      and (ac.task_id = t.id or t.dedup_key like 'async:' || ac.id::text || '%')) then
      return 'queue_outcome_consult';
    end if;

  elsif t.type = 'red_event_unacknowledged' then
    if not exists (select 1 from public.pages pg
                    where pg.id = private.try_uuid(substring(t.dedup_key from '^page:([0-9a-fA-F-]{36})'))
                      and pg.acknowledged_at is not null
                      and (v_code = 'acknowledged' or pg.closed_at is not null)) then
      return 'queue_outcome_page';
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.task_outcome_error(public.clinical_tasks, uuid, jsonb) from public, anon, authenticated;

-- Restates the S17 body (20261006020013) with the lease check (D10) and the outcome check (D4).
create or replace function public.queue_complete(p_task uuid, p_outcome jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  c public.task_claims%rowtype;
  t public.clinical_tasks%rowtype;
  v_err text;
  v_outcome jsonb;
begin
  if v_uid is null then raise exception 'queue_not_clinician' using errcode = '42501'; end if;
  if p_outcome is null or jsonb_typeof(p_outcome) <> 'object' or p_outcome = '{}'::jsonb then
    raise exception 'queue_outcome_needed' using errcode = '22023';
  end if;
  select * into c from public.task_claims where task_id = p_task and clinician_id = v_uid and ended_at is null for update;
  if not found then raise exception 'queue_no_claim' using errcode = '42501'; end if;
  -- D10: a lease that has run out is the sweep's to release, not the clinician's to finish
  if c.expires_at <= now() then raise exception 'queue_claim_expired' using errcode = '42501'; end if;
  select * into t from public.clinical_tasks where id = p_task;
  v_err := private.task_outcome_error(t, v_uid, p_outcome);
  if v_err is not null then raise exception '%', v_err using errcode = '22023'; end if;
  -- system_checked is true only for the types whose outcome was read against a record (see task_outcome_error)
  v_outcome := p_outcome || jsonb_build_object('code', private.task_outcome_code(t.type, p_outcome),
    'system_checked', t.type in ('critical_result_review', 'titration_signoff', 'symptom_review', 'async_question', 'red_event_unacknowledged')
                      and private.task_outcome_code(t.type, p_outcome) is distinct from 'contact_attempts_documented');
  update public.task_claims set ended_at = now(), end_reason = 'completed' where id = c.id;
  perform private.apply_task_transition(t.id, 'completed', 'clinician', v_uid, 'completed', null, null, v_outcome);
  perform private.reliability_event(v_uid, t.id, case when now() <= t.due_at then 'completed_on_time' else 'completed_late' end);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (t.organisation_id, v_uid, 'queue.complete', 'clinical_task', t.id,
          jsonb_build_object('type', t.type, 'outcome_code', v_outcome ->> 'code'), t.patient_id);
  perform private.emit_domain_event('clinical_task.completed', t.organisation_id,
    jsonb_build_object('task_id', t.id, 'type', t.type), 'clinical_task.completed:' || c.id, t.patient_id, 'clinical_task', t.id);
end;
$$;
revoke all on function public.queue_complete(uuid, jsonb) from public, anon;
grant execute on function public.queue_complete(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. D2 + decision 2: an escalation tells the Chief Medical Officer
-- ---------------------------------------------------------------------------
create function private.notify_task_escalated(p_task uuid, p_transition uuid) returns void
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
    for v_ch in select jsonb_array_elements_text(v_channels) loop
      if v_ch = 'email' then
        select u.email into v_email from auth.users u where u.id = r.profile_id;
        continue when v_email is null;
      else
        v_email := null;
      end if;
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
      values (r.profile_id, t.organisation_id, v_ch::public.notification_channel,
              case when v_immediate then 'task_escalation_alert' else 'queue_backlog_notice' end,
              jsonb_strip_nulls(jsonb_build_object('task_id', t.id, 'to_email', v_email)),
              'pending', 'non_clinical', case when v_immediate then 'critical' else 'routine' end::public.notification_priority,
              'clinical_tasks', t.id);
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

create function private.on_task_escalated_transition() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.notify_task_escalated(new.task_id, new.id);
  return new;
end;
$$;
revoke all on function private.on_task_escalated_transition() from public, anon, authenticated;
create trigger clinical_task_transitions_notify_escalated after insert on public.clinical_task_transitions
  for each row when (new.to_state = 'escalated' and new.from_state is distinct from 'escalated')
  execute function private.on_task_escalated_transition();

-- The daily digest: every task that is escalated now, classes below the immediate tier, once a day at 07:00 Lagos time.
create function private.send_queue_backlog_digest() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  cfg jsonb := private.task_layer_setting('escalation_alert');
  r record;
  v_ch text;
  v_email text;
  v_sent integer := 0;
begin
  for r in
    select cs.profile_id, cs.organisation_id, p.is_test
      from public.clinical_staff cs join public.profiles p on p.id = cs.profile_id
     where cs.profile_id is not null and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' and p.is_active
       and exists (select 1 from public.clinical_tasks ct
                    where ct.organisation_id = cs.organisation_id and ct.is_test = p.is_test and ct.state = 'escalated'
                      and least(ct.priority_class, ct.priority_class_original) > (cfg ->> 'immediate_max_class')::integer)
       and not exists (select 1 from public.notifications n
                        where n.recipient_id = cs.profile_id and n.template = 'queue_backlog_digest'
                          and (n.created_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date)
  loop
    for v_ch in select jsonb_array_elements_text(cfg -> 'digest_channels') loop
      if v_ch = 'email' then
        select u.email into v_email from auth.users u where u.id = r.profile_id;
        continue when v_email is null;
      else
        v_email := null;
      end if;
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table)
      values (r.profile_id, r.organisation_id, v_ch::public.notification_channel, 'queue_backlog_digest',
              jsonb_strip_nulls(jsonb_build_object('to_email', v_email)), 'pending', 'non_clinical', 'routine', 'clinical_tasks');
    end loop;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;
revoke all on function private.send_queue_backlog_digest() from public, anon, authenticated;
select cron.schedule('queue-backlog-digest', '0 6 * * *', $$ select private.send_queue_backlog_digest(); $$);   -- 06:00 UTC is 07:00 in Lagos

-- Escalated work, with its age, for the clinical lead's console. Ids and neutral facts only (INV-07).
create function public.queue_escalated_overview() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.task_staff_reader() then raise exception 'not authorised' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'task_id', ct.id, 'type', ct.type, 'priority_class', ct.priority_class, 'due_at', ct.due_at,
             'escalated_at', e.at, 'age_minutes', (extract(epoch from (now() - e.at)) / 60)::integer,
             'escalation_level', ct.escalation_level, 'handback_count', ct.handback_count)
           order by ct.priority_class, e.at)
      from public.clinical_tasks ct
      join lateral (select max(tr.created_at) as at from public.clinical_task_transitions tr
                     where tr.task_id = ct.id and tr.to_state = 'escalated') e on true
     -- the caller's own organisation only: the role check says who may read, not whose
     where ct.state = 'escalated' and not ct.is_test and ct.organisation_id = private.current_org_id()), '[]'::jsonb);
end;
$$;
revoke all on function public.queue_escalated_overview() from public, anon;
grant execute on function public.queue_escalated_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. D5: a dead-lettered, non-shadow triage.graded delivery raises an incident
-- ---------------------------------------------------------------------------
create function private.raise_dead_task_creation_incident() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare e public.domain_events%rowtype;
begin
  select * into e from public.domain_events where id = new.event_id;
  -- a shadow grade creates no work, so losing it loses nothing; an urgent event already raises its own incident (S10)
  if coalesce((e.payload ->> 'shadow')::boolean, false) or e.priority = 'urgent' then return new; end if;
  if not exists (select 1 from public.ops_incidents where external_reference = 'event_bus:' || new.subscriber_key || ':non_urgent' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (new.organisation_id, 'clinical', 'sev2', 'A triage grade could not be turned into a task',
            format('Subscriber %s could not process a triage.graded event (delivery %s). The event is in the dead letter and no task was made for it. Fix the handler, then requeue it with requeue_dead_event_deliveries.',
                   new.subscriber_key, new.id),
            'event_bus:' || new.subscriber_key || ':non_urgent', now(), now());
  end if;
  return new;
exception when others then
  raise warning 'could not open an incident for dead task-creation delivery %: %', new.id, sqlerrm;
  return new;
end;
$$;
revoke all on function private.raise_dead_task_creation_incident() from public, anon, authenticated;
create trigger domain_event_deliveries_dead_task_creation after update of status on public.domain_event_deliveries
  for each row when (new.status = 'dead' and old.status is distinct from 'dead' and new.subscriber_key = 'queue.create_from_triage')
  execute function private.raise_dead_task_creation_incident();

-- ---------------------------------------------------------------------------
-- 9. D6: the watchdog, and queue_health's alert
-- ---------------------------------------------------------------------------
create function private.queue_class_breaches() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('priority_class', x.priority_class, 'oldest_open_minutes', x.mins, 'warn_after_minutes', x.warn)
                            order by x.priority_class), '[]'::jsonb)
    from (select ct.priority_class,
                 (extract(epoch from (now() - min(ct.created_at))) / 60)::integer as mins,
                 (private.task_layer_setting('watchdog') -> 'class_warning_minutes' ->> ct.priority_class::text)::integer as warn
            from public.clinical_tasks ct
           where not ct.is_test and ct.state in ('open', 'escalated')
           group by ct.priority_class) x
   where x.warn is not null and x.mins > x.warn;
$$;
revoke all on function private.queue_class_breaches() from public, anon, authenticated;

create function private.queue_stale_jobs() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('job', h.job_name, 'last_run_at', h.last_run_at, 'max_age_minutes', m.v::integer) order by h.job_name), '[]'::jsonb)
    from public.queue_job_heartbeats h
    join (select key as k, value #>> '{}' as v from jsonb_each(private.task_layer_setting('watchdog') -> 'job_max_age_minutes')) m on m.k = h.job_name
   where h.last_run_at < now() - make_interval(mins => m.v::integer);
$$;
revoke all on function private.queue_stale_jobs() from public, anon, authenticated;

create function private.queue_watchdog() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare b jsonb; j jsonb; x jsonb; v_ref text;
begin
  j := private.queue_stale_jobs();
  for x in select e from jsonb_array_elements(j) e loop
    v_ref := 'queue_job_stale:' || (x ->> 'job');
    if not exists (select 1 from public.ops_incidents where external_reference = v_ref and status not in ('resolved', 'closed')) then
      insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
      values ('technical', 'sev1', 'A clinical queue job has stopped running',
              format('The scheduled job %s has not finished a run since %s. Escalation, offer release or claim expiry may not be happening. Check pg_cron.', x ->> 'job', x ->> 'last_run_at'),
              v_ref, now(), now());
    end if;
  end loop;
  b := private.queue_class_breaches();
  for x in select e from jsonb_array_elements(b) e loop
    v_ref := 'queue_class_stale:' || (x ->> 'priority_class');
    if not exists (select 1 from public.ops_incidents where external_reference = v_ref and status not in ('resolved', 'closed')) then
      insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
      values ('clinical', 'sev2', 'Clinical work is waiting too long',
              format('The oldest open task in priority class %s has waited %s minutes, past its warning threshold of %s minutes.',
                     x ->> 'priority_class', x ->> 'oldest_open_minutes', x ->> 'warn_after_minutes'),
              v_ref, now(), now());
    end if;
  end loop;
  perform private.queue_heartbeat('queue-watchdog', jsonb_build_object('stale_jobs', jsonb_array_length(j), 'breaches', jsonb_array_length(b)));
  return jsonb_build_object('stale_jobs', j, 'breaches', b);
end;
$$;
revoke all on function private.queue_watchdog() from public, anon, authenticated;
select cron.schedule('queue-watchdog', '*/5 * * * *', $$ select private.queue_watchdog(); $$);

-- Restates S17's queue_health (20261006020013); the clinical lead may read it as well as an admin, and it now carries the alerts.
create or replace function public.queue_health() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.task_staff_reader() then raise exception 'not authorised' using errcode = '42501'; end if;
  return (select jsonb_build_object(
    'open', count(*) filter (where state = 'open'),
    'offered', count(*) filter (where state = 'offered_to_lead'),
    'claimed', count(*) filter (where state = 'claimed'),
    'escalated', count(*) filter (where state = 'escalated'),
    'oldest_open_minutes', coalesce(extract(epoch from (now() - min(created_at) filter (where state in ('open', 'escalated'))))::integer / 60, 0),
    'oldest_open_minutes_by_class', coalesce((select jsonb_object_agg(k, m) from (
        select priority_class::text as k, (extract(epoch from (now() - min(created_at)))::integer / 60) as m
          from public.clinical_tasks where not is_test and state in ('open', 'escalated') group by priority_class) x), '{}'::jsonb),
    'breaches', private.queue_class_breaches(),
    'stale_jobs', private.queue_stale_jobs())
    from public.clinical_tasks where not is_test);
end;
$$;
revoke all on function public.queue_health() from public, anon;
grant execute on function public.queue_health() to authenticated;

-- ---------------------------------------------------------------------------
-- 10. queue_summary: why the queue is closed and until when, offered work, escalated work, own reliability
-- ---------------------------------------------------------------------------
-- When the cooling-off ends: the later of the soft and hard limits that are currently tripped (null when not cooling off).
create function private.queue_cooling_off_until(p_uid uuid) returns timestamptz
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cool jsonb := private.claim_setting('handback_cooldown');
  v_soft timestamptz;
  v_hard timestamptz;
begin
  -- the n-th most recent counted hand-back is the one whose ageing out brings the count below the limit
  select h.created_at + make_interval(mins => (v_cool ->> 'window_minutes')::integer) into v_soft
    from public.task_handbacks h
   where h.clinician_id = p_uid and h.created_at > now() - make_interval(mins => (v_cool ->> 'window_minutes')::integer)
     and not ((v_cool -> 'exempt_reasons') ? h.reason_code)
   order by h.created_at desc offset ((v_cool ->> 'count')::integer - 1) limit 1;
  select h.created_at + make_interval(mins => (v_cool ->> 'hard_window_minutes')::integer) into v_hard
    from public.task_handbacks h
   where h.clinician_id = p_uid and h.created_at > now() - make_interval(mins => (v_cool ->> 'hard_window_minutes')::integer)
   order by h.created_at desc offset ((v_cool ->> 'hard_count')::integer - 1) limit 1;
  return greatest(v_soft, v_hard);
end;
$$;
revoke all on function private.queue_cooling_off_until(uuid) from public, anon, authenticated;

-- Restates 20261006183417's queue_summary; every new key is additive, nothing existing changes shape.
create or replace function public.queue_summary() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_gate text := private.queue_gate(v_uid);
  v_block boolean;
  v_employed boolean;
  v_fee bigint;
  v_org uuid;
  fs public.fee_schedules%rowtype;
  nt public.clinical_tasks%rowtype;
  v_extra jsonb;
begin
  v_extra := jsonb_build_object(
    'reliability_score', (select cs.reliability_score from public.clinical_staff cs where cs.profile_id = v_uid),
    'cooling_off_until', case when v_gate = 'queue_cooling_off' then private.queue_cooling_off_until(v_uid) end,
    'offered', coalesce((select jsonb_agg(jsonb_build_object('task_id', ct.id, 'type', ct.type, 'priority_class', ct.priority_class,
                           'due_at', ct.due_at, 'window_ends_at', ct.lead_window_ends_at) order by ct.lead_window_ends_at)
                          from public.clinical_tasks ct
                         where ct.state = 'offered_to_lead' and v_uid in (ct.pushed_to, ct.lead_clinician_id)), '[]'::jsonb));
  if v_gate is not null then
    return jsonb_build_object('open', false, 'blocked', v_gate, 'by_class', '{}'::jsonb, 'next_fee_kobo', null, 'escalated_claimable', 0) || v_extra;
  end if;
  v_block := private.queue_has_block(v_uid);
  select employment_type = 'employed', organisation_id into v_employed, v_org from public.clinical_staff where profile_id = v_uid;
  if not v_block and not coalesce(v_employed, false) then
    return jsonb_build_object('open', false, 'blocked', 'queue_no_availability', 'by_class', '{}'::jsonb, 'next_fee_kobo', null, 'escalated_claimable', 0) || v_extra;
  end if;
  if not coalesce(v_employed, true) then
    select * into fs from public.fee_schedules where organisation_id = v_org and status = 'approved';
    if found then
      select ct.* into nt from private.queue_candidates(v_uid, not v_block) c join public.clinical_tasks ct on ct.id = c.id
       order by c.priority_class, c.due_at, c.created_at limit 1;
      if found then
        v_fee := (private.fee_task_calc(fs.items, nt.type, nt.created_at, nt.due_at, now()) ->> 'amount_kobo')::bigint;
      end if;
    end if;
  end if;
  return jsonb_build_object('open', true, 'blocked', null, 'next_fee_kobo', v_fee,
    'escalated_claimable', (select count(*) from private.queue_candidates(v_uid, not v_block) c where c.state = 'escalated'),
    'by_class', coalesce((select jsonb_object_agg(k, n) from (
        select priority_class::text as k, count(*) as n from private.queue_candidates(v_uid, not v_block) group by priority_class) x), '{}'::jsonb)) || v_extra;
end;
$$;
revoke all on function public.queue_summary() from public, anon;
grant execute on function public.queue_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Producer: titration_signoff for every engine-proposed medication change awaiting a signature
-- ---------------------------------------------------------------------------
-- A clinician's own proposal needs no task (they will sign it themselves); an engine proposal waits for a prescriber, which is
-- exactly what this task type is. The prescribing competency is passed so only a clinician competent to prescribe is offered it.
-- Creating the task must never block the proposal itself: a failure is logged and the proposal stands.
create function private.create_titration_task() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.proposed_by = 'engine' and new.kind = 'medication' and new.state = 'proposed' then
    perform private.create_clinical_task(new.patient_id, 'titration_signoff', null, 'titration:' || new.id, null, null, null, array['prescribing']);
  end if;
  return new;
exception when others then
  insert into public.audit_log (organisation_id, action, entity_type, entity_id, event, subject_patient_id)
  values (new.organisation_id, 'titration_task.create_failed', 'care_plan_change', new.id, jsonb_build_object('error', sqlerrm), new.patient_id);
  return new;
end;
$$;
revoke all on function private.create_titration_task() from public, anon, authenticated;
create trigger care_plan_changes_titration_task after insert on public.care_plan_changes
  for each row execute function private.create_titration_task();

-- When the change is signed or rejected the task is finished: completed for the clinician holding it, otherwise closed by the
-- system as decided elsewhere (the claim, if another clinician held it, ends with it: D3).
create function private.close_titration_task() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  t public.clinical_tasks%rowtype;
  v_by uuid := coalesce(new.signed_by, new.rejected_by);
  v_code text := case when new.state = 'signed' then 'signed' else 'rejected' end;
begin
  select * into t from public.clinical_tasks where dedup_key = 'titration:' || new.id and state not in ('completed', 'cancelled') for update;
  if not found then return new; end if;
  if t.state = 'claimed' and t.claimed_by = v_by then
    perform private.apply_task_transition(t.id, 'completed', 'clinician', v_by, 'completed', null, null,
      jsonb_build_object('code', v_code, 'care_plan_change_id', new.id, 'system_checked', true));
    perform private.reliability_event(v_by, t.id, case when now() <= t.due_at then 'completed_on_time' else 'completed_late' end);
  else
    perform private.apply_task_transition(t.id, 'cancelled', 'lead', null, 'The change was decided before this task was finished');
  end if;
  return new;
exception when others then
  insert into public.audit_log (organisation_id, action, entity_type, entity_id, event, subject_patient_id)
  values (new.organisation_id, 'titration_task.close_failed', 'care_plan_change', new.id, jsonb_build_object('error', sqlerrm), new.patient_id);
  return new;
end;
$$;
revoke all on function private.close_titration_task() from public, anon, authenticated;
create trigger care_plan_changes_titration_task_close after update of state on public.care_plan_changes
  for each row when (old.state = 'proposed' and new.state in ('signed', 'rejected'))
  execute function private.close_titration_task();

-- A symptom review is finished by signing the clinician's note for it. The screen tells the clinician so, so something has to do it:
-- finalizing a note completes the symptom review that clinician holds for that patient. (There is no producer for the type yet,
-- see the design note; this closes any such task that exists, however it was made.) Never blocks the signing.
create function private.close_symptom_review_on_note() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_profile uuid;
  t public.clinical_tasks%rowtype;
begin
  select cs.profile_id into v_profile from public.clinical_staff cs where cs.id = new.finalized_by_staff;
  if v_profile is null then return new; end if;
  select * into t from public.clinical_tasks
   where type = 'symptom_review' and state = 'claimed' and patient_id = new.patient_id and claimed_by = v_profile
   order by claimed_at limit 1 for update;
  if not found then return new; end if;
  perform private.apply_task_transition(t.id, 'completed', 'clinician', v_profile, 'completed', null, null,
    jsonb_build_object('code', 'answer_signed', 'note_id', new.id, 'system_checked', true));
  perform private.reliability_event(v_profile, t.id, case when now() <= t.due_at then 'completed_on_time' else 'completed_late' end);
  return new;
exception when others then
  insert into public.audit_log (organisation_id, action, entity_type, entity_id, event, subject_patient_id)
  values (new.organisation_id, 'symptom_review_task.close_failed', 'clinical_encounter_note', new.id, jsonb_build_object('error', sqlerrm), new.patient_id);
  return new;
end;
$$;
revoke all on function private.close_symptom_review_on_note() from public, anon, authenticated;
create trigger clinical_encounter_notes_close_symptom_review after update of status on public.clinical_encounter_notes
  for each row when (old.status is distinct from 'finalized' and new.status = 'finalized' and new.amends_note_id is null)
  execute function private.close_symptom_review_on_note();

-- ---------------------------------------------------------------------------
-- 12. Self-check
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  if (select count(*) from public.queue_task_layer_config where is_active) <> 1 then raise exception 'S16-S20 task layer: expected one active config row'; end if;
  foreach f in array array[
    'private.task_layer_setting(text)', 'private.queue_heartbeat(text,jsonb)', 'private.task_has_other_candidate(uuid)', 'private.task_outcome_code(text,jsonb)',
    'private.task_outcome_error(public.clinical_tasks,uuid,jsonb)', 'private.notify_task_escalated(uuid,uuid)', 'private.send_queue_backlog_digest()',
    'private.queue_watchdog()', 'private.queue_class_breaches()', 'private.queue_stale_jobs()', 'private.queue_cooling_off_until(uuid)',
    'private.create_titration_task()', 'private.close_titration_task()', 'private.close_symptom_review_on_note()', 'private.raise_dead_task_creation_incident()', 'private.try_uuid(text)', 'private.try_timestamptz(text)'
  ] loop
    if has_function_privilege('anon', f::regprocedure, 'EXECUTE') or has_function_privilege('authenticated', f::regprocedure, 'EXECUTE') then
      raise exception 'S16-S20 task layer: % is callable by anon or authenticated', f;
    end if;
  end loop;
  foreach f in array array['public.queue_escalated_overview()', 'public.queue_health()', 'public.queue_summary()', 'public.queue_complete(uuid,jsonb)', 'public.queue_handback(uuid,text,text)', 'public.queue_next(text[])'] loop
    if has_function_privilege('anon', f::regprocedure, 'EXECUTE') then raise exception 'S16-S20 task layer: anon can execute %', f; end if;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = f::regprocedure and a.grantee = 0) then raise exception 'S16-S20 task layer: PUBLIC can execute %', f; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.queue_task_layer_config', 'insert') or has_table_privilege('authenticated', 'public.queue_job_heartbeats', 'update')
     or has_table_privilege('anon', 'public.queue_task_layer_config', 'select') or has_table_privilege('anon', 'public.queue_job_heartbeats', 'select') then
    raise exception 'S16-S20 task layer: the new tables are writable or readable by the wrong roles';
  end if;
  if not exists (select 1 from cron.job where jobname = 'queue-watchdog') or not exists (select 1 from cron.job where jobname = 'queue-backlog-digest') then
    raise exception 'S16-S20 task layer: a cron job is missing';
  end if;
end $$;
