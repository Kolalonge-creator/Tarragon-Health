-- Tarragon Health — Clinical Rules & Care Protocol Engine, part 1/6:
-- rule definitions.
--
-- WHY THIS EXISTS (spec §32.1/§32.2). The platform already makes a great
-- many clinical decisions automatically -- BP/glucose/SpO2/temperature red
-- flags, abnormal-screening escalation, drug monitoring, care-gap and
-- outreach queueing -- but every one of them lives as a hand-written
-- threshold inside a specific trigger function or TS module. Changing "three
-- high readings in 14 days" therefore means a code change, a review, a
-- migration and a deploy, and there is no single place a Clinical Director
-- can look to see what the platform will do to a patient, why, or on whose
-- authority. This migration adds that missing layer: a governed, versioned,
-- declarative rule catalogue, evaluated by a shared engine
-- (apps/web/src/lib/clinical-rules/) rather than compiled into call sites.
--
-- WHAT THIS DELIBERATELY DOES NOT DO. It does not touch, replace, or
-- re-route ANY of the existing live clinical-safety triggers. Every alert
-- generator listed in 20260828014055 keeps running exactly as it does today.
-- Rewiring nine live patient-safety pathways onto a brand-new engine in the
-- same change that introduces the engine would be indefensible; instead the
-- engine ships alongside them and its seeded rules ship in SHADOW mode
-- (§32.13, part 6), so it observes and records what it *would* have done
-- without emitting a single patient-visible action. Migrating a pathway off
-- its hardcoded trigger and onto a signed rule is a later, per-pathway,
-- individually-reviewed change.
--
-- GOVERNANCE POSTURE. Unlike alert_rules/escalation_slas (one jsonb document
-- per version, first version ships active-but-unsigned), a rule here can
-- never reach `active` without a Clinical Director signature -- enforced by
-- the CHECK below, not by convention. That asymmetry is deliberate: those
-- two tables transcribed configuration that was ALREADY live in production,
-- so shipping them active preserved the status quo. Every rule here is new
-- decision logic that has never run, so "unsigned means it cannot act" is
-- the correct default. `shadow` needs no signature (it cannot affect a
-- patient) and `draft` needs none either.
--
-- CONDITIONS ARE DATA, NEVER CODE. population/conditions are the existing
-- predicate DSL from apps/web/src/lib/rules/predicate.ts -- the same safe,
-- fail-closed jsonb predicates already used by risk_questionnaire_configs
-- and prevention_campaigns.eligibility_rule. No code strings, no eval, no
-- new Function: a signed clinical config can never smuggle arbitrary code
-- execution into the app process. See that file's header for the guarantees.

-- ---------------------------------------------------------------------------
-- Taxonomy
-- ---------------------------------------------------------------------------

-- §32.5 rule categories, verbatim.
create type public.clinical_rule_category as enum (
  'preventive',   -- screening due
  'monitoring',   -- measurement overdue
  'diagnostic',   -- result abnormal
  'medication',   -- monitoring required
  'referral',     -- specialist review needed
  'engagement',   -- patient disengaging
  'operational'   -- appointment failure
);

-- §32.3 "clinical domain". Kept separate from category on purpose: category
-- is what KIND of rule this is, domain is what clinical area it belongs to,
-- and governance needs to slice both ways ("show me every diabetes rule",
-- "show me every medication rule"). Mirrors care_plan_condition where the
-- domains overlap, plus the cross-cutting domains that are not a condition.
create type public.clinical_rule_domain as enum (
  'hypertension', 'diabetes', 'asthma', 'copd', 'ckd', 'heart_failure',
  'cardiovascular', 'obesity', 'mental_health', 'maternal_health',
  'preventive_screening', 'medication_safety', 'care_coordination',
  'engagement', 'operational', 'general'
);

