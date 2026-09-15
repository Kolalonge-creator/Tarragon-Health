-- Tarragon Health — Clinical Decision Support: the clinician's decision on a
-- recommendation (spec §38.12 clinician override, §38.14 documented outcome).
--
-- The platform already computes plenty of decision support (drug-safety
-- interactions/duplicate therapy/allergy cross-checks, HBPM target comparison,
-- drug-triggered lab monitoring, medication-review cadences). What it has never
-- had is the other half of §38: a record that a named clinician SAW a specific
-- recommendation and decided something about it. Without that:
--   * §38.12's "important overrides should record reason, clinician, timestamp"
--     is unimplementable;
--   * §38.11's alert-fatigue rule has nothing to suppress against, so the same
--     advisory is re-shown at every consultation forever;
--   * §38.14's "documented outcome" closes on nothing.
--
-- DESIGN NOTES
--
-- 1. APPEND-ONLY. A change of mind is a NEW row, never an edit — there is no
--    update or delete policy and no update/delete grant, so RLS denies both.
--    Same reasoning as clinician_alerts.level: the system's own output and the
--    human's response to it are both permanent record.
--
-- 2. THE RECOMMENDATION IS NOT A TABLE. Recommendations are DERIVED, freshly,
--    from the record on every page load by the pure engine in
--    apps/web/src/lib/cds/engine.ts — persisting them would create a second
--    source of truth that drifts from the medications/vitals/labs it is derived
--    from. This table therefore stores a stable `recommendation_key` plus a
--    SNAPSHOT of what was shown (title, trigger text, source label), so the
--    audit record stays readable years later even after the rule text changes.
--
-- 3. THE FINGERPRINT IS THE FATIGUE CONTROL. `recommendation_fingerprint` is the
--    engine's hash of the material clinical facts behind the recommendation (the
--    medication ids in an interaction, the due date of a monitoring item, whether
--    the BP average is above target). A decision suppresses its recommendation
--    only while the fingerprint still matches. When the underlying facts change
--    the recommendation resurfaces — so §38.11's "avoid 25 alerts" never becomes
--    "silently swallow a changed clinical picture" (CLAUDE.md's never-list).
--
-- 4. ATTRIBUTION IS SERVER-DERIVED, never client-supplied — same forge-proof
--    discipline as medication_reviews.reviewed_by and clinician_alerts.
--    overridden_by. A Care Coordinator holds an active clinical_staff row but is
--    explicitly non-clinical (CLAUDE.md, Clinical Tier Ladder), so the trigger
--    refuses them by name — deciding on a clinical recommendation is exactly the
--    clinical judgment call they must never make. They keep READ access, which
--    is what their logistics work needs.
--
-- 5. ADVISORY, NEVER A BLOCK. Nothing here can stop a prescription or close an
--    escalation; recording a decision only documents what the clinician chose.

-- --- decision vocabulary -----------------------------------------------------
-- 'accepted'   — agrees, will act (the plan changes, action recorded elsewhere)
-- 'actioned'   — acted on it now, with the outcome noted (§38.14)
-- 'overridden' — declines the recommendation; REASON REQUIRED (§38.12)
-- 'deferred'   — not now; REASON REQUIRED, and it comes back at suppress_until
do $$ begin
  if not exists (select 1 from pg_type where typname = 'cds_decision') then
    create type public.cds_decision as enum ('accepted', 'actioned', 'overridden', 'deferred');
  end if;
end $$;

create table if not exists public.cds_recommendation_decisions (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  patient_id                  uuid not null references public.profiles (id) on delete cascade,

  -- Stable identity of the recommendation, e.g. 'bp_uncontrolled' or
  -- 'interaction:ace_inhibitor+arb'. Set by the engine, opaque to the database.
  recommendation_key          text not null,
  -- The material clinical facts behind it, per design note 3.
  recommendation_fingerprint  text not null,

  -- Snapshot of what the clinician actually saw, so this row stays legible
  -- after the rule text is reworded or retired.
  category                    text not null,
  priority                    text not null,
  title                       text not null,
  trigger_text                text not null,   -- §38.13 "Why am I seeing this?"
  source_label                text not null,   -- §38.5 the visible guideline source

  decision                    public.cds_decision not null,
  override_reason             text,
  -- Documented outcome (§38.14). Free text; optional on every decision except
  -- where the reason check below already demands an explanation.
  outcome_note                text,
  -- Only meaningful for 'deferred': when the recommendation comes back.
  suppress_until              timestamptz,

  decided_by                  uuid not null references public.clinical_staff (id) on delete restrict,
  decided_by_profile          uuid not null references public.profiles (id) on delete restrict,
  decided_at                  timestamptz not null default now(),
  created_at                  timestamptz not null default now(),

  -- §38.12: an override or a deferral is a clinician disagreeing with the
  -- system, and must say why. Agreement needs no justification.
  constraint cds_decisions_reason_required check (
    decision not in ('overridden', 'deferred')
    or (override_reason is not null and length(btrim(override_reason)) > 0)
  ),
  -- A deferral that never comes back is a silent dismissal wearing a different
  -- name. Make the return date structural.
  constraint cds_decisions_deferral_returns check (
    decision <> 'deferred' or suppress_until is not null
  )
);

-- The read path is always "every decision for this patient, newest first" —
-- the engine reconciles them against freshly derived recommendations in TS.
create index if not exists cds_recommendation_decisions_patient_idx
  on public.cds_recommendation_decisions (patient_id, decided_at desc);
create index if not exists cds_recommendation_decisions_org_idx
  on public.cds_recommendation_decisions (organisation_id, decided_at desc);
create index if not exists cds_recommendation_decisions_staff_idx
  on public.cds_recommendation_decisions (decided_by, decided_at desc);

comment on table public.cds_recommendation_decisions is
  'Append-only record of a clinician''s decision on a Clinical Decision Support recommendation (spec 38.12 override, 38.14 documented outcome). Recommendations themselves are derived, never stored; recommendation_key + recommendation_fingerprint tie a decision to the exact advisory and the exact clinical facts behind it.';
comment on column public.cds_recommendation_decisions.recommendation_fingerprint is
  'Hash of the material clinical facts behind the recommendation. A decision suppresses its recommendation only while this still matches, so a changed clinical picture always resurfaces rather than staying dismissed.';
comment on column public.cds_recommendation_decisions.decided_by is
  'The deciding clinician''s own active clinical_staff row, derived server-side from auth.uid() by private.enforce_cds_decision_attribution. Never client-supplied.';

-- --- forge-proof attribution + clinical-authority gate -----------------------
create or replace function private.enforce_cds_decision_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id     uuid;
  v_tier         public.doctor_tier;
  v_is_director  boolean;
  v_patient_org  uuid;
begin
  -- The patient must actually belong to the organisation the row claims, so a
  -- decision can never be filed into an org the patient is not in.
  select organisation_id into v_patient_org
  from public.profiles
  where id = new.patient_id;

  if v_patient_org is null or v_patient_org <> new.organisation_id then
    raise exception 'This patient is not in that organisation.' using errcode = '42501';
  end if;

  -- Attribution is always the caller's own active clinical_staff row in THIS
  -- organisation. Nothing the client sent is trusted.
  select id, doctor_tier, is_clinical_director
    into v_staff_id, v_tier, v_is_director
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active
  limit 1;

  if v_staff_id is null then
    raise exception 'Only an active clinical staff member in this organisation can decide on a recommendation.'
      using errcode = '42501';
  end if;

  -- Care Coordinator is a doctor_tier value but is explicitly non-clinical
  -- (CLAUDE.md, Clinical Tier Ladder) -- excluded by name, same as
  -- private.enforce_fhir_import_resource_attribution.
  if v_tier = 'care_coordinator' then
    raise exception 'A Care Coordinator can see decision support but cannot accept or override a clinical recommendation.'
      using errcode = '42501';
  end if;

  -- Never infer a tier (CLAUDE.md never-list): an unset tier means the record
  -- needs an admin, not that we should guess.
  if v_tier is null and not coalesce(v_is_director, false) then
    raise exception 'Your clinical record has no tier assigned yet, so deciding on a recommendation is unavailable. Ask an administrator to set your tier.'
      using errcode = '42501';
  end if;

  new.decided_by := v_staff_id;
  new.decided_by_profile := (select auth.uid());
  new.decided_at := now();

  -- suppress_until is only meaningful for a deferral; clear it elsewhere so a
  -- client cannot hide an accepted/overridden recommendation on a timer.
  if new.decision <> 'deferred' then
    new.suppress_until := null;
  end if;

  return new;
end;
$$;

comment on function private.enforce_cds_decision_attribution() is
  'Derives cds_recommendation_decisions attribution from the caller''s own active clinical_staff row, refuses care_coordinator and unset tiers, verifies the patient belongs to the stated organisation, and clears suppress_until on any non-deferral.';

drop trigger if exists cds_recommendation_decisions_enforce_attribution
  on public.cds_recommendation_decisions;
create trigger cds_recommendation_decisions_enforce_attribution
  before insert on public.cds_recommendation_decisions
  for each row execute function private.enforce_cds_decision_attribution();

-- --- RLS ---------------------------------------------------------------------
alter table public.cds_recommendation_decisions enable row level security;

-- Org staff read (a Care Coordinator included -- seeing what a doctor decided is
-- exactly the context their logistics follow-up needs). Deliberately NOT
-- patient-readable: this is the clinician's own working record of advisories
-- considered and declined, and a raw override reason is not patient-facing copy.
drop policy if exists cds_recommendation_decisions_select on public.cds_recommendation_decisions;
create policy cds_recommendation_decisions_select on public.cds_recommendation_decisions
  for select to authenticated
  using (private.is_org_staff(organisation_id));

-- Same "RLS admits broadly, the trigger narrows" split used by
-- fhir_import_proposed_resources_update and clinician_alerts' override channel:
-- is_org_staff admits any staff account, and the trigger above is what actually
-- refuses a Care Coordinator and an untiered record.
drop policy if exists cds_recommendation_decisions_insert on public.cds_recommendation_decisions;
create policy cds_recommendation_decisions_insert on public.cds_recommendation_decisions
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

-- A freshly created table needs its own table-level grant -- RLS restricts rows,
-- it does not grant access (CLAUDE.md standing engineering lesson; the failure
-- mode is an empty result, not an error). This project's
-- alter-default-privileges root fix (20260731232749) means every new table is
-- ALSO born with update+delete already granted to authenticated, which is the
-- wrong default for an append-only ledger -- so those two are explicitly
-- revoked rather than merely left out of the grant list below.
grant select, insert on public.cds_recommendation_decisions to authenticated;
revoke update, delete on public.cds_recommendation_decisions from authenticated;

-- --- proof -------------------------------------------------------------------
-- "Removed"/"added" should be provable, not hopeful (CLAUDE.md).
do $$
begin
  if not exists (
    select 1 from pg_class where relname = 'cds_recommendation_decisions' and relrowsecurity
  ) then
    raise exception 'cds_recommendation_decisions must have RLS enabled';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'cds_recommendation_decisions'
      and cmd in ('UPDATE', 'DELETE')
  ) then
    raise exception 'cds_recommendation_decisions must stay append-only (no update/delete policy)';
  end if;

  if has_table_privilege('authenticated', 'public.cds_recommendation_decisions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.cds_recommendation_decisions', 'DELETE')
  then
    raise exception 'authenticated must not hold UPDATE/DELETE on cds_recommendation_decisions';
  end if;

  if not has_table_privilege('authenticated', 'public.cds_recommendation_decisions', 'SELECT')
     or not has_table_privilege('authenticated', 'public.cds_recommendation_decisions', 'INSERT')
  then
    raise exception 'authenticated must hold SELECT and INSERT on cds_recommendation_decisions';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'cds_recommendation_decisions_enforce_attribution'
      and not tgisinternal
  ) then
    raise exception 'the attribution trigger must exist';
  end if;
end $$;
