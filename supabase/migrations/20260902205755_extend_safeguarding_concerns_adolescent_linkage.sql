-- Tarragon Health — reconciling the Adolescent Health module (spec §49) onto
-- the general Patient Safety safeguarding_concerns table.
--
-- BACKGROUND: this branch's own adolescent-module migration
-- (20260902205428_adolescent_health_module.sql, authored 2026-08-29 12:12,
-- never applied) originally created its OWN public.safeguarding_concerns
-- table. Hours later the same day (21:29), the independently-developed
-- Patient Safety gap-closure work (spec §89, PR #438/#439-adjacent) also
-- created a public.safeguarding_concerns table -- and that one shipped and
-- is live. Neither branch could have seen the other; the §89 migration's own
-- header confirms it checked "zero tables named safeguarding% exist" at
-- authoring time. Founder decision (2026-09-02): unify onto the live §89
-- table rather than run two safeguarding_concerns tables side by side --
-- this migration is that reconciliation's schema half. The adolescent
-- module's own migration was rewritten in the same reconciliation pass to
-- stop creating a competing table/functions and instead insert into this
-- one; see that file's updated header for the app-code side.
--
-- Column choices below keep the §89 table's shape as the floor (Tier 3+
-- review authority, concern_category taxonomy, restricted visibility) and
-- add only what the adolescent module's traceability genuinely needs and
-- the §89 shape has no equivalent for:
--   - linked_screen_id / linked_emergency_event_id: nullable FKs back to the
--     specific adolescent_psychosocial_screens row and/or emergency_events
--     row that auto-raised this concern, so a reviewing clinician can open
--     the source record directly. Every §89-filed concern (the general
--     safety UI) leaves both null -- it has no such source record to link.
--   - source: nullable, "how did this concern originate" (an automated
--     check-in flag vs a clinician noticing something and filing directly).
--     concern_category (what kind of concern) and description (free text)
--     don't capture this, and it's genuinely useful both for the clinician
--     UI and, more importantly, for the reported_by fix below -- see there.
--     Kept as an enum-shaped text+check, matching this codebase's existing
--     precedent for exactly this kind of low-churn categorical column
--     (mental_health_screens.instrument, adolescent_psychosocial_screens'
--     own source column in the original design).

alter table public.safeguarding_concerns
  add column if not exists linked_screen_id uuid references public.adolescent_psychosocial_screens (id) on delete set null,
  add column if not exists linked_emergency_event_id uuid references public.emergency_events (id) on delete set null,
  add column if not exists source text default 'clinician_raised'
    check (source in ('adolescent_psychosocial_screen', 'mental_health_screen', 'clinician_raised', 'other'));

comment on column public.safeguarding_concerns.linked_screen_id is
  'Nullable. The adolescent_psychosocial_screens row that auto-raised this concern, when applicable -- null for every concern filed directly (the general Patient Safety UI, or a clinician filing one manually for an adolescent case).';
comment on column public.safeguarding_concerns.linked_emergency_event_id is
  'Nullable. The emergency_events row raised alongside this concern for the acute response (self-harm / immediate-danger flags), when applicable -- the emergency pathway is the acute clinical response, this safeguarding row is the follow-up/documentation trail; both are raised, neither replaces the other.';
comment on column public.safeguarding_concerns.source is
  'How this concern originated -- distinct from concern_category (what kind of concern) and reported_by (who/what session performed the insert). Defaults to clinician_raised to describe every pre-existing row accurately (all were filed via the general Patient Safety UI, by a staff member, before this column existed).';

create index if not exists safeguarding_concerns_linked_screen_idx
  on public.safeguarding_concerns (linked_screen_id) where linked_screen_id is not null;
create index if not exists safeguarding_concerns_linked_emergency_event_idx
  on public.safeguarding_concerns (linked_emergency_event_id) where linked_emergency_event_id is not null;