-- §32.7 event architecture. One value per platform event a rule may trigger
-- on. Extended by migration, never inferred: an event type the engine does
-- not know about must not silently become a no-op trigger.
create type public.clinical_rule_event_type as enum (
  'patient_registered',
  'patient_enrolled_in_programme',
  'vital_recorded',
  'lab_result_received',
  'screening_result_received',
  'medication_prescribed',
  'medication_dispensed',
  'medication_dose_missed',
  'appointment_completed',
  'appointment_missed',
  'referral_created',
  'referral_status_changed',
  'monitoring_overdue',
  'symptom_reported',
  'risk_score_updated',
  'care_plan_updated',
  'consultation_completed'
);

-- §32.8 action types, verbatim.
create type public.clinical_rule_action_type as enum (
  'notification',
  'task',
  'appointment_recommendation',
  'monitoring_schedule',
  'education_recommendation',
  'referral_recommendation',
  'escalation',
  'care_plan_update'
);

-- Lifecycle: draft -> shadow -> active, with retired/rolled_back as the two
-- terminal states (§32.13 shadow mode, §32.15 rollback).
create type public.clinical_rule_status as enum (
  'draft', 'shadow', 'active', 'retired', 'rolled_back'
);

-- ---------------------------------------------------------------------------
-- clinical_rules — the versioned rule catalogue (§32.3)
-- ---------------------------------------------------------------------------
--
-- Append-mostly, in the same spirit as protocol_versions: a rule is never
-- edited once it leaves `draft` (enforced by the guard trigger below).
-- Changing a rule means writing the next version of the same rule_key and
-- signing it, which is what makes §32.15's rollback meaningful -- the
-- previous version is still there, intact, exactly as it was signed.
--
-- organisation_id is NULLABLE here, which is a deliberate, documented
-- exception to the platform-wide "every table has organisation_id" rule. A
-- null means a platform-wide rule (the normal case -- clinical protocols are
-- not per-tenant), matching the posture alert_rules and escalation_slas
-- already take for platform clinical governance. A non-null organisation_id
-- is an org-specific rule, which §32.9 treats as MORE specific than the
-- platform default. Every row the engine *writes* (events, executions,
-- actions) still carries a non-null organisation_id and is still filtered by
-- it -- the exception is confined to the definition catalogue itself.

