-- Tarragon Health — Clinical Rules & Care Protocol Engine, part 2/6:
-- the event ledger, the execution ledger, emitted actions, and suppression
-- state.
--
-- §32.6 says the engine's shape is EVENT -> matching rules -> evaluate
-- conditions -> action. These four tables are the durable record of every
-- stage of that, which is what turns "the platform did something automatic"
-- into something a clinician or a governance reviewer can actually
-- interrogate afterwards (§32.11 explainability, §32.16 auditability).
--
-- The critical design decision here: a rule evaluation is recorded whether
-- or not it produced an action. A rule that considered a patient and decided
-- NOT to act is exactly as clinically interesting as one that did -- it is
-- how you find a rule that has silently stopped firing, or one whose
-- population predicate is subtly wrong. "No row" must never be ambiguous
-- between "the engine looked and declined" and "the engine never ran".

create type public.clinical_rule_event_status as enum (
  'pending', 'processing', 'processed', 'failed', 'skipped'
);

-- How an evaluation was run. 'shadow' is §32.13 -- a real evaluation against
-- real patient data whose actions are recorded but never emitted.
create type public.clinical_rule_execution_mode as enum ('active', 'shadow');

-- What the engine concluded. Every value is a reason, never a silence.
create type public.clinical_rule_execution_outcome as enum (
  'actions_emitted',        -- conditions met, actions produced
  'population_not_matched', -- rule considered, patient out of scope
  'conditions_not_met',     -- rule considered, clinical test negative
  'suppressed',             -- conditions met but cooldown/dedup/episode held it (§32.10)
  'superseded',             -- conditions met but a more specific/higher-priority rule won (§32.9)
  'shadow_recorded',        -- conditions met, actions withheld because the rule is in shadow
  'error'                   -- evaluation itself failed; details in error_detail
);

create type public.clinical_rule_action_status as enum (
  'emitted',            -- the action really happened, produced_id points at it
  'shadow_recorded',    -- what would have happened, had the rule been active
  'awaiting_oversight', -- high-risk action held for a clinician to approve (§32.8)
  'skipped',
  'failed'
);

-- ---------------------------------------------------------------------------
-- clinical_rule_events (§32.7)
-- ---------------------------------------------------------------------------

create table public.clinical_rule_events (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  -- Nullable: most events are about a patient, but operational events
  -- (a lab partner going offline, a clinic slot failing) need not be.
  patient_id       uuid references public.profiles (id) on delete cascade,
  event_type       public.clinical_rule_event_type not null,
  occurred_at      timestamptz not null default now(),

  -- The event's own facts. Kept small and denormalised on purpose: the
  -- engine merges this with a freshly-derived patient context at evaluation
  -- time rather than trusting a snapshot, but the payload is what preserves
  -- WHAT happened even after the underlying row changes.
  payload          jsonb not null default '{}'::jsonb,

  -- Provenance: which table/row produced this, and by what route. Lets an
  -- auditor walk from an automated action back to the clinical record that
  -- caused it without guessing.
  source           text not null check (source in ('db_trigger', 'server_action', 'cron', 'api', 'backfill')),
  subject_table    text,
  subject_id       uuid,

  status           public.clinical_rule_event_status not null default 'pending',
  processed_at     timestamptz,
  error_detail     text,
  attempts         smallint not null default 0,

  -- Idempotency for emitters that may legitimately fire twice (a retried
  -- webhook, a re-run cron sweep). Null means "no idempotency claimed".
  dedup_key        text,

  created_at       timestamptz not null default now(),

  constraint clinical_rule_events_payload_is_object check (jsonb_typeof(payload) = 'object'),
  constraint clinical_rule_events_processed_has_time check (
    status <> 'processed' or processed_at is not null
  ),
  constraint clinical_rule_events_failed_has_detail check (
    status <> 'failed' or error_detail is not null
  )
);

create unique index clinical_rule_events_dedup_idx
  on public.clinical_rule_events (dedup_key) where dedup_key is not null;