-- ===========================================================================
-- Close a real confidentiality gap the reconciliation surfaced
-- ===========================================================================
-- private.enforce_safeguarding_concern_attribution() (live since
-- 20260829213100_safeguarding_concerns.sql) unconditionally sets
-- `new.reported_by := (select auth.uid())` on every INSERT. That is correct
-- for every case that function was designed for: a human staff member
-- filing a concern via the general safety UI, where the INSERT RLS policy
-- (safeguarding_concerns_insert) already requires private.is_org_staff, so
-- auth.uid() is always a staff member's own id.
--
-- The adolescent module changes that assumption. adolescent_psychosocial_
-- screens_insert deliberately lets a patient self-administer their own
-- check-in ("Append-only from the patient's side"), and the AFTER INSERT
-- trigger that auto-raises a linked safeguarding_concerns row for a
-- self-harm/immediate-danger/abuse-neglect-exploitation flag is SECURITY
-- DEFINER -- which escalates the *inserting role* enough to bypass RLS, but
-- does NOT change what auth.uid() resolves to (it reads the session's JWT
-- claim, unaffected by SECURITY DEFINER). So an adolescent's own
-- self-administered check-in, flagged and auto-escalated, would previously
-- have set reported_by to the ADOLESCENT PATIENT'S OWN id -- and
-- safeguarding_concerns_select's `reported_by = auth.uid()` clause would
-- then let that same patient read the very concern raised about them. That
-- is exactly the outcome the adolescent module's confidentiality model
-- exists to prevent (see 20260902205428_adolescent_health_module.sql's section 4 header: "NEVER the
-- patient -- a safeguarding record about someone can be exactly the thing
-- that must not be visible to them").
--
-- Fix: only attribute reported_by to the inserting session when that
-- session is genuine org staff -- which every pre-existing, caller-
-- initiated insert already satisfies (the INSERT policy requires it), so
-- this changes nothing for any concern filed through the general safety UI.
-- A non-staff-session insert (the automated adolescent trigger, running on
-- behalf of a patient's own action) now leaves reported_by null instead,
-- which safeguarding_concerns_select's `reported_by = auth.uid()` clause
-- never matches -- closing the gap without touching visibility for anyone
-- else. Everything else in the function is byte-for-byte unchanged.
create or replace function private.enforce_safeguarding_concern_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_tier public.doctor_tier;
begin
  if tg_op = 'INSERT' then
    if private.is_org_staff(new.organisation_id) then
      new.reported_by := (select auth.uid());
    else
      new.reported_by := null;
    end if;
    new.reported_at := coalesce(new.reported_at, now());
    new.status := 'open';
    new.reviewed_by_staff := null;
    new.reviewed_at := null;
    new.review_outcome := null;
    new.corrective_action := null;
    new.closed_by_staff := null;
    new.closed_at := null;
    new.clinician_alert_id := private.raise_clinician_alert(
      new.organisation_id,
      new.patient_id,
      'urgent_escalation',
      'Safeguarding concern reported',
      format('Category: %s. %s', new.concern_category, new.description),
      'clinical',
      'safeguarding_concern'
    );
    return new;
  end if;

  if old.status = 'closed' then
    raise exception 'This safeguarding concern is closed and cannot be edited further. File a new concern if something new needs recording.'
      using errcode = '42501';
  end if;

  new.reported_by := old.reported_by;
  new.reported_at := old.reported_at;
  new.clinician_alert_id := old.clinician_alert_id;

  -- Adding detail while still 'open' needs no special authority -- same
  -- carve-out as clinical_incident_reports.
  if new.status = old.status then
    return new;
  end if;

  select cs.id, cs.doctor_tier into v_staff_id, v_tier
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = new.organisation_id
    and cs.active
    and (cs.is_clinical_director or cs.doctor_tier in ('tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist'))
  limit 1;

  if v_staff_id is null then
    raise exception 'Only a Tier 3+ clinician or the Clinical Director can move a safeguarding concern into review or close it.'
      using errcode = '42501';
  end if;

  new.reviewed_by_staff := v_staff_id;
  new.reviewed_at := now();

  if new.status = 'closed' then
    if new.review_outcome is null or length(btrim(new.review_outcome)) = 0 then
      raise exception 'Closing a safeguarding concern needs a stated review outcome, so a closed record always says what was found.';
    end if;
    new.closed_by_staff := v_staff_id;
    new.closed_at := now();
  end if;

  return new;
end;
$$;

comment on function private.enforce_safeguarding_concern_attribution() is
  'INSERT: forces reported_by/reported_at/status server-side and auto-raises an urgent_escalation clinician_alert via raise_clinician_alert(). reported_by is set to the inserting session only when that session is org staff -- an automated, non-staff-session insert (the adolescent psychosocial check-in auto-flagging trigger, which can run on behalf of a patient''s own self-administered check-in) leaves reported_by null, so a patient can never match safeguarding_concerns_select''s reported_by = auth.uid() clause for a concern raised about themselves. UPDATE: blocks editing a closed concern, keeps filing attribution immutable, requires Tier 3+/Clinical Director to move a concern into review or close it.';

-- CREATE OR REPLACE preserves the function's existing grants/ACL (it is not
-- a new object), so the anon/public revoke this function already carries
-- from 20260829213100 is untouched -- restated here anyway, redundant but
-- explicit, matching this codebase's established style for security-
-- relevant functions (and CLAUDE.md's standing anon-EXECUTE vigilance).
revoke all on function private.enforce_safeguarding_concern_attribution() from public, anon;

-- ===========================================================================
-- Assertions -- the migration is the test.
-- ===========================================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'safeguarding_concerns' and column_name = 'linked_screen_id'
  ) then
    raise exception 'FAIL: safeguarding_concerns.linked_screen_id was not added';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'safeguarding_concerns' and column_name = 'linked_emergency_event_id'
  ) then
    raise exception 'FAIL: safeguarding_concerns.linked_emergency_event_id was not added';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'safeguarding_concerns' and column_name = 'source'
  ) then
    raise exception 'FAIL: safeguarding_concerns.source was not added';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'safeguarding_concerns'
      and column_name in ('linked_screen_id', 'linked_emergency_event_id')
      and is_nullable = 'NO'
  ) then
    raise exception 'FAIL: linked_screen_id/linked_emergency_event_id must be nullable additions';
  end if;

  if pg_get_functiondef('private.enforce_safeguarding_concern_attribution()'::regprocedure)
       not like '%is_org_staff%' then
    raise exception 'FAIL: enforce_safeguarding_concern_attribution no longer guards reported_by on is_org_staff';
  end if;

  if has_function_privilege('anon', 'private.enforce_safeguarding_concern_attribution()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.enforce_safeguarding_concern_attribution';
  end if;

  raise notice 'PASS: safeguarding_concerns extended with adolescent-linkage columns; reported_by attribution now guarded on is_org_staff';
end $$;
