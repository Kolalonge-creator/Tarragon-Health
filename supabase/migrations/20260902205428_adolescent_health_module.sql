-- Tarragon Health — Adolescent Health module (spec §49).
--
-- Adolescence gets its own confidentiality/safeguarding shape because the
-- three groups the spec calls out (49.4) need genuinely different access:
-- what the adolescent can see, what a parent/guardian can see, and what
-- requires professional safeguarding intervention that neither of them sees.
-- This migration builds the confidentiality gate and the psychosocial
-- check-in that feeds it (49.5/49.6) plus the transition-to-adult-care
-- programme (49.12).
--
-- RECONCILIATION NOTE (2026-09-02): this migration originally also created
-- its own public.safeguarding_concerns table here, in the same file, because
-- the check-in's safeguarding flags need to write into it and it carries a
-- traceability FK back to the check-in that raised it — genuinely circular
-- with the psychosocial-screen table, hence one file. Hours after this
-- migration was authored (2026-08-29 12:12), the independently-developed
-- Patient Safety gap-closure work (spec §89) also created a
-- public.safeguarding_concerns table, and that one shipped and is live —
-- neither branch could see the other; see 20260902205755's header for the
-- full account. Founder decision: unify onto the live §89 table rather than
-- run two. This migration no longer creates safeguarding_concerns at all —
-- see step 4 below — it only INSERTs into the shared table (via step 5's
-- trigger), using the two nullable linkage columns
-- (linked_screen_id/linked_emergency_event_id) and the review-authority
-- floor (Tier 3+/Clinical Director) that 20260902205755 adds/keeps on it.
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

-- Whether a profile_access grantee (typically a parent/guardian) may see a
-- CONFIDENTIAL-domain record for this patient. True for 'child' (49.3:
-- parent-managed — no carve-out) and 'adult'/'unknown' (an adult controls
-- their own profile_access grants already; 'unknown' never NEWLY restricts a
-- legacy account whose date_of_birth was never captured). False only for the
-- two adolescent bands — the entire point of this function.
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
  'Gates the profile_access branch of a CONFIDENTIAL-domain table''s RLS (sexual/reproductive health, mental health, substance use) — never the patient-self or org-staff branches. False for younger_adolescent/older_adolescent regardless of the grant''s permission_level (view or manage); a safeguarding concern about the same patient is handled entirely separately via safeguarding_concerns, which no profile_access grantee can ever read.';

-- No explicit grant/revoke needed on either function: since
-- 20260812003758_revoke_private_schema_execute_from_public.sql, `alter
-- default privileges in schema private` already grants EXECUTE to
-- authenticated/service_role and denies it to public on every NEW private.*
-- function at creation time — exactly what these two need, since both are
-- called DIRECTLY inside an RLS USING/WITH CHECK clause (step 2) and so are
-- evaluated under the querying role itself (authenticated), not from inside
-- another SECURITY DEFINER function's body the way can_review_safeguarding_
-- concern/can_advance_adolescent_transition_stage below are. An explicit
-- `revoke ... from public` here would be redundant (public was never granted
-- EXECUTE in the first place, post-20260812), not harmful — but omitting it
-- avoids implying these need different treatment from any other
-- RLS-embedded private function, like private.is_org_staff.

-- ===========================================================================
-- 2. Close the reproductive_health_profiles confidentiality gap
-- ===========================================================================
-- Same three policies as 20260724001210, with the profile_access branch now
-- additionally gated. mental_health_screens already gets this right by
-- construction (it never had a profile_access branch); reproductive_health_
-- profiles currently gives a parent's 'manage' grant unconditional access —
-- correct for a young child (49.3) but wrong for an adolescent's sexual/
-- reproductive-health confidentiality (49.4/49.8).

drop policy if exists reproductive_health_profiles_select on public.reproductive_health_profiles;
create policy reproductive_health_profiles_select on public.reproductive_health_profiles
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or (
      exists (
        select 1 from public.profile_access pa
        where pa.profile_id = reproductive_health_profiles.patient_id
          and pa.grantee_user_id = (select auth.uid())
      )
      and private.guardian_may_view_confidential_domain(reproductive_health_profiles.patient_id)
    )
  );

drop policy if exists reproductive_health_profiles_insert on public.reproductive_health_profiles;
create policy reproductive_health_profiles_insert on public.reproductive_health_profiles
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    or (
      exists (
        select 1 from public.profile_access pa
        where pa.profile_id = reproductive_health_profiles.patient_id
          and pa.grantee_user_id = (select auth.uid())
          and pa.permission_level = 'manage'
      )
      and private.guardian_may_view_confidential_domain(reproductive_health_profiles.patient_id)
    )
  );

