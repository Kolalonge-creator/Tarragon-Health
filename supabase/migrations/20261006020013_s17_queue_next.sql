-- S17: Next task. Eligibility, priority, atomic claim, hand-back, claim timeouts, reliability.
-- Spec 7.2 (conflicts, availability_blocks), 7.6, 7.8; safety cases 17, 18, 19. Design: docs/design/S17.md.
--
-- Depends on S15 (clinician_is_eligible, clinician_competencies, credential_notify_reviewers) and S16
-- (clinical_tasks, apply_task_transition, task_claims, task_handbacks). NOT applied to production: apply after S16.
--
-- What this adds:
--   * clinician_conflicts (spec "conflicts"): a conflicted clinician is never offered that patient's tasks.
--   * availability_blocks (spec 7.2, minimal): declare and cancel. S18 adds the rota, confirmation and the guarantee.
--   * public.queue_next(), queue_handback(), queue_extend_claim(), queue_complete(), queue_summary(): the clinician
--     can neither browse nor choose; the server picks, atomically, with FOR UPDATE SKIP LOCKED behind the S16 guard.
--   * private.expire_task_claims() (every minute): an abandoned claim returns to the queue, never closes the task.
--   * clinician_reliability_events (append only) and private.recompute_reliability(): derived, never hand-edited.
--   * the hand-back reason codes become the spec's five (task_handbacks is empty, so no data moves).
--
-- Counts before this migration (live): no clinical_tasks, task_claims or task_handbacks rows exist (S16 not applied),
-- so no conversion step is needed anywhere.
--
-- Nothing in an event, audit note or return value carries a reading, condition or result (INV-07).

-- ---------------------------------------------------------------------------
-- 1. Hand-back reason codes: the spec's five (7.6)
-- ---------------------------------------------------------------------------
alter table public.task_handbacks drop constraint task_handbacks_reason_code_check;
alter table public.task_handbacks add constraint task_handbacks_reason_code_check
  check (reason_code in ('conflict_of_interest', 'outside_competence', 'needs_information', 'technical_problem', 'other'));
alter table public.task_handbacks add constraint task_handbacks_other_needs_note
  check (reason_code <> 'other' or char_length(btrim(coalesce(note, ''))) >= 10);

create index task_handbacks_clinician_idx on public.task_handbacks (clinician_id, created_at desc);
create index task_handbacks_task_idx on public.task_handbacks (task_id, clinician_id);
alter table public.task_claims add column extended_count integer not null default 0 check (extended_count >= 0);
alter table public.clinical_staff add column queue_last_seen_at timestamptz;
comment on column public.clinical_staff.queue_last_seen_at is
  'S17: the last time this clinician called a queue function. Evidence for a human reviewing a pattern of expired claims; it is not a heartbeat (OQ-E).';

-- ---------------------------------------------------------------------------
-- 2. Configuration (versioned, PROPOSED values; mirrored as `queue.claims` in the code registry)
-- ---------------------------------------------------------------------------
create table public.queue_claim_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index queue_claim_config_one_active on public.queue_claim_config (is_active) where is_active;

-- queue-claims-begin
insert into public.queue_claim_config (version, is_active, effective_from, rules) values (1, true, '2026-10-06', $json$
{
  "max_extensions": 1,
  "handback_review": { "more_than": 3, "window_days": 7 },
  "handback_cooldown": { "count": 3, "window_minutes": 10, "exempt_reasons": ["conflict_of_interest", "technical_problem"], "hard_count": 6, "hard_window_minutes": 60 },
  "handback_excludes_task_for": ["conflict_of_interest", "outside_competence", "other"],
  "max_pending_self_conflicts": 5,
  "escalated_requires_on_call": true,
  "reliability": {
    "window_days": 90,
    "half_life_days": 30,
    "prior_events": 5,
    "prior_good": 0.8,
    "weights": { "completed_on_time": 1, "completed_late": 1, "claim_expired": 0.5, "handed_back_other": 0.25, "handed_back_reasoned": 0 },
    "good": { "completed_on_time": 1, "completed_late": 0.4, "claim_expired": 0, "handed_back_other": 0, "handed_back_reasoned": 1 }
  }
}
$json$::jsonb);
-- queue-claims-end

