-- Tarragon Health
-- Clinical cockpit, phase 1: protocol-derived review actions a doctor
-- CONFIRMS rather than composes.
--
-- WHY THIS EXISTS. A doctor's minutes on a case are spent overwhelmingly on
-- reading, synthesising, and then hand-composing the same handful of
-- protocol-standard actions -- not on the judgment itself. case_briefs
-- (20260730121004) already collapsed the reading half. This table collapses
-- the composing half: the server pre-computes the small set of actions the
-- SIGNED protocol already implies for this case, and the doctor's job
-- becomes confirm / adjust / dismiss with a reason. The judgment stays
-- entirely human; only the typing goes away.
--
-- THE SAFETY LINE, and it is a hard one:
--
--   * NO ACTION HERE IS EVER AUTHORED BY AN AI. case_briefs is an LLM
--     surface; this table is not, and must never become one. Every row is
--     emitted by a deterministic rule engine reading a Clinical
--     Director-signed protocol_versions row (lib/case-cockpit/propose.ts).
--     `source` carries a CHECK pinning it to 'protocol_rule' so admitting an
--     AI-authored action would require a deliberate migration that a reviewer
--     cannot miss, not a quiet insert from new app code. The LLM's drafted
--     prose reaches a doctor only through case_briefs.draft_review_note,
--     which is text they read and edit -- never a pre-selected action.
--
--   * A PROPOSAL IS NOT A DECISION. Rows are born 'proposed' and do nothing.
--     No trigger, job, or downstream read treats a 'proposed' row as
--     clinically meaningful. Confirming is the only thing that writes to the
--     patient record, and confirming is always an explicit human act.
--
--   * ATTRIBUTION IS STRUCTURAL, NOT COSMETIC. A confirmed row cannot exist
--     without a named, active clinical_staff signer -- see the CHECK
--     constraint plus enforce_case_review_action_attribution, which derives
--     the signer server-side from the caller's own staff row rather than
--     trusting anything the client sends. This is what lets the UI render
--     "Confirmed by Dr X" under CLAUDE.md's null-gating rule without ever
--     rendering a claim the data cannot back.
--
--   * AUTHORITY IS CHECKED AT CONFIRM TIME, BY THE DATABASE. required_authority
--     routes each action to the same private.* functions that already gate the
--     underlying write (has_prescribing_authority,
--     can_handle_emergency_escalation, can_confirm_medication_refill). The gate
--     here is defence in depth and a friendly early refusal -- the real writes
--     downstream remain independently gated by their own policies, so a bug in
--     this table can never widen anyone's authority.
--
--   * TERMINAL MEANS TERMINAL. Once confirmed/modified/dismissed a row is
--     immutable, same no-retroactive-attribution discipline as
--     protocol_versions and escalations.reviewed_by. Changing your mind means
--     a new action, not an edited history.
--
-- KEYED BY clinician_alert_id, not escalation_id -- deliberately matching
-- case_briefs (20260730123735). One case is one alert; whether a doctor was
-- pulled in via the clinician worklist (no escalation row exists yet) or the
-- escalation queue, it is the same case and must not accumulate two
-- divergent sets of proposed actions.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Every value maps to a REAL, already-shipped write path. Nothing here is a
-- placeholder: an action a doctor can confirm that does not actually change
-- the patient record would be worse than no action at all, because it reads
-- as done. The mapping is asserted in lib/case-cockpit/actions.ts, whose
-- exhaustive switch will fail to compile if a value is added here without a
-- corresponding write.
create type public.case_review_action_type as enum (
  'log_review_note',            -- -> escalation_notes insert
  'schedule_follow_up',         -- -> escalation_notes.next_follow_up_at
  'confirm_medication_refill',  -- -> medications.refill_date
  'order_investigation',        -- -> lab_orders (origin 'clinically_triggered')
  'resolve_case'                -- -> escalations.status/resolution_note/reviewed_by
);

create type public.case_review_action_status as enum (
  'proposed',    -- born here; clinically inert
  'confirmed',   -- doctor accepted the proposal as-is
  'modified',    -- doctor accepted after editing the payload
  'dismissed',   -- doctor rejected it, with a reason
  'superseded'   -- a later proposal run replaced this one (never human-set)
);

