-- Tarragon Health
-- Patient Safety gap-closure, item 2 of 5 (§89.4 "wrong-patient prevention" of
-- the 2026-08-29 governance/safety spec audit). Confirmed a genuine, clean
-- gap before writing this (checked live via information_schema, not a local
-- migration file, given how many concurrent sessions are writing to this
-- project right now): no table anywhere carries an identity-confirmation
-- column, and no high-risk clinical write requires one.
--
-- SCOPE, deliberate and narrow: the two highest-risk, single-clean-call-site
-- actions found by direct code read --
--   1. Finalizing a clinical_encounter_notes row (signing a diagnosis/plan
--      to a specific patient's chart -- one mutation path,
--      useFinalizeEncounterNote in apps/web/src/lib/queries/encounter-notes.ts)
--   2. Resolving an escalation (closing a clinical case as this specific
--      patient -- one mutation path, useResolveEscalation in
--      apps/web/src/lib/queries/escalations.ts)
-- medications was deliberately NOT touched here: it has ~12 call sites
-- across referrals/sponsorship/pack-actions/refills that were not each
-- individually audited, and a blanket CHECK constraint risks silently
-- breaking a live prescribing/refill flow this migration has no evidence
-- about. Extending wrong-patient prevention to medications is a real
-- follow-up, not abandoned scope -- it just needs its own audit of every
-- insert path first, the same discipline this migration applied to the two
-- tables it does touch.
--
-- MECHANISM: same "client signals intent via a boolean, server stamps who/
-- when, CHECK requires it before the terminal transition" shape this
-- codebase already uses for reviewed_by/reviewed_at and closed_by/closed_at.
-- identity_confirmed is the one field a UI confirmation modal sets; the
-- server derives identity_confirmed_by/at itself from auth.uid() the moment
-- it sees that flag flip true -- never trusts a client-supplied uid or
-- timestamp, same discipline as every other attribution column in this
-- codebase.

alter table public.clinical_encounter_notes
  add column identity_confirmed boolean not null default false,
  add column identity_confirmed_by uuid references public.clinical_staff (id) on delete set null,
  add column identity_confirmed_at timestamptz;

comment on column public.clinical_encounter_notes.identity_confirmed is
  'Set true by the <PatientIdentityConfirm> modal (name + DOB, actively confirmed) immediately before finalizing. Required to finalize -- see clinical_encounter_notes_finalized_requires_identity_confirm.';

-- NOT VALID + immediate VALIDATE (not a single validated ADD CONSTRAINT):
-- confirmed 0 existing finalized notes right now, but this project has
-- ~13 concurrent worktree sessions writing to the same database, so a
-- plain validated ADD CONSTRAINT risks failing outright if a note gets
-- finalized in the gap between that count check and this statement. NOT
-- VALID takes effect on all new writes immediately either way; the
-- explicit VALIDATE right after is a same-migration proof, not a
-- functional requirement, matching this codebase's own precedent (see
-- clinician_alerts_resolution_requires_documentation, added NOT VALID for
-- exactly this reason).
alter table public.clinical_encounter_notes
  add constraint clinical_encounter_notes_finalized_requires_identity_confirm check (
    status <> 'finalized' or identity_confirmed
  ) not valid;
alter table public.clinical_encounter_notes
  validate constraint clinical_encounter_notes_finalized_requires_identity_confirm;

alter table public.escalations
  add column identity_confirmed boolean not null default false,
  add column identity_confirmed_by uuid references public.profiles (id) on delete set null,
  add column identity_confirmed_at timestamptz;

comment on column public.escalations.identity_confirmed is
  'Set true by the <PatientIdentityConfirm> modal immediately before resolving. Required to resolve (not to refer or claim) -- see escalations_resolved_requires_identity_confirm.';

alter table public.escalations
  add constraint escalations_resolved_requires_identity_confirm check (
    status <> 'resolved' or identity_confirmed
  ) not valid;
alter table public.escalations
  validate constraint escalations_resolved_requires_identity_confirm;

