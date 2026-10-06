-- S16: clinical_tasks, the task state machine, task types and priority classes (spec 7.3, 7.4).
--
-- What this adds
--   * task_types: data, not code. Priority class, due window, minimum doctor tier, competencies, lead
--     window, claim timeout, the triage task keys each type answers. Versioned, one active row per code.
--   * clinical_tasks: the spec columns, plus the version of the task type and of the triage rule set that
--     produced the task (INV-16), a dedup key (a repeat trigger merges into the open task, recorded), the
--     delivery path (push to a named employed doctor, or pull from the pool) and is_test (INV-13).
--   * The state machine: clinical_task_transition_rules lists the only legal moves, clinical_task_transitions
--     logs every one (append only), and state changes ONLY through private.apply_task_transition(); a guard
--     trigger refuses any other change, including by the table owner.
--   * task_claims and task_handbacks (the claim and hand-back logs). S17 adds the claim RPCs; S16 only
--     provides the tables and the transitions they need.
--   * queue_config (versioned): the class-3 promotion window and the sweep settings.
--   * public.create_tasks_from_triage_event(): turns a graded triage event into tasks. Shadow events (graded by
--     a rule set the CMO has not approved) create nothing (OQ-88).
--   * Sweeps: offers that pass their window go to the pool, amber reviews near their due time move to class 3,
--     open tasks past due are escalated (S19 pages on the event).
--   * legacy_clinical_work_v: a read-only adapter view over the older alert and escalation tables. They stay.
--   * private.clinician_has_patient_access() gains one clause: a clinician holding an active task for a patient is
--     tied to that patient (INV-12). Nothing else widens.
--
-- Founder decisions (2026-10-06): the tier gate is doctor_tier only (not credentialing_level); the fee fields
-- stay empty until S30; email, not SMS, is the paging fallback (decided for S19); an adapter view over the old
-- task tables. Fee amounts: none here.
--
-- Counts before this migration (live): no clinical_tasks, task_claims or task_handbacks exist; escalations and
-- clinician_alerts are read, never changed.

-- ---------------------------------------------------------------------------
-- 1. Enums and helpers
-- ---------------------------------------------------------------------------
create type public.clinical_task_state as enum (
  'created', 'offered_to_lead', 'open', 'claimed', 'completed', 'escalated', 'cancelled'
);

-- Ordering of the doctor tiers for the minimum-tier gate. A coordinator ranks lowest.
create function private.doctor_tier_rank(p public.doctor_tier) returns integer
language sql immutable set search_path = ''
as $$ select case p
  when 'care_coordinator' then 0
  when 'medical_officer' then 1
  when 'senior_medical_officer' then 2
  when 'chief_medical_officer' then 3
  else null end; $$;