-- Which private.* authority function must pass before this action may be
-- confirmed. Named for the CLINICAL ACT, not the tier, so the tier lists stay
-- in one place (the private.* functions) and this enum does not quietly become
-- a second, drifting copy of the ladder.
create type public.case_review_authority as enum (
  'any_clinical_tier',      -- any clinical tier; care_coordinator still excluded
  'refill_confirmation',    -- private.can_confirm_medication_refill
  'prescribing',            -- private.has_prescribing_authority
  'emergency_resolution'    -- private.can_handle_emergency_escalation
);

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.case_review_actions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id),
  clinician_alert_id uuid not null references public.clinician_alerts (id) on delete cascade,
  patient_id uuid not null references public.profiles (id),

  action_type public.case_review_action_type not null,
  status public.case_review_action_status not null default 'proposed',

  -- Pinned to the one legal value. See the header: this is the structural
  -- guarantee that no AI-authored action can reach a doctor's confirm button.
  source text not null default 'protocol_rule',
  constraint case_review_actions_source_is_protocol_rule
    check (source = 'protocol_rule'),

  -- The signed protocol version this proposal was derived from. NULLABLE and
  -- null-gated on purpose: when a condition has no signed protocol yet, the
  -- engine may still propose the condition-agnostic actions (a review note,
  -- a follow-up), and the UI must then say so plainly rather than imply a
  -- protocol backing that does not exist. on delete restrict mirrors
  -- protocol_versions' own immutability -- a signed version that has driven a
  -- clinical action cannot be deleted out from under the audit trail.
  protocol_version_id uuid references public.protocol_versions (id) on delete restrict,

  -- Deterministic, human-readable statement of WHY this rule fired, written
  -- by the rule engine, never by a model. This is what a doctor reads to
  -- decide whether to trust the proposal, and what an auditor reads later.
  rationale text not null,

  -- What the action would do, in the shape the corresponding write needs.
  proposed_payload jsonb not null default '{}'::jsonb,
  -- What was ACTUALLY executed. Equal to proposed_payload for 'confirmed';
  -- differs for 'modified' -- keeping both is the whole point, it is the
  -- record of where the protocol-derived default was not right for this
  -- patient, and the only signal that would ever justify changing the rule.
  confirmed_payload jsonb,

  required_authority public.case_review_authority not null default 'any_clinical_tier',

  -- --- attribution: never client-supplied, always trigger-derived ---------
  confirmed_by uuid references public.profiles (id) on delete restrict,
  confirmed_by_staff uuid references public.clinical_staff (id) on delete restrict,
  confirmed_at timestamptz,
  -- The signer's tier AT THE MOMENT OF SIGNING. Denormalised deliberately:
  -- clinical_staff.doctor_tier is mutable (people get promoted), and an audit
  -- of "who was allowed to do this, then" must not silently re-answer itself
  -- when it changes. Same reasoning as storing case_briefs.input_snapshot.
  confirmed_at_tier public.doctor_tier,

  -- Where the confirmed action landed, so the audit trail is traversable in
  -- both directions. Free-form (table name, row id) rather than five nullable
  -- FKs -- the referenced tables have no common supertype.
  result_table text,
  result_id uuid,

  dismissed_by_staff uuid references public.clinical_staff (id) on delete restrict,
  dismissed_at timestamptz,
  dismissal_reason text,

  proposed_at timestamptz not null default now(),
  -- Version of the rule engine that emitted this row. When a rule changes,
  -- this is what distinguishes "the doctor disagreed" from "an older engine
  -- proposed something we no longer would".
  engine_version integer not null,

  -- Attribution is structurally impossible to omit: a terminal accepted state
  -- cannot exist without a named signer, a timestamp, and the payload that was
  -- actually run. This is the constraint the UI's null-gating relies on.
  constraint case_review_actions_accepted_requires_attribution check (
    status not in ('confirmed', 'modified')
    or (
      confirmed_by is not null
      and confirmed_by_staff is not null
      and confirmed_at is not null
      and confirmed_payload is not null
    )
  ),
  constraint case_review_actions_dismissed_requires_reason check (
    status <> 'dismissed'
    or (
      dismissed_by_staff is not null
      and dismissed_at is not null
      and dismissal_reason is not null
      and length(btrim(dismissal_reason)) > 0
    )
  ),
  -- A still-proposed row must carry no attribution at all. Without this an
  -- insert could pre-stamp a signer and then be "confirmed" later by nobody.
  constraint case_review_actions_proposed_is_clean check (
    status <> 'proposed'
    or (
      confirmed_by is null
      and confirmed_by_staff is null
      and confirmed_at is null
      and confirmed_at_tier is null
      and confirmed_payload is null
      and dismissed_by_staff is null
      and dismissed_at is null
    )
  )
);