create function private.claim_setting(p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules -> p_key from public.queue_claim_config where is_active; $$;
revoke all on function private.claim_setting(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Events
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('clinical_task.claimed', 'A clinician took a clinical task', 'S17', false),
  ('clinical_task.handed_back', 'A clinician handed a clinical task back to the queue', 'S17', false),
  ('clinical_task.claim_expired', 'A claim timed out and the task returned to the queue', 'S17', false),
  ('clinical_task.completed', 'A clinician completed a clinical task', 'S17', false),
  ('clinician.handback_review_flagged', 'A clinician handed back more tasks than the review threshold; the clinical lead reviews', 'S17', false),
  ('clinician.conflict_declared', 'A conflict of interest was recorded between a clinician and a patient', 'S17', false);
insert into public.event_type_versions (event_type, version, required_keys) values
  ('clinical_task.claimed', 1, array['task_id', 'type', 'priority_class']),
  ('clinical_task.handed_back', 1, array['task_id', 'type', 'reason_code']),
  ('clinical_task.claim_expired', 1, array['task_id', 'type']),
  ('clinical_task.completed', 1, array['task_id', 'type']),
  ('clinician.handback_review_flagged', 1, array['clinician_id', 'handbacks']),
  ('clinician.conflict_declared', 1, array['conflict_id', 'source']);

-- ---------------------------------------------------------------------------
-- 4. clinician_conflicts (spec 7.2 `conflicts`)
-- ---------------------------------------------------------------------------
create table public.clinician_conflicts (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  clinician_id    uuid not null references public.profiles (id) on delete cascade,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  reason          text not null check (char_length(btrim(reason)) >= 3),
  source          text not null check (source in ('cmo', 'self_declared', 'handback')),
  status          text not null default 'pending_review' check (status in ('active', 'pending_review', 'lifted')),
  declared_by     uuid references public.profiles (id) on delete set null,
  lifted_by       uuid references public.profiles (id) on delete set null,
  lifted_at       timestamptz,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  check (clinician_id <> patient_id),
  check ((status = 'lifted') = (lifted_at is not null))
);
-- active and pending_review both block offers; only the CMO lifts
create unique index clinician_conflicts_one_live on public.clinician_conflicts (clinician_id, patient_id) where status <> 'lifted';
create index clinician_conflicts_patient_idx on public.clinician_conflicts (patient_id) where status <> 'lifted';

-- ---------------------------------------------------------------------------
-- 5. availability_blocks (spec 7.2, minimal; S18 adds the rota, confirmation and the minimum guarantee)
-- ---------------------------------------------------------------------------
create table public.availability_blocks (
  id                         uuid primary key default gen_random_uuid(),
  organisation_id            uuid not null references public.organisations (id) on delete restrict,
  clinician_id               uuid not null references public.profiles (id) on delete cascade,
  starts_at                  timestamptz not null,
  ends_at                    timestamptz not null,
  kind                       text not null check (kind in ('queue', 'on_call', 'bookable_consultations')),
  state                      text not null default 'declared' check (state in ('declared', 'confirmed', 'cancelled')),
  minimum_guarantee_eligible boolean not null default false,
  is_test                    boolean not null default false,
  created_at                 timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '24 hours')
);
create index availability_blocks_now_idx on public.availability_blocks (clinician_id, kind, starts_at, ends_at) where state <> 'cancelled';

create function private.guard_availability_overlap() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.state <> 'cancelled' and exists (
       select 1 from public.availability_blocks b
        where b.clinician_id = new.clinician_id and b.kind = new.kind and b.state <> 'cancelled' and b.id <> new.id
          and b.starts_at < new.ends_at and b.ends_at > new.starts_at) then
    raise exception 'availability_overlap' using errcode = '23P01';
  end if;
  return new;
end;
$$;
create trigger availability_blocks_overlap before insert or update on public.availability_blocks
  for each row execute function private.guard_availability_overlap();
revoke all on function private.guard_availability_overlap() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. clinician_reliability_events (append only) and the derived score
-- ---------------------------------------------------------------------------
create table public.clinician_reliability_events (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  clinician_id    uuid not null references public.profiles (id) on delete cascade,
  task_id         uuid references public.clinical_tasks (id) on delete set null,
  kind            text not null check (kind in ('completed_on_time', 'completed_late', 'claim_expired', 'handed_back_other', 'handed_back_reasoned', 'audit_result')),
  good            numeric not null check (good between 0 and 1),
  weight          numeric not null check (weight >= 0),
  config_version  integer not null,
  occurred_at     timestamptz not null default now(),
  is_test         boolean not null default false
);
create index clinician_reliability_events_idx on public.clinician_reliability_events (clinician_id, occurred_at desc);
create trigger clinician_reliability_events_append_only before update or delete on public.clinician_reliability_events
  for each row execute function private.queue_append_only();

create function private.recompute_reliability(p_clinician uuid) returns numeric
language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb := private.claim_setting('reliability');
  v_half numeric := (r ->> 'half_life_days')::numeric;
  v_prior_n numeric := (r ->> 'prior_events')::numeric;
  v_prior_good numeric := (r ->> 'prior_good')::numeric;
  v_sw numeric; v_sg numeric; v_score numeric;
begin
  select coalesce(sum(e.weight * exp(-ln(2) * extract(epoch from (now() - e.occurred_at)) / 86400 / v_half)), 0),
         coalesce(sum(e.weight * e.good * exp(-ln(2) * extract(epoch from (now() - e.occurred_at)) / 86400 / v_half)), 0)
    into v_sw, v_sg
    from public.clinician_reliability_events e
   where e.clinician_id = p_clinician and e.occurred_at > now() - make_interval(days => (r ->> 'window_days')::integer);
  v_score := round(100 * (v_prior_n * v_prior_good + v_sg) / (v_prior_n + v_sw), 2);
  update public.clinical_staff set reliability_score = v_score where profile_id = p_clinician;
  return v_score;
end;
$$;
revoke all on function private.recompute_reliability(uuid) from public, anon, authenticated;

create function private.reliability_event(p_clinician uuid, p_task uuid, p_kind text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb := private.claim_setting('reliability');
  v_org uuid; v_test boolean; v_ver integer;
begin
  select organisation_id, is_test into v_org, v_test from public.clinical_staff where profile_id = p_clinician;
  if v_org is null then return; end if;
  select version into v_ver from public.queue_claim_config where is_active;
  insert into public.clinician_reliability_events (organisation_id, clinician_id, task_id, kind, good, weight, config_version, is_test)
  values (v_org, p_clinician, p_task, p_kind, (r -> 'good' ->> p_kind)::numeric, (r -> 'weights' ->> p_kind)::numeric, v_ver, v_test);
  perform private.recompute_reliability(p_clinician);
end;
$$;
revoke all on function private.reliability_event(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Who may be offered what: one place (eligibility is never copied into application code)
-- ---------------------------------------------------------------------------
-- Why a task is not available to this clinician at all (null = fine). The gate for the whole queue, not for one task.
create function private.queue_gate(p_uid uuid) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  cs public.clinical_staff%rowtype;
  v_cool jsonb := private.claim_setting('handback_cooldown');
begin
  select * into cs from public.clinical_staff where profile_id = p_uid;
  if not found or p_uid is null then return 'queue_not_clinician'; end if;
  if not private.clinician_is_eligible(p_uid) then return 'queue_not_eligible'; end if;
  if cs.doctor_tier is null or private.doctor_tier_rank(cs.doctor_tier) is null then return 'queue_no_tier'; end if;
  if (select count(*) from public.task_handbacks h
       where h.clinician_id = p_uid
         and h.created_at > now() - make_interval(mins => (v_cool ->> 'window_minutes')::integer)
         and not ((v_cool -> 'exempt_reasons') ? h.reason_code)) >= (v_cool ->> 'count')::integer then
    return 'queue_cooling_off';
  end if;
  -- the hard cap counts every reason, so the exempt ones cannot be used to re-roll without limit
  if (select count(*) from public.task_handbacks h
       where h.clinician_id = p_uid
         and h.created_at > now() - make_interval(mins => (v_cool ->> 'hard_window_minutes')::integer)) >= (v_cool ->> 'hard_count')::integer then
    return 'queue_cooling_off';
  end if;
  return null;
end;
$$;
revoke all on function private.queue_gate(uuid) from public, anon, authenticated;

create function private.queue_has_block(p_uid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.availability_blocks b
                  where b.clinician_id = p_uid and b.kind = 'queue' and b.state in ('declared', 'confirmed')
                    and now() >= b.starts_at and now() < b.ends_at);
$$;
revoke all on function private.queue_has_block(uuid) from public, anon, authenticated;

-- The tasks this clinician may be offered, ordered as spec 7.6 orders them. A task offered to this clinician comes
-- ahead of a pool task of the same class. p_only_offered: an employed doctor with no queue block may still take work
-- pushed to them, but may not pull from the pool.
create function private.queue_candidates(p_uid uuid, p_only_offered boolean default false)
returns table (id uuid, priority_class smallint, due_at timestamptz, created_at timestamptz, state public.clinical_task_state)
language sql stable security definer set search_path = ''
as $$
  with me as (
    select cs.organisation_id, cs.is_test, private.doctor_tier_rank(cs.doctor_tier) as rank,
           coalesce((select array_agg(cc.competency_code) from public.clinician_competencies cc
                      where cc.clinical_staff_id = cs.id and cc.revoked_at is null), '{}'::text[]) as comps
      from public.clinical_staff cs where cs.profile_id = p_uid
  )
  select ct.id, ct.priority_class, ct.due_at, ct.created_at, ct.state
    from public.clinical_tasks ct, me
   where ct.organisation_id = me.organisation_id
     and ct.is_test = me.is_test
     and ct.patient_id <> p_uid
     and private.doctor_tier_rank(ct.min_tier) <= me.rank
     and ct.required_competencies <@ me.comps
     and (
          (ct.state = 'offered_to_lead' and p_uid in (ct.pushed_to, ct.lead_clinician_id))
       or (not p_only_offered and ct.state = 'open')
       or (not p_only_offered and ct.state = 'escalated'
           and (not coalesce((private.claim_setting('escalated_requires_on_call'))::boolean, true) or 'on_call' = any (me.comps)))
     )
     and not exists (select 1 from public.clinician_conflicts c
                      where c.clinician_id = p_uid and c.patient_id = ct.patient_id and c.status <> 'lifted')
     and not exists (select 1 from public.task_handbacks h
                      where h.task_id = ct.id and h.clinician_id = p_uid
                        and (private.claim_setting('handback_excludes_task_for')) ? h.reason_code);
$$;
revoke all on function private.queue_candidates(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. queue_next: the atomic claim (spec 7.6)
-- ---------------------------------------------------------------------------
create function public.queue_next() returns jsonb
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

  -- already holding the cap: a retry over a dropped connection gets the same claim back, never a second task (OQ-D)
  select count(*) into v_n from public.task_claims where clinician_id = v_uid and ended_at is null;
  if v_n >= cs.max_concurrent_claims then
    select * into v_live from public.task_claims where clinician_id = v_uid and ended_at is null order by claimed_at limit 1;
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
     order by c.priority_class, (c.state <> 'offered_to_lead'), c.due_at, c.created_at
     limit 1
       for update of ct skip locked;
    exit when found;
    exit when not exists (select 1 from private.queue_candidates(v_uid, not v_block));
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
revoke all on function public.queue_next() from public, anon;
grant execute on function public.queue_next() to authenticated;

-- What the console may show before a claim: counts by class only, and why the queue is closed, if it is.
create function public.queue_summary() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_gate text := private.queue_gate(v_uid);
  v_block boolean;
  v_employed boolean;
begin
  if v_gate is not null then
    return jsonb_build_object('open', false, 'blocked', v_gate, 'by_class', '{}'::jsonb, 'next_fee_kobo', null);
  end if;
  v_block := private.queue_has_block(v_uid);
  select employment_type = 'employed' into v_employed from public.clinical_staff where profile_id = v_uid;
  if not v_block and not coalesce(v_employed, false) then
    return jsonb_build_object('open', false, 'blocked', 'queue_no_availability', 'by_class', '{}'::jsonb, 'next_fee_kobo', null);
  end if;
  return jsonb_build_object('open', true, 'blocked', null, 'next_fee_kobo', null,
    'by_class', coalesce((select jsonb_object_agg(k, n) from (
        select priority_class::text as k, count(*) as n from private.queue_candidates(v_uid, not v_block) group by priority_class) x), '{}'::jsonb));
end;
$$;
revoke all on function public.queue_summary() from public, anon;
grant execute on function public.queue_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Hand-back, extension, completion
-- ---------------------------------------------------------------------------
create function public.queue_handback(p_task uuid, p_reason text, p_note text default null) returns void
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

-- One extension (config) of the lease by the type's own timeout, for a clinician part-way through the work.
create function public.queue_extend_claim(p_task uuid) returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  c public.task_claims%rowtype;
  t public.clinical_tasks%rowtype;
  ty public.task_types%rowtype;
  v_new timestamptz;
begin
  if v_uid is null then raise exception 'queue_not_clinician' using errcode = '42501'; end if;
  select * into c from public.task_claims where task_id = p_task and clinician_id = v_uid and ended_at is null for update;
  if not found then raise exception 'queue_no_claim' using errcode = '42501'; end if;
  if c.expires_at <= now() then raise exception 'queue_claim_expired' using errcode = '42501'; end if;
  if c.extended_count >= coalesce((private.claim_setting('max_extensions'))::integer, 1) then
    raise exception 'queue_extension_used' using errcode = '23514';
  end if;
  select * into t from public.clinical_tasks where id = p_task;
  select * into ty from public.task_types where code = t.type and version = t.task_type_version;
  v_new := c.expires_at + make_interval(mins => ty.claim_timeout_minutes);
  update public.task_claims set expires_at = v_new, extended_count = extended_count + 1 where id = c.id;
  perform set_config('tarragon.task_transition', 'on', true);
  update public.clinical_tasks set claim_expires_at = v_new where id = p_task;
  perform set_config('tarragon.task_transition', 'off', true);
  insert into public.clinical_task_transitions (organisation_id, task_id, from_state, to_state, actor_kind, actor_id, reason, is_test)
  values (t.organisation_id, t.id, 'claimed', 'claimed', 'clinician', v_uid, 'claim extended', t.is_test);
  update public.clinical_staff set queue_last_seen_at = now() where profile_id = v_uid;
  return v_new;
end;
$$;
revoke all on function public.queue_extend_claim(uuid) from public, anon;
grant execute on function public.queue_extend_claim(uuid) to authenticated;

-- The generic finish. The task-specific flows (S22 to S24) call this; earnings are S30.
create function public.queue_complete(p_task uuid, p_outcome jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  c public.task_claims%rowtype;
  t public.clinical_tasks%rowtype;
begin
  if v_uid is null then raise exception 'queue_not_clinician' using errcode = '42501'; end if;
  if p_outcome is null or jsonb_typeof(p_outcome) <> 'object' or p_outcome = '{}'::jsonb then
    raise exception 'queue_outcome_needed' using errcode = '22023';
  end if;
  select * into c from public.task_claims where task_id = p_task and clinician_id = v_uid and ended_at is null for update;
  if not found then raise exception 'queue_no_claim' using errcode = '42501'; end if;
  select * into t from public.clinical_tasks where id = p_task;
  update public.task_claims set ended_at = now(), end_reason = 'completed' where id = c.id;
  perform private.apply_task_transition(t.id, 'completed', 'clinician', v_uid, 'completed', null, null, p_outcome);
  perform private.reliability_event(v_uid, t.id, case when now() <= t.due_at then 'completed_on_time' else 'completed_late' end);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (t.organisation_id, v_uid, 'queue.complete', 'clinical_task', t.id, jsonb_build_object('type', t.type), t.patient_id);
  perform private.emit_domain_event('clinical_task.completed', t.organisation_id,
    jsonb_build_object('task_id', t.id, 'type', t.type), 'clinical_task.completed:' || c.id, t.patient_id, 'clinical_task', t.id);
end;
$$;
revoke all on function public.queue_complete(uuid, jsonb) from public, anon;
grant execute on function public.queue_complete(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Claim timeouts: an abandoned claim returns to the queue; the task is never closed or dropped
-- ---------------------------------------------------------------------------
create function private.expire_task_claims() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_expired integer := 0;
  v_released integer := 0;
  v_errors integer := 0;
  t public.clinical_tasks%rowtype;
begin
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
  return jsonb_build_object('expired', v_expired, 'released', v_released, 'errors', v_errors);
end;
$$;
revoke all on function private.expire_task_claims() from public, anon, authenticated;
select cron.schedule('expire-task-claims', '* * * * *', $$ select private.expire_task_claims(); $$);

-- ---------------------------------------------------------------------------
-- 11. Conflicts and availability: the writing functions
-- ---------------------------------------------------------------------------
-- A clinician declares their own conflict (pending until the CMO confirms or lifts it; blocks offers meanwhile).
create function public.declare_conflict(p_patient uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_org uuid; v_id uuid;
begin
  select organisation_id into v_org from public.clinical_staff where profile_id = v_uid and active;
  if v_org is null then raise exception 'queue_not_clinician' using errcode = '42501'; end if;
  if p_patient = v_uid or not exists (select 1 from public.profiles where id = p_patient and organisation_id = v_org and role = 'patient') then
    raise exception 'queue_bad_patient' using errcode = '22023';
  end if;
  if (select count(*) from public.clinician_conflicts where clinician_id = v_uid and source = 'self_declared' and status = 'pending_review')
       >= coalesce((private.claim_setting('max_pending_self_conflicts'))::integer, 5) then
    raise exception 'queue_too_many_conflicts' using errcode = '23514';
  end if;
  insert into public.clinician_conflicts (organisation_id, clinician_id, patient_id, reason, source, status, declared_by, is_test)
  values (v_org, v_uid, p_patient, p_reason, 'self_declared', 'pending_review', v_uid, (select is_test from public.profiles where id = v_uid))
  on conflict (clinician_id, patient_id) where status <> 'lifted' do nothing
  returning id into v_id;
  if v_id is not null then
    perform private.emit_domain_event('clinician.conflict_declared', v_org, jsonb_build_object('conflict_id', v_id, 'source', 'self_declared'), 'clinician.conflict_declared:' || v_id);
    perform private.credential_notify_reviewers(v_org, 'Conflict declared',
      coalesce((select full_name from public.clinical_staff where profile_id = v_uid), 'A clinician') || ' declared a conflict with a patient. Please confirm or lift it.',
      jsonb_build_object('conflict_id', v_id));
  end if;
  return v_id;
end;
$$;

-- The CMO records a conflict against a named clinician (source cmo, active at once).
create function public.record_conflict(p_clinician uuid, p_patient uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_org uuid; v_id uuid;
begin
  if not private.credential_is_cmo() then raise exception 'not allowed' using errcode = '42501'; end if;
  select organisation_id into v_org from public.clinical_staff where profile_id = p_clinician;
  if v_org is null or p_clinician = p_patient or not exists (select 1 from public.profiles where id = p_patient and organisation_id = v_org and role = 'patient') then
    raise exception 'queue_bad_patient' using errcode = '22023';
  end if;
  insert into public.clinician_conflicts (organisation_id, clinician_id, patient_id, reason, source, status, declared_by, is_test)
  values (v_org, p_clinician, p_patient, p_reason, 'cmo', 'active', v_uid, (select is_test from public.profiles where id = p_clinician))
  on conflict (clinician_id, patient_id) where status <> 'lifted' do update set status = 'active', source = 'cmo', reason = excluded.reason
  returning id into v_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'queue.conflict_recorded', 'clinician_conflict', v_id, jsonb_build_object('clinician_id', p_clinician));
  return v_id;
end;
$$;

-- Only the CMO lifts a conflict, with a reason, audited.
create function public.lift_conflict(p_conflict uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); c public.clinician_conflicts%rowtype;
begin
  if not private.credential_is_cmo() then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'queue_note_needed' using errcode = '22023'; end if;
  select * into c from public.clinician_conflicts where id = p_conflict and status <> 'lifted' for update;
  if not found then raise exception 'queue_no_conflict' using errcode = 'P0002'; end if;
  update public.clinician_conflicts set status = 'lifted', lifted_by = v_uid, lifted_at = now() where id = c.id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (c.organisation_id, v_uid, 'queue.conflict_lifted', 'clinician_conflict', c.id, jsonb_build_object('note', btrim(p_note)));
end;
$$;

create function public.declare_availability(p_kind text, p_starts timestamptz, p_ends timestamptz) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); cs public.clinical_staff%rowtype; v_id uuid;
begin
  select * into cs from public.clinical_staff where profile_id = v_uid;
  if not found or not private.clinician_is_eligible(v_uid) then raise exception 'queue_not_eligible' using errcode = '42501'; end if;
  if p_starts < now() - interval '5 minutes' or p_starts > now() + interval '31 days' then
    raise exception 'queue_bad_window' using errcode = '22023';
  end if;
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
  values (cs.organisation_id, v_uid, p_starts, p_ends, p_kind, cs.is_test) returning id into v_id;
  return v_id;
end;
$$;

create function public.cancel_availability(p_block uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.availability_blocks set state = 'cancelled'
   where id = p_block and clinician_id = (select auth.uid()) and state <> 'cancelled';
  if not found then raise exception 'queue_no_block' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.declare_conflict(uuid, text), public.record_conflict(uuid, uuid, text), public.lift_conflict(uuid, text),
  public.declare_availability(text, timestamptz, timestamptz), public.cancel_availability(uuid) from public, anon;
grant execute on function public.declare_conflict(uuid, text), public.record_conflict(uuid, uuid, text), public.lift_conflict(uuid, text),
  public.declare_availability(text, timestamptz, timestamptz), public.cancel_availability(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Starvation measure: oldest open per class (extends S16's queue_health)
-- ---------------------------------------------------------------------------
create or replace function public.queue_health() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'not authorised' using errcode = '42501'; end if;
  return (select jsonb_build_object(
    'open', count(*) filter (where state = 'open'),
    'offered', count(*) filter (where state = 'offered_to_lead'),
    'claimed', count(*) filter (where state = 'claimed'),
    'escalated', count(*) filter (where state = 'escalated'),
    'oldest_open_minutes', coalesce(extract(epoch from (now() - min(created_at) filter (where state in ('open', 'escalated'))))::integer / 60, 0),
    'oldest_open_minutes_by_class', coalesce((select jsonb_object_agg(k, m) from (
        select priority_class::text as k, (extract(epoch from (now() - min(created_at)))::integer / 60) as m
          from public.clinical_tasks where not is_test and state in ('open', 'escalated') group by priority_class) x), '{}'::jsonb))
    from public.clinical_tasks where not is_test);
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. RLS and grants. Writes happen only inside the functions above.
-- ---------------------------------------------------------------------------
alter table public.queue_claim_config enable row level security;
alter table public.clinician_conflicts enable row level security;
alter table public.availability_blocks enable row level security;
alter table public.clinician_reliability_events enable row level security;

create policy queue_claim_config_select on public.queue_claim_config for select to authenticated using (private.task_staff_reader());
create policy clinician_conflicts_select on public.clinician_conflicts for select to authenticated
  using (private.task_staff_reader() or clinician_id = (select auth.uid()));
create policy availability_blocks_select on public.availability_blocks for select to authenticated
  using (private.task_staff_reader() or clinician_id = (select auth.uid()));
create policy clinician_reliability_events_select on public.clinician_reliability_events for select to authenticated
  using (private.task_staff_reader() or clinician_id = (select auth.uid()));

revoke all on public.queue_claim_config, public.clinician_conflicts, public.availability_blocks, public.clinician_reliability_events
  from anon, public, authenticated;  -- the schema's default privileges also hand authenticated every right
grant select on public.queue_claim_config, public.clinician_conflicts, public.availability_blocks, public.clinician_reliability_events to authenticated;
