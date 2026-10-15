-- S16-S20 hardening, defect D3 (docs/plans/S16-S20-review-and-build-plan.md, section 3).
--
-- The defect. public.cancel_clinical_task() on a CLAIMED task moved the task to 'cancelled' but left the clinician's
-- task_claims row live. Two things then went wrong for that clinician:
--   * public.queue_next() counts live claims, so a clinician whose cap is 1 was told "already claimed" and handed the
--     cancelled task back on every call. They could not take any other work until SQL ended the claim.
--   * private.expire_task_claims() tried to move the cancelled task from 'claimed' to 'open' when the lease ran out; that
--     transition does not exist, so it raised, was caught, and opened a sev1 incident on every run.
--
-- The fix, in three layers so no single path can bring it back:
--   1. private.apply_task_transition() ends the live claim whenever a task is cancelled or completed (one helper,
--      private.end_task_claim, so there is one place to test and to sabotage).
--   2. queue_next() only counts a claim whose task is actually 'claimed', and ends any stale claim it finds for the
--      caller before it counts (self-healing for a row left behind by any other path).
--   3. expire_task_claims() ends a stale claim without a transition and without an incident.
-- Recovery: every clinician already stuck is freed by the statement at the end of this file.
--
-- Each function below restates its current body (apply_task_transition: 20261006014107; queue_next: 20261006104506;
-- expire_task_claims: 20261006020013) with only the changes described here.

-- ---------------------------------------------------------------------------
-- 1. One helper ends the live claim of a task that is no longer claimed
-- ---------------------------------------------------------------------------
create function private.end_task_claim(p_task uuid, p_to public.clinical_task_state) returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  update public.task_claims
     set ended_at = now(), end_reason = case when p_to = 'completed' then 'completed' else 'cancelled' end
   where task_id = p_task and ended_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function private.end_task_claim(uuid, public.clinical_task_state) from public, anon, authenticated;