comment on table public.case_review_actions is
  'Protocol-derived clinical actions proposed to a doctor for confirmation. Deterministic rule-engine output only -- never AI-authored (see the source CHECK). A row does nothing until a named, tier-authorised clinician confirms it; confirmation is immutable thereafter.';
comment on column public.case_review_actions.source is
  'Pinned to protocol_rule by CHECK. Admitting an AI-authored action would require a deliberate migration -- that is the point.';
comment on column public.case_review_actions.confirmed_at_tier is
  'The signer''s doctor_tier at signing time, denormalised so a later promotion cannot retroactively change what authority the action was taken under.';
comment on column public.case_review_actions.confirmed_payload is
  'What actually ran. Differs from proposed_payload exactly when the doctor edited the proposal -- the only reliable signal that a protocol default is wrong in practice.';

-- One live proposal of a given type per case. A re-run supersedes rather than
-- duplicates, so a doctor never sees the same suggestion twice. Partial, since
-- terminal rows are history and may legitimately repeat.
create unique index case_review_actions_one_live_per_type
  on public.case_review_actions (clinician_alert_id, action_type)
  where status = 'proposed';

create index case_review_actions_alert_idx
  on public.case_review_actions (clinician_alert_id, status);
create index case_review_actions_patient_idx
  on public.case_review_actions (patient_id, proposed_at desc);
create index case_review_actions_confirmed_by_staff_idx
  on public.case_review_actions (confirmed_by_staff)
  where confirmed_by_staff is not null;

-- ---------------------------------------------------------------------------
-- Trigger: derive attribution server-side, gate authority, freeze history
-- ---------------------------------------------------------------------------

create or replace function private.enforce_case_review_action_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_tier public.doctor_tier;
  v_is_director boolean;
  v_authorised boolean;