drop policy if exists reproductive_health_profiles_update on public.reproductive_health_profiles;
create policy reproductive_health_profiles_update on public.reproductive_health_profiles
  for update to authenticated
  using (
    patient_id = (select auth.uid())
    or (
      exists (
        select 1 from public.profile_access pa
        where pa.profile_id = reproductive_health_profiles.patient_id
          and pa.grantee_user_id = (select auth.uid())
          and pa.permission_level = 'manage'
      )
      and private.guardian_may_view_confidential_domain(reproductive_health_profiles.patient_id)
    )
  )
  with check (
    patient_id = (select auth.uid())
    or (
      exists (
        select 1 from public.profile_access pa
        where pa.profile_id = reproductive_health_profiles.patient_id
          and pa.grantee_user_id = (select auth.uid())
          and pa.permission_level = 'manage'
      )
      and private.guardian_may_view_confidential_domain(reproductive_health_profiles.patient_id)
    )
  );

-- ===========================================================================
-- 3. adolescent_psychosocial_screens — the HEEADSSS-style check-in (49.5/49.6)
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
-- Trigger created in step 5, which inserts into the shared
-- public.safeguarding_concerns table — see this file's header for the
-- reconciliation note on why step 4 no longer creates that table here.

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
-- 4. safeguarding_concerns — shared with the general Patient Safety module
-- ===========================================================================
-- Was originally this migration's own table (deliberately walled off from
-- the patient and any profile_access grantee — see the reconciliation note
-- at the top of this file). It is now public.safeguarding_concerns, the
-- table the §89 Patient Safety gap-closure migration
-- (20260829213100_safeguarding_concerns.sql, live) already created:
-- Tier 3+/Clinical Director review authority (private.can_review_
-- safeguarding_concern, kept at the §89 threshold rather than lowered to
-- Tier 2+ — founder decision), SELECT restricted to that authority plus the
-- original reporter, and INSERT/UPDATE gated to org staff generally with the
-- resolve/close transition narrowed by
-- private.enforce_safeguarding_concern_attribution(). That policy shape
-- already satisfies "never the patient, never a profile_access grantee" by
-- construction: both INSERT and SELECT require private.is_org_staff (a
-- patient's own role is never staff), and the reporter-self SELECT clause
-- can never resolve to a non-staff session either, once
-- 20260902205755_extend_safeguarding_concerns_adolescent_linkage.sql's
-- reported_by fix is applied — see that migration for the confidentiality
-- gap it closes (an automated, patient-session-triggered insert could
-- otherwise have attributed reported_by to the adolescent patient
-- themselves). This migration's own step 5 trigger below inserts into that
-- shared table using its actual columns (concern_category, description,
-- source, linked_screen_id, linked_emergency_event_id) rather than a
-- concern_type/narrative/resolved_by shape of its own.

-- ===========================================================================
-- 5. Routing: self-harm / immediate danger / safeguarding flags
-- ===========================================================================
-- AFTER INSERT so it fires regardless of which session (patient or staff)
-- created the row, and regardless of app-layer follow-through — same
-- "a security-relevant path must not depend on app code remembering to do
-- the second insert" principle 20260716224736's own header states, applied
-- here rather than left to a submit-action convention (contrast
-- submitMentalHealthScreen, which relies on the app layer for its own
-- emergency_events insert).
--
-- self_harm / immediate_danger both raise an emergency_events row (existing
-- 'intake_screen' source — no new enum value needed) AND a
-- safeguarding_concerns row for longer-term case documentation: the
-- emergency pathway is the acute clinical response, the safeguarding case is
-- the follow-up/documentation trail — two different, both-needed processes.
-- The safeguarding_concerns row links back to the emergency_events row via
-- linked_emergency_event_id (captured via `returning id`) — the original
-- version of this trigger declared that column but never actually populated
-- it; fixed here while rewriting this function onto the shared table.
-- abuse_neglect_exploitation is NOT routed through the emergency pathway
-- (49.11: "professional safeguarding processes rather than automated
-- diagnosis" — not every disclosure is a 2-hour-SLA emergency) but does
-- raise a safeguarding_concerns row.
--
-- Concern-category mapping: main-dev's shared safeguarding_concerns table
-- (§89) uses a concern_category taxonomy
-- (child_safety/vulnerable_adult/abuse/neglect/exploitation/
-- immediate_safety_risk/other) that predates this module and has no
-- self_harm/immediate_danger values of its own — the closest fit for both
-- is immediate_safety_risk, with the specific flag named in `description`
-- (free text, required not-null on that table). abuse_neglect_exploitation
-- stays 'other', matching this trigger's original intent ("a reviewing
-- clinician should refine" — 49.11's ambiguous Home/Safety-domain signal
-- isn't yet known to be abuse vs. neglect vs. exploitation specifically).
--
-- No separate clinician_alert call here (the original version of this
-- function made one, only for the abuse_neglect_exploitation case): the
-- shared table's own private.enforce_safeguarding_concern_attribution()
-- BEFORE INSERT trigger already auto-raises an urgent_escalation
-- clinician_alert (type_code 'safeguarding_concern') on every
-- safeguarding_concerns insert, staff-filed or automated alike. A
-- self_harm/immediate_danger flag therefore now produces two alerts (one
-- from whatever emergency_events' own alerting does, one from this) rather
-- than one — a deliberate, accepted increase in alert volume for the most
-- acute flags, not a bug; abuse_neglect_exploitation produces exactly one,
-- same as before.
create or replace function private.handle_adolescent_psychosocial_screen_flags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emergency_event_id uuid;
begin
  if new.self_harm_flagged then
    insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status)
    values (new.organisation_id, new.patient_id, 'intake_screen',
      'Adolescent psychosocial check-in: reported thoughts of self-harm.', 'active')
    returning id into v_emergency_event_id;

    insert into public.safeguarding_concerns
      (organisation_id, patient_id, concern_category, description, source, linked_screen_id, linked_emergency_event_id)
    values (new.organisation_id, new.patient_id, 'immediate_safety_risk',
      'Auto-raised from an adolescent psychosocial check-in: reported thoughts of self-harm. See the linked emergency event for the acute response.',
      'adolescent_psychosocial_screen', new.id, v_emergency_event_id);
  end if;

  if new.immediate_danger_flagged then
    insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status)
    values (new.organisation_id, new.patient_id, 'intake_screen',
      'Adolescent psychosocial check-in: reported being in immediate danger.', 'active')
    returning id into v_emergency_event_id;

    insert into public.safeguarding_concerns
      (organisation_id, patient_id, concern_category, description, source, linked_screen_id, linked_emergency_event_id)
    values (new.organisation_id, new.patient_id, 'immediate_safety_risk',
      'Auto-raised from an adolescent psychosocial check-in: reported being in immediate danger. See the linked emergency event for the acute response.',
      'adolescent_psychosocial_screen', new.id, v_emergency_event_id);
  end if;

  if new.abuse_neglect_exploitation_flagged then
    insert into public.safeguarding_concerns
      (organisation_id, patient_id, concern_category, description, source, linked_screen_id)
    values (new.organisation_id, new.patient_id, 'other',
      'Auto-raised from an adolescent psychosocial check-in (possible abuse, neglect or exploitation flagged in the Home/Safety domains). A reviewing clinician should refine the concern category.',
      'adolescent_psychosocial_screen', new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists adolescent_psychosocial_screens_raise_flags on public.adolescent_psychosocial_screens;
create trigger adolescent_psychosocial_screens_raise_flags
  after insert on public.adolescent_psychosocial_screens
  for each row execute function private.handle_adolescent_psychosocial_screen_flags();

-- ===========================================================================
-- 6. adolescent_transition_plans — the 49.12 transition programme
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

-- Same redundant-but-explicit posture as can_review_safeguarding_concern
-- above: only ever called from enforce_adolescent_transition_stage_authority
-- (a SECURITY DEFINER trigger), never directly from an RLS clause, and
-- already denied to public/anon by default post-20260812003758.
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
-- 7. Assertions — the migration is the test.
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

  -- safeguarding_concerns itself is no longer created by this migration
  -- (see the reconciliation note in this file's header and in step 4) — it
  -- is the shared, already-live §89 Patient Safety table. Its
  -- table/policy/authority-threshold shape is asserted by the §89 migration
  -- itself; 20260902205755_extend_safeguarding_concerns_adolescent_
  -- linkage.sql asserts the two nullable linkage columns this module adds
  -- to it plus the reported_by confidentiality fix. What this migration
  -- still owns and asserts here is only the trigger that writes into it.
  if to_regclass('public.safeguarding_concerns') is null then
    raise exception 'safeguarding_concerns (expected already live via the §89 Patient Safety migration) is missing';
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

  -- adolescent_age_band/guardian_may_view_confidential_domain deliberately
  -- carry no anon-execute revoke (see their comment in step 1) — they are
  -- evaluated directly inside an RLS clause under `authenticated`, same as
  -- private.is_org_staff, so no assertion against anon executing them here.
  -- private.can_review_safeguarding_concern's own anon-execute assertion
  -- lives with the §89 migration that creates it, not here.
  if has_function_privilege('anon', 'private.can_advance_adolescent_transition_stage(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.can_advance_adolescent_transition_stage';
  end if;

  raise notice 'PASS: adolescent health module (age bands, confidentiality gate, psychosocial screen, safeguarding_concerns linkage trigger, transition plan) all present';
end $$;