revoke all on function private.doctor_tier_rank(public.doctor_tier) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. task_types and queue_config (data, not code; Section 18)
-- ---------------------------------------------------------------------------
create table public.task_types (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  version               integer not null check (version >= 1),
  is_active             boolean not null default true,
  priority_class        smallint not null check (priority_class between 1 and 9),
  default_due_minutes   integer not null check (default_due_minutes >= 0),
  min_doctor_tier       public.doctor_tier not null,
  required_competencies text[] not null default '{}',
  -- The window a named clinician (the patient's lead, or an employed doctor the task was pushed to) has
  -- before the task goes to the pool. 0 means no window (red events never use one: INV-05).
  lead_window_minutes   integer not null default 0 check (lead_window_minutes >= 0),
  claim_timeout_minutes integer not null default 30 check (claim_timeout_minutes > 0),
  -- A task of this type may be pushed to an employed doctor's own queue (F-03).
  pushable              boolean not null default false,
  -- false for a class that only exists by promotion (amber_bp_review_due_soon).
  creatable             boolean not null default true,
  -- The task keys the triage engine emits (create_task actions) that this type answers.
  source_task_keys      text[] not null default '{}',
  effective_from        date not null default current_date,
  note                  text,
  created_at            timestamptz not null default now(),
  unique (code, version),
  check (priority_class <> 1 or lead_window_minutes = 0)
);
create unique index task_types_one_active on public.task_types (code) where is_active;

-- PROPOSED values (spec 7.3 and 7.4); mirrored in packages/shared as `queue.task_types`, with a test that fails on drift.
-- task-types-begin
insert into public.task_types
  (code, version, priority_class, default_due_minutes, min_doctor_tier, required_competencies,
   lead_window_minutes, claim_timeout_minutes, pushable, creatable, source_task_keys, note) values
  ('red_event_unacknowledged', 1, 1, 0, 'senior_medical_officer', '{on_call}', 0, 30, false, true, '{}',
   'Created by S19 when a red page is not acknowledged within 5 minutes. Never has a lead window (INV-05).'),
  ('critical_result_review', 1, 2, 120, 'senior_medical_officer', '{result_review}', 0, 30, false, true, '{}', null),
  ('amber_bp_review_due_soon', 1, 3, 0, 'medical_officer', '{hypertension}', 0, 30, false, false, '{}',
   'Not created directly: an amber_bp_review within the promotion window of its due time moves to this class.'),
  ('amber_bp_review', 1, 4, 1440, 'medical_officer', '{hypertension}', 240, 30, true, true,
   '{urgent_bp_review,bp_review,low_bp_review}', null),
  ('symptom_review', 1, 5, 1440, 'medical_officer', '{adult_general}', 1440, 30, true, true, '{}', null),
  ('titration_signoff', 1, 6, 2880, 'senior_medical_officer', '{prescribing,hypertension}', 2880, 60, true, true, '{}', null),
  ('async_question', 1, 7, 1440, 'medical_officer', '{adult_general}', 1440, 30, true, true, '{}', null),
  ('routine_result_review', 1, 8, 2880, 'medical_officer', '{result_review}', 1440, 30, true, true, '{}', null),
  ('admin_clinical', 1, 9, 4320, 'medical_officer', '{}', 1440, 30, true, true, '{referral_review}',
   'Referral letters and repeat prescriptions. A prescription task adds the prescribing competency when it is created.'),
  -- Two task keys the engine emits that the spec has no type for (OQ-S16-1). Logistics only, so a coordinator may take them.
  ('adherence_follow_up', 1, 8, 2880, 'care_coordinator', '{}', 1440, 30, true, true, '{adherence_review,silence_check}',
   'Check-in after missed doses or silence. Not in the spec table; recorded as OQ-S16-1.');
-- task-types-end

create table public.queue_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index queue_config_one_active on public.queue_config (is_active) where is_active;

-- queue-rules-begin
insert into public.queue_config (version, is_active, effective_from, rules) values (1, true, '2026-10-06', $json$
{
  "class3_promotion_window_minutes": 240,
  "escalate_after_due_minutes": 0,
  "dedup_tightens_due": true
}
$json$::jsonb);
-- queue-rules-end

create function private.queue_setting(p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules -> p_key from public.queue_config where is_active; $$;
revoke all on function private.queue_setting(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. clinical_tasks
-- ---------------------------------------------------------------------------
create table public.clinical_tasks (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id) on delete restrict,
  type                     text not null,
  task_type_version        integer not null,
  priority_class           smallint not null check (priority_class between 1 and 9),
  priority_class_original  smallint not null check (priority_class_original between 1 and 9),
  priority_override_by     uuid references public.profiles (id) on delete set null,
  priority_override_reason text,
  patient_id               uuid not null references public.profiles (id) on delete cascade,
  source_event_id          uuid,                                    -- the domain_events row that caused it (no FK: events are append only and prunable)
  triage_event_id          uuid references public.triage_events (id) on delete set null,
  rule_set_version         integer,                                 -- INV-16: the triage rule set that asked for it
  required_competencies    text[] not null default '{}',
  min_tier                 public.doctor_tier not null,
  due_at                   timestamptz not null,
  lead_clinician_id        uuid references public.profiles (id) on delete set null,
  lead_window_ends_at      timestamptz,
  delivery_path            text not null default 'pull' check (delivery_path in ('push', 'pull')),
  pushed_to                uuid references public.profiles (id) on delete set null,
  state                    public.clinical_task_state not null default 'created',
  claimed_by               uuid references public.profiles (id) on delete set null,
  claimed_at               timestamptz,
  claim_expires_at         timestamptz,
  completed_at             timestamptz,
  outcome                  jsonb,
  -- Empty until S30 (fee schedules). Integer kobo (INV-15).
  fee_kobo_at_completion   bigint check (fee_kobo_at_completion is null or fee_kobo_at_completion >= 0),
  fee_schedule_version_id  uuid,
  handback_count           integer not null default 0 check (handback_count >= 0),
  escalation_level         integer not null default 0 check (escalation_level >= 0),
  dedup_key                text,
  merged_count             integer not null default 0 check (merged_count >= 0),
  cancel_reason            text,
  is_test                  boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  foreign key (type, task_type_version) references public.task_types (code, version),
  check (state <> 'claimed' or (claimed_by is not null and claimed_at is not null and claim_expires_at is not null)),
  check (state <> 'completed' or (completed_at is not null and outcome is not null)),
  check (state <> 'cancelled' or char_length(btrim(coalesce(cancel_reason, ''))) >= 10),
  check (delivery_path = 'pull' or pushed_to is not null),
  -- INV-05: a red-class task never waits in a lead window.
  check (priority_class_original <> 1 or lead_window_ends_at is null)
);
create unique index clinical_tasks_live_dedup on public.clinical_tasks (dedup_key)
  where dedup_key is not null and state not in ('completed', 'cancelled');
create index clinical_tasks_pool_idx on public.clinical_tasks (priority_class, due_at) where state in ('open', 'escalated');
create index clinical_tasks_patient_idx on public.clinical_tasks (patient_id, created_at desc);
create index clinical_tasks_pushed_idx on public.clinical_tasks (pushed_to) where pushed_to is not null and state in ('offered_to_lead', 'open', 'claimed', 'escalated');
create index clinical_tasks_claimed_idx on public.clinical_tasks (claimed_by) where claimed_by is not null and state = 'claimed';
create index clinical_tasks_offer_idx on public.clinical_tasks (lead_window_ends_at) where state = 'offered_to_lead';
create trigger clinical_tasks_set_updated_at before update on public.clinical_tasks
  for each row execute function private.set_updated_at();

comment on table public.clinical_tasks is 'S16: one row per piece of clinician work (spec 7.4). Holds ids and neutral facts only, never a reading, condition or result (INV-07). state changes only through private.apply_task_transition().';

create table public.clinical_task_transition_rules (
  from_state public.clinical_task_state not null,
  to_state   public.clinical_task_state not null,
  actor_kind text not null check (actor_kind in ('system', 'clinician', 'lead')),
  primary key (from_state, to_state, actor_kind)
);
insert into public.clinical_task_transition_rules (from_state, to_state, actor_kind) values
  ('created', 'offered_to_lead', 'system'),
  ('created', 'open', 'system'),
  ('offered_to_lead', 'open', 'system'),          -- the window ended
  ('offered_to_lead', 'claimed', 'clinician'),    -- the named clinician claims inside the window
  ('offered_to_lead', 'escalated', 'system'),     -- past due while still offered
  ('open', 'claimed', 'clinician'),
  ('open', 'escalated', 'system'),
  ('escalated', 'claimed', 'clinician'),          -- the on-call clinician still claims an escalated task
  ('claimed', 'completed', 'clinician'),
  ('claimed', 'open', 'clinician'),               -- handed back with a reason
  ('claimed', 'open', 'system'),                  -- the claim timed out
  ('created', 'cancelled', 'lead'),
  ('offered_to_lead', 'cancelled', 'lead'),
  ('open', 'cancelled', 'lead'),
  ('claimed', 'cancelled', 'lead'),
  ('escalated', 'cancelled', 'lead');

create table public.clinical_task_transitions (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  task_id         uuid not null references public.clinical_tasks (id) on delete cascade,
  from_state      public.clinical_task_state,
  to_state        public.clinical_task_state not null,
  actor_kind      text not null,
  actor_id        uuid references public.profiles (id) on delete set null,
  reason          text,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now()
);
create index clinical_task_transitions_task_idx on public.clinical_task_transitions (task_id, created_at);

create table public.task_claims (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  task_id         uuid not null references public.clinical_tasks (id) on delete cascade,
  clinician_id    uuid not null references public.profiles (id) on delete restrict,
  claimed_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  ended_at        timestamptz,
  end_reason      text check (end_reason in ('completed', 'handed_back', 'expired', 'cancelled')),
  is_test         boolean not null default false,
  check ((ended_at is null) = (end_reason is null))
);
create unique index task_claims_one_live on public.task_claims (task_id) where ended_at is null;

create table public.task_handbacks (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  task_id         uuid not null references public.clinical_tasks (id) on delete cascade,
  claim_id        uuid references public.task_claims (id) on delete set null,
  clinician_id    uuid not null references public.profiles (id) on delete restrict,
  reason_code     text not null check (reason_code in ('conflict_of_interest', 'outside_competence', 'need_more_information', 'unavailable', 'other')),
  note            text,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now()
);

create function private.queue_append_only() returns trigger
language plpgsql set search_path = ''
as $$ begin raise exception '% is append only', tg_table_name using errcode = '23514'; end; $$;
create trigger clinical_task_transitions_append_only before update or delete on public.clinical_task_transitions
  for each row execute function private.queue_append_only();
create trigger task_handbacks_append_only before update or delete on public.task_handbacks
  for each row execute function private.queue_append_only();
revoke all on function private.queue_append_only() from public, anon, authenticated;

-- state changes only through apply_task_transition(); rows are created only through create_clinical_task()
create function private.guard_clinical_task() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(current_setting('tarragon.task_transition', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'clinical_tasks rows are created only by the queue functions' using errcode = '42501';
  end if;
  if new.state is distinct from old.state or new.claimed_by is distinct from old.claimed_by
     or new.claim_expires_at is distinct from old.claim_expires_at or new.completed_at is distinct from old.completed_at
     or new.handback_count is distinct from old.handback_count or new.escalation_level is distinct from old.escalation_level
     or new.priority_class is distinct from old.priority_class or new.outcome is distinct from old.outcome then
    raise exception 'clinical_tasks can only change through the queue functions' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger clinical_tasks_guard before insert or update on public.clinical_tasks
  for each row execute function private.guard_clinical_task();
revoke all on function private.guard_clinical_task() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Events
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('clinical_task.created', 'A clinical task was created', 'S16', false),
  ('clinical_task.state_changed', 'A clinical task changed state', 'S16', false),
  ('clinical_task.escalated', 'A clinical task passed its due time or had no eligible clinician; S19 pages the on-call clinician', 'S16', true);
insert into public.event_type_versions (event_type, version, required_keys) values
  ('clinical_task.created', 1, array['task_id', 'type', 'priority_class']),
  ('clinical_task.state_changed', 1, array['task_id', 'from_state', 'to_state']),
  ('clinical_task.escalated', 1, array['task_id', 'type', 'priority_class']);

-- ---------------------------------------------------------------------------
-- 5. The one place state changes
-- ---------------------------------------------------------------------------
create function private.apply_task_transition(
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
  if p_to = 'completed' and p_outcome is null then
    raise exception 'completing a task needs an outcome' using errcode = '22023';
  end if;

  perform set_config('tarragon.task_transition', 'on', true);
  if p_to = 'claimed' then
    update public.clinical_tasks set state = 'claimed', claimed_by = p_claimed_by, claimed_at = now(), claim_expires_at = p_claim_expires_at where id = p_task;
  elsif p_to = 'open' and t.state = 'claimed' then
    update public.clinical_tasks set state = 'open', claimed_by = null, claimed_at = null, claim_expires_at = null,
           handback_count = handback_count + 1 where id = p_task;
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
-- 6. Creating a task: dedup, lead window, push or pool
-- ---------------------------------------------------------------------------
-- The least-loaded employed doctor who may take this task now. Eligible (S15), at or above the minimum tier, not on
-- leave. A doctor merely outside declared hours is only deprioritised, as in escalation auto-assignment, because an
-- urgent task must still reach someone.
create function private.pick_employed_clinician(p_org uuid, p_min public.doctor_tier)
returns uuid language sql stable security definer set search_path = ''
as $$
  select cs.profile_id
    from public.clinical_staff cs
   where cs.organisation_id = p_org and cs.active and cs.status = 'active' and cs.profile_id is not null
     and cs.employment_type = 'employed'
     and cs.doctor_tier is not null
     and private.doctor_tier_rank(cs.doctor_tier) >= private.doctor_tier_rank(p_min)
     and private.clinician_is_eligible(cs.profile_id)
     and not private.clinician_on_leave(cs.profile_id)
   order by private.clinician_deprioritised_now(cs.profile_id),
            (select count(*) from public.clinical_tasks ct
              where ct.pushed_to = cs.profile_id and ct.state in ('offered_to_lead', 'open', 'claimed', 'escalated')),
            cs.profile_id
   limit 1;
$$;
revoke all on function private.pick_employed_clinician(uuid, public.doctor_tier) from public, anon, authenticated;

create function private.create_clinical_task(
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
begin
  select * into ty from public.task_types where code = p_type and is_active;
  if not found or not ty.creatable then raise exception 'unknown or non-creatable task type %', p_type using errcode = '22023'; end if;
  select * into pr from public.profiles where id = p_patient and role = 'patient';
  if not found then raise exception 'unknown patient' using errcode = '22023'; end if;
  v_due := now() + make_interval(mins => coalesce(p_due_minutes, ty.default_due_minutes));

  -- A repeat trigger merges into the live task; the merge is counted and a tighter due time wins. Never dropped silently.
  if p_dedup_key is not null then
    select * into v_existing from public.clinical_tasks
     where dedup_key = p_dedup_key and state not in ('completed', 'cancelled') for update;
    if found then
      perform set_config('tarragon.task_transition', 'on', true);
      update public.clinical_tasks set merged_count = merged_count + 1,
             due_at = case when coalesce((private.queue_setting('dedup_tightens_due'))::boolean, true) then least(due_at, v_due) else due_at end
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

  -- Where it goes first. A red-class task never waits (INV-05).
  if ty.priority_class > 1 and ty.lead_window_minutes > 0 then
    select cta.clinician_id into v_lead from public.care_team_assignment cta where cta.patient_id = p_patient;
    if v_lead is not null and private.clinician_is_eligible(v_lead) and not private.clinician_on_leave(v_lead)
       and exists (select 1 from public.clinical_staff cs where cs.profile_id = v_lead and cs.doctor_tier is not null
                    and private.doctor_tier_rank(cs.doctor_tier) >= private.doctor_tier_rank(ty.min_doctor_tier)) then
      -- the patient's named clinician (S18 will replace this stand-in with its own lead assignment)
      v_window_ends := least(v_due, now() + make_interval(mins => ty.lead_window_minutes));
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
      v_push := private.pick_employed_clinician(pr.organisation_id, ty.min_doctor_tier);
      if v_push is not null then
        v_window_ends := least(v_due, now() + make_interval(mins => ty.lead_window_minutes));
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

-- The subscriber's one entry point. Shadow events create nothing (OQ-88). An action naming a task key no type answers
-- raises, so the delivery retries and then dead-letters visibly instead of dropping the work silently.
create function public.create_tasks_from_triage_event(p_triage_event uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  te public.triage_events%rowtype;
  a jsonb;
  v_type text;
  v_made integer := 0;
  v_due integer;
begin
  select * into te from public.triage_events where id = p_triage_event;
  if not found then raise exception 'unknown triage event' using errcode = '22023'; end if;
  if te.shadow or te.patient_id is null then return 0; end if;
  for a in select x from jsonb_array_elements(te.actions) x where x ->> 'kind' = 'create_task' loop
    select code into v_type from public.task_types where is_active and creatable and source_task_keys @> array[a ->> 'task'];
    if v_type is null then
      raise exception 'no task type answers the triage task key %', a ->> 'task' using errcode = 'P0001';
    end if;
    v_due := nullif(a ->> 'dueMinutes', '')::integer;
    perform private.create_clinical_task(te.patient_id, v_type, v_due,
      'triage:' || te.patient_id || ':' || v_type, te.id, te.rule_set_version, null);
    v_made := v_made + 1;
  end loop;
  return v_made;
end;
$$;
revoke all on function public.create_tasks_from_triage_event(uuid) from public, anon, authenticated;
grant execute on function public.create_tasks_from_triage_event(uuid) to service_role;

insert into public.event_subscribers (subscriber_key, event_type, handler_key, note)
values ('queue.create_from_triage', 'triage.graded', 'queue.create_from_triage',
        'S16: turns an approved (non-shadow) triage grade into clinical tasks');

-- ---------------------------------------------------------------------------
-- 7. Clinical-lead actions, audited
-- ---------------------------------------------------------------------------
create function public.cancel_clinical_task(p_task uuid, p_reason text) returns void
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
end;
$$;

create function public.override_task_priority(p_task uuid, p_class smallint, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare t public.clinical_tasks%rowtype;
begin
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can change a priority' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'a reason of at least 10 characters is required' using errcode = '22023'; end if;
  if p_class is null or p_class not between 1 and 9 then raise exception 'priority class must be 1 to 9' using errcode = '22023'; end if;
  select * into t from public.clinical_tasks where id = p_task for update;
  if not found or t.state in ('completed', 'cancelled') then raise exception 'task not found or already finished' using errcode = '22023'; end if;
  perform set_config('tarragon.task_transition', 'on', true);
  update public.clinical_tasks set priority_class = p_class, priority_override_by = (select auth.uid()), priority_override_reason = btrim(p_reason) where id = p_task;
  perform set_config('tarragon.task_transition', 'off', true);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (t.organisation_id, (select auth.uid()), 'clinical_task.priority_overridden', 'clinical_task', t.id,
          jsonb_build_object('reason', btrim(p_reason), 'from_class', t.priority_class, 'to_class', p_class), t.patient_id);
end;
$$;
revoke all on function public.cancel_clinical_task(uuid, text) from public, anon;
revoke all on function public.override_task_priority(uuid, smallint, text) from public, anon;
grant execute on function public.cancel_clinical_task(uuid, text) to authenticated;
grant execute on function public.override_task_priority(uuid, smallint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Sweeps: offers that lapse, class-3 promotion, overdue escalation
-- ---------------------------------------------------------------------------
create function private.sweep_clinical_tasks() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_released integer := 0;
  v_promoted integer := 0;
  v_escalated integer := 0;
  v_window integer := coalesce((private.queue_setting('class3_promotion_window_minutes'))::integer, 240);
begin
  -- overdue first: a task past due is escalated whether it is offered or open
  for r in select id from public.clinical_tasks where state in ('offered_to_lead', 'open') and due_at <= now() loop
    perform private.apply_task_transition(r.id, 'escalated', 'system', null, 'past due');
    v_escalated := v_escalated + 1;
  end loop;
  for r in select id from public.clinical_tasks where state = 'offered_to_lead' and lead_window_ends_at <= now() loop
    perform private.apply_task_transition(r.id, 'open', 'system', null, 'offer window ended');
    v_released := v_released + 1;
  end loop;
  -- amber reviews within the window of their due time move up to class 3, once
  for r in select id from public.clinical_tasks
            where type = 'amber_bp_review' and priority_class = 4 and priority_class_original = 4
              and state in ('offered_to_lead', 'open', 'claimed')
              and due_at <= now() + make_interval(mins => v_window) loop
    perform set_config('tarragon.task_transition', 'on', true);
    update public.clinical_tasks set priority_class = 3 where id = r.id;
    perform set_config('tarragon.task_transition', 'off', true);
    insert into public.clinical_task_transitions (organisation_id, task_id, from_state, to_state, actor_kind, reason, is_test)
      select organisation_id, id, state, state, 'system', 'moved to priority class 3 (due soon)', is_test from public.clinical_tasks where id = r.id;
    v_promoted := v_promoted + 1;
  end loop;
  return jsonb_build_object('released', v_released, 'promoted', v_promoted, 'escalated', v_escalated);
end;
$$;
revoke all on function private.sweep_clinical_tasks() from public, anon, authenticated;

select cron.schedule('sweep-clinical-tasks', '* * * * *', $$ select private.sweep_clinical_tasks(); $$);

create function public.queue_health() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'not authorised' using errcode = '42501'; end if;
  return (select jsonb_build_object(
    'open', count(*) filter (where state = 'open'),
    'offered', count(*) filter (where state = 'offered_to_lead'),
    'claimed', count(*) filter (where state = 'claimed'),
    'escalated', count(*) filter (where state = 'escalated'),
    'oldest_open_minutes', coalesce(extract(epoch from (now() - min(created_at) filter (where state in ('open', 'escalated'))))::integer / 60, 0))
    from public.clinical_tasks where not is_test);
end;
$$;
revoke all on function public.queue_health() from public, anon;
grant execute on function public.queue_health() to authenticated;

-- ---------------------------------------------------------------------------
-- 9. RLS and grants. Writes happen only inside the functions above.
-- ---------------------------------------------------------------------------
alter table public.task_types enable row level security;
alter table public.queue_config enable row level security;
alter table public.clinical_tasks enable row level security;
alter table public.clinical_task_transition_rules enable row level security;
alter table public.clinical_task_transitions enable row level security;
alter table public.task_claims enable row level security;
alter table public.task_handbacks enable row level security;

-- a clinician's own tasks: pushed to them, claimed by them, or where they are the named lead
create function private.task_is_mine(p_pushed uuid, p_claimed uuid, p_lead uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select (select auth.uid()) is not null and (select auth.uid()) in (p_pushed, p_claimed, p_lead); $$;
revoke all on function private.task_is_mine(uuid, uuid, uuid) from public, anon;
grant execute on function private.task_is_mine(uuid, uuid, uuid) to authenticated;

-- staff who may read every task: an admin account or the active chief medical officer (a policy runs as the caller,
-- so the helper is granted to authenticated and exposes nothing but a boolean)
create function private.task_staff_reader() returns boolean
language sql stable security definer set search_path = ''
as $$ select private.is_admin() or private.credential_is_cmo(); $$;
revoke all on function private.task_staff_reader() from public, anon;
grant execute on function private.task_staff_reader() to authenticated;

create policy task_types_select on public.task_types for select to authenticated using (true);
create policy queue_config_select on public.queue_config for select to authenticated using (private.task_staff_reader());
create policy clinical_task_transition_rules_select on public.clinical_task_transition_rules for select to authenticated using (true);
create policy clinical_tasks_select on public.clinical_tasks for select to authenticated
  using (private.task_staff_reader() or private.task_is_mine(pushed_to, claimed_by, lead_clinician_id));
create policy clinical_task_transitions_select on public.clinical_task_transitions for select to authenticated
  using (private.task_staff_reader()
         or exists (select 1 from public.clinical_tasks ct where ct.id = task_id and private.task_is_mine(ct.pushed_to, ct.claimed_by, ct.lead_clinician_id)));
create policy task_claims_select on public.task_claims for select to authenticated
  using (private.task_staff_reader() or clinician_id = (select auth.uid()));
create policy task_handbacks_select on public.task_handbacks for select to authenticated
  using (private.task_staff_reader() or clinician_id = (select auth.uid()));

revoke all on public.task_types, public.queue_config, public.clinical_tasks, public.clinical_task_transition_rules,
  public.clinical_task_transitions, public.task_claims, public.task_handbacks from anon, public, authenticated;  -- the schema's default privileges also hand authenticated every right
grant select on public.task_types, public.queue_config, public.clinical_tasks, public.clinical_task_transition_rules,
  public.clinical_task_transitions, public.task_claims, public.task_handbacks to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Adapter view over the older alert and escalation tables (read only; they stay as they are)
-- ---------------------------------------------------------------------------
create view public.legacy_clinical_work_v with (security_invoker = true) as
  select 'escalations'::text as source_table, e.id as source_id, e.patient_id, e.organisation_id,
         e.assigned_doctor_id as assigned_to, e.status::text as status, e.created_at
    from public.escalations e where e.status in ('open', 'under_review')
  union all
  select 'clinician_alerts', a.id, a.patient_id, a.organisation_id,
         (select cs.profile_id from public.clinical_staff cs where cs.id = a.responsible_clinician_id), a.status::text, a.created_at
    from public.clinician_alerts a where a.status in ('open', 'acknowledged', 'snoozed');
revoke all on public.legacy_clinical_work_v from anon, public, authenticated;
grant select on public.legacy_clinical_work_v to authenticated;
comment on view public.legacy_clinical_work_v is 'S16: read-only adapter over open escalations and alerts, for the queue screens and reconciliation. Not a task table; named so it cannot be mistaken for clinical_tasks.';

-- ---------------------------------------------------------------------------
-- 11. INV-12: a clinician holding an active task for a patient is tied to that patient.
-- This repeats the live definition (20261001144411) with one added clause. Re-read the live definition with
-- pg_get_functiondef before applying, in case another branch has changed it since.
-- ---------------------------------------------------------------------------
create or replace function private.clinician_has_patient_access(p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and p_patient is not null
    and private.is_org_staff((select pr.organisation_id from public.profiles pr where pr.id = p_patient))
    and (
      -- today's care-team assignment (clinician, clinical director, care coordinator)
      exists (
        select 1 from public.care_team_assignment cta
         where cta.patient_id = p_patient
           and (select auth.uid()) in (cta.clinician_id, cta.clinical_director_id, cta.care_coordinator_id)
      )
      -- an open escalation routed to me
      or exists (
        select 1 from public.escalations e
         where e.patient_id = p_patient
           and e.assigned_doctor_id = (select auth.uid())
           and e.status in ('open', 'under_review')
      )
      -- an unresolved alert I am responsible for (or the backup)
      or exists (
        select 1 from public.clinician_alerts a
          join public.clinical_staff cs on cs.id in (a.responsible_clinician_id, a.backup_clinician_id)
         where a.patient_id = p_patient
           and cs.profile_id = (select auth.uid())
           and a.status in ('open', 'acknowledged', 'snoozed')
      )
      -- a consultation in progress, or an upcoming one that has not ended (a stale booked row never ties a clinician)
      or exists (
        select 1 from public.appointments ap
         where ap.patient_id = p_patient
           and ap.clinician_id = (select auth.uid())
           and (
                ap.status = 'in_progress'
             or (ap.status in ('scheduled', 'booked', 'confirmed', 'checked_in') and ap.ends_at >= now())
           )
      )
      -- a video consultation I started or am due to host that has not ended
      or exists (
        select 1 from public.video_consultations vc
         where vc.patient_id = p_patient
           and vc.initiated_by = (select auth.uid())
           and vc.status in ('scheduled', 'started')
           and vc.ended_at is null
      )
      -- an active clinical task pushed to me, claimed by me, or offered to me as the named clinician (S16, INV-12)
      or exists (
        select 1 from public.clinical_tasks ct
         where ct.patient_id = p_patient
           and (
                (ct.state = 'offered_to_lead' and (select auth.uid()) in (ct.pushed_to, ct.lead_clinician_id))
             or (ct.state in ('claimed', 'escalated') and ct.claimed_by = (select auth.uid()))
           )
      )
      -- an open specialist referral assigned to me
      or exists (
        select 1 from public.specialist_referrals sr
          join public.clinical_staff cs on cs.id = sr.assigned_specialist_id
         where sr.patient_id = p_patient
           and cs.profile_id = (select auth.uid())
           and sr.status not in ('closed', 'declined', 'completed', 'draft')
      )
    );
$$;
revoke all on function private.clinician_has_patient_access(uuid) from public, anon;
grant execute on function private.clinician_has_patient_access(uuid) to authenticated;