begin
  -- INSERT: a proposal is inert by definition. Force it, rather than trusting
  -- the caller -- inserts are service-role-only today, but this table must
  -- stay safe if that ever changes.
  if tg_op = 'INSERT' then
    new.status := 'proposed';
    new.confirmed_by := null;
    new.confirmed_by_staff := null;
    new.confirmed_at := null;
    new.confirmed_at_tier := null;
    new.confirmed_payload := null;
    new.dismissed_by_staff := null;
    new.dismissed_at := null;
    new.dismissal_reason := null;
    new.result_table := null;
    new.result_id := null;
    return new;
  end if;

  -- 'superseded' is bookkeeping by the proposal engine (service role), not a
  -- clinical act -- it needs no signer and is the one transition that may
  -- leave a proposed row without attribution.
  if new.status = 'superseded' then
    if old.status <> 'proposed' then
      raise exception 'Only a still-proposed action can be superseded (this one is already %).', old.status;
    end if;
    return new;
  end if;

  -- No retroactive attribution: a decided action is history.
  if old.status <> 'proposed' then
    raise exception 'This action was already % and cannot be changed. Propose a new action instead.', old.status;
  end if;

  if new.status = 'proposed' then
    raise exception 'A proposed action may only move to confirmed, modified, dismissed, or superseded.';
  end if;

  -- The signer is always the caller's own active clinical_staff row in THIS
  -- organisation. Nothing the client sent is trusted; whatever it sent for the
  -- attribution columns is overwritten below.
  select id, doctor_tier, is_clinical_director
    into v_staff_id, v_tier, v_is_director
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active
  limit 1;

  if v_staff_id is null then
    raise exception 'Only an active clinical staff member in this organisation can act on a review action.';
  end if;

  -- Care Coordinator is a doctor_tier value but is explicitly non-clinical
  -- (CLAUDE.md, Clinical Tier Ladder). Excluded BY NAME here, and separately
  -- from the tier lists inside the private.* authority functions, so that a
  -- tier added to the enum later is never admitted by accident.
  if v_tier = 'care_coordinator' then
    raise exception 'A Care Coordinator can review and route a case but cannot confirm a clinical action on it.';
  end if;

  -- An unset tier means "needs an admin to assign one" -- never a default.
  if v_tier is null and not coalesce(v_is_director, false) then
    raise exception 'Your clinical record has no tier assigned yet, so clinical actions are unavailable. Ask an administrator to set your tier.';
  end if;

  if new.status = 'dismissed' then
    new.dismissed_by_staff := v_staff_id;
    new.dismissed_at := now();
    new.confirmed_by := null;
    new.confirmed_by_staff := null;
    new.confirmed_at := null;
    new.confirmed_at_tier := null;
    new.confirmed_payload := null;
    return new;
  end if;

  -- --- confirmed / modified: check authority for this clinical act ---------
  v_authorised := case new.required_authority
    when 'any_clinical_tier'     then true  -- care_coordinator already refused above
    when 'refill_confirmation'   then private.can_confirm_medication_refill(new.organisation_id)
    when 'prescribing'           then private.has_prescribing_authority(new.organisation_id)
    when 'emergency_resolution'  then private.can_handle_emergency_escalation(new.organisation_id)
  end;

  if not coalesce(v_authorised, false) then
    raise exception 'This action needs a higher level of clinical authority than your record carries (%). You can still add a note and hand the case to a senior colleague.',
      new.required_authority;
  end if;

  new.confirmed_by := (select auth.uid());
  new.confirmed_by_staff := v_staff_id;
  new.confirmed_at := now();
  new.confirmed_at_tier := v_tier;
  new.dismissed_by_staff := null;
  new.dismissed_at := null;
  new.dismissal_reason := null;
  -- 'confirmed' means accepted verbatim; the client does not get to claim that
  -- while silently substituting a different payload.
  if new.status = 'confirmed' then
    new.confirmed_payload := old.proposed_payload;
  elsif new.confirmed_payload is null then
    raise exception 'A modified action must carry the payload that was actually used.';
  end if;

  -- The proposal itself is the rule engine's output and is never rewritten by
  -- the act of confirming it.
  new.proposed_payload := old.proposed_payload;
  new.action_type := old.action_type;
  new.required_authority := old.required_authority;
  new.protocol_version_id := old.protocol_version_id;
  new.rationale := old.rationale;
  new.source := old.source;

  return new;
end;
$$;

comment on function private.enforce_case_review_action_attribution() is
  'Derives case_review_actions attribution from the caller''s own active clinical_staff row, enforces required_authority via the existing private.* authority functions, and freezes decided rows. The enforcement boundary -- app-layer tier checks are friendly UI only.';

create trigger case_review_actions_enforce_attribution
  before insert or update on public.case_review_actions
  for each row execute function private.enforce_case_review_action_attribution();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.case_review_actions enable row level security;

-- Read: any org staff member working the case. Patients never see this table
-- (these are internal clinical decisions in flight, not results).
create policy case_review_actions_select on public.case_review_actions
  for select to authenticated
  using (private.is_org_staff(organisation_id));

-- Update: org staff may act on a proposal. Deliberately broad here and
-- narrowed by the trigger above -- the gate depends on required_authority and
-- on the caller's tier, which is a lookup an RLS policy should not be
-- carrying. Same "RLS admits, trigger narrows" shape as
-- enforce_medication_confirm_only and enforce_emergency_escalation_tier.
create policy case_review_actions_update on public.case_review_actions
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

-- No INSERT or DELETE policy, deliberately: proposals come only from the
-- service-role rule engine, and nothing is ever deleted (dismissal is a
-- status, so "the doctor said no" stays on the record). Same service-role-
-- write-only precedent as case_briefs and payment_transactions.