-- ---------------------------------------------------------------------------
-- Stamp identity_confirmed_by/at server-side the moment the flag flips true,
-- same-transaction as whatever else the caller changed. Byte-identical to
-- the live enforce_clinical_encounter_note_attribution() otherwise --
-- queried from pg_proc before writing this, not assumed from the local
-- migration file.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_clinical_encounter_note_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  select id into v_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active
    and (
      is_clinical_director
      or doctor_tier in ('tier_1', 'tier_2', 'tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
    )
  limit 1;

  if v_staff_id is null then
    raise exception 'Only a clinical-tier member of the care team can write or finalize a clinical encounter note.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.authored_by_staff := v_staff_id;
    new.authored_by_profile := (select auth.uid());
    new.status := 'draft';
    new.finalized_by_staff := null;
    new.finalized_at := null;
    new.identity_confirmed := false;
    new.identity_confirmed_by := null;
    new.identity_confirmed_at := null;
    return new;
  end if;

  if old.status = 'finalized' then
    raise exception 'This encounter note is finalized and cannot be edited. Write a new note if something new needs recording.'
      using errcode = '42501';
  end if;

  new.authored_by_staff := old.authored_by_staff;
  new.authored_by_profile := old.authored_by_profile;

  -- The client only ever flips this false -> true; never trust who/when it
  -- claims -- stamp both from the session the instant the flag changes.
  if new.identity_confirmed and not old.identity_confirmed then
    new.identity_confirmed_by := v_staff_id;
    new.identity_confirmed_at := now();
  elsif not new.identity_confirmed then
    new.identity_confirmed_by := null;
    new.identity_confirmed_at := null;
  else
    new.identity_confirmed_by := old.identity_confirmed_by;
    new.identity_confirmed_at := old.identity_confirmed_at;
  end if;

  if new.status = 'finalized' and old.status = 'draft' then
    if not new.identity_confirmed then
      raise exception 'Confirm the patient''s identity (name + date of birth) before finalizing this note.'
        using errcode = '42501';
    end if;
    new.finalized_by_staff := v_staff_id;
    new.finalized_at := now();
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- escalations gets a new, narrowly-scoped trigger rather than an edit to an
-- existing one (there is no prior attribution trigger on this table --
-- reviewed_by/reviewed_at have always been client-set from the session's own
-- auth.uid(), per useResolveEscalation). Only touches the RESOLVE
-- transition, matching the emergency-tier gate's own precedent of gating
-- specific transitions rather than the whole table -- referring or claiming
-- a case is untouched.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_escalation_identity_confirm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    if not new.identity_confirmed then
      raise exception 'Confirm the patient''s identity (name + date of birth) before resolving this escalation.'
        using errcode = '42501';
    end if;
    new.identity_confirmed_by := (select auth.uid());
    new.identity_confirmed_at := now();
  end if;

  return new;
end;
$$;

comment on function private.enforce_escalation_identity_confirm() is
  'Requires identity_confirmed=true (set by the <PatientIdentityConfirm> modal) to resolve an escalation; stamps identity_confirmed_by/at server-side from auth.uid(), never client-supplied. Referring or claiming a case is untouched -- only the RESOLVE transition is gated, same scoping precedent as escalations_enforce_emergency_authority.';

create trigger escalations_enforce_identity_confirm
  before update on public.escalations
  for each row execute function private.enforce_escalation_identity_confirm();

revoke all on function private.enforce_escalation_identity_confirm() from public;

-- ---------------------------------------------------------------------------
-- Assertions -- the migration is the test.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinical_encounter_notes' and column_name = 'identity_confirmed'
  ) then
    raise exception 'clinical_encounter_notes.identity_confirmed missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'escalations' and column_name = 'identity_confirmed'
  ) then
    raise exception 'escalations.identity_confirmed missing';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_encounter_notes'::regclass
      and conname = 'clinical_encounter_notes_finalized_requires_identity_confirm'
  ) then
    raise exception 'clinical_encounter_notes_finalized_requires_identity_confirm missing';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.escalations'::regclass
      and conname = 'escalations_resolved_requires_identity_confirm'
  ) then
    raise exception 'escalations_resolved_requires_identity_confirm missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.escalations'::regclass
      and tgname = 'escalations_enforce_identity_confirm'
      and not tgisinternal
  ) then
    raise exception 'escalations_enforce_identity_confirm trigger missing';
  end if;

  -- Zero-behaviour-change proof: every existing finalized note / resolved
  -- escalation predates this constraint and must not be retroactively
  -- invalidated -- the CHECK only applies going forward on write, but a
  -- constraint add still validates existing rows unless NOT VALID, so
  -- confirm no existing row would fail it.
  if exists (select 1 from public.clinical_encounter_notes where status = 'finalized' and not identity_confirmed) then
    raise exception 'a pre-existing finalized encounter note would violate the new identity-confirm constraint -- this should be structurally impossible since the constraint was just added, but asserting rather than assuming';
  end if;
  if exists (select 1 from public.escalations where status = 'resolved' and not identity_confirmed) then
    raise exception 'a pre-existing resolved escalation would violate the new identity-confirm constraint -- this should be structurally impossible since the constraint was just added, but asserting rather than assuming';
  end if;

  raise notice 'PASS: identity-confirmation required to finalize an encounter note or resolve an escalation, server-stamped, zero existing rows affected';
end $$;
