-- Tarragon Health — Adolescent Health module (spec §49).
--
-- Adolescence gets its own confidentiality/safeguarding shape because the
-- three groups the spec calls out (49.4) need genuinely different access:
-- what the adolescent can see, what a parent/guardian can see, and what
-- requires professional safeguarding intervention that neither of them sees.
-- This migration builds the age-band helper, the psychosocial check-in
-- (49.5/49.6), and the transition-to-adult-care programme (49.12).
--
-- Reconciliation note (this migration is a rebase of a same-day, originally
-- unmerged branch — 20260829121248_adolescent_health_module.sql — against
-- everything that landed on main-dev after it was written): two sections of
-- the original migration are DELIBERATELY DROPPED here, not carried over,
-- because both were overtaken by other work that shipped later the same day
-- or the day after:
--
--   1. Its reproductive_health_profiles confidentiality-gate rewrite (age-
--      banding a parent's profile_access 'manage' grant) is now stale. Two
--      later main-dev migrations already replaced that whole access model:
--      20260830103251_category_scoped_clinical_access_and_emergency_access.sql
--      first excluded reproductive_health from the guardian/dependent-account
--      bypass entirely, then 20260830123653_resolve_category_scoping_
--      governance_gaps.sql deliberately RESTORED unconditional dependent-
--      account (no-login minor) guardian access to reproductive_health, with
--      its own explicit reasoning: "a legal guardian's authority over a
--      minor with no login of their own is a categorically different consent
--      relationship from a next-of-kin grant between two consenting adults."
--      Re-applying this branch's age-band gate now would silently reverse
--      that later, more-considered decision — not close a gap.
--
--   2. Its safeguarding_concerns table/policies/can_review_safeguarding_
--      concern() function are dropped in favour of the safeguarding_concerns
--      table an independent same-day migration already shipped and merged:
--      20260829212949_safeguarding_concerns.sql (docs spec §89.12, PR #378).
--      That table has a different shape (concern_category vs this branch's
--      concern_type, description vs narrative, reported_by/reviewed_by_staff/
--      closed_by_staff vs raised_by/resolved_by) and a stricter Tier 3+
--      review threshold (this branch used Tier 2+) — and it is already wired
--      into analytics_safety_dashboard_summary()'s live safety-dashboard
--      tile. Re-creating a second, differently-shaped safeguarding_concerns
--      table under the same name is not possible (name collision) and would
--      not be desirable even under a different name — one safeguarding log
--      per organisation is the point. Section 4 below instead routes the new
--      psychosocial check-in's flags into that existing table, and patches
--      one real gap the routing exposes (see section 4's header) rather than
--      touching that table's already-tested attribution trigger.
--
-- Flagged, not resolved (same posture as 20260830103331_dependent_
-- transition_to_adult_care.sql's own note, which flagged this same overlap
-- from its side first): section 6's adolescent_transition_plans is a
-- clinician-driven, staged readiness checklist (transition_assessment ->
-- independent_account_prep -> health_literacy -> medication_independence ->
-- adult_care_handoff), gated on clinical-tier authority to advance a stage.
-- That is NOT the same thing as dependent_transition_status (§48.14,
-- 20260830103331): a purely age-derived (13/16/18), automatic, non-clinical
-- status used only to taper profile_access from 'manage' to 'view' at 18 —
-- no clinician ever acts on it. Also distinct from adolescent_transition_
-- events/private.transition_adolescent_dependents (§82.12, 20260830114838):
-- a notify-at-13/downgrade-at-18 sweep over dependent (no-login) accounts
-- specifically. Different table/enum/cron-job names across all three mean
-- there is no live SQL collision, but they cover real overlapping product
-- territory (all three fire in the 13-18 age band, all three are called
-- "transition" in some framing) and were built independently. Reconciling
-- them (e.g. should the two automatic account-access sweeps become the
-- layer underneath this migration's clinical checklist?) is a product
-- decision for a human, not something to guess at mid-merge.
--
-- Scope note: exact confidentiality/age boundaries are, by the spec's own
-- wording (49.4), "governed according to applicable law and clinical
-- policy" — not yet settled. This ships a defensible engineering default
-- (WHO adolescent bands; Nigeria's age of majority at 18) rather than
-- asserting legal authority this codebase doesn't have — same posture as
-- the MDCN/NMCN tier-authority items already flagged open elsewhere in
-- CLAUDE.md. Treat the thresholds as adjustable, not as a compliance claim.

-- ===========================================================================
-- 1. Age-band helpers
-- ===========================================================================
-- Text, not an enum: cheap to retune thresholds later without an enum-value
-- migration, matching mental_health_screens.instrument's text+check
-- precedent rather than every sibling table's enum one.

create or replace function private.adolescent_age_band(p_patient_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p.date_of_birth is null then 'unknown'
    when date_part('year', age(current_date, p.date_of_birth)) < 10 then 'child'
    when date_part('year', age(current_date, p.date_of_birth)) < 15 then 'younger_adolescent'
    when date_part('year', age(current_date, p.date_of_birth)) < 18 then 'older_adolescent'
    else 'adult'
  end
  from public.profiles p
  where p.id = p_patient_id;
$$;

comment on function private.adolescent_age_band(uuid) is
  'Engineering default age band for the adolescent module (child <10, younger_adolescent 10-14, older_adolescent 15-17, adult 18+; unknown when date_of_birth is null). Thresholds are a placeholder pending real clinical/legal policy sign-off (see this migration''s header) — never represent this as a compliance-approved boundary. Mirrored client-side (framing only, not enforcement) by adolescentAgeBandFromDateOfBirth() in packages/shared.';

-- Not currently wired into any RLS policy — see this migration's header
-- (reproductive_health_profiles already has its own, later, deliberately
-- different guardian-access model). Kept as a general-purpose helper for any
-- future CONFIDENTIAL-domain table (sexual/reproductive health, mental
-- health, substance use) that wants an age-banded guardian gate.
create or replace function private.guardian_may_view_confidential_domain(p_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.adolescent_age_band(p_patient_id) not in ('younger_adolescent', 'older_adolescent');
$$;

comment on function private.guardian_may_view_confidential_domain(uuid) is
  'Gates the profile_access branch of a CONFIDENTIAL-domain table''s RLS (sexual/reproductive health, mental health, substance use) — never the patient-self or org-staff branches. False for younger_adolescent/older_adolescent regardless of the grant''s permission_level (view or manage). Not currently referenced by reproductive_health_profiles — see this migration''s header for why.';

-- No explicit grant/revoke needed on either function: since
-- 20260812003758_revoke_private_schema_execute_from_public.sql, `alter
-- default privileges in schema private` already grants EXECUTE to
-- authenticated/service_role and denies it to public on every NEW private.*
-- function at creation time.

-- ===========================================================================
-- 2. adolescent_psychosocial_screens — the HEEADSSS-style check-in (49.5/49.6)
-- ===========================================================================
-- Home, Education, Eating/Activities, Drugs/alcohol, Sexuality, Suicide/
-- depression, Safety. Its own table rather than another mental_health_
-- screens.instrument value: HEEADSSS is a structured psychosocial interview
-- across domains, not a single scored total like PHQ-9/GAD-7/AUDIT-C, and
-- several domains (Home, Safety) can flag a safeguarding concern that
-- mental_health_screens has no concept of. Same discipline throughout: never
-- a diagnosis, never fed into risk/escalation scoring beyond the explicit
-- flags below, reviewed by a clinician rather than auto-actioned.
--
-- Confidentiality: patient-self + org staff only — deliberately NO
-- profile_access branch, matching mental_health_screens' shape. A parent's
-- 'manage' grant never sees this table, at any age band — HEEADSSS is only
-- ever administered to an adolescent-band patient by app-layer gating, so
-- confidentiality here does not depend on getting the age-band thresholds
-- exactly right.
--
-- Trigger created in step 4, after the flag-routing helper exists.

create table if not exists public.adolescent_psychosocial_screens (
  id                                 uuid primary key default gen_random_uuid(),
  organisation_id                    uuid not null references public.organisations (id) on delete restrict,
  patient_id                         uuid not null references public.profiles (id) on delete cascade,
  -- Free-form structured answers keyed by HEEADSSS domain (home / education /
  -- eating_activity / drugs_alcohol / sexuality / suicide_depression /
  -- safety). Not scored — see header.
  domain_responses                   jsonb not null default '{}'::jsonb,
  self_harm_flagged                  boolean not null default false,
  immediate_danger_flagged           boolean not null default false,
  abuse_neglect_exploitation_flagged boolean not null default false,
  substance_use_concern_flagged      boolean not null default false,
  -- Patient asked for confidential follow-up (e.g. contraception, STI
  -- testing) — a support/education routing signal, not itself a safeguarding
  -- matter (49.8's "appropriate access to services").
  sexual_health_follow_up_requested  boolean not null default false,
  reviewed_by                        uuid references public.clinical_staff (id) on delete set null,
  reviewed_at                        timestamptz,
  created_at                         timestamptz not null default now()
);

create index if not exists adolescent_psychosocial_screens_patient_idx
  on public.adolescent_psychosocial_screens (patient_id, created_at desc);
create index if not exists adolescent_psychosocial_screens_org_idx
  on public.adolescent_psychosocial_screens (organisation_id);

alter table public.adolescent_psychosocial_screens enable row level security;

create policy adolescent_psychosocial_screens_select on public.adolescent_psychosocial_screens
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

-- Append-only from the patient's side (self-administered check-in); org
-- staff may also insert (a clinician administering it during a visit) and
-- may update reviewed_by/reviewed_at. No patient update policy — same
-- "append-only history" shape as mental_health_screens.
create policy adolescent_psychosocial_screens_insert on public.adolescent_psychosocial_screens
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

create policy adolescent_psychosocial_screens_update on public.adolescent_psychosocial_screens
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.adolescent_psychosocial_screens to authenticated;

-- ===========================================================================
-- 3. Routing: self-harm / immediate danger / safeguarding flags
-- ===========================================================================
-- AFTER INSERT so it fires regardless of which session (patient or staff)
-- created the row, and regardless of app-layer follow-through — the acute
-- pathway must not depend on the app remembering to raise it separately.
--
-- self_harm / immediate_danger both raise an emergency_events row (existing
-- 'intake_screen' source — no new enum value needed): the acute clinical
-- response. All three flag groups (self-harm, immediate danger, and
-- abuse/neglect/exploitation) additionally insert into the ALREADY-LIVE
-- public.safeguarding_concerns (20260829212949_safeguarding_concerns.sql)
-- for longer-term, Tier-3+-reviewed case documentation — that table's own
-- BEFORE INSERT trigger (private.enforce_safeguarding_concern_attribution)
-- auto-stamps reported_by/reported_at/status and auto-raises an
-- urgent_escalation clinician_alert via private.raise_clinician_alert(), so
-- nothing further is needed here to get a case in front of the care team.
--
-- concern_category mapping: that table's check constraint only allows
-- child_safety/vulnerable_adult/abuse/neglect/exploitation/
-- immediate_safety_risk/other — it has no direct self_harm or
-- immediate_danger value, so both map to immediate_safety_risk (the closest
-- real fit; the description text names the actual flag). abuse_neglect_
-- exploitation_flagged is one combined flag covering three separate
-- concern_category values with no way to tell which — mapped to 'other'
-- with the ambiguity spelled out in the description, exactly as the
-- reviewing Tier-3+ clinician is expected to refine it (the category column
-- is freely UPDATE-able post-insert by that table's existing policy).
--
-- Gap this routing exposes, fixed here rather than left latent: safeguarding_
-- concerns_select currently reads `reported_by = auth.uid() OR
-- can_review_safeguarding_concern(...)`. That was safe when only org STAFF
-- could ever INSERT (its own INSERT policy requires is_org_staff — a patient
-- session cannot insert directly), so reported_by was always a staff
-- member's own id. This SECURITY DEFINER trigger is the first path where a
-- PATIENT's own psychosocial check-in (self_harm_flagged etc.) causes a
-- safeguarding_concerns row to be auto-inserted while auth.uid() is still
-- that same patient's session — enforce_safeguarding_concern_attribution
-- would then stamp reported_by := that patient's own id, and the existing
-- SELECT policy would let the patient read their own safeguarding record
-- back. That is exactly the confidentiality failure this module exists to
-- prevent (a safeguarding record about someone is sometimes the one thing
-- that must not be visible to them). Patched below: reported_by only grants
-- read access when the reporter is NOT the subject patient — true for every
-- real staff-filed report (reported_by is a staff profile, never the
-- patient's own), false only for this new self-attributed path.

drop policy if exists safeguarding_concerns_select on public.safeguarding_concerns;
create policy safeguarding_concerns_select on public.safeguarding_concerns
  for select to authenticated
  using (
    private.can_review_safeguarding_concern(organisation_id)
    or (reported_by = (select auth.uid()) and reported_by <> patient_id)
  );

create or replace function private.handle_adolescent_psychosocial_screen_flags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.self_harm_flagged then
    insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status)
    values (new.organisation_id, new.patient_id, 'intake_screen',
      'Adolescent psychosocial check-in: reported thoughts of self-harm.', 'active');

    insert into public.safeguarding_concerns
      (organisation_id, patient_id, concern_category, description)
    values (new.organisation_id, new.patient_id, 'immediate_safety_risk',
      'Auto-raised from an adolescent psychosocial check-in: self-harm flagged. See the linked emergency event for the acute response.');
  end if;

  if new.immediate_danger_flagged then
    insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status)
    values (new.organisation_id, new.patient_id, 'intake_screen',
      'Adolescent psychosocial check-in: reported being in immediate danger.', 'active');

    insert into public.safeguarding_concerns
      (organisation_id, patient_id, concern_category, description)
    values (new.organisation_id, new.patient_id, 'immediate_safety_risk',
      'Auto-raised from an adolescent psychosocial check-in: immediate danger flagged. See the linked emergency event for the acute response.');
  end if;

  if new.abuse_neglect_exploitation_flagged then
    insert into public.safeguarding_concerns
      (organisation_id, patient_id, concern_category, description)
    values (new.organisation_id, new.patient_id, 'other',
      'Auto-raised from an adolescent psychosocial check-in: possible abuse, neglect or exploitation flagged in the Home/Safety domains. A reviewing clinician should refine the concern category.');
  end if;

  return new;
end;
$$;

drop trigger if exists adolescent_psychosocial_screens_raise_flags on public.adolescent_psychosocial_screens;
create trigger adolescent_psychosocial_screens_raise_flags
  after insert on public.adolescent_psychosocial_screens
  for each row execute function private.handle_adolescent_psychosocial_screen_flags();

-- ===========================================================================
-- 4. adolescent_transition_plans — the 49.12 transition programme
-- ===========================================================================
-- transition_assessment -> independent_account_prep -> health_literacy ->
-- medication_independence -> adult_care_handoff. current_stage is the simple
-- queryable state; stage_log is an append-only jsonb audit trail of every
-- transition (stage, at, by) — same "current state as a plain column + full
-- history as an append-only log" shape CLAUDE.md calls out as an adopted v3
-- discipline (delivery-state tracking), not a new pattern.
--
-- Not clinically confidential the way sexual-health/mental-health/substance-
-- use data is — a parent/guardian profile_access grantee may read it (they
-- are, after all, meant to be part of "independent account preparation").
-- Advancing a stage is a clinical-judgment act (readiness for medication
-- independence in particular), so — like safeguarding resolution — write
-- access excludes Care Coordinator specifically, per the same CLAUDE.md rule.

create table if not exists public.adolescent_transition_plans (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  patient_id             uuid not null references public.profiles (id) on delete cascade,
  current_stage          text not null default 'transition_assessment'
                            check (current_stage in ('transition_assessment', 'independent_account_prep', 'health_literacy', 'medication_independence', 'adult_care_handoff')),
  stage_log              jsonb not null default '[]'::jsonb,
  target_transition_age  smallint not null default 18 check (target_transition_age between 16 and 21),
  started_at             timestamptz not null default now(),
  completed_at           timestamptz,
  created_by             uuid references public.clinical_staff (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (patient_id)
);

create index if not exists adolescent_transition_plans_org_idx
  on public.adolescent_transition_plans (organisation_id);

drop trigger if exists adolescent_transition_plans_set_updated_at on public.adolescent_transition_plans;
create trigger adolescent_transition_plans_set_updated_at
  before update on public.adolescent_transition_plans
  for each row execute function private.set_updated_at();

alter table public.adolescent_transition_plans enable row level security;

create policy adolescent_transition_plans_select on public.adolescent_transition_plans
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = adolescent_transition_plans.patient_id
        and pa.grantee_user_id = (select auth.uid())
    )
  );

create policy adolescent_transition_plans_insert on public.adolescent_transition_plans
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

-- RLS admits any org staff; the trigger below narrows stage advancement to
-- non-Care-Coordinator staff (Tier 1+ or Clinical Director).
create policy adolescent_transition_plans_update on public.adolescent_transition_plans
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.adolescent_transition_plans to authenticated;

create or replace function private.can_advance_adolescent_transition_stage(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = org
      and active
      and (is_clinical_director or doctor_tier <> 'care_coordinator')
  );
$$;

comment on function private.can_advance_adolescent_transition_stage(uuid) is
  'Any clinical tier except Care Coordinator (or the Clinical Director regardless of tier). Advancing a transition stage is a clinical-judgment act (esp. medication_independence readiness) — Care Coordinator stays read/logistics-only, per CLAUDE.md''s Care Coordinator write-access rule.';

revoke all on function private.can_advance_adolescent_transition_stage(uuid) from public, anon;

create or replace function private.enforce_adolescent_transition_stage_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.current_stage is distinct from old.current_stage
     and not private.can_advance_adolescent_transition_stage(new.organisation_id) then
    raise exception 'Advancing a transition-to-adult-care stage requires a clinical tier above Care Coordinator, or the Clinical Director.'
      using errcode = '42501';
  end if;

  if new.current_stage is distinct from old.current_stage then
    new.stage_log := old.stage_log || jsonb_build_object(
      'stage', new.current_stage,
      'at', now(),
      'by', (select auth.uid())
    );
    if new.current_stage = 'adult_care_handoff' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists adolescent_transition_plans_enforce_stage_authority on public.adolescent_transition_plans;
create trigger adolescent_transition_plans_enforce_stage_authority
  before update on public.adolescent_transition_plans
  for each row execute function private.enforce_adolescent_transition_stage_authority();

-- ---------------------------------------------------------------------------
-- Best-effort auto-provisioning at the older_adolescent band (15+)
-- ---------------------------------------------------------------------------
-- Mirrors the existing "best-effort" provisioning shape (e.g.
-- generateVaccinationScheduleBestEffort for a newly added child) — a plan
-- should exist without requiring a clinician to remember to start one.
-- Idempotent (not-exists guard); safe to run repeatedly. Deliberately scoped
-- to patients already in the older_adolescent band rather than triggered off
-- profile writes, since backdating date_of_birth on an existing account
-- should not silently spawn a plan mid-transaction.

create or replace function private.provision_adolescent_transition_plans()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.adolescent_transition_plans (organisation_id, patient_id)
  select p.organisation_id, p.id
  from public.profiles p
  where p.organisation_id is not null
    and p.date_of_birth is not null
    and date_part('year', age(current_date, p.date_of_birth)) >= 15
    and date_part('year', age(current_date, p.date_of_birth)) < 18
    and not exists (
      select 1 from public.adolescent_transition_plans atp where atp.patient_id = p.id
    );
end;
$$;

comment on function private.provision_adolescent_transition_plans() is
  'Daily sweep: starts a transition-to-adult-care plan for every patient in the older_adolescent age band (15-17) who does not already have one. Never overwrites/advances an existing plan.';

revoke all on function private.provision_adolescent_transition_plans() from public, anon;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'adolescent-transition-plan-provisioning') then
    perform cron.unschedule('adolescent-transition-plan-provisioning');
  end if;
end $$;

select cron.schedule(
  'adolescent-transition-plan-provisioning',
  '20 4 * * *',
  $$ select private.provision_adolescent_transition_plans(); $$
);

-- ===========================================================================
-- 5. Assertions — the migration is the test.
-- ===========================================================================
do $$
declare v_n int;
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'adolescent_age_band'
  ) then
    raise exception 'private.adolescent_age_band was not created';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'guardian_may_view_confidential_domain'
  ) then
    raise exception 'private.guardian_may_view_confidential_domain was not created';
  end if;

  if to_regclass('public.adolescent_psychosocial_screens') is null then
    raise exception 'adolescent_psychosocial_screens was not created';
  end if;
  select count(*) into v_n from pg_policy pol join pg_class c on c.oid = pol.polrelid
    where c.relname = 'adolescent_psychosocial_screens';
  if v_n <> 3 then raise exception 'expected 3 adolescent_psychosocial_screens policies, found %', v_n; end if;
  if exists (
    select 1 from pg_policy pol join pg_class c on c.oid = pol.polrelid
    where c.relname = 'adolescent_psychosocial_screens'
      and (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ilike '%profile_access%'
        or coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ilike '%profile_access%')
  ) then
    raise exception 'adolescent_psychosocial_screens must never grant profile_access (parent/guardian) visibility';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'adolescent_psychosocial_screens_raise_flags'
      and tgrelid = 'public.adolescent_psychosocial_screens'::regclass
      and not tgisinternal
  ) then
    raise exception 'adolescent_psychosocial_screens_raise_flags trigger was not created';
  end if;

  -- The safeguarding_concerns table itself belongs to
  -- 20260829212949_safeguarding_concerns.sql, not this migration — just
  -- confirm it still exists (this migration's routing depends on it) and
  -- that the patched SELECT policy actually closes the patient-self-
  -- visibility gap this migration's routing would otherwise open.
  if to_regclass('public.safeguarding_concerns') is null then
    raise exception 'safeguarding_concerns is expected to already exist (20260829212949_safeguarding_concerns.sql) but was not found';
  end if;
  if not exists (
    select 1 from pg_policy pol join pg_class c on c.oid = pol.polrelid
    where c.relname = 'safeguarding_concerns' and pol.polname = 'safeguarding_concerns_select'
      and coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') like '%reported_by <> patient_id%'
  ) then
    raise exception 'safeguarding_concerns_select was not patched to exclude patient self-visibility on an auto-attributed report';
  end if;

  if to_regclass('public.adolescent_transition_plans') is null then
    raise exception 'adolescent_transition_plans was not created';
  end if;
  select count(*) into v_n from pg_policy pol join pg_class c on c.oid = pol.polrelid
    where c.relname = 'adolescent_transition_plans';
  if v_n <> 3 then raise exception 'expected 3 adolescent_transition_plans policies, found %', v_n; end if;

  if not exists (select 1 from cron.job where jobname = 'adolescent-transition-plan-provisioning') then
    raise exception 'adolescent-transition-plan-provisioning cron job was not scheduled';
  end if;

  raise notice 'PASS: adolescent health module (age bands, psychosocial screen, safeguarding routing into the existing safeguarding_concerns table, transition plan) all present';
end $$;