-- A freshly created table needs its own grant -- RLS restricts rows, it does
-- not grant table access. Stated explicitly even though
-- alter-default-privileges now covers this, because getting it wrong looks
-- like an empty result rather than an error (CLAUDE.md standing lesson).
grant select, update on public.case_review_actions to authenticated;

-- alter-default-privileges (20260731232749) grants authenticated
-- select/insert/update/delete on every new table by default, precisely so a
-- table never silently ends up unreachable. This table is the deliberate
-- exception: proposals come only from the service-role rule engine and
-- nothing is ever deleted, so the INSERT/DELETE default grants are revoked
-- here rather than left to RLS alone -- the assertions below check the raw
-- table privilege, not just the absence of a policy, so this table can never
-- be inserted into or deleted from by an ordinary session even if a future
-- RLS change went wrong.
revoke insert, delete on public.case_review_actions from authenticated;

-- ---------------------------------------------------------------------------
-- case_briefs: ground the brief in the signed protocol, and draft the note
-- ---------------------------------------------------------------------------

-- All nullable and null-gated. A brief for a condition with no signed
-- protocol is still useful; what it must never do is imply a protocol backing
-- it does not have -- so the UI reads protocol_version_id, not a boolean.
alter table public.case_briefs
  add column if not exists protocol_version_id uuid
    references public.protocol_versions (id) on delete restrict,
  add column if not exists protocol_slug text,
  add column if not exists draft_review_note text;

comment on column public.case_briefs.protocol_version_id is
  'The Clinical Director-signed protocol version this brief was drafted against, or NULL when the patient''s condition has no signed protocol. Null-gated in the UI -- never render a protocol claim without this.';
comment on column public.case_briefs.draft_review_note is
  'LLM-drafted review note for the doctor to read, edit and confirm. Prose only -- it is never itself an action; confirming happens through case_review_actions.';

-- ---------------------------------------------------------------------------
-- Assertions -- "shipped" should be provable, not hopeful
-- ---------------------------------------------------------------------------

do $$
declare
  v_count integer;
begin
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'case_review_actions'
  ) then
    raise exception 'case_review_actions missing after migration';
  end if;

  -- Service-role-only writes: read and update from a session, nothing else.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'case_review_actions'
      and cmd in ('INSERT', 'DELETE')
  ) then
    raise exception 'case_review_actions must have no INSERT/DELETE policy -- proposals are service-role only';
  end if;

  select count(*) into v_count
  from pg_policies
  where schemaname = 'public' and tablename = 'case_review_actions'
    and cmd in ('SELECT', 'UPDATE');
  if v_count <> 2 then
    raise exception 'case_review_actions expected exactly one SELECT and one UPDATE policy, found %', v_count;
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.case_review_actions'::regclass
      and tgname = 'case_review_actions_enforce_attribution'
      and not tgisinternal
  ) then
    raise exception 'case_review_actions attribution trigger missing';
  end if;

  -- The grant, checked explicitly -- its absence is silent (empty results).
  if not has_table_privilege('authenticated', 'public.case_review_actions', 'SELECT') then
    raise exception 'authenticated lacks SELECT on case_review_actions';
  end if;
  if not has_table_privilege('authenticated', 'public.case_review_actions', 'UPDATE') then
    raise exception 'authenticated lacks UPDATE on case_review_actions';
  end if;
  if has_table_privilege('authenticated', 'public.case_review_actions', 'INSERT') then
    raise exception 'authenticated must not hold INSERT on case_review_actions';
  end if;

  -- The AI-cannot-author-an-action guarantee.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.case_review_actions'::regclass
      and conname = 'case_review_actions_source_is_protocol_rule'
  ) then
    raise exception 'case_review_actions source CHECK missing -- the no-AI-authored-action guarantee is gone';
  end if;

  -- The attribution guarantee the UI null-gates on.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.case_review_actions'::regclass
      and conname = 'case_review_actions_accepted_requires_attribution'
  ) then
    raise exception 'case_review_actions attribution CHECK missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'case_briefs'
      and column_name = 'protocol_version_id'
  ) then
    raise exception 'case_briefs.protocol_version_id missing after migration';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'case_briefs'
      and column_name = 'draft_review_note'
  ) then
    raise exception 'case_briefs.draft_review_note missing after migration';
  end if;
end $$;