create or replace function private.apply_task_transition(
  p_task uuid, p_to public.clinical_task_state, p_actor_kind text, p_actor uuid, p_reason text default null,
  p_claimed_by uuid default null, p_claim_expires_at timestamptz default null, p_outcome jsonb default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  t public.clinical_tasks%rowtype;
  v_n integer;
begin
  select * into t from public.clinical_tasks where id = p_task for update;
  if not found then raise exception 'unknown task' using errcode = '22023'; end if;
  if not exists (select 1 from public.clinical_task_transition_rules r
                  where r.from_state = t.state and r.to_state = p_to and r.actor_kind = p_actor_kind) then
    raise exception 'illegal task transition % -> % by %', t.state, p_to, p_actor_kind using errcode = '23514';
  end if;
  if p_to = 'cancelled' and char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'cancelling a task needs a reason of at least 10 characters' using errcode = '22023';
  end if;
  if p_to = 'claimed' and (p_claimed_by is null or p_claim_expires_at is null) then
    raise exception 'a claim needs a clinician and an expiry' using errcode = '22023';
  end if;
  if p_to = 'claimed' then
    -- clinical authority is enforced here, not only by the caller: eligible (S15), at or above the task's tier,
    -- the claimer is the one acting, and inside an offer window only the named clinician may claim
    if p_actor is distinct from p_claimed_by then
      raise exception 'a claim is made by the clinician claiming' using errcode = '42501';
    end if;
    if not private.clinician_is_eligible(p_claimed_by)
       or not exists (select 1 from public.clinical_staff cs where cs.profile_id = p_claimed_by and cs.active and cs.doctor_tier is not null
                       and private.doctor_tier_rank(cs.doctor_tier) >= private.doctor_tier_rank(t.min_tier)) then
      raise exception 'this clinician may not take this task' using errcode = '42501';
    end if;
    if t.state = 'offered_to_lead' and p_claimed_by is distinct from t.pushed_to and p_claimed_by is distinct from t.lead_clinician_id then
      raise exception 'this task is offered to another clinician' using errcode = '42501';
    end if;
  end if;
  if p_actor_kind = 'clinician' and t.state = 'claimed' and p_actor is distinct from t.claimed_by then
    raise exception 'only the clinician who claimed a task can complete or hand it back' using errcode = '42501';
  end if;
  if p_to = 'completed' and p_outcome is null then
    raise exception 'completing a task needs an outcome' using errcode = '22023';
  end if;

  perform set_config('tarragon.task_transition', 'on', true);
  if p_to = 'claimed' then
    update public.clinical_tasks set state = 'claimed', claimed_by = p_claimed_by, claimed_at = now(), claim_expires_at = p_claim_expires_at where id = p_task;
  elsif p_to = 'open' and t.state = 'claimed' then
    -- a clinician hand-back counts; a timeout (system) does not (spec 7.4: a timeout is an expired claim, S17 logs it)
    update public.clinical_tasks set state = 'open', claimed_by = null, claimed_at = null, claim_expires_at = null,
           handback_count = handback_count + case when p_actor_kind = 'clinician' then 1 else 0 end where id = p_task;
  elsif p_to = 'completed' then
    update public.clinical_tasks set state = 'completed', completed_at = now(), outcome = p_outcome,
           claim_expires_at = null where id = p_task;
  elsif p_to = 'escalated' then
    update public.clinical_tasks set state = 'escalated', escalation_level = escalation_level + 1 where id = p_task;
  elsif p_to = 'cancelled' then
    update public.clinical_tasks set state = 'cancelled', cancel_reason = btrim(p_reason), claim_expires_at = null where id = p_task;
  else
    update public.clinical_tasks set state = p_to where id = p_task;
  end if;
  perform set_config('tarragon.task_transition', 'off', true);

  -- D3: a finished task holds no claim. (queue_complete and queue_handback end their own claim first, so this is then a no-op.)
  if p_to in ('completed', 'cancelled') then
    perform private.end_task_claim(t.id, p_to);
  end if;

  insert into public.clinical_task_transitions (organisation_id, task_id, from_state, to_state, actor_kind, actor_id, reason, is_test)
  values (t.organisation_id, t.id, t.state, p_to, p_actor_kind, p_actor, p_reason, t.is_test);
  select count(*) into v_n from public.clinical_task_transitions where task_id = t.id;
  perform private.emit_domain_event('clinical_task.state_changed', t.organisation_id,
    jsonb_build_object('task_id', t.id, 'from_state', t.state, 'to_state', p_to, 'type', t.type, 'priority_class', t.priority_class),
    'clinical_task.state_changed:' || t.id || ':' || v_n, t.patient_id, 'clinical_task', t.id);
  if p_to = 'escalated' then
    perform private.emit_domain_event('clinical_task.escalated', t.organisation_id,
      jsonb_build_object('task_id', t.id, 'type', t.type, 'priority_class', t.priority_class),
      'clinical_task.escalated:' || t.id || ':' || v_n, t.patient_id, 'clinical_task', t.id, 'urgent');
  end if;
end;
$$;
revoke all on function private.apply_task_transition(uuid, public.clinical_task_state, text, uuid, text, uuid, timestamptz, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. queue_next ignores (and clears) a claim whose task is not claimed
-- ---------------------------------------------------------------------------
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
begin
  if v_uid is null then raise exception 'queue_not_clinician' using errcode = '42501'; end if;
  -- serialises this clinician's own calls (a retry racing the original); other clinicians are not blocked
  select * into cs from public.clinical_staff where profile_id = v_uid for update;
  v_gate := private.queue_gate(v_uid);
  if v_gate is not null then raise exception '%', v_gate using errcode = '42501'; end if;
  update public.clinical_staff set queue_last_seen_at = now() where id = cs.id;

  -- D3: a live claim on a task that is no longer claimed (cancelled, completed) is stale. End it, so it can neither
  -- count against the cap nor be handed back as "already claimed".
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
-- 3. expire_task_claims: a stale claim is ended quietly, never rolled back into an incident
-- ---------------------------------------------------------------------------
create or replace function private.expire_task_claims() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_expired integer := 0;
  v_released integer := 0;
  v_stale integer := 0;
  v_errors integer := 0;
  t public.clinical_tasks%rowtype;
begin
  -- 0. D3: a live claim on a task that is not claimed any more (cancelled or completed by another path) is ended, with no
  --    transition (there is none to make), no reliability event and no incident.
  update public.task_claims k
     set ended_at = now(), end_reason = case when ct.state = 'completed' then 'completed' else 'cancelled' end
    from public.clinical_tasks ct
   where k.task_id = ct.id and k.ended_at is null and ct.state <> 'claimed';
  get diagnostics v_stale = row_count;
  -- 1. a clinician who is no longer eligible (suspended, licence lapsed) gives up their claims at once; no penalty
  for r in select c.id as claim_id, c.task_id, c.clinician_id, c.organisation_id from public.task_claims c
            where c.ended_at is null and not private.clinician_is_eligible(c.clinician_id) loop
    begin
      update public.task_claims set ended_at = now(), end_reason = 'cancelled' where id = r.claim_id and ended_at is null;
      continue when not found;   -- finished or handed back a moment ago: nothing to release
      perform private.apply_task_transition(r.task_id, 'open', 'system', null, 'clinician no longer eligible');
      v_released := v_released + 1;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'expire_task_claims: releasing % failed: %', r.task_id, sqlerrm;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (r.organisation_id, 'queue_expiry.error', 'clinical_task', r.task_id, jsonb_build_object('step', 'release', 'error', sqlerrm));
    end;
  end loop;
  -- 2. leases that ran out
  for r in select c.id as claim_id, c.task_id, c.clinician_id, c.organisation_id from public.task_claims c
            where c.ended_at is null and c.expires_at <= now() loop
    begin
      update public.task_claims set ended_at = now(), end_reason = 'expired' where id = r.claim_id and ended_at is null;
      continue when not found;   -- completed or handed back in the same instant: not an expiry, not an error
      perform private.apply_task_transition(r.task_id, 'open', 'system', null, 'claim timed out');
      perform private.reliability_event(r.clinician_id, r.task_id, 'claim_expired');
      select * into t from public.clinical_tasks where id = r.task_id;
      perform private.emit_domain_event('clinical_task.claim_expired', r.organisation_id,
        jsonb_build_object('task_id', r.task_id, 'type', t.type), 'clinical_task.claim_expired:' || r.claim_id, t.patient_id, 'clinical_task', r.task_id);
      -- already past due: do not wait for the next sweep to escalate it
      if t.due_at <= now() then
        perform private.apply_task_transition(r.task_id, 'escalated', 'system', null, 'past due after a claim timed out');
      end if;
      v_expired := v_expired + 1;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'expire_task_claims: expiring % failed: %', r.task_id, sqlerrm;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (r.organisation_id, 'queue_expiry.error', 'clinical_task', r.task_id, jsonb_build_object('step', 'expire', 'error', sqlerrm));
    end;
  end loop;
  if v_errors > 0 and not exists (select 1 from public.ops_incidents where external_reference = 'queue_claim_expiry' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values ('technical', 'sev1', 'Queue claim expiry failed for some tasks',
            format('%s claim(s) could not be released by private.expire_task_claims(); see audit_log action queue_expiry.error. A task may be stuck with a clinician who has gone.', v_errors),
            'queue_claim_expiry', now(), now());
  end if;
  return jsonb_build_object('expired', v_expired, 'released', v_released, 'stale_ended', v_stale, 'errors', v_errors);
end;
$$;
revoke all on function private.expire_task_claims() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Recovery: free every clinician already stuck behind a claim on a finished task
-- ---------------------------------------------------------------------------
do $$
declare n integer;
begin
  update public.task_claims k
     set ended_at = now(), end_reason = case when ct.state = 'completed' then 'completed' else 'cancelled' end
    from public.clinical_tasks ct
   where k.task_id = ct.id and k.ended_at is null and ct.state in ('cancelled', 'completed');
  get diagnostics n = row_count;
  raise notice 'S16-S20 D3 recovery: ended % stale claim(s) on cancelled or completed tasks', n;
  if exists (select 1 from public.task_claims k join public.clinical_tasks ct on ct.id = k.task_id
              where k.ended_at is null and ct.state <> 'claimed') then
    raise exception 'S16-S20 D3: a live claim on a task that is not claimed remains';
  end if;
  if has_function_privilege('authenticated', 'private.end_task_claim(uuid, public.clinical_task_state)', 'EXECUTE')
     or has_function_privilege('anon', 'private.end_task_claim(uuid, public.clinical_task_state)', 'EXECUTE') then
    raise exception 'S16-S20 D3: end_task_claim became callable';
  end if;
end $$;