create table public.clinical_rules (
  id                       uuid primary key default gen_random_uuid(),

  -- §32.3 rule ID: a stable slug identifying the rule across all its
  -- versions (e.g. 'htn_repeated_high_home_bp_review'). NOT the uuid --
  -- the uuid identifies one version, this identifies the rule.
  rule_key                 text not null,
  version                  integer not null check (version >= 1),

  -- §32.3 name / clinical domain / category
  name                     text not null,
  description              text not null,
  category                 public.clinical_rule_category not null,
  domain                   public.clinical_rule_domain not null,

  -- §32.3 trigger: the event that makes the engine even consider this rule.
  event_type               public.clinical_rule_event_type not null,

  -- §32.3 population: which patients this rule applies to at all, as a
  -- predicate over the patient context (programme enrolment, age, sex,
  -- conditions, plan). Evaluated before conditions; a rule whose population
  -- does not match is recorded as considered-and-not-applicable, never
  -- silently skipped (see part 2's executions ledger).
  population               jsonb not null default '{"op":"true"}'::jsonb,

  -- §32.3 conditions: the clinical test itself, over the event payload
  -- merged with the patient context (e.g. count of BP readings above
  -- threshold in the last 14 days). Thresholds live HERE, as data from the
  -- approved protocol -- never as a literal in application code (§32.4).
  conditions               jsonb not null default '{"op":"true"}'::jsonb,

  -- §32.3 action: what happens when conditions are met (§32.8). A jsonb
  -- array so one rule can, for example, both create a review task and send
  -- a non-clinical patient nudge.
  actions                  jsonb not null default '[]'::jsonb,

  -- §32.9 conflict resolution. priority is the governed tie-break (higher
  -- acts first); specificity encodes the general -> specialist ->
  -- patient-specific ladder the spec names, and is compared BEFORE priority
  -- so a more specific approved rule takes precedence, as §32.9 requires.
  priority                 smallint not null default 50 check (priority between 0 and 100),
  specificity              smallint not null default 10 check (specificity between 0 and 100),

  -- §32.3 escalation: where this rule's output goes if unactioned -- the
  -- owning tier and the SLA. Data, not code, exactly as escalation_slas
  -- already established for the alert pathways.
  escalation               jsonb not null default '{}'::jsonb,

  -- §32.10 cooldown / suppression / deduplication / episode grouping.
  suppression              jsonb not null default '{}'::jsonb,

  -- §32.11 explainability. A template, not free text: the engine
  -- interpolates the concrete facts that made this rule fire, so every
  -- automated action can say exactly why it happened. NOT NULL and NOT
  -- blank by CHECK -- an unexplainable automated clinical action is not
  -- something this platform should be able to represent.
  explanation_template     text not null check (length(btrim(explanation_template)) > 0),

  -- Lifecycle + §32.3 effective date / version / owner
  status                   public.clinical_rule_status not null default 'draft',
  effective_from           timestamptz not null default now(),
  effective_to             timestamptz,

  -- §32.3 owner: the named, credentialed clinical_staff record accountable
  -- for this rule. Same posture as protocol_versions.approved_by -- it is
  -- about WHO, not which login clicked. on delete restrict: an owner's
  -- record cannot be hard-deleted once it owns a rule (deactivate instead).
  owner_clinical_staff_id  uuid references public.clinical_staff (id) on delete restrict,

  -- The signed protocol this rule implements. The whole point of §32.2 is
  -- that thresholds trace back to approved clinical governance rather than
  -- to whoever wrote the if-statement, so an ACTIVE rule must name one.
  protocol_version_id      uuid references public.protocol_versions (id) on delete restrict,

  -- Scope (§32.9 specificity ladder). Both null = platform-wide general
  -- rule; organisation_id set = org-specific; patient_id set = a
  -- patient-specific override approved for one patient.
  organisation_id          uuid references public.organisations (id) on delete restrict,
  patient_id               uuid references public.profiles (id) on delete cascade,

  -- Governed deployment (§32.16). Stamped only by public.sign_clinical_rule.
  approved_by              uuid references public.clinical_staff (id) on delete restrict,
  approved_at              timestamptz,
  activated_at             timestamptz,
  retired_at               timestamptz,
  retired_reason           text,
  rolled_back_at           timestamptz,
  rollback_reason          text,

  -- Provenance across versions: which version of this rule_key this one
  -- replaced. Lets the UI render a rule's full lineage without guessing.
  supersedes_id            uuid references public.clinical_rules (id) on delete restrict,

  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint clinical_rules_unique_version unique (rule_key, version),

  -- A rule cannot act without a signature and a protocol behind it.
  constraint clinical_rules_active_requires_signature check (
    status <> 'active'
    or (approved_by is not null and approved_at is not null and protocol_version_id is not null)
  ),
  -- A rule cannot act without a named accountable owner (§32.3).
  constraint clinical_rules_active_requires_owner check (
    status <> 'active' or owner_clinical_staff_id is not null
  ),
  constraint clinical_rules_effective_window check (
    effective_to is null or effective_to > effective_from
  ),
  -- A patient-specific rule sits at the top of the specificity ladder by
  -- definition; an org rule above a platform rule. Encoding this as a CHECK
  -- stops a mis-authored rule from claiming platform-general precedence
  -- while carrying a patient scope.
  constraint clinical_rules_specificity_matches_scope check (
    case
      when patient_id is not null then specificity >= 80
      when organisation_id is not null then specificity between 40 and 79
      else specificity < 40
    end
  ),
  -- A patient-specific rule always belongs to that patient's organisation.
  -- Without this a rule could carry a patient scope but no tenant, which
  -- would leave the SELECT policy below with nothing to filter on.
  constraint clinical_rules_patient_scope_requires_org check (
    patient_id is null or organisation_id is not null
  ),
  constraint clinical_rules_retired_has_reason check (
    status <> 'retired' or retired_reason is not null
  ),
  constraint clinical_rules_rolled_back_has_reason check (
    status <> 'rolled_back' or rollback_reason is not null
  ),
  constraint clinical_rules_actions_is_array check (jsonb_typeof(actions) = 'array'),
  constraint clinical_rules_population_is_object check (jsonb_typeof(population) = 'object'),
  constraint clinical_rules_conditions_is_object check (jsonb_typeof(conditions) = 'object')
);

-- At most one live version per rule_key in each of the two acting states.
-- Two separate partial indexes rather than one: §32.13's whole point is that
-- a NEW version runs in shadow WHILE the current one stays active, so those
-- two must be allowed to coexist -- but never two actives, and never two
-- shadows racing each other.
create unique index clinical_rules_one_active_per_key
  on public.clinical_rules (rule_key) where status = 'active';
create unique index clinical_rules_one_shadow_per_key
  on public.clinical_rules (rule_key) where status = 'shadow';

-- The engine's hot path: "every rule that could fire for this event type".
create index clinical_rules_dispatch_idx
  on public.clinical_rules (event_type, status)
  where status in ('active', 'shadow');
create index clinical_rules_org_idx on public.clinical_rules (organisation_id) where organisation_id is not null;
create index clinical_rules_patient_idx on public.clinical_rules (patient_id) where patient_id is not null;
create index clinical_rules_owner_idx on public.clinical_rules (owner_clinical_staff_id);
create index clinical_rules_protocol_idx on public.clinical_rules (protocol_version_id);
create index clinical_rules_supersedes_idx on public.clinical_rules (supersedes_id);
create index clinical_rules_key_version_idx on public.clinical_rules (rule_key, version desc);

create trigger clinical_rules_set_updated_at
  before update on public.clinical_rules
  for each row execute function private.set_updated_at();

comment on table public.clinical_rules is
  'Governed, versioned clinical decision rules (spec §32.3). One row per VERSION of a rule; rule_key identifies the rule across versions. Conditions/population are predicate-DSL jsonb (apps/web/src/lib/rules/predicate.ts) -- data, never code. A rule cannot reach status=active without a Clinical Director signature and a protocol_version_id (CHECK-enforced), and cannot be edited once it leaves draft (private.guard_clinical_rule_immutable).';
comment on column public.clinical_rules.rule_key is
  'Stable slug identifying the rule across every version of it (§32.3 "rule ID"). The uuid id identifies one version; this identifies the rule.';
comment on column public.clinical_rules.specificity is
  '§32.9 general -> specialist -> patient-specific ladder. Compared BEFORE priority when two rules produce conflicting actions, so the more specific approved rule wins. CHECK-tied to scope: <40 platform, 40-79 organisation, >=80 patient-specific.';
comment on column public.clinical_rules.suppression is
  '§32.10. {cooldown_hours, dedup_key_fields[], episode_key_fields[], max_per_episode}. Read by the engine before any action is emitted; every suppressed evaluation is still recorded in clinical_rule_executions, so suppression is visible rather than silent.';
comment on column public.clinical_rules.explanation_template is
  '§32.11. Interpolated with the concrete facts of the evaluation to produce the human-readable reason attached to every action this rule emits. Required and non-blank by CHECK: an unexplainable automated clinical action must not be representable.';

-- ---------------------------------------------------------------------------
-- Immutability guard
-- ---------------------------------------------------------------------------
--
-- Auditability (§32.16) only means anything if a signed rule cannot be
-- quietly rewritten under its own version number. Once a rule leaves draft,
-- the definitional columns freeze; only lifecycle columns may move. This is
-- the same discipline protocol_versions gets from having no UPDATE policy at
-- all -- but clinical_rules genuinely does need lifecycle updates (draft ->
-- shadow -> active -> retired), so it needs a trigger rather than a blanket
-- denial.
--
-- Deliberately a trigger and not just an RLS policy: a policy would be
-- bypassed by the SECURITY DEFINER governance RPCs in part 3 and by the
-- service-role client the cron runs as, which are exactly the callers that
-- must ALSO be unable to rewrite a signed rule's clinical content.

create or replace function private.guard_clinical_rule_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'draft' then
    return new;
  end if;

  if new.rule_key is distinct from old.rule_key
     or new.version is distinct from old.version
     or new.category is distinct from old.category
     or new.domain is distinct from old.domain
     or new.event_type is distinct from old.event_type
     or new.population is distinct from old.population
     or new.conditions is distinct from old.conditions
     or new.actions is distinct from old.actions
     or new.priority is distinct from old.priority
     or new.specificity is distinct from old.specificity
     or new.escalation is distinct from old.escalation
     or new.suppression is distinct from old.suppression
     or new.explanation_template is distinct from old.explanation_template
     or new.effective_from is distinct from old.effective_from
     or new.organisation_id is distinct from old.organisation_id
     or new.patient_id is distinct from old.patient_id
     or new.protocol_version_id is distinct from old.protocol_version_id
     or new.owner_clinical_staff_id is distinct from old.owner_clinical_staff_id
  then
    raise exception
      'clinical_rules % v% has left draft (status=%): its definition is immutable. Author the next version of this rule_key and sign that instead.',
      old.rule_key, old.version, old.status;
  end if;

  -- A signature, once given, is not transferable or erasable either.
  if old.approved_by is not null
     and (new.approved_by is distinct from old.approved_by
          or new.approved_at is distinct from old.approved_at)
  then
    raise exception 'clinical_rules % v% is already signed; a signature cannot be reassigned or cleared.',
      old.rule_key, old.version;
  end if;

  return new;
end;
$$;

create trigger clinical_rules_guard_immutable
  before update on public.clinical_rules
  for each row execute function private.guard_clinical_rule_immutable();

comment on function private.guard_clinical_rule_immutable() is
  'Freezes a clinical rule''s definition (and its signature) once it leaves draft, so a signed rule can only be changed by authoring and signing a new version -- which is what makes §32.15 rollback meaningful. A trigger rather than an RLS policy on purpose: the SECURITY DEFINER governance RPCs and the service-role cron client must be bound by it too.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.clinical_rules enable row level security;

-- Platform-wide rules (organisation_id null, which by the CHECK above also
-- means patient_id null) are readable by any authenticated user -- the same
-- posture alert_rules and condition_protocols already take for platform
-- clinical governance content. They carry protocol thresholds, not PHI, and
-- a clinician must be able to see the rule behind an action they are being
-- asked to take (§32.11). Anything tenant-scoped -- and every
-- patient-specific rule, which the CHECK forces to carry an
-- organisation_id -- is org-staff only.
create policy clinical_rules_select on public.clinical_rules
  for select to authenticated
  using (organisation_id is null or private.is_org_staff(organisation_id));

-- Anyone with admin can PROPOSE a draft. Only public.sign_clinical_rule /
-- promote / rollback (part 3, Clinical-Director-gated) can move it beyond
-- draft or attach a signature, so an admin cannot self-activate clinical
-- logic.
create policy clinical_rules_insert on public.clinical_rules
  for insert to authenticated
  with check (
    private.is_admin()
    and status = 'draft'
    and approved_by is null
    and approved_at is null
    and activated_at is null
  );

-- Drafts stay editable by an admin (that is what a draft is for). The guard
-- trigger above makes this a no-op for everything past draft, and the
-- with-check keeps an update from being used as a back-door activation.
create policy clinical_rules_update_draft on public.clinical_rules
  for update to authenticated
  using (private.is_admin() and status = 'draft')
  with check (
    private.is_admin()
    and status = 'draft'
    and approved_by is null
    and approved_at is null
    and activated_at is null
  );

-- No delete policy: an unwanted draft is retired, not erased.

-- RLS restricts rows; it does not grant table access. A table created by a
-- plain migration needs its own grant (this has silently broken access on
-- this project at least three times -- see CLAUDE.md).
grant select, insert, update on public.clinical_rules to authenticated;