-- The worker's claim query.
create index clinical_rule_events_pending_idx
  on public.clinical_rule_events (occurred_at)
  where status in ('pending', 'processing');
create index clinical_rule_events_patient_idx
  on public.clinical_rule_events (patient_id, event_type, occurred_at desc);
create index clinical_rule_events_org_idx
  on public.clinical_rule_events (organisation_id, occurred_at desc);
create index clinical_rule_events_subject_idx
  on public.clinical_rule_events (subject_table, subject_id) where subject_id is not null;

comment on table public.clinical_rule_events is
  '§32.7 event ledger: one row per platform event the rules engine may react to. Also the replay source for §32.12 simulation -- a proposed rule is tested against these historical rows, which is only meaningful because the payload is preserved rather than re-derived.';
comment on column public.clinical_rule_events.dedup_key is
  'Optional idempotency claim by the emitter (unique when present), so a retried webhook or a re-run sweep enqueues the event once rather than firing every matching rule twice.';

-- ---------------------------------------------------------------------------
-- clinical_rule_executions (§32.11, §32.14)
-- ---------------------------------------------------------------------------

create table public.clinical_rule_executions (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  event_id            uuid not null references public.clinical_rule_events (id) on delete cascade,
  rule_id             uuid not null references public.clinical_rules (id) on delete restrict,

  -- Denormalised so the audit trail stays legible even as the catalogue
  -- grows, and so analytics can group by rule_key across versions without a
  -- join. rule_id is still the FK of record.
  rule_key            text not null,
  rule_version        integer not null,

  patient_id          uuid references public.profiles (id) on delete cascade,
  mode                public.clinical_rule_execution_mode not null,
  outcome             public.clinical_rule_execution_outcome not null,

  -- §32.9: when this rule lost a conflict, which rule beat it.
  superseded_by_rule_id uuid references public.clinical_rules (id) on delete restrict,
  -- §32.10: which suppression mechanism held the action back.
  suppressed_by       text check (suppressed_by in ('cooldown', 'deduplication', 'episode_cap', 'manual')),

  -- §32.11: the human-readable reason, rendered from the rule's
  -- explanation_template against this evaluation's actual facts. NOT NULL:
  -- there is no outcome this engine can reach that it cannot explain.
  explanation         text not null check (length(btrim(explanation)) > 0),

  -- The machine-readable companion: which predicate clauses were evaluated
  -- and what the context values were. This is what lets a governance
  -- reviewer answer "why did it think that?" rather than only "what did it
  -- decide?".
  evaluation_trace    jsonb not null default '{}'::jsonb,

  error_detail        text,
  evaluated_at        timestamptz not null default now(),

  constraint clinical_rule_executions_trace_is_object check (jsonb_typeof(evaluation_trace) = 'object'),
  constraint clinical_rule_executions_superseded_has_winner check (
    outcome <> 'superseded' or superseded_by_rule_id is not null
  ),
  constraint clinical_rule_executions_suppressed_has_mechanism check (
    outcome <> 'suppressed' or suppressed_by is not null
  ),
  constraint clinical_rule_executions_error_has_detail check (
    outcome <> 'error' or error_detail is not null
  ),
  -- A shadow evaluation can never claim to have emitted anything.
  constraint clinical_rule_executions_shadow_never_emits check (
    mode <> 'shadow' or outcome <> 'actions_emitted'
  ),
  -- ...and conversely, 'shadow_recorded' is only reachable in shadow mode.
  constraint clinical_rule_executions_shadow_outcome_needs_shadow check (
    outcome <> 'shadow_recorded' or mode = 'shadow'
  ),
  -- One evaluation of a given rule per event: the worker is idempotent, so a
  -- retried event cannot double-count a rule in the analytics (§32.14).
  constraint clinical_rule_executions_once_per_event unique (event_id, rule_id)
);

create index clinical_rule_executions_rule_idx
  on public.clinical_rule_executions (rule_key, rule_version, evaluated_at desc);
create index clinical_rule_executions_patient_idx
  on public.clinical_rule_executions (patient_id, evaluated_at desc);
create index clinical_rule_executions_org_outcome_idx
  on public.clinical_rule_executions (organisation_id, outcome, evaluated_at desc);
create index clinical_rule_executions_rule_id_idx on public.clinical_rule_executions (rule_id);
create index clinical_rule_executions_superseded_by_idx
  on public.clinical_rule_executions (superseded_by_rule_id) where superseded_by_rule_id is not null;

comment on table public.clinical_rule_executions is
  'One row per (event, rule) evaluation -- including evaluations that declined to act. "No action" is recorded with its reason rather than left as an absence, so a rule that has silently stopped firing is detectable. Feeds §32.11 explainability and §32.14 analytics.';

-- ---------------------------------------------------------------------------
-- clinical_rule_action_records (§32.8)
-- ---------------------------------------------------------------------------

create table public.clinical_rule_action_records (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  execution_id        uuid not null references public.clinical_rule_executions (id) on delete cascade,
  rule_id             uuid not null references public.clinical_rules (id) on delete restrict,
  rule_key            text not null,
  patient_id          uuid references public.profiles (id) on delete cascade,

  action_type         public.clinical_rule_action_type not null,
  action_payload      jsonb not null default '{}'::jsonb,
  status              public.clinical_rule_action_status not null,

  -- §32.8: "High-risk clinical actions should have appropriate clinician
  -- oversight." An escalation, a referral recommendation or a care-plan
  -- update is never applied by the engine on its own authority -- it is
  -- surfaced for a clinician. This flag is what the dispatcher reads to
  -- decide between emitting and queueing for oversight.
  requires_clinician_oversight boolean not null default false,

  -- Where the action actually landed, when it landed anywhere.
  produced_table      text,
  produced_id         uuid,

  -- Deterministic classification with a clinician_override field -- the
  -- pattern ported from v3 and already used by clinician_alerts. A clinician
  -- disagreeing with an automated action is a first-class, recorded event,
  -- not a deletion; override_rate is one of §32.14's required metrics.
  clinician_override  boolean not null default false,
  override_reason     text,
  overridden_by       uuid references public.clinical_staff (id) on delete restrict,
  overridden_at       timestamptz,

  failure_detail      text,
  created_at          timestamptz not null default now(),

  constraint clinical_rule_action_records_payload_is_object check (jsonb_typeof(action_payload) = 'object'),
  constraint clinical_rule_action_records_emitted_has_target check (
    status <> 'emitted' or (produced_table is not null and produced_id is not null)
  ),
  constraint clinical_rule_action_records_failed_has_detail check (
    status <> 'failed' or failure_detail is not null
  ),
  constraint clinical_rule_action_records_override_documented check (
    not clinician_override
    or (override_reason is not null and overridden_by is not null and overridden_at is not null)
  )
);

create index clinical_rule_action_records_execution_idx
  on public.clinical_rule_action_records (execution_id);
create index clinical_rule_action_records_patient_idx
  on public.clinical_rule_action_records (patient_id, created_at desc);
create index clinical_rule_action_records_rule_idx
  on public.clinical_rule_action_records (rule_key, action_type, created_at desc);
create index clinical_rule_action_records_produced_idx
  on public.clinical_rule_action_records (produced_table, produced_id) where produced_id is not null;
create index clinical_rule_action_records_oversight_idx
  on public.clinical_rule_action_records (organisation_id, created_at desc)
  where status = 'awaiting_oversight';
create index clinical_rule_action_records_rule_id_idx on public.clinical_rule_action_records (rule_id);
create index clinical_rule_action_records_overridden_by_idx
  on public.clinical_rule_action_records (overridden_by) where overridden_by is not null;

comment on table public.clinical_rule_action_records is
  '§32.8. Every action a rule produced, would have produced (shadow), or is holding for clinician oversight -- with a link to whatever real row it created. Also the substrate for §32.14''s override rate and clinician-acceptance metrics.';

-- ---------------------------------------------------------------------------
-- clinical_rule_suppressions (§32.10)
-- ---------------------------------------------------------------------------
--
-- Cooldown and deduplication could in principle be derived by scanning the
-- execution ledger, but episode grouping and a clinician's manual "stop
-- telling me about this one" cannot -- and deriving a safety-relevant
-- suppression by scan makes it depend on the ledger never being pruned.
-- An explicit, expiring row is both cheaper to check and honest about what
-- is being held back and until when.

create table public.clinical_rule_suppressions (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  rule_key          text not null,
  patient_id        uuid references public.profiles (id) on delete cascade,

  -- The dedup identity: rule_key + patient + whatever fields the rule's
  -- suppression config names (e.g. the vital type, the screening panel).
  suppression_key   text not null,
  -- §32.10 episode grouping: several triggers of the same clinical episode
  -- (one hypertensive run, one exacerbation) collapse to one piece of work.
  episode_key       text,
  mechanism         text not null check (mechanism in ('cooldown', 'deduplication', 'episode_cap', 'manual')),

  suppressed_until  timestamptz not null,
  reason            text not null,
  hit_count         integer not null default 0,

  -- Only set for mechanism = 'manual': a clinician deliberately quietening
  -- a rule for a patient. Structurally required so a manual suppression can
  -- never be mistaken for an automatic one.
  created_by        uuid references public.clinical_staff (id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint clinical_rule_suppressions_manual_has_author check (
    mechanism <> 'manual' or created_by is not null
  ),
  constraint clinical_rule_suppressions_unique_key unique (rule_key, suppression_key)
);

create index clinical_rule_suppressions_lookup_idx
  on public.clinical_rule_suppressions (rule_key, patient_id, suppressed_until desc);
create index clinical_rule_suppressions_episode_idx
  on public.clinical_rule_suppressions (episode_key) where episode_key is not null;
create index clinical_rule_suppressions_org_idx on public.clinical_rule_suppressions (organisation_id);
create index clinical_rule_suppressions_created_by_idx
  on public.clinical_rule_suppressions (created_by) where created_by is not null;

create trigger clinical_rule_suppressions_set_updated_at
  before update on public.clinical_rule_suppressions
  for each row execute function private.set_updated_at();

comment on table public.clinical_rule_suppressions is
  '§32.10 cooldown / suppression / deduplication / episode grouping. An expiring row per (rule_key, suppression_key). suppression_key already embeds the patient and the rule''s configured dedup fields, which is why the uniqueness constraint does not repeat patient_id.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- All four are staff-read-only from the client. Writes come exclusively from
-- the engine: the service-role worker (api/cron/clinical-rules) and the
-- SECURITY DEFINER emitter in part 3. There is deliberately no client INSERT
-- policy on the executions/actions ledgers -- a forgeable audit trail is not
-- an audit trail. The two places a human legitimately writes here (a manual
-- suppression, a clinician override of an emitted action) get their own
-- narrow, gated paths in part 3 rather than a blanket policy.

alter table public.clinical_rule_events enable row level security;
alter table public.clinical_rule_executions enable row level security;
alter table public.clinical_rule_action_records enable row level security;
alter table public.clinical_rule_suppressions enable row level security;

create policy clinical_rule_events_select on public.clinical_rule_events
  for select to authenticated using (private.is_org_staff(organisation_id));

create policy clinical_rule_executions_select on public.clinical_rule_executions
  for select to authenticated using (private.is_org_staff(organisation_id));

create policy clinical_rule_action_records_select on public.clinical_rule_action_records
  for select to authenticated using (private.is_org_staff(organisation_id));

create policy clinical_rule_suppressions_select on public.clinical_rule_suppressions
  for select to authenticated using (private.is_org_staff(organisation_id));

grant select on public.clinical_rule_events to authenticated;
grant select on public.clinical_rule_executions to authenticated;
grant select on public.clinical_rule_action_records to authenticated;
grant select on public.clinical_rule_suppressions to authenticated;
